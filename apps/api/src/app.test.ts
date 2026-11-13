import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp, slugify, type JobQueue } from "./app.js";
import { readConfig } from "./config.js";
import {
  BUNKER_NAME,
  directKey,
  type ChatStore,
  type ConversationView,
  type CreateGroupResult,
  type MessageContent,
  type MessageView,
  type OpenDirectResult,
  type ReactionView,
  type SendResult,
  type SharedVideo,
} from "./chat.js";
import { Hub, WS_CLOSE } from "./realtime.js";
import { clampScore, COMMENT_DELTA, LIKE_DELTA, SHARE_DELTA, viewDelta, type ViewInput } from "./affinity.js";
import { hashPin } from "./pin.js";
import { pickFeed } from "./recommend.js";
import { cosine, tasteVector } from "./taste.js";
import type { AuthorView, CommentView, ConfirmResult, FeedVideo, Store, Topic, UserView, VideoStatus, VideoView } from "./store.js";

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
  videos = new Map<string, VideoView & { submittedBy?: string; embedding?: number[] }>();
  users = new Map<string, { user: UserView; pinHash: string | null }>();
  sessions = new Map<string, string>();
  comments = new Map<string, CommentView[]>();
  likes = new Map<string, Set<string>>();
  views: { userId: string; videoId: string; at: number; skipped: boolean; delta: number }[] = [];
  /** Chave `usuário:tópico`. */
  affinity = new Map<string, number>();
  /** Chave `usuário:vídeo` de quem já compartilhou. */
  shares = new Set<string>();
  now = () => 0;
  rng = () => 0.5;
  private seq = 0;

  private bump(userId: string, videoId: string, delta: number) {
    for (const t of this.videos.get(videoId)!.topics) {
      const id = this.topics.find((x) => x.slug === t.slug)!.id;
      const key = `${userId}:${id}`;
      this.affinity.set(key, clampScore((this.affinity.get(key) ?? 0) + delta));
    }
  }

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
    const view: VideoView & { submittedBy?: string; embedding?: number[] } = { ...v };
    delete view.submittedBy;
    delete view.embedding;
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
  private toFeed(v: VideoView & { submittedBy?: string; embedding?: number[] }, userId: string): FeedVideo {
    const likes = this.likes.get(v.id) ?? new Set();
    const author = [...this.users.values()].find((u) => u.user.id === v.submittedBy)?.user;
    const view: VideoView & { submittedBy?: string; embedding?: number[] } = { ...v };
    delete view.submittedBy;
    delete view.embedding;
    return {
      ...view,
      commentCount: this.comments.get(v.id)?.length ?? 0,
      likeCount: likes.size,
      liked: likes.has(userId),
      author: author ? { nickname: author.nickname, avatarUrl: author.avatarUrl, isAi: author.isAi } : null,
    };
  }
  /** Mesma nota por vídeo do PgStore: visualizações, curtida, primeiro comentário e compartilhamento. */
  private taste(userId: string) {
    const nickname = [...this.users.values()].find((u) => u.user.id === userId)?.user.nickname;
    const rated = [...this.videos.values()].map((v) => ({
      score:
        this.views.filter((e) => e.userId === userId && e.videoId === v.id).reduce((s, e) => s + e.delta, 0) +
        (this.likes.get(v.id)?.has(userId) ? LIKE_DELTA : 0) +
        (this.comments.get(v.id)?.some((c) => c.author.nickname === nickname) ? COMMENT_DELTA : 0) +
        (this.shares.has(`${userId}:${v.id}`) ? SHARE_DELTA : 0),
      embedding: v.embedding ?? [],
    }));
    return tasteVector(rated);
  }
  async feed(userId: string, exclude: string[], limit: number) {
    const all = [...this.videos.values()].filter((v) => v.status === "aprovado" && v.videoUrl);
    const taste = this.taste(userId);
    const cands = all.map((v) => {
      const seen = this.views.filter((e) => e.userId === userId && e.videoId === v.id).map((e) => e.at);
      return {
        id: v.id,
        topicIds: v.topics.map((t) => this.topics.find((x) => x.slug === t.slug)!.id),
        liked: this.likes.get(v.id)?.has(userId) ?? false,
        lastViewedAt: seen.length ? Math.max(...seen) : null,
        similarity: taste && v.embedding ? cosine(taste, v.embedding) : null,
      };
    });
    const affinity = new Map(
      [...this.affinity].filter(([k]) => k.startsWith(`${userId}:`)).map(([k, v]) => [Number(k.split(":")[1]), v]),
    );
    const pick = pickFeed(cands, affinity, exclude, limit, this.now(), this.rng);
    return { videos: pick.ids.map((id) => this.toFeed(this.videos.get(id)!, userId)), restarted: pick.restarted };
  }
  async recordView(userId: string, videoId: string, view: ViewInput) {
    if (this.videos.get(videoId)?.status !== "aprovado") return false;
    const { skipped, delta } = viewDelta(view);
    this.views.push({ userId, videoId, at: this.now(), skipped, delta });
    if (delta) this.bump(userId, videoId, delta);
    return true;
  }
  async listComments(videoId: string) {
    if (this.videos.get(videoId)?.status !== "aprovado") return null;
    return this.comments.get(videoId) ?? [];
  }
  async addComment(userId: string, videoId: string, text: string) {
    if (this.videos.get(videoId)?.status !== "aprovado") return null;
    const user = [...this.users.values()].find((u) => u.user.id === userId)!.user;
    const comment = { id: `c${++this.seq}`, text, createdAt: new Date(0).toISOString(), author: { nickname: user.nickname, avatarUrl: null, isAi: false } };
    const list = [...(this.comments.get(videoId) ?? []), comment];
    this.comments.set(videoId, list);
    if (list.filter((c) => c.author.nickname === user.nickname).length === 1) this.bump(userId, videoId, COMMENT_DELTA);
    return comment;
  }
  async setLike(userId: string, videoId: string, liked: boolean) {
    if (this.videos.get(videoId)?.status !== "aprovado") return null;
    const set = this.likes.get(videoId) ?? new Set<string>();
    if (set.has(userId) !== liked) this.bump(userId, videoId, liked ? LIKE_DELTA : -LIKE_DELTA);
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
  async recordShare(userId: string, videoId: string) {
    this.shares.add(`${userId}:${videoId}`);
    this.bump(userId, videoId, SHARE_DELTA);
  }
  async videosMissingPersonaComments() {
    return [];
  }
}

