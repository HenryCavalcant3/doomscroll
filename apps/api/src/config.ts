export interface Config {
  port: number;
  host: string;
  ollamaUrl: string;
  llmModel: string;
  /** Tempo máximo de espera pela LLM. Em CPU a primeira carga do modelo pode passar de um minuto. */
  llmTimeoutMs: number;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? "0.0.0.0",
    ollamaUrl: env.OLLAMA_URL ?? "http://localhost:11434",
    llmModel: env.LLM_MODEL ?? "qwen2.5:3b",
    llmTimeoutMs: Number(env.LLM_TIMEOUT_MS ?? 300_000),
  };
}
