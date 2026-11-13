import type { MemoryLine } from "./ai.js";
import type { MemoryDb } from "./db.js";

/** Mensagens recentes que entram no resumo. */
export const MEMORY_LINES = 20;

export interface MemoryDeps {
  db: MemoryDb;
  summarize(personaName: string, contact: string, summary: string, lines: MemoryLine[]): Promise<string>;
  log?: (msg: string) => void;
}

/** Atualiza o que a persona lembra do contato (job persona.memory, pedido pela api a cada N mensagens). */
export async function updateMemory(deps: MemoryDeps, data: { personaId: string; contactId: string }): Promise<void> {
  const ctx = await deps.db.memoryContext(data.personaId, data.contactId, MEMORY_LINES);
  if (!ctx || ctx.lines.length === 0) return;
  const summary = await deps.summarize(ctx.personaName, ctx.contact, ctx.summary, ctx.lines);
  await deps.db.saveMemory(data.personaId, data.contactId, summary);
  deps.log?.(`[worker] memória de ${ctx.personaName} sobre @${ctx.contact}: ${summary}`);
}
