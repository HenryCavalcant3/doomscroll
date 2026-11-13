-- Passo 4 do SPEC: sessões de login (apelido + PIN) e curtidas.

-- O navegador guarda o token; o banco guarda só o hash SHA-256 dele.
CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user ON sessions (user_id);

CREATE TABLE likes (
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  video_id   uuid NOT NULL REFERENCES videos (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, video_id)
);
CREATE INDEX likes_video ON likes (video_id);
