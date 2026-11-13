import type { PgBoss } from "pg-boss";

// Mantenha igual a apps/worker/src/queues.ts.
export const QUEUES = {
  download: "video.download",
  convert: "video.convert",
  transcribe: "video.transcribe",
  suggest: "video.suggest",
  embed: "video.embed",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

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
