import type { FeedPage, FeedVideo } from "./api";

export interface FeedEntry {
  /** Único na lista, mesmo quando o feed recomeça e o vídeo volta. */
  key: string;
  video: FeedVideo;
}

export interface FeedState {
  entries: FeedEntry[];
  /** Ids já entregues nesta volta do acervo (vão como `exclude` no próximo pedido). */
  seen: string[];
  round: number;
  /** O servidor não tem nenhum vídeo aprovado. */
  empty: boolean;
}

export const initialFeed: FeedState = { entries: [], seen: [], round: 0, empty: false };

/** Junta uma página do feed à lista. Quando o acervo acaba, o servidor recomeça e uma nova volta começa. */
export function appendPage(state: FeedState, page: FeedPage): FeedState {
  const round = page.restarted ? state.round + 1 : state.round;
  const seen = page.restarted ? [] : state.seen;
  let videos = page.videos;
  // Na virada da volta, evita o mesmo vídeo duas vezes seguidas.
  const last = state.entries.at(-1)?.video.id;
  if (page.restarted && videos.length > 1 && videos[0]!.id === last) videos = [...videos.slice(1), videos[0]!];
  return {
    entries: [...state.entries, ...videos.map((video) => ({ key: `${round}:${video.id}`, video }))],
    seen: [...seen, ...videos.map((v) => v.id)],
    round,
    empty: state.entries.length === 0 && page.videos.length === 0,
  };
}

/** Pede mais vídeos quando faltam poucos para o fim da lista. */
export const needsMore = (state: FeedState, active: number) => !state.empty && active >= state.entries.length - 2;
