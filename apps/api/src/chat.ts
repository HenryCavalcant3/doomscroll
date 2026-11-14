import type { Pool, PoolClient } from "pg";
import { avatarUrl, isUuid, type AuthorView } from "./store.js";

/** Chat entre usuários (SPEC 5.3 e passo 7). */

/** Emojis de reação aceitos (uma reação por pessoa em cada mensagem). */
export const REACTIONS = ["❤️", "😂", "😮", "😢", "🔥", "👍"] as const;

export const BUNKER_NAME = "Grupo do Bunker";
export const GROUP_MAX_MEMBERS = 50;
export const MESSAGES_PAGE = 50;

export interface SharedVideo {
  id: string;
  title: string | null;
  description: string | null;
  videoUrl: string | null;
  thumbUrl: string | null;
}

export interface ReactionView {
  emoji: string;
  nickname: string;
}

export interface MessageView {
  id: string;
  conversationId: string;
  type: "text" | "video";
  text: string | null;
  /** Vídeo compartilhado do feed (mensagens de vídeo). */
  video: SharedVideo | null;
  reactions: ReactionView[];
  createdAt: string;
  sender: AuthorView;
}

export interface ConversationView {
  id: string;
  type: "direct" | "group";
  name: string | null;
  /** O Grupo do Bunker, com todo mundo da rede. */
  bunker: boolean;
  /** Os outros membros (sem quem pediu). */
  members: AuthorView[];
  lastMessage: MessageView | null;
  /** Mensagens dos outros depois do que quem pediu já leu. */
  unread: number;
}

export type MessageContent = { text: string } | { videoId: string };

export type OpenDirectResult = ConversationView | "not_found" | "self";
export type CreateGroupResult = ConversationView | { unknown: string[] } | "persona";
export type SendResult =
  | { message: MessageView; memberIds: string[]; firstShare: boolean }
  | "not_member"
  | "video_not_found";

export interface ChatStore {
  /** Abre (ou reaproveita) a conversa direta com o apelido. */
  openDirect(userId: string, nickname: string): Promise<OpenDirectResult>;
  /** Cria um grupo com quem pediu e os apelidos dados. */
  createGroup(userId: string, name: string, nicknames: string[]): Promise<CreateGroupResult>;
  /** Cria o Grupo do Bunker se faltar e põe nele todas as pessoas e personas. Usado na subida, depois de sincronizar as personas. */
  ensureBunker(): Promise<void>;
  /** Põe uma pessoa nova no Grupo do Bunker. */
  joinBunker(userId: string): Promise<void>;
  /** Grupos e conversas diretas com pelo menos uma mensagem, da mais recente para a mais antiga. */
  listConversations(userId: string): Promise<ConversationView[]>;
  /** null quando a conversa não existe ou a pessoa não é membro. */
  getConversation(userId: string, conversationId: string): Promise<ConversationView | null>;
  /** Página de mensagens em ordem cronológica, antes da mensagem `before` (ou as últimas). */
  listMessages(userId: string, conversationId: string, before: string | null, limit: number): Promise<MessageView[] | null>;
  /** Grava a mensagem (texto ou vídeo aprovado) e devolve quem precisa ser avisado. */
  sendMessage(userId: string, conversationId: string, content: MessageContent): Promise<SendResult>;
  /** Põe, troca (emoji) ou tira (null) a reação; null quando não acha a conversa ou a mensagem. */
  setReaction(
    userId: string,
    conversationId: string,
    messageId: string,
    emoji: string | null,
  ): Promise<{ reactions: ReactionView[]; memberIds: string[] } | null>;
  /** Ids de todos os membros (para os avisos em tempo real). */
  memberIds(conversationId: string): Promise<string[]>;
  /** Marca como lido até a mensagem dada (nunca volta atrás); false quando não acha a conversa ou a mensagem. */
  markRead(userId: string, conversationId: string, messageId: string): Promise<boolean>;
  /**
   * Modo stalker (SPEC 7.5): conversas diretas da persona com outras personas, com o outro lado em
   * `members`. Conversa com gente nunca entra. null quando o apelido não é de persona.
   */
  stalkerConversations(nickname: string): Promise<ConversationView[] | null>;
  /** Mensagens de uma conversa do modo stalker; null quando não é conversa direta só de personas com essa persona. */
  stalkerMessages(nickname: string, conversationId: string, before: string | null, limit: number): Promise<MessageView[] | null>;
}

/** Chave da conversa direta: os dois ids em ordem. */
export const directKey = (a: string, b: string) => [a, b].sort().join(":");

