import type { Pool, PoolClient } from "pg";
import { COMMENT_DELTA, LIKE_DELTA, SCORE_MAX, SCORE_MIN, viewDelta, type ViewInput } from "./affinity.js";
import { pickFeed, type Candidate, type Rng } from "./recommend.js";

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

/** Quem aparece como autor de um vídeo ou comentário. */
export interface AuthorView {
  nickname: string;
  avatarUrl: string | null;
  isAi: boolean;
}

export interface UserView extends AuthorView {
  id: string;
  role: "owner" | "resident";
}

export interface FeedVideo extends VideoView {
  commentCount: number;
  likeCount: number;
  /** Se quem pediu o feed curtiu o vídeo. */
  liked: boolean;
  /** Quem cadastrou o vídeo. */
  author: AuthorView | null;
}

export interface Profile extends UserView {
  /** Nome de exibição e bio (só personas). */
  name: string | null;
  bio: string | null;
  /** Vídeos curtidos, do mais recente para o mais antigo. */
  liked: FeedVideo[];
}

export interface FeedPage {
  videos: FeedVideo[];
  /** true quando todos os vídeos já tinham sido vistos e o feed recomeçou do acervo inteiro. */
  restarted: boolean;
}

export interface CommentView {
  id: string;
  text: string;
  createdAt: string;
  author: AuthorView;
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
  /** pinHash é null para personas (não fazem login). */
  findUser(nickname: string): Promise<{ user: UserView; pinHash: string | null } | null>;
  /** null se o apelido já existe. */
  createUser(nickname: string, pinHash: string): Promise<UserView | null>;
  createSession(userId: string, tokenHash: string): Promise<void>;
  sessionUser(tokenHash: string): Promise<UserView | null>;
  deleteSession(tokenHash: string): Promise<void>;
  statusOf(ids: string[]): Promise<Map<string, string>>;
  /** Vídeos aprovados e com arquivo, escolhidos pela afinidade (recommend.ts), fora os já entregues e os em quarentena. */
  feed(userId: string, exclude: string[], limit: number): Promise<FeedPage>;
  /** null quando o vídeo não existe ou não está aprovado. */
  listComments(videoId: string): Promise<CommentView[] | null>;
  /** null quando o vídeo não existe ou não está aprovado. */
  addComment(userId: string, videoId: string, text: string): Promise<CommentView | null>;
  /** Curte ou descurte; null quando o vídeo não existe ou não está aprovado. */
  setLike(userId: string, videoId: string, liked: boolean): Promise<{ liked: boolean; likeCount: number } | null>;
  /** Grava a visualização e ajusta a afinidade; false quando o vídeo não existe ou não está aprovado. */
  recordView(userId: string, videoId: string, view: ViewInput): Promise<boolean>;
  /** viewerId decide o campo liked dos vídeos curtidos. */
  profile(nickname: string, viewerId: string): Promise<Profile | null>;
  /** Vídeos aprovados em que alguma persona ainda não comentou (usado na subida). */
  videosMissingPersonaComments(): Promise<string[]>;
}

/** Avatares de usuários e personas são servidos pela api em /avatars. */
export const avatarUrl = (file: string | null) => (file ? `/avatars/${file}` : null);

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
         v.duration, v.file_path, v.thumb_path, v.created_at, v.submitted_by,
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

interface UserRow {
  id: string;
  nickname: string;
  avatar: string | null;
  role: "owner" | "resident";
  is_ai: boolean;
}

const USER_COLUMNS = "id, nickname, avatar, role, is_ai";

const toUser = (r: UserRow): UserView => ({
  id: r.id,
  nickname: r.nickname,
  avatarUrl: avatarUrl(r.avatar),
  role: r.role,
  isAi: r.is_ai,
});

interface CommentRow {
  id: string;
  text: string;
  created_at: Date;
  nickname: string;
  avatar: string | null;
  is_ai: boolean;
}

const toComment = (r: CommentRow): CommentView => ({
  id: r.id,
  text: r.text,
  createdAt: r.created_at.toISOString(),
  author: { nickname: r.nickname, avatarUrl: avatarUrl(r.avatar), isAi: r.is_ai },
});

interface FeedRow extends VideoRow {
  comment_count: number;
  like_count: number;
  liked: boolean;
  author_nickname: string | null;
  author_avatar: string | null;
  author_is_ai: boolean | null;
}

/** Vídeo com contagens, curtida de quem pede ($1) e autor. Quem usa completa com WHERE e ORDER BY. */
const FEED_SELECT = `
  SELECT v.*, c.comment_count, l.like_count, l.liked,
         u.nickname AS author_nickname, u.avatar AS author_avatar, u.is_ai AS author_is_ai
    FROM (${VIDEO_SELECT}) v
    LEFT JOIN users u ON u.id = v.submitted_by
    CROSS JOIN LATERAL (SELECT count(*)::int AS comment_count FROM comments c WHERE c.video_id = v.id) c
    CROSS JOIN LATERAL (SELECT count(*)::int AS like_count, COALESCE(bool_or(l.user_id = $1), false) AS liked
                          FROM likes l WHERE l.video_id = v.id) l`;

