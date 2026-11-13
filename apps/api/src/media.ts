import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { isUuid } from "./store.js";

/** Apaga a pasta de um vídeo (MP4, thumbnail e sobras). Não falha se ela não existir. */
export async function removeVideoMedia(mediaDir: string, id: string): Promise<void> {
  if (!isUuid(id)) return; // nunca monta caminho com algo que não seja um id
  await rm(join(mediaDir, id), { recursive: true, force: true });
}

/**
 * Limpeza na subida: apaga pastas de vídeos rejeitados, que falharam ou que não existem mais no banco.
 * `statusOf` devolve o status de cada id (ausente = vídeo não existe). Devolve os ids apagados.
 */
export async function sweepMedia(
  mediaDir: string,
  statusOf: (ids: string[]) => Promise<Map<string, string>>,
): Promise<string[]> {
  const dirs = (await readdir(mediaDir, { withFileTypes: true }))
    .filter((d) => d.isDirectory() && isUuid(d.name))
    .map((d) => d.name);
  if (!dirs.length) return [];
  const statuses = await statusOf(dirs);
  const stale = dirs.filter((id) => {
    const status = statuses.get(id);
    return status === undefined || status === "rejeitado" || status === "falhou";
  });
  for (const id of stale) await removeVideoMedia(mediaDir, id);
  return stale;
}