const uuid = (n: number) => `00000000-0000-4000-9000-${String(n).padStart(12, "0")}`;

type StoredMessage = MessageView & { senderId: string; at: number };

/** Chat em memória com o mesmo comportamento esperado do PgChatStore. */
class MemoryChatStore implements ChatStore {
  conversations: { id: string; type: "direct" | "group"; name: string | null; key: string | null; bunker: boolean; lastAt: number | null; createdAt: number }[] = [];
  members: { conversationId: string; userId: string; lastRead: number }[] = [];
  messages: StoredMessage[] = [];
  /** Chave `mensagem:usuário`. */
  reactions = new Map<string, { emoji: string; at: number }>();
  private seq = 0;
  private tick = 0;

  constructor(
    private readonly users: () => MemoryStore["users"],
    private readonly videos: () => MemoryStore["videos"],
  ) {}

  private user(id: string) {
    return [...this.users().values()].find((u) => u.user.id === id)!.user;
  }
  private author(id: string): AuthorView {
    const u = this.user(id);
    return { nickname: u.nickname, avatarUrl: u.avatarUrl, isAi: u.isAi };
  }
  private member(userId: string, conversationId: string) {
    return this.members.find((m) => m.userId === userId && m.conversationId === conversationId);
  }
  private reactionsOf(messageId: string): ReactionView[] {
    return [...this.reactions]
      .filter(([k]) => k.startsWith(`${messageId}:`))
      .sort((a, b) => a[1].at - b[1].at)
      .map(([k, r]) => ({ emoji: r.emoji, nickname: this.user(k.split(":")[1]!).nickname }));
  }
  private out(m: StoredMessage): MessageView {
    const view: MessageView & { senderId?: string; at?: number } = { ...m, reactions: this.reactionsOf(m.id) };
    delete view.senderId;
    delete view.at;
    return view;
  }
  private view(userId: string, id: string): ConversationView {
    const c = this.conversations.find((x) => x.id === id)!;
    const msgs = this.messages.filter((m) => m.conversationId === id);
    const last = msgs.at(-1);
    const me = this.member(userId, id)!;
    return {
      id,
      type: c.type,
      name: c.name,
      bunker: c.bunker,
      members: this.members.filter((m) => m.conversationId === id && m.userId !== userId).map((m) => this.author(m.userId)),
      lastMessage: last ? this.out(last) : null,
      unread: msgs.filter((m) => m.senderId !== userId && m.at > me.lastRead).length,
    };
  }
  private create(type: "direct" | "group", name: string | null, key: string | null, userIds: string[], bunker = false) {
    const c = { id: uuid(++this.seq), type, name, key, bunker, lastAt: null, createdAt: ++this.tick };
    this.conversations.push(c);
    for (const userId of new Set(userIds)) this.members.push({ conversationId: c.id, userId, lastRead: -Infinity });
    return c;
  }

