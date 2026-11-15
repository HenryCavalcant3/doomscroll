import { describe, expect, it } from "vitest";
import {
  buildFacts,
  dayBoundaries,
  dayKind,
  dayOfYear,
  dayWindow,
  pickOnDuty,
  pickPauta,
  pickTopic,
  pickTopVideo,
  type GossipTopic,
  type RawDay,
  type VideoCandidate,
} from "./bulletin.js";

const rawDay = (over: Partial<RawDay> = {}): RawDay => ({
  novos: 7,
  topicos: [
    { slug: "humor", name: "Humor", count: 3 },
    { slug: "esporte", name: "Esporte", count: 2 },
  ],
  abastecedores: ["ana", "leo"],
  inaugurados: [{ slug: "comida", name: "Comida" }],
  autonomiaSegundos: 13_200.4,
  curtidas: { moradores: 30, personas: 12 },
  comentarios: { moradores: 10, personas: 8 },
  moradoresAtivos: 5,
  eventosReais: 90,
  topicScores: [{ slug: "esporte", name: "Esporte", sensitive: false, score: 20 }],
  videoCandidates: [{ id: "v1", likes: 9, comments: 2, approvedAt: new Date("2026-11-01"), sensitive: false }],
  ...over,
});

describe("dia coberto", () => {
  it("ontem, da meia-noite local à seguinte", () => {
    const d = dayWindow(new Date(2026, 10, 14, 0, 5));
    expect(d.date).toBe("2026-11-13");
    expect(d.start).toEqual(new Date(2026, 10, 13));
    expect(d.end).toEqual(new Date(2026, 10, 14));
  });

  it("vira o mês e o ano", () => {
    expect(dayWindow(new Date(2027, 0, 1, 3)).date).toBe("2026-12-31");
  });

  it("limites: sete dias antes, o dia coberto e o fim dele", () => {
    const b = dayBoundaries(dayWindow(new Date(2026, 10, 14, 1)));
    expect(b).toHaveLength(9);
    expect(b[0]).toEqual(new Date(2026, 10, 6));
    expect(b[7]).toEqual(new Date(2026, 10, 13));
    expect(b[8]).toEqual(new Date(2026, 10, 14));
  });
});

describe("persona de plantão", () => {
  const ps = [{ nickname: "tio_valdir" }, { nickname: "rato" }, { nickname: "kelly" }, { nickname: "dona_neide" }, { nickname: "capitao_enlatado" }];

  it("dia do ano", () => {
    expect(dayOfYear("2026-01-01")).toBe(1);
    expect(dayOfYear("2026-11-13")).toBe(317);
    expect(dayOfYear("2028-12-31")).toBe(366);
  });

  it("rodízio pela data, em ordem de apelido, sem depender da ordem de chegada", () => {
    // 317 % 5 = 2 → capitao_enlatado, dona_neide, [kelly], rato, tio_valdir
    expect(pickOnDuty("2026-11-13", ps)?.nickname).toBe("kelly");
    expect(pickOnDuty("2026-11-13", [...ps].reverse())?.nickname).toBe("kelly");
    expect(pickOnDuty("2026-11-14", ps)?.nickname).toBe("rato");
    expect(pickOnDuty("2026-11-13", [])).toBeNull();
  });
});

describe("assunto e mais curtido", () => {
  const v = (id: string, likes: number, comments: number, approved: string, sensitive = false): VideoCandidate => ({
    id,
    likes,
    comments,
    approvedAt: new Date(approved),
    sensitive,
  });

  it("assunto: maior pontuação; empate pelo nome", () => {
    expect(
      pickTopic([
        { slug: "humor", name: "Humor", sensitive: false, score: 5 },
        { slug: "esporte", name: "Esporte", sensitive: false, score: 5 },
      ])?.slug,
    ).toBe("esporte");
    expect(pickTopic([])).toBeNull();
  });

  it("empate em curtidas: mais comentários; depois o aprovado há mais tempo", () => {
    expect(pickTopVideo([v("a", 5, 1, "2026-01-01"), v("b", 5, 3, "2026-02-01")])).toEqual({ videoId: "b" });
    expect(pickTopVideo([v("a", 5, 1, "2026-03-01"), v("b", 5, 1, "2026-02-01")])).toEqual({ videoId: "b" });
  });

  it("vencedor de tópico sensível: sem vídeo, e não passa a vez ao segundo", () => {
    expect(pickTopVideo([v("a", 9, 0, "2026-01-01", true), v("b", 2, 0, "2026-01-01")])).toBeNull();
  });
});

describe("tipo de dia", () => {
  it("parado, fraco e normal", () => {
    expect(dayKind(buildFacts("2026-11-13", rawDay({ eventosReais: 0, novos: 0 })))).toBe("parado");
    expect(dayKind(buildFacts("2026-11-13", rawDay({ eventosReais: 0, novos: 1 })))).toBe("fraco");
    expect(dayKind(buildFacts("2026-11-13", rawDay({ eventosReais: 4 })))).toBe("fraco");
    expect(dayKind(buildFacts("2026-11-13", rawDay({ eventosReais: 5 })))).toBe("normal");
  });

  it("curtidas e comentários com o total e a divisão", () => {
    const f = buildFacts("2026-11-13", rawDay());
    expect(f.movimento.curtidas).toEqual({ total: 42, moradores: 30, personas: 12 });
    expect(f.estoque.autonomiaSegundos).toBe(13_200);
  });
});

describe("pauta", () => {
  const day = dayWindow(new Date(2026, 10, 14, 1));
  const t = (id: string, text: string, lastUsedAt: Date | null = null, active = true): GossipTopic => ({ id, text, active, lastUsedAt });
  const others = [{ id: "p-kelly", name: "Kelly" }];

  it("pula as inativas e as usadas nos últimos 14 dias", () => {
    const topics = [t("velha", "A pilha acabou.", new Date(2026, 9, 1)), t("recente", "O gerador roncou.", new Date(2026, 10, 10)), t("off", "Desligada.", null, false)];
    for (let i = 0; i < 10; i++) expect(pickPauta(topics, day, others, () => i / 10)?.id).toBe("velha");
  });

  it("todas usadas há pouco: a usada há mais tempo", () => {
    const topics = [t("a", "Um.", new Date(2026, 10, 12)), t("b", "Dois.", new Date(2026, 10, 5))];
    expect(pickPauta(topics, day, others, () => 0.99)?.id).toBe("b");
  });

  it("{persona} vira o nome de outra persona", () => {
    const p = pickPauta([t("domino", "{persona} perdeu no dominó.")], day, others, () => 0);
    expect(p).toEqual({ id: "domino", text: "Kelly perdeu no dominó.", personaId: "p-kelly" });
  });

  it("sem outra persona, pauta com {persona} fica de fora", () => {
    expect(pickPauta([t("domino", "{persona} perdeu no dominó.")], day, [], () => 0)).toBeNull();
    expect(pickPauta([t("domino", "{persona} perdeu."), t("cafe", "O café é coado duas vezes.")], day, [], () => 0)?.id).toBe("cafe");
  });
});