interface AuthorJson {
  nickname: string;
  avatar: string | null;
  is_ai: boolean;
}

const toAuthor = (a: AuthorJson): AuthorView => ({ nickname: a.nickname, avatarUrl: avatarUrl(a.avatar), isAi: a.is_ai });

interface MessageRow {
  id: string;
  conversation_id: string;
  type: "text" | "video";
  text: string | null;
  created_at: Date | string;
  sender: AuthorJson;
  video: { id: string; title: string | null; description: string | null; file_path: string | null; thumb_path: string | null } | null;
  reactions: ReactionView[];
}

const toMessage = (r: MessageRow): MessageView => ({
  id: r.id,
  conversationId: r.conversation_id,
  type: r.type,
  text: r.text,
  video: r.video
    ? {
        id: r.video.id,
        title: r.video.title,
        description: r.video.description,
        videoUrl: r.video.file_path ? `/media/${r.video.file_path}` : null,
        thumbUrl: r.video.thumb_path ? `/media/${r.video.thumb_path}` : null,
      }
    : null,
  reactions: r.reactions,
  createdAt: new Date(r.created_at).toISOString(),
  sender: toAuthor(r.sender),
});

const REACTIONS_OF = (messageId: string) => `
  COALESCE((SELECT json_agg(json_build_object('emoji', r.emoji, 'nickname', ru.nickname) ORDER BY r.created_at)
              FROM message_reactions r JOIN users ru ON ru.id = r.user_id
             WHERE r.message_id = ${messageId}), '[]'::json)`;

const MESSAGE_SELECT = `
  SELECT m.id, m.conversation_id, m.type, m.text, m.created_at,
         json_build_object('nickname', u.nickname, 'avatar', u.avatar, 'is_ai', u.is_ai) AS sender,
         CASE WHEN v.id IS NULL THEN NULL
              ELSE json_build_object('id', v.id, 'title', v.title, 'description', v.description,
                                     'file_path', v.file_path, 'thumb_path', v.thumb_path) END AS video,
         ${REACTIONS_OF("m.id")} AS reactions
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    LEFT JOIN videos v ON v.id = m.video_id`;

interface ConversationRow {
  id: string;
  type: "direct" | "group";
  name: string | null;
  bunker: boolean;
  members: AuthorJson[];
  last_message: MessageRow | null;
  unread: number;
}

/** Conversas de quem pede ($1), com os outros membros, a última mensagem e as não lidas. */
const CONVERSATION_SELECT = `
  SELECT c.id, c.type, c.name, c.bunker,
         COALESCE((SELECT json_agg(json_build_object('nickname', u.nickname, 'avatar', u.avatar, 'is_ai', u.is_ai)
                                   ORDER BY u.nickname)
                     FROM conversation_members om JOIN users u ON u.id = om.user_id
                    WHERE om.conversation_id = c.id AND om.user_id <> $1), '[]'::json) AS members,
         (SELECT row_to_json(lm) FROM (${MESSAGE_SELECT}
             WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) lm) AS last_message,
         (SELECT count(*)::int FROM messages m
           WHERE m.conversation_id = c.id AND m.sender_id <> $1 AND m.created_at > me.last_read_at) AS unread
    FROM conversations c
    JOIN conversation_members me ON me.conversation_id = c.id AND me.user_id = $1`;

/** A conversa `c` só tem personas (nenhuma pessoa de verdade): a única que o modo stalker mostra. */
const ONLY_PERSONAS = `NOT EXISTS (SELECT 1 FROM conversation_members om JOIN users ou ON ou.id = om.user_id
                                   WHERE om.conversation_id = c.id AND NOT ou.is_ai)`;

const toConversation = (r: ConversationRow): ConversationView => ({
  id: r.id,
  type: r.type,
  name: r.name,
  bunker: r.bunker,
  members: r.members.map(toAuthor),
  lastMessage: r.last_message ? toMessage(r.last_message) : null,
  unread: r.unread,
});

export class PgChatStore implements ChatStore {
  constructor(private readonly pool: Pool) {}

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

