-- Boletim do Bunker: dias em que o bunker esteve ligado. O worker marca o dia a cada 15 minutos.
-- Servidor desligado o dia todo não tem boletim; ligado e sem movimento tem o boletim curto.
CREATE TABLE bunker_days (
  date          date PRIMARY KEY,
  first_seen_at timestamptz NOT NULL DEFAULT now()
);
