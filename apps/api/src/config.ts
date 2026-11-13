import { DEFAULT_PERSONAS_DIR } from "./personas.js";

export interface Config {
  port: number;
  host: string;
  databaseUrl: string;
  mediaDir: string;
  /** Pasta com os JSON e avatares das personas. */
  personasDir: string;
  ownerPin: string | undefined;
  ollamaUrl: string;
  llmModel: string;
  /** Tempo máximo de espera pela LLM. Em CPU a primeira carga do modelo pode passar de um minuto. */
  llmTimeoutMs: number;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? "0.0.0.0",
    databaseUrl: env.DATABASE_URL ?? "postgres://doomscroll:doomscroll@localhost:5432/doomscroll",
    mediaDir: env.MEDIA_DIR ?? "/data/media",
    personasDir: env.PERSONAS_DIR ?? DEFAULT_PERSONAS_DIR,
    ownerPin: env.OWNER_PIN || undefined,
    ollamaUrl: env.OLLAMA_URL ?? "http://localhost:11434",
    llmModel: env.LLM_MODEL ?? "qwen2.5:3b",
    llmTimeoutMs: Number(env.LLM_TIMEOUT_MS ?? 300_000),
  };
}
