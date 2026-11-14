import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { ChatStore, MessageView } from "./chat.js";
import type { ChatMessage } from "./ollama.js";
import { generateReply, HISTORY, messageLine, type ChatGenerator, type PersonaProfile } from "./personaChat.js";
import { decideGroup, decideTalk, reactionFor } from "./personaJev.js";
import { QUEUES } from "./queues.js";
import type { Hub } from "./realtime.js";

/**
 * Personas entre si (SPEC 7.5). O agendador do worker escolhe quem puxa conversa e com que vídeo
 * (job "start"); aqui, na api, cada fala vira um job da fila persona.talk, com uma pausa entre uma e
 * outra. Fica na api porque só ela avisa quem está com o app aberto (Grupo do Bunker) e porque usa
 * as mesmas regras e proteções do chat com gente.
 */

type Reasons = Record<string, number | string | boolean>;

export type TalkJob =
  /** Vídeo mandado pelo agendador para outra persona, ou para o Grupo do Bunker (partnerId null). */
  | { kind: "start"; starterId: string; partnerId: string | null; videoId: string; score: number; reasons: Reasons }
  /** Vez de `personaId` responder (ou não) a `afterId` numa conversa direta entre personas. */
  | { kind: "turn"; conversationId: string; personaId: string; afterId: string; messages: number }
  /** Mensagem nova no Grupo do Bunker: o JEV decide quais personas respondem. */
  | { kind: "group"; conversationId: string; messageId: string }
  /** Uma persona escolhida responde no Grupo do Bunker. */
  | { kind: "group_reply"; conversationId: string; personaId: string; messageId: string; score: number; reasons: Reasons };

export interface TalkPersona extends PersonaProfile {
  /** Como ela vê outras personas (apelido → frase), de `relacoes` no JSON. */
  relations: Record<string, string>;
}

export interface GroupCandidate {
  persona: TalkPersona;
  /** Afinidade com os tópicos do vídeo da mensagem; null quando é texto. */
  affinity: number | null;
}

export interface TalkStore {
  persona(id: string): Promise<TalkPersona | null>;
  /** Comentários e mensagens de personas na última hora (PERSONA_RATE). */
  actionsLastHour(): Promise<number>;
  /** Grava a decisão se ainda não existe; false quando outro job já decidiu (repetição segura). */
  claim(personaId: string, trigger: "tique" | "mensagem", targetId: string, decision: { action: string; score: number; reasons: Reasons }): Promise<boolean>;
  /** Personas do grupo, menos quem mandou a mensagem, com a afinidade pelo vídeo dela. */
  groupCandidates(conversationId: string, messageId: string): Promise<GroupCandidate[]>;
  /** O Grupo do Bunker. */
  bunkerId(): Promise<string | null>;
}

export interface TalkQueue {
  send(name: string, data: object, options?: { startAfter?: number }): Promise<unknown>;
}

export interface TalkerDeps {
  chat: ChatStore;
  store: TalkStore;
  hub: Hub;
  generate: ChatGenerator;
  queue: TalkQueue;
  /** Tem gente esperando resposta de persona: a conversa entre personas espera a vez. */
  busy: () => boolean;
  /** PERSONA_RATE: acima disso, ninguém puxa nem continua conversa. */
  rate: number;
  /** Pausa média entre duas falas, em segundos (varia de metade ao dobro). */
  turnDelaySeconds: number;
  random?: () => number;
  log?: (msg: string) => void;
}

/** Espera quando tem gente conversando com persona, em segundos. */
export const BUSY_RETRY_SECONDS = 15;

/** Prompt do Grupo do Bunker: várias pessoas, então cada fala vai com o apelido de quem mandou. */
export function buildGroupMessages(persona: PersonaProfile, groupName: string, history: MessageView[], examples: string[], retry: boolean): ChatMessage[] {
  const system = `Você é ${persona.name}, numa rede social brasileira de vídeos curtos, no grupo "${groupName}", com várias pessoas e outras personas.
Quem você é: ${persona.bio}
Seu jeito de escrever: ${persona.tone}

Mensagens que você mandou em OUTRAS conversas (só mostram o jeito de escrever):
${examples.map((e) => `- ${e}`).join("\n")}

Regras:
- Responda à última mensagem do grupo como num grupo de celular: uma ou duas frases curtas.
- Escreva sempre em português do Brasil.
- Fale só por você: não escreva a fala de mais ninguém e não repita o que já foi dito.
- Você é uma pessoa do grupo, não um assistente: não ofereça ajuda.
- Copie o jeito das frases acima, nunca o assunto.
- Não invente o que aparece num vídeo além do título e da descrição.
- Escreva só a sua mensagem, sem o seu nome na frente e sem aspas.${
    retry
      ? "\n\nAviso só para você (não fale dele na resposta): sua resposta anterior foi descartada (repetia a mensagem, copiava uma frase, repetia palavras sem parar ou não estava em português). Escreva outra, com suas palavras."
      : ""
  }`;
  return [
    { role: "system", content: system },
    ...history.map((m): ChatMessage =>
      m.sender.nickname === persona.nickname ? { role: "assistant", content: messageLine(m) } : { role: "user", content: `@${m.sender.nickname}: ${messageLine(m)}` },
    ),
  ];
}

