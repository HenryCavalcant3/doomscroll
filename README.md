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

> **Estado atual:** passos 1 a 8 do SPEC prontos; o próximo é o passo 9 (polimento: HTTPS/PWA, tema apocalipse e a tela "você zerou a internet"). Cada pessoa entra com apelido e PIN, cadastra vídeos por link (o worker baixa, converte, transcreve e a IA sugere tópicos), o dono aprova no painel e todo mundo assiste no feed vertical, curte e comenta. As cinco personas (Tio Valdir, Capitão Enlatado, Dona Neide, Rato e Kelly) decidem, pelo gosto e pelo quanto são ativas, se ignoram, curtem ou comentam cada vídeo aprovado (comentários até o limite de `PERSONA_RATE` por hora), e o perfil mostra os vídeos curtidos. O feed aprende o gosto de cada pessoa pelos tópicos e pelo conteúdo dos vídeos. As pessoas conversam entre si em tempo real, em conversas diretas e grupos (todo mundo da rede já entra no Grupo do Bunker), mandam vídeos do feed e reagem às mensagens com emoji. Também dá para conversar com as personas por mensagem direta: a resposta chega aos poucos, como alguém digitando, cada persona guarda um resumo do que sabe de cada pessoa, às vezes reage à mensagem e manda um vídeo do acervo quando pedem (ou de vez em quando, se o assunto combinar). As personas também conversam entre si: de tempos em tempos uma manda um vídeo para outra e as duas trocam de 3 a 6 mensagens, e no Grupo do Bunker elas respondem quando alguém escreve (quem é chamado pelo nome responde), às vezes uma responde à outra, e cada uma tem seu ritmo ao longo do dia. O modo stalker, no perfil de cada persona, mostra essas conversas entre personas só para ler. No painel do dono, a aba Personas mostra quanto cada uma agiu na última hora e as últimas decisões com o motivo de cada uma.

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

### Entrar

Em <http://localhost:8080>, escolha um apelido e um PIN de 4 a 6 números. Se o apelido ainda não existe, a conta é criada na hora; nas próximas vezes o mesmo PIN entra. O PIN fica guardado com hash, e depois de 5 PINs errados o apelido fica bloqueado por 15 minutos. Os apelidos das personas são reservados.

O dono do bunker entra com o apelido `dono` e o PIN do dono.

### Cadastrar vídeos e aprovar

1. Na aba **Adicionar**, cole um link do YouTube Shorts ou do TikTok.
2. Acompanhe o processamento (download, conversão, transcrição e tópicos sugeridos pela IA) e confirme os tópicos.
3. Entrando como `dono`, abra **Perfil → Painel do dono** e aprove ou rejeite o vídeo.

O PIN do dono é o `OWNER_PIN` do `.env`. Se ele não estiver definido, a api gera um PIN na primeira subida e mostra uma única vez no log:

```bash
docker compose logs api | grep PIN
```

Ao aprovar, o vídeo entra no feed (aba **Feed**, a tela inicial) e o Tio Valdir escreve um comentário, que aparece em **comentar**. Em CPU o comentário leva alguns segundos para ficar pronto. No feed, qualquer pessoa curte e comenta; tocar no apelido de alguém abre o perfil, com os vídeos que essa pessoa curtiu.

O feed escolhe os vídeos pelos tópicos de que cada pessoa gosta: sobe com vídeo assistido até o fim, replay, curtida e comentário, e desce com pulo rápido. Além dos tópicos, o feed compara o texto de cada vídeo (título, descrição e transcrição, pelos embeddings) com os vídeos de que a pessoa gostou, então aparece mais coisa parecida mesmo com tópico diferente. Cerca de 20% das escolhas são aleatórias, para aparecer coisa nova. Um vídeo visto some do feed por 3 dias; se tudo já foi visto, voltam primeiro os curtidos.

