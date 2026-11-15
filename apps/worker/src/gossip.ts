/**
 * Detector de fato curioso do Boletim do Bunker: o comportamento mais fora do padrão de cada persona
 * no dia, comparado com a média dela nos 7 dias anteriores. Puro: os números vêm de bulletinDb.ts.
 *
 * Regra fixa 1: só entra o que qualquer morador já poderia ver (curtidas, comentários, o Grupo do
 * Bunker e as conversas entre personas, abertas no modo stalker). Conversa de persona com morador fica
 * de fora. Regra fixa 4: o fato fala só de personas.
 */

/** Ações públicas de uma persona num dia. */
export interface Counts {
  likes: number;
  comments: number;
  /** Mensagens dela no Grupo do Bunker. */
  groupMessages: number;
  /** Conversas (com personas ou o grupo) em que ela mandou vídeo. */
  videoTargets: number;
}

export interface PersonaActivity {
  id: string;
  /** Nome de exibição (vai para a LLM). */
  name: string;
  today: Counts;
  /** Um item por dia anterior com o bunker ligado (até HISTORY_DAYS). Dia desligado não entra na média. */
  past: Counts[];
}

export interface PairActivity {
  a: string;
  b: string;
  today: number;
  /** Soma das mensagens do par nos dias anteriores. */
  pastTotal: number;
  /** Dias anteriores com o bunker ligado (o divisor da média). */
  pastDays: number;
}

export type Intensity = "média" | "alta";

export interface CuriousFact {
  detector: string;
  /** Ids das personas de quem o fato fala. */
  subjects: string[];
  /** Para a LLM: nomes, o que aconteceu (sem números) e quanto fugiu do normal. */
  quem: string;
  o_que: string;
  intensidade: Intensity;
  score: number;
}

/** Sem pelo menos estes dias de histórico, não há "normal" para comparar: fica a pauta. */
export const MIN_HISTORY_DAYS = 3;
/** Um fato só vale a partir desta razão entre o dia e a média. */
export const MIN_SCORE = 2;
const HIGH_SCORE = 4;

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (past: Counts[], key: keyof Counts) => sum(past.map((c) => c[key])) / past.length;
const total = (c: Counts) => c.likes + c.comments + c.groupMessages + c.videoTargets;
/** Razão suavizada: quanto o dia passou da média (o +1 evita dividir por zero e acalma números pequenos). */
const ratio = (today: number, avg: number) => (today + 1) / (avg + 1);

interface Rule {
  detector: string;
  key: keyof Counts;
  /** Mínimo no dia para valer (um comentário a mais não é fofoca). */
  min: number;
  /** Média máxima (curtir "raramente"); sem limite quando ausente. */
  maxAvg?: number;
  o_que: string;
}

const RULES: Rule[] = [
  { detector: "curtiu_raro", key: "likes", min: 2, maxAvg: 0.5, o_que: "quase nunca curte nada e ontem saiu curtindo vídeo" },
  { detector: "comentou_muito", key: "comments", min: 3, o_que: "comentou muito mais do que costuma" },
  { detector: "falou_no_grupo", key: "groupMessages", min: 3, o_que: "falou muito mais que o normal no Grupo do Bunker" },
  { detector: "espalhou_videos", key: "videoTargets", min: 3, o_que: "mandou vídeo para meio bunker" },
];

const intensity = (score: number): Intensity => (score >= HIGH_SCORE ? "alta" : "média");

/** Todos os fatos candidatos do dia, do mais fora do padrão para o menos. */
export function curiousFacts(personas: readonly PersonaActivity[], pairs: readonly PairActivity[]): CuriousFact[] {
  const out: CuriousFact[] = [];
  for (const p of personas) {
    if (p.past.length < MIN_HISTORY_DAYS) continue;
    for (const r of RULES) {
      const today = p.today[r.key];
      const avg = mean(p.past, r.key);
      if (today < r.min || (r.maxAvg !== undefined && avg > r.maxAvg)) continue;
      const score = ratio(today, avg);
      if (score >= MIN_SCORE) out.push({ detector: r.detector, subjects: [p.id], quem: p.name, o_que: r.o_que, intensidade: intensity(score), score });
    }
    // Silêncio: quem costuma aparecer e não fez nada o dia todo.
    const usual = sum(p.past.map(total)) / p.past.length;
    if (total(p.today) === 0 && usual >= 3) {
      const score = usual / 1.5;
      if (score >= MIN_SCORE) {
        out.push({ detector: "silencio", subjects: [p.id], quem: p.name, o_que: "ficou em silêncio o dia todo", intensidade: intensity(score), score });
      }
    }
  }
  const names = new Map(personas.map((p) => [p.id, p.name]));
  for (const pair of pairs) {
    const a = names.get(pair.a);
    const b = names.get(pair.b);
    if (!a || !b || pair.today < 6 || pair.pastDays < MIN_HISTORY_DAYS) continue;
    const score = ratio(pair.today, pair.pastTotal / pair.pastDays);
    if (score >= MIN_SCORE) {
      out.push({ detector: "papo_em_dupla", subjects: [pair.a, pair.b], quem: `${a} e ${b}`, o_que: "passaram o dia trocando mensagens", intensidade: intensity(score), score });
    }
  }
  return out.sort((x, y) => y.score - x.score || x.detector.localeCompare(y.detector) || x.quem.localeCompare(y.quem));
}

/** O fato do dia: o mais fora do padrão que não fala da persona de plantão (ela não faz fofoca de si mesma). */
export function pickCuriousFact(personas: readonly PersonaActivity[], pairs: readonly PairActivity[], onDutyId: string): CuriousFact | null {
  return curiousFacts(personas, pairs).find((f) => !f.subjects.includes(onDutyId)) ?? null;
}

/**
 * O que vai para a LLM reescrever na voz de quem está de plantão: só isto, delimitado como dado.
 * A intensidade fica de fora: como campo, o modelo pequeno a copiava ("intensidade alta", depois
 * "um pouco fora do normal" no fim de quase toda fofoca). O "o_que" já diz o tamanho da coisa.
 */
export const factForLlm = (f: CuriousFact) => ({ quem: f.quem, o_que: f.o_que });
