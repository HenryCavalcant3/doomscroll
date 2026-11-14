/**
 * JEV, a decisão por pesos da persona (SPEC 7.4): combina a afinidade com os tópicos, o nível de
 * atividade, o tempo desde a última interação com aquele contato e o acaso. Aqui fica a decisão
 * diante de um vídeo aprovado: ignorar, curtir ou comentar (comentar também curte).
 */

import { rhythm } from "./ritmo.js";

/** O gosto da persona, do JSON dela (atividade e afinidade por slug de tópico). */
export interface PersonaTaste {
  activity: number;
  affinity: Record<string, number>;
}

export interface VideoContext {
  /** Slugs dos tópicos do vídeo. */
  topics: string[];
  /** Comentários recentes da persona em vídeos de quem cadastrou este (evita encher a mesma pessoa). */
  recentWithAuthor: number;
}

export type VideoAction = "ignorar" | "curtir" | "comentar";

export interface Decision<A extends string> {
  action: A;
  /** Nota final, de 0 a 1 (o acaso pode passar um pouco disso). */
  score: number;
  /** As parcelas da nota, para o painel do dono e a bancada. */
  reasons: Record<string, number | string | boolean>;
}

/** Pesos e limiares, calibrados com a bancada (pnpm --filter @doomscroll/worker avaliar:jev). */
export const JEV = {
  affinityWeight: 0.6,
  activityWeight: 0.4,
  /** Largura do acaso: soma de -chance/2 a +chance/2. */
  chance: 0.4,
  /** Afinidade com tópico que não está no JSON da persona (e vídeo sem tópico). */
  unknownAffinity: 0.3,
  recencyPenalty: 0.05,
  maxRecencyPenalty: 0.15,
  likeAt: 0.45,
  commentAt: 0.6,
};

const round = (n: number) => Math.round(n * 100) / 100;

