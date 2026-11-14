import type { FeedPage, FeedVideo } from "./api";

/** Um vídeo do feed, ou o card "Você zerou a internet" entre duas voltas do acervo. */
export type FeedEntry =
  | {
      /** Único na lista, mesmo quando o feed recomeça e o vídeo volta. */
      key: string;
      video: FeedVideo;
    }
  | {
      key: string;
      /** Quantos vídeos a volta que acabou entregou. */
      zerou: number;
    };

const videoOf = (e: FeedEntry | undefined) => (e && "video" in e ? e.video : undefined);

export interface FeedState {
  entries: FeedEntry[];
  /** Ids já entregues nesta volta do acervo (vão como `exclude` no próximo pedido). */
  seen: string[];
  round: number;
  /** O servidor não tem nenhum vídeo aprovado. */
  empty: boolean;
}

export const initialFeed: FeedState = { entries: [], seen: [], round: 0, empty: false };

/**
 * Junta uma página do feed à lista. Quando o acervo acaba, o servidor recomeça e uma nova volta começa,
 * com o card "Você zerou a internet" na virada.
 */
export function appendPage(state: FeedState, page: FeedPage): FeedState {
  const round = page.restarted ? state.round + 1 : state.round;
  const seen = page.restarted ? [] : state.seen;
  let videos = page.videos;
  // Na virada da volta, evita o mesmo vídeo duas vezes seguidas.
  const last = videoOf(state.entries.at(-1))?.id;
  if (page.restarted && videos.length > 1 && videos[0]!.id === last) videos = [...videos.slice(1), videos[0]!];
  return {
    entries: [
      ...state.entries,
      ...(page.restarted && videos.length ? [{ key: `${round}:zerou`, zerou: state.seen.length }] : []),
      ...videos.map((video) => ({ key: `${round}:${video.id}`, video })),
    ],
    seen: [...seen, ...videos.map((v) => v.id)],
    round,
    empty: state.entries.length === 0 && page.videos.length === 0,
  };
}

/** Pede mais vídeos quando faltam poucos para o fim da lista. */
export const needsMore = (state: FeedState, active: number) => !state.empty && active >= state.entries.length - 2;

/** Atualiza um vídeo em todas as entradas (ele pode aparecer mais de uma vez, em voltas diferentes). */
export function patchVideo(state: FeedState, id: string, patch: Partial<FeedVideo>): FeedState {
  return {
    ...state,
    entries: state.entries.map((e) => ("video" in e && e.video.id === id ? { ...e, video: { ...e.video, ...patch } } : e)),
  };
}
