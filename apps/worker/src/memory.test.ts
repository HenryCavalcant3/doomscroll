import { describe, expect, it, vi } from "vitest";
import { buildMemoryPrompt, parseMemory } from "./ai.js";
import type { MemoryContext, MemoryDb } from "./db.js";
import { MEMORY_LINES, updateMemory } from "./memory.js";

describe("memória da persona", () => {
  it("resume a conversa junto com o que já sabia e grava", async () => {
    const ctx: MemoryContext = {
      personaName: "Tio Valdir",
      contact: "ana",
      summary: "Ana gosta de gatos.",
      lines: [
        { fromPersona: false, text: "tio, adotei um cachorro" },
        { fromPersona: true, text: "Que coisa linda!" },
      ],
    };
    const saved: string[] = [];
    const db: MemoryDb = { memoryContext: vi.fn(async () => ctx), saveMemory: async (_p, _c, s) => void saved.push(s) };
    const summarize = vi.fn(async () => "Ana gosta de gatos e adotou um cachorro.");
    await updateMemory({ db, summarize }, { personaId: "p", contactId: "c" });
    expect(db.memoryContext).toHaveBeenCalledWith("p", "c", MEMORY_LINES);
    expect(summarize).toHaveBeenCalledWith("Tio Valdir", "ana", "Ana gosta de gatos.", ctx.lines);
    expect(saved).toEqual(["Ana gosta de gatos e adotou um cachorro."]);
  });

  it("sem conversa não chama a IA", async () => {
    const summarize = vi.fn(async () => "x");
    const db: MemoryDb = { memoryContext: async () => null, saveMemory: vi.fn() };
    await updateMemory({ db, summarize }, { personaId: "p", contactId: "c" });
    expect(summarize).not.toHaveBeenCalled();
  });

  it("monta o prompt com quem disse o quê e aceita só JSON válido", () => {
    const prompt = buildMemoryPrompt("Tio Valdir", "ana", "", [{ fromPersona: false, text: "oi" }, { fromPersona: true, text: "Bom dia!" }]);
    expect(prompt).toContain("@ana: oi\nTio Valdir: Bom dia!");
    expect(prompt).toContain("(nada ainda)");
    expect(parseMemory('{"resumo": "  Ana   gosta de gatos. "}')).toBe("Ana gosta de gatos.");
    expect(parseMemory("não é json")).toBeNull();
    expect(parseMemory('{"resumo": "oi"}')).toBeNull();
    expect(parseMemory(JSON.stringify({ resumo: "a ".repeat(500) }))!.length).toBeLessThanOrEqual(401);
  });
});
