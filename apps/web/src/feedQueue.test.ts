import { describe, expect, it } from "vitest";
import type { FeedVideo } from "./api";
import { appendPage, initialFeed, needsMore, patchVideo } from "./feedQueue";

const v = (id: string) => ({ id }) as FeedVideo;

describe("fila do feed", () => {
  it("acumula páginas e lembra o que já foi visto", () => {
    const s = appendPage(appendPage(initialFeed, { videos: [v("a"), v("b")], restarted: false }), {
      videos: [v("c")],
      restarted: false,
    });
    expect(s.entries.map((e) => e.key)).toEqual(["0:a", "0:b", "0:c"]);
    expect(s.seen).toEqual(["a", "b", "c"]);
  });

  it("começa uma nova volta quando o acervo acaba, sem repetir chaves", () => {
    let s = appendPage(initialFeed, { videos: [v("a")], restarted: false });
    s = appendPage(s, { videos: [v("a")], restarted: true });
    expect(s.entries.map((e) => e.key)).toEqual(["0:a", "1:a"]);
    expect(s.seen).toEqual(["a"]);
  });

  it("não repete o mesmo vídeo seguido na virada da volta", () => {
    let s = appendPage(initialFeed, { videos: [v("a"), v("b")], restarted: false });
    s = appendPage(s, { videos: [v("b"), v("a")], restarted: true });
    expect(s.entries.map((e) => e.video.id)).toEqual(["a", "b", "a", "b"]);
  });

  it("marca feed vazio só quando nunca veio nenhum vídeo", () => {
    expect(appendPage(initialFeed, { videos: [], restarted: false }).empty).toBe(true);
    const s = appendPage(initialFeed, { videos: [v("a")], restarted: false });
    expect(appendPage(s, { videos: [], restarted: false }).empty).toBe(false);
  });

  it("pede mais vídeos perto do fim da lista", () => {
    const s = appendPage(initialFeed, { videos: [v("a"), v("b"), v("c"), v("d")], restarted: false });
    expect(needsMore(s, 0)).toBe(false);
    expect(needsMore(s, 2)).toBe(true);
    expect(needsMore(initialFeed, 0)).toBe(true);
  });

  it("atualiza curtidas do vídeo em todas as voltas", () => {
    let s = appendPage(initialFeed, { videos: [v("a"), v("b")], restarted: false });
    s = appendPage(s, { videos: [v("a")], restarted: true });
    s = patchVideo(s, "a", { liked: true, likeCount: 1 });
    expect(s.entries.map((e) => e.video.liked)).toEqual([true, undefined, true]);
  });
});
