import { describe, expect, it } from "vitest";
import { clampScore, viewDelta } from "./affinity.js";
import { BASE_WEIGHT, pickFeed, QUARANTINE_MS, sample, weightOf, type Candidate } from "./recommend.js";

const cand = (id: string, topicIds: number[] = [], extra: Partial<Candidate> = {}): Candidate => ({
  id,
  topicIds,
  liked: false,
  lastViewedAt: null,
  ...extra,
});

/** Sorteio com sequência fixa (repete o último valor quando acaba). */
const seq = (...values: number[]) => {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)]!;
};

describe("viewDelta", () => {
  it("sobe com o vídeo visto até o fim e com replays (limitados)", () => {
    expect(viewDelta({ watchedMs: 20_000, watchPct: 0.95, replays: 0 })).toEqual({ skipped: false, delta: 1 });
    expect(viewDelta({ watchedMs: 40_000, watchPct: 1, replays: 2 })).toEqual({ skipped: false, delta: 2 });
    expect(viewDelta({ watchedMs: 99_000, watchPct: 1, replays: 9 }).delta).toBe(2.5);
  });

  it("desce com pulo rápido e não mexe no meio-termo", () => {
    expect(viewDelta({ watchedMs: 1500, watchPct: 0.5, replays: 0 })).toEqual({ skipped: true, delta: -1 });
    expect(viewDelta({ watchedMs: 5000, watchPct: 0.1, replays: 0 })).toEqual({ skipped: true, delta: -1 });
    expect(viewDelta({ watchedMs: 8000, watchPct: 0.5, replays: 0 })).toEqual({ skipped: false, delta: 0 });
  });

  it("mantém o score na faixa", () => {
    expect(clampScore(99)).toBe(10);
    expect(clampScore(-99)).toBe(-5);
  });
});

describe("weightOf", () => {
  it("soma a média positiva da afinidade ao peso base", () => {
    const aff = new Map([[1, 4], [2, -2]]);
    expect(weightOf(cand("a"), aff)).toBe(BASE_WEIGHT);
    expect(weightOf(cand("a", [1]), aff)).toBe(BASE_WEIGHT + 4);
    expect(weightOf(cand("a", [1, 2]), aff)).toBe(BASE_WEIGHT + 1);
    expect(weightOf(cand("a", [2]), aff)).toBe(BASE_WEIGHT);
  });
});

describe("sample", () => {
  const aff = new Map([[1, 9.8]]);
  const cands = [cand("frio", [2]), cand("quente", [1])];

  it("sorteia pelo peso fora da exploração", () => {
    // 0.5 não explora; 0.5 do total (0.2 + 10) cai em "quente".
    expect(sample(cands, aff, 1, seq(0.5, 0.5)).map((c) => c.id)).toEqual(["quente"]);
  });

  it("na exploração ignora a afinidade", () => {
    expect(sample(cands, aff, 1, seq(0.1, 0)).map((c) => c.id)).toEqual(["frio"]);
  });

  it("não repete e para quando acabam os candidatos", () => {
    expect(sample(cands, aff, 5, seq(0.5)).map((c) => c.id).sort()).toEqual(["frio", "quente"]);
  });
});

describe("pickFeed", () => {
  const now = 10 * QUARANTINE_MS;
  const rng = seq(0.5);

  it("tira os já entregues e os vistos em quarentena", () => {
    const cands = [cand("a"), cand("b", [], { lastViewedAt: now - 1000 }), cand("c", [], { lastViewedAt: now - QUARANTINE_MS })];
    const pick = pickFeed(cands, new Map(), ["a"], 5, now, rng);
    expect(pick).toEqual({ ids: ["c"], restarted: false });
  });

  it("com tudo em quarentena, volta curtidos e depois os vistos há mais tempo", () => {
    const cands = [
      cand("recente", [], { lastViewedAt: now - 10 }),
      cand("antigo", [], { lastViewedAt: now - 1000 }),
      cand("curtido", [], { lastViewedAt: now - 5, liked: true }),
    ];
    expect(pickFeed(cands, new Map(), [], 5, now, rng)).toEqual({ ids: ["curtido", "antigo", "recente"], restarted: false });
  });

  it("recomeça quando tudo já foi entregue", () => {
    const cands = [cand("a"), cand("b")];
    expect(pickFeed(cands, new Map(), ["a", "b"], 5, now, rng)).toMatchObject({ restarted: true });
    expect(pickFeed([], new Map(), ["a"], 5, now, rng)).toEqual({ ids: [], restarted: false });
  });
});
