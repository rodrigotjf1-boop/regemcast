# MCP do RegemCast: a porta para outros produtos da DMS

O RegemCast tem um endereço MCP (Model Context Protocol) por onde outro produto
do grupo lê números da conta e pede ações. O primeiro consumidor é o **Liame**.

- **Endereço:** `POST {API}/api/v1/mcp` (em produção, `https://castapi.dmsregem.com/api/v1/mcp`).
- **Credencial:** token de integração por conta, no cabeçalho `Authorization: Bearer rct_it_…`.
  Com a via do DMS ID ligada (Hub DMS, `DMS_ID_LIGADO`), também o token do DMS
  ID com o segredo da ligação no cabeçalho `DMS-Ligacao` (seção "A via do DMS ID").
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

## A via do DMS ID (Hub DMS, migration 046)

A F2 do Hub DMS troca a porta como a decisão 2 previa: a credencial passa a
ser a do Padrão DMS (§2.1) — o **token do DMS ID** diz qual aplicativo chama, e
o **segredo da ligação** diz qual conta autorizou. Vazar um só não abre nada.
As ferramentas, os escopos e a auditoria ficam como estão.

**Nasce desligada.** Com `DMS_ID_LIGADO=false` (o padrão), nada muda: a porta
só aceita o `rct_it_`, com as respostas de sempre. Ligada, as duas vias valem ao
mesmo tempo; com o `rct_it_` no cabeçalho, ele tem a vez. Variáveis em
[`deploy.md`](deploy.md).

Tabela `integracao_ligacao`. Regras em `integracao/ligacao.regras.ts`; token do
DMS ID em `dms-id.service.ts`, com o pacote comum do hub copiado em
`src/dms/integracao-dms.ts` (versão 0.7.2, igual byte a byte; não editar aqui).

- **O pedido:** `Authorization: Bearer <token do DMS ID>` e
  `DMS-Ligacao: dms_lg_regemcast_…`. O token é conferido pela assinatura (ES384
  ou RS256, chaves públicas do DMS ID guardadas por 10 minutos), pelo emissor,
  pelo destino (o endereço desta porta, que é o identificador do recurso no DMS
  ID) e pela validade.
- **As permissões são a menor das duas:** as que o token traz (o que o DMS ID
  deixa o aplicativo fazer no RegemCast) **e** as que a ligação tem (o que a
  conta deixou). Token sem nenhuma permissão do RegemCast — o DMS ID emite token
  para qualquer destino, até com `scope` vazio — recebe **403**.
- **A ligação só vale com o token do aplicativo dono dela**, e só enquanto esse
  aplicativo estiver em `DMS_ID_APLICATIVOS`: tirar o aplicativo da variável
  corta todas as ligações dele na chamada seguinte. Só a classe `dms` entra.
- **Recusas no formato do Padrão** (`application/problem+json`, RFC 9457, base
  `https://dev.dmstecnologias.com/erros/`):

  | Situação | Resposta |
  | --- | --- |
  | sem token, token torto, de outro destino, vencido, assinatura que não confere | 401 `token-invalido` |
  | token sem permissão do RegemCast | 403 `escopo-insuficiente`, com todas as permissões no `WWW-Authenticate` |
  | sem ligação, ligação inexistente, revogada, de outro aplicativo | 401 `ligacao-invalida` — **a mesma resposta** para todos |
  | conta suspensa ou cancelada | 403 `conta-bloqueada` |
  | passou de 120 chamadas no minuto | 429 `limite-de-chamadas` com `Retry-After` |

  Todo 401 leva `WWW-Authenticate: Bearer resource_metadata="…", scope="…"`
  (com `error="invalid_token"` quando veio um token que não vale).
- **Os metadados do recurso (RFC 9728)** saem em
  `GET /.well-known/oauth-protected-resource/api/v1/mcp`, na raiz do domínio,
  fora do `/api/v1`: dizem o recurso, o DMS ID como servidor de autorização e as
  9 permissões. É por eles que um cliente MCP acha o DMS ID.
