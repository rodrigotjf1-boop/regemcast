# Aprovação de disparos (Hub DMS, F5 parte B)

O disparo que outro produto da DMS pede pela porta MCP passa a **esperar uma pessoa da conta**: o dono (ou quem ele
autorizou) aprova na tela do Regemcast, com o código do aplicativo autenticador, fixa o teto de gasto daquele disparo, e
só então as mensagens saem, uma vez. Até aqui a "confirmação" do disparo era uma impressão digital que o próprio chamador
recebia: provava que o plano não mudou, não que alguém aprovou (documento "F5 do Hub DMS", 22/10/2026).

- **Contrato:** o pedido de ação do pacote comum (`dms/integracao-dms.ts`, seção 11; Padrão DMS §8.1). As situações, o
  prazo, o resumo do plano, as conferências e as mensagens de erro são as do pacote; aqui ficam a guarda, a tela, o
  segundo fator e a execução. Os **8 casos comuns** do pacote rodam contra o serviço de verdade
  (`aprovacao.pg.spec.ts`).
- **Decisões do dono (23/10/2026, todas na A):** F5-1 código do aplicativo autenticador na hora de aprovar; F5-2 só o
  dono, que pode dar a permissão a outra pessoa; F5-3 quem pediu não aprova (o pedido do agente, quem tem a permissão
  aprova); F5-4 prazo de 24 horas, lembrete na metade; F5-5 o cupom aparece junto (o Liame o desativa se o pedido for
  recusado ou vencer); F5-6 teto de gasto do disparo; F5-7 o resultado vai a quem pediu por aviso assinado e pela
  consulta; F5-11 o merge e a migration esperam o "pode" do dono.
- **Protótipo aprovado:** "Aprovação de disparos" (Hub DMS, `prototipos/aprovacao-de-disparos.html`), 10 situações.
- **Revisão de olhos frescos do desenho** (11/11/2026), antes do código: 4 bloqueantes e 10 importantes, todos
  tratados (o que mudou está nas seções abaixo).

## Os PRs

1. **Servidor** (migration 048): o pedido, as ferramentas, a aprovação pela API, a execução, o teto no worker, o prazo
   e o lembrete, os avisos a quem aprova, o registro no hub e a permissão de aprovar em Conta e usuários.
2. **Tela:** Campanhas › Para aprovar, o pedido aberto, os diálogos de aprovar e recusar, a permissão em Conta e
   usuários, o teto e o gasto na campanha (pela MESMA conta do worker), e o "continuar" depois do teto.
3. **Aviso assinado a quem pediu** (F5-7; migration 049): o Regemcast passa a mandar aviso (Standard Webhooks, pacote
   seção 7), registrado pela porta (`aviso_registrar`). A consulta (`acao_pedido_ler`) segue valendo, como reserva.

## O que nasce desligado e o que não

- **O caminho novo existe desde o merge** (aditivo; contrato 1.1.0): `campanha_disparo_pedir`, `acao_pedido_ler`,
  `acao_pedido_cancelar` e as rotas da tela. Ninguém os usa até o Liame passar a pedir (parte D). Ele é mais seguro que
  o de hoje: nada sai sem a pessoa.
- **Campanha com pedido aberto só sai por ele**, com a chave ligada ou não: o Disparar da tela e o `campanha_disparar`
  recusam (`CampanhaService.disparar`, no serviço). Assim ninguém contorna quem aprova enquanto as partes D e E não
  chegam.
- **O caminho direto fecha com `DISPARO_SO_COM_APROVACAO=true`** (padrão `false`): `campanha_disparar` recusa, pelas
  duas credenciais, e o Disparar da tela recusa todo rascunho montado por outro produto (ele sai pelo pedido). A trava
  fica em `CampanhaService.disparar`, que distingue a execução de um pedido aprovado pelo `pedidoId`. O dono liga depois
  que o Liame passar ao pedido (parte D) e depois da parte E (F5-8). Ligar é **quebra** para quem ainda usa
  `campanha_disparar` (Padrão §12): antes, passar pela skill `mudanca-produto-dms`.
- `campanha_disparar` continua no catálogo (o manifesto lista o que existe); sai numa versão de contrato posterior,
  pela régua de retirada do Padrão §12.

## Migration 048 (`048_aprovacao_de_disparos.sql`)

**`acao_pedido`** (RLS da conta; o `regemcast_app` não apaga: é a prova):