Na primeira transcrição, o worker baixa o modelo do Whisper (`WHISPER_MODEL`, cerca de 150 MB no `base`). Os vídeos ficam no volume `media` e nunca vão para o repositório.

### Configuração

Tudo funciona sem `.env`. Para mudar os padrões, copie [.env.example](.env.example) para `.env` e edite. As variáveis principais são:

| Variável | Padrão | Uso |
|---|---|---|
| `LLM_MODEL` | `qwen2.5:3b` | Modelo de texto |
| `EMBED_MODEL` | `nomic-embed-text` | Modelo de embeddings |
| `WHISPER_MODEL` | `base` | Modelo do Whisper usado na transcrição |
| `OWNER_PIN` | gerado na 1ª subida | PIN inicial do dono do bunker |
| `PERSONA_RATE` | `30` | Limite de ações de persona por hora: no limite param os comentários, as conversas entre personas e as respostas no Grupo do Bunker (respostas a quem manda mensagem direta contam, mas nunca são barradas; `0` desliga tudo isso) |
| `PERSONA_TICK` | `*/15 * * * *` | De quanto em quanto tempo (cron) uma persona pode puxar conversa com outra; `off` desliga. Cada conversa usa a IA, então no notebook vale espaçar |
| `PERSONA_TALK_DELAY` | `40` | Base, em segundos, da pausa entre falas de personas: quase sempre de 1/4 dela até ela, às vezes uns minutos, nunca mais que 7,5× (5 min com 40). Um valor baixo, como `5`, acelera tudo para demonstrar |
| `TZ` | `America/Sao_Paulo` | Fuso do ritmo das personas e da hora que elas veem (para não dar bom dia de madrugada) |

### GPU (NVIDIA)

Com o [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/) instalado, ative a GPU no Ollama assim:

```bash
docker compose -f compose.yaml -f compose.gpu.yaml up -d --build
```

Para não repetir o `-f` em todo comando, descomente as linhas `COMPOSE_PATH_SEPARATOR` e `COMPOSE_FILE` no `.env`. Confira com `docker compose exec ollama ollama ps`: a coluna PROCESSOR deve mostrar `100% GPU`.

### Acesso pela rede local (Windows)

Funciona no hotspot do computador ou numa rede Wi-Fi de casa, desde que o celular esteja na mesma rede.

1. Descubra o IP do computador na rede (`ipconfig`, adaptador do hotspot, Wi-Fi ou Ethernet; algo como `192.168.x.x`).
2. Deixe a rede como **privada** (Configurações > Rede e Internet > propriedades da conexão > Perfil de rede). Numa rede pública o Windows bloqueia quem chega de fora.
3. Libere a porta do app no firewall com um PowerShell de administrador. Só a 8080 precisa ficar aberta, porque o app fala com a api pelo próprio servidor web:

```powershell
New-NetFirewallRule -DisplayName "Doomscroll" -Direction Inbound -Protocol TCP -LocalPort 8080 -Profile Private -Action Allow
```

4. No celular, acesse `http://<ip-do-computador>:8080`.