- **O manifesto da porta (Padrão DMS §13; Hub DMS, F4 parte A)** sai em
  `GET /.well-known/dms-manifesto`, também na raiz e sem credencial: OpenAPI 3.1
  com os campos `x-dms` — as 9 permissões com a frase da tela, a classe (`dms`)
  e o sensível (o telefone das conversas por anúncio e o disparo, que gasta na
  Meta), as 15 ferramentas com o esquema de entrada e o jeito de cada uma que
  grava ser idempotente (`chave`: a `chaveIdempotencia` obrigatória;
  `substituicao`: repetir não muda nada, o revogar), o limite por ligação e a
  porta MCP (`x-dms-mcp`: o endereço e a versão 2026-07-28). É montado do
  próprio código (`integracao/manifesto.ts`, a partir do catálogo `ESCOPOS`, do
  `FERRAMENTAS` e do guard) e guardado em [`dms-manifesto.json`](dms-manifesto.json);
  o teste confere que o arquivo é o que o código monta (`ATUALIZAR_MANIFESTO=1`
  regrava). Ferramenta que grava sem `chaveIdempotencia` e sem a marca de
  idempotente para a montagem (Padrão §6). O `rct_it_` não entra: é a credencial
  antiga, que sai na F5.
- **O id da ligação é o do token de onde ela veio:** o limite por minuto, a
  idempotência dos rascunhos e o autor na trilha seguem a mesma chave pelas duas
  vias. **Revogar um revoga o outro** — pelo console, por "Aplicativos
  conectados" ou pela ferramenta `integracao_revogar`.
- **O segredo da ligação não passa da porta**, como o token.

### A troca automática (decisão F2-3)

`POST /api/v1/dms-id/ligacao`, com o token do DMS ID do aplicativo e
`{ "token_integracao": "rct_it_…" }` no corpo. Devolve
`{ ligacao, prefixo, conta_id, conta, permissoes, segredo_em }` — o segredo em
claro sai **só** nesta resposta (`Cache-Control: no-store`); o banco guarda o
resumo (sha-256).

- A ligação herda do token a conta, o produto, o nome e as permissões.
- Só token **ativo**, de classe `dms`, e só para o aplicativo que
  `DMS_ID_APLICATIVOS` cadastrou para o produto do token (o Liame não troca o
  token do GoGeM). Qualquer outro caso: a mesma recusa, 401 `ligacao-invalida`.
- **Repetir a troca gira o segredo:** o anterior para de valer na hora. Duas
  trocas ao mesmo tempo esperam uma pela outra; vale o segredo da última
  resposta. Ligação revogada não volta pela troca.
- A trilha da conta registra `integracao.ligacao_criada` e
  `integracao.ligacao_girada`, com o aplicativo como autor.

### Como se prova

- `mcp.dmsid.spec.ts` roda o **kit de conformidade do hub**
  (`backend/scripts/dms/kit-conformidade.mts`, cópia igual à do hub; fora de
  `src` porque roda no Node, sem compilar) contra a porta, com um DMS ID de
  mentira que assina de verdade: as 17 conferências do modo DMS ID passam; as
  10 opcionais da 0.7.2 que não cabem aqui saem puladas (a classe acima do teto,
  a ligação suspensa e a parada, que são da parte F, e as sete da porta REST: a
  conta, o cursor e a escrita). No modo `manifesto`, o kit confere o manifesto
  pela porta e pelo arquivo do repositório.
- `integracao.ligacao.pg.spec.ts` prova o SQL num Postgres descartável, como
  `regemcast_app` (RLS valendo). Sem `REGEMCAST_TESTE_PG_URL` e
  `REGEMCAST_TESTE_PG_SUPER`, pula — o CI não tem banco; roda-se à mão antes de
  mexer no serviço.

## A autorização por clique (Hub DMS B1, migration 047)

