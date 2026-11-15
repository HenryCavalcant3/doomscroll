/**
 * Textos de modelo fixo do Boletim do Bunker (docs/boletim/BOLETIM.md, "Textos da interface").
 * Números e rótulos saem daqui; a persona só assina a manchete e a fofoca.
 */

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function parse(date: string): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

/** O boletim de ontem é o "de hoje": é o que saiu hoje de manhã. */
export function isLatest(date: string, now: Date = new Date()): boolean {
  return date === iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
}

/** "Ontem, sexta-feira, 13 de novembro"; boletins mais antigos sem o "Ontem". */
export function dateLabel(date: string, now: Date = new Date()): string {
  const d = parse(date);
  const long = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long" }).format(d);
  if (isLatest(date, now)) return `Ontem, ${long}`;
  return long.charAt(0).toUpperCase() + long.slice(1);
}

/** Data curta para a etiqueta da mensagem no grupo e listas: "13 de novembro". */
export function shortDate(date: string): string {
  return new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long" }).format(parse(date));
}

/** Autonomia do estoque: "3 h 40 min de rolagem". */
export function rollTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return "menos de um minuto de rolagem";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min de rolagem`;
  return m ? `${h} h ${m} min de rolagem` : `${h} h de rolagem`;
}

/** Rótulo ao lado do número grande: singular e plural. */
export const newVideosLabel = (n: number) => (n === 1 ? "vídeo novo" : "vídeos novos");

/** Divisão abaixo do total: "30 moradores · 12 personas". */
export function splitLabel(s: { moradores: number; personas: number }): string {
  const people = s.moradores === 1 ? "1 morador" : `${s.moradores} moradores`;
  const ai = s.personas === 1 ? "1 persona" : `${s.personas} personas`;
  return `${people} · ${ai}`;
}

export const residentsLabel = (n: number) => (n === 1 ? "morador" : "moradores");

/** Etiqueta da mensagem no grupo: "Boletim do Bunker · ontem", ou com o dia nos mais antigos. */
export const bulletinTag = (date: string, now: Date = new Date()) => `Boletim do Bunker · ${isLatest(date, now) ? "ontem" : shortDate(date)}`;
