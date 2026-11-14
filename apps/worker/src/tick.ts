import type { TickDb } from "./db.js";
import { planTick } from "./jev.js";
import { QUEUES } from "./queues.js";

export interface TickDeps {
  db: TickDb;
  send: (queue: string, data: object) => Promise<unknown>;
  /** PERSONA_RATE: no limite, o tique não puxa conversa. */
  personaRate: number;
  random?: () => number;
  log?: (msg: string) => void;
}

/**
 * Um tique do agendador (SPEC 7.4): escolhe quem puxa conversa, com quem e com que vídeo, e manda
 * para a api (fila persona.talk), que escreve as falas. Não usa a IA: só o banco e o JEV.
 */
export async function runTick(deps: TickDeps): Promise<void> {
  if (deps.personaRate === 0 || (await deps.db.personaActionsLastHour()) >= deps.personaRate) {
    deps.log?.("[worker] tique: limite de ações de persona por hora, ninguém puxa conversa");
    return;
  }
  const plan = planTick(await deps.db.tickCandidates(), deps.random);
  if (!plan) {
    deps.log?.("[worker] tique: nenhuma conversa possível agora (pares em pausa ou sem vídeo novo)");
    return;
  }
  await deps.send(QUEUES.personaTalk, { kind: "start", ...plan });
  deps.log?.(`[worker] tique: ${plan.starterId} manda ${plan.videoId} para ${plan.partnerId ?? "o Grupo do Bunker"}`);
}
