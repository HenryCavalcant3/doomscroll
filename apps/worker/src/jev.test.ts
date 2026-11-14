import { describe, expect, it } from "vitest";
import { JEV, decideVideo, pairKey, planTick, topicAffinity } from "./jev.js";

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

describe("agendador das personas", () => {
  const p = (id: string, activity: number, affinity: Record<string, number>, relations: string[] = []) => ({ id, nickname: id, activity, affinity, relations });
  const base = () => ({
    personas: [p("valdir", 0.9, { humor: 0.9 }, ["rato"]), p("rato", 0.2, { games: 0.9, humor: 0.1 })],
    videos: [
      { id: "piada", topics: ["humor"], likedBy: ["valdir"] },
      { id: "speedrun", topics: ["games"], likedBy: ["valdir"] },
    ],
    sentInPair: new Map<string, Set<string>>(),
    coolingPairs: new Set<string>(),
    bunkerVideos: new Set<string>(),
  });

  it("quem puxa conversa manda um vídeo que curtiu, escolhido pelo gosto de quem recebe", () => {
    // 0,5: Valdir (único que curtiu algo); 0,5: não vai pro grupo; par: Rato; vídeo: o speedrun pesa 0,81 contra 0,01.
    const plan = planTick(base(), () => 0.5);
    expect(plan).toMatchObject({ starterId: "valdir", partnerId: "rato", videoId: "speedrun", reasons: { relacao: true } });
  });

  it("não repete vídeo no mesmo par e deixa o par quieto depois de conversar", () => {
    const c = base();
    c.sentInPair.set(pairKey("valdir", "rato"), new Set(["speedrun", "piada"]));
    expect(planTick(c, () => 0.5)).toBeNull();
    const cooling = base();
    cooling.coolingPairs.add(pairKey("rato", "valdir"));
    expect(planTick(cooling, () => 0.5)).toBeNull();
  });

  it("às vezes manda no Grupo do Bunker", () => {
    const rolls = [0.5, 0.01, 0.1];
    expect(planTick(base(), () => rolls.shift() ?? 0)).toMatchObject({ partnerId: null, videoId: "piada", reasons: { grupo: true } });
  });
});

describe("agendador: vídeo repetido", () => {
  it("quem puxa conversa não manda para outra persona um vídeo que já mandou para alguém", () => {
    const p = (id: string, activity: number) => ({ id, nickname: id, activity, affinity: {}, relations: [] });
    const c = {
      personas: [p("valdir", 0.9), p("rato", 0.2), p("kelly", 0.7)],
      videos: [{ id: "cookie", topics: [], likedBy: ["valdir"] }],
      sentInPair: new Map([[pairKey("valdir", "kelly"), new Set(["cookie"])]]),
      coolingPairs: new Set<string>(),
      bunkerVideos: new Set<string>(),
    };
    expect(planTick(c, () => 0.5)).toBeNull();
  });
});
