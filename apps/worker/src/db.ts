import type { Pool } from "pg";
import type { MemoryLine, PersonaProfile, TopicOption, VideoForComment } from "./ai.js";
import { TICK, type Decision, type PersonaTaste, type TickCandidates } from "./jev.js";

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

/** Persona diante de um vídeo: perfil para o comentário, gosto para o JEV e o que ela já fez. */
export interface PersonaForVideo extends PersonaProfile, PersonaTaste {
  /** Já comentou este vídeo (acervo de antes do JEV): no máximo curte. */
  commented: boolean;
  /** Comentários dela nas últimas 6 horas em vídeos de quem cadastrou este. */
  recentWithAuthor: number;
}

/** Vídeo para o JEV e o comentário: os nomes dos tópicos vão para o prompt, os slugs para a afinidade. */
export interface VideoForPersonas extends VideoForComment {
  status: string;
  topicSlugs: string[];
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
  /** Status, título, descrição e tópicos do vídeo, para o JEV e o comentário da persona. */
  videoForComment(id: string): Promise<VideoForPersonas | null>;
  /** Personas que ainda não decidiram sobre o vídeo (seguro para novas tentativas). */
  personasToDecide(videoId: string): Promise<PersonaForVideo[]>;
  /** Curtida da persona (repetida não faz nada). */
  addPersonaLike(videoId: string, userId: string): Promise<void>;
  /** Grava a decisão do JEV (uma por persona e vídeo). */
  saveDecision(userId: string, videoId: string, decision: Decision<string>): Promise<void>;
  /** Grava o comentário só se a persona ainda não comentou (seguro para novas tentativas). */
  addPersonaComment(videoId: string, userId: string, text: string): Promise<boolean>;
  /** Comentários e mensagens de personas na última hora (limite PERSONA_RATE). */
  personaActionsLastHour(): Promise<number>;
}

/** O que o resumo da memória precisa: a persona, o contato, o resumo atual e a conversa recente. */
export interface MemoryContext {
  personaName: string;
  contact: string;
  summary: string;
  lines: MemoryLine[];
}