/** Paradas do grupo: a fala de qualquer participante. */
export const groupStopWords = (history: MessageView[], self: string) => [
  "\n\n",
  "Você:",
  ...new Set(history.map((m) => m.sender.nickname).filter((n) => n !== self).flatMap((n) => [`@${n}:`, `${n}:`])),
];

export class PersonaTalker {
  private readonly abort = new AbortController();

  constructor(private readonly deps: TalkerDeps) {}

  close(): void {
    this.abort.abort();
  }

  /** Mensagem de gente fora de conversa direta com persona: no Grupo do Bunker, as personas podem responder. */
  async onHumanMessage(message: MessageView, senderId: string): Promise<void> {
    // Fala de persona nunca chama outras personas: o grupo não vira uma conversa sem fim entre elas.
    if (message.sender.isAi) return;
    const conv = await this.deps.chat.getConversation(senderId, message.conversationId);
    if (!conv?.bunker) return;
    await this.deps.queue.send(QUEUES.personaTalk, { kind: "group", conversationId: conv.id, messageId: message.id } satisfies TalkJob, {
      startAfter: this.pause(),
    });
  }

  async handle(job: TalkJob): Promise<void> {
    if (this.deps.busy()) {
      await this.deps.queue.send(QUEUES.personaTalk, job, { startAfter: BUSY_RETRY_SECONDS });
      return;
    }
    switch (job.kind) {
      case "start":
        return this.start(job);
      case "turn":
        return this.turn(job);
      case "group":
        return this.group(job);
      case "group_reply":
        return this.groupReply(job);
    }
  }

  private get random() {
    return this.deps.random ?? Math.random;
  }

  /** Pausa até a próxima fala: de metade ao dobro da média (ninguém responde no mesmo segundo). */
  private pause() {
    return Math.max(1, Math.round(this.deps.turnDelaySeconds * (0.5 + 1.5 * this.random())));
  }

  private async overLimit() {
    return (await this.deps.store.actionsLastHour()) >= this.deps.rate;
  }

  private log(msg: string) {
    this.deps.log?.(`[persona] ${msg}`);
  }

  private async start(job: Extract<TalkJob, { kind: "start" }>) {
    const { chat, store, hub, queue } = this.deps;
    if (await this.overLimit()) return this.log("limite de ações por hora: ninguém puxa conversa agora");
    const starter = await store.persona(job.starterId);
    const partner = job.partnerId ? await store.persona(job.partnerId) : null;
    if (!starter || (job.partnerId && !partner)) return;
    let conversationId: string | null;
    if (partner) {
      const conv = await chat.openDirect(starter.id, partner.nickname);
      conversationId = typeof conv === "string" ? null : conv.id;
    } else {
      conversationId = await store.bunkerId();
    }
    if (!conversationId) return;
    // Job repetido: o vídeo já foi.
    const recent = (await chat.listMessages(starter.id, conversationId, null, HISTORY)) ?? [];
    if (recent.some((m) => m.video?.id === job.videoId && m.sender.nickname === starter.nickname)) return;
    const sent = await chat.sendMessage(starter.id, conversationId, { videoId: job.videoId });
    if (typeof sent === "string") return this.log(`${starter.nickname} não mandou o vídeo (${sent})`);
    hub.send(sent.memberIds, { type: "message", message: sent.message });
    await store.claim(starter.id, "tique", sent.message.id, {
      action: "enviar_video",
      score: job.score,
      reasons: { ...job.reasons, para: partner ? partner.nickname : "Grupo do Bunker" },
    });
    const next: TalkJob = partner
      ? { kind: "turn", conversationId, personaId: partner.id, afterId: sent.message.id, messages: 1 }
      : { kind: "group", conversationId, messageId: sent.message.id };
    await queue.send(QUEUES.personaTalk, next, { startAfter: this.pause() });
  }

