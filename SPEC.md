# Doomscroll — Especificação

Vídeos curtos para o fim do mundo. Um app no estilo TikTok/Reels/Shorts que funciona 100% sem internet, em rede local, com amigos de IA rodando em LLM local.

## 1. Visão

- Projeto open source, meio meme, meio laboratório de rede social + IA local.
- Um computador roda tudo (backend, frontend, banco, IA) e cria ou entra em uma rede local (ex.: hotspot). Celulares e outros computadores da mesma rede acessam pelo navegador.
- O acervo de vídeos é montado **com internet** (cadastro por link) e consumido **sem internet**.
- Os vídeos são normais do dia a dia (humor, dicas, política etc.). O tema apocalipse fica só na embalagem: nome, logo, textos da interface e tempero das personas.
- A IA é parte obrigatória do app, não um extra. É a graça do projeto.

## 2. Princípios

1. **Um comando para subir:** `docker compose up` e nada mais.
2. **Offline de verdade:** depois da preparação inicial, nenhuma chamada externa.
3. **Leve por padrão:** modelo pequeno que roda em CPU com 8 GB de RAM. Quem tem GPU troca o modelo por variável de ambiente.
4. **IA nunca trava a tela:** tudo que der é pré-gerado em fila. Só o chat é em tempo real, com streaming.
5. **Persona é usuário:** IAs usam as mesmas tabelas e rotas que humanos.
6. **Repositório sem vídeos:** cada pessoa monta o próprio acervo, para uso pessoal.

## 3. Stack

| Camada | Escolha |
|---|---|
| Backend | Node.js + TypeScript (Fastify ou NestJS) |
| Tempo real | Socket.IO |
| Frontend | React + Vite + TypeScript, feed com CSS scroll-snap |
| Banco | PostgreSQL + pgvector |
| Fila | pg-boss (usa o próprio Postgres) |
| Download | yt-dlp |
| Vídeo | ffmpeg (MP4 H.264/AAC + thumbnail) |
| Transcrição | Whisper (base), via faster-whisper ou whisper.cpp |
| LLM e embeddings | Ollama |
| Proxy (fase final) | Caddy com certificado local, para HTTPS e PWA |

### Serviços do compose

- `db`: Postgres com pgvector.
- `api`: backend HTTP + WebSocket, serve os arquivos de vídeo.
- `worker`: consome a fila (download, conversão, transcrição, IA, agendador das personas). Contém yt-dlp e ffmpeg.
- `web`: frontend.
- `ollama`: LLM e embeddings. Um script de inicialização baixa os modelos definidos no `.env`.

### Variáveis principais

- `LLM_MODEL`: modelo de texto (padrão: um modelo pequeno de 3 a 4 bilhões de parâmetros, quantizado; escolher no catálogo do Ollama e validar em português).
- `EMBED_MODEL`: modelo de embeddings.
- `WHISPER_MODEL`: `base` por padrão.
- `OWNER_PIN`: PIN inicial do dono do bunker.
- `PERSONA_RATE`: limite de ações de persona por hora.

## 4. Usuários e papéis

- Identificação por **apelido + PIN** (PIN guardado com hash). Sem e-mail.
- **Dono:** quem roda o servidor. Aprova vídeos, gerencia tópicos e personas.
- **Morador:** usuário comum da rede.
- **Persona:** usuário com `is_ai = true`.

## 5. Fluxos

### 5.1 Cadastro de vídeo (com internet)

1. Qualquer usuário cola o link (YouTube Shorts, TikTok; Reels depois, pois costuma exigir cookies).
2. O worker baixa (yt-dlp), converte (ffmpeg), gera thumbnail e transcreve (Whisper).
3. A IA sugere tópicos e uma descrição curta a partir de título, hashtags e transcrição.
4. O usuário confirma ou ajusta os tópicos.
5. O vídeo fica **pendente** até o dono aprovar.
6. Ao aprovar: gera embedding, entra no feed e dispara as personas (comentários e reações pré-gerados).

Status do vídeo: `baixando`, `processando`, `pendente`, `aprovado`, `rejeitado`, `falhou`.

### 5.2 Feed

- Um vídeo por tela, rolagem vertical, autoplay, pré-carregamento do próximo.
- Ações: curtir, comentar, compartilhar no chat.
- Não existe galeria do acervo. O usuário só vê o que o feed entrega, e no perfil vê os que curtiu.
- A busca (quando entrar, ver 7.6) acha vídeos específicos, mas não lista o acervo: poucos resultados por busca, só os realmente parecidos, e nada com o campo vazio.
- Quando o acervo acaba: tela "você zerou a internet", e os vídeos mais antigos voltam a circular.