- a campanha, a ação (`campanha_disparar`), o risco (`R3`: mensagem a cliente E gasto, então o teto é obrigatório), a
  situação (as 8 do pacote), o resumo do plano e o plano;
- o aplicativo, a credencial por onde veio (`token_id`, o token ou a ligação) e o prefixo visível dela;
- quem pede (`{"tipo":"agente"}` ou `{"tipo":"pessoa","pessoa":"<resumo do e-mail>"}`), a chave de repetição só em
  resumo e a impressão do pedido (`impressaoPedido` do pacote);
- `criado_em`, `vence_em` e `lembrete_em` **gravados pelo serviço** (o mesmo relógio, também nos testes);
- quem decidiu (a pessoa e o papel, para o hub), o teto, o motivo (um nome de problema do pacote) e o da recusa.

**Índices:** um pedido aberto por campanha (`aguardando`, `aprovado`, `executando`); a chave presa ao pedido
`(conta, aplicativo, chave)`; os da rotina.

**O gatilho `rc_acao_pedido_guarda`:** a situação anda só pelas transições do pacote; o que prende o pedido não muda
depois de nascer; sem mudança de situação, a decisão (quem, quando, o motivo da recusa, a execução) não muda, e o
motivo só muda no executado para `teto-de-gasto`; o teto nasce uma vez, na aprovação.

**`campanha.acao_pedido_id`:** o pedido que disparou a campanha, gravado uma vez (gatilho). O worker lê o teto **do
pedido**, nunca de uma coluna da campanha que outro caminho mexeria. `pausa_motivo` ganha `teto_aprovado` (o check é
trocado com `not valid` + `validate`).

**`usuario.aprova_disparos`** (a permissão que o dono dá; ele aprova sempre) e a trava do código na aprovação
(`aprovacao_erros`, `aprovacao_erro_em`, `aprovacao_travada_ate`: 5 errados em 15 minutos travam aprovar por 15
minutos, separada da trava da entrada).

Tem `drop constraint`: vai pelo SQL Editor, colada pelo dono, com a linha do ledger.

## O plano prende o que sai

O plano é tudo o que a pessoa vê para aprovar, montado por uma função só (`planoAgora`) no pedido, na tela e na
execução. O resumo dele (`resumoDoPlano`) prende o pedido:

- o **modelo como a Meta o tem agora**: o id dela, o cabeçalho, o corpo, o rodapé e os botões. Sem o texto, o pedido é
  recusado: quem aprova precisa ver o que sai. Editar o modelo no WhatsApp Manager muda o plano;
- as **variáveis** (de onde sai cada uma, com o valor das fixas: o cupom e o "10%" que o rascunho grava), a variável do
  título e o que o envio exige (`campanha.envio`);
- o **público**: o rótulo, as contagens e a **impressão de quem recebe** (o telefone e as variáveis de cada um, em
  ordem). Trocar a lista por outra do mesmo tamanho muda o plano;
- o custo estimado (moeda e centavos) e o **cupom** que veio no pedido (texto de terceiro: dado, até 40 e 200
  caracteres).

O orçamento da conta **não** entra: não é o que a pessoa aprova (ela fixa o teto do disparo), e o teto mexido pelo
dono não encerra o pedido. **Editar** o rascunho encerra o pedido aberto (`plano-mudou`) e **excluir** também
(`pedido-cancelado`), na mesma transação, com a campanha travada.

## As ferramentas (porta MCP)

Todas com `campanhas.disparar` (só `dms`), dentro da conta da credencial, e só para o aplicativo que pediu.

- **`campanha_disparo_pedir`** `{ chaveIdempotencia, id, confirmacao, pedidoPor, cupom? }`:
  1. a **chave primeiro**: a mesma chave com a mesma impressão devolve o pedido como está agora, aprovado ou não, também
     depois de a campanha ter saído; com outra impressão, `chave-reutilizada`;
  2. no máximo 20 pedidos esperando por conta;
  3. só o pedido novo passa pela conferência da porta (a campanha é deste aplicativo, nada impede, e a `confirmacao` é
     a do plano de agora), monta o plano e confere pelo pacote (`conferirPedidoNovo`);
  4. grava `aguardando` (`on conflict do nothing`): bateu na chave, é a repetição; bateu no índice da campanha,
     `aprovacao-pendente` com o id do pedido aberto;
  5. depois do commit: avisa quem aprova e registra no hub.
