import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp, slugify, type JobQueue } from "./app.js";
import { readConfig } from "./config.js";
import { hashPin } from "./pin.js";
import type { CommentView, ConfirmResult, FeedVideo, Store, Topic, UserView, VideoStatus, VideoView } from "./store.js";

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
  videos = new Map<string, VideoView & { submittedBy?: string }>();
  users = new Map<string, { user: UserView; pinHash: string | null }>();
  sessions = new Map<string, string>();
  comments = new Map<string, CommentView[]>();
  likes = new Map<string, Set<string>>();
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
  async createVideo(url: string, platform: string, submittedBy?: string) {
    const id = `00000000-0000-4000-8000-${String(++this.seq).padStart(12, "0")}`;
    this.videos.set(id, {
      id, sourceUrl: url, platform, status: "baixando", stage: "baixando", error: null, title: null,
      description: null, hashtags: [], duration: null, videoUrl: null, thumbUrl: null, topics: [],
      createdAt: new Date(0).toISOString(), submittedBy,
    });
    return id;
  }
  async getVideo(id: string) {
    const v = this.videos.get(id);
    if (!v) return null;
    const view: VideoView & { submittedBy?: string } = { ...v };
    delete view.submittedBy;
    return view;
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
  async findUser(nickname: string) {
    return this.users.get(nickname) ?? null;
  }
  async createUser(nickname: string, pinHash: string) {
    if (this.users.has(nickname)) return null;
    const user: UserView = { id: `u-${nickname}`, nickname, avatarUrl: null, role: "resident", isAi: false };
    this.users.set(nickname, { user, pinHash });
    return user;
  }
  async createSession(userId: string, tokenHash: string) {
    this.sessions.set(tokenHash, userId);
  }
  async sessionUser(tokenHash: string) {
    const id = this.sessions.get(tokenHash);
    return [...this.users.values()].find((u) => u.user.id === id)?.user ?? null;
  }
  async deleteSession(tokenHash: string) {
    this.sessions.delete(tokenHash);
  }
  async statusOf(ids: string[]) {
    return new Map(ids.filter((id) => this.videos.has(id)).map((id) => [id, this.videos.get(id)!.status as string]));
  }
  private toFeed(v: VideoView & { submittedBy?: string }, userId: string): FeedVideo {
    const likes = this.likes.get(v.id) ?? new Set();
    const author = [...this.users.values()].find((u) => u.user.id === v.submittedBy)?.user;
    const view: VideoView & { submittedBy?: string } = { ...v };
    delete view.submittedBy;
    return {
      ...view,
      commentCount: this.comments.get(v.id)?.length ?? 0,
      likeCount: likes.size,
      liked: likes.has(userId),
      author: author ? { nickname: author.nickname, avatarUrl: author.avatarUrl, isAi: author.isAi } : null,
    };
  }
  async feed(userId: string, exclude: string[], limit: number) {
    const all = [...this.videos.values()].filter((v) => v.status === "aprovado" && v.videoUrl);
    let videos = all.filter((v) => !exclude.includes(v.id));
    const restarted = videos.length === 0 && exclude.length > 0;
    if (restarted) videos = all;
    return { videos: videos.slice(0, limit).map((v) => this.toFeed(v, userId)), restarted };
  }
  async listComments(videoId: string) {
    if (this.videos.get(videoId)?.status !== "aprovado") return null;
    return this.comments.get(videoId) ?? [];
  }
  async addComment(userId: string, videoId: string, text: string) {
    if (this.videos.get(videoId)?.status !== "aprovado") return null;
    const user = [...this.users.values()].find((u) => u.user.id === userId)!.user;
    const comment = { id: `c${++this.seq}`, text, createdAt: new Date(0).toISOString(), author: { nickname: user.nickname, avatarUrl: null, isAi: false } };
    this.comments.set(videoId, [...(this.comments.get(videoId) ?? []), comment]);
    return comment;
  }
  async setLike(userId: string, videoId: string, liked: boolean) {
    if (this.videos.get(videoId)?.status !== "aprovado") return null;
    const set = this.likes.get(videoId) ?? new Set<string>();
    if (liked) set.add(userId);
    else set.delete(userId);
    this.likes.set(videoId, set);
    return { liked, likeCount: set.size };
  }
  async profile(nickname: string, viewerId: string) {
    const found = this.users.get(nickname);
    if (!found) return null;
    const liked = [...this.videos.values()].filter((v) => v.status === "aprovado" && this.likes.get(v.id)?.has(found.user.id));
    return { ...found.user, name: null, bio: null, liked: liked.map((v) => this.toFeed(v, viewerId)) };
  }
  async videosMissingPersonaComments() {
    return [];
  }
}

