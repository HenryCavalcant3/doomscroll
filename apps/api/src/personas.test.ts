import { describe, expect, it } from "vitest";
import { crossCheck, DEFAULT_PERSONAS_DIR, loadPersonas, validatePersona, type Persona } from "./personas.js";

const valid: Persona = {
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
    expect(personas.map((p) => p.apelido)).toEqual(["capitao_enlatado", "dona_neide", "kelly", "rato", "tio_valdir"]);
  });

  it("as afinidades das personas do repositório usam só tópicos que existem", async () => {
    const topics = ["animais", "ciencia", "comida", "dicas", "esporte", "fofoca", "games", "humor", "musica", "noticias", "politica"];
    for (const p of await loadPersonas(DEFAULT_PERSONAS_DIR)) {
      expect(Object.keys(p.afinidade).filter((t) => !topics.includes(t)), p.apelido).toEqual([]);
    }
  });

  it("ritmo é opcional e, quando vem, são faixas de hora HH-HH", () => {
    expect(validatePersona({ ...valid, ritmo: ["05-09", "22-02"] }, "tio-valdir.json", avatars)).toEqual([]);
    const bad = ['ritmo: de 1 a 4 faixas de hora como "06-12" ou "22-03"'];
    expect(validatePersona({ ...valid, ritmo: ["5-9"] }, "tio-valdir.json", avatars)).toEqual(bad);
    expect(validatePersona({ ...valid, ritmo: [] }, "tio-valdir.json", avatars)).toEqual(bad);
    expect(validatePersona({ ...valid, ritmo: "05-09" }, "tio-valdir.json", avatars)).toEqual(bad);
  });

  it("relações só apontam para outras personas", () => {
    const rato = { ...valid, apelido: "rato", relacoes: { tio_valdir: "implica", rato: "eu", kelly: "?" } };
    expect(crossCheck([valid, rato])).toEqual([
      "rato: relacoes não pode incluir a própria persona",
      "rato: relacoes cita kelly, que não é uma persona",
    ]);
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
