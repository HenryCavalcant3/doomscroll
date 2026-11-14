import { describe, expect, it } from "vitest";
import { rhythm, RITMO, validRange } from "./ritmo.js";

describe("ritmo da persona", () => {
  it("sem ritmo vale 1 o dia todo", () => {
    expect(rhythm(undefined, 3)).toBe(1);
    expect(rhythm([], 15)).toBe(1);
  });

  it("dentro da faixa vale 1 e cai fora dela até o piso", () => {
    const r = ["06-12"];
    expect(rhythm(r, 6)).toBe(1);
    expect(rhythm(r, 11)).toBe(1);
    expect(rhythm(r, 12)).toBe(0.8);
    expect(rhythm(r, 4)).toBe(0.6);
    expect(rhythm(r, 0)).toBe(RITMO.floor);
  });

  it("faixa que passa da meia-noite", () => {
    const r = ["22-03"];
    expect(rhythm(r, 23)).toBe(1);
    expect(rhythm(r, 2)).toBe(1);
    expect(rhythm(r, 3)).toBe(0.8);
    expect(rhythm(r, 21)).toBe(0.8);
    expect(rhythm(r, 12)).toBe(RITMO.floor);
  });

  it("nunca chega a zero, nem longe de tudo", () => {
    for (let h = 0; h < 24; h++) expect(rhythm(["10-11"], h)).toBeGreaterThanOrEqual(RITMO.floor);
  });

  it("valida o formato HH-HH", () => {
    expect(validRange("06-12")).toBe(true);
    expect(validRange("22-03")).toBe(true);
    expect(validRange("6-12")).toBe(false);
    expect(validRange("06-06")).toBe(false);
    expect(validRange("25-02")).toBe(false);
  });
});
