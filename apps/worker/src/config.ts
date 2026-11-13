export interface Config {
  databaseUrl: string;
  mediaDir: string;
  whisperDir: string;
  whisperModel: string;
  ollamaUrl: string;
  llmModel: string;
  embedModel: string;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL não definida.");
  const whisperModel = env.WHISPER_MODEL || "base";
  if (!/^[a-z0-9.-]+$/.test(whisperModel)) throw new Error(`WHISPER_MODEL inválido: ${whisperModel}`);
  return {
    databaseUrl,
    mediaDir: env.MEDIA_DIR ?? "/data/media",
    whisperDir: env.WHISPER_DIR ?? "/data/whisper",
    whisperModel,
    ollamaUrl: env.OLLAMA_URL ?? "http://localhost:11434",
    llmModel: env.LLM_MODEL ?? "qwen2.5:3b",
    embedModel: env.EMBED_MODEL ?? "nomic-embed-text",
  };
}