### 5.3 Chat

- Conversas diretas e em grupo, em tempo real.
- Mensagem de texto ou de vídeo (compartilhado do feed).
- Reação com emoji em qualquer mensagem.

## 6. Recomendação

**Sinais por visualização:** porcentagem assistida, replay, pulo rápido, curtida, comentário, compartilhamento.

**Fase 1 — afinidade por tópico:**
- Cada evento ajusta `user_topic_affinity` (sobe com vídeo assistido até o fim, curtida e compartilhamento; desce com pulo rápido).
- Próximo vídeo: sorteio ponderado pela afinidade entre os não vistos, com cerca de 20% de exploração aleatória.

**Fase 2 — embeddings:**
- Vetor de gosto do usuário = média ponderada dos embeddings dos vídeos bem avaliados.
- A pontuação final combina afinidade por tópico e similaridade vetorial.

**Acervo finito:** vídeos vistos ficam em quarentena e voltam depois de um tempo, priorizando os curtidos.

## 7. IA

### 7.1 Regras para modelo pequeno

- Uma tarefa por chamada, resposta em JSON, textos curtos.
- Frases de exemplo no prompt (o modelo imita melhor do que segue descrição).
- Decisões por pesos e embeddings sempre que possível; LLM só para gerar texto.

### 7.2 Ingestão

- Entrada: título, hashtags, transcrição.
- Saída: até 3 tópicos da lista existente, descrição de uma frase.
- Embedding do texto do vídeo para busca e recomendação.

### 7.3 Personas

Cada persona é um JSON em `personas/`, carregado na primeira subida. Qualquer pessoa pode contribuir com uma persona por pull request.

Campos: nome, avatar, bio, tom de escrita, frases de exemplo, nível de atividade, afinidade por tópico, relação com as outras personas (opcional).

Elenco inicial:

| Persona | Jeito |
|---|---|
| Tio Valdir | "Bom dia, sobreviventes" todo dia, compartilha qualquer coisa, acredita em tudo |
| Capitão Enlatado | Sobrevivencialista, relaciona tudo com estoque e racionamento |
| Dona Neide | A vó do bunker, não entende os vídeos, comenta com carinho |
| Rato | Crítico amargo, nada presta; quando curte algo é um evento |
| Kelly | Treina no bunker, transforma tudo em motivação |

O tema apocalipse aparece em uma parte pequena das falas. Na maior parte do tempo elas reagem aos vídeos como pessoas comuns.

### 7.4 Ciclo da persona

1. **Gatilho:** vídeo aprovado, mensagem recebida ou tique do agendador.
2. **JEV (decisão por pesos):** combina afinidade da persona com o tópico, nível de atividade, tempo desde a última interação com aquele contato e acaso. Saída: `ignorar`, `curtir`, `reagir`, `comentar`, `responder`, `enviar_video`.
3. **RAG (quando envia vídeo):** busca vetorial no acervo por algo que combine com a conversa e com o gosto dela.
4. **Geração:** frase curta com o prompt da persona, exemplos e resumo da memória.

**Memória:** `persona_memory` guarda um resumo curto da relação da persona com cada contato, atualizado a cada N mensagens, mais as últimas mensagens da conversa.

### 7.5 Personas entre si

- **Conversas diretas:** cada par de personas tem um chat direto, igual ao de usuários. Elas mandam vídeos uma para a outra, reagem e comentam.
- **Grupo do Bunker:** grupo com todas as personas, onde usuários também podem entrar e jogar vídeos.
- **Modo stalker:** tela somente leitura para espiar as conversas diretas entre personas, acessada pelo perfil de cada uma. Mostra apenas conversas persona–persona; conversas de usuários reais continuam privadas.

Regras para a conversa não degenerar:
1. Toda conversa nasce de um evento concreto (quase sempre um vídeo compartilhado).
2. O JEV decide quem responde e quando ninguém responde.
3. De 3 a 6 mensagens por conversa, depois silêncio até o próximo evento.
4. Prioridade na fila menor que a do chat com usuários reais, e limite por hora (`PERSONA_RATE`).

### 7.6 Ideias futuras

