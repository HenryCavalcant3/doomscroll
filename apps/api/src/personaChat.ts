import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { JobQueue } from "./app.js";
import type { ChatStore, MessageView } from "./chat.js";
import type { ChatMessage } from "./ollama.js";
import { QUEUES } from "./queues.js";
import type { Hub } from "./realtime.js";
import { avatarUrl } from "./store.js";

/** Chat com as personas (SPEC 7.4, passo 8): a persona responde mensagens diretas de pessoas. */

export interface PersonaProfile {
  id: string;
  nickname: string;
  name: string;
  bio: string;
  tone: string;
  examples: string[];
}

export interface PersonaOverview {
  nickname: string;
  name: string;
  avatarUrl: string | null;
  activity: number;
  /** Comentários e mensagens na última hora. */
  lastHour: number;
}

export interface PersonaChatStore {
  /** A persona da conversa, quando ela é direta, o outro membro é persona e quem mandou é gente. */
  directPersona(conversationId: string, senderId: string): Promise<PersonaProfile | null>;
  /** Resumo que a persona guarda do contato ("" quando ainda não há). */
  memory(personaId: string, contactId: string): Promise<string>;
  /** Conta uma mensagem trocada; true quando chegou a `every` (e zera a contagem). */
  countMessage(personaId: string, contactId: string, every: number): Promise<boolean>;
  overview(): Promise<PersonaOverview[]>;
}

/** Mensagens trocadas entre um resumo da memória e o próximo (SPEC 7.4: "a cada N mensagens"). */
export const MEMORY_EVERY = 10;
/** Mensagens da conversa que entram no prompt. */
export const HISTORY = 12;
export const MAX_REPLY = 300;
const EXAMPLES_PER_PROMPT = 3;

export function pickExamples(examples: string[], n = EXAMPLES_PER_PROMPT, random = Math.random): string[] {
  const pool = [...examples];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, n);
}

/** Como uma mensagem aparece no prompt: texto, ou o vídeo compartilhado descrito em uma linha. */
export function messageLine(m: MessageView): string {
  if (m.video) {
    const about = [m.video.title, m.video.description].filter(Boolean).join(" — ");
    return `[mandou um vídeo: ${about || "sem título"}]`;
  }
  return m.text ?? "";
}

/** Prompt de chat: persona, memória do contato e as últimas mensagens (as da persona como assistant). */
export function buildChatMessages(
  persona: PersonaProfile,
  contact: string,
  memory: string,
  history: MessageView[],
  examples: string[] = persona.examples,
  /** Nova tentativa depois de uma resposta recusada por `badReply`: o prompt avisa. */
  retry = false,
): ChatMessage[] {
  const system = `Você é ${persona.name}, numa rede social brasileira de vídeos curtos, conversando por mensagem direta com @${contact}.
Quem você é: ${persona.bio}
Seu jeito de escrever: ${persona.tone}
O que você lembra de @${contact}: ${memory || "vocês estão começando a conversar agora."}

Mensagens que você mandou em OUTRAS conversas (só mostram o jeito de escrever):
${examples.map((e) => `- ${e}`).join("\n")}

Regras:
- Responda à última mensagem como numa conversa de celular: de uma a três frases curtas, em português do Brasil.
- Nunca repita o que @${contact} escreveu. Se for uma pergunta, responda com a sua opinião.
- Você é uma pessoa da rede, não um assistente: não ofereça ajuda nem diga "estou aqui se precisar".
- Copie o jeito das frases acima, nunca o assunto.
- Não invente fatos sobre você nem sobre @${contact}. Se não souber, pergunte.
- Não fale de fim do mundo, apocalipse nem bunker, a não ser que @${contact} puxe o assunto.
- Escreva só a sua mensagem, sem o seu nome na frente e sem aspas.${
    retry
      ? "\n\nAviso só para você (não fale dele na resposta): sua resposta anterior foi descartada porque repetia a mensagem ou copiava uma frase. Escreva outra, com suas palavras."
      : ""
  }`;
  return [
    { role: "system", content: system },
    ...history.map((m): ChatMessage => ({ role: m.sender.nickname === persona.nickname ? "assistant" : "user", content: messageLine(m) })),
  ];
}

