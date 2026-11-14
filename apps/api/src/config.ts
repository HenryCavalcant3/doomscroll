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
  /** Modelo de embedding: a persona busca vídeos no acervo pelo assunto da conversa (RAG). */
  embedModel: string;
  /** Tempo máximo de espera pela LLM. Em CPU a primeira carga do modelo pode passar de um minuto. */
  llmTimeoutMs: number;
  /** Ações de persona por hora (comentários e conversas entre personas param no limite; respostas a gente, nunca). */
  personaRate: number;
  /** Pausa média, em segundos, entre duas falas de personas conversando entre si. */
  personaTalkDelay: number;
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
    embedModel: env.EMBED_MODEL ?? "nomic-embed-text",
    llmTimeoutMs: Number(env.LLM_TIMEOUT_MS ?? 300_000),
    personaRate: Number(env.PERSONA_RATE || 30),
    personaTalkDelay: Number(env.PERSONA_TALK_DELAY || 40),
  };
}
