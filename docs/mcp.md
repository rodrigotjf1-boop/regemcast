# MCP do RegemCast: a porta para outros produtos da DMS

O RegemCast tem um endereço MCP (Model Context Protocol) por onde outro produto
do grupo lê números da conta e pede ações. O primeiro consumidor é o **Liame**.

- **Endereço:** `POST {API}/api/v1/mcp` (em produção, `https://castapi.dmsregem.com/api/v1/mcp`).
- **Credencial:** token de integração por conta, no cabeçalho `Authorization: Bearer rct_it_…`.
- **Protocolo:** especificação MCP **2026-07-28**, sem estado. Clientes da
  geração 2025 (com `initialize`) são atendidos no mesmo endereço, também sem
  estado. `GET` e `DELETE` respondem 405.
- **Pacote:** `@modelcontextprotocol/server` 2.3.0 (SDK oficial, v2), em
  CommonJS, fixado na versão exata.

## Decisões

1. **MCP só para integração entre produtos da DMS** (dono, 02/10/2026). O
   assistente próprio e a ligação com a IA do lojista (Claude, ChatGPT) saíram
   da fila. O MCP não gasta IA nossa: quem consome é quem paga os tokens.
2. **MCP do RegemCast agora, hub depois** (dono, 02/10/2026). O desenho da DMS
   (Liame, ADR-008) põe cada produto atrás de um hub central com login único, e
   dizia "enquanto o hub não existir, nada de MCP em produção". Esta decisão
   emenda essa regra para o RegemCast: a porta existe já, com uma credencial
   provisória. Quando o hub e o login único existirem, **troca-se a porta e as
   ferramentas ficam** — os nomes, os escopos e a auditoria são os mesmos.
3. **Primeiro consumidor: Liame.**
4. **O que a integração pode fazer:** ler, criar rascunho e **disparar** — o
   disparo só para **produto da DMS**; cliente de fora do grupo nunca recebe
   essa permissão (dono, 02/10/2026).

## O token de integração (migration 043)

Tabela `integracao_token`. Regras em `integracao/integracao.regras.ts`.

- **Vale para uma conta.** Quem chega não diz de que conta é: o token diz.
- **Só o hash é guardado** (sha-256). O token em claro aparece uma vez, na
  resposta da emissão, e não dá para ler de novo. Perdeu, revoga e emite outro.
- **Formato:** `rct_it_` + 43 caracteres (32 bytes de acaso, base64url). A tela
  mostra só o começo (`rct_it_ab12cd34…`).
- **Classe:** `dms` (produto do grupo) ou `externo` (cliente de fora).
- **Escopos:** a lista do que o token pode fazer. O catálogo está no código, com
  a frase que o dono da conta lê.
- **Quem emite:** a distribuição, no console (aba "Integrações (MCP)"), e grava
  o token direto no cofre do produto. O usuário não manuseia segredo.
- **Quem revoga:** a distribuição, ou o **dono da conta** em Integrações →
  "Aplicativos conectados". O token para de valer na chamada seguinte.
- **Auditoria:** emissão e revogação ficam na trilha da conta e no livro de
  acessos do console. Nenhum dos dois guarda o token. O que o aplicativo
  **faz** com o token sai na trilha da conta com o autor `integracao` (seção
  "Rascunhos").

### Escopos

| Escopo | Libera | Classe |
| --- | --- | --- |
| `conta.ler` | se a conta pode enviar agora, o plano e o uso do ciclo | qualquer |
| `campanhas.ler` | campanhas, andamento, falhas por motivo e custo na Meta | qualquer |
| `publicos.ler` | contagem de públicos e listas, sem nome e sem telefone | qualquer |
| `modelos.ler` | modelos, situação na Meta e categoria | qualquer |
| `orcamento.ler` | tetos de gasto e quanto já saiu | qualquer |
| `conversas.anuncio.ler` | conversas abertas por anúncio, com o telefone, **sem conteúdo** | qualquer |
| `modelos.rascunhar` | criar rascunho de modelo (não envia à Meta) | qualquer |
| `campanhas.rascunhar` | montar campanha em rascunho (não dispara) | qualquer |
| `campanhas.disparar` | disparar campanha montada, dentro do orçamento | **só `dms`** |

A trava do disparo está em três lugares: na emissão (cliente de fora com
disparo é recusado), na leitura do token (escopo guardado no banco que a classe
não pode ter não vira permissão) e na ferramenta.

## A porta

`mcp.controller.ts` → `IntegracaoGuard` → `mcp.servidor.ts`.

