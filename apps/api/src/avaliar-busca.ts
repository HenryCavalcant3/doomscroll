/**
 * Bancada da busca: roda buscas no acervo e mostra, para cada uma, o que voltaria e o destaque (z)
 * de cada vídeo. Serve para recalibrar SEARCH.minZ (search.ts) quando o acervo mudar.
 *
 * Uso (com o banco e o Ollama acessíveis):
 *   DATABASE_URL=... OLLAMA_URL=... pnpm --filter @doomscroll/api avaliar:busca -- [--buscas "gato,bolo"]
 */
import { parseArgs } from "node:util";
import pg from "pg";
import { embed } from "./ollama.js";
import { rankSearch, SEARCH } from "./search.js";
import { PgStore } from "./store.js";

/** Buscas da calibração de 2026-11-14: as primeiras têm vídeo certo no acervo; as últimas, não. */
const DEFAULT = [
  "dinossauro",
  "futebol",
  "flamengo",
  "comida",
  "economizar água",
  "minecraft",
  "espaço sideral",
  "senado",
  "música sertaneja",
  "pescaria",
  "jacaré",
  "aquele do cara que esquece um detalhe",
  "fofoca de famosos",
  "política",
  "tricô",
  "carro de corrida",
  "gato caindo",
  "receita de bolo",
];

const { values: args } = parseArgs({ options: { buscas: { type: "string" } } });
const queries = args.buscas ? args.buscas.split(",").map((q) => q.trim()) : DEFAULT;
const ollamaUrl = process.env.OLLAMA_URL ?? "http://localhost:11434";
const model = process.env.EMBED_MODEL ?? "nomic-embed-text";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const store = new PgStore(pool);
const titles = new Map(
  (await pool.query<{ id: string; title: string | null }>("SELECT id, title FROM videos WHERE status = 'aprovado'")).rows.map((r) => [r.id, r.title ?? "sem título"]),
);

console.log(`Corte: z >= ${SEARCH.minZ}; no máximo ${SEARCH.limit} resultados.\n`);
for (const query of queries) {
  const vector = await embed({ baseUrl: ollamaUrl, model, text: `search_query: ${query}`, timeoutMs: 60_000 });
  const candidates = await store.searchCandidates(query, vector);
  const sims = candidates.map((c) => c.similarity).filter((s): s is number => s !== null);
  const mean = sims.reduce((a, b) => a + b, 0) / sims.length;
  const sd = Math.sqrt(sims.reduce((a, b) => a + (b - mean) ** 2, 0) / sims.length) || 1;
  const z = (s: number | null) => (s === null ? 0 : (s - mean) / sd);
  const shown = new Set(rankSearch(candidates));
  const top = [...candidates].sort((a, b) => z(b.similarity) - z(a.similarity)).slice(0, 4);
  console.log(`## ${query} — ${shown.size} resultado(s)`);
  for (const c of top) {
    const mark = shown.has(c.id) ? "✅" : "· ";
    console.log(`  ${mark} z ${z(c.similarity).toFixed(2)}${c.textMatch ? " palavras" : ""}  ${titles.get(c.id)?.slice(0, 60)}`);
  }
  const textOnly = candidates.filter((c) => c.textMatch && !top.includes(c));
  for (const c of textOnly) console.log(`  ✅ palavras (z ${z(c.similarity).toFixed(2)})  ${titles.get(c.id)?.slice(0, 60)}`);
  console.log();
}
await pool.end();
