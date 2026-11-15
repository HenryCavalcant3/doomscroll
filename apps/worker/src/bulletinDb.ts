/**
 * Consultas do Boletim do Bunker. Finas de propósito: contam e devolvem candidatos; quem decide
 * (empates, tópico sensível, fato curioso) são as funções puras de bulletin.ts e gossip.ts.
 *
 * Regra fixa 1: nenhuma consulta lê o texto de mensagens, e as contagens de mensagens só olham o
 * Grupo do Bunker (falas de persona) e conversas sem nenhum morador.
 */
import type { Pool, PoolClient } from "pg";
import { dayBoundaries, HISTORY_DAYS, type DayWindow, type GossipTopic, type RawDay } from "./bulletin.js";
import type { Counts, PairActivity, PersonaActivity } from "./gossip.js";

export type Db = Pool | PoolClient;

export interface PersonaRef {
  id: string;
  nickname: string;
  name: string;
}

/** Conversa sem nenhum morador (só personas) ou o Grupo do Bunker. */
const PUBLIC_CONVERSATION = `(c.bunker OR NOT EXISTS (
  SELECT 1 FROM conversation_members cm JOIN users hu ON hu.id = cm.user_id
   WHERE cm.conversation_id = c.id AND NOT hu.is_ai))`;

export async function personas(db: Db): Promise<PersonaRef[]> {
  const res = await db.query<PersonaRef>(
    `SELECT u.id, u.nickname, coalesce(p.config->>'nome', u.nickname) AS name
       FROM users u JOIN personas p ON p.user_id = u.id
      WHERE u.is_ai ORDER BY u.nickname`,
  );
  return res.rows;
}

/** Números do dia (estoque, movimento, assunto e candidatos a mais curtido). */
export async function collectDay(db: Db, day: DayWindow): Promise<RawDay> {
  const w = [day.start, day.end];
  const one = async <T>(sql: string, params: unknown[] = w): Promise<T> => (await db.query(sql, params)).rows[0] as T;
  const all = async <T>(sql: string): Promise<T[]> => (await db.query(sql, w)).rows as T[];

  const approvedInDay = "v.status = 'aprovado' AND v.approved_at >= $1 AND v.approved_at < $2";
  const { novos } = await one<{ novos: number }>(`SELECT count(*)::int AS novos FROM videos v WHERE ${approvedInDay}`);
  const topicos = await all<RawDay["topicos"][number]>(
    `SELECT t.slug, t.name, count(*)::int AS count
       FROM videos v JOIN video_topics vt ON vt.video_id = v.id JOIN topics t ON t.id = vt.topic_id
      WHERE ${approvedInDay}
      GROUP BY t.id ORDER BY count DESC, t.name`,
  );
  // Regra fixa 5: o único morador citado é quem cadastrou (ação pública). Personas não cadastram.
  const abastecedores = (
    await all<{ nickname: string }>(
      `SELECT DISTINCT u.nickname FROM videos v JOIN users u ON u.id = v.submitted_by
        WHERE ${approvedInDay} AND NOT u.is_ai ORDER BY u.nickname`,
    )
  ).map((r) => r.nickname);
  const inaugurados = await all<RawDay["inaugurados"][number]>(
    `SELECT t.slug, t.name
       FROM topics t JOIN video_topics vt ON vt.topic_id = t.id JOIN videos v ON v.id = vt.video_id AND v.status = 'aprovado'
      GROUP BY t.id HAVING min(v.approved_at) >= $1 AND min(v.approved_at) < $2 ORDER BY t.name`,
  );
  const { autonomia } = await one<{ autonomia: number }>(
    `SELECT coalesce(sum(duration), 0)::float AS autonomia FROM videos
      WHERE status = 'aprovado' AND file_path IS NOT NULL AND approved_at < $1`,
    [day.end],
  );

  const bySide = (table: string) =>
    one<{ moradores: number; personas: number }>(
      `SELECT count(*) FILTER (WHERE NOT u.is_ai)::int AS moradores, count(*) FILTER (WHERE u.is_ai)::int AS personas
         FROM ${table} x JOIN users u ON u.id = x.user_id WHERE x.created_at >= $1 AND x.created_at < $2`,
    );
  const curtidas = await bySide("likes");
  const comentarios = await bySide("comments");

  // Gente real: visualizações, curtidas e comentários. Mensagens não contam (regra fixa 1).
  const { moradores, eventos } = await one<{ moradores: number; eventos: number }>(
    `SELECT count(DISTINCT e.user_id)::int AS moradores, count(*)::int AS eventos FROM (
       SELECT user_id FROM view_events WHERE created_at >= $1 AND created_at < $2
       UNION ALL SELECT user_id FROM likes WHERE created_at >= $1 AND created_at < $2
       UNION ALL SELECT user_id FROM comments WHERE created_at >= $1 AND created_at < $2
     ) e JOIN users u ON u.id = e.user_id WHERE NOT u.is_ai`,
  );

  const topicScores = await all<RawDay["topicScores"][number]>(
    `WITH acts AS (
       SELECT video_id FROM likes WHERE created_at >= $1 AND created_at < $2
       UNION ALL SELECT video_id FROM comments WHERE created_at >= $1 AND created_at < $2)
     SELECT t.slug, t.name, t.sensitive, count(*)::int AS score
       FROM acts a JOIN videos v ON v.id = a.video_id AND v.status = 'aprovado'
       JOIN video_topics vt ON vt.video_id = a.video_id JOIN topics t ON t.id = vt.topic_id
      GROUP BY t.id ORDER BY score DESC, t.name LIMIT 5`,
  );
  const videoCandidates = (
    await all<{ id: string; likes: number; comments: number; approved_at: Date | null; sensitive: boolean }>(
      `SELECT v.id, count(*)::int AS likes,
              (SELECT count(*) FROM comments c WHERE c.video_id = v.id AND c.created_at >= $1 AND c.created_at < $2)::int AS comments,
              v.approved_at,
              EXISTS (SELECT 1 FROM video_topics vt JOIN topics t ON t.id = vt.topic_id WHERE vt.video_id = v.id AND t.sensitive) AS sensitive
         FROM likes l JOIN videos v ON v.id = l.video_id
        WHERE l.created_at >= $1 AND l.created_at < $2 AND v.status = 'aprovado' AND v.file_path IS NOT NULL
        GROUP BY v.id ORDER BY likes DESC, comments DESC, v.approved_at ASC NULLS LAST LIMIT 5`,
    )
  ).map((r) => ({ id: r.id, likes: r.likes, comments: r.comments, approvedAt: r.approved_at, sensitive: r.sensitive }));

  return {
    novos,
    topicos,
    abastecedores,
    inaugurados,
    autonomiaSegundos: autonomia,
    curtidas,
    comentarios,
    moradoresAtivos: moradores,
    eventosReais: eventos,
    topicScores,
    videoCandidates,
  };
}

