import { beforeEach, describe, expect, it } from "vitest";
import type { GossipTopic, RawDay } from "./bulletin.js";
import { runBulletinJob, type BulletinGenDb, type BulletinRow, type BulletinStatus } from "./bulletinGen.js";
import type { BulletinVoice } from "./bulletinText.js";
import type { PairActivity, PersonaActivity } from "./gossip.js";

const voice = (nickname: string, name: string): BulletinVoice => ({
  id: `p-${nickname}`,
  nickname,
  name,
  bio: "bio",
  tone: "tom",
  manchetes: ["m1", "m2", "m3"],
  fofocas: ["f1", "f2", "f3"],
  dia_parado: [`${name} parado`],
});
// 2026-11-13 é o dia 317; 317 % 5 = 2 → kelly (ordem: capitao_enlatado, dona_neide, kelly, rato, tio_valdir)
const VOICES = [voice("tio_valdir", "Tio Valdir"), voice("rato", "Rato"), voice("kelly", "Kelly"), voice("dona_neide", "Dona Neide"), voice("capitao_enlatado", "Capitão Enlatado")];
const NOW = new Date(2026, 10, 14, 0, 15);

const busyDay = (over: Partial<RawDay> = {}): RawDay => ({
  novos: 3,
  topicos: [{ slug: "esporte", name: "Esporte", count: 3 }],
  abastecedores: ["ana"],
  inaugurados: [],
  autonomiaSegundos: 900,
  curtidas: { moradores: 20, personas: 10 },
  comentarios: { moradores: 5, personas: 5 },
  moradoresAtivos: 3,
  eventosReais: 40,
  topicScores: [{ slug: "esporte", name: "Esporte", sensitive: false, score: 30 }],
  videoCandidates: [{ id: "v1", likes: 9, comments: 1, approvedAt: null, sensitive: false }],
  ...over,
});

class FakeDb implements BulletinGenDb {
  days = new Set<string>();
  rows = new Map<string, BulletinRow | { status: BulletinStatus }>();
  usedPautas: string[] = [];
  activity = false;
  raw: RawDay = busyDay();
  acts: { personas: PersonaActivity[]; pairs: PairActivity[] } = { personas: [], pairs: [] };
  topics: GossipTopic[] = [{ id: "gerador", text: "O gerador roncou de madrugada.", active: true, lastUsedAt: null }];
  recent: { headline: number[] | null; gossip: number[] | null }[] = [];

  async markDay(date: string) {
    this.days.add(date);
  }
  async wasOn(date: string) {
    return this.days.has(date);
  }
  async hadActivity() {
    return this.activity;
  }
  async status(date: string) {
    return this.rows.get(date)?.status ?? null;
  }
  async begin(date: string) {
    const s = this.rows.get(date)?.status;
    if (s && s !== "pendente") return false;
    this.rows.set(date, { status: "pendente" });
    return true;
  }
  async save(row: BulletinRow) {
    this.rows.set(row.date, row);
  }
  async fail(date: string) {
    this.rows.set(date, { status: "falhou" });
  }
  published = new Set<string>();
  async unpublished(date: string) {
    const s = this.rows.get(date)?.status;
    return (s === "pronto" || s === "curto") && !this.published.has(date);
  }
  async voices() {
    return VOICES;
  }
  async residents() {
    return ["ana", "leo"];
  }
  sensitive = ["Política", "Notícias"];
  async sensitiveTopics() {
    return this.sensitive;
  }
  async collectDay() {
    return this.raw;
  }
  async personaActivity() {
    return this.acts;
  }
  async gossipTopics() {
    return this.topics;
  }
  async markPautaUsed(id: string) {
    this.usedPautas.push(id);
  }
  async recentEmbeddings() {
    return this.recent;
  }
  row(date = "2026-11-13") {
    return this.rows.get(date) as BulletinRow;
  }
}