- **`acao_pedido_ler`** `{ id }`: o pedido como está agora (o que passou do prazo aparece vencido), com o link da tela.
- **`acao_pedido_cancelar`** `{ id }`: quem pediu desiste (`aguardando`/`aprovado` → `cancelado`, decidido por quem
  pediu). Cancelar de novo devolve o cancelado; o executado, o recusado e o vencido recusam com o problema deles.
- **A recusa** sai `isError` com a frase comum do pacote e `structuredContent` `{ problema, mensagem, pedido? }`
  (também o 503 da parada: é recusa, não erro nosso). O SDK 2.3.0 não valida o `outputSchema` quando há `isError`.

## A aprovação (API da tela)

Rotas na conta da sessão (`/api/v1/aprovacoes`); dono e operador veem, quem decide é conferido no **serviço**.

- `GET /aprovacoes` — os que esperam (pelo prazo) e os decididos nos últimos 30 dias; `podeAprovar` e
  `segundoFatorPorApp` de quem pergunta.
- `GET /aprovacoes/:id` — o pedido e o plano guardado. Se o plano de agora é outro, o pedido se encerra ali
  (`cancelado`, `plano-mudou`), na transação da tela; se a Meta não respondeu, nada se encerra e `conferido` volta
  falso.
- `POST /aprovacoes/:id/aprovar` `{ codigo, tetoCentavos, resumoVisto }`:
  1. quem pode (dono, ou `aprova_disparos`) e o teto (R$ 1,00 a R$ 1.000.000,00);
  2. o **código do aplicativo autenticador**: travado, recusa; errado, conta numa transação **própria** (a recusa
     desfaz a do pedido, a contagem fica) e trava no quinto; certo, gasta o passo numa transação própria (o mesmo
     `totp_ultimo_passo` da entrada: quem acabou de entrar espera o próximo código);
  3. a situação de agora primeiro (o vencido não vira cancelado); o aplicativo ainda ligado, com a permissão (senão o
     pedido se encerra); a parada do hub (recusa, sem encerrar); o plano de agora (mudou: encerra e responde o
     encerrado, sem lançar, para o encerramento confirmar);
  4. `conferirAprovacao` (pacote); o que impediria o disparo agora (recusa com a frase, sem gravar);
  5. `aprovado`, condicional a `aguardando`; e a tela **executa na mesma transação**.
  Responde o pedido, o resultado (`executado`, `encerrado` ou `adiado`) e o aviso.
- `POST /aprovacoes/:id/recusar` `{ motivo }` — `conferirRecusa`; motivo de 1 a 300 caracteres, volta a quem pediu.

## A execução

`executar` roda na transação de quem chama (a tela, ou a rotina numa `comConta`):

1. trava o pedido (`for update`); a situação de agora tem de ser `aprovado`;
2. o aplicativo ainda ligado (senão encerra) e sem parada (senão adia);
3. trava a campanha (a edição, a exclusão e outro disparo esperam) e refaz o plano: mudou, encerra (`plano-mudou`); a
   Meta não respondeu, adia;
4. num **ponto de salvamento**: `aprovado` → `executando`, o MESMO disparo da tela (`CampanhaService.disparar`, com o
   pedido; quem dispara é quem aprovou), a campanha guarda o pedido, `executado`. O disparo recusou (o WhatsApp caiu
   entre aprovar e executar, ou a Meta não respondeu): só o ponto de salvamento se desfaz, o pedido **segue aprovado** e
   a rotina tenta de novo até o prazo. `falhou` não é usado nesta versão.

**Rotina** (a cada minuto): vence o que passou do prazo (`vencido`, decidido pelo prazo), manda o lembrete na metade
(uma vez) e tenta de novo o aprovado parado há mais de 2 minutos, cada um na conta dele.

## O teto do disparo no worker

Antes de cada lote, na mesma trava por conta do orçamento, a campanha disparada por pedido confere o teto **do pedido**
(`folgaDoTeto`): o gasto é a regra do orçamento da conta restrita à campanha (`enviando` mais o que saiu cobrável, pela
tarifa de hoje); cabem = o que resta do teto, em micros, dividido pelo preço da mensagem da vez. **Fecha, nunca abre:**

- a moeda da conta diferente da do plano aprovado → nada cabe;
- uma mensagem que saiu sem tarifa → nada cabe;
- alguém da vez sem tarifa (o preço da rodada é o maior entre os que TÊM, e não o seguraria) → nada cabe.

