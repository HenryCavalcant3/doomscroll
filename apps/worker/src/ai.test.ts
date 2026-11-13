import { describe, expect, it, vi } from "vitest";
import {
  buildCommentPrompt,
  buildTopicPrompt,
  EMBED_DIM,
  EXAMPLES_PER_PROMPT,
  embeddingText,
  MAX_COMMENT,
  OllamaClient,
  parseComment,
  parseSuggestion,
  pickExamples,
  topicSchema,
} from "./ai.js";

const topics = [
  { slug: "humor", name: "Humor" },
  { slug: "animais", name: "Animais" },
  { slug: "dicas", name: "Dicas" },
];
const slugs = topics.map((t) => t.slug);
const video = { title: "Cachorro abre a geladeira", hashtags: ["cachorro"], sourceDescription: null, transcript: "olha só isso".repeat(500) };

describe("prompt de tópicos", () => {
  it("lista só os tópicos permitidos, traz exemplos e corta a transcrição", () => {
    const prompt = buildTopicPrompt(video, topics);
    expect(prompt).toContain("- animais (Animais)");
    expect(prompt).toContain("Exemplo 1");
    expect(prompt).toContain("Cachorro abre a geladeira");
    expect(prompt.length).toBeLessThan(3500);
  });

  it("restringe a saída do modelo aos tópicos existentes", () => {
    expect(topicSchema(slugs).properties.topicos).toEqual({ type: "array", items: { type: "string", enum: slugs }, maxItems: 3 });
  });
});

describe("parseSuggestion", () => {
  it("descarta tópicos inventados, repetidos e o excesso", () => {
    const raw = JSON.stringify({ topicos: ["humor", "gatos-caindo", "humor", "animais", "dicas", "extra"], descricao: "  Um  cão esperto. " });
    expect(parseSuggestion(raw, [...slugs, "extra"], null)).toEqual({ topics: ["humor", "animais", "dicas"], description: "Um cão esperto." });
  });

  it("usa o título quando a resposta não é JSON", () => {
    expect(parseSuggestion("não sei", slugs, "Título")).toEqual({ topics: [], description: "Título" });
    const meta = JSON.stringify({ topicos: [], descricao: "Transcrição confusa, não identifiquei tópico claro." });
    expect(parseSuggestion(meta, slugs, "Título")).toEqual({ topics: [], description: "Título" });
    const copied = JSON.stringify({ topicos: ["humor"], descricao: "Gato derruba um copo e finge inocência." });
    expect(parseSuggestion(copied, slugs, "LA CALABAZA#meowtakeover")).toEqual({ topics: ["humor"], description: "LA CALABAZA" });
  });
});

describe("OllamaClient", () => {
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

  it("pede tópicos com schema e temperatura zero", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => ok({ response: '{"topicos":["animais"],"descricao":"Cão abre a geladeira."}' }));
    const client = new OllamaClient("http://ollama:11434", "llm", "emb", fetchImpl);
    expect(await client.suggest(video, topics)).toEqual({ topics: ["animais"], description: "Cão abre a geladeira." });
    const body = JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body));
    expect(body).toMatchObject({ model: "llm", stream: false, format: topicSchema(slugs), options: { temperature: 0 } });
  });

  it("aceita embeddings da dimensão do banco e recusa outras", async () => {
    const good = new OllamaClient("http://o", "llm", "emb", vi.fn<typeof fetch>(async () => ok({ embeddings: [Array(EMBED_DIM).fill(0.1)] })));
    expect(await good.embed("x")).toHaveLength(EMBED_DIM);
    const bad = new OllamaClient("http://o", "llm", "outro", vi.fn<typeof fetch>(async () => ok({ embeddings: [[1, 2, 3]] })));
    await expect(bad.embed("x")).rejects.toThrow(/3 dimensões/);
  });
});

it("monta o texto do embedding com prefixo de documento", () => {
  expect(embeddingText({ title: "T", description: "D", hashtags: ["a"], sourceDescription: "S", transcript: null })).toBe(
    "search_document: T\nD\nS\n#a",
  );
});

describe("comentário da persona", () => {
  const persona = {
    userId: "u1",
    nickname: "tio_valdir",
    name: "Tio Valdir",
    bio: "Tio do bunker.",
    tone: "Animado.",
    examples: ["Bom dia, sobreviventes!", "KKKK"],
  };
  const v = { title: "Gato pula no sofá", description: "Um gato pula no sofá.", topics: ["Animais"] };

  it("usa a voz da persona e só pede o tema apocalipse quando sorteado", () => {
    const normal = buildCommentPrompt(persona, v, false);
    expect(normal).toContain("Você é Tio Valdir");
    expect(normal).toContain("- Bom dia, sobreviventes!");
    expect(normal).toContain("Tópicos: Animais");
    expect(normal).toContain("Não fale de fim do mundo");
    expect(buildCommentPrompt(persona, v, true)).toContain("quando a internet acabar");
    expect(normal).not.toContain("O que se ouve");
  });

  it("mostra só as frases sorteadas e o começo da transcrição, quando houver", () => {
    const prompt = buildCommentPrompt(persona, { ...v, transcript: "miau ".repeat(200) }, false, ["KKKK"]);
    expect(prompt).toContain("- KKKK");
    expect(prompt).not.toContain("Bom dia, sobreviventes!");
    expect(prompt).toMatch(/O que se ouve no começo: (miau ){20}/);
    expect(prompt.length).toBeLessThan(buildCommentPrompt(persona, v, false).length + 500);
  });

  it("sorteia frases de exemplo sem repetir", () => {
    const examples = ["a", "b", "c", "d", "e", "f"];
    const picked = pickExamples(examples);
    expect(picked).toHaveLength(EXAMPLES_PER_PROMPT);
    expect(new Set(picked).size).toBe(EXAMPLES_PER_PROMPT);
    expect(picked.every((e) => examples.includes(e))).toBe(true);
    expect(pickExamples(["a", "b"])).toHaveLength(2);
    expect(examples).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("limpa aspas e hashtags e corta comentários longos", () => {
    expect(parseComment('{"comentario": "\\"Que lindo!! #gato #fofo\\""}')).toBe("Que lindo!!");
    expect(parseComment(JSON.stringify({ comentario: "a".repeat(500) }))!.length).toBeLessThanOrEqual(MAX_COMMENT + 1);
  });

  it("recusa resposta vazia ou fora do formato", () => {
    expect(parseComment("não é json")).toBeNull();
    expect(parseComment('{"comentario": "  "}')).toBeNull();
    expect(parseComment('{"outra": "coisa"}')).toBeNull();
  });
});

