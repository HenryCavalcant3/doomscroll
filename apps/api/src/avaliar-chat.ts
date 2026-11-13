/**
 * Bancada de avaliação do chat com as personas: roda conversas roteirizadas com cada persona,
 * com o mesmo prompt e as mesmas regras do app (sem gravar nada no banco), e escreve um relatório
 * com números e as conversas inteiras.
 *
 * Uso (com o Ollama acessível):
 *   OLLAMA_URL=... pnpm --filter @doomscroll/api avaliar -- [--amostras 2] [--so rato,kelly] [--roteiros memória,longa] [--saida ../../avaliacao]
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { MessageView } from "./chat.js";
import { chatStream } from "./ollama.js";
import { CHAT_OPTIONS, HISTORY, generateReply, type PersonaProfile } from "./personaChat.js";
import { DEFAULT_PERSONAS_DIR, loadPersonas } from "./personas.js";

const { values: args } = parseArgs({
  options: {
    amostras: { type: "string", default: "1" },
    personas: { type: "string", default: DEFAULT_PERSONAS_DIR },
    so: { type: "string" },
    roteiros: { type: "string" },
    /** repeat_penalty do Ollama, para comparar com o padrão do app. */
    repeticao: { type: "string" },
    saida: { type: "string", default: fileURLToPath(new URL("../../../avaliacao", import.meta.url)) },
    rotulo: { type: "string", default: `chat-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}` },
  },
});

const ollamaUrl = process.env.OLLAMA_URL ?? "http://localhost:11434";
const model = process.env.LLM_MODEL ?? "qwen2.5:3b";
const CONTACT = "visitante";
const options = { ...CHAT_OPTIONS, ...(args.repeticao ? { repeat_penalty: Number(args.repeticao) } : {}) };

/** Uma fala do contato: texto, ou um vídeo compartilhado (título e descrição). */
type Turn = string | { title: string; description: string };

/** Fala com conferência: a resposta precisa citar o que foi dito antes (memória ou conversa). */
interface Checked {
  turn: Turn;
  expect: RegExp;
}

interface Script {
  name: string;
  /** Resumo que a persona já guarda do contato (como o job persona.memory grava). */
  memory?: string;
  turns: (Turn | Checked)[];
}

const isChecked = (t: Turn | Checked): t is Checked => typeof t === "object" && "expect" in t;

/**
 * Roteiros com o que costuma dar errado: cumprimento, pergunta direta, vídeo, assunto pessoal,
 * memória, conversa longa, provocação, entrada estranha, vídeo sem informação e assunto delicado.
 */
const SCRIPTS: Script[] = [
  { name: "chegada", turns: ["oi! tudo bem? acabei de chegar", "o que você mais gosta de assistir aqui?", "e o que você acha dos vídeos de dança?"] },
  {
    name: "vídeo",
    turns: [{ title: "Gato derruba copo da mesa", description: "Um gato empurra um copo de água devagar até ele cair no chão." }, "kkkk o que achou?", "o meu gato faz igual"],
  },
  { name: "pessoal", turns: ["hoje meu dia foi péssimo, perdi o ônibus e cheguei atrasado", "você já teve um dia assim?", "valeu pela conversa"] },
  {
    name: "memória",
    memory: "@visitante se chama João, mora em Recife, torce para o Sport e tem um cachorro chamado Pipoca.",
    turns: [
      "oi, sumido! lembra de mim?",
      { turn: "como é o nome do meu cachorro mesmo?", expect: /pipoca/i },
      { turn: "e pra qual time eu torço?", expect: /sport/i },
    ],
  },
  {
    name: "longa",
    turns: [
      "oi! meu nome é Carla, sou enfermeira e moro em Belém",
      "hoje o plantão foi puxado",
      "você gosta de açaí?",
      "aqui a gente toma com peixe frito",
      { turn: "você lembra meu nome e onde eu moro?", expect: /carla|bel[eé]m/i },
      "o que você fez hoje?",
      "e amanhã, vai fazer o quê?",
      "eu vou ver um filme de terror",
      "você tem medo de alguma coisa?",
      "qual foi o melhor vídeo que você viu essa semana?",
      "e o pior?",
      "bom, vou dormir. boa noite!",
    ],
  },
  { name: "provocação", turns: ["você é um robô?", "fala sério, você é uma IA né", "que conversa chata, você é muito sem graça"] },
  {
    name: "estranha",
    turns: [
      "😂😂😂",
      "hey, what's up? do you speak english?",
      "então, deixa eu te contar uma coisa que aconteceu comigo ontem, eu tava no mercado procurando aquele biscoito que eu gosto e não achava de jeito nenhum, aí perguntei pro moço do mercado e ele disse que tinha acabado, aí eu fui em outro mercado e lá também não tinha, e no terceiro mercado finalmente achei mas tava o dobro do preço, acredita?",
      "?",
    ],
  },
  { name: "vídeo vazio", turns: [{ title: "", description: "" }, "viu esse? o que achou?"] },
  { name: "delicado", turns: ["tô muito triste ultimamente, sem vontade de nada", "em quem você vai votar na próxima eleição?"] },
];