let store: MemoryStore;
let queue: JobQueue & { send: ReturnType<typeof vi.fn> };
let removeMedia: ReturnType<typeof vi.fn<(id: string) => Promise<void>>>;
let clock: number;

beforeEach(async () => {
  store = new MemoryStore();
  store.users.set("dono", {
    user: { id: "u-dono", nickname: "dono", avatarUrl: null, role: "owner", isAi: false },
    pinHash: await hashPin("1234"),
  });
  store.users.set("tio_valdir", {
    user: { id: "u-tio", nickname: "tio_valdir", avatarUrl: "/avatars/tio-valdir.svg", role: "resident", isAi: true },
    pinHash: null,
  });
  queue = { send: vi.fn(async () => "job-1") };
  removeMedia = vi.fn(async () => {});
  clock = 0;
});

const app = (fetchImpl?: typeof fetch) => buildApp({ config, store, queue, fetchImpl, removeMedia, now: () => clock });

const enter = (nickname: string, pin: string, a = app()) =>
  a.inject({ method: "POST", url: "/auth/entrar", payload: { nickname, pin } });

/** Entra e devolve o cabeçalho de sessão. */
async function auth(nickname = "dono", pin = "1234") {
  const res = await enter(nickname, pin);
  expect(res.statusCode).toBeLessThan(300);
  return { authorization: `Bearer ${res.json().token}` };
}

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

describe("entrada com apelido e PIN", () => {
  it("cria a conta no primeiro acesso e entra com o mesmo PIN depois", async () => {
    const first = await enter("  @Morador_1 ", "4321");
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ created: true, user: { nickname: "morador_1", role: "resident" } });
    expect(store.users.get("morador_1")!.pinHash).toMatch(/^scrypt\$/);

    const again = await enter("morador_1", "4321");
    expect(again.statusCode).toBe(200);
    expect(again.json().created).toBe(false);
    expect(again.json().token).not.toBe(first.json().token);
  });

  it("recusa PIN errado, apelido inválido, PIN fraco e apelido de persona", async () => {
    expect((await enter("dono", "9999")).statusCode).toBe(401);
    expect((await enter("a!", "1234")).statusCode).toBe(400);
    expect((await enter("novo", "12")).statusCode).toBe(400);
    expect((await enter("novo", "abcd")).statusCode).toBe(400);
    expect((await enter("tio_valdir", "1234")).statusCode).toBe(409);
  });

  it("bloqueia o apelido depois de 5 PINs errados e libera depois de 15 minutos", async () => {
    const a = app();
    for (let i = 0; i < 5; i++) expect((await enter("dono", "0000", a)).statusCode).toBe(401);
    const blocked = await enter("dono", "1234", a);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers["retry-after"]).toBe("900");
    // Outro apelido no mesmo IP ainda pode entrar.
    expect((await enter("outro", "5555", a)).statusCode).toBe(201);
    clock += 15 * 60_000;
    expect((await enter("dono", "1234", a)).statusCode).toBe(200);
  });

  it("pede sessão nas rotas do app e encerra a sessão ao sair", async () => {
    expect((await app().inject({ method: "POST", url: "/feed", payload: {} })).statusCode).toBe(401);
    expect((await app().inject({ method: "GET", url: "/topics", headers: { authorization: "Bearer x" } })).statusCode).toBe(401);

    const headers = await auth("morador", "1111");
    const me = await app().inject({ method: "GET", url: "/auth/eu", headers });
    expect(me.json()).toMatchObject({ nickname: "morador", role: "resident" });
    expect((await app().inject({ method: "POST", url: "/auth/sair", headers })).statusCode).toBe(204);
    expect((await app().inject({ method: "GET", url: "/auth/eu", headers })).statusCode).toBe(401);
  });
});

