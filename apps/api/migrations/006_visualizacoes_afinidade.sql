-- Passo 5 do SPEC, fase 1: eventos de visualização e afinidade por tópico.

-- Uma linha cada vez que um vídeo fica ativo no feed e depois sai (ou a aba é escondida).
CREATE TABLE view_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  video_id   uuid NOT NULL REFERENCES videos (id) ON DELETE CASCADE,
  watched_ms integer NOT NULL CHECK (watched_ms >= 0),
  -- Fração do vídeo vista na primeira passada, de 0 a 1.
  watch_pct  real NOT NULL CHECK (watch_pct BETWEEN 0 AND 1),
  replays    smallint NOT NULL DEFAULT 0 CHECK (replays >= 0),
  skipped    boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Quarentena: última visualização de cada vídeo por usuário.
CREATE INDEX view_events_user_video ON view_events (user_id, video_id, created_at DESC);

-- Vale também para personas (passo 8).
CREATE TABLE user_topic_affinity (
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  topic_id   int  NOT NULL REFERENCES topics (id) ON DELETE CASCADE,
  score      real NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, topic_id)
);
