import { describe, expect, it, vi } from "vitest";
import { buildApp } from "./app.js";
import { readConfig } from "./config.js";

const config = { ...readConfig({}), ollamaUrl: "http://ollama:11434", llmModel: "modelo-teste" };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("api", () => {
  it("GET /health responde ok", async () => {
    const app = buildApp({ config });
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("POST /ai/teste envia o prompt ao Ollama e devolve a resposta", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ model: "modelo-teste", response: "  Bom dia, sobreviventes!  ", total_duration: 1_500_000_000 }),
    );
    const app = buildApp({ config, fetchImpl });

    const res = await app.inject({ method: "POST", url: "/ai/teste", payload: { prompt: "Oi" } });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ model: "modelo-teste", response: "Bom dia, sobreviventes!", durationMs: 1500 });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("http://ollama:11434/api/generate");
    expect(JSON.parse(String(init?.body))).toEqual({ model: "modelo-teste", prompt: "Oi", stream: false });
  });

  it("POST /ai/teste rejeita prompt vazio", async () => {
    const app = buildApp({ config, fetchImpl: vi.fn<typeof fetch>() });
    const res = await app.inject({ method: "POST", url: "/ai/teste", payload: { prompt: "" } });
    expect(res.statusCode).toBe(400);
  });

  it("POST /ai/teste devolve 503 quando o modelo ainda não foi baixado", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ error: "model not found" }, 404));
    const app = buildApp({ config, fetchImpl });
    const res = await app.inject({ method: "POST", url: "/ai/teste", payload: { prompt: "Oi" } });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toContain("modelo-teste");
  });

  it("POST /ai/teste devolve 502 quando o Ollama está fora do ar", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError("fetch failed");
    });
    const app = buildApp({ config, fetchImpl });
    const res = await app.inject({ method: "POST", url: "/ai/teste", payload: { prompt: "Oi" } });
    expect(res.statusCode).toBe(502);
  });
});
