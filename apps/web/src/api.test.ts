import { describe, expect, it, vi } from "vitest";
import { ApiError, auth, request } from "./api";
import { parseRoute } from "./router";
import { isProcessing, processingSteps } from "./stages";

describe("request", () => {
  it("chama a api via /api e manda o token da sessão", async () => {
    auth.setToken("tok_abc");
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify([{ id: 1 }])));
    await expect(request("/owner/videos", {}, fetchImpl)).resolves.toEqual([{ id: 1 }]);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("/api/owner/videos");
    expect(init?.headers).toEqual({ authorization: "Bearer tok_abc" });
    auth.setToken(null);
  });

  it("esquece a sessão recusada e avisa o app", async () => {
    auth.setToken("tok_velho");
    const onOut = vi.fn();
    auth.onUnauthorized(onOut);
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ error: "Entre" }), { status: 401 }));
    await expect(request("/feed", {}, fetchImpl)).rejects.toMatchObject({ status: 401 });
    expect(onOut).toHaveBeenCalledOnce();
    expect(auth.hasToken()).toBe(false);
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
    await expect(request("/auth/sair", { method: "POST" }, fetchImpl)).resolves.toEqual({});
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

describe("rotas", () => {
  it("entende as telas e o perfil por apelido", () => {
    expect(parseRoute("")).toEqual({ name: "feed" });
    expect(parseRoute("#/adicionar")).toEqual({ name: "adicionar" });
    expect(parseRoute("#/u/tio_valdir")).toEqual({ name: "usuario", nickname: "tio_valdir" });
    expect(parseRoute("#/qualquer")).toEqual({ name: "feed" });
  });
});