  private async turn(job: Extract<TalkJob, { kind: "turn" }>) {
    const { chat, store, queue } = this.deps;
    const persona = await store.persona(job.personaId);
    if (!persona) return;
    const history = (await chat.listMessages(persona.id, job.conversationId, null, HISTORY)) ?? [];
    const last = history.at(-1);
    // A conversa andou (outro job, ou alguém mexeu): esta vez já passou.
    if (!last || last.id !== job.afterId || last.sender.nickname === persona.nickname) return;
    const decision = decideTalk(persona.activity ?? 0.5, job.messages, last.text ?? "", this.random);
    if (decision.action === "responder" && (await this.overLimit())) {
      decision.action = "ignorar";
      decision.reasons.limite_por_hora = true;
    }
    if (!(await store.claim(persona.id, "mensagem", last.id, decision))) return;
    if (decision.react) await this.react(persona, job.conversationId, last.id, decision.react);
    if (decision.action === "ignorar") return;
    const other = last.sender.nickname;
    const memory = persona.relations[other] ?? "outra persona do bunker; vocês se conhecem só daqui.";
    const sent = await this.say(persona, job.conversationId, history, (onDraft, signal) =>
      generateReply(this.deps.generate, persona, other, memory, history, onDraft, signal),
    );
    if (!sent) return;
    const otherId = (await chat.memberIds(job.conversationId)).find((id) => id !== persona.id);
    if (!otherId) return;
    await queue.send(
      QUEUES.personaTalk,
      { kind: "turn", conversationId: job.conversationId, personaId: otherId, afterId: sent.id, messages: job.messages + 1 } satisfies TalkJob,
      { startAfter: this.pause() },
    );
  }

  private async group(job: Extract<TalkJob, { kind: "group" }>) {
    const { store, queue } = this.deps;
    const candidates = await store.groupCandidates(job.conversationId, job.messageId);
    if (!candidates.length || (await this.overLimit())) return;
    // Várias mensagens seguidas ("gente" / "alguém viu o jogo?"): só a última chama as personas.
    const recent = (await this.deps.chat.listMessages(candidates[0]!.persona.id, job.conversationId, null, HISTORY)) ?? [];
    const at = recent.findIndex((m) => m.id === job.messageId);
    if (at >= 0 && recent.slice(at + 1).some((m) => !m.sender.isAi)) return;
    const decisions = decideGroup(
      candidates.map((c) => ({ id: c.persona.id, activity: c.persona.activity ?? 0.5, affinity: c.affinity })),
      this.random,
    );
    let order = 0;
    for (const d of decisions) {
      if (d.action === "ignorar") continue;
      // Quem comenta fala um depois do outro; quem só reage, logo.
      const startAfter = d.action === "comentar" ? this.pause() * ++order : 1;
      await queue.send(
        QUEUES.personaTalk,
        { kind: "group_reply", conversationId: job.conversationId, personaId: d.id, messageId: job.messageId, score: d.score, reasons: { ...d.reasons, acao: d.action } } satisfies TalkJob,
        { startAfter },
      );
    }
  }

  private async groupReply(job: Extract<TalkJob, { kind: "group_reply" }>) {
    const { chat, store } = this.deps;
    const persona = await store.persona(job.personaId);
    if (!persona) return;
    const history = (await chat.listMessages(persona.id, job.conversationId, null, HISTORY)) ?? [];
    const target = history.find((m) => m.id === job.messageId);
    if (!target) return;
    const comment = job.reasons.acao === "comentar" && !(await this.overLimit());
    const action = comment ? "comentar" : "reagir";
    if (!(await store.claim(persona.id, "mensagem", job.messageId, { action, score: job.score, reasons: job.reasons }))) return;
    if (!comment) return this.react(persona, job.conversationId, target.id, reactionFor(target.text ?? "", this.random));
    // Responde à mensagem que a chamou, com o que veio depois dela como contexto.
    const upTo = history.slice(0, history.findLastIndex((m) => m.sender.nickname !== persona.nickname) + 1);
    await this.say(persona, job.conversationId, upTo, (onDraft, signal) =>
      generateReply(this.deps.generate, persona, target.sender.nickname, "", upTo, onDraft, signal, {
        build: (examples, retry) => buildGroupMessages(persona, "Grupo do Bunker", upTo, examples, retry),
        stop: groupStopWords(upTo, persona.nickname),
      }),
    );
  }

  private async react(persona: PersonaProfile, conversationId: string, messageId: string, emoji: string) {
    const result = await this.deps.chat.setReaction(persona.id, conversationId, messageId, emoji);
    if (result) this.deps.hub.send(result.memberIds, { type: "reaction", conversationId, messageId, reactions: result.reactions });
  }

