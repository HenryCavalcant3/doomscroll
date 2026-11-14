/**
 * Ritmo da persona (campo `ritmo` do JSON): faixas de hora em que ela costuma estar ativa, como
 * "06-12" ou "22-03" (passa da meia-noite). Não é agenda: fora das faixas a atividade só cai, até um
 * piso, e o acaso continua valendo (a Neide também perde o sono). Sem `ritmo`, vale 1 o dia todo.
 *
 * Este arquivo deve ficar igual em apps/api/src e apps/worker/src.
 */

export const RITMO = {
  /** Multiplicador mínimo da atividade, longe das faixas. */
  floor: 0.4,
  /** Quanto o multiplicador cai por hora de distância da faixa mais próxima. */
  perHour: 0.2,
};

const RANGE = /^(\d{2})-(\d{2})$/;

/** Valida uma faixa "HH-HH" (de 00 a 24, início diferente do fim). */
export function validRange(range: string): boolean {
  const m = RANGE.exec(range);
  if (!m) return false;
  const [from, to] = [Number(m[1]), Number(m[2])];
  return from <= 24 && to <= 24 && from % 24 !== to % 24;
}

/** Horas (0 a 23) cobertas pela faixa; o fim não entra ("06-12" vai das 6h às 11h59). */
function hoursOf(range: string): Set<number> {
  const m = RANGE.exec(range)!;
  const from = Number(m[1]) % 24;
  const to = Number(m[2]) % 24;
  const hours = new Set<number>();
  for (let h = from; h !== to; h = (h + 1) % 24) hours.add(h);
  return hours;
}

/** Multiplicador da atividade na hora `hour` (0 a 23): 1 dentro das faixas, caindo até o piso fora. */
export function rhythm(ritmo: string[] | undefined, hour: number): number {
  const ranges = (ritmo ?? []).filter(validRange);
  if (!ranges.length) return 1;
  const active = new Set(ranges.flatMap((r) => [...hoursOf(r)]));
  let distance = 24;
  for (const h of active) {
    const d = Math.abs(h - hour);
    distance = Math.min(distance, d, 24 - d);
  }
  return Math.max(RITMO.floor, Math.round((1 - RITMO.perHour * distance) * 100) / 100);
}

/** Hora local (0 a 23); o fuso vem de TZ (padrão America/Sao_Paulo no compose). */
export const localHour = (now: Date = new Date()) => now.getHours();
