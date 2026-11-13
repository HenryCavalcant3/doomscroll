import { describe, expect, it, vi } from "vitest";
import { askModel } from "./api";

describe("askModel", () => {
  it("devolve a resposta do modelo", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ model: "m", response: "oi", durationMs: 1 })),
    );
    await expect(askModel("olá", fetchImpl)).resolves.toEqual({ model: "m", response: "oi", durationMs: 1 });
    expect(fetchImpl).toHaveBeenCalledWith("/api/ai/teste", expect.objectContaining({ method: "POST" }));
  });

  it("lança a mensagem de erro da api", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ error: "modelo não encontrado" }), { status: 503 }),
    );
    await expect(askModel("olá", fetchImpl)).rejects.toThrow("modelo não encontrado");
  });
});
