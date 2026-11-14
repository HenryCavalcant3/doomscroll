import { stored } from "./router";
import type { ViewPayload } from "./viewTracker";

export type VideoStatus = "baixando" | "processando" | "pendente" | "aprovado" | "rejeitado" | "falhou";

export interface Topic {
  id: number;
  name: string;
  slug: string;
}

export interface VideoTopic {
  slug: string;
  name: string;
  source: "user" | "ai";
}

export interface Video {
  id: string;
  sourceUrl: string;
  platform: string;
  status: VideoStatus;
  stage: string;
  error: string | null;
  title: string | null;
  description: string | null;
  hashtags: string[];
  duration: number | null;
  videoUrl: string | null;
  thumbUrl: string | null;
  topics: VideoTopic[];
  createdAt: string;
}

export interface Author {
  nickname: string;
  avatarUrl: string | null;
  isAi: boolean;
}

export interface User extends Author {
  id: string;
  role: "owner" | "resident";
}

export interface FeedVideo extends Video {
  commentCount: number;
  likeCount: number;
  liked: boolean;
  /** Quem cadastrou o vídeo. */
  author: Author | null;
}

export interface Profile extends User {
  /** Nome de exibição e bio (só personas). */
  name: string | null;
  bio: string | null;
  liked: FeedVideo[];
}

export interface Login {
  token: string;
  user: User;
  created: boolean;
}

export interface FeedPage {
  videos: FeedVideo[];
  /** Todos os vídeos já tinham sido vistos: o feed recomeçou. */
  restarted: boolean;
}

export interface Comment {
  id: string;
  text: string;
  createdAt: string;
  author: Author;
}

/** Emojis de reação aceitos pela api. */
export const REACTIONS = ["❤️", "😂", "😮", "😢", "🔥", "👍"] as const;

export interface SharedVideo {
  id: string;
  title: string | null;
  description: string | null;
  videoUrl: string | null;
  thumbUrl: string | null;
}

export interface Reaction {
  emoji: string;
  nickname: string;
}

export interface Message {
  id: string;
  conversationId: string;
  type: "text" | "video";
  text: string | null;
  /** Vídeo compartilhado do feed. */
  video: SharedVideo | null;
  reactions: Reaction[];
  createdAt: string;
  sender: Author;
}

export interface Conversation {
  id: string;
  type: "direct" | "group";
  name: string | null;
  /** O Grupo do Bunker, com todo mundo da rede. */
  bunker: boolean;
  /** Os outros membros (sem você). */
  members: Author[];
  lastMessage: Message | null;
  unread: number;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** A api fica atrás do mesmo endereço do web, em /api (nginx em produção, proxy do Vite em dev). */
export interface PersonaPanel {
  /** Limite de ações de persona por hora (PERSONA_RATE). */
  rate: number;
  lastHour: number;
  personas: { nickname: string; name: string; avatarUrl: string | null; activity: number; lastHour: number }[];
  /** Últimas decisões do JEV (nas mensagens, sem o texto: conversa de gente é privada). */
  decisions: PersonaDecision[];
}

export interface PersonaDecision {
  nickname: string;
  name: string;
  trigger: "video" | "mensagem" | "tique";
  action: string;
  score: number;
  reasons: Record<string, unknown>;
  video: string | null;
  createdAt: string;
}

export const apiUrl = (path: string) => `/api${path}`;

const TOKEN_KEY = "doomscroll.sessao";
let token: string | null = stored.get(TOKEN_KEY);
let onUnauthorized: () => void = () => {};

/** Sessão do navegador: o token fica no localStorage (se ele existir) e vai em todo pedido. */
export const auth = {
  hasToken: () => token !== null,
  /** Usado para autenticar o WebSocket (que não leva cabeçalho). */
  token: () => token,
  setToken(value: string | null) {
    token = value;
    stored.set(TOKEN_KEY, value);
  },
  /** Chamado quando a api recusa a sessão (expirou ou foi encerrada). */
  onUnauthorized(fn: () => void) {
    onUnauthorized = fn;
  },
};

export async function request<T>(
  path: string,
  opts: { method?: string; body?: unknown; keepalive?: boolean } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetchImpl(apiUrl(path), {
    method: opts.method ?? "GET",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    keepalive: opts.keepalive,
  });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!res.ok) {
    const message = typeof data.error === "string" ? data.error : typeof data.message === "string" ? data.message : `Erro ${res.status}`;
    // Sessão recusada fora da tela de entrada: volta para a entrada.
    if (res.status === 401 && token && path !== "/auth/entrar") {
      auth.setToken(null);
      onUnauthorized();
    }
    throw new ApiError(message, res.status, data);
  }
  return data as T;
}

