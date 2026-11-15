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
  boletim: {
    manchetes: ["Bom dia, sobreviventes!", "Estoque novo!", "Dia de futebol!"],
    fofocas: ["A Kelly comentou em tudo.", "O Rato curtiu um vídeo.", "A Neide mandou vídeo."],
    dia_parado: ["Dia calmo.", "Ninguém apareceu.", "Bunker quietinho."],
  },
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

  it("boletim: três tipos de frase, sem número e no limite de palavras", () => {
    const b = valid.boletim;
    expect(validatePersona({ ...valid, boletim: undefined }, "tio-valdir.json", avatars)).toEqual(["boletim: objeto { manchetes, fofocas, dia_parado }"]);
    expect(validatePersona({ ...valid, boletim: { ...b, fofocas: ["Uma.", "Duas."] } }, "tio-valdir.json", avatars)).toEqual(["boletim.fofocas: de 3 a 10 frases"]);
    expect(validatePersona({ ...valid, boletim: { ...b, manchetes: [...b.manchetes, "O bunker ganhou 7 vídeos."] } }, "tio-valdir.json", avatars)).toEqual([
      "boletim.manchetes: sem números (escreva por extenso)",
    ]);
    const longa = "uma duas três quatro cinco seis sete oito nove dez onze doze treze catorze quinze";
    expect(validatePersona({ ...valid, boletim: { ...b, dia_parado: [...b.dia_parado, longa] } }, "tio-valdir.json", avatars)).toEqual([
      "boletim.dia_parado: até 14 palavras por frase",
    ]);
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

  it("não deixa persona usar o avatar de um morador", () => {
    const withLanterna = new Set([...avatars, "lanterna.svg"]);
    expect(validatePersona({ ...valid, avatar: "lanterna.svg" }, "tio-valdir.json", withLanterna)).toEqual([
      "avatar: lanterna.svg é um item dos moradores; persona precisa de um desenho próprio",
    ]);
  });

  it("exige que o nome do arquivo combine com o apelido", () => {
    expect(validatePersona(valid, "valdir.json", avatars)).toEqual(["o arquivo deve se chamar tio-valdir.json"]);
  });
});
