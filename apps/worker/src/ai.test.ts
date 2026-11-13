import { describe, expect, it, vi } from "vitest";
import { buildTopicPrompt, EMBED_DIM, embeddingText, OllamaClient, parseSuggestion, topicSchema } from "./ai.js";

const topics = [
  { slug: "humor", name: "Humor" },
  { slug: "animais", name: "Animais" },
  { slug: "dicas", name: "Dicas" },
];
const slugs = topics.map((t) => t.slug);
const video = { title: "Cachorro abre a geladeira", hashtags: ["cachorro"], transcript: "olha só isso".repeat(500) };

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
  expect(embeddingText({ title: "T", description: "D", hashtags: ["a"], transcript: null })).toBe("search_document: T\nD\n#a");
});
