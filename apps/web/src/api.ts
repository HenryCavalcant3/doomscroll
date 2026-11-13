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

export interface FeedVideo extends Video {
  commentCount: number;
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
  author: { nickname: string; avatarUrl: string | null; isAi: boolean };
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

export async function request<T>(
  path: string,
  opts: { method?: string; body?: unknown; ownerPin?: string } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.ownerPin) headers["x-owner-pin"] = opts.ownerPin;
  const res = await fetchImpl(apiUrl(path), {
    method: opts.method ?? "GET",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!res.ok) {
    const message = typeof data.error === "string" ? data.error : typeof data.message === "string" ? data.message : `Erro ${res.status}`;
    throw new ApiError(message, res.status, data);
  }
  return data as T;
}

export const api = {
  topics: () => request<Topic[]>("/topics"),
  feed: (exclude: string[]) => request<FeedPage>("/feed", { method: "POST", body: { exclude } }),
  comments: (videoId: string) => request<Comment[]>(`/videos/${videoId}/comments`),
  submitVideo: (url: string) => request<Video>("/videos", { method: "POST", body: { url } }),
  video: (id: string) => request<Video>(`/videos/${id}`),
  confirmTopics: (id: string, topics: string[]) => request<Video>(`/videos/${id}/topics`, { method: "PUT", body: { topics } }),
  owner: {
    login: (pin: string) => request<void>("/owner/login", { method: "POST", ownerPin: pin }),
    pending: (pin: string) => request<Video[]>("/owner/videos?status=pendente", { ownerPin: pin }),
    approve: (pin: string, id: string) => request<Video>(`/owner/videos/${id}/approve`, { method: "POST", ownerPin: pin }),
    reject: (pin: string, id: string) => request<Video>(`/owner/videos/${id}/reject`, { method: "POST", ownerPin: pin }),
    createTopic: (pin: string, name: string) =>
      request<Topic>("/owner/topics", { method: "POST", ownerPin: pin, body: { name } }),
  },
};
