import type { Pool } from "pg";

export type VideoStatus = "baixando" | "processando" | "pendente" | "aprovado" | "rejeitado" | "falhou";

export interface Topic {
  id: number;
  name: string;
  slug: string;
}

export interface VideoTopic {
  slug: string;
  name: string;
  source: "user" | "ai";
}

export interface VideoView {
  id: string;
  sourceUrl: string;
  platform: string;
  status: VideoStatus;
  stage: string;
  error: string | null;
  title: string | null;
  description: string | null;
  hashtags: string[];
  duration: number | null;
  videoUrl: string | null;
  thumbUrl: string | null;
  topics: VideoTopic[];
  createdAt: string;
}

export type ConfirmResult = "ok" | "not_found" | "invalid_state" | "invalid_topics";

/** Acesso ao banco usado pelas rotas. As rotas dependem desta interface, o que facilita os testes. */
export interface Store {
  listTopics(): Promise<Topic[]>;
  createTopic(name: string, slug: string): Promise<Topic | null>;
  findActiveVideoBySource(url: string): Promise<string | null>;
  createVideo(url: string, platform: string, submittedBy: string): Promise<string>;
  getVideo(id: string): Promise<VideoView | null>;
  listVideos(status: VideoStatus): Promise<VideoView[]>;
  confirmTopics(id: string, slugs: string[]): Promise<ConfirmResult>;
  approve(id: string, ownerId: string): Promise<boolean>;
  reject(id: string, ownerId: string): Promise<boolean>;
  getOwner(): Promise<{ id: string; pinHash: string } | null>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string) => UUID.test(s);

interface VideoRow {
  id: string;
  source_url: string;
  platform: string;
  status: VideoStatus;
  stage: string;
  error: string | null;
  title: string | null;
  description: string | null;
  hashtags: string[];
  duration: number | null;
  file_path: string | null;
  thumb_path: string | null;
  topics: VideoTopic[];
  created_at: Date;
}

const VIDEO_SELECT = `
  SELECT v.id, v.source_url, v.platform, v.status, v.stage, v.error, v.title, v.description, v.hashtags,
         v.duration, v.file_path, v.thumb_path, v.created_at,
         COALESCE(
           (SELECT json_agg(json_build_object('slug', t.slug, 'name', t.name, 'source', vt.source) ORDER BY t.name)
              FROM video_topics vt JOIN topics t ON t.id = vt.topic_id WHERE vt.video_id = v.id),
           '[]'::json) AS topics
    FROM videos v`;

function toView(r: VideoRow): VideoView {
  return {
    id: r.id,
    sourceUrl: r.source_url,
    platform: r.platform,
    status: r.status,
    stage: r.stage,
    error: r.error,
    title: r.title,
    description: r.description,
    hashtags: r.hashtags,
    duration: r.duration,
    videoUrl: r.file_path ? `/media/${r.file_path}` : null,
    thumbUrl: r.thumb_path ? `/media/${r.thumb_path}` : null,
    topics: r.topics,
    createdAt: r.created_at.toISOString(),
  };
}

export class PgStore implements Store {
  constructor(private readonly pool: Pool) {}

  async listTopics() {
    return (await this.pool.query<Topic>("SELECT id, name, slug FROM topics ORDER BY name")).rows;
  }

  async createTopic(name: string, slug: string) {
    const res = await this.pool.query<Topic>(
      "INSERT INTO topics (name, slug) VALUES ($1, $2) ON CONFLICT (slug) DO NOTHING RETURNING id, name, slug",
      [name, slug],
    );
    return res.rows[0] ?? null;
  }

  async findActiveVideoBySource(url: string) {
    const res = await this.pool.query<{ id: string }>(
      "SELECT id FROM videos WHERE source_url = $1 AND status NOT IN ('falhou', 'rejeitado')",
      [url],
    );
    return res.rows[0]?.id ?? null;
  }

  async createVideo(url: string, platform: string, submittedBy: string) {
    const res = await this.pool.query<{ id: string }>(
      "INSERT INTO videos (source_url, platform, submitted_by) VALUES ($1, $2, $3) RETURNING id",
      [url, platform, submittedBy],
    );
    return res.rows[0]!.id;
  }

  async getVideo(id: string) {
    if (!isUuid(id)) return null;
    const res = await this.pool.query<VideoRow>(`${VIDEO_SELECT} WHERE v.id = $1`, [id]);
    return res.rows[0] ? toView(res.rows[0]) : null;
  }

  async listVideos(status: VideoStatus) {
    const res = await this.pool.query<VideoRow>(`${VIDEO_SELECT} WHERE v.status = $1 ORDER BY v.created_at`, [status]);
    return res.rows.map(toView);
  }

  async confirmTopics(id: string, slugs: string[]): Promise<ConfirmResult> {
    if (!isUuid(id)) return "not_found";
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const video = await client.query<{ stage: string }>("SELECT stage FROM videos WHERE id = $1 FOR UPDATE", [id]);
      if (!video.rows[0]) {
        await client.query("ROLLBACK");
        return "not_found";
      }
      if (video.rows[0].stage !== "aguardando_confirmacao") {
        await client.query("ROLLBACK");
        return "invalid_state";
      }
      const topics = await client.query<{ id: number }>("SELECT id FROM topics WHERE slug = ANY($1)", [slugs]);
      if (topics.rowCount !== slugs.length) {
        await client.query("ROLLBACK");
        return "invalid_topics";
      }
      const ids = topics.rows.map((t) => t.id);
      // Mantém a origem 'ai' do que a IA sugeriu e o usuário manteve; o resto vira 'user'.
      await client.query("DELETE FROM video_topics WHERE video_id = $1 AND NOT (topic_id = ANY($2))", [id, ids]);
      await client.query(
        `INSERT INTO video_topics (video_id, topic_id, source)
           SELECT $1, unnest($2::int[]), 'user' ON CONFLICT DO NOTHING`,
        [id, ids],
      );
      await client.query(
        "UPDATE videos SET status = 'pendente', stage = 'aguardando_aprovacao', updated_at = now() WHERE id = $1",
        [id],
      );
      await client.query("COMMIT");
      return "ok";
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async approve(id: string, ownerId: string) {
    if (!isUuid(id)) return false;
    const res = await this.pool.query(
      `UPDATE videos SET status = 'aprovado', stage = 'gerando_embedding', approved_by = $2, updated_at = now()
        WHERE id = $1 AND status = 'pendente'`,
      [id, ownerId],
    );
    return res.rowCount === 1;
  }

  async reject(id: string, ownerId: string) {
    if (!isUuid(id)) return false;
    const res = await this.pool.query(
      `UPDATE videos SET status = 'rejeitado', stage = 'concluido', approved_by = $2, updated_at = now()
        WHERE id = $1 AND status = 'pendente'`,
      [id, ownerId],
    );
    return res.rowCount === 1;
  }

  async getOwner() {
    const res = await this.pool.query<{ id: string; pin_hash: string }>(
      "SELECT id, pin_hash FROM users WHERE role = 'owner' ORDER BY created_at LIMIT 1",
    );
    const row = res.rows[0];
    return row ? { id: row.id, pinHash: row.pin_hash } : null;
  }
}
