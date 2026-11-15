/**
 * Boletim do Bunker (docs/boletim/BOLETIM.md): o dia coberto, a persona de plantão, a montagem dos
 * fatos e o sorteio da pauta. Tudo aqui é puro (sem banco e sem IA); o SQL fica em bulletinDb.ts.
 */

/** Dia de calendário coberto pelo boletim, no fuso do servidor (TZ do processo, nunca o do Postgres). */
export interface DayWindow {
  /** AAAA-MM-DD */
  date: string;
  start: Date;
  end: Date;
}

/** Dias anteriores usados como média de cada persona no detector de fato curioso. */
export const HISTORY_DAYS = 7;
/** Pauta usada há menos que isto não volta (a não ser que todas tenham sido usadas). */
export const PAUTA_COOLDOWN_DAYS = 14;
/** Abaixo disto (eventos de pessoas reais), a manchete vem da frase de "dia parado". */
export const SLOW_DAY_EVENTS = 5;

const pad = (n: number) => String(n).padStart(2, "0");
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** O dia `offset` dias antes de `now` (1 = ontem), da meia-noite local à meia-noite seguinte. */
export function dayWindow(now: Date = new Date(), offset = 1): DayWindow {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset + 1);
  return { date: localDate(start), start, end };
}

/**
 * Meias-noites dos `HISTORY_DAYS` dias anteriores e do dia coberto, em ordem, terminando no fim dele
 * (HISTORY_DAYS + 2 limites). Calculadas no Node: o horário de verão, se voltar, não desloca os dias.
 */
export function dayBoundaries(day: DayWindow): Date[] {
  const s = day.start;
  const out: Date[] = [];
  for (let i = HISTORY_DAYS; i >= 0; i--) out.push(new Date(s.getFullYear(), s.getMonth(), s.getDate() - i));
  out.push(day.end);
  return out;
}

/** Dia do ano (1 a 366) de uma data AAAA-MM-DD. */
export function dayOfYear(date: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86_400_000) + 1;
}

/** Persona de plantão: rodízio pela data (dia do ano módulo número de personas), em ordem de apelido. */
export function pickOnDuty<T extends { nickname: string }>(date: string, personas: readonly T[]): T | null {
  if (!personas.length) return null;
  const sorted = [...personas].sort((a, b) => a.nickname.localeCompare(b.nickname));
  return sorted[dayOfYear(date) % sorted.length]!;
}

// ---------------------------------------------------------------- fatos

/** Contagem com a divisão entre gente e personas (o total em destaque, a divisão logo abaixo). */
export interface Split {
  total: number;
  moradores: number;
  personas: number;
}

export interface TopicCount {
  slug: string;
  name: string;
  count: number;
}

export interface TopicRef {
  slug: string;
  name: string;
}

/**
 * Fatos do dia, guardados em daily_bulletins.facts. Regra fixa 5: nada de consumo individual; o
 * único morador citado é quem cadastrou vídeo (ação pública). Regra fixa 2: o único vídeo é o mais
 * curtido. Nada vem de mensagens de pessoas reais (regra fixa 1).
 */
export interface BulletinFacts {
  date: string;
  estoque: {
    novos: number;
    topicos: TopicCount[];
    /** Apelidos de quem cadastrou os vídeos aprovados no dia. Nunca vão para a LLM. */
    abastecedores: string[];
    inaugurados: TopicRef[];
    /** Soma das durações do acervo no fim do dia, em segundos. */
    autonomiaSegundos: number;
  };
  movimento: {
    curtidas: Split;
    comentarios: Split;
    /** Pessoas reais com alguma visualização, curtida ou comentário no dia. */
    moradores: number;
  };
  /** Tópico com mais curtidas + comentários no dia. */
  assunto: (TopicRef & { sensitive: boolean }) | null;
  /** O mais curtido do dia; null quando não houve curtida ou quando ele é de tópico sensível. */
  maisCurtido: { videoId: string } | null;
  /** Visualizações, curtidas e comentários de pessoas reais (decide o "dia parado"). */
  eventosReais: number;
}

/** O que o banco devolve antes da montagem (bulletinDb.ts). */
export interface RawDay {
  novos: number;
  topicos: TopicCount[];
  abastecedores: string[];
  inaugurados: TopicRef[];
  autonomiaSegundos: number;
  curtidas: { moradores: number; personas: number };
  comentarios: { moradores: number; personas: number };
  moradoresAtivos: number;
  eventosReais: number;
  topicScores: { slug: string; name: string; sensitive: boolean; score: number }[];
  videoCandidates: VideoCandidate[];
}

