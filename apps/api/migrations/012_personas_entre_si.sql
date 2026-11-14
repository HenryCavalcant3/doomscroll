-- Passo 8 do SPEC, fase 4: personas conversando entre si (SPEC 7.5).
-- Gatilho 'tique': o agendador fez uma persona puxar conversa (alvo = mensagem com o vídeo que ela mandou).
-- As respostas entre personas e no Grupo do Bunker usam o gatilho 'mensagem' (alvo = mensagem respondida).
ALTER TABLE persona_decisions DROP CONSTRAINT persona_decisions_trigger_check;
ALTER TABLE persona_decisions ADD CONSTRAINT persona_decisions_trigger_check CHECK (trigger IN ('video', 'mensagem', 'tique'));