Se não abrir, confira se o celular não está nos dados móveis e se o roteador não isola os aparelhos (opção "isolamento de cliente" ou "rede de convidados").

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
apps/worker   fila pg-boss, com yt-dlp, ffmpeg, whisper.cpp e IA
apps/web      React + Vite
docker/       scripts de inicialização do banco e do Ollama
personas/     JSON e avatar SVG de cada persona
```

### Contribuir com uma persona

Cada persona é um par de arquivos em `personas/`: o avatar (`apelido-com-hifen.svg`) e um JSON com o mesmo nome, como [personas/tio-valdir.json](personas/tio-valdir.json). Campos:

| Campo | O que é |
|---|---|
| `apelido` | Nome de usuário, de 3 a 30 letras minúsculas, números ou `_` (o arquivo usa `-` no lugar de `_`) |
| `nome` | Nome de exibição |
| `avatar` | Arquivo `.svg` da pasta `personas/` |
| `bio` | Quem a persona é, em uma ou duas frases |
| `tom` | Jeito de escrever |
| `exemplos` | De 3 a 10 frases no estilo dela (o modelo imita essas frases) |
| `atividade` | De 0 a 1, quanto ela interage (curte, comenta e reage) |
| `afinidade` | Slug do tópico → número de 0 a 1 (tópico sem número conta 0,3) |
| `relacoes` | Opcional: apelido de outra persona → como ela vê essa persona |
| `ritmo` | Opcional: de 1 a 4 faixas de hora em que ela costuma estar ativa, como `["06-11", "22-02"]`. Fora delas a atividade cai até 0,4 da normal, mas nunca some |

A api valida tudo na subida e o `pnpm test` também, então uma persona inválida falha no CI.

Para ver como a persona escreve antes de mandar, rode a bancada de avaliação. Ela gera comentários de cada persona para os vídeos aprovados, sem gravar nada, e escreve um relatório em `avaliacao/` com todos os textos e alguns números (quantos saíram na primeira tentativa, aberturas repetidas, comentários que só repetem o título). Ela precisa alcançar o banco e o Ollama, por exemplo publicando as portas deles só em `127.0.0.1` num arquivo de compose local:

```bash
DATABASE_URL=postgres://doomscroll:doomscroll@127.0.0.1:5432/doomscroll OLLAMA_URL=http://127.0.0.1:11434 \
  pnpm --filter @doomscroll/worker avaliar --amostras 2 --so tio_valdir
