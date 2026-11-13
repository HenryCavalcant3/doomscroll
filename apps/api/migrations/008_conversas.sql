-- Passo 7 do SPEC: chat entre usuários (conversas diretas e em grupo, mensagens e reações).

CREATE TABLE conversations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type            text NOT NULL CHECK (type IN ('direct', 'group')),
  name            text,
  -- Conversa direta: os dois ids em ordem, para nunca existir duas conversas entre as mesmas pessoas.
  direct_key      text UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz,
  CHECK ((type = 'direct') = (direct_key IS NOT NULL))
);

CREATE TABLE conversation_members (
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- Até onde a pessoa leu: mensagens dos outros depois disso contam como não lidas.
  last_read_at    timestamptz NOT NULL DEFAULT '-infinity',
  joined_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX conversation_members_user ON conversation_members (user_id);

CREATE TABLE messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  sender_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type            text NOT NULL DEFAULT 'text' CHECK (type IN ('text', 'video')),
  text            text,
  video_id        uuid REFERENCES videos (id) ON DELETE CASCADE,
  -- clock_timestamp: duas mensagens na mesma transação ainda ficam em ordem.
  created_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (type <> 'text' OR text IS NOT NULL),
  CHECK (type <> 'video' OR video_id IS NOT NULL)
);
CREATE INDEX messages_conversation ON messages (conversation_id, created_at DESC);

CREATE TABLE message_reactions (
  message_id uuid NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  emoji      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);