1. **O portão** reconhece o token pelo hash. Sem token, com token torto,
   inexistente ou revogado: **401** com `WWW-Authenticate`. Conta suspensa ou
   cancelada: **403**. A resposta é a mesma para token que nunca existiu e para
   token revogado.
2. **Limite por token:** 120 chamadas por minuto, no mesmo armazenamento do
   limite global (Redis em produção). Passou: **429** com `Retry-After`. O teto
   global, que é por IP, não vale nesta rota — um produto da DMS chega de um
   endereço só para todas as contas.
3. **O token não passa da porta.** O pedido segue para o SDK sem os cabeçalhos
   de credencial; as ferramentas recebem quem é (conta, produto, classe,
   escopos), nunca o token.
4. **Cada pedido monta um servidor novo** com as ferramentas daquele token.
   Ferramenta que o token não pode usar nem aparece em `tools/list`; chamada
   direta a ela responde "não encontrada".
5. **Toda ferramenta roda dentro da conta do token** (`comConta`): a RLS vale
   como numa tela. Uma loja não vê a outra.

Sem nenhum token emitido, ninguém entra: a porta nasce fechada.

## Ferramentas

Regras (as do hub, ADR-008 do Liame):

- nome em snake_case, até 64 caracteres, sem ponto;
- curadas: uma tarefa, não um espelho do banco;
- não devolvem telefone nem conteúdo de conversa, salvo a ferramenta cujo
  escopo diz isso por extenso (hoje, só `conversas_anuncio_listar`, e só o
  telefone);
- texto que veio de terceiro (nome de campanha, texto de modelo) é dado, não
  instrução: quem consome trata como conteúdo não confiável.

| Ferramenta | Escopo | O que faz |
| --- | --- | --- |
| `integracao_situacao` | nenhum | diz para qual conta o token vale, o produto, a classe e as permissões. É a primeira chamada de quem integra. |
| `conta_situacao` | `conta.ler` | se a conta pode enviar agora (a saúde na Meta, com o que resolver), o plano e o uso do ciclo. |
| `campanhas_listar` | `campanhas.ler` | as campanhas, das mais novas para as mais antigas, com a situação e os números. Filtro por situação; até 50 por chamada. |
| `campanha_detalhar` | `campanhas.ler` | os números de uma campanha, por que está pausada ou esperando e até quando, as falhas por motivo com o que fazer, e o custo na Meta. Não devolve quem recebeu. |
| `publicos_listar` | `publicos.ler` | as listas, os públicos prontos (com a regra) e os perfis da base, com quantas pessoas de cada um podem receber. |
| `publico_estimar` | `publicos.ler` | quantas pessoas de um público podem receber, quantas estão em descanso e, com a categoria do modelo, o custo estimado (teto). Não cria nada. |
| `modelos_listar` | `modelos.ler` | os modelos como a Meta os tem agora: situação, categoria, qualidade, variáveis, alertas e se o disparo sabe mandá-los. Fala com a Meta. |
| `orcamento_ler` | `orcamento.ler` | os tetos de gasto e quanto já saiu em cada período. |
| `conversas_anuncio_listar` | `conversas.anuncio.ler` | as conversas que começaram por um anúncio de clique para o WhatsApp: id do anúncio, identificador do clique, momento, número da loja e o **telefone** de quem escreveu. Leitura com cursor. |
| `modelo_rascunhar` | `modelos.rascunhar` | grava um **rascunho** de modelo (título em texto, mensagem, rodapé, botões) e devolve o que barraria o envio. Não vai para a Meta. |
| `campanha_rascunhar` | `campanhas.rascunhar` | monta uma campanha em **rascunho** (modelo aprovado, público de uma lista ou da base, variáveis, janela e ritmo) e devolve quantas pessoas entraram e o custo estimado. Não dispara. |

As de leitura ficam em `integracao/mcp.leitura.ts`. Cada uma chama o **mesmo
serviço da tela**, dentro da conta do token, e devolve um recorte curado:

- **sem telefone, sem nome de contato, sem conteúdo de conversa** — contagens e
  situações;
- **dinheiro em centavos inteiros**, com a frase pronta ao lado quando existe;
- **esquema de entrada e de saída declarados**: o que foge do esquema de entrada
  é recusado antes de rodar;
- **recusa de regra vira erro da ferramenta**, com a frase em português que a
  tela mostraria (campanha de outra conta: "Campanha não encontrada"); erro
  inesperado é registrado e sai como "erro interno", sem detalhe.

O disparo entra no próximo PR.

## Rascunhos (migration 045)