describe("cadastro de vídeo", () => {
  it("aceita um link do Shorts, registra quem mandou e enfileira o download", async () => {
    const headers = await auth("morador", "1111");
    const res = await app().inject({
      method: "POST",
      url: "/videos",
      headers,
      payload: { url: "https://youtube.com/shorts/abcdefghijk?si=rastreio" },
    });
    expect(res.statusCode).toBe(201);
    const video = res.json();
    expect(video).toMatchObject({ status: "baixando", platform: "youtube", sourceUrl: "https://www.youtube.com/watch?v=abcdefghijk" });
    expect(store.videos.get(video.id)!.submittedBy).toBe("u-morador");
    expect(queue.send).toHaveBeenCalledWith("video.download", { videoId: video.id });
  });

  it("recusa links de outros sites", async () => {
    const headers = await auth();
    const res = await app().inject({ method: "POST", url: "/videos", headers, payload: { url: "https://exemplo.com/video" } });
    expect(res.statusCode).toBe(400);
    expect(queue.send).not.toHaveBeenCalled();
  });

  it("não cadastra o mesmo link duas vezes", async () => {
    const headers = await auth();
    const payload = { url: "https://www.tiktok.com/@alguem/video/1" };
    const first = await app().inject({ method: "POST", url: "/videos", headers, payload });
    const second = await app().inject({ method: "POST", url: "/videos", headers, payload });
    expect(second.statusCode).toBe(409);
    expect(second.json().id).toBe(first.json().id);
  });

  it("confirma tópicos só depois do processamento e manda para aprovação", async () => {
    const headers = await auth();
    const id = await store.createVideo("https://youtu.be/x", "youtube");
    const put = () => app().inject({ method: "PUT", url: `/videos/${id}/topics`, headers, payload: { topics: ["humor"] } });

    expect((await put()).statusCode).toBe(409);

    const v = store.videos.get(id)!;
    v.stage = "aguardando_confirmacao";
    v.status = "processando";
    v.topics = [{ slug: "animais", name: "Animais", source: "ai" }];
    const ok = await app().inject({
      method: "PUT",
      url: `/videos/${id}/topics`,
      headers,
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
    const headers = await auth();
    const id = await store.createVideo("https://youtu.be/y", "youtube");
    const res = await app().inject({
      method: "PUT",
      url: `/videos/${id}/topics`,
      headers,
      payload: { topics: ["a", "b", "c", "d"] },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("painel do dono", () => {
  it("só aceita a conta de dono", async () => {
    expect((await app().inject({ method: "GET", url: "/owner/videos" })).statusCode).toBe(401);
    const resident = await auth("morador", "1111");
    expect((await app().inject({ method: "GET", url: "/owner/videos", headers: resident })).statusCode).toBe(403);
    expect((await app().inject({ method: "GET", url: "/owner/videos", headers: await auth() })).statusCode).toBe(200);
  });

  it("aprova um vídeo pendente e enfileira o embedding e o comentário da persona", async () => {
    const headers = await auth();
    const id = await store.createVideo("https://youtu.be/z", "youtube");
    store.videos.get(id)!.status = "pendente";

    const list = await app().inject({ method: "GET", url: "/owner/videos", headers });
    expect(list.json()).toHaveLength(1);

    const res = await app().inject({ method: "POST", url: `/owner/videos/${id}/approve`, headers });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("aprovado");
    expect(queue.send).toHaveBeenCalledWith("video.embed", { videoId: id });
    expect(queue.send).toHaveBeenCalledWith("persona.comment", { videoId: id });

    const again = await app().inject({ method: "POST", url: `/owner/videos/${id}/approve`, headers });
    expect(again.statusCode).toBe(409);
  });

  it("rejeita um vídeo pendente, apaga os arquivos e não gera embedding", async () => {
    const headers = await auth();
    const id = await store.createVideo("https://youtu.be/w", "youtube");
    store.videos.get(id)!.status = "pendente";
    const res = await app().inject({ method: "POST", url: `/owner/videos/${id}/reject`, headers });
    expect(res.json().status).toBe("rejeitado");
    expect(removeMedia).toHaveBeenCalledWith(id);
    expect(queue.send).not.toHaveBeenCalled();
  });

  it("não apaga arquivos de vídeo que não estava pendente", async () => {
    const headers = await auth();
    const id = await store.createVideo("https://youtu.be/v", "youtube");
    store.videos.get(id)!.status = "aprovado";
    const res = await app().inject({ method: "POST", url: `/owner/videos/${id}/reject`, headers });
    expect(res.statusCode).toBe(409);
    expect(removeMedia).not.toHaveBeenCalled();
  });

  it("cria tópicos novos com slug sem acento", async () => {
    const headers = await auth();
    const res = await app().inject({ method: "POST", url: "/owner/topics", headers, payload: { name: "Ciência Maluca" } });
    expect(res.statusCode).toBe(201);
    expect(res.json().slug).toBe("ciencia-maluca");
    const dup = await app().inject({ method: "POST", url: "/owner/topics", headers, payload: { name: "ciencia maluca" } });
    expect(dup.statusCode).toBe(409);
  });
});

describe("feed", () => {
  async function approved(n: number) {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const id = await store.createVideo(`https://youtu.be/feed${i}`, "youtube", "u-dono");
      Object.assign(store.videos.get(id)!, { status: "aprovado", videoUrl: `/media/${id}/video.mp4` });
      ids.push(id);
    }
    return ids;
  }

  it("entrega só vídeos aprovados com arquivo, sem repetir os já vistos", async () => {
    const headers = await auth();
    const [a, b, c] = await approved(3);
    await store.createVideo("https://youtu.be/pendente", "youtube");
    store.videos.get(c!)!.videoUrl = null;

    const res = await app().inject({ method: "POST", url: "/feed", headers, payload: { exclude: [a, "lixo"] } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      videos: [expect.objectContaining({ id: b, commentCount: 0, likeCount: 0, liked: false, author: expect.objectContaining({ nickname: "dono" }) })],
      restarted: false,
    });
  });

  it("recomeça do acervo inteiro quando tudo já foi visto", async () => {
    const headers = await auth();
    const ids = await approved(2);
    const res = await app().inject({ method: "POST", url: "/feed", headers, payload: { exclude: ids } });
    expect(res.json().restarted).toBe(true);
    expect(res.json().videos).toHaveLength(2);
  });

  it("devolve feed vazio quando não há vídeos aprovados", async () => {
    const res = await app().inject({ method: "POST", url: "/feed", headers: await auth(), payload: {} });
    expect(res.json()).toEqual({ videos: [], restarted: false });
  });

  it("lista os comentários de um vídeo aprovado", async () => {
    const headers = await auth();
    const [id] = await approved(1);
    store.comments.set(id!, [
      { id: "c1", text: "Bom dia, sobreviventes!", createdAt: new Date(0).toISOString(), author: { nickname: "tio_valdir", avatarUrl: "/avatars/tio-valdir.svg", isAi: true } },
    ]);
    const res = await app().inject({ method: "GET", url: `/videos/${id}/comments`, headers });
    expect(res.json()).toEqual([expect.objectContaining({ text: "Bom dia, sobreviventes!" })]);

    const pending = await store.createVideo("https://youtu.be/p", "youtube");
    expect((await app().inject({ method: "GET", url: `/videos/${pending}/comments`, headers })).statusCode).toBe(404);
  });

  it("comenta como o usuário da sessão, com o texto limpo", async () => {
    const headers = await auth("morador", "1111");
    const [id] = await approved(1);
    const res = await app().inject({ method: "POST", url: `/videos/${id}/comments`, headers, payload: { text: "  muito\n bom  " } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ text: "muito bom", author: { nickname: "morador" } });
    expect((await app().inject({ method: "POST", url: `/videos/${id}/comments`, headers, payload: { text: "   " } })).statusCode).toBe(400);
    expect((await app().inject({ method: "POST", url: `/videos/${id}/comments`, headers, payload: { text: "x".repeat(501) } })).statusCode).toBe(400);
    const pending = await store.createVideo("https://youtu.be/p", "youtube");
    expect((await app().inject({ method: "POST", url: `/videos/${pending}/comments`, headers, payload: { text: "oi" } })).statusCode).toBe(404);
  });

  it("curte e descurte sem contar duas vezes", async () => {
    const headers = await auth("morador", "1111");
    const [id] = await approved(1);
    const like = () => app().inject({ method: "PUT", url: `/videos/${id}/like`, headers });
    expect((await like()).json()).toEqual({ liked: true, likeCount: 1 });
    expect((await like()).json()).toEqual({ liked: true, likeCount: 1 });
    const feed = await app().inject({ method: "POST", url: "/feed", headers, payload: {} });
    expect(feed.json().videos[0]).toMatchObject({ liked: true, likeCount: 1 });
    expect((await app().inject({ method: "DELETE", url: `/videos/${id}/like`, headers })).json()).toEqual({ liked: false, likeCount: 0 });
  });
});

describe("perfil", () => {
  it("mostra o usuário e os vídeos que ele curtiu", async () => {
    const headers = await auth("morador", "1111");
    const id = await store.createVideo("https://youtu.be/a", "youtube");
    Object.assign(store.videos.get(id)!, { status: "aprovado", videoUrl: "/media/a.mp4" });
    await app().inject({ method: "PUT", url: `/videos/${id}/like`, headers });

    const res = await app().inject({ method: "GET", url: "/users/Morador", headers });
    expect(res.json()).toMatchObject({ nickname: "morador", isAi: false, liked: [{ id, liked: true }] });
    expect((await app().inject({ method: "GET", url: "/users/ninguem", headers })).statusCode).toBe(404);
  });
});

describe("slugify", () => {
  it("normaliza acentos e espaços", () => {
    expect(slugify("  Política & Notícias ")).toBe("politica-noticias");
  });
});
