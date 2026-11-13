import { describe, expect, it } from "vitest";
import { cleanSourceDescription, cleanTranscript, copiesExample, isMetaDescription } from "./text.js";

describe("transcrição", () => {
  it("descarta marcações de música e som sem fala", () => {
    expect(cleanTranscript("(upbeat music)")).toBe("");
    expect(cleanTranscript("[MÚSICA DE FUNDO]")).toBe("");
    expect(cleanTranscript("[Burkha] [Ambient]")).toBe("");
    expect(cleanTranscript("♪ La Calabaza. ♪")).toBe("");
  });

  it("descarta frase inventada repetida", () => {
    expect(cleanTranscript("1/2 oz. 1/2 oz. 1/2 oz. 1/2 oz. 1/2 oz.")).toBe("");
  });

  it("mantém fala de verdade, sem as marcações", () => {
    expect(cleanTranscript("[risos] Olha, olha o jacaré pegando o peixe!")).toBe("Olha, olha o jacaré pegando o peixe!");
  });
});

describe("descrição do autor", () => {
  it("tira links, hashtags e menções", () => {
    expect(cleanSourceDescription("Meu gato pulando no sofá https://x.com/a #gato @fulano")).toBe("Meu gato pulando no sofá");
  });

  it("ignora descrição vazia ou só com hashtags", () => {
    expect(cleanSourceDescription("#shorts #fyp")).toBeNull();
    expect(cleanSourceDescription(undefined)).toBeNull();
  });
});

describe("descrição da IA", () => {
  it("reconhece texto sobre a transcrição em vez do vídeo", () => {
    expect(isMetaDescription("Transcrição confusa, não identifiquei tópico específico.")).toBe(true);
    expect(isMetaDescription("Pescador é surpreendido por jacaré durante pescaria.")).toBe(false);
  });
});

describe("cópia de exemplo", () => {
  const examples = ["KKKKKK esse aí sou eu no churrasco da família", "Que coisa linda, Deus abençoe quem gravou"];

  it("pega a frase inteira, ignorando pontuação e emojis", () => {
    expect(copiesExample("KKKKKK esse aí sou eu no churrasco da família 😂", examples)).toBe(true);
  });

  it("pega pedaço específico que não tem a ver com o vídeo", () => {
    expect(copiesExample("KKKKK o churrasco da família é show de bola", examples, "Gato dançando música")).toBe(true);
    expect(copiesExample("Isso aí no churrasco da família ia ser sucesso", examples, "Conta do espetinho no churrasco")).toBe(false);
  });

  it("deixa a persona usar as expressões curtas dela", () => {
    expect(copiesExample("Que coisa linda de ver, esse cachorro!", examples, "Cachorro abre a porta")).toBe(false);
  });
});
