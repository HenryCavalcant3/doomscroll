import { describe, expect, it } from "vitest";
import { LlmGate, PRIORITY } from "./gate.js";

describe("portão da IA", () => {
  it("roda uma chamada por vez e passa a ingestão na frente das personas", async () => {
    const gate = new LlmGate();
    const order: string[] = [];
    let running = 0;
    let maxRunning = 0;
    let release!: () => void;
    const first = gate.run(PRIORITY.persona, async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise<void>((r) => (release = r));
      order.push("persona 1");
      running--;
    });
    const job = (name: string, priority: number) =>
      gate.run(priority, async () => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await Promise.resolve();
        order.push(name);
        running--;
      });
    const rest = [job("persona 2", PRIORITY.persona), job("ingestão 1", PRIORITY.ingest), job("ingestão 2", PRIORITY.ingest)];
    await Promise.resolve();
    expect(gate.pending).toBe(3);
    release();
    await Promise.all([first, ...rest]);
    expect(order).toEqual(["persona 1", "ingestão 1", "ingestão 2", "persona 2"]);
    expect(maxRunning).toBe(1);
    expect(gate.pending).toBe(0);
  });

  it("libera a vez mesmo quando a chamada falha", async () => {
    const gate = new LlmGate();
    await expect(gate.run(PRIORITY.ingest, async () => Promise.reject(new Error("ollama fora")))).rejects.toThrow();
    expect(await gate.run(PRIORITY.persona, async () => "ok")).toBe("ok");
  });
});
