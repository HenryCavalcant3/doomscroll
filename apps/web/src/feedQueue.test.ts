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
    expect(s.entries.map((e) => e.key)).toEqual(["0:a", "1:zerou", "1:a"]);
    expect(s.seen).toEqual(["a"]);
  });

  it("não repete o mesmo vídeo seguido na virada da volta", () => {
    let s = appendPage(initialFeed, { videos: [v("a"), v("b")], restarted: false });
    s = appendPage(s, { videos: [v("b"), v("a")], restarted: true });
    expect(s.entries.map((e) => ("video" in e ? e.video.id : "zerou"))).toEqual(["a", "b", "zerou", "a", "b"]);
  });

  it("põe o card \"zerou a internet\" na virada, com os vídeos da volta que acabou", () => {
    let s = appendPage(initialFeed, { videos: [v("a"), v("b")], restarted: false });
    s = appendPage(s, { videos: [v("c")], restarted: false });
    s = appendPage(s, { videos: [v("a"), v("b")], restarted: true });
    expect(s.entries[3]).toEqual({ key: "1:zerou", zerou: 3 });
    // Na segunda virada o card conta só a segunda volta, e a chave não repete.
    s = appendPage(s, { videos: [v("c")], restarted: true });
    expect(s.entries.filter((e) => "zerou" in e)).toEqual([
      { key: "1:zerou", zerou: 3 },
      { key: "2:zerou", zerou: 2 },
    ]);
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
    expect(s.entries.map((e) => ("video" in e ? e.video.liked : "zerou"))).toEqual([true, undefined, "zerou", true]);
  });
});
