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

/**
 * Grupo do Bunker. Uma mensagem de gente (ou o vídeo que uma persona mandou) chama até duas personas;
 * a fala de uma persona pode chamar outra (cadeia), com chance menor a cada nível, e a conversa
 * sempre acaba: no nível 3 ninguém responde e, a partir de uma mensagem, no máximo `maxChain` falas.
 */
export const GROUP_JEV = {
  maxReplies: 2,
  commentAt: 0.6,
  reactAt: 0.45,
  chance: 0.3,
  unknownAffinity: 0.3,
  /** Chance de a cadeia seguir, por nível: resposta à mensagem, à persona, à resposta; depois, ninguém. */
  chain: [1, 0.5, 0.2],
  /** Falas de persona, no máximo, a partir da mesma mensagem (contando todos os níveis). */
  maxChain: 4,
  /** Quem foi citado (@apelido ou pelo nome) ganha isto na nota. */
  mentionBonus: 0.35,
  /** Chance mínima de a cadeia seguir quando a fala cita alguém. */
  mentionChain: 0.7,
  /** Quem acabou de receber a resposta ganha isto na nota (ida e volta). */
  replyBonus: 0.15,
  /** Cansaço: cada fala recente da persona no grupo tira isto da nota, até o teto. */
  recentPenalty: 0.08,
  maxRecentPenalty: 0.24,
  /** Sorteio pesado de quem responde: peso = nota elevada a isto (nota alta sai mais, sem monopólio). */
  lotteryPower: 2,
};

export interface GroupCandidateTaste {
  id: string;
  activity: number;
  /** Afinidade com os tópicos do vídeo mandado; null quando a mensagem é texto. */
  affinity: number | null;
  /** Multiplicador do ritmo na hora atual (ritmo.ts); 1 quando falta. */
  rhythm?: number;
  /** A mensagem cita esta persona. */
  mentioned?: boolean;
  /** A mensagem é uma resposta a esta persona. */
  repliedTo?: boolean;
  /** Falas dela entre as mensagens recentes do grupo (cansaço). */
  recent?: number;
}

export interface GroupContext {
  /** 0: mensagem que abriu a conversa; 1: fala de persona respondendo a ela; e assim por diante. */
  depth: number;
  /** A mensagem é de gente (quem foi citado responde quase sempre). */
  fromHuman: boolean;
}

export interface GroupDecision {
  id: string;
  action: "comentar" | "reagir" | "ignorar";
  score: number;
  reasons: Record<string, number | string | boolean>;
}

/**
 * Quem responde no Grupo do Bunker. Nota = (0,5 × atividade + 0,4 × afinidade) × ritmo + acaso
 * (±0,15) + bônus de citação e de ida e volta − cansaço. Reage a partir de 0,45.
 * - Mensagem que abre a conversa: comentam as duas maiores notas a partir de 0,6; quem gente citou
 *   comenta mesmo com nota baixa. Se é de gente e ninguém chegou, uma persona responde mesmo assim,
 *   sorteada pela nota (ninguém fala sozinho no grupo; o ritmo decide quem aparece).
 * - Cadeia: um sorteio com a chance do nível decide se alguém ainda fala; se sim, uma persona,
 *   sorteada pela nota.
 */
