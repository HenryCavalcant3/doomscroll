/**
 * Busca (SPEC 5.2 e 7.6): acha vídeos específicos sem virar galeria do acervo. Junta as palavras
 * (título, descrições, hashtags, fala e tópicos) e o significado (embedding da frase contra os vídeos).
 *
 * A semelhança do embedding fica numa faixa estreita (0,45-0,73 no acervo medido), então o corte é
 * pelo destaque z: quantos desvios o vídeo fica acima da média do acervo para aquela busca. Medido em
 * 20 buscas: os acertos ficaram com z >= 2,5 e as buscas sem vídeo certo, com o 1º abaixo de 2,3.
 * Recalibre com `pnpm --filter @doomscroll/api avaliar:busca`.
 */
export const SEARCH = {
  /** Resultados por busca. */
  limit: 10,
  /** Destaque mínimo para um vídeo entrar só pelo significado. */
  minZ: 2.4,
  /** Com menos vídeos que isto, o destaque não quer dizer nada: só as palavras valem. */
  minPool: 8,
  minLength: 2,
  maxLength: 100,
} as const;

export interface SearchCandidate {
  id: string;
  /** Tem todas as palavras da busca no texto ou nos tópicos. */
  textMatch: boolean;
  /** Cosseno com a busca; null sem embedding (do vídeo ou da busca). */
  similarity: number | null;
}

/** Ordem final: quem tem as palavras primeiro, depois quem se destaca no significado; no máximo `limit`. */
export function rankSearch(candidates: SearchCandidate[]): string[] {
  const sims = candidates.map((c) => c.similarity).filter((s): s is number => s !== null);
  const z = zScorer(sims);
  const bySimilarity = (a: SearchCandidate, b: SearchCandidate) => (b.similarity ?? -1) - (a.similarity ?? -1);
  const text = candidates.filter((c) => c.textMatch).sort(bySimilarity);
  const meaning = z
    ? candidates.filter((c) => !c.textMatch && c.similarity !== null && z(c.similarity) >= SEARCH.minZ).sort(bySimilarity)
    : [];
  return [...text, ...meaning].slice(0, SEARCH.limit).map((c) => c.id);
}

function zScorer(values: number[]): ((x: number) => number) | null {
  if (values.length < SEARCH.minPool) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
  return sd > 0 ? (x) => (x - mean) / sd : null;
}

/** Busca limpa: espaços juntados; null se curta ou longa demais. */
export function cleanQuery(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const q = raw.replace(/\s+/g, " ").trim();
  return q.length >= SEARCH.minLength && q.length <= SEARCH.maxLength ? q : null;
}
