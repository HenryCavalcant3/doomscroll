-- Busca (SPEC 5.2 e 7.6): texto dos vídeos sem acento, para "musica" achar "música".
CREATE EXTENSION IF NOT EXISTS unaccent;

-- unaccent() não é IMMUTABLE (depende do dicionário padrão); com o dicionário fixo, dá para indexar.
CREATE FUNCTION busca_normaliza(t text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, lower(coalesce(t, ''))) $$;

-- Documento de busca do vídeo: título, descrições, hashtags e o que se fala nele. Nomes com esquema:
-- ao criar e manter o índice, o Postgres roda a função com search_path restrito (pg_catalog).
CREATE FUNCTION video_busca(title text, description text, source_description text, hashtags text[], transcript text)
  RETURNS tsvector
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT to_tsvector('pg_catalog.portuguese', public.busca_normaliza(concat_ws(' ', title, description, source_description, array_to_string(hashtags, ' '), transcript))) $$;

CREATE INDEX videos_busca_idx ON videos USING gin (video_busca(title, description, source_description, hashtags, transcript));
