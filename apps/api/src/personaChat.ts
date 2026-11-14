import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { JobQueue } from "./app.js";
import type { ChatStore, MessageView } from "./chat.js";
import { isRepeatAbort, type ChatMessage } from "./ollama.js";
import { asksForVideo, decideChat, topicsIn, videoQuery, type ChatDecision } from "./personaJev.js";
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
  /** De 0 a 1, quanto ela interage (JEV); sem valor, 0,5. */
  activity?: number;
}

/** Vídeo do acervo achado pela busca (RAG) para a persona mandar. */
export interface VideoMatch {
  id: string;
  title: string | null;
  description: string | null;
  /** Cosseno entre a conversa e o vídeo. */
  similarity: number;
  /** Afinidade da persona com os tópicos do vídeo. */
  affinity: number;
  /** Quantos desvios-padrão a similaridade fica acima da média do acervo: o que separa assunto de ruído. */
  z: number;
  /** O vídeo tem um tópico citado na conversa ("receita" → comida). */
  topicMatch: boolean;
}

/** O vídeo que vai junto com a resposta, ou "nenhum" quando pediram e a busca não achou. */
export type VideoShare = Pick<VideoMatch, "title" | "description"> | "nenhum";

/** Decisão do JEV para o painel do dono. Nas mensagens não vai o texto: conversa de gente é privada. */
export interface DecisionView {
  nickname: string;
  name: string;
  trigger: "video" | "mensagem" | "tique";
  action: string;
  score: number;
  reasons: Record<string, unknown>;
  /** Título do vídeo (gatilhos vídeo e tique); null nas mensagens. */
  video: string | null;
  createdAt: string;
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
  /**
   * Vídeos aprovados mais parecidos com a conversa, sem os já mandados nela. Tópico citado (`topics`)
   * reforça; o gosto da persona só desempata.
   */
  findVideos(personaId: string, conversationId: string, embedding: number[], topics: string[], limit: number): Promise<VideoMatch[]>;
  /** Tópicos do acervo (para achar os citados na conversa). */
  topics(): Promise<{ slug: string; name: string }[]>;
  /** Grava a decisão do JEV diante da mensagem (uma por persona e mensagem). */
  saveDecision(personaId: string, messageId: string, decision: ChatDecision): Promise<void>;
  /** Últimas decisões de todas as personas, da mais nova para a mais antiga. */
  recentDecisions(limit: number): Promise<DecisionView[]>;
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
    return about ? `[mandou um vídeo: ${about}]` : "[mandou um vídeo sem título nem descrição: você não sabe o que tem nele]";
  }
  return m.text ?? "";
}

/** Prompt de chat: persona, memória do contato e as últimas mensagens (as da persona como assistant). */
/**
 * Frases de exemplo para "não achei o vídeo". O modelo pequeno só fala em primeira pessoa com uma
 * frase pronta (sem ela, diz "não achou"), e copia a frase inteira: por isso varia.
 */
const NOT_FOUND = ["procurei aqui e não achei nada disso", "dei uma olhada e não tem nada assim", "fucei tudo e não achei"];
/**
 * Idem para "achei": sem frase pronta, a pergunta "tem algum vídeo de receita?" puxa um "não vi
 * nenhum" logo antes do vídeo chegar (13 de 15 na bancada).
 */
const FOUND = ["achei um aqui", "tem sim, olha esse", "olha esse que eu achei"];

