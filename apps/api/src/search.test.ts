import { describe, expect, it } from "vitest";
import { cleanQuery, rankSearch, SEARCH } from "./search.js";

const pool = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `v${i}`, textMatch: false, similarity: 0.5 + (i % 3) * 0.01 }));

describe("rankSearch", () => {
  it("texto primeiro, depois o destaque, e nada que só seja um pouco parecido", () => {
    const ids = rankSearch([...pool(20), { id: "forte", textMatch: false, similarity: 0.7 }, { id: "palavra", textMatch: true, similarity: 0.4 }]);
    expect(ids).toEqual(["palavra", "forte"]);
  });

  it("acervo pequeno: o destaque não vale, só as palavras", () => {
    const ids = rankSearch([...pool(SEARCH.minPool - 2), { id: "forte", textMatch: false, similarity: 0.9 }]);
    expect(ids).toEqual([]);
  });

  it("limita a quantidade e aceita busca sem embedding", () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ id: `t${i}`, textMatch: true, similarity: null }));
    expect(rankSearch(many)).toHaveLength(SEARCH.limit);
  });
});

describe("cleanQuery", () => {
  it("junta espaços e recusa curta, longa ou que não é texto", () => {
    expect(cleanQuery("  gato   caindo ")).toBe("gato caindo");
    expect(cleanQuery("a")).toBeNull();
    expect(cleanQuery("x".repeat(101))).toBeNull();
    expect(cleanQuery(undefined)).toBeNull();
  });
});
