/**
 * Bancada do RAG: para pedidos de vídeo e trechos de conversa, mostra o que a busca da persona
 * devolve do acervo (a mesma consulta e os mesmos limites do chat). Nos pedidos, confere se o
 * primeiro resultado tem o tópico esperado (acerto@1). Serve para calibrar RAG (personaChat.ts).
 *
 * Uso (com o banco e o Ollama acessíveis):
 *   DATABASE_URL=... OLLAMA_URL=... pnpm --filter @doomscroll/api avaliar:rag -- [--persona tio_valdir]
 */
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import pg from "pg";
import { embed } from "./ollama.js";
import { goodMatch, PgPersonaChatStore, RAG } from "./personaChat.js";
import { topicsIn, videoQuery } from "./personaJev.js";

const { values: args } = parseArgs({ options: { persona: { type: "string", default: "tio_valdir" } } });

const ollamaUrl = process.env.OLLAMA_URL ?? "http://localhost:11434";
const model = process.env.EMBED_MODEL ?? "nomic-embed-text";

/** Pedidos explícitos e o tópico que o primeiro resultado deveria ter (null: nada serve no acervo). */
const ASKED: [string, string | null][] = [
  ["me manda um vídeo de gato", "animais"],
  ["tem algum vídeo de receita?", "comida"],
  ["recomenda algo pra rir", "humor"],
  ["manda um vídeo de futebol", "esporte"],
  ["tem vídeo de música?", "musica"],
  ["me mostra um vídeo de cachorro", "animais"],
  ["tem algum vídeo de games?", "games"],
  ["manda um vídeo sobre ciência", "ciencia"],
  ["me manda um vídeo de dinossauro", "ciencia"],
  ["tem vídeo de minecraft?", "games"],
  ["manda um vídeo de pizza", "comida"],
  ["me manda um vídeo de tricô", null],
];
/** Conversas sem pedido: o vídeo espontâneo só vai se passar do limite. */
const TALK = [
  "meu gato derrubou o copo da mesa hoje de novo",
  "fiz um bolo de chocolate ontem e ficou ótimo",
  "hoje meu dia foi péssimo, perdi o ônibus e cheguei atrasado",
  "tô treinando todo dia de manhã antes do trabalho",
  "o jogo de ontem foi muito bom, que golaço",
  "oi tudo bem? como foi seu dia?",
];

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const store = new PgPersonaChatStore(pool);
const persona = await pool.query<{ user_id: string }>("SELECT u.id AS user_id FROM users u JOIN personas p ON p.user_id = u.id WHERE u.nickname = $1", [args.persona]);
const personaId = persona.rows[0]?.user_id;
if (!personaId) throw new Error(`Persona ${args.persona} não encontrada.`);
const conversation = randomUUID(); // nenhuma conversa: nada foi mandado ainda
const topics = await store.topics();

async function topicsOf(videoId: string) {
  const res = await pool.query<{ slug: string }>("SELECT t.slug FROM video_topics vt JOIN topics t ON t.id = vt.topic_id WHERE vt.video_id = $1", [videoId]);
  return res.rows.map((r) => r.slug);
}

async function search(text: string, asked: boolean) {
  const query = (asked && videoQuery(text)) || text;
  const vector = await embed({ baseUrl: ollamaUrl, model, text: `search_query: ${query}`, timeoutMs: 60_000 });
  const cited = topicsIn(query, topics);
  const matches = await store.findVideos(personaId!, conversation, vector, cited, 3);
  return { query, cited, matches };
}

const line = (m: Awaited<ReturnType<typeof search>>["matches"][number], ok: boolean, slugs: string[]) =>
  `  - ${ok ? "✅" : "·"} sim ${m.similarity.toFixed(2)} z ${m.z.toFixed(2)}${m.topicMatch ? " tópico" : ""} (afinidade ${m.affinity.toFixed(2)}) ${m.title ?? "sem título"} [${slugs.join(", ")}]`;

let hits = 0;
let correct = 0;
console.log(`\n## Pedidos de vídeo (✅ = serve; vai o primeiro que serve)\n`);
for (const [text, expected] of ASKED) {
  const { query, cited, matches } = await search(text, true);
  const sent = matches.find((m) => goodMatch(m, true));
  const sentTopics = sent ? await topicsOf(sent.id) : [];
  const ok = expected === null ? !sent : sentTopics.includes(expected);
  if (ok) correct++;
  if (expected && sent && sentTopics.includes(expected)) hits++;
  console.log(`- ${ok ? "acertou" : "ERROU"}: **${text}** → busca "${query}"${cited.length ? ` (tópicos ${cited.join(", ")})` : ""}, esperado ${expected ?? "nenhum"}`);
  for (const m of matches) console.log(line(m, goodMatch(m, true), await topicsOf(m.id)));
}

console.log(`\n## Conversa sem pedido (✅ = poderia ir espontâneo)\n`);
for (const text of TALK) {
  const { cited, matches } = await search(text, false);
  console.log(`- **${text}**${cited.length ? ` (tópicos ${cited.join(", ")})` : ""}`);
  for (const m of matches) console.log(line(m, goodMatch(m, false), await topicsOf(m.id)));
}

console.log(`\nAcerto nos pedidos: ${correct}/${ASKED.length} (tópico certo no vídeo mandado: ${hits}/${ASKED.filter(([, e]) => e).length}). Limites: z ≥ ${RAG.strongZ}; com tópico citado, qualquer z no pedido e z ≥ ${RAG.topicZ} sem pedido.`);
await pool.end();
