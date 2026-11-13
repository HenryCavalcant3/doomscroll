/**
 * Bancada de avaliação do chat com as personas: roda conversas roteirizadas com cada persona,
 * com o mesmo prompt e as mesmas regras do app (sem gravar nada no banco), e escreve um relatório
 * com números e as conversas inteiras.
 *
 * Uso (com o Ollama acessível):
 *   OLLAMA_URL=... pnpm --filter @doomscroll/api avaliar -- [--amostras 2] [--so rato,kelly] [--saida ../../avaliacao]
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { MessageView } from "./chat.js";
import { chatStream } from "./ollama.js";
import { CHAT_OPTIONS, generateReply, type PersonaProfile } from "./personaChat.js";
import { DEFAULT_PERSONAS_DIR, loadPersonas } from "./personas.js";

const { values: args } = parseArgs({
  options: {
    amostras: { type: "string", default: "1" },
    personas: { type: "string", default: DEFAULT_PERSONAS_DIR },
    so: { type: "string" },
    saida: { type: "string", default: fileURLToPath(new URL("../../../avaliacao", import.meta.url)) },
    rotulo: { type: "string", default: `chat-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}` },
  },
});

const ollamaUrl = process.env.OLLAMA_URL ?? "http://localhost:11434";
const model = process.env.LLM_MODEL ?? "qwen2.5:3b";
const CONTACT = "visitante";

/** Uma fala do contato: texto, ou um vídeo compartilhado (título e descrição). */
type Turn = string | { title: string; description: string };

/** Roteiros com o que costuma dar errado: cumprimento, pergunta direta, vídeo, assunto pessoal. */
const SCRIPTS: { name: string; turns: Turn[] }[] = [
  { name: "chegada", turns: ["oi! tudo bem? acabei de chegar", "o que você mais gosta de assistir aqui?", "e o que você acha dos vídeos de dança?"] },
  {
    name: "vídeo",
    turns: [{ title: "Gato derruba copo da mesa", description: "Um gato empurra um copo de água devagar até ele cair no chão." }, "kkkk o que achou?", "o meu gato faz igual"],
  },
  { name: "pessoal", turns: ["hoje meu dia foi péssimo, perdi o ônibus e cheguei atrasado", "você já teve um dia assim?", "valeu pela conversa"] },
];

interface Exchange {
  said: string;
  reply: string;
  rejected: string[];
  ms: number;
}

interface Result {
  persona: string;
  script: string;
  sample: number;
  exchanges: Exchange[];
}

const profile = (p: Awaited<ReturnType<typeof loadPersonas>>[number]): PersonaProfile => ({
  id: p.apelido,
  nickname: p.apelido,
  name: p.nome,
  bio: p.bio,
  tone: p.tom,
  examples: p.exemplos,
});

let seq = 0;
function message(from: string, isAi: boolean, turn: Turn): MessageView {
  const video = typeof turn === "string" ? null : { id: "v", title: turn.title, description: turn.description, videoUrl: null, thumbUrl: null };
  return {
    id: String(++seq),
    conversationId: "bancada",
    type: video ? "video" : "text",
    text: typeof turn === "string" ? turn : null,
    video,
    reactions: [],
    createdAt: new Date().toISOString(),
    sender: { nickname: from, avatarUrl: null, isAi },
  };
}

const said = (turn: Turn) => (typeof turn === "string" ? turn : `[vídeo: ${turn.title}]`);

async function converse(persona: PersonaProfile, turns: Turn[]): Promise<Exchange[]> {
  const history: MessageView[] = [];
  const exchanges: Exchange[] = [];
  for (const turn of turns) {
    history.push(message(CONTACT, false, turn));
    const started = Date.now();
    const { text, rejected } = await generateReply(
      (messages, stop, onText, signal) =>
        chatStream({ baseUrl: ollamaUrl, model, messages, options: { ...CHAT_OPTIONS, stop }, timeoutMs: 120_000, signal }, onText),
      persona,
      CONTACT,
      "",
      history,
      () => {},
      AbortSignal.timeout(300_000),
    );
    exchanges.push({ said: said(turn), reply: text, rejected, ms: Date.now() - started });
    // Sem resposta, a conversa segue como no app: a próxima mensagem do contato vem logo depois.
    if (text) history.push(message(persona.nickname, true, text));
  }
  return exchanges;
}