Não cabe uma: a campanha pausa com `teto_aprovado`, que **não volta sozinha** e o `retomar` recusa no serviço; o
pedido executado ganha `motivo = teto-de-gasto`, e quem aprova é avisado no celular. Seguir pede um pedido novo, com
outro teto (o "continuar", abaixo). O registro do hub conta mudanças de situação: o teto, que não muda a situação, não
vai ao hub.

### O "continuar" (PR 2; decisão F5-6: passar do teto pede aprovação nova)

- **Quem pede:** o mesmo produto, por `campanha_disparo_planejar` e `campanha_disparo_pedir`, com o id da campanha
  parada no teto. O plano é o de quem falta (`aceitaram` = quem está na fila; o custo, o de quem falta) e leva
  `continuacao: { tetoAnteriorCentavos }`. Como a situação da campanha entra no plano, se ela sair da pausa no teto
  (cancelada), o pedido se encerra (`plano-mudou`) e nada sai.
- **Quem aprova:** o teto vale para a **campanha inteira** (a conta do worker soma o que ela já gastou) e tem de passar
  do gasto, senão ela pararia de novo na primeira rodada: a aprovação recusa com o gasto em reais. A tela mostra o teto
  de antes, o gasto, "faltam receber" e sugere o gasto mais o custo de quem falta.
- **A execução:** `CampanhaService.continuarNoTeto` (a campanha travada, as conferências do disparo para a campanha
  parada, a volta à fila condicionada a `pausada` + `teto_aprovado`, a auditoria `campanha.continuada` com o pedido). A
  campanha **segue guardando o pedido que a disparou** (`acao_pedido_id`, gravado uma vez pelo gatilho da 048); o teto
  que vale é o do **pedido em vigor** — o último executado (`pedidoEmVigor`) —, lido pelo worker, pelo detalhe da
  campanha e pela aprovação. Sem migration.
- **O que fecha o caminho:** o Disparar sem pedido recusa a campanha parada no teto (com a frase do pedido novo); o
  `oQueImpedeODisparo` só enxerga o continuar na campanha disparada por pedido; editar a campanha parada encerra o
  pedido aberto (`plano-mudou`), e cancelá-la o encerra (`pedido-cancelado`).

## Avisos e registro

- **A quem aprova** (dono e autorizados, ativos): e-mail, que nunca traz código, e aviso no celular (só a quem aprova,
  respeitando a preferência de campanhas), no pedido e no lembrete. Saem depois do commit e não lançam. WhatsApp não (a
  mensagem é cobrada).
- **Ao hub:** cada mudança de situação por `ClienteHub.registrarAcao(acaoParaRegistro(...))`, depois de a resposta
  sair (a transação já confirmou); desligado, nada.
- **Na trilha:** `acao_pedido.criado` (integração), `aprovado` / `recusado` (a pessoa), `executado` (quem aprovou),
  `cancelado` (sistema ou quem pediu), `usuario.aprova_disparos` (o dono).

## Testes

- `aprovacao.pg.spec.ts` (Postgres, como `regemcast_app`): os 8 casos comuns do pacote; o gatilho; o `delete` negado;
  o pedido gravado uma vez na campanha; um pedido aberto por campanha; a chave antes do plano; o limite de 20; o
  produto de fora; o plano que muda pela variável fixa (encerrado e gravado) e pelo texto na Meta; o aplicativo
  desligado; a parada do hub; o impedimento; o disparo recusado que deixa o pedido aprovado sem resíduo (o ponto de
  salvamento) e sai na tentativa seguinte; a rotina (lembrete uma vez, vencido pelo prazo); o cancelamento por quem
  pediu; o código errado que fica contado e trava; o código usado uma vez; sem o aplicativo autenticador; o operador
  com e sem a permissão; a folga do teto (preço, gasto, moeda, tarifa); o "continuar" (o teto igual ao gasto
  recusado, o maior aprovado e executado, a campanha de volta à fila guardando o primeiro pedido, o pedido em vigor
  com o teto novo) e a campanha cancelada depois do pedido do continuar (`plano-mudou`).
- `campanha.service.spec.ts`: o Disparar sem pedido da campanha parada no teto; o `oQueImpedeODisparo` do continuar
  (só por pedido); o `continuarNoTeto` (e a recusa fora da pausa no teto); cancelar a campanha parada encerra o
  pedido; o worker confere o teto do pedido em vigor e anota a parada nele.
- `mcp.porta.spec.ts`: as três ferramentas pela porta HTTP, a recusa estruturada (também a da parada), o cupom fora da
  forma, a conferência da porta no pedido novo e `DISPARO_SO_COM_APROVACAO` fechando o `campanha_disparar`.