/** Média da afinidade da persona com os tópicos do vídeo. */
export function topicAffinity(taste: PersonaTaste, topics: string[]): number {
  if (topics.length === 0) return JEV.unknownAffinity;
  const values = topics.map((t) => taste.affinity[t] ?? JEV.unknownAffinity);
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function decideVideo(taste: PersonaTaste, video: VideoContext, random: () => number = Math.random): Decision<VideoAction> {
  const affinity = topicAffinity(taste, video.topics);
  const chance = (random() - 0.5) * JEV.chance;
  const recency = Math.min(JEV.maxRecencyPenalty, video.recentWithAuthor * JEV.recencyPenalty);
  const score = JEV.affinityWeight * affinity + JEV.activityWeight * taste.activity + chance - recency;
  const action: VideoAction = score >= JEV.commentAt ? "comentar" : score >= JEV.likeAt ? "curtir" : "ignorar";
  return {
    action,
    score: round(score),
    reasons: { afinidade: round(affinity), atividade: taste.activity, acaso: round(chance), recencia: round(-recency) },
  };
}

/**
 * Agendador das personas (SPEC 7.4, "tique do agendador"; 7.5): de tempos em tempos, uma persona
 * puxa conversa mandando um vídeo que ela curtiu para outra persona (ou, às vezes, para o Grupo do
 * Bunker). Quem puxa sai por sorteio pesado pela atividade; o par pela relação entre elas; o vídeo
 * pelo gosto de quem recebe. Quem está fora do ritmo (ritmo.ts) sai menos. A conversa que segue (respostas e silêncio) é decidida na api.
 */
export interface TickPersona extends PersonaTaste {
  id: string;
  nickname: string;
  /** Apelidos de quem ela cita em `relacoes`. */
  relations: string[];
  /** Faixas de hora em que costuma estar ativa (ritmo.ts). */
  ritmo?: string[];
}

export interface TickVideo {
  id: string;
  topics: string[];
  /** Personas que curtiram ou comentaram (só manda vídeo de que gostou). */
  likedBy: string[];
}

export interface TickCandidates {
  personas: TickPersona[];
  videos: TickVideo[];
  /** Vídeos já mandados em cada conversa entre duas personas (chave `pairKey`). */
  sentInPair: Map<string, Set<string>>;
  /** Pares que conversaram há pouco (chave `pairKey`): ficam quietos um tempo. */
  coolingPairs: Set<string>;
  /** Vídeos já mandados no Grupo do Bunker. */
  bunkerVideos: Set<string>;
  /** Hora local (0 a 23): quem está fora do ritmo puxa conversa menos. */
  hour: number;
}

export interface TickPlan {
  starterId: string;
  /** null: manda no Grupo do Bunker. */
  partnerId: string | null;
  videoId: string;
  score: number;
  reasons: Record<string, number | string | boolean>;
}

export const TICK = {
  /** Chance de o vídeo ir para o Grupo do Bunker em vez de outra persona. */
  bunkerChance: 0.15,
  /** Peso a mais no sorteio do par quando uma cita a outra em `relacoes`. */
  relationBonus: 2,
  /** Horas que um par fica sem puxar conversa nova depois de conversar. */
  pairCooldownHours: 6,
};

export const pairKey = (a: string, b: string) => [a, b].sort().join(":");

/** Sorteio pesado (pesos ≤ 0 nunca saem). */
function weighted<T>(items: T[], weight: (t: T) => number, random: () => number): T | null {
  const total = items.reduce((s, t) => s + Math.max(0, weight(t)), 0);
  if (total <= 0) return null;
  let roll = random() * total;
  for (const t of items) {
    roll -= Math.max(0, weight(t));
    if (roll < 0) return t;
  }
  return items.at(-1) ?? null;
}

export function planTick(c: TickCandidates, random: () => number = Math.random): TickPlan | null {
  const liked = (p: TickPersona) => c.videos.filter((v) => v.likedBy.includes(p.id));
  const pace = (p: TickPersona) => rhythm(p.ritmo, c.hour);
  const starter = weighted(
    c.personas.filter((p) => liked(p).length > 0),
    (p) => p.activity * pace(p),
    random,
  );
  if (!starter) return null;
  const ritmo = pace(starter);
  if (random() < TICK.bunkerChance) {
    const video = weighted(
      liked(starter).filter((v) => !c.bunkerVideos.has(v.id)),
      (v) => topicAffinity(starter, v.topics) ** 2,
      random,
    );
    if (!video) return null;
    return {
      starterId: starter.id,
      partnerId: null,
      videoId: video.id,
      score: round(topicAffinity(starter, video.topics)),
      reasons: { atividade: starter.activity, ritmo, afinidade: round(topicAffinity(starter, video.topics)), grupo: true },
    };
  }
  const related = (p: TickPersona) => starter.relations.includes(p.nickname) || p.relations.includes(starter.nickname);
  const partner = weighted(
    c.personas.filter((p) => p.id !== starter.id && !c.coolingPairs.has(pairKey(starter.id, p.id))),
    (p) => 1 + (related(p) ? TICK.relationBonus : 0),
    random,
  );
  if (!partner) return null;
  // Nem o que já foi nesse par, nem o que ela já mandou para outra persona (mesmo vídeo para todo mundo cansa).
  const sent = new Set([...c.sentInPair].filter(([key]) => key.split(":").includes(starter.id)).flatMap(([, ids]) => [...ids]));
  // Quem manda escolhe pelo gosto de quem recebe ("isso é a cara do Rato").
  const video = weighted(
    liked(starter).filter((v) => !sent.has(v.id)),
    (v) => topicAffinity(partner, v.topics) ** 2,
    random,
  );
  if (!video) return null;
  const affinity = round(topicAffinity(partner, video.topics));
  return {
    starterId: starter.id,
    partnerId: partner.id,
    videoId: video.id,
    score: affinity,
    reasons: { atividade: starter.activity, ritmo, afinidade_de_quem_recebe: affinity, relacao: related(partner) },
  };
}