O dono da conta liga um aplicativo do DMS ID (o Liame) confirmando com a senha,
sem token emitido pela distribuição. É a tela única do Padrão DMS (§3, ajustado
em 20/10/2026), com o protótipo e as 9 decisões aprovados pelo dono no mesmo dia
(página "Autorização por clique" do Hub DMS). **Nasce desligada**
(`AUTORIZACAO_POR_CLIQUE`); quem liga em produção é o dono, depois da comparação
das duas vias. Código em `integracao/autorizacao.*`.

O caminho:

1. **O pedido** (pedido empurrado, RFC 9126): o servidor do aplicativo chama
   `POST /api/v1/integracao/autorizacao/pedido` com o token do DMS ID e, em
   formulário (ou JSON): `response_type=code`, `client_id`, `redirect_uri`,
   `scope`, `state`, `code_challenge` (S256), `code_challenge_method=S256` e a
   conta que pede no sistema dele (`conta_nome`, `conta_cnpj`, `conta_email`,
   `conta_marca`). Recebe `{ request_uri, expires_in: 600 }`: o número vale 10
   minutos e uma vez só; o banco guarda o resumo.
2. **A página** `cast.dmsregem.com/integracoes/autorizar?client_id=…&request_uri=…`,
   fora do menu: o dono confere quem pede (o aplicativo, a empresa dele com o
   CNPJ, a conta que pede e a conta dele), o que vai (necessárias sem chave; a
   opcional nasce desligada) e o que não vai, e confirma com a senha. Conta que
   pede com outro CNPJ (ou sem CNPJ) pede a confirmação explícita. Cinco senhas
   erradas em 15 minutos travam a autorização por 15 minutos (a entrada na conta
   não). A autorização fica gravada com o texto da tela e a versão dele: a prova,
   que a aplicação não apaga.
3. **A volta** ao endereço cadastrado do aplicativo, com `code`, `state` e `iss`
   (o endereço desta API; RFC 9207). Cancelar volta com `error=access_denied`.
4. **A troca:** `POST /api/v1/integracao/autorizacao/token`, com o token do DMS
   ID e `grant_type=authorization_code`, `code`, `code_verifier` e
   `redirect_uri`. Devolve o segredo da ligação no formato da troca automática.
   **Só aqui a ligação nasce** (ou, se a conta já tem uma ligação ativa com o
   aplicativo, ela gira o segredo e fica com as permissões novas, com o mesmo id).
   A exceção é a ligação que veio de um token (a troca automática, com o id do
   token): ela é revogada ("substituída pela autorização por clique") e nasce
   outra, da autorização. Revogar o token derruba a ligação de mesmo id, e o
   aplicativo revoga o token antigo quando passa a conta para a autorização nova.

Regras que moram no servidor:

- O catálogo de quem pode usar a página está no código (a classe `dms` do Padrão
  §1): o aplicativo só pede o que está nele, e nele não há permissão de gravar
  (decisão B1-3: gravar fica fora até a F5). Os endereços de volta são os do
  catálogo, comparados por inteiro (`AUTORIZACAO_ENDERECOS_DE_VOLTA` troca a lista
  para teste).
- O código vale 10 minutos e uma vez só, e é gasto antes das conferências:
  verificador errado ou endereço diferente gastam o código também. Código usado
  de novo desliga a ligação que ele criou (RFC 6749 §4.1.2).
- Uma ligação ativa por conta e aplicativo (índice único): duas trocas ao mesmo
  tempo não deixam duas valendo. A troca automática (`POST /api/v1/dms-id/ligacao`)
  que esbarra na ligação do clique é recusada (`ligacao-invalida`), sem girar nem
  criar nada; a do token substituído também (ligação revogada não volta).
- Com o aplicativo parado no hub (ou `ACEITAR_INTEGRACOES=false`), não há pedido,
  página nem troca.