const toFeedVideo = (r: FeedRow): FeedVideo => ({
  ...toView(r),
  commentCount: r.comment_count,
  likeCount: r.like_count,
  liked: r.liked,
  author: r.author_nickname
    ? { nickname: r.author_nickname, avatarUrl: avatarUrl(r.author_avatar), isAi: Boolean(r.author_is_ai) }
    : null,
});

interface CandidateRow {
  id: string;
  topic_ids: number[];
  liked: boolean;
  last_viewed: Date | null;
}

/** Soma delta na afinidade de quem ($1) com os tópicos do vídeo ($2), dentro da faixa do score. */
const BUMP_AFFINITY = `
  INSERT INTO user_topic_affinity (user_id, topic_id, score)
  SELECT DISTINCT $1::uuid, vt.topic_id, LEAST(GREATEST($3::real, ${SCORE_MIN}), ${SCORE_MAX})
    FROM video_topics vt WHERE vt.video_id = $2
  ON CONFLICT (user_id, topic_id) DO UPDATE
    SET score = LEAST(GREATEST(user_topic_affinity.score + $3::real, ${SCORE_MIN}), ${SCORE_MAX}), updated_at = now()`;

export class PgStore implements Store {
  constructor(
    private readonly pool: Pool,
    private readonly rng: Rng = Math.random,
    private readonly now: () => number = Date.now,
  ) {}