  async openDirect(userId: string, nickname: string): Promise<OpenDirectResult> {
    const other = this.users().get(nickname)?.user;
    if (!other) return "not_found";
    if (other.id === userId) return "self";
    if (other.isAi) return "persona";
    const key = directKey(userId, other.id);
    const c = this.conversations.find((x) => x.key === key) ?? this.create("direct", null, key, [userId, other.id]);
    return this.view(userId, c.id);
  }
  async createGroup(userId: string, name: string, nicknames: string[]): Promise<CreateGroupResult> {
    const unknown = nicknames.filter((n) => !this.users().has(n));
    if (unknown.length) return { unknown };
    const found = nicknames.map((n) => this.users().get(n)!.user);
    if (found.some((u) => u.isAi)) return "persona";
    return this.view(userId, this.create("group", name, null, [userId, ...found.map((u) => u.id)]).id);
  }
  async ensureBunker() {
    const c = this.conversations.find((x) => x.bunker) ?? this.create("group", BUNKER_NAME, null, [], true);
    for (const { user } of this.users().values()) if (!user.isAi) await this.joinBunker(user.id, c.id);
  }
  async joinBunker(userId: string, id = this.conversations.find((x) => x.bunker)?.id) {
    if (id && !this.member(userId, id)) this.members.push({ conversationId: id, userId, lastRead: -Infinity });
  }
  async listConversations(userId: string) {
    const at = (c: (typeof this.conversations)[number]) => c.lastAt ?? c.createdAt;
    return this.conversations
      .filter((c) => (c.type === "group" || c.lastAt !== null) && this.member(userId, c.id))
      .sort((a, b) => at(b) - at(a))
      .map((c) => this.view(userId, c.id));
  }
  async getConversation(userId: string, id: string) {
    return this.member(userId, id) ? this.view(userId, id) : null;
  }
  async listMessages(userId: string, id: string, before: string | null, limit: number) {
    if (!this.member(userId, id)) return null;
    let msgs = this.messages.filter((m) => m.conversationId === id);
    if (before !== null) {
      const at = msgs.find((m) => m.id === before)?.at;
      msgs = at === undefined ? [] : msgs.filter((m) => m.at < at);
    }
    return msgs.slice(-limit).map((m) => this.out(m));
  }
  async sendMessage(userId: string, id: string, content: MessageContent): Promise<SendResult> {
    const me = this.member(userId, id);
    if (!me) return "not_member";
    let video: SharedVideo | null = null;
    if ("videoId" in content) {
      const v = this.videos().get(content.videoId);
      if (v?.status !== "aprovado" || !v.videoUrl) return "video_not_found";
      video = { id: v.id, title: v.title, description: v.description, videoUrl: v.videoUrl, thumbUrl: v.thumbUrl };
    }
    const firstShare = video !== null && !this.messages.some((m) => m.senderId === userId && m.video?.id === video.id);
    const at = ++this.tick;
    const msg: StoredMessage = {
      id: uuid(++this.seq), conversationId: id, type: video ? "video" : "text", text: "text" in content ? content.text : null,
      video, reactions: [], createdAt: new Date(at).toISOString(), sender: this.author(userId), senderId: userId, at,
    };
    this.messages.push(msg);
    this.conversations.find((c) => c.id === id)!.lastAt = at;
    me.lastRead = Math.max(me.lastRead, at);
    return { message: this.out(msg), memberIds: await this.memberIds(id), firstShare };
  }
  async setReaction(userId: string, id: string, messageId: string, emoji: string | null) {
    if (!this.member(userId, id) || !this.messages.some((m) => m.id === messageId && m.conversationId === id)) return null;
    const key = `${messageId}:${userId}`;
    if (emoji === null) this.reactions.delete(key);
    else this.reactions.set(key, { emoji, at: ++this.tick });
    return { reactions: this.reactionsOf(messageId), memberIds: await this.memberIds(id) };
  }
  async memberIds(id: string) {
    return this.members.filter((m) => m.conversationId === id).map((m) => m.userId);
  }
  async markRead(userId: string, id: string, messageId: string) {
    const me = this.member(userId, id);
    const msg = this.messages.find((m) => m.id === messageId && m.conversationId === id);
    if (!me || !msg) return false;
    me.lastRead = Math.max(me.lastRead, msg.at);
    return true;
  }
}

