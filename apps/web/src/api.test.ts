import { describe, expect, it, vi } from "vitest";
import { ApiError, request } from "./api";
import { isProcessing, processingSteps } from "./stages";

describe("request", () => {
  it("chama a api via /api e manda o PIN do dono no cabeçalho", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify([{ id: 1 }])));
    await expect(request("/owner/videos", { ownerPin: "1234" }, fetchImpl)).resolves.toEqual([{ id: 1 }]);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("/api/owner/videos");
    expect(init?.headers).toEqual({ "x-owner-pin": "1234" });
  });

  it("lança a mensagem de erro da api, com status e corpo", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ error: "Esse vídeo já está no bunker.", id: "v1" }), { status: 409 }),
    );
    const err = await request("/videos", { method: "POST", body: { url: "x" } }, fetchImpl).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ message: "Esse vídeo já está no bunker.", status: 409, body: { id: "v1" } });
  });

  it("aceita resposta vazia (204)", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    await expect(request("/owner/login", { method: "POST" }, fetchImpl)).resolves.toEqual({});
  });
});

describe("etapas do processamento", () => {
  const states = (stage: string, status = "processando") =>
    processingSteps({ stage, status: status as never }).map((s) => s.state);

  it("marca feito, em andamento e na fila", () => {
    expect(states("transcrevendo")).toEqual(["feito", "feito", "em andamento", "na fila"]);
    expect(states("baixando", "baixando")).toEqual(["em andamento", "na fila", "na fila", "na fila"]);
  });

  it("tudo feito depois das sugestões", () => {
    expect(states("aguardando_confirmacao")).toEqual(["feito", "feito", "feito", "feito"]);
  });

  it("mostra onde falhou", () => {
    expect(states("convertendo", "falhou")).toEqual(["feito", "falhou", "na fila", "na fila"]);
  });

  it("só consulta de novo enquanto o worker trabalha", () => {
    expect(isProcessing({ stage: "convertendo", status: "processando" })).toBe(true);
    expect(isProcessing({ stage: "aguardando_confirmacao", status: "processando" })).toBe(false);
    expect(isProcessing({ stage: "baixando", status: "falhou" })).toBe(false);
  });
});
