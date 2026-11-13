import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp, slugify, type JobQueue } from "./app.js";
import { readConfig } from "./config.js";
import { hashPin } from "./pin.js";
import type { ConfirmResult, Store, Topic, VideoStatus, VideoView } from "./store.js";

const config = { ...readConfig({}), ollamaUrl: "http://ollama:11434", llmModel: "modelo-teste" };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Store em memória com o mesmo comportamento esperado do PgStore. */
class MemoryStore implements Store {
  topics: Topic[] = [
    { id: 1, name: "Humor", slug: "humor" },
    { id: 2, name: "Animais", slug: "animais" },
    { id: 3, name: "Dicas", slug: "dicas" },
  ];
  videos = new Map<string, VideoView>();
  owner = { id: "dono-1", pinHash: "" };
  private seq = 0;

  async listTopics() {
    return this.topics;
  }
  async createTopic(name: string, slug: string) {
    if (this.topics.some((t) => t.slug === slug)) return null;
    const topic = { id: this.topics.length + 1, name, slug };
    this.topics.push(topic);
    return topic;
  }
  async findActiveVideoBySource(url: string) {
    for (const v of this.videos.values()) {
      if (v.sourceUrl === url && v.status !== "falhou" && v.status !== "rejeitado") return v.id;
    }
    return null;
  }
  async createVideo(url: string, platform: string) {
    const id = `00000000-0000-4000-8000-${String(++this.seq).padStart(12, "0")}`;
    this.videos.set(id, {
      id, sourceUrl: url, platform, status: "baixando", stage: "baixando", error: null, title: null,
      description: null, hashtags: [], duration: null, videoUrl: null, thumbUrl: null, topics: [],
      createdAt: new Date(0).toISOString(),
    });
    return id;
  }
  async getVideo(id: string) {
    return this.videos.get(id) ?? null;
  }
  async listVideos(status: VideoStatus) {
    return [...this.videos.values()].filter((v) => v.status === status);
  }
  async confirmTopics(id: string, slugs: string[]): Promise<ConfirmResult> {
    const v = this.videos.get(id);
    if (!v) return "not_found";
    if (v.stage !== "aguardando_confirmacao") return "invalid_state";
    const chosen = this.topics.filter((t) => slugs.includes(t.slug)).sort((a, b) => a.name.localeCompare(b.name));
    if (chosen.length !== slugs.length) return "invalid_topics";
    v.topics = chosen.map((t) => ({
      slug: t.slug,
      name: t.name,
      source: v.topics.find((x) => x.slug === t.slug)?.source ?? "user",
    }));
    v.status = "pendente";
    v.stage = "aguardando_aprovacao";
    return "ok";
  }
  async approve(id: string) {
    const v = this.videos.get(id);
    if (v?.status !== "pendente") return false;
    v.status = "aprovado";
    v.stage = "gerando_embedding";
    return true;
  }
  async reject(id: string) {
    const v = this.videos.get(id);
    if (v?.status !== "pendente") return false;
    v.status = "rejeitado";
    return true;
  }
  async getOwner() {
    return this.owner;
  }
  async statusOf(ids: string[]) {
    return new Map(ids.filter((id) => this.videos.has(id)).map((id) => [id, this.videos.get(id)!.status as string]));
  }
}

let store: MemoryStore;
let queue: JobQueue & { send: ReturnType<typeof vi.fn> };
let removeMedia: ReturnType<typeof vi.fn<(id: string) => Promise<void>>>;

beforeEach(async () => {
  store = new MemoryStore();
  store.owner.pinHash = await hashPin("1234");
  queue = { send: vi.fn(async () => "job-1") };
  removeMedia = vi.fn(async () => {});
});

const app = (fetchImpl?: typeof fetch) => buildApp({ config, store, queue, fetchImpl, removeMedia });

describe("api básica", () => {
  it("GET /health responde ok", async () => {
    const res = await app().inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("POST /ai/teste envia o prompt ao Ollama e devolve a resposta", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ model: "modelo-teste", response: "  Bom dia, sobreviventes!  ", total_duration: 1_500_000_000 }),
    );
    const res = await app(fetchImpl).inject({ method: "POST", url: "/ai/teste", payload: { prompt: "Oi" } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ model: "modelo-teste", response: "Bom dia, sobreviventes!", durationMs: 1500 });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("http://ollama:11434/api/generate");
    expect(JSON.parse(String(init?.body))).toEqual({ model: "modelo-teste", prompt: "Oi", stream: false });
  });

  it("POST /ai/teste devolve 503 quando o modelo ainda não foi baixado", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ error: "model not found" }, 404));
    const res = await app(fetchImpl).inject({ method: "POST", url: "/ai/teste", payload: { prompt: "Oi" } });
    expect(res.statusCode).toBe(503);
  });

  it("POST /ai/teste devolve 502 quando o Ollama está fora do ar", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError("fetch failed");
    });
    const res = await app(fetchImpl).inject({ method: "POST", url: "/ai/teste", payload: { prompt: "Oi" } });
    expect(res.statusCode).toBe(502);
  });
});

