-- Passo 3 do SPEC: personas (carregadas de personas/*.json na subida da api) e comentários.
CREATE TABLE personas (
  user_id        uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  bio            text NOT NULL,
  tone           text NOT NULL,
  examples       jsonb NOT NULL DEFAULT '[]',
  activity_level real NOT NULL DEFAULT 0.5 CHECK (activity_level BETWEEN 0 AND 1),
  -- nome de exibição, afinidade por tópico e relações com outras personas
  config         jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE comments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id   uuid NOT NULL REFERENCES videos (id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  text       text NOT NULL CHECK (length(text) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX comments_video ON comments (video_id, created_at);
