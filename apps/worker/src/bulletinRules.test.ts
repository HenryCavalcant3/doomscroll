/**
 * As cinco Regras fixas do Boletim do Bunker (docs/boletim/BOLETIM.md), um bloco por regra.
 * Aqui ficam as partes puras; o SQL é conferido em bulletinDb.test.ts (com banco) e a saída da LLM
 * ganha os seus testes junto com a geração.
 */
import { describe, expect, it } from "vitest";
import { buildFacts, pickPauta, dayWindow, type BulletinFacts, type RawDay } from "./bulletin.js";
import { curiousFacts, factForLlm, pickCuriousFact, type Counts, type PersonaActivity } from "./gossip.js";

const raw = (over: Partial<RawDay> = {}): RawDay => ({
  novos: 2,
  topicos: [{ slug: "humor", name: "Humor", count: 2 }],
  abastecedores: ["ana"],
  inaugurados: [],
  autonomiaSegundos: 600,
  curtidas: { moradores: 3, personas: 4 },
  comentarios: { moradores: 1, personas: 2 },
  moradoresAtivos: 2,
  eventosReais: 9,
  topicScores: [{ slug: "humor", name: "Humor", sensitive: false, score: 10 }],
  videoCandidates: ["a", "b", "c", "d", "e"].map((id, i) => ({ id: `00000000-0000-4000-8000-00000000000${i}`, likes: 9 - i, comments: 0, approvedAt: null, sensitive: false })),
  ...over,
});

/** Todas as chaves do objeto, em profundidade, como caminhos ("movimento.curtidas.total"). */
function paths(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value)) return value.flatMap((v) => paths(v, `${prefix}[]`));
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([k, v]) => paths(v, prefix ? `${prefix}.${k}` : k));
}

const c = (over: Partial<Counts> = {}): Counts => ({ likes: 0, comments: 0, groupMessages: 0, videoTargets: 0, ...over });
const persona = (id: string, today: Partial<Counts>): PersonaActivity => ({ id, name: id, today: c(today), past: Array.from({ length: 7 }, () => c()) });

/** O formato completo dos fatos guardados: qualquer campo novo precisa passar por aqui (e pelas regras). */
const FACT_PATHS = [
  "date",
  "estoque.novos",
  "estoque.topicos[].slug",
  "estoque.topicos[].name",
  "estoque.topicos[].count",
  "estoque.abastecedores[]",
  "estoque.inaugurados[].slug",
  "estoque.inaugurados[].name",
  "estoque.autonomiaSegundos",
  "movimento.curtidas.total",
  "movimento.curtidas.moradores",
  "movimento.curtidas.personas",
  "movimento.comentarios.total",
  "movimento.comentarios.moradores",
  "movimento.comentarios.personas",
  "movimento.moradores",
  "assunto.slug",
  "assunto.name",
  "assunto.sensitive",
  "maisCurtido.videoId",
  "eventosReais",
];

describe("Regra fixa 1: só entra o que qualquer morador já poderia ver", () => {
  it("os fatos do dia não têm nenhum campo de mensagem", () => {
    const facts = buildFacts("2026-11-13", raw({ inaugurados: [{ slug: "comida", name: "Comida" }] }));
    expect(new Set(paths(facts))).toEqual(new Set(FACT_PATHS));
    expect(JSON.stringify(facts)).not.toMatch(/mensag|message|conversa/i);
  });

  it("para a LLM, o fato curioso leva só quem, o quê e a intensidade", () => {
    const [f] = curiousFacts([persona("rato", { likes: 5 })], []);
    expect(Object.keys(factForLlm(f!)).sort()).toEqual(["intensidade", "o_que", "quem"]);
  });

  it("par com alguém que não é persona é ignorado", () => {
    expect(curiousFacts([persona("rato", {})], [{ a: "rato", b: "morador", today: 40, pastTotal: 0, pastDays: 7 }])).toEqual([]);
  });
});

describe("Regra fixa 2: o boletim não é uma porta para o acervo", () => {
  const uuids = (f: BulletinFacts) => JSON.stringify(f).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? [];

  it("com cinco candidatos, só o mais curtido entra", () => {
    const facts = buildFacts("2026-11-13", raw());
    expect(uuids(facts)).toEqual(["00000000-0000-4000-8000-000000000000"]);
  });

  it("mais curtido de tópico sensível: nenhum vídeo", () => {
    const facts = buildFacts("2026-11-13", raw({ videoCandidates: raw().videoCandidates.map((v) => ({ ...v, sensitive: true })) }));
    expect(uuids(facts)).toEqual([]);
    expect(facts.maisCurtido).toBeNull();
  });
});

describe("Regra fixa 3: todo número vem do SQL", () => {
  it("os números dos fatos são os do banco, inteiros", () => {
    const facts = buildFacts("2026-11-13", raw({ autonomiaSegundos: 600.7 }));
    expect(facts.movimento.curtidas).toEqual({ total: 7, moradores: 3, personas: 4 });
    expect(facts.estoque.autonomiaSegundos).toBe(601);
    const numbers: number[] = [];
    JSON.stringify(facts, (_k, v: unknown) => (typeof v === "number" && numbers.push(v), v));
    expect(numbers.length).toBeGreaterThan(10);
    for (const n of numbers) expect(Number.isInteger(n)).toBe(true);
  });

  it("o que vai para a LLM reescrever não tem dígito", () => {
    const facts = curiousFacts([persona("rato", { likes: 99, comments: 99, groupMessages: 99, videoTargets: 99 })], []);
    for (const f of facts) expect(JSON.stringify(factForLlm(f))).not.toMatch(/\d/);
  });
});

describe("Regra fixa 4: a fofoca fala só de personas e do bunker", () => {
  const day = dayWindow(new Date(2026, 10, 14, 1));

  it("{persona} vira sempre uma persona que não é a de plantão", () => {
    const others = [
      { id: "p-kelly", name: "Kelly" },
      { id: "p-neide", name: "Dona Neide" },
    ];
    for (let i = 0; i < 20; i++) {
      const p = pickPauta([{ id: "domino", text: "{persona} perdeu no dominó.", active: true, lastUsedAt: null }], day, others, () => i / 20);
      expect(others.map((o) => o.id)).toContain(p?.personaId);
      expect(p?.text).not.toContain("{persona}");
    }
  });

  it("o fato curioso só cita personas e nunca a de plantão", () => {
    const ps = [persona("rato", { likes: 9 }), persona("kelly", { comments: 9 })];
    const f = pickCuriousFact(ps, [{ a: "rato", b: "kelly", today: 30, pastTotal: 0, pastDays: 7 }], "rato");
    expect(f?.subjects).toEqual(["kelly"]);
  });
});

describe("Regra fixa 5: consumo individual é privado", () => {
  it("nenhum dado por morador além de quem abasteceu", () => {
    const facts = buildFacts("2026-11-13", raw());
    // Lista de pessoas: só quem cadastrou vídeo (ação pública). Moradores ativos é só uma contagem.
    expect(paths(facts).filter((p) => p.endsWith("[]"))).toEqual(["estoque.abastecedores[]"]);
    expect(typeof facts.movimento.moradores).toBe("number");
  });
});
