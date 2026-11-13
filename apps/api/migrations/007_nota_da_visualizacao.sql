-- Passo 5 do SPEC, fase 2: guarda quanto cada visualização mudou a afinidade (viewDelta em
-- affinity.ts). A nota de cada vídeo para o vetor de gosto sai daqui, sem repetir a regra em SQL.
ALTER TABLE view_events ADD COLUMN affinity_delta real NOT NULL DEFAULT 0;

-- Eventos gravados antes desta migração, pela mesma regra de viewDelta.
UPDATE view_events SET affinity_delta = CASE
  WHEN replays > 0 OR watch_pct >= 0.9 THEN 1 + 0.5 * LEAST(replays, 3)
  WHEN skipped THEN -1
  ELSE 0
END;