interface Exchange {
  said: string;
  /** Conferência: true/false quando a fala tinha `expect`. */
  recalled?: boolean;
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

const said = (turn: Turn) => (typeof turn === "string" ? turn : `[vídeo: ${turn.title || "sem título"}]`);

async function converse(persona: PersonaProfile, script: Script): Promise<Exchange[]> {
  const history: MessageView[] = [];
  const exchanges: Exchange[] = [];
  for (const step of script.turns) {
    const turn = isChecked(step) ? step.turn : step;
    history.push(message(CONTACT, false, turn));
    const started = Date.now();
    // Um erro (Ollama fora, tempo esgotado) vira resposta que falhou, sem derrubar a rodada.
    const { text, rejected } = await generateReply(
      (messages, stop, onText, signal) =>
        chatStream({ baseUrl: ollamaUrl, model, messages, options: { ...options, stop }, timeoutMs: 120_000, signal }, onText),
      persona,
      CONTACT,
      script.memory ?? "",
      // Como no app: só as últimas HISTORY mensagens entram no prompt.
      history.slice(-HISTORY),
      () => {},
      AbortSignal.timeout(300_000),
    ).catch((err: unknown) => ({ text: "", rejected: [`erro: ${err instanceof Error ? err.message : String(err)}`] }));
    const recalled = isChecked(step) ? step.expect.test(text) : undefined;
    exchanges.push({ said: said(turn), reply: text, rejected, ms: Date.now() - started, recalled });
    // Sem resposta, a conversa segue como no app: a próxima mensagem do contato vem logo depois.
    if (text) history.push(message(persona.nickname, true, text));
  }
  return exchanges;
}

const words = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").match(/\p{L}+/gu) ?? [];
/** Frase de assistente ("se precisar", "posso ajudar"), que não combina com uma pessoa da rede. */
const ASSISTANT = /precis(ar|e) de|(posso|em|feliz em) ajudar|auxiliar|à vontade|estou aqui|estarei aqui/i;
const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "-");

function summary(results: Result[], personas: PersonaProfile[]): string {
  const rows = personas.map((p) => {
    const mine = results.filter((r) => r.persona === p.nickname);
    const all = mine.flatMap((r) => r.exchanges);
    const checks = all.filter((e) => e.recalled !== undefined);
    const recalled = checks.filter((e) => e.recalled).length;
    // Mesmas 3 primeiras palavras de uma resposta anterior da mesma conversa.
    let repeated = 0;
    for (const r of mine) {
      const seen = new Set<string>();
      for (const e of r.exchanges.filter((x) => x.reply)) {
        const key = words(e.reply).slice(0, 3).join(" ");
        if (seen.has(key)) repeated++;
        seen.add(key);
      }
    }
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
    return `| ${p.name} | ${all.length} | ${pct(ok.length, all.length)} | ${pct(first.length, all.length)} | ${avg} | ${pct(helper, ok.length)} | ${pct(recalled, checks.length)} | ${pct(repeated, ok.length)} | ${secs}s | "${topOpening}" (${pct(topCount, ok.length)}) |`;
  });
  return [
    "| Persona | Mensagens | Respondeu | Na 1ª tentativa | Tamanho médio | Fala de assistente | Lembrou | Abertura repetida na conversa | Tempo médio | Abertura mais comum |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...rows,
  ].join("\n");
}

function report(results: Result[], personas: PersonaProfile[], label: string): string {
  const names = new Map(personas.map((p) => [p.nickname, p.name]));
  const sections = results.map((r) => {
    const lines = r.exchanges.flatMap((e) => {
      const reply = e.reply || "**FALHOU**";
      const retries = e.rejected.length ? ` _(recusadas: ${e.rejected.map((x) => `“${x}”`).join(" / ")})_` : "";
      const mark = e.recalled === undefined ? "" : e.recalled ? " ✅" : " ❌ (não lembrou)";
      return [`- **@${CONTACT}**: ${e.said}`, `- **${names.get(r.persona)}**: ${reply}${mark}${retries}`];
    });
    return `### ${names.get(r.persona)}: ${r.script} (amostra ${r.sample + 1})\n\n${lines.join("\n")}`;
  });
  return `# Avaliação do chat das personas (${label})\n\nModelo: ${model}, opções ${JSON.stringify(options)}, histórico de ${HISTORY} mensagens. ✅/❌ = lembrou ou não do que foi dito antes.\n\n${summary(results, personas)}\n\n${sections.join("\n\n")}\n`;
}

const all = (await loadPersonas(args.personas)).map(profile);
const personas = args.so ? all.filter((p) => args.so!.split(",").includes(p.nickname)) : all;
const scripts = args.roteiros ? SCRIPTS.filter((s) => args.roteiros!.split(",").includes(s.name)) : SCRIPTS;
const samples = Number(args.amostras);
const total = personas.length * scripts.length * samples;
console.log(`${personas.length} personas, ${scripts.length} roteiros, ${samples} amostra(s): ${total} conversas`);

const results: Result[] = [];
const t0 = Date.now();
for (let sample = 0; sample < samples; sample++) {
  for (const persona of personas) {
    for (const script of scripts) {
      results.push({ persona: persona.nickname, script: script.name, sample, exchanges: await converse(persona, script) });
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