- O dono é avisado a cada ligação nova, com mais permissões ou renovada: e-mail
  (não se desliga) e aviso no celular do tipo `seguranca` (vai sempre, não é
  preferência). A ligação que nasce sozinha de um token antigo (a troca
  automática) manda o e-mail de "mudou de forma".
- "Aplicativos conectados" mostra o token (e a ligação que veio dele) e a ligação
  por clique, com quem autorizou, a conta que pediu, o texto guardado ("Ver o
  texto que você autorizou") e o histórico tirado da auditoria; o dono desliga
  qualquer uma.
- O pedido e a troca vão ao registro do hub como chamadas (`autorizacao.pedido`,
  `autorizacao.token`), sem o código, o verificador nem o segredo.

Como se prova: `autorizacao.regras.spec.ts` (as regras puras e a tela) e
`autorizacao.pg.spec.ts` (por HTTP, com os controladores e o serviço de verdade,
o DMS ID de mentira e o Postgres descartável; pula sem as duas variáveis).

## O hub da DMS: registro, erros e parada (sem migration)

A etapa 2 da A4 do Hub DMS: a porta passa a falar com o serviço do hub, pelo
cliente do pacote comum (`ClienteHub`, seção 9 da 0.3.0). Código em
`modules/hub/` e `integracao/registro-da-porta.middleware.ts`.

**Nasce desligado.** Com `HUB_LIGADO=false` (o padrão), nada vai ao hub e nada
é parado por ele; a única mudança visível é o código do pedido (abaixo).
Variáveis em [`deploy.md`](deploy.md). Quem liga em produção é o dono, depois de
o hub estar no ar e de o aplicativo do RegemCast existir no DMS ID.

- **O código do pedido:** toda chamada da porta ganha um código (`rc_` + 16
  caracteres), que volta no cabeçalho `request-id` e no `request_id` das recusas
  do Padrão. É o código que liga o que o produto que chamou viu ao que o hub
  mostra, e o código dos erros que a chamada causar.
- **O registro central (Padrão §10):** ligado, cada chamada vira um registro —
  o código, quando, a credencial (`token_integracao` ou `dms_id`), o prefixo
  visível do token ou da ligação, o produto que chamou, a conta (o id e o nome
  da empresa), a ferramenta, o resultado (`aceita`, `recusada` ou `erro`), o
  problema do Padrão quando recusada, o status e a duração. **Nunca o
  conteúdo**: nem argumento, nem resposta, nem segredo. A recusa que sai com
  HTTP 200 também conta como recusada: a regra do serviço dentro da ferramenta
  (404 vira `nao-encontrado`), o argumento fora do esquema (o SDK devolve um
  resultado com `isError`: recusada, sem problema) e a ferramenta que o token
  não enxerga (o SDK responde `-32602` "not found"; pelo catálogo, a fora do
  escopo vira `escopo-insuficiente` e a que não existe, `nao-encontrado`). O
  registro sai em lote, a cada 5 s; nada espera o hub.
- **Os erros (Padrão §11):** o que a telemetria grava vai também à lista de
  erros do hub (o 500 da API, o Mercado Pago, o e-mail, a fila), e o erro
  inesperado de uma ferramenta, com o código do pedido. A falha de envio de cada
  mensagem à Meta não vai: é resultado do envio, não defeito, e fica na
  telemetria daqui. A mensagem sai higienizada aqui e limpa de novo pelo pacote
  (telefone, e-mail, documento, token, identificador e número longo saem).
- **A lista de parada:** lida a cada 15 s (só quando muda). O portão recusa a
  chamada parada com **503 `integracao-parada`** (`Retry-After: 60`), depois de
  reconhecer quem chama: a parada geral, a do produto que chama (`liame`), a da
  ligação (pelo prefixo visível, o mesmo que vai no registro) e a de cada
  ferramenta do pedido (no lote da geração 2025, uma parada recusa o lote
  inteiro). Se o hub cair, vale a última lista lida; depois de um reinício com o
  hub fora, nada é parado até a primeira leitura.
- **A chave própria (`ACEITAR_INTEGRACOES=false`):** recusa toda chamada com o
  mesmo 503, antes de tudo, sem ir ao banco e sem depender do hub. É a
  emergência quando o hub está fora ou comprometido.
- **A batida:** a cada minuto, com a versão no ar (`APP_VERSAO`) e a chave
  própria.
- **A fila fica na memória do processo** (até 5.000 chamadas; acima disso sai a
  mais velha, contada): um reinício perde o que ainda não saiu. No desligamento,
  o que falta sai uma vez.

Como se prova: `chamada-atual.spec.ts` (o registro campo a campo contra uma
cópia do esquema que o hub confere), `hub.service.spec.ts` (o cliente contra um
DMS ID e um hub de mentira por HTTP), os testes "o hub da DMS" de
`mcp.porta.spec.ts` e `mcp.dmsid.spec.ts` (a porta inteira, nas duas vias) e
`telemetria.hub.spec.ts`.

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
| `integracao_situacao` | nenhum | diz para qual conta o token vale (o id, que não muda, e o nome), o fuso dela, o produto, a classe e as permissões. É a primeira chamada de quem integra. |
| `integracao_revogar` | nenhum | o próprio aplicativo desliga o token dele (`confirmar: true`); vale na chamada seguinte. É o "desconectar" do outro lado. |
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
| `campanha_disparo_planejar` | `campanhas.disparar` (só `dms`) | o plano do disparo: pessoas, custo estimado, orçamento da conta, o que impede agora e a **confirmação**. Não muda nada. |
| `campanha_disparar` | `campanhas.disparar` (só `dms`) | **dispara** a campanha, com a confirmação do plano. As mensagens saem e a Meta cobra. O dono é avisado. |
| `campanha_pausar` | `campanhas.disparar` (só `dms`) | pausa uma campanha que o aplicativo disparou. Quem retoma é uma pessoa, na tela. |

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

## Disparo (sem migration)

`integracao/mcp.disparo.ts`, regras em `integracao/disparo.regras.ts`. É a única
ação da porta que faz mensagem sair e custa dinheiro na Meta. Por isso tem dois
passos e três travas que a tela não tem.

**Dois passos.** `campanha_disparo_planejar` mostra o que vale agora — quantas
pessoas, o custo estimado (teto), o orçamento da conta e o que impede — e, se
nada impede, devolve a `confirmacao` (a impressão digital do que mostrou).
`campanha_disparar` só roda com ela e só se **nada mudou** desde o plano (o
público, o custo, o orçamento, a situação da campanha); senão, recusa e pede um
plano novo. Quem chama mostra o plano a quem aprova antes de disparar: é o
"planejar → aprovar → executar" da ADR-008, com a aprovação do lado do produto
que chama.

**Três travas:**

1. **Só produto da DMS.** A permissão não existe para cliente de fora — na
   emissão, na leitura do token (escopo gravado no banco que a classe não pode
   ter não vira permissão) e na ferramenta.
2. **Só campanha que o mesmo aplicativo montou** (`integracao_produto`). O
   rascunho que uma pessoa fez na tela é dela para disparar; outro aplicativo da
   mesma conta também não mexe.
3. **Só com o orçamento de disparos valendo.** A conta precisa ter pelo menos
   um teto definido pelo dono, o orçamento precisa conseguir contar (moeda lida
   e tarifa cadastrada) e precisa haver preço para as mensagens **desta**
   campanha — mensagem sem tarifa não é segurada pelo teto. Sem isso, nada
   limitaria quanto um aplicativo pode gastar, e o disparo é recusado.

**O disparo em si é o da tela** (`CampanhaService.disparar`), com as mesmas
conferências: campanha em rascunho, WhatsApp conectado, número registrado,
conta liberada na Meta, plano com saldo. O plano mostra a recusa que o disparo
daria (`oQueImpedeODisparo`, as mesmas conferências sem disparar). Disparada, a
campanha segue as regras de sempre: janela, ritmo, teto do plano, limite da
Meta e o orçamento, que pausa e retoma sozinho. Custo maior que o que resta no
orçamento não impede: o plano avisa que a campanha vai sair aos poucos.

**O dono é avisado** no aplicativo (aviso de campanhas): quem disparou, a
campanha, quantas pessoas e o custo estimado. O aviso sai depois da gravação,
e não se repete quando o pedido é repetido com a mesma chave.

**Na trilha**, `campanha.disparada` e `campanha.pausada` saem com o autor
`integracao` e o nome do token.

**Pausar** é a válvula de segurança do aplicativo: para a campanha que ele
disparou. Retomar é de uma pessoa, na tela.

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

### A política de privacidade

Revista em 02/10/2026 (dono: "políticas de privacidade ok"). A página
`/privacidade` diz, desde então:

- seção 4: a origem do anúncio, a hora e o telefone de quem escreveu só são
  guardados com um aplicativo da DMS conectado com a permissão, e vão para ele;
  sem o conteúdo; apagados em 180 dias;
- seção 6: os aplicativos da DMS conectados a pedido do dono da conta, o que
  cada permissão libera, o disparo dentro do orçamento com aviso ao dono, e
  onde desligar;
- seção 7: o prazo de 180 dias, e que a trilha guarda o que um aplicativo fez.

**A seção 14 promete avisar o cliente antes de uma mudança relevante valer.**
O compartilhamento só começa quando o dono da conta pede a conexão de um
aplicativo — é nesse pedido que ele fica sabendo. Por isso: **token com
`conversas.anuncio.ler` (ou disparo) só se emite a pedido do dono daquela
conta**, nunca por iniciativa nossa.

## O que falta

- Disparo para produto da DMS: planejar (público, custo, saldo do orçamento) e
  executar, com chave de idempotência.
- "Aplicativos conectados" e a marca "montada pelo …" no app Android.
- No Liame: o conector que consome estas ferramentas, e a emenda da ADR-008 e
  da ADR-019 registrando a decisão 2.
- Hub DMS: ligar `AUTORIZACAO_POR_CLIQUE` em produção (o dono, depois da
  comparação das duas vias, até 01/11/2026), com `AUTORIZACAO_DMS_RAZAO_SOCIAL` e
  `AUTORIZACAO_DMS_CNPJ`; o lado do Liame (o botão em Contas conectadas, a volta e
  a troca) vem no PR dele.
- Hub DMS: guardar a última lista de parada entre reinícios. A troca pela
  ligação (`POST /api/v1/dms-id/ligacao`) já vai ao registro (`dms-id.ligacao`).
- O console da distribuição ainda lista só os tokens; a ligação por clique
  aparece para o dono em "Aplicativos conectados" e no registro do hub.
- O app Android ainda não mostra os aplicativos conectados: o aviso de segurança
  diz onde desligar (o site).

## Fontes

- [Especificação MCP 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28) (conferida em 02/10/2026: sem estado, pedidos autocontidos, negociação por pedido).
- [SDK TypeScript v2 — servir por HTTP](https://ts.sdk.modelcontextprotocol.io/v2/serving/http) (`createMcpHandler`, `handler.fetch(request, { authInfo, parsedBody })`, clientes da geração 2025 atendidos sem estado).
- Liame: `docs/adr/ADR-008-mcp.md`, `docs/adr/ADR-019-integracao-regem-regemcast.md`, `docs/base-conhecimento.md` §8.1 e §13.1.
- [RFC 9728 — metadados do recurso protegido](https://www.rfc-editor.org/rfc/rfc9728) e [RFC 9457 — problem+json](https://www.rfc-editor.org/rfc/rfc9457).
- Hub DMS: o Padrão DMS de integração (§2.1, §6, §7 e §13), o pacote comum 0.7.2 e o kit de conformidade.
