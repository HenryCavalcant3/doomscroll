import type { PgBoss } from "pg-boss";

// Mantenha igual a apps/worker/src/queues.ts.
export const QUEUES = {
  download: "video.download",
  convert: "video.convert",
  transcribe: "video.transcribe",
  suggest: "video.suggest",
  embed: "video.embed",
  personaComment: "persona.comment",
  /** Atualiza o resumo que a persona guarda de um contato (persona_memory). */
  personaMemory: "persona.memory",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/** Filas do pipeline de vídeo (jobs { videoId }). */
export const VIDEO_QUEUES = [QUEUES.download, QUEUES.convert, QUEUES.transcribe, QUEUES.suggest, QUEUES.embed, QUEUES.personaComment] as const;
export type VideoQueue = (typeof VIDEO_QUEUES)[number];

export const QUEUE_OPTIONS = {
  retryLimit: 2,
  retryDelay: 10,
  retryBackoff: true,
  expireInSeconds: 1800,
};

/** Cria as filas se ainda não existirem (pode rodar na api e no worker ao mesmo tempo). */
export async function ensureQueues(boss: PgBoss): Promise<void> {
  for (const name of Object.values(QUEUES)) {
    if (await boss.getQueue(name)) continue;
    try {
      await boss.createQueue(name, QUEUE_OPTIONS);
    } catch (err) {
      if (!(await boss.getQueue(name))) throw err;
    }
  }
}