`integracao/mcp.escrita.ts`. As duas ferramentas gravam, e nenhuma faz mensagem
sair: o rascunho de modelo fica no RegemCast (não vai para a Meta) e a campanha
fica em rascunho (não dispara). **Quem confere e dá o passo seguinte é uma
pessoa da conta, na tela** — é o "planejar → aprovar → executar" da ADR-008.

- **O mesmo serviço e a mesma validação da tela.** O pedido vira o DTO da rota
  (`comoDto`, com as opções do `ValidationPipe` global) e entra em
  `ModeloService.salvarRascunho` e `CampanhaService.criar`. Não há uma segunda
  regra de modelo ou de campanha.
- **Recorte menor que o da tela, de propósito:**
  - campanha **sem números digitados** — o público sai de uma lista ou da base,
    onde o consentimento está registrado. Número solto mandado junto é ignorado;
  - campanha **sem "enviar para quem está em descanso"** — é decisão do dono;
  - modelo **sem imagem, vídeo, documento, carrossel e oferta por tempo
    limitado** (pedem arquivo ou valores que a porta não recebe), e só nas
    categorias marketing e utilidade.
- **O modelo da campanha é conferido na Meta**, como na tela: precisa existir e
  estar aprovado; a categoria que vale é a dela.
- **Alterar rascunho de modelo** (com `id`): só um que **o mesmo aplicativo**
  criou e que ainda não foi enviado à Meta. O que uma pessoa fez na tela, ou
  outro aplicativo, a integração não altera.

### Chave de idempotência

Toda ferramenta que grava exige `chaveIdempotencia` (8 a 100 caracteres).
Tabela `integracao_idempotencia`, regras em `integracao/idempotencia.regras.ts`.

- A mesma chave com o **mesmo pedido** devolve a resposta guardada, sem criar
  de novo. Com **outro pedido**, é recusada.
- A chave é por token e por ferramenta.
- A linha nasce **na transação da ação**: se a ação é recusada, a chave não
  fica, e o pedido corrigido pode usar a mesma. Dois pedidos iguais ao mesmo
  tempo: o segundo espera no índice único e recebe a resposta do primeiro.
- Vale **24 horas**; depois é apagada (job de hora em hora).

### O autor na trilha

`auditoria/autor-integracao.ts`. A porta roda toda ferramenta com a integração
como autora, e a auditoria lê daí: o que o serviço registraria como "usuário",
sem pessoa, sai com **`ator_tipo = integracao`**, o nome do token em
`ator_nome` e o produto, a classe e o id do token no detalhe. Os serviços não
precisam saber de onde foram chamados, e não há como uma ação de integração
aparecer como se fosse de alguém da conta. O token em si nunca vai para a
trilha. O que uma pessoa faz na tela continua saindo como `usuario`.

O rascunho também guarda o produto que o criou (`campanha.integracao_produto`,
`modelo.integracao_produto`); `criada_por` fica vazio. As telas de Campanhas e
de Modelos do site mostram "montada pelo Liame" / "criado pelo Liame".

## Conversas abertas por anúncio (migration 044)

Quando alguém clica num anúncio de "clique para o WhatsApp" e escreve para a
loja, a Meta manda a origem junto da **primeira mensagem** (`referral`, no aviso
`messages`): o id do anúncio, o tipo, o endereço e o identificador do clique
(`ctwa_clid`). É com isso que o Liame liga o anúncio ao pedido que veio depois
(F7 do plano dele). O contrato é o `docs/integracoes/regemcast.md` do Liame; a
decisão 2 trocou o transporte (REST → ferramenta do MCP) e manteve o formato.

Tabela `conversa_anuncio`. Regras em `meta/anuncio.regras.ts`, banco em
`meta/anuncio.service.ts`, ferramenta em `integracao/mcp.conversas.ts`.

**O que é guardado.** Uma linha por mensagem que chegou com a origem de um
anúncio: o id e o tipo da origem (`ad` ou `post`), o endereço, o `ctwa_clid`, a
hora da mensagem, o número da loja e o telefone de quem escreveu. **Nenhum
conteúdo**: nem o texto da mensagem, nem o nome de perfil, nem o texto ou a
imagem do anúncio.

**Quando é guardado — nasce desligado.** Só enquanto a conta tem um
**aplicativo conectado com a permissão `conversas.anuncio.ler`** (um token de
integração não revogado com esse escopo). Sem aplicativo não há para que
guardar o telefone de quem clicou, então nada é gravado — fica só uma linha no
log, sem dado pessoal, dizendo que a mensagem chegou. Consequências:

- hoje, em produção, a tabela fica vazia: não há token emitido;
- o que chegou **antes** de o aplicativo ser conectado não existe, e a Meta não
  manda de novo. A carga inicial do Liame (`desde`) só alcança o que entrou
  depois da conexão;