/** Título sem hashtags e enfeites ("COMIDA DE RUA * Pastel * … #shorts"), que confundem o modelo pequeno. */
export const promptTitle = (title: string | null) =>
  (title ?? "").replace(/#\S+/g, " ").replace(/[*|_~]+/g, " ").replace(/\s+/g, " ").trim() || "sem título";

export function buildChatMessages(
  persona: PersonaProfile,
  contact: string,
  memory: string,
  history: MessageView[],
  examples: string[] = persona.examples,
  /** Nova tentativa depois de uma resposta recusada por `badReply`: o prompt avisa. */
  retry = false,
  /** Vídeo que a persona vai mandar junto (RAG), ou "nenhum" quando pediram e não achou. */
  video?: VideoShare,
): ChatMessage[] {
  const share =
    video === "nenhum"
      ? `\n- @${contact} pediu um vídeo e não tem nenhum sobre isso aqui. Diga do seu jeito, numa frase, algo como "${NOT_FOUND[Math.floor(Math.random() * NOT_FOUND.length)]}".`
      : video
        ? `\n- Você achou um vídeo para @${contact} e vai mandar logo depois desta mensagem: "${promptTitle(video.title)}"${video.description ? ` (${video.description})` : ""}. Comece com algo como "${FOUND[Math.floor(Math.random() * FOUND.length)]}" e diga numa frase, do seu jeito, do que é o vídeo, sem inventar nada além do título e da descrição.`
        : "";
  const system = `Você é ${persona.name}, numa rede social brasileira de vídeos curtos, conversando por mensagem direta com @${contact}.
Quem você é (só você, não @${contact}): ${persona.bio}
Seu jeito de escrever: ${persona.tone}
O que você sabe de @${contact}: ${memory || "nada ainda, vocês estão começando a conversar agora."}

Mensagens que você mandou em OUTRAS conversas (só mostram o jeito de escrever):
${examples.map((e) => `- ${e}`).join("\n")}

Regras:
- Responda à última mensagem como numa conversa de celular: de uma a três frases curtas.
- Escreva sempre em português do Brasil, mesmo que @${contact} escreva em outra língua.
- Nunca repita o que @${contact} escreveu. Se for uma pergunta, responda com a sua opinião.
- Você é uma pessoa da rede, não um assistente: não ofereça ajuda nem diga "estou aqui se precisar".
- Copie o jeito das frases acima, nunca o assunto.
- Não invente fatos sobre você nem sobre @${contact}, nem o que aparece num vídeo além do título e da descrição. Se não souber, pergunte.
- Não fale de fim do mundo, apocalipse nem bunker, a não ser que @${contact} puxe o assunto.
- Escreva só a sua mensagem, sem o seu nome na frente e sem aspas.${share}${
    retry
      ? "\n\nAviso só para você (não fale dele na resposta): sua resposta anterior foi descartada (repetia a mensagem, copiava uma frase, repetia palavras sem parar ou não estava em português). Escreva outra, com suas palavras."
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

const TITLE_FILLER = new Set(["video", "apresentado", "aqui", "vai", "um", "esse", "este", "o", "segue"]);

/**
 * A "apresentação" só repete o título ("Vídeo: Shorts in Minecraft #shorts"), o que o modelo pequeno
 * faz muito. O cartão do vídeo já mostra o título, então o texto não vai.
 */
export function onlyTitle(text: string, title: string | null): boolean {
  if (!title) return false;
  const words = normalize(text).filter((w) => !TITLE_FILLER.has(w));
  const inTitle = new Set(normalize(title));
  return words.length > 0 && words.every((w) => inTitle.has(w));
}

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

/**
 * Por que a resposta não serve. As graves (vazia, eco, gagueira) nunca são mandadas; as leves
 * (cópia de exemplo, inglês) são mandadas se nenhuma tentativa sair melhor: é pior a persona ficar muda.
 */
export type ReplyProblem = "vazia" | "eco" | "gagueira" | "cópia" | "inglês";
const SOFT: ReadonlySet<ReplyProblem> = new Set(["cópia", "inglês"]);

export function replyProblem(text: string, examples: string[], history: MessageView[]): ReplyProblem | null {
  const words = normalize(text);
  if (words.length === 0) return "vazia";
  const last = history.at(-1);
  if (last) {
    const said = normalize(messageLine(last)).join(" ");
    if (said && said === words.join(" ")) return "eco";
  }
  if (stutters(words)) return "gagueira";
  const talk = talkWords(history);
  if (examples.some((ex) => copies(words, ex, talk))) return "cópia";
  if (english(words)) return "inglês";
  return null;
}

export const badReply = (text: string, examples: string[], history: MessageView[]) => replyProblem(text, examples, history) !== null;

/**
 * Gagueira do modelo: a mesma palavra 3 vezes seguidas ("sou sou sou"), o mesmo par 3 vezes
 * seguidas ("sou eu sou eu sou eu") ou muitas palavras e quase nenhuma diferente.
 */
function stutters(words: string[]): boolean {
  if (words.length >= 8 && new Set(words).size / words.length < 0.4) return true;
  for (let i = 0; i + 2 < words.length; i++) {
    if (words[i] === words[i + 1] && words[i] === words[i + 2]) return true;
  }
  for (let i = 0; i + 5 < words.length; i++) {
    const pair = `${words[i]} ${words[i + 1]}`;
    if (pair === `${words[i + 2]} ${words[i + 3]}` && pair === `${words[i + 4]} ${words[i + 5]}`) return true;
  }
  return false;
}

const ENGLISH = new Set(["the", "you", "your", "yes", "hello", "how", "can", "help", "what", "speak", "english", "today", "there", "i", "it", "is", "are", "with", "and", "of", "to"]);
/** Resposta em inglês: pelo menos 3 palavras comuns do inglês e um terço do texto. */
const english = (words: string[]) => {
  const en = words.filter((w) => ENGLISH.has(w)).length;
  return en >= 3 && en / words.length >= 1 / 3;
};

/** Marca, em `rejected`, a tentativa que o Ollama cortou por repetição sem fim. */
export const LOOPED = "(repetiu sem parar)";

/** Tentativas de gerar uma resposta que passe em `replyProblem`. */
export const REPLY_ATTEMPTS = 3;

/** Gera a resposta em streaming; `onText` recebe o texto acumulado. */
export type ChatGenerator = (messages: ChatMessage[], stop: string[], onText: (full: string) => void, signal: AbortSignal) => Promise<string>;

/** Opções do Ollama no chat: respostas curtas, com um pouco de variação (as paradas vêm de `stopWords`). */
export const CHAT_OPTIONS = { temperature: 0.8, num_predict: 150, num_ctx: 4096 };

/**
 * Gera a resposta da persona até ela passar em `replyProblem` (no máximo REPLY_ATTEMPTS vezes).
 * Se nenhuma servir, manda a última com problema leve; `text` fica "" quando só houve problema grave.
 * `rejected` guarda as recusadas, em ordem.
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
  opts: ReplyOptions = {},
): Promise<{ text: string; rejected: string[] }> {
  const { video } = opts;
  const rejected: string[] = [];
  let fallback = "";
  const talk = talkWords(history);
  for (let attempt = 0; attempt < REPLY_ATTEMPTS; attempt++) {
    // Exemplos sorteados de novo a cada tentativa, sem os que já foram copiados (o modelo insiste neles).
    const fresh = persona.examples.filter((ex) => !rejected.some((r) => copies(normalize(r), ex, talk)));
    const examples = pickExamples(fresh);
    const retry = rejected.length > 0;
    const prompt = opts.build ? opts.build(examples, retry) : buildChatMessages(persona, contact, memory, history, examples, retry, video);
    let raw: string;
    try {
      raw = await generate(prompt, opts.stop ?? stopWords(contact), (full) => onDraft(cleanReply(full, persona)), signal);
    } catch (err) {
      // Repetição sem fim conta como tentativa recusada; outros erros (Ollama fora) sobem.
      if (!isRepeatAbort(err)) throw err;
      rejected.push(LOOPED);
      continue;
    }
    const text = cleanReply(raw, persona);
    const problem = replyProblem(text, persona.examples, history);
    if (!problem) return { text, rejected };
    if (SOFT.has(problem)) fallback = text;
    rejected.push(text.slice(0, 200));
  }
  return { text: fallback, rejected };
}

export interface ReplyOptions {
  /** Vídeo que a persona vai mandar junto (RAG), ou "nenhum" quando pediram e não achou. */
  video?: VideoShare;
  /** Outro prompt (grupo) no lugar do de conversa direta, com os exemplos sorteados e o aviso de nova tentativa. */
  build?: (examples: string[], retry: boolean) => ChatMessage[];
  /** Paradas no lugar de `stopWords(contact)`. */
  stop?: string[];
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
  /** Embedding de busca (RAG); sem ele, a persona não manda vídeos. */
  embed?: (text: string) => Promise<number[]>;
  /** Sorteio (0 a 1); substituível nos testes. */
  random?: () => number;
  log?: (msg: string) => void;
  /** Mensagem de gente que não é para uma persona em conversa direta (grupo, conversa entre pessoas). */
  onOtherMessage?: (message: MessageView, senderId: string) => Promise<void> | void;
}

/**
 * Destaque (desvios-padrão acima da média do acervo) para a busca valer. As similaridades do
 * nomic-embed-text ficam todas perto umas das outras (0,4 a 0,7), então o valor absoluto não separa
 * assunto de ruído; o destaque separa melhor. Calibrado com avaliar:rag:
 * - pedido com tópico citado ("vídeo de receita") vai o melhor do tópico; sem tópico ("vídeo de
 *   tricô") só vai com destaque forte, senão a persona diz que não achou;
 * - sem pedido, só com destaque forte, ou tópico citado e destaque médio (bolo → receita de cookie).
 */
export const RAG = { strongZ: 2.5, topicZ: 1.5 };

/** O vídeo serve para mandar (pedido ou espontâneo). */
export const goodMatch = (m: VideoMatch, asked: boolean) =>
  m.z >= RAG.strongZ || (m.topicMatch && (asked || m.z >= RAG.topicZ));

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
        if (!persona) return this.deps.onOtherMessage?.(message, senderId);
        await this.countForMemory(persona.id, senderId);
        this.schedule(message.conversationId, persona, senderId);
      })(),
    );
  }

  /** Tem resposta para gente esperando ou em andamento: as conversas entre personas esperam (SPEC 7.5). */
  busy(): boolean {
    return this.timers.size > 0 || this.running.size > 0;
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

  private async react(persona: PersonaProfile, conversationId: string, messageId: string, emoji: string) {
    const result = await this.deps.chat.setReaction(persona.id, conversationId, messageId, emoji);
    if (result) this.deps.hub.send(result.memberIds, { type: "reaction", conversationId, messageId, reactions: result.reactions });
  }

  /** RAG: busca no acervo pela última mensagem (pedido) ou pelas últimas falas da pessoa (sem pedido). */
  private async pickVideo(persona: PersonaProfile, conversationId: string, history: MessageView[], asked: boolean): Promise<VideoMatch | null> {
    if (!this.deps.embed) return null;
    const theirs = history.filter((m) => m.sender.nickname !== persona.nickname && m.text).map((m) => m.text!);
    // Pedido com assunto ("vídeo de gato") busca só o assunto; pedido vago ou conversa, as últimas falas.
    const subject = asked ? videoQuery(theirs.at(-1)!) : "";
    const query = subject || theirs.slice(-3).join("\n");
    try {
      const topics = topicsIn(query, await this.deps.personas.topics());
      const matches = await this.deps.personas.findVideos(persona.id, conversationId, await this.deps.embed(`search_query: ${query}`), topics, 3);
      const good = matches.filter((m) => goodMatch(m, asked));
      if (asked) return good[0] ?? null;
      return good.length ? good[Math.floor((this.deps.random ?? Math.random)() * good.length)]! : null;
    } catch (err) {
      // Sem a busca, a persona responde sem vídeo.
      this.deps.log?.(`[persona] busca de vídeo falhou: ${err instanceof Error ? err.message : String(err)}`);
      return null;
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
      const last = history.at(-1)!;
      const lastText = last.text ?? "";
      const decision = decideChat(persona.activity ?? 0.5, lastText, chatContext(persona, history), this.deps.random);
      if (decision.react) await this.react(persona, conversationId, last.id, decision.react);
      const asked = decision.reasons.pediu_video === true;
      const match = decision.action === "enviar_video" ? await this.pickVideo(persona, conversationId, history, asked) : null;
      const video: VideoShare | undefined = match ?? (asked && this.deps.embed ? "nenhum" : undefined);
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
        { video },
      );
      for (const r of rejected) this.deps.log?.(`[persona] ${persona.nickname} repetiu ou copiou: ${r.slice(0, 120)}`);
      if (!text) throw new Error("resposta vazia, repetida ou copiada do exemplo");
      // Texto que só repete o título do vídeo não vai: o vídeo sozinho já é a resposta.
      if (!match || !onlyTitle(text, match.title)) {
        const sent = await chat.sendMessage(persona.id, conversationId, { text });
        if (typeof sent === "string") throw new Error(`não gravou a resposta (${sent})`);
        hub.send(sent.memberIds, { type: "message", message: sent.message });
      }
      if (match) {
        const shared = await chat.sendMessage(persona.id, conversationId, { videoId: match.id });
        if (typeof shared === "string") this.deps.log?.(`[persona] ${persona.nickname} não mandou o vídeo (${shared})`);
        else hub.send(shared.memberIds, { type: "message", message: shared.message });
      }
      await this.countForMemory(persona.id, contactId);
      const final: ChatDecision = match
        ? { ...decision, reasons: { ...decision.reasons, video: match.title ?? "sem título", similaridade: round2(match.similarity), destaque: round2(match.z), topico_citado: match.topicMatch } }
        : { ...decision, action: "responder", reasons: { ...decision.reasons, ...(decision.action === "enviar_video" ? { video: "nenhum" } : {}) } };
      await this.deps.personas.saveDecision(persona.id, last.id, final);
    } catch (err) {
      if (this.abort.signal.aborted) return;
      hub.send(members, { type: "reply_failed", ...who });
      throw err;
    }
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** O que o JEV do chat olha na conversa: pedido de vídeo, intervalo desde o último vídeo e assunto. */
export function chatContext(persona: PersonaProfile, history: MessageView[]) {
  const mine = history.filter((m) => m.sender.nickname === persona.nickname);
  const lastVideo = mine.findLastIndex((m) => m.type === "video");
  const sinceLastVideo = lastVideo < 0 ? mine.length : mine.length - lastVideo - 1;
  const theirs = history.filter((m) => m.sender.nickname !== persona.nickname && m.text).slice(-3);
  const words = theirs.reduce((n, m) => n + (m.text!.match(/[\p{L}\p{N}]+/gu)?.length ?? 0), 0);
  return { asked: asksForVideo(history.at(-1)?.text ?? ""), sinceLastVideo, words };
}

export class PgPersonaChatStore implements PersonaChatStore {
  constructor(private readonly pool: Pool) {}

  async directPersona(conversationId: string, senderId: string) {
    const res = await this.pool.query<{
      user_id: string;
      nickname: string;
      bio: string;
      tone: string;
      examples: string[];
      activity_level: number;
      config: { nome?: string };
    }>(
      `SELECT p.user_id, u.nickname, p.bio, p.tone, p.examples, p.activity_level, p.config
         FROM conversations c
         JOIN conversation_members m ON m.conversation_id = c.id AND m.user_id <> $2
         JOIN personas p ON p.user_id = m.user_id
         JOIN users u ON u.id = p.user_id
         JOIN users s ON s.id = $2 AND NOT s.is_ai
        WHERE c.id = $1 AND c.type = 'direct'`,
      [conversationId, senderId],
    );
    const r = res.rows[0];
    return r
      ? { id: r.user_id, nickname: r.nickname, name: r.config.nome ?? r.nickname, bio: r.bio, tone: r.tone, examples: r.examples, activity: r.activity_level }
      : null;
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

  async findVideos(personaId: string, conversationId: string, embedding: number[], topics: string[], limit: number) {
    // A conversa manda: quem pediu vídeo de gato quer gato, mesmo do Rato. Tópico citado reforça (+0,1);
    // o gosto da persona só desempata (0,05 × afinidade). O destaque (z) compara com o acervo inteiro.
    const res = await this.pool.query<VideoMatch>(
      `WITH scored AS (
         SELECT v.id, v.title, v.description,
                (1 - (v.embedding <=> $3::vector))::float8 AS similarity,
                COALESCE(avg(COALESCE((p.config->'afinidade'->>t.slug)::float8, 0.3)), 0.3)::float8 AS affinity,
                COALESCE(bool_or(t.slug = ANY($4::text[])), false) AS "topicMatch"
           FROM videos v
           JOIN personas p ON p.user_id = $1
           LEFT JOIN video_topics vt ON vt.video_id = v.id
           LEFT JOIN topics t ON t.id = vt.topic_id
          WHERE v.status = 'aprovado' AND v.embedding IS NOT NULL
          GROUP BY v.id
       ), ranked AS (
         SELECT s.*, ((s.similarity - avg(s.similarity) OVER ()) / NULLIF(stddev_pop(s.similarity) OVER (), 0))::float8 AS z
           FROM scored s
       )
       SELECT r.id, r.title, r.description, r.similarity, r.affinity, r."topicMatch", COALESCE(r.z, 0)::float8 AS z
         FROM ranked r JOIN videos v ON v.id = r.id
        WHERE v.file_path IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = $2 AND m.video_id = r.id)
        ORDER BY r.similarity + CASE WHEN r."topicMatch" THEN 0.1 ELSE 0 END + 0.05 * r.affinity DESC
        LIMIT $5`,
      [personaId, conversationId, `[${embedding.join(",")}]`, topics, limit],
    );
    return res.rows;
  }

  async topics() {
    return (await this.pool.query<{ slug: string; name: string }>("SELECT slug, name FROM topics")).rows;
  }

  async saveDecision(personaId: string, messageId: string, decision: ChatDecision) {
    await this.pool.query(
      `INSERT INTO persona_decisions (persona_user_id, trigger, target_id, action, score, reasons)
       VALUES ($1, 'mensagem', $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
      [personaId, messageId, decision.action, decision.score, JSON.stringify(decision.reasons)],
    );
  }

  async recentDecisions(limit: number) {
    const res = await this.pool.query<{
      nickname: string;
      config: { nome?: string };
      trigger: "video" | "mensagem" | "tique";
      action: string;
      score: number;
      reasons: Record<string, unknown>;
      video: string | null;
      created_at: Date;
    }>(
      `SELECT u.nickname, p.config, d.trigger, d.action, d.score, d.reasons, d.created_at,
              CASE WHEN d.trigger = 'video' THEN (SELECT COALESCE(v.title, 'sem título') FROM videos v WHERE v.id = d.target_id)
                   WHEN d.trigger = 'tique' THEN (SELECT COALESCE(v.title, 'sem título') FROM messages m JOIN videos v ON v.id = m.video_id WHERE m.id = d.target_id) END AS video
         FROM persona_decisions d
         JOIN users u ON u.id = d.persona_user_id
         JOIN personas p ON p.user_id = d.persona_user_id
        ORDER BY d.created_at DESC, d.id DESC
        LIMIT $1`,
      [limit],
    );
    return res.rows.map((r) => ({
      nickname: r.nickname,
      name: r.config.nome ?? r.nickname,
      trigger: r.trigger,
      action: r.action,
      score: r.score,
      reasons: r.reasons,
      video: r.video,
      createdAt: r.created_at.toISOString(),
    }));
  }
}