  private async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const out = await fn(client);
      await client.query("COMMIT");
      return out;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

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
      `UPDATE videos SET status = 'rejeitado', stage = 'concluido', approved_by = $2,
              file_path = NULL, thumb_path = NULL, updated_at = now()
        WHERE id = $1 AND status = 'pendente'`,
      [id, ownerId],
    );
    return res.rowCount === 1;
  }

  async findUser(nickname: string) {
    const res = await this.pool.query<UserRow & { pin_hash: string | null }>(
      `SELECT ${USER_COLUMNS}, pin_hash FROM users WHERE nickname = $1`,
      [nickname],
    );
    const row = res.rows[0];
    return row ? { user: toUser(row), pinHash: row.pin_hash } : null;
  }

  async createUser(nickname: string, pinHash: string) {
    const res = await this.pool.query<UserRow>(
      `INSERT INTO users (nickname, pin_hash) VALUES ($1, $2) ON CONFLICT (nickname) DO NOTHING RETURNING ${USER_COLUMNS}`,
      [nickname, pinHash],
    );
    return res.rows[0] ? toUser(res.rows[0]) : null;
  }

  async createSession(userId: string, tokenHash: string) {
    await this.pool.query("INSERT INTO sessions (token_hash, user_id) VALUES ($1, $2)", [tokenHash, userId]);
  }

  async sessionUser(tokenHash: string) {
    const res = await this.pool.query<UserRow>(
      `SELECT ${USER_COLUMNS.replace(/(\w+)/g, "u.$1")} FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1`,
      [tokenHash],
    );
    return res.rows[0] ? toUser(res.rows[0]) : null;
  }

  async deleteSession(tokenHash: string) {
    await this.pool.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash]);
  }

  async statusOf(ids: string[]) {
    const res = await this.pool.query<{ id: string; status: string }>(
      "SELECT id, status FROM videos WHERE id = ANY($1::uuid[])",
      [ids],
    );
    return new Map(res.rows.map((r) => [r.id, r.status]));
  }

  async feed(userId: string, exclude: string[], limit: number): Promise<FeedPage> {
    const [cands, aff] = await Promise.all([
      this.pool.query<CandidateRow>(
        `SELECT v.id,
                COALESCE(array_agg(DISTINCT vt.topic_id) FILTER (WHERE vt.topic_id IS NOT NULL), '{}'::int[]) AS topic_ids,
                EXISTS (SELECT 1 FROM likes l WHERE l.video_id = v.id AND l.user_id = $1) AS liked,
                (SELECT max(e.created_at) FROM view_events e WHERE e.video_id = v.id AND e.user_id = $1) AS last_viewed
           FROM videos v LEFT JOIN video_topics vt ON vt.video_id = v.id
          WHERE v.status = 'aprovado' AND v.file_path IS NOT NULL
          GROUP BY v.id`,
        [userId],
      ),
      this.pool.query<{ topic_id: number; score: number }>(
        "SELECT topic_id, score FROM user_topic_affinity WHERE user_id = $1",
        [userId],
      ),
    ]);
    const candidates: Candidate[] = cands.rows.map((r) => ({
      id: r.id,
      topicIds: r.topic_ids,
      liked: r.liked,
      lastViewedAt: r.last_viewed ? r.last_viewed.getTime() : null,
    }));
    const affinity = new Map(aff.rows.map((r) => [r.topic_id, r.score]));
    const pick = pickFeed(candidates, affinity, exclude.filter(isUuid), limit, this.now(), this.rng);
    if (pick.ids.length === 0) return { videos: [], restarted: pick.restarted };
    const res = await this.pool.query<FeedRow>(`${FEED_SELECT} WHERE v.id = ANY($2::uuid[])`, [userId, pick.ids]);
    const byId = new Map(res.rows.map((r) => [r.id, toFeedVideo(r)]));
    const videos = pick.ids.flatMap((id) => byId.get(id) ?? []);
    return { videos, restarted: pick.restarted };
  }

  async recordView(userId: string, videoId: string, view: ViewInput) {
    if (!isUuid(videoId)) return false;
    const { skipped, delta } = viewDelta(view);
    return this.tx(async (c) => {
      const ins = await c.query(
        `INSERT INTO view_events (user_id, video_id, watched_ms, watch_pct, replays, skipped)
         SELECT $1, $2, $3, $4, $5, $6 WHERE EXISTS (SELECT 1 FROM videos WHERE id = $2 AND status = 'aprovado')`,
        [userId, videoId, view.watchedMs, view.watchPct, view.replays, skipped],
      );
      if (!ins.rowCount) return false;
      if (delta !== 0) await c.query(BUMP_AFFINITY, [userId, videoId, delta]);
      return true;
    });
  }

  async addComment(userId: string, videoId: string, text: string) {
    if (!isUuid(videoId)) return null;
    const res = await this.pool.query<CommentRow>(
      `WITH ins AS (
         INSERT INTO comments (video_id, user_id, text)
         SELECT $1::uuid, $2::uuid, $3 WHERE EXISTS (SELECT 1 FROM videos WHERE id = $1 AND status = 'aprovado')
         RETURNING id, text, created_at, user_id)
       SELECT ins.id, ins.text, ins.created_at, u.nickname, u.avatar, u.is_ai FROM ins JOIN users u ON u.id = ins.user_id`,
      [videoId, userId, text],
    );
    const row = res.rows[0];
    if (!row) return null;
    const mine = await this.pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM comments WHERE video_id = $1 AND user_id = $2",
      [videoId, userId],
    );
    if (mine.rows[0]!.n === 1) await this.pool.query(BUMP_AFFINITY, [userId, videoId, COMMENT_DELTA]);
    return toComment(row);
  }

  async setLike(userId: string, videoId: string, liked: boolean) {
    if (!isUuid(videoId)) return null;
    const video = await this.pool.query("SELECT 1 FROM videos WHERE id = $1 AND status = 'aprovado'", [videoId]);
    if (!video.rowCount) return null;
    const changed = await this.pool.query(
      liked
        ? "INSERT INTO likes (user_id, video_id) VALUES ($1, $2) ON CONFLICT DO NOTHING"
        : "DELETE FROM likes WHERE user_id = $1 AND video_id = $2",
      [userId, videoId],
    );
    // Só muda a afinidade quando a curtida mudou: descurtir desfaz o que curtir somou.
    if (changed.rowCount) await this.pool.query(BUMP_AFFINITY, [userId, videoId, liked ? LIKE_DELTA : -LIKE_DELTA]);
    const count = await this.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM likes WHERE video_id = $1", [videoId]);
    return { liked, likeCount: count.rows[0]!.n };
  }

  async profile(nickname: string, viewerId: string) {
    const res = await this.pool.query<UserRow & { bio: string | null; name: string | null }>(
      `SELECT ${USER_COLUMNS.replace(/(\w+)/g, "u.$1")}, p.bio, p.config->>'nome' AS name
         FROM users u LEFT JOIN personas p ON p.user_id = u.id WHERE u.nickname = $1`,
      [nickname],
    );
    const row = res.rows[0];
    if (!row) return null;
    const liked = await this.pool.query<FeedRow>(
      `${FEED_SELECT} JOIN likes pl ON pl.video_id = v.id AND pl.user_id = $2
        WHERE v.status = 'aprovado' AND v.file_path IS NOT NULL
        ORDER BY pl.created_at DESC LIMIT 200`,
      [viewerId, row.id],
    );
    return { ...toUser(row), name: row.name, bio: row.bio, liked: liked.rows.map(toFeedVideo) };
  }

  async listComments(videoId: string) {
    if (!isUuid(videoId)) return null;
    const video = await this.pool.query("SELECT 1 FROM videos WHERE id = $1 AND status = 'aprovado'", [videoId]);
    if (!video.rowCount) return null;
    const res = await this.pool.query<CommentRow>(
      `SELECT c.id, c.text, c.created_at, u.nickname, u.avatar, u.is_ai
         FROM comments c JOIN users u ON u.id = c.user_id
        WHERE c.video_id = $1 ORDER BY c.created_at`,
      [videoId],
    );
    return res.rows.map(toComment);
  }

  async videosMissingPersonaComments() {
    const res = await this.pool.query<{ id: string }>(
      `SELECT v.id FROM videos v
        WHERE v.status = 'aprovado'
          AND EXISTS (SELECT 1 FROM personas p
                       WHERE NOT EXISTS (SELECT 1 FROM comments c WHERE c.video_id = v.id AND c.user_id = p.user_id))`,
    );
    return res.rows.map((r) => r.id);
  }
}