/** Paradas para o modelo não escrever a fala do outro lado. */
export const stopWords = (contact: string) => ["\n\n", `@${contact}:`, `${contact}:`, "Você:"];

/** Limpa a resposta (vale para o texto parcial e o final): sem nome na frente, aspas nem sobra. */
export function cleanReply(raw: string, persona: PersonaProfile, max = MAX_REPLY): string {
  let text = raw.trim();
  const prefixes = [persona.name, persona.nickname, `@${persona.nickname}`];
  for (const p of prefixes) {
    if (text.toLowerCase().startsWith(`${p.toLowerCase()}:`)) text = text.slice(p.length + 1).trim();
  }
  text = text.replace(/^["'“”]+|["'“”]+$/g, "").replace(/[ \t]+/g, " ").trim();
  if (text.length > max) {
    const cut = text.slice(0, max);
    const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
    text = end > max / 3 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`;
  }
  return text;
}

const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .match(/[a-z0-9]+/g) ?? [];

/** Palavras normalizadas da conversa (as palavras longas daqui podem aparecer na resposta). */
const talkWords = (history: MessageView[]) => new Set(normalize(history.map(messageLine).join(" ")));

/**
 * true quando a resposta copia o exemplo: a frase inteira, ou 3 palavras seguidas com uma palavra
 * longa que não aparece na conversa (mesma regra do comentário no worker). Expressões curtas do
 * jeito da persona continuam valendo.
 */
function copies(words: string[], example: string, talk: Set<string>): boolean {
  const ex = normalize(example);
  if (ex.join(" ") === words.join(" ")) return true;
  const grams = new Set<string>();
  for (let i = 0; i + 3 <= ex.length; i++) grams.add(ex.slice(i, i + 3).join(" "));
  for (let i = 0; i + 3 <= words.length; i++) {
    const gram = words.slice(i, i + 3);
    const long = gram.filter((w) => w.length >= 6);
    if (grams.has(gram.join(" ")) && long.length > 0 && long.every((w) => !talk.has(w))) return true;
  }
  return false;
}

/** true quando a resposta não serve: vazia, repete a última mensagem do contato ou copia um exemplo. */
export function badReply(text: string, examples: string[], history: MessageView[]): boolean {
  const words = normalize(text);
  if (words.length === 0) return true;
  const last = history.at(-1);
  if (last) {
    const said = normalize(messageLine(last)).join(" ");
    if (said && said === words.join(" ")) return true;
  }
  const talk = talkWords(history);
  return examples.some((ex) => copies(words, ex, talk));
}

/** Tentativas de gerar uma resposta que passe em `badReply`. */
export const REPLY_ATTEMPTS = 3;

/** Gera a resposta em streaming; `onText` recebe o texto acumulado. */
export type ChatGenerator = (messages: ChatMessage[], stop: string[], onText: (full: string) => void, signal: AbortSignal) => Promise<string>;

/** Opções do Ollama no chat: respostas curtas, com um pouco de variação (as paradas vêm de `stopWords`). */
export const CHAT_OPTIONS = { temperature: 0.8, num_predict: 150, num_ctx: 4096 };

/**
 * Gera a resposta da persona até ela passar em `badReply` (no máximo REPLY_ATTEMPTS vezes).
 * `text` fica "" quando nenhuma tentativa serviu; `rejected` guarda as recusadas, em ordem.
 * Usado pelo PersonaReplier e pela bancada de avaliação do chat.
 */
export async function generateReply(
  generate: ChatGenerator,
  persona: PersonaProfile,
  contact: string,
  memory: string,
  history: MessageView[],
  onDraft: (text: string) => void,
  signal: AbortSignal,
): Promise<{ text: string; rejected: string[] }> {
  const rejected: string[] = [];
  const talk = talkWords(history);
  for (let attempt = 0; attempt < REPLY_ATTEMPTS; attempt++) {
    // Exemplos sorteados de novo a cada tentativa, sem os que já foram copiados (o modelo insiste neles).
    const fresh = persona.examples.filter((ex) => !rejected.some((r) => copies(normalize(r), ex, talk)));
    const prompt = buildChatMessages(persona, contact, memory, history, pickExamples(fresh), rejected.length > 0);
    const raw = await generate(prompt, stopWords(contact), (full) => onDraft(cleanReply(full, persona)), signal);
    const text = cleanReply(raw, persona);
    if (!badReply(text, persona.examples, history)) return { text, rejected };
    rejected.push(text.slice(0, 200));
  }
  return { text: "", rejected };
}

export interface ReplierDeps {
  chat: ChatStore;
  personas: PersonaChatStore;
  hub: Hub;
  generate: ChatGenerator;
  queue: JobQueue;
  /** Espera antes de responder, para juntar mensagens mandadas em sequência. */
  debounceMs?: number;
  /** Intervalo mínimo entre dois avisos do texto parcial. */
  draftMs?: number;
  log?: (msg: string) => void;
}

/**
 * Responde as mensagens diretas mandadas para personas. Roda na api (não na fila), direto no Ollama:
 * quem mandou está esperando, e o worker nunca ocupa o modelo com mais de uma chamada por vez.
 */
export class PersonaReplier {
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly running = new Set<string>();
  private readonly pending = new Set<Promise<unknown>>();
  private readonly abort = new AbortController();

  constructor(private readonly deps: ReplierDeps) {}

  /** Chamado depois de cada mensagem gravada. Nunca lança: erros viram log e aviso de falha. */
  onMessage(message: MessageView, senderId: string): void {
    if (message.sender.isAi) return;
    this.track(
      (async () => {
        const persona = await this.deps.personas.directPersona(message.conversationId, senderId);
        if (!persona) return;
        await this.countForMemory(persona.id, senderId);
        this.schedule(message.conversationId, persona, senderId);
      })(),
    );
  }

  /** Espera os timers e as respostas em andamento (usado nos testes). */
  async idle(): Promise<void> {
    while (this.pending.size || this.timers.size) {
      await Promise.allSettled([...this.pending]);
      if (this.timers.size) await new Promise((r) => setTimeout(r, 5));
    }
  }

  close(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this.abort.abort();
  }

  private track(p: Promise<unknown>) {
    const tracked = p.catch((err) => this.deps.log?.(`[persona] erro: ${err instanceof Error ? err.message : String(err)}`));
    this.pending.add(tracked);
    void tracked.finally(() => this.pending.delete(tracked));
  }

  private schedule(conversationId: string, persona: PersonaProfile, contactId: string) {
    clearTimeout(this.timers.get(conversationId));
    this.timers.set(
      conversationId,
      setTimeout(() => {
        this.timers.delete(conversationId);
        this.track(this.run(conversationId, persona, contactId));
      }, this.deps.debounceMs ?? 1500),
    );
  }

  private async countForMemory(personaId: string, contactId: string) {
    if (await this.deps.personas.countMessage(personaId, contactId, MEMORY_EVERY)) {
      await this.deps.queue.send(QUEUES.personaMemory, { personaId, contactId });
    }
  }

  private async run(conversationId: string, persona: PersonaProfile, contactId: string): Promise<void> {
    // Uma resposta por vez em cada conversa; a que está rodando confere no fim se chegou mensagem nova.
    if (this.running.has(conversationId)) return;
    this.running.add(conversationId);
    try {
      for (let round = 0; round < 3; round++) {
        const history = await this.deps.chat.listMessages(persona.id, conversationId, null, HISTORY);
        const last = history?.at(-1);
        if (!history || !last || last.sender.nickname === persona.nickname || this.abort.signal.aborted) return;
        await this.reply(conversationId, persona, contactId, last.sender.nickname, history);
      }
    } finally {
      this.running.delete(conversationId);
    }
  }

  private async reply(conversationId: string, persona: PersonaProfile, contactId: string, contact: string, history: MessageView[]) {
    const { chat, hub } = this.deps;
    const members = await chat.memberIds(conversationId);
    const who = { conversationId, nickname: persona.nickname };
    hub.send(members, { type: "typing", ...who });
    const replyId = randomUUID();
    let lastDraft = 0;
    try {
      const memory = await this.deps.personas.memory(persona.id, contactId);
      // Numa nova tentativa, o texto parcial recomeça no mesmo balão (mesmo replyId).
      const { text, rejected } = await generateReply(
        this.deps.generate,
        persona,
        contact,
        memory,
        history,
        (draft) => {
          const now = Date.now();
          if (!draft || now - lastDraft < (this.deps.draftMs ?? 150)) return;
          lastDraft = now;
          hub.send(members, { type: "draft", ...who, replyId, text: draft });
        },
        this.abort.signal,
      );
      for (const r of rejected) this.deps.log?.(`[persona] ${persona.nickname} repetiu ou copiou: ${r.slice(0, 120)}`);
      if (!text) throw new Error("resposta vazia, repetida ou copiada do exemplo");
      const sent = await chat.sendMessage(persona.id, conversationId, { text });
      if (typeof sent === "string") throw new Error(`não gravou a resposta (${sent})`);
      hub.send(sent.memberIds, { type: "message", message: sent.message });
      await this.countForMemory(persona.id, contactId);
    } catch (err) {
      if (this.abort.signal.aborted) return;
      hub.send(members, { type: "reply_failed", ...who });
      throw err;
    }
  }
}

export class PgPersonaChatStore implements PersonaChatStore {
  constructor(private readonly pool: Pool) {}

  async directPersona(conversationId: string, senderId: string) {
    const res = await this.pool.query<{ user_id: string; nickname: string; bio: string; tone: string; examples: string[]; config: { nome?: string } }>(
      `SELECT p.user_id, u.nickname, p.bio, p.tone, p.examples, p.config
         FROM conversations c
         JOIN conversation_members m ON m.conversation_id = c.id AND m.user_id <> $2
         JOIN personas p ON p.user_id = m.user_id
         JOIN users u ON u.id = p.user_id
         JOIN users s ON s.id = $2 AND NOT s.is_ai
        WHERE c.id = $1 AND c.type = 'direct'`,
      [conversationId, senderId],
    );
    const r = res.rows[0];
    return r ? { id: r.user_id, nickname: r.nickname, name: r.config.nome ?? r.nickname, bio: r.bio, tone: r.tone, examples: r.examples } : null;
  }

  async memory(personaId: string, contactId: string) {
    const res = await this.pool.query<{ summary: string }>(
      "SELECT summary FROM persona_memory WHERE persona_user_id = $1 AND contact_user_id = $2",
      [personaId, contactId],
    );
    return res.rows[0]?.summary ?? "";
  }

  async countMessage(personaId: string, contactId: string, every: number) {
    // Um comando só: soma, e zera quando chega a `every` (devolve se zerou).
    const res = await this.pool.query<{ due: boolean }>(
      `INSERT INTO persona_memory (persona_user_id, contact_user_id, pending_messages) VALUES ($1, $2, 1)
       ON CONFLICT (persona_user_id, contact_user_id) DO UPDATE
         SET pending_messages = CASE WHEN persona_memory.pending_messages + 1 >= $3 THEN 0 ELSE persona_memory.pending_messages + 1 END
       RETURNING pending_messages = 0 AS due`,
      [personaId, contactId, every],
    );
    return res.rows[0]?.due ?? false;
  }

  async overview() {
    const res = await this.pool.query<{ nickname: string; config: { nome?: string }; avatar: string | null; activity_level: number; last_hour: number }>(
      `SELECT u.nickname, p.config, u.avatar, p.activity_level,
              ((SELECT count(*) FROM comments c WHERE c.user_id = p.user_id AND c.created_at > now() - interval '1 hour')
             + (SELECT count(*) FROM messages m WHERE m.sender_id = p.user_id AND m.created_at > now() - interval '1 hour'))::int AS last_hour
         FROM personas p JOIN users u ON u.id = p.user_id
        ORDER BY u.nickname`,
    );
    return res.rows.map((r) => ({
      nickname: r.nickname,
      name: r.config.nome ?? r.nickname,
      avatarUrl: avatarUrl(r.avatar),
      activity: r.activity_level,
      lastHour: r.last_hour,
    }));
  }
}
