export class OllamaError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "OllamaError";
  }
}

export interface GenerateOptions {
  baseUrl: string;
  model: string;
  prompt: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

export interface GenerateResult {
  model: string;
  response: string;
  durationMs: number;
}

interface OllamaGenerateResponse {
  model: string;
  response: string;
  total_duration?: number;
}

/** Envia um prompt ao Ollama e devolve a resposta completa (sem streaming). */
export async function generate(opts: GenerateOptions): Promise<GenerateResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(new URL("/api/generate", opts.baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: opts.model, prompt: opts.prompt, stream: false }),
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new OllamaError("O modelo demorou demais para responder.", 504);
    }
    throw new OllamaError("Não foi possível falar com o Ollama.", 502);
  }

  if (res.status === 404) {
    throw new OllamaError(
      `Modelo "${opts.model}" não encontrado no Ollama. Aguarde o download terminar (docker compose logs -f ollama).`,
      503,
    );
  }
  if (!res.ok) {
    throw new OllamaError(`O Ollama respondeu com erro ${res.status}.`, 502);
  }

  const data = (await res.json()) as OllamaGenerateResponse;
  return {
    model: data.model,
    response: data.response.trim(),
    durationMs: Math.round((data.total_duration ?? 0) / 1e6),
  };
}
