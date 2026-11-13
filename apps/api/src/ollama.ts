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

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatStreamOptions {
  baseUrl: string;
  model: string;
  messages: ChatMessage[];
  /** Opções do Ollama (temperature, num_predict, stop...). */
  options?: Record<string, unknown>;
  timeoutMs: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

/**
 * Conversa com o Ollama em streaming (texto puro, sem JSON). `onText` recebe o texto acumulado
 * a cada pedaço; a função devolve o texto completo.
 */
export async function chatStream(opts: ChatStreamOptions, onText: (full: string) => void): Promise<string> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const signals = [AbortSignal.timeout(opts.timeoutMs), ...(opts.signal ? [opts.signal] : [])];
  let res: Response;
  try {
    res = await fetchImpl(new URL("/api/chat", opts.baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: opts.model, messages: opts.messages, stream: true, options: opts.options ?? {} }),
      signal: AbortSignal.any(signals),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") throw new OllamaError("O modelo demorou demais para responder.", 504);
    throw new OllamaError("Não foi possível falar com o Ollama.", 502);
  }
  if (res.status === 404) throw new OllamaError(`Modelo "${opts.model}" não encontrado no Ollama.`, 503);
  if (!res.ok || !res.body) throw new OllamaError(`O Ollama respondeu com erro ${res.status}.`, 502);

  // NDJSON: uma linha por pedaço; uma linha pode chegar partida entre dois pedaços da rede.
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  const handle = (line: string) => {
    if (!line.trim()) return;
    const data = JSON.parse(line) as { message?: { content?: string }; error?: string };
    if (data.error) throw new OllamaError(`Erro do Ollama: ${data.error}`, 502);
    const piece = data.message?.content ?? "";
    if (piece) {
      full += piece;
      onText(full);
    }
  };
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      handle(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
    }
  }
  handle(buffer + decoder.decode());
  return full;
}
