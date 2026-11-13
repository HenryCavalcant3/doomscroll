-- Passo 8 do SPEC: o que cada persona lembra de cada contato (SPEC 7.4).
CREATE TABLE persona_memory (
  persona_user_id  uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  contact_user_id  uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  summary          text NOT NULL DEFAULT '' CHECK (length(summary) <= 1000),
  -- mensagens trocadas desde o último resumo (o resumo é refeito a cada N)
  pending_messages integer NOT NULL DEFAULT 0 CHECK (pending_messages >= 0),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (persona_user_id, contact_user_id),
  CHECK (persona_user_id <> contact_user_id)
);

-- Contagem das ações de persona na última hora (limite PERSONA_RATE).
CREATE INDEX comments_recent ON comments (created_at);
CREATE INDEX messages_recent ON messages (created_at);