  async openDirect(userId: string, nickname: string): Promise<OpenDirectResult> {
    const other = await this.pool.query<{ id: string }>(
      "SELECT id FROM users WHERE nickname = $1",
      [nickname],
    );
    const row = other.rows[0];
    if (!row) return "not_found";
    if (row.id === userId) return "self";
    const key = directKey(userId, row.id);
    const id = await this.tx(async (c) => {
      // ON CONFLICT: duas pessoas abrindo a mesma conversa ao mesmo tempo ficam com uma só.
      await c.query("INSERT INTO conversations (type, direct_key) VALUES ('direct', $1) ON CONFLICT (direct_key) DO NOTHING", [key]);
      const conv = await c.query<{ id: string }>("SELECT id FROM conversations WHERE direct_key = $1", [key]);
      const convId = conv.rows[0]!.id;
      await c.query(
        "INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1, $2), ($1, $3) ON CONFLICT DO NOTHING",
        [convId, userId, row.id],
      );
      return convId;
    });
    return (await this.getConversation(userId, id))!;
  }

  async createGroup(userId: string, name: string, nicknames: string[]): Promise<CreateGroupResult> {
    const found = await this.pool.query<{ id: string; nickname: string; is_ai: boolean }>(
      "SELECT id, nickname, is_ai FROM users WHERE nickname = ANY($1)",
      [nicknames],
    );
    const unknown = nicknames.filter((n) => !found.rows.some((r) => r.nickname === n));
    if (unknown.length) return { unknown };
    if (found.rows.some((r) => r.is_ai)) return "persona";
    const ids = [...new Set([userId, ...found.rows.map((r) => r.id)])];
    const id = await this.tx(async (c) => {
      const conv = await c.query<{ id: string }>("INSERT INTO conversations (type, name) VALUES ('group', $1) RETURNING id", [name]);
      const convId = conv.rows[0]!.id;
      await c.query(
        "INSERT INTO conversation_members (conversation_id, user_id) SELECT $1, unnest($2::uuid[])",
        [convId, ids],
      );
      return convId;
    });
    return (await this.getConversation(userId, id))!;
  }

  async ensureBunker() {
    await this.pool.query(
      `INSERT INTO conversations (type, name, bunker)
       SELECT 'group', $1, true WHERE NOT EXISTS (SELECT 1 FROM conversations WHERE bunker)
       ON CONFLICT DO NOTHING`,
      [BUNKER_NAME],
    );
    await this.pool.query(
      `INSERT INTO conversation_members (conversation_id, user_id)
       SELECT c.id, u.id FROM conversations c CROSS JOIN users u WHERE c.bunker
       ON CONFLICT DO NOTHING`,
    );
  }

  async joinBunker(userId: string) {
    await this.pool.query(
      // Quem chega não herda o histórico do grupo como não lido.
      `INSERT INTO conversation_members (conversation_id, user_id, last_read_at)
       SELECT id, $1, now() FROM conversations WHERE bunker ON CONFLICT DO NOTHING`,
      [userId],
    );
  }

  async listConversations(userId: string) {
    const res = await this.pool.query<ConversationRow>(
      `${CONVERSATION_SELECT}
        WHERE c.type = 'group' OR c.last_message_at IS NOT NULL
        ORDER BY COALESCE(c.last_message_at, c.created_at) DESC LIMIT 200`,
      [userId],
    );
    return res.rows.map(toConversation);
  }

  async getConversation(userId: string, conversationId: string) {
    if (!isUuid(conversationId)) return null;
    const res = await this.pool.query<ConversationRow>(`${CONVERSATION_SELECT} WHERE c.id = $2`, [userId, conversationId]);
    return res.rows[0] ? toConversation(res.rows[0]) : null;
  }

  private async isMember(userId: string, conversationId: string) {
    if (!isUuid(conversationId)) return false;
    const res = await this.pool.query(
      "SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2",
      [conversationId, userId],
    );
    return res.rowCount === 1;
  }

  private async idsOf(c: Pool | PoolClient, conversationId: string) {
    const res = await c.query<{ user_id: string }>("SELECT user_id FROM conversation_members WHERE conversation_id = $1", [
      conversationId,
    ]);
    return res.rows.map((r) => r.user_id);
  }

  async listMessages(userId: string, conversationId: string, before: string | null, limit: number) {
    if (!(await this.isMember(userId, conversationId))) return null;
    if (before !== null && !isUuid(before)) return [];
    const res = await this.pool.query<MessageRow>(
      `${MESSAGE_SELECT}
        WHERE m.conversation_id = $1
          AND ($2::uuid IS NULL OR m.created_at < (SELECT created_at FROM messages WHERE id = $2 AND conversation_id = $1))
        ORDER BY m.created_at DESC LIMIT $3`,
      [conversationId, before, limit],
    );
    return res.rows.map(toMessage).reverse();
  }

