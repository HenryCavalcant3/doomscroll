<p align="center">
  <img src="docs/logo.svg" alt="Doomscroll" width="160">
</p>

<h1 align="center">Doomscroll</h1>

<p align="center"><strong>Vídeos curtos para o fim do mundo.</strong></p>

<p align="center">
  <a href="https://github.com/HenryCavalcant3/doomscroll/actions/workflows/ci.yml"><img src="https://github.com/HenryCavalcant3/doomscroll/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
</p>

Doomscroll é um app no estilo TikTok/Reels/Shorts que funciona **100% sem internet**, em rede local, com amigos de IA rodando em um LLM local.

Um computador roda tudo (backend, frontend, banco e IA) e compartilha uma rede local, por exemplo um hotspot. Celulares e outros computadores na mesma rede acessam pelo navegador. Você monta o acervo de vídeos **com internet** (cadastrando links) e assiste **sem internet**. No feed, personas de IA como o Tio Valdir, o Capitão Enlatado, a Dona Neide, o Rato e a Kelly comentam, curtem e trocam vídeos entre si.

É um projeto open source, meio meme, meio laboratório de rede social com IA local. A especificação completa está em [SPEC.md](SPEC.md).

> **Estado atual:** passo 1 do SPEC. A infraestrutura sobe com o Docker Compose e há um endpoint de teste que conversa com o modelo. Feed, ingestão e personas ainda não existem.

## Como rodar

Pré-requisitos: [Docker](https://docs.docker.com/get-docker/) com Docker Compose e cerca de 8 GB de RAM livres.

```bash
docker compose up -d --build
```

Na primeira subida, o serviço `ollama` baixa os modelos definidos em `LLM_MODEL` e `EMBED_MODEL`, cerca de 2,2 GB no total. Essa é a única etapa que precisa de internet. Para acompanhar:

```bash
docker compose logs -f ollama
```

Quando o `ollama` aparecer como `healthy` em `docker compose ps`:

- Frontend: <http://localhost:8080>
- API: <http://localhost:3000/health>
- Teste da IA:

```bash
curl -X POST http://localhost:3000/ai/teste -H "Content-Type: application/json" -d '{"prompt":"Dê bom dia aos sobreviventes do bunker."}'
```

A primeira resposta pode levar até um minuto em CPU, porque o modelo precisa ser carregado na memória.

### Configuração

Tudo funciona sem `.env`. Para mudar os padrões, copie [.env.example](.env.example) para `.env` e edite. As variáveis principais são:

| Variável | Padrão | Uso |
|---|---|---|
| `LLM_MODEL` | `qwen2.5:3b` | Modelo de texto |
| `EMBED_MODEL` | `nomic-embed-text` | Modelo de embeddings |
| `WHISPER_MODEL` | `base` | Transcrição (a partir do passo 2) |
| `OWNER_PIN` | — | PIN inicial do dono do bunker |
| `PERSONA_RATE` | `30` | Limite de ações de persona por hora |

### GPU (NVIDIA)

Com o [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/) instalado, ative a GPU no Ollama assim:

```bash
docker compose -f compose.yaml -f compose.gpu.yaml up -d --build
```

### Acesso pela rede local (Windows)

1. Descubra o IP do computador na rede (`ipconfig`, adaptador do hotspot ou Wi-Fi).
2. Libere as portas no firewall com um PowerShell de administrador:

```powershell
New-NetFirewallRule -DisplayName "Doomscroll" -Direction Inbound -Protocol TCP -LocalPort 8080,3000 -Action Allow
```

3. No celular, acesse `http://<ip-do-computador>:8080`.

## Desenvolvimento

Requer Node.js 24 e pnpm.

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Estrutura:

```
apps/api      Fastify (HTTP + WebSocket)
apps/worker   fila pg-boss, com yt-dlp e ffmpeg
apps/web      React + Vite
docker/       scripts de inicialização do banco e do Ollama
personas/     avatares e configuração das personas
```

Os commits seguem [Conventional Commits](https://www.conventionalcommits.org/pt-br/), em português.

## Aviso sobre o acervo

Baixar vídeos do YouTube, TikTok e outras plataformas pode violar os termos de uso delas. **Este repositório não distribui vídeos.** Cada pessoa monta o próprio acervo, apenas para uso pessoal, e é responsável por ele.

## Licença

[MIT](LICENSE)