export interface MemoryDb {
  memoryContext(personaId: string, contactId: string, limit: number): Promise<MemoryContext | null>;
  saveMemory(personaId: string, contactId: string, summary: string): Promise<void>;
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
    const res = await this.pool.query<VideoForPersonas>(
      `SELECT v.status, v.title, v.description,
              COALESCE(array_agg(t.name ORDER BY t.name) FILTER (WHERE t.id IS NOT NULL), '{}') AS topics,
              COALESCE(array_agg(t.slug ORDER BY t.name) FILTER (WHERE t.id IS NOT NULL), '{}') AS "topicSlugs"
         FROM videos v
         LEFT JOIN video_topics vt ON vt.video_id = v.id
         LEFT JOIN topics t ON t.id = vt.topic_id
        WHERE v.id = $1
        GROUP BY v.id`,
      [id],
    );
    return res.rows[0] ?? null;
  }

  async personasToDecide(videoId: string) {
    const res = await this.pool.query<{
      user_id: string;
      nickname: string;
      bio: string;
      tone: string;
      examples: string[];
      activity_level: number;
      config: { nome?: string; afinidade?: Record<string, number> };
      commented: boolean;
      recent_with_author: number;
    }>(
      `SELECT p.user_id, u.nickname, p.bio, p.tone, p.examples, p.activity_level, p.config,
              EXISTS (SELECT 1 FROM comments c WHERE c.video_id = $1 AND c.user_id = p.user_id) AS commented,
              (SELECT count(*)::int FROM comments c JOIN videos o ON o.id = c.video_id
                 WHERE c.user_id = p.user_id AND c.created_at > now() - interval '6 hours'
                   AND o.submitted_by = (SELECT submitted_by FROM videos WHERE id = $1)) AS recent_with_author
         FROM personas p JOIN users u ON u.id = p.user_id
        WHERE NOT EXISTS (SELECT 1 FROM persona_decisions d
                           WHERE d.persona_user_id = p.user_id AND d.trigger = 'video' AND d.target_id = $1)
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
      activity: r.activity_level,
      affinity: r.config.afinidade ?? {},
      commented: r.commented,
      recentWithAuthor: r.recent_with_author,
    }));
  }

  async addPersonaLike(videoId: string, userId: string) {
    await this.pool.query("INSERT INTO likes (user_id, video_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [userId, videoId]);
  }

  async saveDecision(userId: string, videoId: string, decision: Decision<string>) {
    await this.pool.query(
      `INSERT INTO persona_decisions (persona_user_id, trigger, target_id, action, score, reasons)
       VALUES ($1, 'video', $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
      [userId, videoId, decision.action, decision.score, JSON.stringify(decision.reasons)],
    );
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

  async personaActionsLastHour() {
    const res = await this.pool.query<{ n: number }>(
      `SELECT ((SELECT count(*) FROM comments c JOIN personas p ON p.user_id = c.user_id
                 WHERE c.created_at > now() - interval '1 hour')
             + (SELECT count(*) FROM messages m JOIN personas p ON p.user_id = m.sender_id
                 WHERE m.created_at > now() - interval '1 hour'))::int AS n`,
    );
    return res.rows[0]?.n ?? 0;
  }
}

export class PgMemoryDb implements MemoryDb {
  constructor(private readonly pool: Pool) {}

  async memoryContext(personaId: string, contactId: string, limit: number) {
    const who = await this.pool.query<{ name: string; contact: string; summary: string | null }>(
      `SELECT COALESCE(p.config->>'nome', pu.nickname) AS name, cu.nickname AS contact,
              (SELECT summary FROM persona_memory WHERE persona_user_id = $1 AND contact_user_id = $2) AS summary
         FROM personas p JOIN users pu ON pu.id = p.user_id, users cu
        WHERE p.user_id = $1 AND cu.id = $2`,
      [personaId, contactId],
    );
    const row = who.rows[0];
    if (!row) return null;
    // Últimas mensagens da conversa direta dos dois, em ordem de envio.
    const msgs = await this.pool.query<{ sender_id: string; text: string | null; title: string | null }>(
      `SELECT * FROM (
         SELECT m.sender_id, m.text, v.title, m.created_at
           FROM messages m
           JOIN conversations c ON c.id = m.conversation_id AND c.type = 'direct'
           LEFT JOIN videos v ON v.id = m.video_id
          WHERE c.direct_key = $2
          ORDER BY m.created_at DESC LIMIT $1) recent
        ORDER BY created_at`,
      // Mesma chave da api (apps/api/src/chat.ts, directKey): ids em ordem, separados por ":".
      [limit, [personaId, contactId].sort().join(":")],
    );
    return {
      personaName: row.name,
      contact: row.contact,
      summary: row.summary ?? "",
      lines: msgs.rows.map((m) => ({ fromPersona: m.sender_id === personaId, text: m.text ?? `[mandou um vídeo: ${m.title ?? "sem título"}]` })),
    };
  }

  async saveMemory(personaId: string, contactId: string, summary: string) {
    await this.pool.query(
      `INSERT INTO persona_memory (persona_user_id, contact_user_id, summary, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (persona_user_id, contact_user_id) DO UPDATE SET summary = EXCLUDED.summary, updated_at = now()`,
      [personaId, contactId, summary],
    );
  }
}

/** O que o agendador das personas olha para decidir quem puxa conversa (SPEC 7.5). */
export interface TickDb {
  tickCandidates(): Promise<TickCandidates>;
  personaActionsLastHour(): Promise<number>;
}

export class PgTickDb implements TickDb {
  constructor(private readonly pool: Pool) {}

  async tickCandidates(): Promise<TickCandidates> {
    const personas = await this.pool.query<{
      id: string;
      nickname: string;
      activity_level: number;
      config: { afinidade?: Record<string, number>; relacoes?: Record<string, string> };
    }>(`SELECT p.user_id AS id, u.nickname, p.activity_level, p.config FROM personas p JOIN users u ON u.id = p.user_id`);
    const videos = await this.pool.query<{ id: string; topics: string[]; liked_by: string[] }>(
      `SELECT v.id,
              COALESCE(array_agg(DISTINCT t.slug) FILTER (WHERE t.slug IS NOT NULL), '{}') AS topics,
              array_agg(DISTINCT d.persona_user_id) AS liked_by
         FROM videos v
         JOIN persona_decisions d ON d.trigger = 'video' AND d.target_id = v.id AND d.action IN ('curtir', 'comentar')
         LEFT JOIN video_topics vt ON vt.video_id = v.id
         LEFT JOIN topics t ON t.id = vt.topic_id
        WHERE v.status = 'aprovado' AND v.file_path IS NOT NULL
        GROUP BY v.id`,
    );
    // Conversas diretas só entre personas: a chave direta já é o par em ordem.
    const pairs = await this.pool.query<{ direct_key: string; cooling: boolean; videos: string[] }>(
      `SELECT c.direct_key,
              COALESCE(c.last_message_at > now() - make_interval(hours => $1), false) AS cooling,
              COALESCE(array_agg(DISTINCT m.video_id) FILTER (WHERE m.video_id IS NOT NULL), '{}') AS videos
         FROM conversations c
         LEFT JOIN messages m ON m.conversation_id = c.id
        WHERE c.type = 'direct'
          AND NOT EXISTS (SELECT 1 FROM conversation_members cm JOIN users u ON u.id = cm.user_id
                           WHERE cm.conversation_id = c.id AND NOT u.is_ai)
        GROUP BY c.id`,
      [TICK.pairCooldownHours],
    );
    const bunker = await this.pool.query<{ video_id: string }>(
      `SELECT DISTINCT m.video_id FROM messages m JOIN conversations c ON c.id = m.conversation_id AND c.bunker WHERE m.video_id IS NOT NULL`,
    );
    return {
      personas: personas.rows.map((p) => ({
        id: p.id,
        nickname: p.nickname,
        activity: p.activity_level,
        affinity: p.config.afinidade ?? {},
        relations: Object.keys(p.config.relacoes ?? {}),
      })),
      videos: videos.rows.map((v) => ({ id: v.id, topics: v.topics, likedBy: v.liked_by })),
      sentInPair: new Map(pairs.rows.map((r) => [r.direct_key, new Set(r.videos)])),
      coolingPairs: new Set(pairs.rows.filter((r) => r.cooling).map((r) => r.direct_key)),
      bunkerVideos: new Set(bunker.rows.map((r) => r.video_id)),
    };
  }

  async personaActionsLastHour() {
    return new PgVideoDb(this.pool).personaActionsLastHour();
  }
}