/** LLM falsa: devolve as respostas na ordem e guarda os prompts. */
function llm(...answers: string[]) {
  const prompts: string[] = [];
  return {
    prompts,
    generate: async (prompt: string) => {
      prompts.push(prompt);
      const a = answers.shift();
      if (a === undefined) throw new Error("sem resposta");
      return a;
    },
  };
}
const j = (key: string, text: string) => JSON.stringify({ [key]: text });

let announced: string[] = [];
function run(db: FakeDb, model = llm(), embed: (t: string) => Promise<number[]> = async () => [Math.random(), Math.random(), 1]) {
  return runBulletinJob({ db, generate: model.generate, embed, now: () => NOW, random: () => 0, publish: async (d) => void announced.push(d) });
}

const historyFor = (id: string, name: string, today: Partial<PersonaActivity["today"]>): PersonaActivity => {
  const c = { likes: 0, comments: 0, groupMessages: 0, videoTargets: 0 };
  return { id, name, today: { ...c, ...today }, past: Array.from({ length: 7 }, () => ({ ...c })) };
};

describe("job do boletim", () => {
  beforeEach(() => {
    announced = [];
  });

  it("pronto ou curto, avisa a api para publicar no grupo; se ainda não está lá, avisa de novo no próximo job", async () => {
    const db = new FakeDb();
    db.activity = true;
    expect(await run(db, llm(j("manchete", "dia de esporte no bunker"), j("fofoca", "o gerador roncou de novo")))).toBe("pronto");
    expect(announced).toEqual(["2026-11-13"]);
    await run(db);
    expect(announced).toEqual(["2026-11-13", "2026-11-13"]);
    db.published.add("2026-11-13");
    await run(db);
    expect(announced).toHaveLength(2);
    // Falhou: nada a publicar.
    const failed = new FakeDb();
    failed.rows.set("2026-11-13", { status: "falhou" });
    announced = [];
    await run(failed);
    expect(announced).toEqual([]);
  });

  it("marca hoje como ligado e não gera nada se ontem esteve desligado", async () => {
    const db = new FakeDb();
    expect(await run(db)).toBeNull();
    expect(db.days.has("2026-11-14")).toBe(true);
    expect(db.rows.size).toBe(0);
  });

  it("recuperação: sem registro de ontem, mas com movimento, gera e marca o dia", async () => {
    const db = new FakeDb();
    db.activity = true;
    expect(await run(db, llm(j("manchete", "dia de esporte no bunker"), j("fofoca", "o gerador roncou de novo")))).toBe("pronto");
    expect(db.days.has("2026-11-13")).toBe(true);
  });

  it("não refaz boletim pronto, curto ou que falhou; refaz o pendente", async () => {
    for (const status of ["pronto", "curto", "falhou"] as const) {
      const db = new FakeDb();
      db.days.add("2026-11-13");
      db.rows.set("2026-11-13", { status });
      expect(await run(db)).toBeNull();
    }
    const db = new FakeDb();
    db.days.add("2026-11-13");
    db.rows.set("2026-11-13", { status: "pendente" });
    expect(await run(db, llm(j("manchete", "dia de esporte"), j("fofoca", "o gerador roncou")))).toBe("pronto");
  });

  it("dia parado: curto, sem LLM e sem fofoca", async () => {
    const db = new FakeDb();
    db.days.add("2026-11-13");
    db.raw = busyDay({ eventosReais: 0, novos: 0 });
    const model = llm();
    expect(await run(db, model)).toBe("curto");
    expect(model.prompts).toEqual([]);
    expect(db.row()).toMatchObject({ status: "curto", headline: "Kelly parado", gossip: null, gossipSource: null, personaUserId: "p-kelly" });
  });

  it("dia fraco: manchete de dia parado; fofoca segue normal", async () => {
    const db = new FakeDb();
    db.days.add("2026-11-13");
    db.raw = busyDay({ eventosReais: 3 });
    const model = llm(j("fofoca", "o gerador roncou de madrugada, que medo"));
    expect(await run(db, model)).toBe("pronto");
    expect(db.row()).toMatchObject({ headline: "Kelly parado", gossip: "o gerador roncou de madrugada, que medo", gossipSource: "pauta", gossipRef: "gerador" });
    expect(model.prompts).toHaveLength(1);
    expect(db.usedPautas).toEqual(["gerador"]);
  });

  it("assunto sensível: manchete de dia parado, sem vídeo", async () => {
    const db = new FakeDb();
    db.days.add("2026-11-13");
    db.raw = busyDay({
      topicScores: [{ slug: "politica", name: "Política", sensitive: true, score: 50 }],
      videoCandidates: [{ id: "v1", likes: 9, comments: 0, approvedAt: null, sensitive: true }],
    });
    await run(db, llm(j("fofoca", "o gerador roncou")));
    expect(db.row()).toMatchObject({ headline: "Kelly parado", topVideoId: null });
  });

  it("duas respostas inválidas: manchete de modelo fixo", async () => {
    const db = new FakeDb();
    db.days.add("2026-11-13");
    await run(db, llm(j("manchete", "foram 42 curtidas"), j("manchete", "a ana mandou bem"), j("fofoca", "o gerador roncou")));
    expect(db.row().headline).toBe("O assunto de ontem no bunker foi esporte.");
  });

  it("LLM fora do ar: reservas nas duas frases, boletim sai mesmo assim", async () => {
    const db = new FakeDb();
    db.days.add("2026-11-13");
    expect(await run(db, llm())).toBe("pronto");
    expect(db.row()).toMatchObject({ headline: "O assunto de ontem no bunker foi esporte.", gossip: "O gerador roncou de madrugada.", gossipSource: "pauta" });
  });

  it("manchete repetida tenta de novo", async () => {
    const db = new FakeDb();
    db.days.add("2026-11-13");
    db.recent = [{ headline: [1, 0, 0], gossip: null }];
    const vectors = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    await run(db, llm(j("manchete", "futebol de novo"), j("manchete", "esporte o dia todo"), j("fofoca", "o gerador roncou")), async () => vectors.shift()!);
    expect(db.row().headline).toBe("esporte o dia todo");
  });

  it("fato curioso: vai para a LLM só quem e o quê, e a fofoca precisa citar a persona", async () => {
    const db = new FakeDb();
    db.days.add("2026-11-13");
    db.acts = { personas: [historyFor("p-rato", "Rato", { likes: 6 })], pairs: [] };
    const model = llm(j("manchete", "dia de esporte"), j("fofoca", "alguém curtiu tudo"), j("fofoca", "o Rato quase nunca curte e ontem curtiu vídeo, gente!"));
    await run(db, model);
    expect(db.row()).toMatchObject({ gossip: "o Rato quase nunca curte e ontem curtiu vídeo, gente!", gossipSource: "fato", gossipRef: "curtiu_raro" });
    expect(model.prompts[1]).toContain('<fofoca>{"quem":"Rato","o_que":"quase nunca curte nada e ontem saiu curtindo vídeo"}</fofoca>');
    expect(db.usedPautas).toEqual([]);
  });

  it("a persona de plantão não faz fofoca de si mesma: cai na pauta", async () => {
    const db = new FakeDb();
    db.days.add("2026-11-13");
    db.acts = { personas: [historyFor("p-kelly", "Kelly", { likes: 6 })], pairs: [] };
    await run(db, llm(j("manchete", "dia de esporte"), j("fofoca", "o gerador roncou")));
    expect(db.row().gossipSource).toBe("pauta");
  });

  it("erro inesperado marca falhou", async () => {
    const db = new FakeDb();
    db.days.add("2026-11-13");
    db.collectDay = async () => {
      throw new Error("banco caiu");
    };
    expect(await run(db)).toBe("falhou");
    expect(db.rows.get("2026-11-13")?.status).toBe("falhou");
  });
});
