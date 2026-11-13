/** Pesos da afinidade por tópico (SPEC §6, fase 1). Cada sinal soma em todos os tópicos do vídeo. */

/** Faixa do score, para um tópico só não dominar o feed. */
export const SCORE_MIN = -5;
export const SCORE_MAX = 10;

export const LIKE_DELTA = 2;
/** Só o primeiro comentário da pessoa no vídeo conta. */
export const COMMENT_DELTA = 1;

const COMPLETED_PCT = 0.9;
const REPLAY_DELTA = 0.5;
const MAX_REPLAYS_COUNTED = 3;
const SKIP_MS = 2000;
const SKIP_PCT = 0.15;

export interface ViewInput {
  watchedMs: number;
  /** Fração vista na primeira passada, de 0 a 1. */
  watchPct: number;
  replays: number;
}

/** Classifica a visualização e diz quanto ela muda a afinidade. */
export function viewDelta(v: ViewInput): { skipped: boolean; delta: number } {
  const completed = v.replays > 0 || v.watchPct >= COMPLETED_PCT;
  if (completed) return { skipped: false, delta: 1 + Math.min(v.replays, MAX_REPLAYS_COUNTED) * REPLAY_DELTA };
  if (v.watchedMs < SKIP_MS || v.watchPct < SKIP_PCT) return { skipped: true, delta: -1 };
  return { skipped: false, delta: 0 };
}

export const clampScore = (s: number) => Math.min(SCORE_MAX, Math.max(SCORE_MIN, s));
