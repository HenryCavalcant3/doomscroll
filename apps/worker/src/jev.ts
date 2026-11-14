/**
 * JEV, a decisão por pesos da persona (SPEC 7.4): combina a afinidade com os tópicos, o nível de
 * atividade, o tempo desde a última interação com aquele contato e o acaso. Aqui fica a decisão
 * diante de um vídeo aprovado: ignorar, curtir ou comentar (comentar também curte).
 */

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