export const api = {
  /** A api respondeu? (o selo "Bunker no ar" da entrada). */
  health: () => request<{ status: string }>("/health").then(() => true, () => false),
  enter: (nickname: string, pin: string) => request<Login>("/auth/entrar", { method: "POST", body: { nickname, pin } }),
  me: () => request<User>("/auth/eu"),
  logout: () => request<void>("/auth/sair", { method: "POST" }),
  topics: () => request<Topic[]>("/topics"),
  feed: (exclude: string[]) => request<FeedPage>("/feed", { method: "POST", body: { exclude } }),
  comments: (videoId: string) => request<Comment[]>(`/videos/${videoId}/comments`),
  addComment: (videoId: string, text: string) => request<Comment>(`/videos/${videoId}/comments`, { method: "POST", body: { text } }),
  /** keepalive: o envio continua mesmo se a página for fechada logo depois. */
  view: (videoId: string, view: ViewPayload) =>
    request<void>(`/videos/${videoId}/view`, { method: "POST", body: view, keepalive: true }),
  like: (videoId: string, liked: boolean) =>
    request<{ liked: boolean; likeCount: number }>(`/videos/${videoId}/like`, { method: liked ? "PUT" : "DELETE" }),
  profile: (nickname: string) => request<Profile>(`/users/${encodeURIComponent(nickname)}`),
  submitVideo: (url: string) => request<Video>("/videos", { method: "POST", body: { url } }),
  video: (id: string) => request<Video>(`/videos/${id}`),
  confirmTopics: (id: string, topics: string[]) => request<Video>(`/videos/${id}/topics`, { method: "PUT", body: { topics } }),
  conversations: () => request<Conversation[]>("/conversations"),
  conversation: (id: string) => request<Conversation>(`/conversations/${id}`),
  openDirect: (nickname: string) => request<Conversation>("/conversations", { method: "POST", body: { nickname } }),
  /** Página de mensagens antes da mensagem `before` (ou as últimas), em ordem cronológica. */
  messages: (id: string, before?: string) =>
    request<Message[]>(`/conversations/${id}/messages${before ? `?before=${encodeURIComponent(before)}` : ""}`),
  /** Modo stalker: conversas da persona com outras personas e as mensagens de uma delas (só leitura). */
  stalkerConversations: (nickname: string) => request<Conversation[]>(`/personas/${encodeURIComponent(nickname)}/conversas`),
  stalkerMessages: (nickname: string, id: string, before?: string) =>
    request<Message[]>(
      `/personas/${encodeURIComponent(nickname)}/conversas/${id}/mensagens${before ? `?before=${encodeURIComponent(before)}` : ""}`,
    ),
  sendMessage: (id: string, text: string) => request<Message>(`/conversations/${id}/messages`, { method: "POST", body: { text } }),
  shareVideo: (id: string, videoId: string) =>
    request<Message>(`/conversations/${id}/messages`, { method: "POST", body: { videoId } }),
  /** emoji null tira a reação. */
  react: (id: string, messageId: string, emoji: string | null) =>
    request<{ reactions: Reaction[] }>(`/conversations/${id}/messages/${messageId}/reaction`, {
      method: emoji ? "PUT" : "DELETE",
      body: emoji ? { emoji } : undefined,
    }),
  createGroup: (name: string, nicknames: string[]) =>
    request<Conversation>("/groups", { method: "POST", body: { name, nicknames } }),
  markRead: (id: string, messageId: string) =>
    request<void>(`/conversations/${id}/read`, { method: "POST", body: { messageId } }),
  owner: {
    pending: () => request<Video[]>("/owner/videos?status=pendente"),
    approve: (id: string) => request<Video>(`/owner/videos/${id}/approve`, { method: "POST" }),
    reject: (id: string) => request<Video>(`/owner/videos/${id}/reject`, { method: "POST" }),
    createTopic: (name: string) => request<Topic>("/owner/topics", { method: "POST", body: { name } }),
    personas: () => request<PersonaPanel>("/owner/personas"),
  },
};
