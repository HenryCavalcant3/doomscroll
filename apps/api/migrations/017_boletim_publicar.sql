-- A persona de plantão publica o boletim no Grupo do Bunker: decisão "publicar" no gatilho "boletim".
ALTER TABLE persona_decisions DROP CONSTRAINT persona_decisions_action_check;
ALTER TABLE persona_decisions ADD CONSTRAINT persona_decisions_action_check
  CHECK (action IN ('ignorar', 'curtir', 'reagir', 'comentar', 'responder', 'enviar_video', 'publicar'));