- O manifesto (`docs/dms-manifesto.json`) regravado: contrato **1.1.0** (aditiva).

## A tela (PR 2)

- **Campanhas › Para aprovar** (`/campanhas/para-aprovar`): os pedidos que esperam (pelo prazo, com o número no menu,
  lido do resumo da conta: `aprovacoesEsperando`) e os decididos nos últimos 30 dias, cada um numa frase. Qualquer
  pessoa da conta vê.
- **O pedido aberto** (`/campanhas/para-aprovar/:id`): quem pede (o agente ou uma pessoa do produto de origem), a
  mensagem como sai (o corpo do modelo da Meta com o valor das variáveis fixas no lugar e as de cada pessoa como
  marcador), para quem e quanto, o cupom com o aviso de que a oferta obriga a loja, o código curto do plano e o teto
  em reais. Aprovar abre o diálogo do código do aplicativo autenticador; recusar, o do motivo (os dois pelo `<dialog>`
  nativo: o foco preso nele, Esc fecha, o foco volta a quem abriu). Sem o aplicativo ligado, o botão fica desligado e a
  frase aponta Conta e usuários › Segurança do seu acesso. A operadora vê o pedido e o aviso de que só o dono aprova.
  Se a Meta não respondeu ao abrir, a tela diz que o plano não foi conferido agora (aprovar confere de novo).
- **Conta e usuários:** a coluna "Aprova disparos" (o dono: sempre; outro acesso: o dono liga e desliga, `aria-pressed`).
- **O detalhe da campanha:** o teto e o gasto do disparo aprovado (a MESMA conta do worker, `folgaDoTeto`, pelo pedido
  em vigor), e o aviso da pausa no teto.
- **O pedido do "continuar":** o aviso do teto de antes e do gasto, "faltam receber", o teto "da campanha inteira" com
  a sugestão do gasto mais o custo de quem falta, e a recusa na própria tela se o teto não passar do gasto.
- **As frases dizem só o que acontece:** depois de aprovar, "a decisão já aparece no pedido para quem pediu" (o aviso
  assinado a quem pediu é o PR 3); depois de recusar, "o motivo volta para" quem pediu.
- **No menu, o item aceso é o de caminho mais longo** que casa com a página: em "Para aprovar", "Campanhas" não acende
  junto.

## O aviso assinado a quem pediu (PR 3; decisão F5-7; migration 049)

O produto que pediu um disparo fica sabendo na hora que o pedido mudou. É o modelo do Regem para os produtos da DMS
(`webhook-integracao.ts` de lá; Padrão §9).

- **O registro, pela porta MCP:** `aviso_registrar { url, segredo }`, `aviso_ler` e `aviso_remover` valem para qualquer
  credencial; o serviço recusa o produto de fora (403). O endereço só vale dentro da base do produto, fixa no código
  (`BASES_DE_AVISO`: o Liame recebe em `https://api.agencialiame.com/v1/inbox/regemcast/<id da conexão>`, a caixa de
  entrada por conexão que ele já tem), pela regra do pacote (`destinoAvisoPermitido`). O segredo `whsec_` é do produto;
  fica cifrado com a chave das integrações (`integracao_aviso`) e nunca volta. Um por conta e produto; registrar de
  novo troca e religa o pausado.
- **A fila:** o gatilho `rc_acao_pedido_aviso` (a cada mudança de situação, ou do motivo — o teto) põe o aviso em
  `aviso_saida`, se o produto registrou e não está pausado. Criar o pedido não avisa (quem pediu já tem a resposta).
  Um pendente por pedido: a mudança que chega com outro na fila só marca `mudou_em` e adianta a tentativa.
- **O corpo:** `{"tipo":"acao.alterada","id":"<id do pedido>"}` — só o gatilho, nunca dado pessoal. Quem recebe lê o
  pedido por `acao_pedido_ler`. Assinatura Standard Webhooks (`cabecalhosAviso` do pacote); o `webhook-id` é o id da
  linha, o mesmo em todas as tentativas (quem recebe descarta o repetido).
