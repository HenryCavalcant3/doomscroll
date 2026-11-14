/**
 * JEV no chat (SPEC 7.4): diante de uma mensagem de uma pessoa, a persona sempre responde (tem gente
 * esperando), e o JEV decide se ela também manda um vídeo do acervo (RAG) e se reage à mensagem.
 * A decisão diante de um vídeo aprovado fica no worker (apps/worker/src/jev.ts).
 */

export type ChatAction = "responder" | "enviar_video";

export interface ChatDecision {
  action: ChatAction;
  /** Emoji da reação à mensagem, quando reage. */
  react: string | null;
  score: number;
  reasons: Record<string, number | string | boolean>;
}

export interface ChatContext {
  /** A pessoa pediu um vídeo ("me manda um vídeo de gato"). */
  asked: boolean;
  /** Mensagens da persona desde o último vídeo que ela mandou nesta conversa (ou desde o começo). */
  sinceLastVideo: number;
  /** Palavras nas últimas mensagens da pessoa: conversa com assunto para buscar um vídeo. */
  words: number;
}

export const CHAT_JEV = {
  /** Chance de mandar vídeo sem pedido, quando a conversa permite (decisão c da fase 3). */
  spontaneousChance: 0.1,
  /** Mensagens da persona entre um vídeo mandado sem pedido e o próximo. */
  minGap: 5,
  /** Palavras mínimas nas últimas mensagens da pessoa para mandar vídeo sem pedido. */
  minWords: 8,
  /** Chance de reagir = atividade × isto (Tio Valdir reage bastante, o Rato quase nunca). */
  reactPerActivity: 0.35,
};

/** Pedido de vídeo: "me manda um vídeo", "tem algum vídeo de gato?", "recomenda algo pra rir". */
const ASKS = /\b(manda|mande|me (mostra|passa)|mostra|recomenda|indica|sugere|tem (algum|algo|um)|conhece (algum|um))\b.*\b(v[ií]deo|algo|alguma coisa|coisa)\b|\bv[ií]deo (de|sobre|pra|para)\b/i;

export const asksForVideo = (text: string) => ASKS.test(text);

const SAD = /trist|p[ée]ssim|chorei|chorando|morreu|faleceu|saudade|cansad|doente|sozinh|ansios|deprimid|😢|😭|💔/i;
const FUNNY = /k{3,}|haha|rsrs|😂|🤣|engra[çc]ad/i;
const LOVE = /\bamo\b|lind|fofo|❤|obrigad|valeu|parab[ée]ns/i;

/** Reação que combina com a mensagem: nada de 😂 para quem diz que está triste. */
export function reactionFor(text: string, random: () => number = Math.random): string {
  if (SAD.test(text)) return random() < 0.5 ? "😢" : "❤️";
  if (FUNNY.test(text)) return "😂";
  if (LOVE.test(text)) return "❤️";
  const neutral = ["👍", "🔥", "❤️"];
  return neutral[Math.floor(random() * neutral.length)]!;
}

export function decideChat(activity: number, lastText: string, ctx: ChatContext, random: () => number = Math.random): ChatDecision {
  const reactRoll = random();
  const reactChance = activity * CHAT_JEV.reactPerActivity;
  const react = reactRoll < reactChance ? reactionFor(lastText, random) : null;
  const canSpontaneous = ctx.sinceLastVideo >= CHAT_JEV.minGap && ctx.words >= CHAT_JEV.minWords;
  const videoRoll = random();
  const spontaneous = canSpontaneous && videoRoll < CHAT_JEV.spontaneousChance;
  const action: ChatAction = ctx.asked || spontaneous ? "enviar_video" : "responder";
  return {
    action,
    react,
    score: ctx.asked ? 1 : round(videoRoll),
    reasons: {
      pediu_video: ctx.asked,
      atividade: activity,
      reacao: react ?? "nenhuma",
      desde_ultimo_video: ctx.sinceLastVideo,
      palavras: ctx.words,
      ...(ctx.asked ? {} : { acaso: round(videoRoll) }),
    },
  };
}

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Palavras do pedido em si, que só atrapalham a busca ("me manda um vídeo de" gato). */
const REQUEST_WORDS = new Set(
  "me manda mande mandar mostra mostrar passa recomenda indica sugere tem algum alguma algo um uma uns umas video videos de do da sobre pra para quero queria ver coisa coisas ai la ae favor por pfv o a os as e com que mais outro outra legal bom boa".split(" "),
);

/** O assunto do pedido: "me manda um vídeo de gato" → "gato" ("" quando só pediu um vídeo qualquer). */
export function videoQuery(text: string): string {
  return (fold(text).match(/[a-z0-9]+/g) ?? []).filter((w) => !REQUEST_WORDS.has(w)).join(" ");
}

/**
 * Palavras que apontam para os tópicos padrão do acervo ("receita" → comida). Tópico criado pelo
 * dono também conta pelo próprio slug e nome. Serve de reforço para a busca vetorial, que sozinha
 * separa pouco os assuntos.
 */