export interface VideoCandidate {
  id: string;
  likes: number;
  comments: number;
  approvedAt: Date | null;
  sensitive: boolean;
}

const split = (c: { moradores: number; personas: number }): Split => ({ total: c.moradores + c.personas, moradores: c.moradores, personas: c.personas });

/** Assunto do dia: mais curtidas + comentários; empate pelo nome, para o resultado não variar. */
export function pickTopic(scores: RawDay["topicScores"]): BulletinFacts["assunto"] {
  const best = [...scores].filter((s) => s.score > 0).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))[0];
  return best ? { slug: best.slug, name: best.name, sensitive: best.sensitive } : null;
}

/**
 * Mais curtido do dia. Empate: mais comentários; persistindo, o aprovado há mais tempo. Se o vencedor
 * for de tópico sensível, a seção mostra só o tópico: não passa a vez para o segundo colocado.
 */
export function pickTopVideo(candidates: readonly VideoCandidate[]): BulletinFacts["maisCurtido"] {
  const time = (v: VideoCandidate) => v.approvedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const best = [...candidates]
    .filter((v) => v.likes > 0)
    .sort((a, b) => b.likes - a.likes || b.comments - a.comments || time(a) - time(b) || a.id.localeCompare(b.id))[0];
  return best && !best.sensitive ? { videoId: best.id } : null;
}

export function buildFacts(date: string, raw: RawDay): BulletinFacts {
  return {
    date,
    estoque: {
      novos: raw.novos,
      topicos: raw.topicos,
      abastecedores: raw.abastecedores,
      inaugurados: raw.inaugurados,
      autonomiaSegundos: Math.round(raw.autonomiaSegundos),
    },
    movimento: { curtidas: split(raw.curtidas), comentarios: split(raw.comentarios), moradores: raw.moradoresAtivos },
    assunto: pickTopic(raw.topicScores),
    maisCurtido: pickTopVideo(raw.videoCandidates),
    eventosReais: raw.eventosReais,
  };
}

/** Tipo do boletim pelo movimento do dia (seção "Dia sem movimento"). */
export type DayKind = "parado" | "fraco" | "normal";

export function dayKind(facts: BulletinFacts): DayKind {
  if (facts.eventosReais === 0 && facts.estoque.novos === 0) return "parado";
  return facts.eventosReais < SLOW_DAY_EVENTS ? "fraco" : "normal";
}

// ---------------------------------------------------------------- pauta

export interface GossipTopic {
  id: string;
  text: string;
  active: boolean;
  lastUsedAt: Date | null;
}

export interface PickedPauta {
  id: string;
  /** Texto com {persona} já trocado pelo nome de outra persona. */
  text: string;
  /** Persona citada (null quando a pauta não cita ninguém). */
  personaId: string | null;
}

/**
 * Sorteia uma pauta ativa que não foi usada nos últimos 14 dias; se todas foram, a usada há mais
 * tempo. `{persona}` vira o nome de outra persona (nunca a de plantão, nunca um morador: regra fixa 4).
 * Pauta com `{persona}` sem outra persona disponível fica de fora.
 */
export function pickPauta(
  topics: readonly GossipTopic[],
  day: DayWindow,
  others: readonly { id: string; name: string }[],
  random: () => number = Math.random,
): PickedPauta | null {
  const usable = topics.filter((t) => t.active && (others.length > 0 || !t.text.includes("{persona}")));
  if (!usable.length) return null;
  const limit = new Date(day.start.getFullYear(), day.start.getMonth(), day.start.getDate() - PAUTA_COOLDOWN_DAYS);
  const fresh = usable.filter((t) => !t.lastUsedAt || t.lastUsedAt < limit);
  const pool = fresh.length
    ? fresh
    : [[...usable].sort((a, b) => (a.lastUsedAt?.getTime() ?? 0) - (b.lastUsedAt?.getTime() ?? 0))[0]!];
  const topic = pool[Math.floor(random() * pool.length)]!;
  if (!topic.text.includes("{persona}")) return { id: topic.id, text: topic.text, personaId: null };
  const who = others[Math.floor(random() * others.length)]!;
  return { id: topic.id, text: topic.text.replace("{persona}", who.name), personaId: who.id };
}
