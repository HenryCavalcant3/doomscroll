-- Passo 2 do SPEC: tabelas da ingestão (seção 8).
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE users (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nickname   text NOT NULL UNIQUE,
  pin_hash   text,
  avatar     text,
  role       text NOT NULL DEFAULT 'resident' CHECK (role IN ('owner', 'resident')),
  is_ai      boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE topics (
  id        serial PRIMARY KEY,
  name      text NOT NULL,
  slug      text NOT NULL UNIQUE,
  embedding vector(768)
);

-- status segue o SPEC; stage detalha o progresso para a tela de cadastro:
--   baixando -> convertendo -> transcrevendo -> sugerindo -> aguardando_confirmacao
--   -> aguardando_aprovacao -> gerando_embedding -> concluido
CREATE TABLE videos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_url   text NOT NULL,
  platform     text NOT NULL,
  file_path    text,
  thumb_path   text,
  duration     real,
  title        text,
  hashtags     text[] NOT NULL DEFAULT '{}',
  description  text,
  transcript   text,
  embedding    vector(768),
  status       text NOT NULL DEFAULT 'baixando'
               CHECK (status IN ('baixando', 'processando', 'pendente', 'aprovado', 'rejeitado', 'falhou')),
  stage        text NOT NULL DEFAULT 'baixando',
  error        text,
  submitted_by uuid REFERENCES users (id),
  approved_by  uuid REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- O mesmo link não entra duas vezes, a não ser que a tentativa anterior tenha falhado ou sido rejeitada.
CREATE UNIQUE INDEX videos_source_url_ativo ON videos (source_url) WHERE status NOT IN ('falhou', 'rejeitado');
CREATE INDEX videos_status ON videos (status);

CREATE TABLE video_topics (
  video_id uuid NOT NULL REFERENCES videos (id) ON DELETE CASCADE,
  topic_id int  NOT NULL REFERENCES topics (id) ON DELETE CASCADE,
  source   text NOT NULL CHECK (source IN ('user', 'ai')),
  PRIMARY KEY (video_id, topic_id)
);

-- Lista inicial, ampla de propósito: tópicos agrupam; a busca fina fica com os embeddings.
INSERT INTO topics (name, slug) VALUES
  ('Humor', 'humor'),
  ('Dicas', 'dicas'),
  ('Política', 'politica'),
  ('Animais', 'animais'),
  ('Música', 'musica'),
  ('Esporte', 'esporte'),
  ('Comida', 'comida'),
  ('Ciência', 'ciencia'),
  ('Games', 'games'),
  ('Notícias', 'noticias'),
  ('Fofoca', 'fofoca');