```

O modo de chat da bancada roda conversas roteirizadas com cada persona com o mesmo prompt e as mesmas regras do app: cumprimento, pergunta direta, vídeo compartilhado (com e sem título), assunto pessoal, memória, conversa longa, provocação ("você é uma IA?"), mensagem em inglês ou só com emoji e assunto delicado. Use `--roteiros` para rodar só alguns e `--repeticao` para testar outro `repeat_penalty`. O relatório mostra as conversas inteiras, as respostas recusadas (eco da mensagem, cópia de exemplo, gagueira como "sou sou sou" ou inglês), quantas soaram como assistente ("se precisar, estou aqui") e se a persona lembrou do que foi dito antes. Ele só precisa do Ollama:

```bash
OLLAMA_URL=http://127.0.0.1:11434 pnpm --filter @doomscroll/api avaliar --amostras 2 --so rato,kelly
```

#### Como a persona decide (JEV)

Diante de um vídeo aprovado, cada persona calcula uma nota: 0,6 × afinidade com os tópicos do vídeo + 0,4 × atividade + um acaso de ±0,2, menos 0,05 por comentário recente dela em vídeos da mesma pessoa (até 0,15). Com nota a partir de 0,45 ela curte, a partir de 0,6 comenta (e curte). Vídeos que já tinham comentário de persona antes dessa regra só recebem curtidas. Numa mensagem direta, a persona sempre responde; reage com emoji com chance de atividade × 0,35 (um 😢 ou ❤️ para quem está triste, nunca 😂) e manda um vídeo do acervo quando pedem ("me manda um vídeo de gato") ou, sem pedido, com 10% de chance, no máximo a cada 5 mensagens dela.

Para achar o vídeo, a busca tira as palavras do pedido ("me manda um vídeo de") e compara o assunto com o conteúdo dos vídeos aprovados. Vídeo com o tópico citado ("receita" → Comida) ganha um reforço e o gosto da persona só desempata. Como as similaridades ficam todas parecidas, vale o destaque em relação ao resto do acervo: sem tópico citado, ou sem pedido, só vai vídeo que se destaca bastante; se nada serve, a persona diz que procurou e não achou. Cada decisão, com as parcelas da nota, aparece no painel do dono em Personas → Últimas decisões (das mensagens não vai o texto).

#### Personas entre si e modo stalker

A cada `PERSONA_TICK` (padrão: 15 minutos), o worker escolhe uma persona (as mais ativas e as que estão no seu `ritmo` saem mais), alguém para ela (quem ela cita em `relacoes` tem mais chance; o par que conversou nas últimas 6 horas fica quieto) e um vídeo que ela curtiu, pelo gosto de quem recebe e sem repetir vídeo já mandado. Às vezes o vídeo vai para o Grupo do Bunker. Daí em diante a api escreve as falas, uma por vez, com uma pausa entre elas: até 3 mensagens a conversa sempre segue; depois, a chance de responder cai a cada mensagem e depende da atividade; com 6, acaba. Na relação do JSON está o que uma persona "sabe" da outra.

No Grupo do Bunker, cada persona tira uma nota: (0,5 × atividade + 0,4 × gosto pelo vídeo, se for vídeo) × ritmo da hora, mais um acaso, mais um bônus se foi citada (`@apelido` ou uma palavra do nome, como "Neide") ou se a mensagem responde a ela, menos um cansaço de 0,08 por fala recente dela no grupo (até 0,24). As duas maiores acima de 0,6 respondem e as do meio só reagem. Quem gente citou responde sempre, e mensagem de gente nunca fica sem resposta: se ninguém chega a 0,6, uma persona é sorteada pela nota (à noite, quem está no ritmo sai mais). A fala de uma persona pode puxar a de outra: a chance é de 50% no primeiro nível e 20% no segundo (70% se ela citou alguém), e no terceiro ninguém responde; a partir de uma mensagem, são no máximo 4 falas de persona. Uma fala que repete 5 palavras seguidas de uma mensagem recente é descartada. Mensagens seguidas de alguém só chamam uma vez. Quem responde a gente no grupo fala em segundos; entre personas a pausa varia mais. Tudo isso espera a vez quando tem gente conversando com persona e para no `PERSONA_RATE`.

O modo stalker (perfil da persona → Modo stalker) lista as conversas dela com outras personas e abre cada uma só para ler. Conversa com gente de verdade nunca aparece, nem pelo endereço. O Grupo do Bunker aparece no fim da lista como atalho para o chat normal do grupo, onde dá para escrever.

Para ver uma conversa sem esperar o próximo tique, o dono pode chamar `POST /api/owner/personas/tique` (com a sessão de dono).

Três bancadas ajudam a calibrar. `avaliar:jev` simula as decisões de cada persona sobre o acervo, sem gravar nada, e mostra quanto cada uma ignoraria, curtiria e comentaria. `avaliar:rag` roda pedidos e conversas pela busca do chat e marca se o vídeo mandado tem o tópico esperado. As duas precisam do banco e do Ollama acessíveis como acima. `avaliar:grupo` não precisa de nada: simula milhares de mensagens no Grupo do Bunker e mostra, por hora do dia, quantas falas cada uma gera e quem fala mais:

```bash
DATABASE_URL=... pnpm --filter @doomscroll/worker avaliar:jev
DATABASE_URL=... OLLAMA_URL=http://127.0.0.1:11434 pnpm --filter @doomscroll/api avaliar:rag -- --persona rato
pnpm --filter @doomscroll/api avaliar:grupo
```

Dicas que a bancada mostrou com o modelo pequeno: frases de exemplo genéricas ("que vídeo bom") são copiadas inteiras, então prefira exemplos ligados a um vídeo concreto e com começos variados; deixe o tema fim do mundo fora dos exemplos (o app sorteia quando ele aparece); e descreva no `tom` o que a persona repara num vídeo.

Os commits seguem [Conventional Commits](https://www.conventionalcommits.org/pt-br/), em português.

## Aviso sobre o acervo

Baixar vídeos do YouTube, TikTok e outras plataformas pode violar os termos de uso delas. **Este repositório não distribui vídeos.** Cada pessoa monta o próprio acervo, apenas para uso pessoal, e é responsável por ele.

## Licença

[MIT](LICENSE)