const words = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").match(/\p{L}+/gu) ?? [];
/** Frase de assistente ("se precisar", "posso ajudar"), que não combina com uma pessoa da rede. */
const ASSISTANT = /precis(ar|e) de|(posso|em|feliz em) ajudar|à vontade|estou aqui|estarei aqui/i;
const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "-");

function summary(results: Result[], personas: PersonaProfile[]): string {
  const rows = personas.map((p) => {
    const all = results.filter((r) => r.persona === p.nickname).flatMap((r) => r.exchanges);
    const ok = all.filter((e) => e.reply);
    const first = all.filter((e) => e.reply && e.rejected.length === 0);
    const openings = new Map<string, number>();
    for (const e of ok) {
      const key = words(e.reply).slice(0, 2).join(" ");
      openings.set(key, (openings.get(key) ?? 0) + 1);
    }
    const [topOpening, topCount] = [...openings].sort((a, b) => b[1] - a[1])[0] ?? ["-", 0];
    const avg = ok.length ? Math.round(ok.reduce((s, e) => s + e.reply.length, 0) / ok.length) : 0;
    const helper = ok.filter((e) => ASSISTANT.test(e.reply)).length;
    const secs = all.length ? (all.reduce((s, e) => s + e.ms, 0) / all.length / 1000).toFixed(1) : "-";
    return `| ${p.name} | ${all.length} | ${pct(ok.length, all.length)} | ${pct(first.length, all.length)} | ${avg} | ${pct(helper, ok.length)} | ${secs}s | "${topOpening}" (${pct(topCount, ok.length)}) |`;
  });
  return [
    "| Persona | Mensagens | Respondeu | Na 1ª tentativa | Tamanho médio | Fala de assistente | Tempo médio | Abertura mais comum |",
    "|---|---|---|---|---|---|---|---|",
    ...rows,
  ].join("\n");
}

function report(results: Result[], personas: PersonaProfile[], label: string): string {
  const names = new Map(personas.map((p) => [p.nickname, p.name]));
  const sections = results.map((r) => {
    const lines = r.exchanges.flatMap((e) => {
      const reply = e.reply || "**FALHOU**";
      const retries = e.rejected.length ? ` _(recusadas: ${e.rejected.map((x) => `“${x}”`).join(" / ")})_` : "";
      return [`- **@${CONTACT}**: ${e.said}`, `- **${names.get(r.persona)}**: ${reply}${retries}`];
    });
    return `### ${names.get(r.persona)}: ${r.script} (amostra ${r.sample + 1})\n\n${lines.join("\n")}`;
  });
  return `# Avaliação do chat das personas (${label})\n\nModelo: ${model}, opções ${JSON.stringify(CHAT_OPTIONS)}, sem memória.\n\n${summary(results, personas)}\n\n${sections.join("\n\n")}\n`;
}

const all = (await loadPersonas(args.personas)).map(profile);
const personas = args.so ? all.filter((p) => args.so!.split(",").includes(p.nickname)) : all;
const samples = Number(args.amostras);
const total = personas.length * SCRIPTS.length * samples;
console.log(`${personas.length} personas, ${SCRIPTS.length} roteiros, ${samples} amostra(s): ${total} conversas`);

const results: Result[] = [];
const t0 = Date.now();
for (let sample = 0; sample < samples; sample++) {
  for (const persona of personas) {
    for (const script of SCRIPTS) {
      results.push({ persona: persona.nickname, script: script.name, sample, exchanges: await converse(persona, script.turns) });
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