const zero = (): Counts => ({ likes: 0, comments: 0, groupMessages: 0, videoTargets: 0 });

/** Ações públicas de cada persona no dia e nos 7 anteriores, mais as conversas entre pares de personas. */
export async function personaActivity(db: Db, day: DayWindow, list: readonly PersonaRef[]): Promise<{ personas: PersonaActivity[]; pairs: PairActivity[] }> {
  const bounds = dayBoundaries(day);
  const range = [bounds[0], day.end, bounds];
  // width_bucket: 1..HISTORY_DAYS são os dias anteriores, HISTORY_DAYS + 1 é o dia coberto.
  const rows = (
    await db.query<{ id: string; kind: keyof Counts; bucket: number; n: number }>(
      `WITH acts AS (
         SELECT l.user_id AS id, 'likes' AS kind, l.created_at, NULL::uuid AS conv FROM likes l
          WHERE l.created_at >= $1 AND l.created_at < $2
         UNION ALL
         SELECT c.user_id, 'comments', c.created_at, NULL FROM comments c
          WHERE c.created_at >= $1 AND c.created_at < $2
         UNION ALL
         SELECT m.sender_id, 'groupMessages', m.created_at, NULL FROM messages m JOIN conversations c ON c.id = m.conversation_id
          WHERE c.bunker AND m.type <> 'bulletin' AND m.created_at >= $1 AND m.created_at < $2
         UNION ALL
         SELECT m.sender_id, 'videoTargets', m.created_at, m.conversation_id FROM messages m JOIN conversations c ON c.id = m.conversation_id
          WHERE m.type = 'video' AND ${PUBLIC_CONVERSATION} AND m.created_at >= $1 AND m.created_at < $2)
       SELECT a.id, a.kind, width_bucket(a.created_at, $3::timestamptz[]) AS bucket,
              CASE WHEN a.kind = 'videoTargets' THEN count(DISTINCT a.conv) ELSE count(*) END::int AS n
         FROM acts a JOIN users u ON u.id = a.id AND u.is_ai
        GROUP BY a.id, a.kind, bucket`,
      range,
    )
  ).rows;

  const byId = new Map(list.map((p) => [p.id, { id: p.id, name: p.name, today: zero(), past: Array.from({ length: HISTORY_DAYS }, zero) }]));
  // Dia anterior "ligado": alguma persona fez alguma coisa. Dia desligado não puxa a média para baixo.
  const on = new Set<number>();
  for (const r of rows) {
    const p = byId.get(r.id);
    if (!p || r.bucket < 1 || r.bucket > HISTORY_DAYS + 1) continue;
    if (r.bucket <= HISTORY_DAYS) on.add(r.bucket - 1);
    const slot = r.bucket === HISTORY_DAYS + 1 ? p.today : p.past[r.bucket - 1]!;
    slot[r.kind] += r.n;
  }
  const activity = [...byId.values()].map((p) => ({ ...p, past: p.past.filter((_, i) => on.has(i)) }));

  // Conversas diretas entre duas personas (o modo stalker mostra; conversa com morador, nunca).
  const pairs = (
    await db.query<{ a: string; b: string; today: number; past: number }>(
      `WITH pairs AS (
         SELECT c.id, min(cm.user_id::text)::uuid AS a, max(cm.user_id::text)::uuid AS b
           FROM conversations c JOIN conversation_members cm ON cm.conversation_id = c.id JOIN users u ON u.id = cm.user_id
          WHERE c.type = 'direct' GROUP BY c.id HAVING bool_and(u.is_ai) AND count(*) = 2)
       SELECT p.a, p.b,
              count(*) FILTER (WHERE m.created_at >= $3)::int AS today,
              count(*) FILTER (WHERE m.created_at < $3)::int AS past
         FROM pairs p JOIN messages m ON m.conversation_id = p.id
        WHERE m.created_at >= $1 AND m.created_at < $2
        GROUP BY p.a, p.b`,
      [bounds[0], day.end, day.start],
    )
  ).rows.map((r) => ({ a: r.a, b: r.b, today: r.today, pastTotal: r.past, pastDays: on.size }));

  return { personas: activity, pairs };
}

export async function gossipTopics(db: Db): Promise<GossipTopic[]> {
  const res = await db.query<{ id: string; text: string; active: boolean; last_used_at: Date | null }>(
    "SELECT id, text, active, last_used_at FROM gossip_topics ORDER BY id",
  );
  return res.rows.map((r) => ({ id: r.id, text: r.text, active: r.active, lastUsedAt: r.last_used_at }));
}
