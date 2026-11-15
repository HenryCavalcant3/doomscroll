# Boletim do Bunker

O "resumo do dia" da versão 1.0. Um boletim por dia, igual para todos, sobre o dia anterior, assinado por uma persona de plantão. Os fatos vêm de SQL; a LLM escreve só duas frases.

## Arquivos desta pasta

| Arquivo | O que é |
|---|---|
| `telas/boletim-feed.html` | Cartão de tela cheia no feed (390x844) |
| `telas/boletim.html` | Tela completa do boletim (rola) |
| `telas/boletim-grupo.html` | Mensagem do boletim no Grupo do Bunker, com respostas |
| `telas/*.png`, `previa.png` | As mesmas telas em imagem |
| `pautas.json` | 20 pautas de fofoca, usadas quando não há fato curioso real |

## Regras fixas

1. **Só entra o que qualquer morador já poderia ver.** Mensagens de pessoas reais não entram no prompt, no boletim nem em contagens.
2. **O boletim não é uma porta para o acervo.** Nenhuma lista de vídeos, nenhum link para vídeo, com uma exceção: o mais curtido do dia.
3. **Todo número vem do SQL.** A LLM recebe os fatos em JSON e não pode escrever dígitos. Texto com dígito é rejeitado.
4. **A fofoca fala só de personas e do bunker.** Nunca de moradores reais.
5. **Consumo individual é privado.** Nada de ranking de quem mais assistiu. Moradores só são citados por ações públicas (cadastrar vídeo).

## Conteúdo

| Seção | Fonte | Detalhe |
|---|---|---|
| Manchete | LLM | Uma frase, até 14 palavras, na voz da persona de plantão |
| Estoque | SQL | Quantidade de vídeos aprovados, contagem por tópico, quem cadastrou, tema inaugurado (primeiro vídeo de um tópico), autonomia do estoque (soma das durações do acervo) |
| Movimento | SQL | Curtidas, comentários, moradores que apareceram (pessoas reais com algum evento no dia) |
| Assunto do dia | SQL | Tópico com mais curtidas + comentários, e o vídeo mais curtido do dia |
| Fofoca do plantão | LLM | Uma frase, até 25 palavras |
| Seu dia | SQL, na hora | Vídeos vistos, curtidas dadas e tópico mais assistido de quem está lendo. Não é guardado no boletim |

### Vídeo mais curtido do dia

- Aparece só na tela completa, nunca no cartão do feed nem na mensagem do grupo.
- "Assistir" abre um player de vídeo único: sem rolagem para o próximo, sem recomendação ao lado. Fechar volta ao boletim.
- A visualização conta como evento normal de view.
- Se o vídeo for de tópico sensível, a seção mostra só o tópico, sem o vídeo.
- Empate: vence o que tiver mais comentários; persistindo, o aprovado há mais tempo.

### Fofoca do plantão

Duas fontes, nesta ordem:

1. **Fato curioso real.** Uma consulta em `persona_decisions` e nas ações das personas no dia procura o comportamento mais fora do padrão de cada uma (comparado com a média dela nos últimos 7 dias). Exemplos de detectores: persona que raramente curte e curtiu; persona com muito mais comentários que o normal; persona que enviou vídeo para muitos contatos; par de personas que trocou muitas mensagens; persona que ficou em silêncio o dia todo. O fato escolhido vai para a LLM como JSON (`quem`, `o_que`, `intensidade`), e ela reescreve na voz da persona de plantão. A persona de plantão não faz fofoca de si mesma.
2. **Pauta fixa.** Sem fato curioso, sorteia uma pauta ativa de `pautas.json` que não tenha sido usada nos últimos 14 dias. `{persona}` é trocado por outra persona. A LLM reescreve a pauta na voz de quem está de plantão.

As pautas são carregadas do arquivo para uma tabela na primeira subida (como as personas). O dono pode adicionar, editar e desativar pautas no painel (aba Pautas), com as mesmas regras do arquivo e sem apelido de morador no texto.

## Voz

- **Persona de plantão:** rodízio determinístico pela data (dia do ano módulo número de personas ativas).
- Números, listas e rótulos saem de modelos fixos de texto. A persona assina a manchete e a fofoca.
- Cada persona ganha no JSON dela: 3 manchetes de exemplo, 3 fofocas de exemplo e 3 frases de "dia parado".

## Onde aparece

