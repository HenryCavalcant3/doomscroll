-- Boletim do Bunker (SPEC 7.6, docs/boletim/BOLETIM.md): o resumo do dia anterior, um por dia, igual para todos.

-- Quando o vídeo foi aprovado: "tema inaugurado" e o desempate do mais curtido dependem disso.
-- O acervo de antes não guardava a data. A aproximação é a primeira decisão das personas sobre o vídeo
-- (o JEV roda logo depois da aprovação); sem decisão, o cadastro. updated_at não serve: a reconversão mexe nele.
ALTER TABLE videos ADD COLUMN approved_at timestamptz;
UPDATE videos v SET approved_at = coalesce(
  (SELECT min(d.created_at) FROM persona_decisions d WHERE d.trigger = 'video' AND d.target_id = v.id),
  v.created_at)
 WHERE v.status = 'aprovado';
CREATE INDEX videos_approved_at ON videos (approved_at) WHERE status = 'aprovado';

-- Tópico sensível: no assunto do dia, mostra só o tópico (sem o vídeo) e a manchete vira frase de "dia parado".
ALTER TABLE topics ADD COLUMN sensitive boolean NOT NULL DEFAULT false;
UPDATE topics SET sensitive = true WHERE slug IN ('politica', 'noticias');

CREATE TABLE daily_bulletins (
  -- dia de calendário coberto (o de ontem, no fuso do servidor)
  date               date PRIMARY KEY,
  -- persona de plantão (rodízio pela data)
  persona_user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- números e listas do dia, vindos do SQL; a LLM só recebe parte disto
  facts              jsonb NOT NULL DEFAULT '{}',
  headline           text,
  gossip             text,
  gossip_source      text CHECK (gossip_source IN ('fato', 'pauta')),
  -- id da pauta ou nome do detector do fato curioso
  gossip_ref         text,
  top_video_id       uuid REFERENCES videos (id) ON DELETE SET NULL,
  status             text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'pronto', 'curto', 'falhou')),
  message_id         uuid,
  -- anti-repetição: manchete e fofoca comparadas com as dos últimos boletins
  headline_embedding vector(768),
  gossip_embedding   vector(768),
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- Quem já viu o cartão do boletim no feed (uma vez por morador por boletim).
CREATE TABLE bulletin_views (
  bulletin_date date NOT NULL REFERENCES daily_bulletins (date) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  seen_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bulletin_date, user_id)
);

-- Pautas de fofoca para quando não há fato curioso real. Vêm de docs/boletim/pautas.json na subida,
-- só as que ainda não existem: o que o dono editou no painel não é sobrescrito.
CREATE TABLE gossip_topics (
  id           text PRIMARY KEY CHECK (id ~ '^[a-z0-9-]+$'),
  text         text NOT NULL CHECK (length(text) BETWEEN 1 AND 200),
  active       boolean NOT NULL DEFAULT true,
  last_used_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Mensagem do boletim no Grupo do Bunker: manchete e botão "Ler o boletim".
ALTER TABLE messages ADD COLUMN bulletin_date date REFERENCES daily_bulletins (date) ON DELETE CASCADE;
ALTER TABLE messages DROP CONSTRAINT messages_type_check;
ALTER TABLE messages ADD CONSTRAINT messages_type_check CHECK (type IN ('text', 'video', 'bulletin'));
ALTER TABLE messages ADD CONSTRAINT messages_bulletin_check CHECK ((type = 'bulletin') = (bulletin_date IS NOT NULL));

ALTER TABLE daily_bulletins ADD CONSTRAINT daily_bulletins_message_fk
  FOREIGN KEY (message_id) REFERENCES messages (id) ON DELETE SET NULL;

-- Gatilho novo no ciclo das personas: boletim publicado (alvo = mensagem do boletim no grupo).
ALTER TABLE persona_decisions DROP CONSTRAINT persona_decisions_trigger_check;
ALTER TABLE persona_decisions ADD CONSTRAINT persona_decisions_trigger_check
  CHECK (trigger IN ('video', 'mensagem', 'tique', 'boletim'));