describe("cadastro de vídeo", () => {
  it("aceita um link do Shorts, cria o vídeo e enfileira o download", async () => {
    const res = await app().inject({
      method: "POST",
      url: "/videos",
      payload: { url: "https://youtube.com/shorts/abcdefghijk?si=rastreio" },
    });
    expect(res.statusCode).toBe(201);
    const video = res.json();
    expect(video).toMatchObject({ status: "baixando", platform: "youtube", sourceUrl: "https://www.youtube.com/watch?v=abcdefghijk" });
    expect(queue.send).toHaveBeenCalledWith("video.download", { videoId: video.id });
  });

  it("recusa links de outros sites", async () => {
    const res = await app().inject({ method: "POST", url: "/videos", payload: { url: "https://exemplo.com/video" } });
    expect(res.statusCode).toBe(400);
    expect(queue.send).not.toHaveBeenCalled();
  });

  it("não cadastra o mesmo link duas vezes", async () => {
    const payload = { url: "https://www.tiktok.com/@alguem/video/1" };
    const first = await app().inject({ method: "POST", url: "/videos", payload });
    const second = await app().inject({ method: "POST", url: "/videos", payload });
    expect(second.statusCode).toBe(409);
    expect(second.json().id).toBe(first.json().id);
  });

  it("confirma tópicos só depois do processamento e manda para aprovação", async () => {
    const id = await store.createVideo("https://youtu.be/x", "youtube");
    const put = () => app().inject({ method: "PUT", url: `/videos/${id}/topics`, payload: { topics: ["humor"] } });

    expect((await put()).statusCode).toBe(409);

    const v = store.videos.get(id)!;
    v.stage = "aguardando_confirmacao";
    v.status = "processando";
    v.topics = [{ slug: "animais", name: "Animais", source: "ai" }];
    const ok = await app().inject({
      method: "PUT",
      url: `/videos/${id}/topics`,
      payload: { topics: ["animais", "humor"] },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({
      status: "pendente",
      topics: [
        { slug: "animais", source: "ai" },
        { slug: "humor", source: "user" },
      ],
    });
  });

  it("recusa mais de 3 tópicos", async () => {
    const id = await store.createVideo("https://youtu.be/y", "youtube");
    const res = await app().inject({
      method: "PUT",
      url: `/videos/${id}/topics`,
      payload: { topics: ["a", "b", "c", "d"] },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("painel do dono", () => {
  const headers = { "x-owner-pin": "1234" };

  it("exige o PIN do dono", async () => {
    expect((await app().inject({ method: "GET", url: "/owner/videos" })).statusCode).toBe(401);
    expect(
      (await app().inject({ method: "GET", url: "/owner/videos", headers: { "x-owner-pin": "0000" } })).statusCode,
    ).toBe(401);
    expect((await app().inject({ method: "POST", url: "/owner/login", headers })).statusCode).toBe(204);
  });

  it("aprova um vídeo pendente e enfileira o embedding", async () => {
    const id = await store.createVideo("https://youtu.be/z", "youtube");
    store.videos.get(id)!.status = "pendente";

    const list = await app().inject({ method: "GET", url: "/owner/videos", headers });
    expect(list.json()).toHaveLength(1);

    const res = await app().inject({ method: "POST", url: `/owner/videos/${id}/approve`, headers });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("aprovado");
    expect(queue.send).toHaveBeenCalledWith("video.embed", { videoId: id });

    const again = await app().inject({ method: "POST", url: `/owner/videos/${id}/approve`, headers });
    expect(again.statusCode).toBe(409);
  });

  it("rejeita um vídeo pendente, apaga os arquivos e não gera embedding", async () => {
    const id = await store.createVideo("https://youtu.be/w", "youtube");
    store.videos.get(id)!.status = "pendente";
    const res = await app().inject({ method: "POST", url: `/owner/videos/${id}/reject`, headers });
    expect(res.json().status).toBe("rejeitado");
    expect(removeMedia).toHaveBeenCalledWith(id);
    expect(queue.send).not.toHaveBeenCalled();
  });

  it("não apaga arquivos de vídeo que não estava pendente", async () => {
    const id = await store.createVideo("https://youtu.be/v", "youtube");
    store.videos.get(id)!.status = "aprovado";
    const res = await app().inject({ method: "POST", url: `/owner/videos/${id}/reject`, headers });
    expect(res.statusCode).toBe(409);
    expect(removeMedia).not.toHaveBeenCalled();
  });

  it("cria tópicos novos com slug sem acento", async () => {
    const res = await app().inject({ method: "POST", url: "/owner/topics", headers, payload: { name: "Ciência Maluca" } });
    expect(res.statusCode).toBe(201);
    expect(res.json().slug).toBe("ciencia-maluca");
    const dup = await app().inject({ method: "POST", url: "/owner/topics", headers, payload: { name: "ciencia maluca" } });
    expect(dup.statusCode).toBe(409);
  });
});

describe("slugify", () => {
  it("normaliza acentos e espaços", () => {
    expect(slugify("  Política & Notícias ")).toBe("politica-noticias");
  });
});