Ainda a elaborar, sem data para entrar:
- **Busca semântica** ("aquele vídeo do gato caindo"), no estilo da busca do TikTok: campo de busca, grade de miniaturas e o vídeo abrindo em tela cheia. Junta texto (título, descrição, tópicos e transcrição) e significado (embedding da frase comparado com os vídeos no pgvector). Com limite, para não virar galeria (5.2): uns 10 resultados por busca, só acima de uma nota mínima de semelhança.
- **Resumo do dia** no bunker, gerado pela IA.

Depois do MVP, num formato novo que ainda vai ser definido:
- Painel visual das decisões do JEV (por que a persona fez o que fez).
- Persona criada pelo usuário dentro do app.

## 8. Modelo de dados

- **users**: id, nickname, pin_hash, avatar, role (`owner` | `resident`), is_ai, created_at.
- **personas**: user_id, bio, tone, examples (json), activity_level, config (json).
- **videos**: id, source_url, platform, file_path, thumb_path, duration, title, description, transcript, embedding (vector), status, submitted_by, approved_by, created_at.
- **topics**: id, name, slug, embedding.
- **video_topics**: video_id, topic_id, source (`user` | `ai`).
- **view_events**: id, user_id, video_id, watched_ms, watch_pct, replays, skipped, created_at.
- **likes**: user_id, video_id, created_at.
- **comments**: id, video_id, user_id, text, created_at.
- **user_topic_affinity**: user_id, topic_id, score, updated_at (vale também para personas).
- **conversations**: id, type (`direct` | `group`), name, created_at.
- **conversation_members**: conversation_id, user_id.
- **messages**: id, conversation_id, sender_id, type (`text` | `video`), text, video_id, created_at.
- **message_reactions**: message_id, user_id, emoji.
- **persona_memory**: persona_user_id, contact_user_id, summary, updated_at.

## 9. Telas

1. **Entrada:** apelido + PIN.
2. **Feed:** vídeo em tela cheia, ações na lateral, comentários em gaveta.
3. **Cadastrar vídeo:** campo de link, status do processamento, tópicos sugeridos.
4. **Caixa de entrada:** lista de conversas (pessoas, personas, grupo).
5. **Chat:** mensagens, vídeos compartilhados, reações.
6. **Perfil:** avatar, apelido, vídeos curtidos. No perfil de persona: bio e modo stalker.
7. **Painel do dono:** fila de aprovação, tópicos, personas.

## 10. Sequência de desenvolvimento

1. Compose com `db`, `api`, `web`, `worker` e `ollama`, mais um endpoint de teste que conversa com o modelo.
2. Ingestão com IA: link, download, conversão, transcrição, tópicos sugeridos, fila de aprovação.
3. Feed com player vertical, mostrando comentários gerados por uma persona (Tio Valdir).
4. Apelido + PIN, curtidas, comentários de usuários, perfil.
5. Eventos de visualização e recomendação (fase 1, depois fase 2).
6. Teste em rede local com celulares pelo hotspot.
7. Chat entre usuários reais: texto, vídeo compartilhado, reações.
8. Personas completas: chat com usuários, JEV, RAG, memória, conversas diretas entre personas, Grupo do Bunker e modo stalker.
9. Polimento: HTTPS/PWA com Caddy, README, tema apocalipse, tela "você zerou a internet".

**MVP:** passos 1 a 5, com uma persona.

## 11. Pontos de atenção

- **Termos de uso:** baixar vídeos dessas plataformas fere os termos delas. O README deve deixar claro que o acervo é pessoal e que o repositório não distribui vídeos.
- **PWA em rede local:** service worker e instalação exigem HTTPS; `http://192.168.x.x` não é contexto seguro. Por isso o PWA fica para o passo 9.
- **Rede no Windows:** liberar a porta no firewall e descobrir o IP do host no hotspot. Documentar no README.
- **Qualidade do modelo pequeno em português:** validar cedo (passos 2 e 3), antes de construir o resto em cima.
- **yt-dlp quebra com frequência:** manter fácil de atualizar na imagem do worker.
- **Concorrência na LLM:** uma fila única com prioridades (chat do usuário > ingestão > personas).

## 12. Repositório e CI

- Repositório público no GitHub, licença MIT, README em português com a logo e o selo do CI.
- Commits no padrão Conventional Commits, em português.
- GitHub Actions a cada push e pull request: lint, checagem de tipos, testes e build das imagens Docker. Sem download de modelos no CI.
- Nunca versionar: `.env`, vídeos baixados, modelos e dados do banco.
- `personas/` guarda o JSON e o avatar SVG de cada persona.