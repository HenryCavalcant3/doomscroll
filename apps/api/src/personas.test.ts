import { describe, expect, it } from "vitest";
import { DEFAULT_PERSONAS_DIR, loadPersonas, validatePersona } from "./personas.js";

const valid = {
  apelido: "tio_valdir",
  nome: "Tio Valdir",
  avatar: "tio-valdir.svg",
  bio: "Tio aposentado que acorda cedo.",
  tom: "Animado e carinhoso.",
  exemplos: ["Bom dia!", "KKKK", "Repassem!"],
  atividade: 0.9,
  afinidade: { humor: 0.9 },
};
const avatars = new Set(["tio-valdir.svg"]);

describe("personas", () => {
  it("as personas do repositório são válidas", async () => {
    const personas = await loadPersonas(DEFAULT_PERSONAS_DIR);
    expect(personas.map((p) => p.apelido)).toContain("tio_valdir");
  });

  it("aceita uma persona completa", () => {
    expect(validatePersona(valid, "tio-valdir.json", avatars)).toEqual([]);
  });

  it("aponta cada campo inválido", () => {
    const errors = validatePersona(
      { ...valid, apelido: "Tio Valdir", avatar: "outra.svg", exemplos: ["só uma"], atividade: 2 },
      "tio-valdir.json",
      avatars,
    );
    expect(errors.map((e) => e.split(":")[0])).toEqual(["apelido", "avatar", "exemplos", "atividade"]);
  });

  it("exige que o nome do arquivo combine com o apelido", () => {
    expect(validatePersona(valid, "valdir.json", avatars)).toEqual(["o arquivo deve se chamar tio-valdir.json"]);
  });
});
