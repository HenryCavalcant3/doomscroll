/**
 * Bancada de avaliação das personas: gera comentários de cada persona para os vídeos aprovados,
 * sem gravar nada no banco, e escreve um relatório com números e todos os textos lado a lado.
 *
 * Uso (com o banco e o Ollama acessíveis):
 *   DATABASE_URL=... OLLAMA_URL=... pnpm --filter @doomscroll/worker avaliar -- [--amostras 2] [--videos 36] [--saida ../../avaliacao]
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import pg from "pg";
import { buildCommentPrompt, commentSchema, parseComment, pickExamples, type PersonaProfile, type VideoForComment } from "./ai.js";
import { APOCALYPSE_CHANCE } from "./pipeline.js";
import { copiesExample } from "./text.js";

const { values: args } = parseArgs({
  options: {
    amostras: { type: "string", default: "1" },
    videos: { type: "string", default: "1000" },
    personas: { type: "string", default: fileURLToPath(new URL("../../../personas", import.meta.url)) },
    so: { type: "string" },
    transcricao: { type: "boolean", default: false },
    temperatura: { type: "string", default: "0.8" },
    saida: { type: "string", default: fileURLToPath(new URL("../../../avaliacao", import.meta.url)) },
    rotulo: { type: "string", default: new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-") },
  },
});

const ollamaUrl = process.env.OLLAMA_URL ?? "http://localhost:11434";
const model = process.env.LLM_MODEL ?? "qwen2.5:3b";
const MAX_ATTEMPTS = 3;

interface Video extends VideoForComment {
  id: string;
}

interface Result {
  video: string;
  title: string;
  persona: string;
  apocalypse: boolean;
  /** Tentativas recusadas (vazias, inválidas ou copiadas do exemplo), na ordem. */
  rejected: string[];
  text: string | null;
  ms: number;
}

async function loadPersonas(dir: string): Promise<PersonaProfile[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  const list: PersonaProfile[] = [];
  for (const f of files) {
    const p = JSON.parse(await readFile(join(dir, f), "utf8"));
    list.push({ userId: p.apelido, nickname: p.apelido, name: p.nome, bio: p.bio, tone: p.tom, examples: p.exemplos });
  }
  return args.so ? list.filter((p) => args.so!.split(",").includes(p.nickname)) : list;
}

async function loadVideos(limit: number): Promise<Video[]> {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const res = await pool.query<Video>(
      `SELECT v.id, v.title, v.description, CASE WHEN $2 THEN v.transcript END AS transcript, COALESCE(array_agg(t.name ORDER BY t.name) FILTER (WHERE t.id IS NOT NULL), '{}') AS topics
         FROM videos v
         LEFT JOIN video_topics vt ON vt.video_id = v.id
         LEFT JOIN topics t ON t.id = vt.topic_id
        WHERE v.status = 'aprovado'
        GROUP BY v.id ORDER BY v.created_at LIMIT $1`,
      [limit, args.transcricao],
    );
    return res.rows;
  } finally {
    await pool.end();
  }
}