const TOPIC_WORDS: Record<string, string[]> = {
  animais: ["animal", "animais", "bicho", "bichos", "gato", "gatos", "gatinho", "cachorro", "cachorros", "cachorrinho", "cao", "pet", "pets"],
  comida: ["comida", "receita", "receitas", "bolo", "doce", "pizza", "cozinha", "cozinhar", "lanche", "chocolate"],
  humor: ["rir", "risada", "engracado", "engracada", "piada", "comedia", "zoeira", "meme"],
  esporte: ["esporte", "futebol", "gol", "golaco", "time", "treino", "treinar", "academia", "volei", "basquete"],
  musica: ["musica", "musicas", "cantar", "cantando", "cancao", "violao", "show", "banda", "sertanejo"],
  games: ["game", "games", "videogame", "minecraft", "pokemon", "gta"],
  ciencia: ["ciencia", "espaco", "dinossauro", "dinossauros", "curiosidade", "curiosidades", "planeta"],
  noticias: ["noticia", "noticias", "jornal"],
  politica: ["politica", "senado", "eleicao", "deputado", "governo"],
  fofoca: ["fofoca", "famoso", "famosos", "celebridade"],
  dicas: ["dica", "dicas", "truque", "truques"],
};

/** Slugs de tópico citados no texto, entre os que existem no acervo. */
export function topicsIn(text: string, topics: { slug: string; name: string }[]): string[] {
  const words = new Set(fold(text).match(/[a-z0-9]+/g) ?? []);
  return topics
    .filter((t) => words.has(t.slug) || words.has(fold(t.name)) || (TOPIC_WORDS[t.slug] ?? []).some((w) => words.has(w)))
    .map((t) => t.slug);
}

/**
 * JEV das personas entre si (SPEC 7.5). Toda conversa nasce de um vídeo mandado pelo agendador;
 * depois cada fala é uma decisão: responder ou deixar quieto. De 3 a 6 mensagens, depois silêncio.
 */
export const TALK_JEV = {
  minMessages: 3,
  maxMessages: 6,
  /** Chance de seguir depois do mínimo: base + atividade × peso − por mensagem a mais. */
  keepGoing: 0.3,
  perActivity: 0.4,
  perExtra: 0.15,
  reactPerActivity: 0.35,
};

export interface TalkDecision {
  action: "responder" | "ignorar";
  react: string | null;
  score: number;
  reasons: Record<string, number | string | boolean>;
}

const round = (n: number) => Math.round(n * 100) / 100;

/** `messages`: quantas mensagens a conversa já tem desde o vídeo que a começou (o vídeo conta). */
export function decideTalk(activity: number, messages: number, lastText: string, random: () => number = Math.random): TalkDecision {
  const react = random() < activity * TALK_JEV.reactPerActivity ? reactionFor(lastText, random) : null;
  const chance =
    messages >= TALK_JEV.maxMessages
      ? 0
      : messages < TALK_JEV.minMessages
        ? 1
        : TALK_JEV.keepGoing + TALK_JEV.perActivity * activity - TALK_JEV.perExtra * (messages - TALK_JEV.minMessages);
  const roll = random();
  return {
    action: roll < chance ? "responder" : "ignorar",
    react,
    score: round(chance),
    reasons: { mensagens: messages, atividade: activity, chance: round(Math.max(0, chance)), acaso: round(roll), reacao: react ?? "nenhuma" },
  };
}

/** No Grupo do Bunker, no máximo isto de personas responde a cada mensagem de gente. */
export const GROUP_JEV = { maxReplies: 2, commentAt: 0.6, reactAt: 0.45, chance: 0.3, unknownAffinity: 0.3 };

export interface GroupCandidateTaste {
  id: string;
  activity: number;
  /** Afinidade com os tópicos do vídeo mandado; null quando a mensagem é texto. */
  affinity: number | null;
}

export interface GroupDecision {
  id: string;
  action: "comentar" | "reagir" | "ignorar";
  score: number;
  reasons: Record<string, number | string | boolean>;
}

/**
 * Quem responde a uma mensagem de gente no Grupo do Bunker: nota = 0,5 × atividade + 0,4 ×
 * afinidade + acaso (±0,15). Comenta a partir de 0,6 (só as duas maiores notas), reage a partir de 0,45.
 */
export function decideGroup(candidates: GroupCandidateTaste[], random: () => number = Math.random): GroupDecision[] {
  const scored = candidates.map((c) => {
    const affinity = c.affinity ?? GROUP_JEV.unknownAffinity;
    const acaso = round((random() - 0.5) * GROUP_JEV.chance);
    const score = round(0.5 * c.activity + 0.4 * affinity + acaso);
    return { c, score, reasons: { atividade: c.activity, afinidade: round(affinity), acaso } };
  });
  const commenters = new Set(
    scored
      .filter((s) => s.score >= GROUP_JEV.commentAt)
      .sort((a, b) => b.score - a.score)
      .slice(0, GROUP_JEV.maxReplies)
      .map((s) => s.c.id),
  );
  return scored.map(({ c, score, reasons }) => ({
    id: c.id,
    action: commenters.has(c.id) ? "comentar" : score >= GROUP_JEV.reactAt ? "reagir" : "ignorar",
    score,
    reasons,
  }));
}
