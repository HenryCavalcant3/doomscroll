import { describe, expect, it, vi } from "vitest";
import type { TickDb } from "./db.js";
import { QUEUES } from "./queues.js";
import { runTick } from "./tick.js";

const db = (actions: number): TickDb => ({
  personaActionsLastHour: async () => actions,
  tickCandidates: async () => ({
    personas: [{ id: "valdir", nickname: "tio_valdir", activity: 0.9, affinity: {}, relations: [] }, { id: "rato", nickname: "rato", activity: 0.2, affinity: {}, relations: [] }],
    videos: [{ id: "v1", topics: [], likedBy: ["valdir"] }],
    sentInPair: new Map(),
    coolingPairs: new Set(),
    bunkerVideos: new Set(),
  }),
});

describe("tique do agendador", () => {
  it("manda para a api quem puxa conversa, com quem e com que vídeo", async () => {
    const send = vi.fn(async () => "job");
    await runTick({ db: db(0), send, personaRate: 30, random: () => 0.5 });
    expect(send).toHaveBeenCalledWith(QUEUES.personaTalk, expect.objectContaining({ kind: "start", starterId: "valdir", partnerId: "rato", videoId: "v1" }));
  });

  it("no limite por hora (ou com PERSONA_RATE=0), ninguém puxa conversa", async () => {
    const send = vi.fn(async () => "job");
    await runTick({ db: db(30), send, personaRate: 30 });
    await runTick({ db: db(0), send, personaRate: 0 });
    expect(send).not.toHaveBeenCalled();
  });
});
