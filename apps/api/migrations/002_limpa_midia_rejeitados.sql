-- Vídeos rejeitados ou com falha não guardam mais arquivos (a api apaga as pastas na subida).
UPDATE videos SET file_path = NULL, thumb_path = NULL
 WHERE status IN ('rejeitado', 'falhou') AND (file_path IS NOT NULL OR thumb_path IS NOT NULL);
