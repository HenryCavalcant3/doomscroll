/**
 * Geração do Boletim do Bunker (docs/boletim/BOLETIM.md, "Quando é gerado" e "Guardrails").
 * Um job da fila bulletin.daily: marca o dia de hoje como ligado e, se ontem esteve ligado e ainda
 * não tem boletim, gera. Duas chamadas à LLM no máximo (mais uma nova tentativa de cada), sempre
 * com texto de reserva: a falta da IA nunca impede o boletim.
 */
import { buildFacts, dayKind, dayWindow, pickOnDuty, pickPauta, type BulletinFacts, type DayWindow, type GossipTopic, type RawDay } from "./bulletin.js";
import type { PersonaRef } from "./bulletinDb.js";
import {
  buildGossipPrompt,
  buildHeadlinePrompt,
  checkLine,
  gossipSchema,
  headlineSchema,
  fallbackGossip,
  fallbackHeadline,
  GOSSIP_WORDS,
  HEADLINE_WORDS,
  headlineFacts,
  isRepeat,
  nameKey,
  pick,
  type BulletinVoice,
  type CheckOptions,
  type GossipInput,
  writesLowercase,
} from "./bulletinText.js";
import { factForLlm, pickCuriousFact, type PairActivity, type PersonaActivity } from "./gossip.js";
import { pickExamples } from "./ai.js";

export type BulletinStatus = "pendente" | "pronto" | "curto" | "falhou";

export interface BulletinRow {
  date: string;
  personaUserId: string;
  facts: BulletinFacts;
  headline: string;
  gossip: string | null;
  gossipSource: "fato" | "pauta" | null;
  gossipRef: string | null;
  topVideoId: string | null;
  status: BulletinStatus;
  headlineEmbedding: number[] | null;
  gossipEmbedding: number[] | null;
}

export interface BulletinGenDb {
  markDay(date: string): Promise<void>;
  wasOn(date: string): Promise<boolean>;
  /** Alguma ação no dia (curtida, comentário, mensagem, visualização, decisão de persona). */
  hadActivity(day: DayWindow): Promise<boolean>;
  status(date: string): Promise<BulletinStatus | null>;
  /** Pronto ou curto, mas ainda sem mensagem no Grupo do Bunker. */
  unpublished(date: string): Promise<boolean>;
  /** Reserva o dia (status pendente); devolve false se outro job já concluiu. */
  begin(date: string, personaUserId: string): Promise<boolean>;
  save(row: BulletinRow): Promise<void>;
  fail(date: string): Promise<void>;
  voices(): Promise<BulletinVoice[]>;
  residents(): Promise<string[]>;
  /** Nomes dos tópicos marcados como sensíveis no painel do dono. */
  sensitiveTopics(): Promise<string[]>;
  collectDay(day: DayWindow): Promise<RawDay>;
  personaActivity(day: DayWindow, list: PersonaRef[]): Promise<{ personas: PersonaActivity[]; pairs: PairActivity[] }>;
  gossipTopics(): Promise<GossipTopic[]>;
  markPautaUsed(id: string, at: Date): Promise<void>;
  /** Embeddings da manchete e da fofoca dos últimos boletins (anti-repetição). */
  recentEmbeddings(date: string, limit: number): Promise<{ headline: number[] | null; gossip: number[] | null }[]>;
}

export interface BulletinGenDeps {
  db: BulletinGenDb;
  /** Uma chamada à LLM com saída em JSON (já passa pelo portão, na prioridade do boletim). */
  generate(prompt: string, schema: object): Promise<string>;
  embed(text: string): Promise<number[]>;
  /** Avisa a api (fila persona.talk) que o boletim pode ir para o grupo; ela publica uma vez só. */
  publish?(date: string): Promise<void>;
  random?: () => number;
  log?: (msg: string) => void;
  now?: () => Date;
}

/** O job: marca hoje como ligado e gera o boletim de ontem, se for o caso. Devolve o status final ou null. */
export async function runBulletinJob(deps: BulletinGenDeps): Promise<BulletinStatus | null> {
  const now = deps.now?.() ?? new Date();
  await deps.db.markDay(dayWindow(now, 0).date);
  const day = dayWindow(now, 1);
  const status = await deps.db.status(day.date);
  if (status && status !== "pendente") {
    // Pronto, mas fora do grupo (api fora do ar quando ficou pronto): avisa de novo.
    if ((status === "pronto" || status === "curto") && (await deps.db.unpublished(day.date))) await deps.publish?.(day.date);
    return null;
  }
  // Recuperação: ligado ontem (marcado pelo agendador) ou, na primeira subida, com algum movimento.
  if (!(await deps.db.wasOn(day.date))) {
    if (!(await deps.db.hadActivity(day))) {
      deps.log?.(`[worker] boletim: bunker desligado em ${day.date}, sem boletim`);
      return null;
    }
    await deps.db.markDay(day.date);
  }
  let result: BulletinStatus | null;
  try {
    result = await generateBulletin(deps, day);
  } catch (err) {
    deps.log?.(`[worker] boletim de ${day.date} falhou: ${(err as Error).message}`);
    await deps.db.fail(day.date);
    return "falhou";
  }
  if (result === "pronto" || result === "curto") await deps.publish?.(day.date);
  return result;
}

const RECENT = 7;

