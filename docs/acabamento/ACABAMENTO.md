# Doomscroll: acabamento visual e de texto

## Arquivos

| Arquivo | O que é |
|---|---|
| `telas/zerou-a-internet.html` | Card de tela cheia no meio do feed, ao fim de cada volta do acervo |
| `telas/sem-sinal.html` | Tela do PWA quando o servidor não responde |
| `telas/certificado.html` | Página HTTP com o passo a passo do certificado (rola; as outras têm 390x844 fixos) |
| `telas/entrada.html` | Entrada com apelido + PIN |
| `telas/carregando.html` | Carregamento de tela cheia |
| `icones/icon.svg` + `icon-192.png`, `icon-512.png` | Ícone padrão, cantos arredondados, fundo transparente fora do quadrado |
| `icones/icon-maskable.svg` + PNGs | Fundo #141414 até a borda, barata dentro dos 80% centrais |
| `icones/apple-touch-icon.svg` + `.png` | 180 px, sem transparência, sem cantos (o iOS arredonda) |
| `icones/favicon.svg` | Mesmo desenho do `docs/logo.svg` novo |

As telas usam `font-family: 'Space Grotesk'` sem carregar a fonte: o app já a serve localmente.
Todas as animações são CSS puro e param com `prefers-reduced-motion`.

Manifesto sugerido:

```json
"icons": [
  { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
  { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
  { "src": "/icons/icon-maskable-192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable" },
  { "src": "/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
]
```

## Elementos de tema usados nas telas

- **A barata** é a mascote: aparece em toda tela de estado (fim, sem sinal, carregando, entrada), nunca em telas de uso (feed, chat).
- **Faixa de perigo** amarela e preta, de 10 px, só no topo das telas de "portaria": entrada, certificado e fim do acervo.
- **Parafusos** nos quatro cantos do cartão de entrada, para ele parecer a porta do bunker.
- **Radar** com pulso na tela sem sinal; **anel tracejado girando** na tela de fim do acervo.
- **Barra de carregamento** com a própria faixa de perigo andando.

## Microtextos

| Onde | Texto atual | Proposta |
|---|---|---|
| Carregamento de tela cheia | Carregando… | Abrindo o bunker… |
| Carregamento dentro de uma tela (lista, comentários) | Carregando… | Carregando… (fica como está) |
| Erro genérico | Algo deu errado. | Deu ruim aqui no bunker. Tente de novo. |
| Erro de rede | Não deu para falar com o bunker. Confira a rede e tente de novo. | O bunker não respondeu. Confira se este aparelho está na rede dele e tente de novo. |
| Feed vazio, título | O bunker ainda está vazio | As prateleiras estão vazias |
| Feed vazio, texto | Nenhum vídeo foi aprovado ainda. Mande o primeiro! | Nenhum vídeo foi aprovado ainda. Mande o primeiro para o estoque. |
| Sem comentários | Ninguém comentou ainda. Seja o primeiro! | Silêncio no bunker. Comente antes do Tio Valdir. |
| Sem conversas | Nenhuma conversa ainda. Abra o perfil de alguém ou digite um apelido acima. | Ninguém no rádio ainda. Abra o perfil de alguém ou digite um apelido acima. |
| Fila de aprovação vazia | Nada esperando aprovação. | Fila zerada. Nenhum vídeo esperando na porta. |
| Curtidos vazio | Os vídeos que você curtir aparecem aqui. | Seu estoque particular começa aqui. Os vídeos que você curtir ficam guardados nesta aba. |
| Slogan da entrada | Vídeos curtos para o fim do mundo. | Vídeos curtos para o fim do mundo. (fica como está) |

Textos novos que aparecem nas telas:

| Onde | Texto |
|---|---|
| Fim do acervo | Você zerou a internet. / Pelo menos a parte que coube no bunker. / N vídeos vistos nesta volta / Role para continuar / Os vídeos voltam a circular a partir daqui. |
| Sem sinal | Sem sinal do bunker / O app não encontrou o servidor. Ele pode estar desligado, ou este aparelho saiu da rede do bunker. / Tentar de novo / Suas curtidas e conversas continuam guardadas no bunker. |
| Entrada | Quem vem lá? / Como te chamam por aqui / Bunker no ar / Primeira vez por aqui? Escolha um apelido e um PIN. Sua vaga no bunker é criada na hora. |
| Carregando | Abrindo o bunker… / Destrancando a escotilha |

Observações:

- "Seja o primeiro!" saiu por ter gênero. A proposta nova é neutra.
- Com 1 vídeo, o contador vira "1 vídeo visto nesta volta".
- O slogan fica porque já está na logo e é a melhor frase do projeto.

## Regra do tema

1. **O apocalipse mora nos intervalos.** Ele entra em telas e textos de estado: vazio, carregando, erro, fim e boas-vindas. Não entra onde a pessoa está fazendo algo.
2. **Ação é sempre literal.** Botões, rótulos de campo, navegação e confirmações usam o verbo direto: Entrar, Curtir, Enviar, Tentar de novo, Baixar certificado.
3. **Instrução é sempre literal.** Tudo que a pessoa precisa seguir (passo a passo, o que conferir) vem em português claro. O tema fica no título e na ilustração da mesma tela.
4. **Uma piada por tela, no título ou no subtítulo.** O texto logo abaixo explica o que aconteceu de verdade.
5. **Vocabulário fixo:** bunker (servidor e rede), moradores (usuários), estoque e prateleiras (acervo), porta (aprovação), rádio (mensagens), escotilha (carregamento). Nada de morte, guerra ou tragédia real.
6. **Visual:** barata, faixa de perigo e parafusos são os três únicos enfeites. Só amarelo sobre preto, sem cor nova.

## Opcionais (fogem das regras ou do escopo)

- **Linha de persona no fim do acervo:** "Tio Valdir já está na terceira volta." Opcional porque depende de um dado novo (voltas por persona) e põe uma segunda piada na tela, contra a regra 4.
- **Dia no bunker na entrada:** "Dia 12 no bunker", contando desde a primeira subida do servidor, no lugar de "Bunker no ar". Opcional porque exige um dado novo da API.
- **Barata atravessando a barra de carregamento:** a mascote anda pela barra em vez de só balançar. Opcional porque é a animação mais pesada do conjunto para celular simples.
- **Cor de erro:** não há vermelho na paleta, então erros usam borda tracejada e texto. Se quiser uma cor de erro dedicada, ela seria uma exceção à regra "só amarelo sobre preto".

## A conferir em aparelho real

Os nomes dos menus de certificado no Android e no iPhone mudam entre versões e marcas. Vale seguir o passo a passo uma vez em cada sistema antes de publicar.
