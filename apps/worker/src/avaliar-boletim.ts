/**
 * Bancada do Boletim do Bunker: com os fatos de um dia de verdade, gera manchetes e fofocas na voz
 * de cada persona (sem gravar nada) e mostra quantas passaram na validação de primeira, os motivos
 * das recusas e todos os textos. Serve para ajustar os prompts e as frases de exemplo das personas.
 *
 * Uso (com o banco e o Ollama acessíveis):
 *   DATABASE_URL=... OLLAMA_URL=... pnpm --filter @doomscroll/worker avaliar:boletim -- [--dia 2026-11-13] [--amostras 2] [--so rato,kelly]
 *
 * Por persona e amostra: 4 cenários de manchete, os 6 detectores de fato curioso (com o "quanto"
 * alternando) e 5 pautas sorteadas. Duas amostras com as cinco personas dão 150 textos.
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
  writesLowercase,
} from "./bulletinText.js";

const { values: args } = parseArgs({
  options: {
    dia: { type: "string" },
    amostras: { type: "string", default: "2" },
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
const sensitive = await db.sensitiveTopics();
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

/**
 * Cenários de manchete. A LLM só escreve manchete em dia normal com assunto não sensível (dia
 * parado, fraco ou sensível usa a frase fixa de "dia parado"), então os cenários variam o tamanho
 * do estoque, o movimento e os temas novos, mais os fatos reais do dia pedido.
 */
const headlineScenarios: [string, { estoque: string }][] = [
  ["dia real", hf],
  ["calmo", { assunto_do_dia: "Culinária", estoque: "pouco vídeo novo", temas_novos: [], movimento: "calmo" }],
  ["agitado", { assunto_do_dia: "Esporte", estoque: "muito vídeo novo", temas_novos: ["Games"], movimento: "agitado" }],
  ["temas novos", { assunto_do_dia: "Música", estoque: "bastante vídeo novo", temas_novos: ["Ciência", "Dicas", "Animais"], movimento: "normal" }],
];
/** Os seis detectores de fato curioso, como saem de gossip.ts. */
const detectors = [
  "quase nunca curte nada e ontem saiu curtindo vídeo",
  "comentou muito mais do que costuma",
  "falou muito mais que o normal no Grupo do Bunker",
  "mandou vídeo para meio bunker",
  "ficou em silêncio o dia todo",
  "passaram o dia trocando mensagens",
];

const gossipCheck = (v: BulletinVoice, input: GossipInput, mention: string[]) => ({
  key: "fofoca" as const,
  maxWords: GOSSIP_WORDS,
  mustMention: mention,
  mustNotMention: [nameKey(v.name)],
  strangers: voices.filter((o) => o.id !== v.id && !mention.includes(o.name)).map((o) => nameKey(o.name)),
  examples: v.fofocas,
  source: "fofoca" in input ? input.fofoca : input.o_que,
  sensitive,
  lowercase: writesLowercase(v),
});

for (const v of voices.filter((x) => !only || only.includes(x.nickname))) {
  const others = voices.filter((o) => o.id !== v.id);
  for (let s = 0; s < samples; s++) {
    for (const [name, scenario] of headlineScenarios) {
      lines.push({
        persona: v.name,
        kind: `manchete (${name})`,
        input: JSON.stringify(scenario),
        attempts: await attempt(() => buildHeadlinePrompt(v, scenario, pickExamples(v.manchetes)), headlineSchema, { key: "manchete", maxWords: HEADLINE_WORDS, sameAs: v.manchetes, stock: scenario.estoque, sensitive, lowercase: writesLowercase(v) }),
      });
    }
    // Cada detector, com outra persona (ou um par) como assunto.
    for (const [i, o_que] of detectors.entries()) {
      const a = others[(s + i) % others.length]!;
      const b = others[(s + i + 1) % others.length]!;
      const pair = o_que.startsWith("passaram");
      const input: GossipInput = { quem: pair ? `${a.name} e ${b.name}` : a.name, o_que };
      lines.push({
        persona: v.name,
        kind: "fofoca (fato)",
        input: JSON.stringify(input),
        attempts: await attempt(() => buildGossipPrompt(v, input, pickExamples(v.fofocas)), gossipSchema, gossipCheck(v, input, pair ? [a.name, b.name] : [a.name])),
      });
    }
    // Pautas sorteadas como na geração (sem o intervalo de 14 dias: aqui nada é gravado).
    for (let k = 0; k < 5; k++) {
      const pauta = pickPauta(topics.map((t) => ({ ...t, lastUsedAt: null })), day, others);
      if (!pauta) break;
      const input: GossipInput = { fofoca: pauta.text };
      const named = others.find((o) => o.id === pauta.personaId);
      lines.push({
        persona: v.name,
        kind: "fofoca (pauta)",
        input: JSON.stringify(input),
        attempts: await attempt(() => buildGossipPrompt(v, input, pickExamples(v.fofocas)), gossipSchema, gossipCheck(v, input, named ? [named.name] : [])),
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

function summary(): string[] {
  const groups = new Map<string, Line[]>();
  for (const l of lines) {
    const k = `${l.persona} | ${l.kind.replace(/ \(.*\)$/, "")}`;
    groups.set(k, [...(groups.get(k) ?? []), l]);
  }
  return [...groups].map(([k, ls]) => {
    const why = new Map<string, number>();
    for (const l of ls) for (const a of l.attempts) if (a.reason) why.set(a.reason, (why.get(a.reason) ?? 0) + 1);
    const ok1 = ls.filter((l) => l.attempts[0]!.reason === null).length;
    const ok2 = ls.filter((l) => l.attempts.some((a) => a.reason === null)).length;
    return `| ${k} | ${ls.length} | ${ok1} | ${ok2} | ${[...why].map(([r, n]) => `${r} (${n})`).join(", ") || "—"} |`;
  });
}

const md = [
  `# Boletim do Bunker: bancada de ${day.date}`,
  "",
  `Fatos da manchete: \`${JSON.stringify(hf)}\``,
  "",
  `- Textos: ${lines.length}; válidos de primeira: ${first}; válidos em até duas tentativas: ${any}`,
  `- Recusas: ${[...reasons].map(([r, n]) => `${r} (${n})`).join(", ") || "nenhuma"}`,
  "",
  "| Persona | Tipo | Textos | De primeira | Em até duas | Recusas |",
  "|---|---|---|---|---|---|",
  ...summary(),
  "",
  ...lines.flatMap((l) => [
    `## ${l.persona} · ${l.kind}`,
    "",
    `Entrada: \`${l.input}\``,
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