export async function generateBulletin(deps: BulletinGenDeps, day: DayWindow): Promise<BulletinStatus | null> {
  const { db } = deps;
  const random = deps.random ?? Math.random;
  const log = (msg: string) => deps.log?.(`[worker] boletim ${day.date}: ${msg}`);
  const voices = await db.voices();
  const duty = pickOnDuty(day.date, voices);
  if (!duty) {
    log("nenhuma persona para o plantão");
    return null;
  }
  if (!(await db.begin(day.date, duty.id))) return null;

  const facts = buildFacts(day.date, await db.collectDay(day));
  const kind = dayKind(facts);
  const base = { date: day.date, personaUserId: duty.id, facts, topVideoId: facts.maisCurtido?.videoId ?? null };

  if (kind === "parado") {
    // Sem LLM, sem fofoca e sem respostas no grupo.
    await db.save({ ...base, headline: pick(duty.dia_parado, random), gossip: null, gossipSource: null, gossipRef: null, status: "curto", headlineEmbedding: null, gossipEmbedding: null });
    log(`curto (dia parado), plantão ${duty.name}`);
    return "curto";
  }

  const residents = await db.residents();
  const sensitive = await db.sensitiveTopics();
  const lowercase = writesLowercase(duty);
  const voiced = (s: string) => (lowercase ? s.toLowerCase() : s);
  const recent = await db.recentEmbeddings(day.date, RECENT).catch(() => []);
  const embedSafe = (text: string) => deps.embed(text).catch(() => null);

  /** Até duas tentativas; a segunda só depois de um texto inválido ou repetido. */
  const write = async (prompt: () => string, schema: object, check: Omit<CheckOptions, "residents">, past: number[][]) => {
    for (let attempt = 1; attempt <= 2; attempt++) {
      let raw: string;
      try {
        raw = await deps.generate(prompt(), schema);
      } catch (err) {
        log(`LLM indisponível (${(err as Error).message})`);
        return null;
      }
      const result = checkLine(raw, { ...check, residents });
      if (!result.ok) {
        log(`${check.key} recusada (${result.reason}), tentativa ${attempt}`);
        continue;
      }
      const vector = await embedSafe(result.text);
      if (vector && isRepeat(vector, past)) {
        log(`${check.key} repetida, tentativa ${attempt}`);
        continue;
      }
      return { text: result.text, vector };
    }
    return null;
  };

  // Manchete: dia fraco ou assunto sensível usam a frase de "dia parado".
  let headline: string;
  let headlineEmbedding: number[] | null = null;
  if (kind === "fraco" || facts.assunto?.sensitive) {
    headline = pick(duty.dia_parado, random);
  } else {
    const facts4llm = headlineFacts(facts);
    const got = await write(
      () => buildHeadlinePrompt(duty, facts4llm, pickExamples(duty.manchetes, 3, random)),
      headlineSchema,
      { key: "manchete", maxWords: HEADLINE_WORDS, sameAs: duty.manchetes, stock: facts4llm.estoque, sensitive, lowercase },
      recent.flatMap((r) => (r.headline ? [r.headline] : [])),
    );
    headline = got?.text ?? voiced(fallbackHeadline(facts));
    headlineEmbedding = got?.vector ?? null;
    if (!got) log("manchete de modelo fixo");
  }

  // Fofoca: fato curioso real (nunca da persona de plantão) ou pauta fixa.
  const others = voices.filter((v) => v.id !== duty.id);
  const { personas, pairs } = await db.personaActivity(
    day,
    voices.map((v) => ({ id: v.id, nickname: v.nickname, name: v.name })),
  );
  const fact = pickCuriousFact(personas, pairs, duty.id);
  let input: GossipInput;
  let source: "fato" | "pauta" | null = null;
  let ref: string | null = null;
  let mention: string[] = [];
  if (fact) {
    input = factForLlm(fact);
    source = "fato";
    ref = fact.detector;
    mention = fact.subjects.map((id) => voices.find((v) => v.id === id)?.name ?? "").filter(Boolean);
  } else {
    const pauta = pickPauta(await db.gossipTopics(), day, others, random);
    if (pauta) {
      input = { fofoca: pauta.text };
      source = "pauta";
      ref = pauta.id;
      const named = others.find((o) => o.id === pauta.personaId);
      if (named) mention = [named.name];
      await db.markPautaUsed(pauta.id, day.start);
    } else {
      input = { fofoca: "" };
    }
  }

  let gossip: string | null = null;
  let gossipEmbedding: number[] | null = null;
  if (source) {
    const got = await write(
      () => buildGossipPrompt(duty, input, pickExamples(duty.fofocas, 3, random)),
      gossipSchema,
      {
        key: "fofoca",
        maxWords: GOSSIP_WORDS,
        mustMention: mention,
        mustNotMention: [nameKey(duty.name)],
        strangers: others.filter((o) => !mention.includes(o.name)).map((o) => nameKey(o.name)),
        examples: duty.fofocas,
        source: "fofoca" in input ? input.fofoca : input.o_que,
        sensitive,
        lowercase,
      },
      recent.flatMap((r) => (r.gossip ? [r.gossip] : [])),
    );
    gossip = got?.text ?? voiced(fallbackGossip(input));
    gossipEmbedding = got?.vector ?? null;
    if (!got) log("fofoca sem reescrita");
  }

  await db.save({ ...base, headline, gossip, gossipSource: source, gossipRef: ref, status: "pronto", headlineEmbedding, gossipEmbedding });
  log(`pronto, plantão ${duty.name}, fofoca de ${source ?? "nenhuma fonte"}`);
  return "pronto";
}
