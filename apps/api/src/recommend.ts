/** Escolha dos próximos vídeos do feed (SPEC §6, fase 1). Funções puras: o sorteio vem de fora. */

/** Vídeo visto fica fora do feed por este tempo. */
export const QUARANTINE_MS = 3 * 24 * 60 * 60 * 1000;
/** Chance de cada vaga ser sorteada sem olhar a afinidade. */
export const EXPLORE = 0.2;
/** Peso mínimo: tópicos neutros ou rejeitados ainda aparecem de vez em quando. */
export const BASE_WEIGHT = 0.2;

export interface Candidate {
  id: string;
  topicIds: number[];
  liked: boolean;
  /** Última visualização de quem pede o feed (ms desde 1970), ou null. */
  lastViewedAt: number | null;
}

export type Rng = () => number;

/** Peso do vídeo: base mais a média (positiva) da afinidade nos tópicos dele. */
export function weightOf(c: Candidate, affinity: Map<number, number>): number {
  if (c.topicIds.length === 0) return BASE_WEIGHT;
  const mean = c.topicIds.reduce((sum, t) => sum + (affinity.get(t) ?? 0), 0) / c.topicIds.length;
  return BASE_WEIGHT + Math.max(0, mean);
}

/** Sorteia n sem repetir: em cada vaga, exploração uniforme com chance EXPLORE, senão pelo peso. */
export function sample(cands: Candidate[], affinity: Map<number, number>, n: number, rng: Rng): Candidate[] {
  const pool = cands.map((c) => ({ c, w: weightOf(c, affinity) }));
  const picked: Candidate[] = [];
  while (picked.length < n && pool.length > 0) {
    let i: number;
    if (rng() < EXPLORE) i = Math.floor(rng() * pool.length);
    else {
      const total = pool.reduce((s, p) => s + p.w, 0);
      let r = rng() * total;
      i = pool.findIndex((p) => (r -= p.w) < 0);
      if (i < 0) i = pool.length - 1;
    }
    picked.push(pool.splice(Math.min(i, pool.length - 1), 1)[0]!.c);
  }
  return picked;
}

/** Ordem de volta dos vídeos já vistos: curtidos primeiro, depois os vistos há mais tempo. */
function revival(cands: Candidate[]): Candidate[] {
  return [...cands].sort(
    (a, b) => Number(b.liked) - Number(a.liked) || (a.lastViewedAt ?? 0) - (b.lastViewedAt ?? 0),
  );
}

export interface Pick {
  ids: string[];
  /** Nada fora do `exclude`: o feed recomeçou do acervo inteiro. */
  restarted: boolean;
}

/**
 * Próxima página do feed. `exclude` são os ids que o cliente já recebeu nesta volta (inclui os
 * pré-carregados, que ainda não têm evento de visualização).
 */
export function pickFeed(
  cands: Candidate[],
  affinity: Map<number, number>,
  exclude: string[],
  limit: number,
  now: number,
  rng: Rng,
): Pick {
  const excluded = new Set(exclude);
  const open = cands.filter((c) => !excluded.has(c.id));
  const fresh = open.filter((c) => c.lastViewedAt === null || now - c.lastViewedAt >= QUARANTINE_MS);
  if (fresh.length > 0) return { ids: sample(fresh, affinity, limit, rng).map((c) => c.id), restarted: false };
  // Tudo o que sobrou está em quarentena: volta o que tiver, curtidos primeiro.
  if (open.length > 0) return { ids: revival(open).slice(0, limit).map((c) => c.id), restarted: false };
  if (excluded.size > 0 && cands.length > 0) {
    return { ids: revival(cands).slice(0, limit).map((c) => c.id), restarted: true };
  }
  return { ids: [], restarted: false };
}