  async sendMessage(userId: string, conversationId: string, content: MessageContent): Promise<SendResult> {
    if (!(await this.isMember(userId, conversationId))) return "not_member";
    const videoId = "videoId" in content ? content.videoId : null;
    if (videoId !== null) {
      if (!isUuid(videoId)) return "video_not_found";
      const ok = await this.pool.query("SELECT 1 FROM videos WHERE id = $1 AND status = 'aprovado' AND file_path IS NOT NULL", [videoId]);
      if (!ok.rowCount) return "video_not_found";
    }
    return this.tx(async (c) => {
      const ins = await c.query<{ id: string; created_at: Date }>(
        `INSERT INTO messages (conversation_id, sender_id, type, text, video_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at`,
        [conversationId, userId, videoId ? "video" : "text", "text" in content ? content.text : null, videoId],
      );
      const { id, created_at } = ins.rows[0]!;
      await c.query("UPDATE conversations SET last_message_at = $2 WHERE id = $1", [conversationId, created_at]);
      // Quem escreve já leu a conversa até a própria mensagem.
      await c.query(
        "UPDATE conversation_members SET last_read_at = GREATEST(last_read_at, $3) WHERE conversation_id = $1 AND user_id = $2",
        [conversationId, userId, created_at],
      );
      let firstShare = false;
      if (videoId) {
        const shares = await c.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM messages WHERE sender_id = $1 AND video_id = $2",
          [userId, videoId],
        );
        firstShare = shares.rows[0]!.n === 1;
      }
      const msg = await c.query<MessageRow>(`${MESSAGE_SELECT} WHERE m.id = $1`, [id]);
      return { message: toMessage(msg.rows[0]!), memberIds: await this.idsOf(c, conversationId), firstShare };
    });
  }

  async setReaction(userId: string, conversationId: string, messageId: string, emoji: string | null) {
    if (!isUuid(messageId) || !(await this.isMember(userId, conversationId))) return null;
    const msg = await this.pool.query("SELECT 1 FROM messages WHERE id = $1 AND conversation_id = $2", [messageId, conversationId]);
    if (!msg.rowCount) return null;
    if (emoji === null) {
      await this.pool.query("DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2", [messageId, userId]);
    } else {
      await this.pool.query(
        `INSERT INTO message_reactions (message_id, user_id, emoji) VALUES ($1, $2, $3)
         ON CONFLICT (message_id, user_id) DO UPDATE SET emoji = EXCLUDED.emoji, created_at = now()`,
        [messageId, userId, emoji],
      );
    }
    const res = await this.pool.query<{ reactions: ReactionView[] }>(`SELECT ${REACTIONS_OF("$1")} AS reactions`, [messageId]);
    return { reactions: res.rows[0]!.reactions, memberIds: await this.idsOf(this.pool, conversationId) };
  }

  async memberIds(conversationId: string) {
    return isUuid(conversationId) ? this.idsOf(this.pool, conversationId) : [];
  }

  async markRead(userId: string, conversationId: string, messageId: string) {
    if (!isUuid(conversationId) || !isUuid(messageId)) return false;
    const res = await this.pool.query(
      `UPDATE conversation_members cm SET last_read_at = GREATEST(cm.last_read_at, m.created_at)
         FROM messages m
        WHERE m.id = $3 AND m.conversation_id = $2 AND cm.conversation_id = $2 AND cm.user_id = $1`,
      [userId, conversationId, messageId],
    );
    return res.rowCount === 1;
  }

  private async personaId(nickname: string) {
    const res = await this.pool.query<{ id: string }>("SELECT id FROM users WHERE nickname = $1 AND is_ai", [nickname]);
    return res.rows[0]?.id ?? null;
  }

  async stalkerConversations(nickname: string) {
    const id = await this.personaId(nickname);
    if (!id) return null;
    const res = await this.pool.query<ConversationRow>(
      `${CONVERSATION_SELECT}
        WHERE c.type = 'direct' AND c.last_message_at IS NOT NULL AND ${ONLY_PERSONAS}
        ORDER BY c.last_message_at DESC LIMIT 50`,
      [id],
    );
    return res.rows.map(toConversation);
  }

  async stalkerMessages(nickname: string, conversationId: string, before: string | null, limit: number) {
    const id = await this.personaId(nickname);
    if (!id || !isUuid(conversationId)) return null;
    const ok = await this.pool.query(
      `SELECT 1 FROM conversations c
         JOIN conversation_members me ON me.conversation_id = c.id AND me.user_id = $1
        WHERE c.id = $2 AND c.type = 'direct' AND ${ONLY_PERSONAS}`,
      [id, conversationId],
    );
    return ok.rowCount ? this.listMessages(id, conversationId, before, limit) : null;
  }
}
