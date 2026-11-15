import { describe, expect, it } from "vitest";
import { DEFAULT_PAUTAS_FILE, loadPautas, parsePautas, pautaErrors } from "./pautas.js";

describe("pautas do boletim", () => {
  it("o pautas.json do repositório é válido, com ids únicos", async () => {
    const pautas = await loadPautas(DEFAULT_PAUTAS_FILE);
    expect(pautas.length).toBeGreaterThanOrEqual(20);
    expect(new Set(pautas.map((p) => p.id)).size).toBe(pautas.length);
  });

  it("aceita só o marcador {persona}, uma vez", () => {
    expect(pautaErrors("{persona} montou uma academia com latas de feijão.")).toEqual([]);
    expect(pautaErrors("{morador} sumiu com o miojo.")).toContain("só o marcador {persona} é aceito entre chaves");
    expect(pautaErrors("{persona} brigou com {persona}.")).toContain("{persona} aparece mais de uma vez");
  });

  it("recusa número e texto vazio", () => {
    expect(pautaErrors("Dois quadradinhos por pessoa.")).toEqual([]);
    expect(pautaErrors("2 quadradinhos por pessoa.")).toContain("texto com número (escreva por extenso)");
    expect(pautaErrors("  ")).toEqual(["texto vazio"]);
  });

  it("junta todos os problemas do arquivo numa mensagem só", () => {
    const run = () =>
      parsePautas({
        pautas: [
          { id: "ok", texto: "Tudo certo.", ativa: true },
          { id: "ok", texto: "Repetida.", ativa: true },
          { id: "Maiúscula", texto: "x", ativa: "sim" },
        ],
      });
    expect(run).toThrow(/ok: id repetido/);
    expect(run).toThrow(/ativa precisa ser true ou false/);
    expect(() => parsePautas({})).toThrow(/falta a lista/);
  });
});