async function generate(prompt: string): Promise<string> {
  const res = await fetch(new URL("/api/generate", ollamaUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      prompt,
      format: commentSchema,
      stream: false,
      options: { temperature: Number(args.temperatura), num_ctx: 4096, num_predict: 120 },
    }),
  });
  if (!res.ok) throw new Error(`Ollama respondeu ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return ((await res.json()) as { response: string }).response;
}

/** Mesmo laço do OllamaClient.comment, guardando as tentativas recusadas. */
async function comment(persona: PersonaProfile, video: Video, apocalypse: boolean): Promise<Omit<Result, "video" | "title" | "persona">> {
  const started = Date.now();
  const rejected: string[] = [];
  const about = [video.title, video.description, video.topics.join(" "), video.transcript ?? ""].join(" ");
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const raw = await generate(buildCommentPrompt(persona, video, apocalypse, pickExamples(persona.examples)));
    const text = parseComment(raw);
    if (text && !copiesExample(text, persona.examples, about)) return { apocalypse, rejected, text, ms: Date.now() - started };
    rejected.push(text ?? raw.slice(0, 160));
  }
  return { apocalypse, rejected, text: null, ms: Date.now() - started };
}

const words = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").match(/\p{L}+/gu) ?? [];

/** O comentário só repete o título: metade ou mais das palavras com 4+ letras vêm do título. */
function echoesTitle(text: string, title: string): boolean {
  const own = words(text).filter((w) => w.length >= 4);
  if (own.length < 2) return false;
  const fromTitle = new Set(words(title));
  return own.filter((w) => fromTitle.has(w)).length / own.length >= 0.5;
}

const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "-");

function summary(results: Result[], personas: PersonaProfile[]): string {
  const rows = personas.map((p) => {
    const mine = results.filter((r) => r.persona === p.nickname);
    const ok = mine.filter((r) => r.text);
    const first = mine.filter((r) => r.text && r.rejected.length === 0);
    const openings = new Map<string, number>();
    for (const r of ok) {
      const key = words(r.text!).slice(0, 2).join(" ");
      openings.set(key, (openings.get(key) ?? 0) + 1);
    }
    const [topOpening, topCount] = [...openings].sort((a, b) => b[1] - a[1])[0] ?? ["-", 0];
    const avg = ok.length ? Math.round(ok.reduce((s, r) => s + r.text!.length, 0) / ok.length) : 0;
    const echo = ok.filter((r) => echoesTitle(r.text!, r.title)).length;
    return `| ${p.name} | ${mine.length} | ${pct(ok.length, mine.length)} | ${pct(first.length, mine.length)} | ${avg} | ${pct(echo, ok.length)} | "${topOpening}" (${pct(topCount, ok.length)}) |`;
  });
  return [
    "| Persona | Pedidos | Saiu comentário | Na 1ª tentativa | Tamanho médio | Repete o título | Abertura mais comum |",
    "|---|---|---|---|---|---|---|",
    ...rows,
  ].join("\n");
}

function report(results: Result[], personas: PersonaProfile[], label: string): string {
  const byVideo = new Map<string, Result[]>();
  for (const r of results) byVideo.set(r.video, [...(byVideo.get(r.video) ?? []), r]);
  const names = new Map(personas.map((p) => [p.nickname, p.name]));
  const sections = [...byVideo.values()].map((rs) => {
    const lines = rs.map((r) => {
      const tag = r.apocalypse ? " 🧨" : "";
      const body = r.text ?? `**FALHOU** (${r.rejected.map((x) => `“${x}”`).join(" / ")})`;
      const retries = r.text && r.rejected.length ? ` _(recusadas: ${r.rejected.map((x) => `“${x}”`).join(" / ")})_` : "";
      return `- **${names.get(r.persona)}**${tag}: ${body}${retries}`;
    });
    return `### ${rs[0]!.title}\n\n${lines.join("\n")}`;
  });
  return `# Avaliação das personas (${label})\n\nModelo: ${model}, temperatura ${args.temperatura}, transcrição ${args.transcricao ? "sim" : "não"}. 🧨 = pedido com o tema fim do mundo.\n\n${summary(results, personas)}\n\n${sections.join("\n\n")}\n`;
}

const personas = await loadPersonas(args.personas);
const videos = await loadVideos(Number(args.videos));
const samples = Number(args.amostras);
const total = videos.length * personas.length * samples;
console.log(`${personas.length} personas, ${videos.length} vídeos, ${samples} amostra(s): ${total} comentários`);

const results: Result[] = [];
const t0 = Date.now();
for (const video of videos) {
  for (let s = 0; s < samples; s++) {
    for (const persona of personas) {
      const r = await comment(persona, video, Math.random() < APOCALYPSE_CHANCE);
      results.push({ video: video.id, title: video.title ?? "(sem título)", persona: persona.nickname, ...r });
      process.stdout.write(`\r${results.length}/${total}`);
    }
  }
}
console.log(`\nterminou em ${Math.round((Date.now() - t0) / 1000)}s`);

await mkdir(args.saida, { recursive: true });
const base = join(args.saida, args.rotulo);
await writeFile(`${base}.json`, JSON.stringify(results, null, 2));
await writeFile(`${base}.md`, report(results, personas, args.rotulo));
console.log(summary(results, personas));
console.log(`relatório: ${base}.md`);
