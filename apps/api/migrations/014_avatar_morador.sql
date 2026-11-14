-- Foto de perfil dos moradores: o nome do item (ex.: 'lanterna'), desenhado pelo web em /avatares/<nome>.svg.
-- Quem ainda não escolheu fica com 'padrao' (a escotilha). Personas continuam com o arquivo .svg da pasta
-- personas/ (disco preto, símbolo amarelo), e morador nunca guarda arquivo: a inversão de cores separa IA de gente.
UPDATE users SET avatar = 'padrao' WHERE NOT is_ai AND avatar IS NULL;
ALTER TABLE users ALTER COLUMN avatar SET DEFAULT 'padrao';
ALTER TABLE users ADD CONSTRAINT users_avatar_morador_check CHECK (is_ai OR avatar ~ '^[a-z]+$');
