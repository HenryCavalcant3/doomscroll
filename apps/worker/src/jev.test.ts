import { describe, expect, it } from "vitest";
import { JEV, decideVideo, topicAffinity } from "./jev.js";

const rato = { activity: 0.2, affinity: { games: 0.8, fofoca: 0.1 } };
const fixed = (n: number) => () => n;

describe("JEV diante de um vídeo", () => {
  it("usa a média da afinidade com os tópicos, e um valor neutro para o que não conhece", () => {
    expect(topicAffinity(rato, ["games", "fofoca"])).toBeCloseTo(0.45);
    expect(topicAffinity(rato, ["culinaria"])).toBe(JEV.unknownAffinity);
    expect(topicAffinity(rato, [])).toBe(JEV.unknownAffinity);
  });

  it("gosto e atividade altos comentam; baixos ignoram; o meio curte", () => {
    const fan = { activity: 0.9, affinity: { games: 1 } };
    expect(decideVideo(fan, { topics: ["games"], recentWithAuthor: 0 }, fixed(0.5)).action).toBe("comentar");
    expect(decideVideo(rato, { topics: ["fofoca"], recentWithAuthor: 0 }, fixed(0.5)).action).toBe("ignorar");
    expect(decideVideo(rato, { topics: ["games"], recentWithAuthor: 0 }, fixed(0.5)).action).toBe("curtir");
  });

  it("o acaso muda a decisão nas bordas", () => {
    expect(decideVideo(rato, { topics: ["games"], recentWithAuthor: 0 }, fixed(0.99)).action).toBe("comentar");
    expect(decideVideo(rato, { topics: ["games"], recentWithAuthor: 0 }, fixed(0)).action).toBe("ignorar");
  });

  it("comentários recentes no mesmo autor baixam a nota, com teto", () => {
    const a = decideVideo(rato, { topics: ["games"], recentWithAuthor: 0 }, fixed(0.5));
    const b = decideVideo(rato, { topics: ["games"], recentWithAuthor: 10 }, fixed(0.5));
    expect(a.score - b.score).toBeCloseTo(JEV.maxRecencyPenalty);
    expect(b.reasons).toMatchObject({ afinidade: 0.8, atividade: 0.2, acaso: 0, recencia: -JEV.maxRecencyPenalty });
  });
});
