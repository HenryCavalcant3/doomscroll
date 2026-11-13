import type { Pool } from "pg";
import type { PersonaProfile, TopicOption, VideoForComment } from "./ai.js";

export interface VideoRecord {
  id: string;
  sourceUrl: string;
  status: string;
  title: string | null;
  hashtags: string[];
  sourceDescription: string | null;
  description: string | null;
  transcript: string | null;
  filePath: string | null;
}

/** Operações do pipeline no banco. Os handlers dependem desta interface (facilita os testes). */
export interface VideoDb {
  get(id: string): Promise<VideoRecord | null>;
  setStage(id: string, status: string, stage: string): Promise<void>;
  saveDownload(id: string, title: string | null, hashtags: string[], sourceDescription: string | null): Promise<void>;
  saveMedia(id: string, filePath: string, thumbPath: string, duration: number): Promise<void>;
  saveTranscript(id: string, transcript: string): Promise<void>;
  saveSuggestion(id: string, description: string, topicSlugs: string[]): Promise<void>;
  saveEmbedding(id: string, embedding: number[]): Promise<void>;
  fail(id: string, error: string, keepStatus: boolean): Promise<void>;
  listTopics(): Promise<TopicOption[]>;
  /** Status, título, descrição e nomes dos tópicos do vídeo, para o comentário da persona. */
  videoForComment(id: string): Promise<(VideoForComment & { status: string }) | null>;
  /** Personas que ainda não comentaram o vídeo. */
  personasWithoutComment(videoId: string): Promise<PersonaProfile[]>;
  /** Grava o comentário só se a persona ainda não comentou (seguro para novas tentativas). */
  addPersonaComment(videoId: string, userId: string, text: string): Promise<boolean>;
}

export class PgVideoDb implements VideoDb {
  constructor(private readonly pool: Pool) {}

  async get(id: string) {
    const res = await this.pool.query(
      `SELECT id, source_url, status, title, hashtags, source_description, description, transcript, file_path FROM videos WHERE id = $1`,
      [id],
    );
    const r = res.rows[0];
    return r
      ? {
          id: r.id,
          sourceUrl: r.source_url,
          status: r.status,
          title: r.title,
          hashtags: r.hashtags,
          sourceDescription: r.source_description,
          description: r.description,
          transcript: r.transcript,
          filePath: r.file_path,
        }
      : null;
  }

  async setStage(id: string, status: string, stage: string) {
    await this.pool.query("UPDATE videos SET status = $2, stage = $3, error = NULL, updated_at = now() WHERE id = $1", [
      id,
      status,
      stage,
    ]);
  }

  async saveDownload(id: string, title: string | null, hashtags: string[], sourceDescription: string | null) {
    await this.pool.query(
      `UPDATE videos SET title = $2, hashtags = $3, source_description = $4, status = 'processando', stage = 'convertendo', updated_at = now()
        WHERE id = $1`,
      [id, title, hashtags, sourceDescription],
    );
  }

  async saveMedia(id: string, filePath: string, thumbPath: string, duration: number) {
    await this.pool.query(
      `UPDATE videos SET file_path = $2, thumb_path = $3, duration = $4, stage = 'transcrevendo', updated_at = now()
        WHERE id = $1`,
      [id, filePath, thumbPath, duration],
    );
  }

  async saveTranscript(id: string, transcript: string) {
    await this.pool.query(
      "UPDATE videos SET transcript = $2, stage = 'sugerindo', updated_at = now() WHERE id = $1",
      [id, transcript],
    );
  }

  async saveSuggestion(id: string, description: string, topicSlugs: string[]) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM video_topics WHERE video_id = $1 AND source = 'ai'", [id]);
      await client.query(
        `INSERT INTO video_topics (video_id, topic_id, source)
           SELECT $1, id, 'ai' FROM topics WHERE slug = ANY($2) ON CONFLICT DO NOTHING`,
        [id, topicSlugs],
      );
      await client.query(
        `UPDATE videos SET description = $2, stage = 'aguardando_confirmacao', updated_at = now() WHERE id = $1`,
        [id, description],
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async saveEmbedding(id: string, embedding: number[]) {
    await this.pool.query(
      "UPDATE videos SET embedding = $2::vector, stage = 'concluido', updated_at = now() WHERE id = $1",
      [id, `[${embedding.join(",")}]`],
    );
  }

  async fail(id: string, error: string, keepStatus: boolean) {
    await this.pool.query(
      `UPDATE videos SET error = $2,
              status = CASE WHEN $3 THEN status ELSE 'falhou' END,
              file_path = CASE WHEN $3 THEN file_path END,
              thumb_path = CASE WHEN $3 THEN thumb_path END,
              updated_at = now()
        WHERE id = $1`,
      [id, error.slice(0, 500), keepStatus],
    );
  }

  async listTopics() {
    return (await this.pool.query<TopicOption>("SELECT slug, name FROM topics ORDER BY name")).rows;
  }

  async videoForComment(id: string) {
    const res = await this.pool.query<{ status: string; title: string | null; description: string | null; topics: string[] }>(
      `SELECT v.status, v.title, v.description,
              COALESCE(array_agg(t.name ORDER BY t.name) FILTER (WHERE t.id IS NOT NULL), '{}') AS topics
         FROM videos v
         LEFT JOIN video_topics vt ON vt.video_id = v.id
         LEFT JOIN topics t ON t.id = vt.topic_id
        WHERE v.id = $1
        GROUP BY v.id`,
      [id],
    );
    return res.rows[0] ?? null;
  }

  async personasWithoutComment(videoId: string) {
    const res = await this.pool.query<{
      user_id: string;
      nickname: string;
      bio: string;
      tone: string;
      examples: string[];
      config: { nome?: string };
    }>(
      `SELECT p.user_id, u.nickname, p.bio, p.tone, p.examples, p.config
         FROM personas p JOIN users u ON u.id = p.user_id
        WHERE NOT EXISTS (SELECT 1 FROM comments c WHERE c.video_id = $1 AND c.user_id = p.user_id)
        ORDER BY u.nickname`,
      [videoId],
    );
    return res.rows.map((r) => ({
      userId: r.user_id,
      nickname: r.nickname,
      name: r.config.nome ?? r.nickname,
      bio: r.bio,
      tone: r.tone,
      examples: r.examples,
    }));
  }

  async addPersonaComment(videoId: string, userId: string, text: string) {
    const res = await this.pool.query(
      `INSERT INTO comments (video_id, user_id, text)
         SELECT $1::uuid, $2::uuid, $3
          WHERE NOT EXISTS (SELECT 1 FROM comments WHERE video_id = $1::uuid AND user_id = $2::uuid)`,
      [videoId, userId, text],
    );
    return res.rowCount === 1;
  }
}