- revogado o token, a gravação para na mensagem seguinte. O que já entrou sai
  pelo prazo de guarda.

**Para qual número.** Qualquer número da conta — em coexistência ou não, com as
conversas guardadas no painel ou não. A resposta do dono sobre guardar as
conversas (migration 023) é sobre o conteúdo delas, e daqui não sai conteúdo.
A tabela `conversa` não mudou.

**Prazo de guarda:** 180 dias a partir da entrada; um job apaga de hora em hora.

**Reentrega da Meta** não duplica: a mensagem é única por conta (`wamid`).

**Falha ao guardar não segura o aviso.** O pedido de saída, o status de
campanha e a conversa seguem; o erro fica no log.

**O que a Meta não garante.** Em número em **coexistência**, a Meta não promete
o `referral` — a primeira mensagem de quem clicou pode até chegar como
"não suportada" (erro 131060). O `ctwa_clid` some em anúncio no **Status** do
WhatsApp (a origem vem). Gravamos o que chegar; conferir com número real antes
de prometer o resultado (decisão D-A2.5-9 do Liame).

### `conversas_anuncio_listar`

Entrada: `cursor`, `limite` (padrão 200, máximo 500), `desde` (instante com
fuso; filtra pela hora da mensagem, para a carga inicial).

```json
{
  "itens": [
    {
      "id": "8d9d5c1e-4b0f-4f5e-9a51-2f0a8c6f7a11",
      "versao": 1,
      "atualizado_em": "2026-09-24T19:12:44.382911Z",
      "numero_loja": "+5521900000000",
      "telefone": "+5521988887777",
      "aberta_em": "2026-09-24T19:12:40.000Z",
      "anuncio_id": "120215566771111",
      "tipo_origem": "ad",
      "ctwa_clid": "ARAkLkA…",
      "url_origem": "https://fb.me/…"
    }
  ],
  "proximo_cursor": "…",
  "tem_mais": false
}
```

- **Ordem** estável por (`atualizado_em`, `id`), a hora em que a linha entrou.
- **Cursor** opaco. Vem sempre que há item, mesmo na última página: quem lê
  guarda o cursor e volta com ele para receber só o que entrou depois. Sem nada
  novo, volta o mesmo cursor.
- **Só sai o que entrou há pelo menos 5 segundos**: uma transação que confirma
  tarde não fica para trás do cursor.
- **`versao`** é sempre 1: a linha não muda depois de entrar.
- **`telefone`** em E.164, com o 9º dígito, como o contato do RegemCast.
- **`tipo_origem`** diz se `anuncio_id` é de um anúncio (`ad`) ou de uma
  publicação (`post`).
- **`ctwa_clid`** e **`url_origem`** podem vir `null`.
- Cursor ou `desde` que não vale volta como erro da ferramenta, com a frase.

O evento opcional do contrato (`conversa_anuncio.aberta`, por webhook de saída)
não foi feito: a leitura com cursor basta.

### Antes de emitir um token com esta permissão

A política de privacidade do site (`/privacidade`, seção 4) diz hoje que os
dados recebidos da Meta não são transferidos a terceiros nem usados para
publicidade. Ligar a origem do anúncio ao pedido, em outro produto da DMS, é
uma finalidade nova: **o texto da política precisa ser revisto (com o
advogado) antes de o primeiro token com `conversas.anuncio.ler` ser emitido**.
Enquanto nenhum for emitido, nada é guardado e a política segue verdadeira.

## O que falta

- Rever a política de privacidade antes do primeiro token com
  `conversas.anuncio.ler` (seção acima).
- Disparo para produto da DMS: planejar (público, custo, saldo do orçamento) e
  executar, com chave de idempotência.
- "Aplicativos conectados" e a marca "montada pelo …" no app Android.
- No Liame: o conector que consome estas ferramentas, e a emenda da ADR-008 e
  da ADR-019 registrando a decisão 2.

## Fontes

- [Especificação MCP 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28) (conferida em 02/10/2026: sem estado, pedidos autocontidos, negociação por pedido).
- [SDK TypeScript v2 — servir por HTTP](https://ts.sdk.modelcontextprotocol.io/v2/serving/http) (`createMcpHandler`, `handler.fetch(request, { authInfo, parsedBody })`, clientes da geração 2025 atendidos sem estado).
- Liame: `docs/adr/ADR-008-mcp.md`, `docs/adr/ADR-019-integracao-regem-regemcast.md`, `docs/base-conhecimento.md` §8.1 e §13.1.
