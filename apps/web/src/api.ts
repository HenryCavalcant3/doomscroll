import { stored } from "./router";

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
export const apiUrl = (path: string) => `/api${path}`;

const TOKEN_KEY = "doomscroll.sessao";
let token: string | null = stored.get(TOKEN_KEY);
let onUnauthorized: () => void = () => {};

/** Sessão do navegador: o token fica no localStorage (se ele existir) e vai em todo pedido. */
export const auth = {
  hasToken: () => token !== null,
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
  opts: { method?: string; body?: unknown } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetchImpl(apiUrl(path), {
    method: opts.method ?? "GET",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
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
  enter: (nickname: string, pin: string) => request<Login>("/auth/entrar", { method: "POST", body: { nickname, pin } }),
  me: () => request<User>("/auth/eu"),
  logout: () => request<void>("/auth/sair", { method: "POST" }),
  topics: () => request<Topic[]>("/topics"),
  feed: (exclude: string[]) => request<FeedPage>("/feed", { method: "POST", body: { exclude } }),
  comments: (videoId: string) => request<Comment[]>(`/videos/${videoId}/comments`),
  addComment: (videoId: string, text: string) => request<Comment>(`/videos/${videoId}/comments`, { method: "POST", body: { text } }),
  like: (videoId: string, liked: boolean) =>
    request<{ liked: boolean; likeCount: number }>(`/videos/${videoId}/like`, { method: liked ? "PUT" : "DELETE" }),
  profile: (nickname: string) => request<Profile>(`/users/${encodeURIComponent(nickname)}`),
  submitVideo: (url: string) => request<Video>("/videos", { method: "POST", body: { url } }),
  video: (id: string) => request<Video>(`/videos/${id}`),
  confirmTopics: (id: string, topics: string[]) => request<Video>(`/videos/${id}/topics`, { method: "PUT", body: { topics } }),
  owner: {
    pending: () => request<Video[]>("/owner/videos?status=pendente"),
    approve: (id: string) => request<Video>(`/owner/videos/${id}/approve`, { method: "POST" }),
    reject: (id: string) => request<Video>(`/owner/videos/${id}/reject`, { method: "POST" }),
    createTopic: (name: string) => request<Topic>("/owner/topics", { method: "POST", body: { name } }),
  },
};
