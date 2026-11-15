-- Chave real do vídeo (plataforma:id do yt-dlp), gravada pelo worker depois do download.
-- O link curto do TikTok (vm.tiktok.com/...) não traz o número do vídeo; só a chave pega a repetição.
ALTER TABLE videos ADD COLUMN source_key text;

-- Acervo de antes: a chave sai do próprio link quando ele tem o id.
UPDATE videos SET source_key = 'youtube:' || substring(source_url FROM '[?&]v=([A-Za-z0-9_-]+)')
 WHERE source_key IS NULL AND source_url ~ '^https://www\.youtube\.com/watch\?v=';
UPDATE videos SET source_key = 'tiktok:' || substring(source_url FROM '/video/([0-9]+)')
 WHERE source_key IS NULL AND source_url ~ 'tiktok\.com/.*/video/[0-9]+';

CREATE UNIQUE INDEX videos_source_key_ativo ON videos (source_key) WHERE status NOT IN ('falhou', 'rejeitado');