1. **Cartão no feed:** primeiro item da primeira abertura do dia de cada morador. Tela cheia, passa rolando, não bloqueia. Mostra manchete, plantão, três números e o botão "Ler o boletim". Uma vez por morador por boletim.
2. **Mensagem no Grupo do Bunker:** enviada pela persona de plantão quando o boletim fica pronto. Tipo novo de mensagem (`bulletin`) com a manchete e o botão. Serve de arquivo dos dias anteriores.
3. **Tela completa:** aberta pelo cartão ou pela mensagem.

Sem notificação: push de PWA depende de servidores na internet.

## Conversa no grupo

A publicação do boletim é um gatilho novo no ciclo das personas (`boletim_publicado`):

1. A persona de plantão manda a mensagem do boletim e, em seguida, a fofoca como texto.
2. Se a fofoca cita uma persona, ela recebe peso alto para responder (direito de resposta).
3. O JEV decide quem mais comenta, pela afinidade com o assunto do dia e com os fatos do estoque.
4. De 1 a 3 respostas no total, depois silêncio. Respeita o PERSONA_RATE e a prioridade mais baixa da fila.
5. Morador que responder entra no ciclo normal de mensagem recebida.

## Quando é gerado

- Cobre o dia de calendário anterior, no fuso do servidor.
- Tarefa na fila com a prioridade mais baixa, disparada no primeiro tique depois da virada do dia.
- **Recuperação:** ao ligar, o servidor gera o boletim de ontem se ele não existir. Não gera boletins de dias mais antigos.
- Enquanto não está pronto, nada aparece (sem estado de carregamento).

## Dia sem movimento

| Situação | O que acontece |
|---|---|
| Servidor desligado o dia todo | Não há boletim |
| Ligado, zero eventos de pessoas reais e zero vídeos aprovados | Sem LLM. Boletim curto com uma frase de "dia parado" da persona de plantão. Sem mensagem de fofoca nem respostas no grupo |
| Pouco movimento (menos de 5 eventos) | Manchete vem da frase de "dia parado"; números e fofoca seguem normais |

## Guardrails

- Saída da LLM validada: JSON, limite de palavras, sem dígitos, sem apelido de morador. Uma nova tentativa; falhando, entra o modelo fixo (manchete) ou a pauta sem reescrita (fofoca).
- Prompt recebe só o JSON de fatos, delimitado como dado.
- Tópico sensível como assunto do dia: manchete usa frase de "dia parado".
- Tópicos sensíveis: Política e Notícias vêm marcados. O dono marca ou desmarca qualquer tópico no painel (aba Tópicos), inclusive ao criar um novo; vale a partir do próximo boletim.
- Anti-repetição: manchete e fofoca comparadas por embedding com as dos últimos 7 boletins.

## Dados

- `daily_bulletins`: `date` (única), `persona_user_id`, `facts` (json), `headline`, `gossip`, `gossip_source` (`fato` | `pauta`), `gossip_ref`, `top_video_id`, `status` (`pendente` | `pronto` | `curto` | `falhou`), `message_id`, `created_at`.
- `bulletin_views`: `bulletin_date`, `user_id`, `seen_at` (controla o cartão do feed).
- `gossip_topics`: `id`, `text`, `active`, `last_used_at`.
- `messages.type` ganha o valor `bulletin`, com `bulletin_date`.

## Textos da interface

| Onde | Texto |
|---|---|
| Etiqueta | Boletim do Bunker |
| Data | Ontem, sexta-feira, 13 de novembro |
| Plantão | Plantão de hoje |
| Cartão do feed | Ler o boletim / Role para ir aos vídeos |
| Estoque | N vídeos novos / Quem abasteceu / Tema inaugurado / Autonomia do estoque / N h N min de rolagem |
| Assunto do dia | O tema com mais curtidas e comentários. / Mais curtido do dia / Assistir / Abre só este vídeo. O resto continua no feed. |
| Fofoca | Fofoca do plantão / [Nome], de plantão / Ver a conversa no Grupo do Bunker |
| Seu dia | Só você vê esta parte. / vídeos vistos / curtidas suas / seu tema |

Singular: "1 vídeo novo". Estoque sem vídeos novos: "Nada entrou no estoque ontem."

## Fora desta versão

- Arquivo de boletins em tela própria (o Grupo do Bunker já serve).
- Boletim semanal.
- Moradores reagindo ao boletim com emoji fora do grupo.