  /** Escreve a fala com "digitando…" e texto parcial para quem estiver na conversa. */
  private async say(
    persona: PersonaProfile,
    conversationId: string,
    history: MessageView[],
    write: (onDraft: (text: string) => void, signal: AbortSignal) => Promise<{ text: string; rejected: string[] }>,
  ): Promise<MessageView | null> {
    const { chat, hub } = this.deps;
    const members = await chat.memberIds(conversationId);
    const who = { conversationId, nickname: persona.nickname };
    const replyId = randomUUID();
    let lastDraft = 0;
    hub.send(members, { type: "typing", ...who });
    try {
      const { text, rejected } = await write((draft) => {
        const now = Date.now();
        if (!draft || now - lastDraft < 150) return;
        lastDraft = now;
        hub.send(members, { type: "draft", ...who, replyId, text: draft });
      }, this.abort.signal);
      for (const r of rejected) this.log(`${persona.nickname} repetiu ou copiou: ${r.slice(0, 120)}`);
      if (!text) throw new Error("resposta vazia, repetida ou copiada do exemplo");
      const sent = await chat.sendMessage(persona.id, conversationId, { text });
      if (typeof sent === "string") throw new Error(`não gravou a fala (${sent})`);
      hub.send(sent.memberIds, { type: "message", message: sent.message });
      return sent.message;
    } catch (err) {
      // Nas conversas entre personas, falha só encerra a conversa; no grupo, apaga o "digitando".
      hub.send(members, { type: "reply_failed", ...who });
      this.log(`${persona.nickname} não conseguiu falar (${history.length} msgs): ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }
}

interface PersonaRow {
  user_id: string;
  nickname: string;
  bio: string;
  tone: string;
  examples: string[];
  activity_level: number;
  config: { nome?: string; relacoes?: Record<string, string>; afinidade?: Record<string, number> };
}

const toPersona = (r: PersonaRow): TalkPersona => ({
  id: r.user_id,
  nickname: r.nickname,
  name: r.config.nome ?? r.nickname,
  bio: r.bio,
  tone: r.tone,
  examples: r.examples,
  activity: r.activity_level,
  relations: r.config.relacoes ?? {},
});

const PERSONA_SELECT = `SELECT p.user_id, u.nickname, p.bio, p.tone, p.examples, p.activity_level, p.config
                          FROM personas p JOIN users u ON u.id = p.user_id`;

export class PgTalkStore implements TalkStore {
  constructor(private readonly pool: Pool) {}

  async persona(id: string) {
    const res = await this.pool.query<PersonaRow>(`${PERSONA_SELECT} WHERE p.user_id = $1`, [id]);
    return res.rows[0] ? toPersona(res.rows[0]) : null;
  }

  async actionsLastHour() {
    const res = await this.pool.query<{ n: number }>(
      `SELECT ((SELECT count(*) FROM comments c JOIN personas p ON p.user_id = c.user_id WHERE c.created_at > now() - interval '1 hour')
             + (SELECT count(*) FROM messages m JOIN personas p ON p.user_id = m.sender_id WHERE m.created_at > now() - interval '1 hour'))::int AS n`,
    );
    return res.rows[0]!.n;
  }

  async claim(personaId: string, trigger: "tique" | "mensagem", targetId: string, d: { action: string; score: number; reasons: Reasons }) {
    const res = await this.pool.query(
      `INSERT INTO persona_decisions (persona_user_id, trigger, target_id, action, score, reasons)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (persona_user_id, trigger, target_id) DO NOTHING RETURNING id`,
      [personaId, trigger, targetId, d.action, d.score, JSON.stringify(d.reasons)],
    );
    return res.rowCount === 1;
  }

  async groupCandidates(conversationId: string, messageId: string) {
    const res = await this.pool.query<PersonaRow & { affinity: number | null }>(
      `SELECT p.user_id, u.nickname, p.bio, p.tone, p.examples, p.activity_level, p.config,
              (SELECT avg(COALESCE((p.config->'afinidade'->>t.slug)::float8, 0.3))
                 FROM video_topics vt JOIN topics t ON t.id = vt.topic_id
                WHERE vt.video_id = msg.video_id)::float8 AS affinity
         FROM messages msg
         JOIN conversation_members cm ON cm.conversation_id = msg.conversation_id
         JOIN personas p ON p.user_id = cm.user_id
         JOIN users u ON u.id = p.user_id
        WHERE msg.id = $2 AND msg.conversation_id = $1 AND p.user_id <> msg.sender_id`,
      [conversationId, messageId],
    );
    return res.rows.map((r) => ({ persona: toPersona(r), affinity: r.affinity }));
  }

  async bunkerId() {
    const res = await this.pool.query<{ id: string }>("SELECT id FROM conversations WHERE bunker");
    return res.rows[0]?.id ?? null;
  }
}
