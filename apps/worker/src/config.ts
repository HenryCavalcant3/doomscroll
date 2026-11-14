export interface Config {
  databaseUrl: string;
  mediaDir: string;
  whisperDir: string;
  whisperModel: string;
  ollamaUrl: string;
  llmModel: string;
  embedModel: string;
  /** Ações de persona por hora (comentários e mensagens); 0 desliga as personas. */
  personaRate: number;
  /** Cron do agendador das personas (conversas entre elas); null desliga. */
  personaTick: string | null;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL não definida.");
  const whisperModel = env.WHISPER_MODEL || "base";
  if (!/^[a-z0-9.-]+$/.test(whisperModel)) throw new Error(`WHISPER_MODEL inválido: ${whisperModel}`);
  const personaRate = Number(env.PERSONA_RATE || 30);
  if (!Number.isInteger(personaRate) || personaRate < 0) throw new Error(`PERSONA_RATE inválido: ${env.PERSONA_RATE}`);
  // Padrão: a cada 30 minutos. "off" desliga as conversas entre personas.
  const tick = (env.PERSONA_TICK ?? "").trim() || "*/30 * * * *";
  if (tick !== "off" && tick.split(/\s+/).length !== 5) throw new Error(`PERSONA_TICK inválido (cron de 5 campos ou "off"): ${tick}`);
  return {
    personaRate,
    personaTick: tick === "off" ? null : tick,
    databaseUrl,
    mediaDir: env.MEDIA_DIR ?? "/data/media",
    whisperDir: env.WHISPER_DIR ?? "/data/whisper",
    whisperModel,
    ollamaUrl: env.OLLAMA_URL ?? "http://localhost:11434",
    llmModel: env.LLM_MODEL ?? "qwen2.5:3b",
    embedModel: env.EMBED_MODEL ?? "nomic-embed-text",
  };
}
