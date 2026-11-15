/**
 * Leitura do Boletim do Bunker (docs/boletim/BOLETIM.md). O worker gera e guarda; a api só mostra
 * os boletins prontos (ou curtos) e calcula o "Seu dia" na hora, para quem está lendo.
 *
 * Regra fixa 2: o único vídeo é o mais curtido do dia (e só na tela completa). Regra fixa 5: o "Seu
 * dia" é de quem pede e não fica guardado no boletim.
 */
import type { Pool } from "pg";
import { authorView, type AuthorRow, type AuthorView, type FeedVideo } from "./store.js";

export interface Split {
  total: number;
  moradores: number;
  personas: number;
}

/** Os fatos como o worker guarda em daily_bulletins.facts (apps/worker/src/bulletin.ts). */
export interface StoredFacts {
  estoque: {
    novos: number;
    topicos: { slug: string; name: string; count: number }[];
    abastecedores: string[];
    inaugurados: { slug: string; name: string }[];
    autonomiaSegundos: number;
  };
  movimento: { curtidas: Split; comentarios: Split; moradores: number };
  assunto: { slug: string; name: string; sensitive: boolean } | null;
  maisCurtido: { videoId: string } | null;
}

export interface BulletinRecord {
  date: string;
  status: "pronto" | "curto";
  persona: AuthorRow & { name: string };
  facts: StoredFacts;
  headline: string;
  gossip: string | null;
}

export interface MyDay {
  videosVistos: number;
  curtidas: number;
  tema: string | null;
}

export interface BulletinStore {
  /** O boletim mais recente já publicado (pronto ou curto). */
  latest(): Promise<BulletinRecord | null>;
  get(date: string): Promise<BulletinRecord | null>;
  /** Visualizações, curtidas e tópico mais assistido de um morador no dia (calculado na hora). */
  myDay(userId: string, start: Date, end: Date): Promise<MyDay>;
  /** O Grupo do Bunker, para o "Ver a conversa". */
  bunkerId(): Promise<string | null>;
  /** O morador já recebeu o cartão deste boletim no feed (uma vez por morador por boletim). */
  seen(date: string, userId: string): Promise<boolean>;
  markSeen(date: string, userId: string): Promise<void>;
  /** Pautas de fofoca no painel do dono: lista, nova (false se o id já existe) e edição (null se não existe). */
  pautas(): Promise<PautaView[]>;
  createPauta(id: string, texto: string): Promise<boolean>;
  updatePauta(id: string, change: { texto?: string; ativa?: boolean }): Promise<PautaView | null>;
  /** Apelidos dos moradores (gente, não persona): pauta nunca cita morador (regra fixa 4). */
  residentNicknames(): Promise<string[]>;
}

/** Pauta no painel do dono, com a última vez que entrou num boletim. */
export interface PautaView {
  id: string;
  texto: string;
  ativa: boolean;
  usadaEm: string | null;
}

interface PautaRow {
  id: string;
  text: string;
  active: boolean;
  last_used_at: Date | null;
}

const toPauta = (r: PautaRow): PautaView => ({ id: r.id, texto: r.text, ativa: r.active, usadaEm: r.last_used_at?.toISOString() ?? null });

/** Resumo para o cartão do feed e a mensagem do grupo: manchete, plantão e três números, sem vídeo. */
export interface BulletinSummary {
  date: string;
  status: "pronto" | "curto";
  persona: AuthorView & { name: string };
  headline: string;
  numeros: { videosNovos: number; curtidas: number; moradores: number };
}

export interface BulletinView extends BulletinSummary {
  gossip: string | null;
  estoque: {
    novos: number;
    topicos: { name: string; count: number }[];
    abastecedores: string[];
    inaugurados: string[];
    autonomiaSegundos: number;
  };
  movimento: { curtidas: Split; comentarios: Split; moradores: number };
  assunto: { name: string } | null;
  maisCurtido: FeedVideo | null;
  seuDia: MyDay;
  grupoId: string | null;
}

export const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Meia-noite local do dia e da seguinte (fuso do servidor, como no worker). */
export function dayRange(date: string): { start: Date; end: Date } {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return { start: new Date(y, m - 1, d), end: new Date(y, m - 1, d + 1) };
}

export function summary(b: BulletinRecord): BulletinSummary {
  return {
    date: b.date,
    status: b.status,
    persona: { ...authorView(b.persona), name: b.persona.name },
    headline: b.headline,
    numeros: { videosNovos: b.facts.estoque.novos, curtidas: b.facts.movimento.curtidas.total, moradores: b.facts.movimento.moradores },
  };
}