export function decideGroup(
  candidates: GroupCandidateTaste[],
  random: () => number = Math.random,
  ctx: GroupContext = { depth: 0, fromHuman: true },
): GroupDecision[] {
  const scored = candidates.map((c) => {
    const affinity = c.affinity ?? GROUP_JEV.unknownAffinity;
    const rhythm = c.rhythm ?? 1;
    const acaso = round((random() - 0.5) * GROUP_JEV.chance);
    const bonus = (c.mentioned ? GROUP_JEV.mentionBonus : 0) + (c.repliedTo ? GROUP_JEV.replyBonus : 0);
    const tired = Math.min(GROUP_JEV.maxRecentPenalty, (c.recent ?? 0) * GROUP_JEV.recentPenalty);
    const score = round((0.5 * c.activity + 0.4 * affinity) * rhythm + acaso + bonus - tired);
    const reasons: GroupDecision["reasons"] = { atividade: c.activity, afinidade: round(affinity), acaso };
    if (rhythm !== 1) reasons.ritmo = rhythm;
    if (c.mentioned) reasons.mencao = true;
    if (c.repliedTo) reasons.resposta = true;
    if (tired) reasons.cansaco = round(-tired);
    if (ctx.depth > 0) reasons.nivel = ctx.depth;
    return { c, score, reasons };
  });
  type Scored = (typeof scored)[number];
  /** Uma persona sorteada com peso pela nota (quem tem nota maior sai mais). */
  const lottery = (pool: Scored[]): Scored | null => {
    const weight = (s: Scored) => Math.max(0.01, s.score) ** GROUP_JEV.lotteryPower;
    let roll = random() * pool.reduce((sum, s) => sum + weight(s), 0);
    for (const s of pool) {
      roll -= weight(s);
      if (roll < 0) return s;
    }
    return pool.at(-1) ?? null;
  };
  const commenters = new Set<string>();
  if (ctx.depth === 0) {
    const forced = (s: Scored) => ctx.fromHuman && s.c.mentioned === true;
    scored
      .filter((s) => forced(s) || s.score >= GROUP_JEV.commentAt)
      .sort((a, b) => Number(forced(b)) - Number(forced(a)) || b.score - a.score)
      .slice(0, GROUP_JEV.maxReplies)
      .forEach((s) => commenters.add(s.c.id));
    if (ctx.fromHuman && commenters.size === 0) {
      const picked = lottery(scored);
      if (picked) {
        commenters.add(picked.c.id);
        picked.reasons.resposta_garantida = true;
      }
    }
  } else {
    // Cadeia: quanto mais funda, menor a chance de alguém ainda responder (citar alguém ajuda).
    const base = GROUP_JEV.chain[ctx.depth] ?? 0;
    const chance = base > 0 && candidates.some((c) => c.mentioned) ? Math.max(base, GROUP_JEV.mentionChain) : base;
    if (chance > 0 && random() < chance) {
      const picked = lottery(scored);
      if (picked) commenters.add(picked.c.id);
    }
  }
  return scored.map(({ c, score, reasons }) => ({
    id: c.id,
    action: commenters.has(c.id) ? "comentar" : score >= GROUP_JEV.reactAt ? "reagir" : "ignorar",
    score,
    reasons,
  }));
}

const foldText = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Palavras do nome que não identificam ninguém ("Dona Neide" → só "neide"). */
const TITLES = new Set(["dona", "tio", "tia", "seu", "senhor", "senhora"]);

/**
 * Personas citadas no texto: pelo @apelido, pelo apelido ou por uma palavra do nome ("Neide",
 * "Capitão", "Valdir"). Devolve os ids.
 */
export function mentionsIn(text: string, personas: { id: string; nickname: string; name: string }[]): string[] {
  const folded = foldText(text);
  const words = new Set(folded.match(/[a-z0-9_]+/g) ?? []);
  return personas
    .filter((p) => {
      const nick = foldText(p.nickname);
      if (words.has(nick) || words.has(nick.replace(/_/g, ""))) return true;
      return (foldText(p.name).match(/[a-z0-9]+/g) ?? []).some((w) => w.length >= 4 && !TITLES.has(w) && words.has(w));
    })
    .map((p) => p.id);
}

/**
 * Pausa até a próxima fala entre personas, com cauda longa e teto baixo: quase sempre de 1/4 da
 * média até a média (10 a 40 s com PERSONA_TALK_DELAY=40); às vezes de 1 a 3 min; raramente de 3 a
 * 5 min. Nunca horas: o legal é ver as conversas acontecendo.
 */
export const PAUSE = {
  bands: [
    { upTo: 0.8, from: 0.25, to: 1 },
    { upTo: 0.95, from: 1.5, to: 4.5 },
    { upTo: 1, from: 4.5, to: 7.5 },
  ],
};

export function talkPause(base: number, random: () => number = Math.random): number {
  const roll = random();
  const band = PAUSE.bands.find((b) => roll < b.upTo) ?? PAUSE.bands.at(-1)!;
  return Math.max(1, Math.round(base * (band.from + (band.to - band.from) * random())));
}

/** Pausa curta (faixa rápida), para quem responde a gente no grupo: ninguém fica esperando. */
export function quickPause(base: number, random: () => number = Math.random): number {
  const band = PAUSE.bands[0]!;
  return Math.max(1, Math.round(base * (band.from + (band.to - band.from) * random())));
}
