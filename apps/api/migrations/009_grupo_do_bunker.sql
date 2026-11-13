-- Passo 7, fase 2: Grupo do Bunker (todo mundo da rede) e uma reação por pessoa em cada mensagem.

-- No máximo uma conversa marcada como o Grupo do Bunker. A api cria e mantém os membros na subida.
ALTER TABLE conversations ADD COLUMN bunker boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX conversations_bunker ON conversations (bunker) WHERE bunker;
ALTER TABLE conversations ADD CONSTRAINT conversations_bunker_group CHECK (NOT bunker OR type = 'group');

-- Compartilhamentos de um vídeo por quem mandou (sinal da recomendação).
CREATE INDEX messages_video_sender ON messages (sender_id, video_id) WHERE video_id IS NOT NULL;
