-- Passo 8 do SPEC, fase 3: o que o JEV decidiu e por quê (SPEC 7.4).
-- gatilho 'video': vídeo aprovado (alvo = vídeo); 'mensagem': mensagem recebida (alvo = mensagem).
CREATE TABLE persona_decisions (
  id              bigserial PRIMARY KEY,
  persona_user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  trigger         text NOT NULL CHECK (trigger IN ('video', 'mensagem')),
  target_id       uuid NOT NULL,
  action          text NOT NULL CHECK (action IN ('ignorar', 'curtir', 'reagir', 'comentar', 'responder', 'enviar_video')),
  -- nota final do JEV e as parcelas que levaram a ela
  score           real NOT NULL,
  reasons         jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- uma decisão por persona e alvo: job repetido não decide de novo
  UNIQUE (persona_user_id, trigger, target_id)
);

CREATE INDEX persona_decisions_recent ON persona_decisions (created_at DESC);
