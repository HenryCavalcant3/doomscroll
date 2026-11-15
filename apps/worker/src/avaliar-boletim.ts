/**
 * Bancada do Boletim do Bunker: com os fatos de um dia de verdade, gera manchetes e fofocas na voz
 * de cada persona (sem gravar nada) e mostra quantas passaram na validação de primeira, os motivos
 * das recusas e todos os textos. Serve para ajustar os prompts e as frases de exemplo das personas.
 *
 * Uso (com o banco e o Ollama acessíveis):
 *   DATABASE_URL=... OLLAMA_URL=... pnpm --filter @doomscroll/worker avaliar:boletim -- [--dia 2026-11-13] [--amostras 3] [--so rato,kelly]
 */
import { mkdir, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import pg from "pg";
import { OllamaClient, pickExamples } from "./ai.js";
import { buildFacts, dayWindow, pickPauta, type DayWindow } from "./bulletin.js";
import { collectDay, gossipTopics, PgBulletinDb } from "./bulletinDb.js";
import {
  buildGossipPrompt,
  buildHeadlinePrompt,
  checkLine,
  GOSSIP_WORDS,
  gossipSchema,
  HEADLINE_WORDS,
  headlineFacts,
  headlineSchema,
  nameKey,
  type BulletinVoice,
  type CheckOptions,
  type GossipInput,
} from "./bulletinText.js";

const { values: args } = parseArgs({
  options: {
    dia: { type: "string" },
    amostras: { type: "string", default: "3" },
    so: { type: "string" },
  },
});

function windowFor(date: string | undefined): DayWindow {
  if (!date) return dayWindow();
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return dayWindow(new Date(y, m - 1, d + 1, 12));
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const ollama = new OllamaClient(process.env.OLLAMA_URL ?? "http://127.0.0.1:11434", process.env.LLM_MODEL ?? "qwen2.5:3b", "nomic-embed-text");
const db = new PgBulletinDb(pool);
const day = windowFor(args.dia);
const samples = Number(args.amostras);
const only = args.so?.split(",");

const voices = await db.voices();
const residents = await db.residents();
const facts = buildFacts(day.date, await collectDay(pool, day));
const hf = headlineFacts(facts);
const topics = await gossipTopics(pool);

interface Line {
  persona: string;
  kind: string;
  input: string;
  attempts: { text: string; reason: string | null }[];
}
const lines: Line[] = [];

async function attempt(prompt: () => string, schema: object, o: Omit<CheckOptions, "residents">) {
  const out: Line["attempts"] = [];
  for (let i = 0; i < 2; i++) {
    const raw = await ollama.line(prompt(), schema);
    const r = checkLine(raw, { ...o, residents });
    out.push({ text: r.ok ? r.text : raw, reason: r.ok ? null : r.reason });
    if (r.ok) break;
  }
  return out;
}

for (const v of voices.filter((x) => !only || only.includes(x.nickname))) {
  const others = voices.filter((o) => o.id !== v.id);
  for (let s = 0; s < samples; s++) {
    lines.push({
      persona: v.name,
      kind: "manchete",
      input: JSON.stringify(hf),
      attempts: await attempt(() => buildHeadlinePrompt(v, hf, pickExamples(v.manchetes)), headlineSchema, { key: "manchete", maxWords: HEADLINE_WORDS, sameAs: v.manchetes }),
    });
    // Uma fofoca de fato curioso (de outra persona) e uma de pauta, por amostra.
    const other = others[s % others.length] as BulletinVoice;
    const fact: GossipInput = { quem: other.name, o_que: ["comentou muito mais do que costuma", "quase nunca curte nada e ontem saiu curtindo vídeo", "ficou em silêncio o dia todo"][s % 3]!, quanto: "bem fora do normal" };
    const pauta = pickPauta(topics, day, others);
    for (const [kind, input, mention] of [
      ["fofoca (fato)", fact, [other.name]],
      ["fofoca (pauta)", { fofoca: pauta?.text ?? "" }, pauta?.personaId ? [others.find((o) => o.id === pauta.personaId)!.name] : []],
    ] as const) {
      lines.push({
        persona: v.name,
        kind,
        input: JSON.stringify(input),
        attempts: await attempt(() => buildGossipPrompt(v, input, pickExamples(v.fofocas)), gossipSchema, {
          key: "fofoca",
          maxWords: GOSSIP_WORDS,
          mustMention: mention,
          mustNotMention: [nameKey(v.name)],
          examples: v.fofocas,
          source: "fofoca" in input ? input.fofoca : input.o_que,
        }),
      });
    }
    process.stdout.write(".");
  }
}
await pool.end();

const first = lines.filter((l) => l.attempts[0]!.reason === null).length;
const any = lines.filter((l) => l.attempts.some((a) => a.reason === null)).length;
const reasons = new Map<string, number>();
for (const l of lines) for (const a of l.attempts) if (a.reason) reasons.set(a.reason, (reasons.get(a.reason) ?? 0) + 1);

const md = [
  `# Boletim do Bunker: bancada de ${day.date}`,
  "",
  `Fatos da manchete: \`${JSON.stringify(hf)}\``,
  "",
  `- Textos: ${lines.length}; válidos de primeira: ${first}; válidos em até duas tentativas: ${any}`,
  `- Recusas: ${[...reasons].map(([r, n]) => `${r} (${n})`).join(", ") || "nenhuma"}`,
  "",
  ...lines.flatMap((l) => [
    `## ${l.persona} · ${l.kind}`,
    "",
    l.kind === "manchete" ? "" : `Entrada: \`${l.input}\``,
    "",
    ...l.attempts.map((a, i) => `${i + 1}. ${a.reason ? `~~${a.text}~~ (${a.reason})` : a.text}`),
    "",
  ]),
].join("\n");
await mkdir("avaliacao", { recursive: true });
const file = `avaliacao/boletim-${day.date}.md`;
await writeFile(file, md);
console.log(`\n${lines.length} textos, ${first} de primeira, ${any} em até duas tentativas. Recusas: ${[...reasons].map(([r, n]) => `${r} (${n})`).join(", ") || "nenhuma"}`);
console.log(`Relatório: ${file}`);
