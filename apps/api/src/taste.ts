/** Vetor de gosto (SPEC §6, fase 2): média dos embeddings dos vídeos bem avaliados, pesada pela nota. */

/** Quantos vídeos bem avaliados (os mais recentes) entram no vetor de gosto. */
export const TASTE_VIDEOS = 50;

export interface RatedVideo {
  /** Soma dos sinais da pessoa no vídeo; só entra quem tem nota positiva. */
  score: number;
  embedding: number[];
}

/** Média ponderada normalizada (norma 1), ou null quando não há vídeo bem avaliado. */
export function tasteVector(videos: RatedVideo[]): number[] | null {
  const rated = videos.filter((v) => v.score > 0 && v.embedding.length > 0);
  if (rated.length === 0) return null;
  const sum = new Array<number>(rated[0]!.embedding.length).fill(0);
  for (const v of rated) v.embedding.forEach((x, i) => (sum[i]! += v.score * x));
  const norm = Math.hypot(...sum);
  return norm > 0 ? sum.map((x) => x / norm) : null;
}

/** Similaridade de cosseno (a mesma conta do `1 - (a <=> b)` do pgvector). */
export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  a.forEach((x, i) => {
    dot += x * b[i]!;
    na += x * x;
    nb += b[i]! * b[i]!;
  });
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Vetor no formato texto do pgvector, e de volta. */
export const toPgVector = (v: number[]) => `[${v.join(",")}]`;
export const fromPgVector = (s: string): number[] => JSON.parse(s) as number[];
