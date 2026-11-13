import type { Pool } from "pg";
import { avatarUrl, isUuid, type AuthorView } from "./store.js";

/** Chat entre usuários (SPEC 5.3 e passo 7). */

export interface MessageView {
  id: string;
  conversationId: string;
  type: "text" | "video";
  text: string | null;
  videoId: string | null;
  createdAt: string;
  sender: AuthorView;
}

export interface ConversationView {
  id: string;
  type: "direct" | "group";
  name: string | null;
  /** Os outros membros (sem quem pediu). */
  members: AuthorView[];
  lastMessage: MessageView | null;
  /** Mensagens dos outros depois do que quem pediu já leu. */
  unread: number;
}

export type OpenDirectResult = ConversationView | "not_found" | "self" | "persona";

export const MESSAGES_PAGE = 50;

export interface ChatStore {
  /** Abre (ou reaproveita) a conversa direta com o apelido. */
  openDirect(userId: string, nickname: string): Promise<OpenDirectResult>;
  /** Conversas com pelo menos uma mensagem, da mais recente para a mais antiga. */
  listConversations(userId: string): Promise<ConversationView[]>;
  /** null quando a conversa não existe ou a pessoa não é membro. */
  getConversation(userId: string, conversationId: string): Promise<ConversationView | null>;
  /** Página de mensagens em ordem cronológica, antes da mensagem `before` (ou as últimas). */
  listMessages(userId: string, conversationId: string, before: string | null, limit: number): Promise<MessageView[] | null>;
  /** Grava a mensagem e devolve quem precisa ser avisado; null quando a pessoa não é membro. */
  sendMessage(userId: string, conversationId: string, text: string): Promise<{ message: MessageView; memberIds: string[] } | null>;
  /** Marca como lido até a mensagem dada (nunca volta atrás); false quando não acha a conversa ou a mensagem. */
  markRead(userId: string, conversationId: string, messageId: string): Promise<boolean>;
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
  video_id: string | null;
  created_at: Date | string;
  sender: AuthorJson;
}

const toMessage = (r: MessageRow): MessageView => ({
  id: r.id,
  conversationId: r.conversation_id,
  type: r.type,
  text: r.text,
  videoId: r.video_id,
  createdAt: new Date(r.created_at).toISOString(),
  sender: toAuthor(r.sender),
});

const MESSAGE_SELECT = `
  SELECT m.id, m.conversation_id, m.type, m.text, m.video_id, m.created_at,
         json_build_object('nickname', u.nickname, 'avatar', u.avatar, 'is_ai', u.is_ai) AS sender
    FROM messages m JOIN users u ON u.id = m.sender_id`;

interface ConversationRow {
  id: string;
  type: "direct" | "group";
  name: string | null;
  members: AuthorJson[];
  last_message: MessageRow | null;
  unread: number;
}

/** Conversas de quem pede ($1), com os outros membros, a última mensagem e as não lidas. */
const CONVERSATION_SELECT = `
  SELECT c.id, c.type, c.name,
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

const toConversation = (r: ConversationRow): ConversationView => ({
  id: r.id,
  type: r.type,
  name: r.name,
  members: r.members.map(toAuthor),
  lastMessage: r.last_message ? toMessage(r.last_message) : null,
  unread: r.unread,
});

export class PgChatStore implements ChatStore {
  constructor(private readonly pool: Pool) {}

  async openDirect(userId: string, nickname: string): Promise<OpenDirectResult> {
    const other = await this.pool.query<{ id: string; is_ai: boolean }>(
      "SELECT id, is_ai FROM users WHERE nickname = $1",
      [nickname],
    );
    const row = other.rows[0];
    if (!row) return "not_found";
    if (row.id === userId) return "self";
    // As personas só entram no chat no passo 8.
    if (row.is_ai) return "persona";
    const key = directKey(userId, row.id);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // ON CONFLICT: duas pessoas abrindo a mesma conversa ao mesmo tempo ficam com uma só.
      await client.query("INSERT INTO conversations (type, direct_key) VALUES ('direct', $1) ON CONFLICT (direct_key) DO NOTHING", [key]);
      const conv = await client.query<{ id: string }>("SELECT id FROM conversations WHERE direct_key = $1", [key]);
      const id = conv.rows[0]!.id;
      await client.query(
        "INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1, $2), ($1, $3) ON CONFLICT DO NOTHING",
        [id, userId, row.id],
      );
      await client.query("COMMIT");
      return (await this.getConversation(userId, id))!;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async listConversations(userId: string) {
    const res = await this.pool.query<ConversationRow>(
      `${CONVERSATION_SELECT} WHERE c.last_message_at IS NOT NULL ORDER BY c.last_message_at DESC LIMIT 200`,
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

  async sendMessage(userId: string, conversationId: string, text: string) {
    if (!(await this.isMember(userId, conversationId))) return null;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const ins = await client.query<{ id: string; created_at: Date }>(
        "INSERT INTO messages (conversation_id, sender_id, type, text) VALUES ($1, $2, 'text', $3) RETURNING id, created_at",
        [conversationId, userId, text],
      );
      const { id, created_at } = ins.rows[0]!;
      await client.query("UPDATE conversations SET last_message_at = $2 WHERE id = $1", [conversationId, created_at]);
      // Quem escreve já leu a conversa até a própria mensagem.
      await client.query(
        "UPDATE conversation_members SET last_read_at = GREATEST(last_read_at, $3) WHERE conversation_id = $1 AND user_id = $2",
        [conversationId, userId, created_at],
      );
      const members = await client.query<{ user_id: string }>(
        "SELECT user_id FROM conversation_members WHERE conversation_id = $1",
        [conversationId],
      );
      const msg = await client.query<MessageRow>(`${MESSAGE_SELECT} WHERE m.id = $1`, [id]);
      await client.query("COMMIT");
      return { message: toMessage(msg.rows[0]!), memberIds: members.rows.map((r) => r.user_id) };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
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
}