let store: MemoryStore;
let chat: MemoryChatStore;
let hub: Hub;
let queue: JobQueue & { send: ReturnType<typeof vi.fn> };
let removeMedia: ReturnType<typeof vi.fn<(id: string) => Promise<void>>>;
let clock: number;

beforeEach(async () => {
  store = new MemoryStore();
  chat = new MemoryChatStore(() => store.users, () => store.videos);
  hub = new Hub();
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
  store.now = () => clock;
});

const app = (fetchImpl?: typeof fetch) =>
  buildApp({ config, store, chat, hub, queue, fetchImpl, removeMedia, now: () => clock, wsAuthMs: 200 });

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
    // Outro apelido continua entrando (todos chegam com o mesmo IP atrás do Docker).
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

describe("visualizações e recomendação", () => {
  const DAY = 24 * 60 * 60 * 1000;
  async function approvedWith(slug: string, embedding?: number[]) {
    const id = await store.createVideo(`https://youtu.be/${slug}${store.videos.size}`, "youtube", "u-dono");
    Object.assign(store.videos.get(id)!, {
      embedding,
      status: "aprovado",
      videoUrl: `/media/${id}/video.mp4`,
      topics: [{ slug, name: slug, source: "user" }],
    });
    return id;
  }
  const view = (id: string, headers: Record<string, string>, payload: object) =>
    app().inject({ method: "POST", url: `/videos/${id}/view`, headers, payload });

  it("grava a visualização e recusa valores fora da faixa", async () => {
    const headers = await auth("morador", "1111");
    const id = await approvedWith("humor");
    expect((await view(id, headers, { watchedMs: 900, watchPct: 0.05, replays: 0 })).statusCode).toBe(204);
    expect(store.views).toEqual([expect.objectContaining({ userId: "u-morador", videoId: id, skipped: true })]);
    expect(store.affinity.get("u-morador:1")).toBe(-1);

    expect((await view(id, headers, { watchedMs: 900, watchPct: 2, replays: 0 })).statusCode).toBe(400);
    expect((await view(id, headers, { watchedMs: -1, watchPct: 0.5, replays: 0 })).statusCode).toBe(400);
    expect((await view(id, headers, { watchedMs: 900, watchPct: 0.5 })).statusCode).toBe(400);
    const pending = await store.createVideo("https://youtu.be/p", "youtube");
    expect((await view(pending, headers, { watchedMs: 1, watchPct: 0, replays: 0 })).statusCode).toBe(404);
    expect((await app().inject({ method: "POST", url: `/videos/${id}/view`, payload: { watchedMs: 1, watchPct: 0, replays: 0 } })).statusCode).toBe(401);
  });

  it("curtida, descurtida e comentário mexem na afinidade do tópico", async () => {
    const headers = await auth("morador", "1111");
    const id = await approvedWith("animais");
    await app().inject({ method: "PUT", url: `/videos/${id}/like`, headers });
    await app().inject({ method: "PUT", url: `/videos/${id}/like`, headers });
    expect(store.affinity.get("u-morador:2")).toBe(2);
    await app().inject({ method: "DELETE", url: `/videos/${id}/like`, headers });
    expect(store.affinity.get("u-morador:2")).toBe(0);
    for (const text of ["um", "dois"]) await app().inject({ method: "POST", url: `/videos/${id}/comments`, headers, payload: { text } });
    expect(store.affinity.get("u-morador:2")).toBe(1);
  });

  it("deixa o vídeo visto em quarentena por 3 dias", async () => {
    const headers = await auth("morador", "1111");
    const a = await approvedWith("humor");
    const b = await approvedWith("dicas");
    await view(a, headers, { watchedMs: 10_000, watchPct: 1, replays: 0 });
    const feed = () => app().inject({ method: "POST", url: "/feed", headers, payload: {} });
    expect((await feed()).json().videos.map((v: FeedVideo) => v.id)).toEqual([b]);
    clock += 3 * DAY;
    expect((await feed()).json().videos.map((v: FeedVideo) => v.id).sort()).toEqual([a, b].sort());
  });

  it("prioriza o vídeo parecido com o que foi curtido, mesmo com tópico diferente", async () => {
    const headers = await auth("morador", "1111");
    const outro = await approvedWith("dicas", [0, 0, 1]);
    const parecido = await approvedWith("dicas", [0.9, 0.1, 0]);
    const liked = await approvedWith("humor", [1, 0, 0]);
    await app().inject({ method: "PUT", url: `/videos/${liked}/like`, headers });
    await view(liked, headers, { watchedMs: 10_000, watchPct: 1, replays: 0 });
    // 0,3 não explora. Sem o gosto, os dois pesam 0,2 e o sorteio cairia no primeiro (outro);
    // com o gosto, o parecido pesa 0,2 + 5 e leva.
    store.rng = () => 0.3;
    const res = await app().inject({ method: "POST", url: "/feed", headers, payload: { limit: 1 } });
    expect(res.json().videos.map((v: FeedVideo) => v.id)).toEqual([parecido]);
    expect(res.json().videos[0]).not.toHaveProperty("embedding");
    expect(store.videos.has(outro)).toBe(true);
  });

  it("com tudo em quarentena, volta primeiro o que foi curtido", async () => {
    const headers = await auth("morador", "1111");
    const a = await approvedWith("humor");
    const b = await approvedWith("dicas");
    await view(a, headers, { watchedMs: 10_000, watchPct: 1, replays: 0 });
    clock += 1000;
    await view(b, headers, { watchedMs: 10_000, watchPct: 1, replays: 0 });
    await app().inject({ method: "PUT", url: `/videos/${b}/like`, headers });
    const res = await app().inject({ method: "POST", url: "/feed", headers, payload: {} });
    expect(res.json()).toMatchObject({ restarted: false, videos: [{ id: b }, { id: a }] });
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

describe("chat", () => {
  /** Duas pessoas com uma conversa direta aberta. */
  async function pair() {
    const ana = await auth("ana", "1111");
    const bia = await auth("bia", "2222");
    const open = await app().inject({ method: "POST", url: "/conversations", headers: ana, payload: { nickname: "@Bia" } });
    expect(open.statusCode).toBe(200);
    return { ana, bia, id: open.json().id as string };
  }
  const send = (headers: { authorization: string }, id: string, text: string) =>
    app().inject({ method: "POST", url: `/conversations/${id}/messages`, headers, payload: { text } });
  const inbox = async (headers: { authorization: string }) => (await app().inject({ method: "GET", url: "/conversations", headers })).json();

  it("abre a mesma conversa direta pelos dois lados e recusa apelido inválido", async () => {
    const { bia, id } = await pair();
    const back = await app().inject({ method: "POST", url: "/conversations", headers: bia, payload: { nickname: "ana" } });
    expect(back.json()).toMatchObject({ id, type: "direct", members: [{ nickname: "ana" }], lastMessage: null, unread: 0 });

    const open = (nickname: string) => app().inject({ method: "POST", url: "/conversations", headers: bia, payload: { nickname } });
    expect((await open("ninguem")).statusCode).toBe(404);
    expect((await open("bia")).statusCode).toBe(400);
    expect((await open("tio_valdir")).statusCode).toBe(409);
  });

  it("só mostra na caixa de entrada conversas com mensagem e conta as não lidas", async () => {
    const { ana, bia, id } = await pair();
    expect(await inbox(bia)).toEqual([]);

    const sent = await send(ana, id, "  oi, bia!  \n tudo bem?  ");
    expect(sent.statusCode).toBe(201);
    expect(sent.json()).toMatchObject({ conversationId: id, type: "text", text: "oi, bia!\n tudo bem?", sender: { nickname: "ana" } });
    await send(ana, id, "sumiu?");

    expect(await inbox(ana)).toMatchObject([{ id, unread: 0, lastMessage: { text: "sumiu?" } }]);
    expect(await inbox(bia)).toMatchObject([{ id, unread: 2, members: [{ nickname: "ana" }] }]);

    // Lido até a primeira: a segunda continua não lida.
    const read = (messageId: string) =>
      app().inject({ method: "POST", url: `/conversations/${id}/read`, headers: bia, payload: { messageId } });
    expect((await read(sent.json().id)).statusCode).toBe(204);
    expect((await inbox(bia))[0].unread).toBe(1);
    expect((await read(uuid(999))).statusCode).toBe(404);

    // Responder marca como lido até a própria mensagem.
    await send(bia, id, "oi!");
    expect((await inbox(bia))[0].unread).toBe(0);
    expect((await inbox(ana))[0].unread).toBe(1);
  });

  it("pagina as mensagens em ordem cronológica", async () => {
    const { ana, id } = await pair();
    const ids: string[] = [];
    for (let i = 1; i <= 5; i++) ids.push((await send(ana, id, `msg ${i}`)).json().id);
    const page = (q: string) => app().inject({ method: "GET", url: `/conversations/${id}/messages${q}`, headers: ana });
    expect((await page("?limit=2")).json().map((m: MessageView) => m.text)).toEqual(["msg 4", "msg 5"]);
    expect((await page(`?limit=2&before=${ids[3]}`)).json().map((m: MessageView) => m.text)).toEqual(["msg 2", "msg 3"]);
    expect((await page("?limit=999")).statusCode).toBe(400);
  });

  it("esconde a conversa de quem não é membro e recusa mensagem vazia", async () => {
    const { ana, id } = await pair();
    const eve = await auth("eve", "3333");
    expect((await app().inject({ method: "GET", url: `/conversations/${id}`, headers: eve })).statusCode).toBe(404);
    expect((await app().inject({ method: "GET", url: `/conversations/${id}/messages`, headers: eve })).statusCode).toBe(404);
    expect((await send(eve, id, "oi")).statusCode).toBe(404);
    expect((await send(ana, id, " \n ")).statusCode).toBe(400);
    expect((await send(ana, id, "x".repeat(1001))).statusCode).toBe(400);
    expect((await app().inject({ method: "GET", url: "/conversations" })).statusCode).toBe(401);
  });

  it("compartilha vídeo aprovado e conta o primeiro compartilhamento na afinidade", async () => {
    const { ana, id } = await pair();
    const videoId = await store.createVideo("https://youtu.be/v", "youtube");
    Object.assign(store.videos.get(videoId)!, {
      status: "aprovado", videoUrl: "/media/v.mp4", thumbUrl: "/media/v.jpg", description: "Gato no teclado",
      topics: [{ slug: "humor", name: "Humor", source: "user" }],
    });
    const share = () => app().inject({ method: "POST", url: `/conversations/${id}/messages`, headers: ana, payload: { videoId } });
    const res = await share();
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ type: "video", text: null, video: { id: videoId, thumbUrl: "/media/v.jpg", description: "Gato no teclado" } });
    await share();
    const anaId = store.users.get("ana")!.user.id;
    expect(store.affinity.get(`${anaId}:1`)).toBe(SHARE_DELTA);

    const pending = await store.createVideo("https://youtu.be/p", "youtube");
    const bad = (payload: object) => app().inject({ method: "POST", url: `/conversations/${id}/messages`, headers: ana, payload });
    expect((await bad({ videoId: pending })).statusCode).toBe(404);
    expect((await bad({ videoId, text: "olha" })).statusCode).toBe(400);
    expect((await bad({})).statusCode).toBe(400);
  });

  it("põe, troca e tira a reação, uma por pessoa", async () => {
    const { ana, bia, id } = await pair();
    const msg = (await send(ana, id, "bom dia")).json();
    const url = `/conversations/${id}/messages/${msg.id}/reaction`;
    const react = (headers: { authorization: string }, emoji: string) => app().inject({ method: "PUT", url, headers, payload: { emoji } });

    await react(bia, "😂");
    await react(ana, "❤️");
    expect((await react(bia, "🔥")).json()).toEqual({
      reactions: [{ emoji: "❤️", nickname: "ana" }, { emoji: "🔥", nickname: "bia" }],
    });
    expect((await app().inject({ method: "DELETE", url, headers: ana })).json()).toEqual({ reactions: [{ emoji: "🔥", nickname: "bia" }] });
    expect((await react(bia, "🍕")).statusCode).toBe(400);

    const page = await app().inject({ method: "GET", url: `/conversations/${id}/messages`, headers: ana });
    expect(page.json()[0].reactions).toEqual([{ emoji: "🔥", nickname: "bia" }]);
    const eve = await auth("eve", "3333");
    expect((await react(eve, "🔥")).statusCode).toBe(404);
  });

  it("cria grupo que aparece na caixa de entrada mesmo sem mensagem", async () => {
    const ana = await auth("ana", "1111");
    const bia = await auth("bia", "2222");
    await auth("eve", "3333");
    const create = (payload: object) => app().inject({ method: "POST", url: "/groups", headers: ana, payload });
    const res = await create({ name: "  Os  sobreviventes ", nicknames: ["@Bia", "eve", "bia", "ana"] });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ type: "group", name: "Os sobreviventes", bunker: false, members: [{ nickname: "bia" }, { nickname: "eve" }] });
    expect(await inbox(bia)).toMatchObject([{ id: res.json().id, unread: 0, lastMessage: null }]);

    expect((await create({ name: "x", nicknames: ["ninguem", "bia"] })).json().error).toContain("@ninguem");
    expect((await create({ name: "x", nicknames: ["tio_valdir"] })).statusCode).toBe(409);
    expect((await create({ name: "x", nicknames: ["ana"] })).statusCode).toBe(400);
    expect((await create({ name: "   ", nicknames: ["bia"] })).statusCode).toBe(400);
  });

  it("põe todo mundo no Grupo do Bunker, inclusive quem entra depois, menos as personas", async () => {
    await auth("ana", "1111");
    await chat.ensureBunker();
    await chat.ensureBunker();
    const bia = await auth("bia", "2222");
    const [bunker] = await inbox(bia);
    expect(bunker).toMatchObject({ type: "group", name: BUNKER_NAME, bunker: true });
    expect(bunker.members.map((m: AuthorView) => m.nickname)).toEqual(["dono", "ana"]);
    expect(chat.conversations.filter((c) => c.bunker)).toHaveLength(1);
  });

  describe("tempo real", () => {
    async function connect(a: ReturnType<typeof app>, token: string | null) {
      await a.ready();
      const ws = await a.injectWS("/ws");
      const events: unknown[] = [];
      ws.on("message", (data) => events.push(JSON.parse(String(data))));
      const closed = new Promise<number>((resolve) => ws.on("close", (code) => resolve(code)));
      if (token !== null) ws.send(JSON.stringify({ type: "auth", token }));
      return { ws, events, closed };
    }
    const tokenOf = (headers: { authorization: string }) => headers.authorization.slice("Bearer ".length);
    const until = async (cond: () => boolean) => {
      for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 5));
      expect(cond()).toBe(true);
    };

    it("avisa os membros da conversa quando chega mensagem", async () => {
      const { ana, bia, id } = await pair();
      const eve = await auth("eve", "3333");
      const a = app();
      const toBia = await connect(a, tokenOf(bia));
      const toEve = await connect(a, tokenOf(eve));
      await until(() => toBia.events.length === 1 && toEve.events.length === 1);
      expect(toBia.events[0]).toEqual({ type: "ready" });

      const sent = (await send(ana, id, "chegou?")).json();
      await until(() => toBia.events.length === 2);
      expect(toBia.events[1]).toEqual({ type: "message", message: sent });
      expect(toEve.events).toHaveLength(1);

      await app().inject({ method: "PUT", url: `/conversations/${id}/messages/${sent.id}/reaction`, headers: ana, payload: { emoji: "👍" } });
      await until(() => toBia.events.length === 3);
      expect(toBia.events[2]).toEqual({ type: "reaction", conversationId: id, messageId: sent.id, reactions: [{ emoji: "👍", nickname: "ana" }] });

      // Grupo novo avisa quem foi chamado, mesmo sem mensagem.
      const group = (await app().inject({ method: "POST", url: "/groups", headers: ana, payload: { name: "G", nicknames: ["eve"] } })).json();
      await until(() => toEve.events.length === 2);
      expect(toEve.events[1]).toEqual({ type: "conversation", conversationId: group.id });
      expect(toBia.events).toHaveLength(3);

      toBia.ws.terminate();
      toEve.ws.terminate();
      await a.close();
    });

    it("fecha a conexão com token inválido ou sem token", async () => {
      const a = app();
      const bad = await connect(a, "x".repeat(43));
      expect(await bad.closed).toBe(WS_CLOSE.badSession);
      const silent = await connect(a, null);
      expect(await silent.closed).toBe(WS_CLOSE.noAuth);
      expect(hub.count("u-dono")).toBe(0);
      await a.close();
    });

    it("o hub manda só para conexões abertas e esquece as removidas", () => {
      const h = new Hub();
      const got: string[] = [];
      const open = { readyState: 1, send: (d: string) => got.push(`a:${d}`) };
      const closing = { readyState: 2, send: (d: string) => got.push(`b:${d}`) };
      const removeOpen = h.add("u1", open);
      h.add("u1", closing);
      h.send(["u1", "u1", "u2"], { type: "ready" });
      expect(got).toEqual(['a:{"type":"ready"}']);
      removeOpen();
      expect(h.count("u1")).toBe(1);
    });
  });
});

describe("slugify", () => {
  it("normaliza acentos e espaços", () => {
    expect(slugify("  Política & Notícias ")).toBe("politica-noticias");
  });
});