export function fullView(b: BulletinRecord, topVideo: FeedVideo | null, seuDia: MyDay, grupoId: string | null): BulletinView {
  const f = b.facts;
  return {
    ...summary(b),
    gossip: b.gossip,
    estoque: {
      novos: f.estoque.novos,
      topicos: f.estoque.topicos.map((t) => ({ name: t.name, count: t.count })),
      abastecedores: f.estoque.abastecedores,
      inaugurados: f.estoque.inaugurados.map((t) => t.name),
      autonomiaSegundos: f.estoque.autonomiaSegundos,
    },
    movimento: f.movimento,
    assunto: f.assunto ? { name: f.assunto.name } : null,
    // Tópico sensível: o worker já não guarda o vídeo; a checagem aqui é a segunda trava.
    maisCurtido: f.assunto?.sensitive || !f.maisCurtido ? null : topVideo,
    seuDia,
    grupoId,
  };
}

interface Row {
  date: string;
  status: "pronto" | "curto";
  facts: StoredFacts;
  headline: string;
  gossip: string | null;
  nickname: string;
  avatar: string | null;
  is_ai: boolean;
  role: string;
  name: string;
}

const SELECT = `SELECT to_char(b.date, 'YYYY-MM-DD') AS date, b.status, b.facts, b.headline, b.gossip,
       u.nickname, u.avatar, u.is_ai, u.role, coalesce(p.config->>'nome', u.nickname) AS name
  FROM daily_bulletins b JOIN users u ON u.id = b.persona_user_id LEFT JOIN personas p ON p.user_id = u.id
 WHERE b.status IN ('pronto', 'curto')`;

const toRecord = (r: Row): BulletinRecord => ({
  date: r.date,
  status: r.status,
  facts: r.facts,
  headline: r.headline,
  gossip: r.gossip,
  persona: { nickname: r.nickname, avatar: r.avatar, is_ai: r.is_ai, role: r.role, name: r.name },
});

export class PgBulletinStore implements BulletinStore {
  constructor(private readonly pool: Pool) {}

  async latest() {
    const r = (await this.pool.query<Row>(`${SELECT} ORDER BY b.date DESC LIMIT 1`)).rows[0];
    return r ? toRecord(r) : null;
  }

  async get(date: string) {
    const r = (await this.pool.query<Row>(`${SELECT} AND b.date = $1`, [date])).rows[0];
    return r ? toRecord(r) : null;
  }

  async myDay(userId: string, start: Date, end: Date): Promise<MyDay> {
    const res = await this.pool.query<{ vistos: number; curtidas: number; tema: string | null }>(
      `SELECT
         (SELECT count(DISTINCT video_id) FROM view_events WHERE user_id = $1 AND created_at >= $2 AND created_at < $3)::int AS vistos,
         (SELECT count(*) FROM likes WHERE user_id = $1 AND created_at >= $2 AND created_at < $3)::int AS curtidas,
         (SELECT t.name FROM view_events e JOIN video_topics vt ON vt.video_id = e.video_id JOIN topics t ON t.id = vt.topic_id
           WHERE e.user_id = $1 AND e.created_at >= $2 AND e.created_at < $3 AND NOT e.skipped
           GROUP BY t.id ORDER BY count(*) DESC, t.name LIMIT 1) AS tema`,
      [userId, start, end],
    );
    const r = res.rows[0]!;
    return { videosVistos: r.vistos, curtidas: r.curtidas, tema: r.tema };
  }

  async bunkerId() {
    return (await this.pool.query<{ id: string }>("SELECT id FROM conversations WHERE bunker")).rows[0]?.id ?? null;
  }

  async seen(date: string, userId: string) {
    const res = await this.pool.query("SELECT 1 FROM bulletin_views WHERE bulletin_date = $1 AND user_id = $2", [date, userId]);
    return (res.rowCount ?? 0) > 0;
  }

  async markSeen(date: string, userId: string) {
    await this.pool.query("INSERT INTO bulletin_views (bulletin_date, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [date, userId]);
  }

  async pautas() {
    const res = await this.pool.query<PautaRow>("SELECT id, text, active, last_used_at FROM gossip_topics ORDER BY active DESC, created_at, id");
    return res.rows.map(toPauta);
  }

  async createPauta(id: string, texto: string) {
    const res = await this.pool.query("INSERT INTO gossip_topics (id, text) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING", [id, texto]);
    return res.rowCount === 1;
  }

  async updatePauta(id: string, change: { texto?: string; ativa?: boolean }) {
    const res = await this.pool.query<PautaRow>(
      `UPDATE gossip_topics SET text = COALESCE($2, text), active = COALESCE($3, active) WHERE id = $1
       RETURNING id, text, active, last_used_at`,
      [id, change.texto ?? null, change.ativa ?? null],
    );
    return res.rows[0] ? toPauta(res.rows[0]) : null;
  }

  async residentNicknames() {
    const res = await this.pool.query<{ nickname: string }>(
      "SELECT u.nickname FROM users u WHERE NOT EXISTS (SELECT 1 FROM personas p WHERE p.user_id = u.id)",
    );
    return res.rows.map((r) => r.nickname);
  }
}