- **A entrega (`AvisoAssinadoJob`, a cada 15 s):** reserva os devidos (`skip locked`, a próxima tentativa empurrada 2
  minutos), manda cada um FORA de transação (POST, sem seguir redirecionamento, 10 s de prazo) e grava o desfecho:
  - **2xx:** entregue — mas só se o pedido não mudou depois da reserva (`mudou_em`); se mudou, sai de novo;
  - **falha** (outro status ou sem resposta): recuo de 30 s, 2 min, 10 min, 30 min, 2 h, 6 h, 12 h e 24 h; depois,
    desiste daquele aviso (a consulta continua valendo). **20 falhas seguidas** do produto na conta pausam o registro;
  - **antes de mandar:** a credencial do produto na conta tem de seguir valendo, com `campanhas.disparar` (a ligação
    revogada não recebe o que estava na fila — desiste); a parada do hub (o aplicativo, a ligação ou `aviso
    acao.alterada`) segura sem contar falha;
  - **cada tentativa vai ao registro do hub** (`registrarAviso`): para quem, o tipo, o resultado, a tentativa e só a
    origem do destino. Nunca o conteúdo.
- **Contrato 1.2.0 (aditiva):** as três ferramentas e o aviso `acao.alterada` no manifesto (`x-dms-avisos`).
- **Testes:** `aviso-assinado.regras.spec.ts` (a base, o registro, o corpo, o recuo); `aviso-assinado.pg.spec.ts`
  (Postgres, como `regemcast_app`: o registro cifrado e as recusas; o gatilho — sem registro nada, um pendente por
  pedido, a mudança que só marca, pausado não recebe; a assinatura que confere com o segredo registrado e o webhook-id
  da linha; a falha que recua e desiste; a pausa; a mudança durante o envio, que sai de novo; a credencial que deixou de
  valer; a parada; remover; a RLS); `mcp.porta.spec.ts` (as três pela porta HTTP).
- **Do lado do Liame** (parte D): registrar o endereço ao ligar a conta e ler o pedido a cada aviso.

## O Liame pede pelo clique (F5 parte D, lado do RegemCast)

O Liame só lia o RegemCast pela ligação do clique (decisão B1-3: gravar fica fora até a F5). Para a parte D (o Liame
pede o disparo e espera o destino, decisão F5-9), a autorização por clique ganhou o que ele precisa para gravar:

- **Catálogo:** as opcionais `modelos.rascunhar`, `campanhas.rascunhar` e `campanhas.disparar` no aplicativo do Liame,
  com o motivo e o que acontece desligada; nascem desligadas, o dono liga cada uma. Na tela, `campanhas.disparar`
  aparece como "Pedir o disparo de campanha", que é o que a ligação pode.
- **O que o servidor garante:** pela ligação, `campanha_disparar` recusa sempre (`SO_PELO_PEDIDO`, conferido pela via
  de quem chega, `IntegracaoAutenticada.via`, fechado por padrão): o disparo só sai por `campanha_disparo_pedir`, com a
  aprovação de uma pessoa da conta (código do aplicativo autenticador e teto de gasto). O rascunho e a pausa são só
  do próprio aplicativo (`aPropria`, `modelo_rascunhar` com `id`).
- **Tela e e-mail (texto versão 2):** com gravação no pedido, a abertura diz que o disparo só sai com a aprovação aqui,
  e o "O que não pode" troca "não inclui envio" por "Disparar sem a sua aprovação" e "Mexer no que não é dele"; o
  e-mail ao dono troca "pode ver" por "Liberado ao …" e diz o que ele não pode. Sem gravação, o texto de sempre. No
  "pede mais", cada opcional nova tem a sua chave (o dono desliga a que não quer).
- **A ligação vale com as permissões que ela E o token do DMS ID têm:** o Liame também pede ao DMS ID as permissões de
  gravar do RegemCast.
- **A parte E do RegemCast (decisão F5-8):** a chave `LIAME_ESCRITA_SO_PELA_LIGACAO` (desligada) tira a escrita do
  token antigo (`rct_it_`) do Liame: `escrita-pela-ligacao.ts` diz, por produto, as permissões que saem
  (`modelos.rascunhar`, `campanhas.rascunhar`, `campanhas.disparar`); a autenticação pelo token devolve os escopos sem
  elas (a porta nem lista as ferramentas de gravar para ele), e a conferência do aviso assinado deixa de contar esse
  token como credencial que dispara. A ligação do clique segue com o que ela e o token do DMS ID têm. Liga-se depois
  que o Liame pedir um disparo de teste pela ligação.

## O que fica de fora

- O app Android: a tela de aprovação é do site; o aviso no celular abre o site.
- O console da distribuição não aprova nada (a aprovação é da conta).
