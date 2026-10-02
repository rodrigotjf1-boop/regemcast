# Isolamento entre contas (RLS)

O Regemcast é multi-conta: cada cliente tem a própria lista de contatos, os
próprios modelos e as próprias campanhas. Vazar dado de uma conta para outra não
é bug de tela — é incidente. Por isso o isolamento **não** mora no `where` de
cada consulta. Ele mora no banco, e o `where` é só conveniência.

## Como funciona, em uma frase

A API conecta como `regemcast_app`, um usuário **sem `BYPASSRLS`**; toda consulta
roda dentro de uma transação que definiu antes o GUC `app.conta_id`; e cada
tabela tem uma policy que compara `conta_id` com esse GUC. Sem GUC, nada casa e
a consulta volta vazia.

## As peças

### 1. O usuário do banco não pode ignorar a RLS

`database/migrations/000_roles.sql` cria `regemcast_app` com
`nosuperuser nocreatedb nocreaterole noreplication nobypassrls`. É o mínimo que
a API precisa e nada além. Superusuário **ignora RLS inteira**, em silêncio —
por isso a API nunca conecta como `postgres`.

### 2. Dois GUCs, definidos por transação

| GUC            | Valores                  | Quem define                               |
| -------------- | ------------------------ | ----------------------------------------- |
| `app.conta_id` | uuid da conta do request | `ContextoDb.comConta()`                   |
| `app.escopo`   | `tenant` (padrão) ou `sistema` | `ContextoDb.comConta()` / `comEscopoSistema()` |

Os dois são definidos com `set_config(..., true)` — o `true` final significa
**"local à transação"**. Terminou a transação, o valor some. Isso é o que torna
seguro usar pool de conexões: uma conexão devolvida ao pool não leva a conta do
request anterior grudada nela.

### 3. As policies

`001_fundacao.sql` traz duas funções e as aplica em cada tabela:

```sql
-- tabela de conta: só enxerga a linha da própria conta
create policy rc_isolamento on <tabela>
  using      (conta_id = rc_conta_atual() or rc_escopo_sistema())
  with check (conta_id = rc_conta_atual() or rc_escopo_sistema());

-- tabela da distribuição (catálogo de planos, lista de espera):
-- ninguém em escopo de conta enxerga
create policy rc_sistema on <tabela>
  using (rc_escopo_sistema()) with check (rc_escopo_sistema());
```

`using` filtra o que se **lê**; `with check` valida o que se **escreve**. Os dois
juntos: você não lê linha de outra conta e não consegue gravar linha carimbada
com outra conta.

Toda tabela também recebe `force row level security`. Sem o `force`, o **dono**
da tabela continua enxergando tudo — e em dev é comum rodar como dono, o que
daria a falsa impressão de que está tudo certo.

### 4. Fail-closed por construção

`rc_conta_atual()` faz `current_setting('app.conta_id', true)`, que devolve
`null` quando o GUC não existe. `null = conta_id` é `null`, que **não é
verdadeiro** — logo a linha não passa. Um caminho de código que esqueça de abrir
contexto não vaza nada: ele simplesmente não enxerga nada, e o bug aparece no
primeiro teste em vez de aparecer no cliente errado.

No código, `ContextoDb.db` estoura fora de contexto, com mensagem explícita.
Esquecer o contexto é erro barulhento, não silencioso.

## `comEscopoSistema` — a exceção, e por que ela é exceção

`comEscopoSistema(motivo, fn)` liga `app.escopo = 'sistema'`, e nesse escopo as
policies deixam passar tudo. É a chave mestra. Ela existe porque há caminhos que
precisam enxergar **antes de saber qual é a conta** — e porque a distribuição,
quem opera o Regemcast, não é uma conta.

Só existem **três motivos** que autorizam a chave mestra, e todo uso precisa
caber em um deles. O terceiro, (C), foi escrito em 27/09/2026 para dar nome ao
que o console da distribuição já fazia; um motivo novo continua sendo decisão de
arquitetura.

**(A) A conta ainda não é conhecida — ou ainda não existe.** O request, o job ou
o aviso de fora chega sem conta; a chave mestra serve para achar de quem é o
trabalho.

| Uso | Onde | Por quê |
|---|---|---|
| `auth.login` | `auth.service.ts` | Chega e-mail e senha; achar o usuário exige procurar entre todas as contas. Assim que acha, o fluxo passa para `comConta`. |
| `auth.revalidar` | `auth.guard.ts` | O guard revalida o usuário a cada request — e roda **antes** do interceptor que abre o contexto da conta. |
| `auth.login.segunda_etapa` | `auth.service.ts` | Depois do código da segunda etapa, a sessão nasce da pré-sessão, que não abre conta no request: lê o usuário pelo id dela e a conta dele, e confere que os dois estão ativos. Duas leituras e acaba. |
| `segunda-etapa.buscar`, `segunda-etapa.passo`, `segunda-etapa.falha`, `segunda-etapa.zerar` | `segunda-etapa.service.ts` | O código da segunda etapa chega com a pré-sessão, sem conta no request: lê o usuário pelo id dela, grava o passo do código aceito (uso único, atômico), conta a falha (trava depois do teto) e zera as falhas no acerto. Cada comando é no id do usuário. |
| `auth.recuperar.buscar` | `auth.service.ts` | "Esqueci a senha" chega só com o e-mail, sem sessão: acha o usuário entre todas as contas para emitir o código. A resposta é a mesma exista ou não o e-mail. |
| `auth.recuperar.redefinir` | `auth.service.ts` | Com o código conferido, troca a senha do usuário ativo daquele e-mail, derruba as sessões (versão do token) e destrava. Um `update` e acaba. |
| `codigo.emitir.*`, `codigo.conferir.*` | `codigo-verificacao.service.ts` | Os códigos por e-mail (`*` = a finalidade: recuperar a senha, confirmar o convite…) vivem em `codigo_verificacao` (policy `rc_sistema`), antes de haver sessão, e são achados pelo e-mail. Emitir serializa por e-mail e finalidade (espaço entre envios); conferir trava a linha e conta o erro na própria transação. |
| `auth.convite.previa`, `auth.convite.codigo`, `auth.convite.cnpj`, `auth.convite.conferir` | `auth.service.ts` | O convite é lido pelo hash do token, antes de existir conta (`lista_espera`, policy `rc_sistema`): para mostrar a tela, mandar o código, consultar o CNPJ e conferir tudo antes de gastar o código. |
| `auth.convite.cnpj_repetido` | `auth.service.ts` | Uma conta por CNPJ: saber se o CNPJ já tem conta exige olhar todas. Devolve só sim ou não. |
| `auth.convite.aceitar` | `auth.service.ts` | É a transação que **cria** a conta. |
| `lista-espera.cadastro`, `lista-espera.listar`, `lista-espera.capacidade`, `lista-espera.convite`, `lista-espera.recusa` | `lista-espera.service.ts` | `lista_espera` vive antes da conta e tem policy `rc_sistema`: nenhuma linha dela pertence a uma conta. |
| `aviso.registrar_dispositivo` | `aviso.service.ts` | O token do aparelho (FCM) é único na base, e o mesmo celular pode ter sido de outra pessoa ou de outra conta: registrar move a linha daquele token para quem entrou agora (e volta as preferências ao padrão se a pessoa mudou). Um `upsert` na linha do token. |
| `meta.webhook.registrar` | `webhook.service.ts` | O aviso da Meta chega sem sessão, autenticado só pela assinatura HMAC: cada mudança vira uma linha em `wa_evento` (policy `rc_sistema`), com chave de idempotência — reentrega da Meta não duplica. |
| `meta.webhook.ler`, `meta.webhook.concluir`, `meta.webhook.falha` | `webhook.service.ts` | O processamento acorda sem conta: lê o lote pendente de `wa_evento` e, depois de aplicar cada evento (cada aplicação acha a própria conta), marca concluído ou conta a falha. Um comando em `wa_evento` por vez. |
| `meta.webhook.status` | `webhook.service.ts` | O status de entrega chega identificado por `wamid`, não por conta. Encontrar o destinatário exige enxergar entre contas — e a guarda de ordem vai no próprio `where`, então o escopo dura o `update` e acaba. |
| `meta.webhook.pausar` | `webhook.service.ts` | A recusa que chega pelo aviso de entrega e não é de quem recebe (pagamento da conta, conta restrita, modelo pausado — `alcance` conta ou modelo do catálogo) pausa a campanha, para as próximas mensagens não terem a mesma resposta. O aviso chega pelo `wamid`, sem conta: as campanhas são as dos destinatários que o `update` do escopo `meta.webhook.status` acabou de achar, e o `update` só toca as que ainda estão saindo (`agendada`, `enviando`). Dura o comando e acaba. |
| `meta.webhook.resposta` | `webhook.service.ts` | A resposta da pessoa à mensagem da campanha chega com o `context.id` = o `wamid` da nossa mensagem, pelo número, sem conta. O `update` de `respondida_em` é pelo `wamid` (único), dura o comando e acaba. A falha 131026 que marca o contato "sem WhatsApp" roda dentro do escopo `meta.webhook.status`, com a conta do destinatário que o próprio `update` achou. |
| `meta.webhook.saida.conta` | `webhook.service.ts` | O pedido de saída (botão "Parar promoções", mensagem "sair") e a preferência de marketing do WhatsApp (`user_preferences`) chegam pelo número, sem conta: acha a conta dona do `phone_number_id`. Dura o `select` e acaba. |
| `meta.webhook.saida.bloquear` | `webhook.service.ts` | Com a conta achada, bloqueia a pessoa nas duas formas do celular (cria a linha só se não existir), tira da fila o que ainda não saiu. Todo comando leva o `conta_id` achado. Também para a falha 131050 ("parou o marketing"), com a conta que o `update` do status achou. |
| `meta.webhook.preferencia.liberar` | `webhook.service.ts` | A pessoa voltou a aceitar marketing pelo WhatsApp (`user_preferences` = `resume`): desfaz só o bloqueio de origem `preferencia_whatsapp`, só de quem tem autorização registrada, na conta achada pelo número. Um `update` e acaba. |
| `meta.webhook.modelo` | `webhook.service.ts` | Os avisos sobre um modelo (status, qualidade, mudança de categoria) chegam pelo id dele na Meta e pela WABA, sem conta: acha o modelo por esse id — ou a conta pela WABA, quando o modelo nasceu fora do Regemcast —, lê o fuso da conta para a hora do aviso e, na mudança de categoria, grava a nova em `categoria_meta`. |
| `meta.webhook.qualidade`, `meta.webhook.sincronizacao` | `webhook.service.ts` | A qualidade do número e o fim (ou a falha) da cópia do histórico da coexistência chegam pelo `phone_number_id`: um `update` no número. |
| `meta.webhook.limite` | `webhook.service.ts` | O limite de envio (`business_capability_update`) chega pelo número ou só pela WABA: um `update` nos números achados. |
| `meta.agenda.lote` | `agenda.service.ts` | Um lote da agenda do celular (`smb_app_state_sync`) chega identificado pelo número. A transação acha o número, trava a linha e grava os contatos **daquela** conta — todo `insert`/`update` leva o `conta_id` do número achado. |
| `meta.agenda.reenfileirar` | `agenda.service.ts` | A retomada devolve à fila os lotes de agenda e histórico guardados de números que já têm resposta. É um `update` em `wa_evento` (tabela `rc_sistema`) cruzado com `wa_numero` de todas as contas — a cada minuto só números com resposta dos últimos 7 dias; na subida do servidor, sem janela. |
| `meta.conversas.historico`, `meta.conversas.ecos`, `meta.conversas.recebidas` | `conversas.service.ts` | Histórico, ecos do celular e mensagens ao vivo chegam pelo número. A transação acha o número, trava a linha e grava conversas e mensagens **daquela** conta — todo `insert`/`update` leva o `conta_id` do número achado. |
| `coexistencia.expirar` | `coexistencia.job.ts` | Varredura entre contas: o job acorda sem sessão para carimbar quem passou das 24 horas da coexistência sem sinal da cópia. Só carimba o estado — regra de negócio nenhuma acontece aqui. |
| `coexistencia.concluir` | `coexistencia.job.ts` | Mesma varredura, antes de expirar: conclui quem já tem, no registro de eventos (tabela `rc_sistema`), um lote de histórico com 100%. Só carimba o estado. |
| `coexistencia.fila` | `coexistencia.job.ts` | Lê a fila de números com sincronização pendente, de todas as contas. A ação em cima de cada um acontece em `comConta`, dentro do `MetaService`, que é onde o token daquele cliente pode ser lido. |
| `conversas.retencao.contas` | `conversa.retencao.ts` | O job de prazo de guarda acorda sem conta: lê quais contas têm prazo definido. Dura o `select` e acaba — o apagamento roda em `comConta`, uma conta por vez. |
| `meta.limite.vencidos`, `meta.limite.gravar` | `limite.job.ts` | O job relê o limite de envio da Meta de todos os números, de 6 em 6 horas: um `select` entre contas para achar os vencidos (com o token cifrado de cada um) e um `update` por número, no id dele, depois da chamada à Meta — nunca durante. |
| `meta.saude.vencidas`, `meta.saude.ler`, `meta.saude.gravar` | `saude.job.ts`, `saude.service.ts` | A saúde da conta na Meta (`health_status`, moeda, fuso e forma de pagamento) é relida a cada 30 minutos pelo job, e na hora quando chega o aviso `account_update` — os dois sem conta no contexto. Um `select` entre contas acha as de leitura vencida (com o token cifrado); a conta e os números são lidos; a chamada à Meta acontece FORA de qualquer transação; a gravação é pelo `id` da conta e de cada número lidos. É o que avisa o dono de que a Meta bloqueou o envio antes de ele disparar. |
| `meta.webhook.conta` | `webhook.service.ts` | O aviso `account_update` chega pela WABA (`entry.id`), sem conta. Quando traz o negócio dono dela (`owner_business_id`), guarda-o — só se ainda não havia —, porque é com ele que se monta o endereço do pagamento na Meta. O `update` é pela `waba_id` (única), dura o comando e acaba. |
| `campanha.worker.listar`, `campanha.worker.ler`, `campanha.worker.reivindicar`, `campanha.worker.iniciar`, `campanha.worker.pausar`, `campanha.worker.desacelerar`, `campanha.worker.concluir`, `campanha.worker.presos` | `campanha.service.ts` | O worker do disparo acorda sem sessão e roda as campanhas ativas de todas as contas. Cada escopo dura um passo curto — listar, ler, reservar (com a trava por conta e as marcações da fila: quem saiu, sem WhatsApp, cashback usado), marcar início, pausar, desacelerar, concluir, soltar presos — e todo comando leva o `id` da campanha ou o `conta_id` dela; nenhuma transação fica aberta durante a chamada à Meta. |
| `assinatura.virar_ciclo` | `assinatura.job.ts` | O job vira o ciclo das assinaturas vencidas de todas as contas (a redução de plano agendada entra, a renovação cancelada encerra) e devolve à fila as campanhas daquelas contas pausadas por falta de saldo. Um `update` pela data, em lotes. |
| `cobranca.aviso.*` | `cobranca.job.ts` | O job dos avisos de fim do grátis acorda sem conta: marca e devolve, numa tacada, as assinaturas da janela (`*` = a marca do aviso) e lê o e-mail dos donos delas para mandar. Outra réplica no mesmo instante não pega as mesmas. |
| `cobranca.inadimplentes` | `cobranca.job.ts` | O job marca inadimplente quem passou do grátis sem pagar, entre todas as contas: um `update` pela data. |
| `cobranca.aviso.registrar`, `cobranca.aviso.marcar` | `cobranca.service.ts` | O aviso do Mercado Pago chega sem sessão, conferido pela assinatura secreta: vira uma linha em `evento_mercadopago` (policy `rc_sistema`, idempotente pelo `x-request-id`) e depois é marcado processado, ou com o erro. |
| `cobranca.sincronizar_assinatura`, `cobranca.sincronizar_fatura` | `cobranca.service.ts` | Depois de reler no Mercado Pago (fora da transação), a assinatura ou a fatura é achada pelo id dela lá ou pela nossa referência externa — o aviso não traz conta — e aplicada ali: todo comando leva o id da assinatura e a conta achados. |
| `cardapioweb.retomar` | `cardapioweb.service.ts` | A cada minuto, o job procura importações de clientes do Cardápio Web que ficaram órfãs (servidor reiniciou no meio), entre todas as contas. Dura o `select` e acaba — a importação roda em `comConta`, uma conta por vez. |
| `cardapioweb.pedidos.fila` | `cardapioweb.pedidos.job.ts` | A cada 15 s, o job reserva até 8 lojas com a busca de pedidos pendente, entre todas as contas: um `update` com CTE materializada que só grava a trava (`pedidos_trava_ate`) e devolve o `conta_id`. O passo de cada loja — chamadas ao Cardápio Web, compras, totais — roda em `comConta`, e nenhuma transação fica aberta durante a chamada. |
| `cardapioweb.saldos.fila` | `cardapioweb.saldos.job.ts` | A cada 10 s, o job reserva até 8 lojas com a leitura diária do cashback vencida (4h no fuso da conta), entre todas as contas: um `update` com CTE materializada que só grava a trava (`saldos_trava_ate`) e devolve o `conta_id`. O passo de cada loja — até 5 páginas de clientes, com os saldos e os bloqueios — roda em `comConta`, e nenhuma transação fica aberta durante a chamada ao Cardápio Web. |
| `regem.fila` | `regem.job.ts` | A cada 20 s, o job reserva até 8 contas com a leitura do Regem pendente (leitura completa em andamento, ou em dia com a consulta das mudanças vencida), entre todas as contas: um `update` com CTE materializada que só grava a trava (`trava_ate`) e devolve o `conta_id`. O passo de cada conta — chamadas ao Regem, contatos, compras, totais — roda em `comConta`, e nenhuma transação fica aberta durante a chamada. |

**(B) O registro precisa sobreviver ao rollback da operação.**

| Uso | Onde | Por quê |
|---|---|---|
| `auditoria` | `auditoria.service.ts` | Só em `registrarForaDeContexto`. Uma tentativa de login recusada precisa ficar registrada justamente quando a transação do request não vinga. |
| `telemetria.registrar` | `telemetria.service.ts` | O erro vai para `evento_erro` numa transação própria: precisa ficar justamente quando o request falha e a transação dele volta. A tabela é da distribuição (policy `rc_sistema`): nenhuma conta a lê. |

**(C) O ator é a distribuição, não uma conta.** O console da distribuição é de
quem opera o Regemcast. O operador entra com senha e código do aplicativo
autenticador (segredo próprio, fora do login dos clientes), e cada ação dele
fica em `acesso_distribuicao`. As tabelas da distribuição têm a policy
`rc_sistema`: nenhuma conta as lê, nem as próprias linhas. O que o console lê
das contas é agregado — uso, envios, situação, erros —, sem conteúdo de
mensagem nem contato. O que ele escreve numa conta são ações de suporte numa conta nomeada —
zerar as duas etapas, estender o grátis, ligar a conta ao Regem —, que ficam
também na auditoria da própria conta.

| Uso | Onde | Por quê |
|---|---|---|
| `distribuicao.criar_operador` | `distribuicao-auth.service.ts` | Faz nascer um operador (`operador_distribuicao`). A rota não tem sessão: é protegida pela chave da distribuição (`x-dist-token`), e é a única coisa que essa chave ainda faz no console. |
| `distribuicao.entrar`, `distribuicao.buscar_operador`, `distribuicao.totp_iniciar`, `distribuicao.totp_ativar`, `distribuicao.totp_passo`, `distribuicao.falha`, `distribuicao.sessao` | `distribuicao-auth.service.ts` | O login do operador (senha e código do aplicativo): lê e atualiza só a linha dele em `operador_distribuicao`. |
| `distribuicao.registrar_acesso` | `distribuicao-auth.service.ts` | Cada ação do console grava quem fez o quê em `acesso_distribuicao` — também o login recusado. |
| `distribuicao.contas`, `distribuicao.resumo` | `distribuicao-leitura.service.ts` | O painel das contas: consulta agregada sobre todas (uso do ciclo, envios, último login, situação), até 500 linhas. Só leitura. |
| `distribuicao.acessos` | `distribuicao-leitura.service.ts` | Quem tem acesso a uma conta nomeada, com o método das duas etapas — nunca segredo nem hash. |
| `distribuicao.telemetria` | `distribuicao-leitura.service.ts` | Os erros de todas as contas, agrupados pelo código (`evento_erro`). |
| `distribuicao.zerar_duas_etapas` | `distribuicao-leitura.service.ts` | Suporte, depois de conferir a identidade por fora: desliga as duas etapas de um usuário nomeado, destrava e derruba as sessões. Fica também na auditoria da conta, visível ao cliente. |
| `distribuicao.estender_gratis` | `distribuicao-leitura.service.ts` | Estende o grátis de uma conta nomeada (negociação, conta interna) e devolve à fila as campanhas dela paradas por falta de pagamento. Não mexe em quem já paga. |
| `distribuicao.planos.listar`, `distribuicao.planos.criar`, `distribuicao.planos.atualizar` | `distribuicao-planos.service.ts` | O catálogo de planos (`plano`, policy `rc_sistema`) é da distribuição; a listagem conta quantas contas há em cada plano. |
| `distribuicao.regem` | `regem.service.ts` | A lista do console: as contas ligadas ao Regem, com o nome da conta, a empresa, a situação da leitura e a 99 (autorizada pelo dono × liberada no token), primeiro as que esperam por nós. Só leitura, nunca o token. Ligar e desligar uma conta nomeada rodam em `comConta`, sem a chave mestra. |
| `whatsapp.conectar-manual` | `meta.service.ts` | A rota é da distribuição e não tem sessão: o operador informa qual conta está conectando, e antes de qualquer chamada à Meta é preciso confirmar que ela existe. Dura o `select` e acaba — a gravação acontece em `comConta`. |

Quando um caminho novo aparecer, a pergunta não é "posso usar?", e sim **em qual
dos três motivos ele cabe**. Se não couber em nenhum, o caminho está errado —
não a regra.

Repare no padrão que os usos do `coexistencia.job` seguem, porque ele é a forma
certa de um job de fundo usar a chave mestra: escopo de sistema **só para
descobrir de quem é o trabalho**, e a partir daí `comConta`. O que o job faz em
escopo de sistema é carimbar estado; o que exige token, decisão ou dado do
cliente acontece dentro da conta.

Regras de uso:

- O `motivo` é obrigatório e vira o GUC `app.motivo_sistema` — dá para lê-lo em
  trigger, log e depuração para saber **por que** aquela transação abriu a chave
  mestra. É texto fixo; a parte variável (a finalidade do código, a marca do
  aviso) vai no fim, e aqui aparece como `*`.
- O escopo de sistema dura o **menor** trecho possível: descobre a conta, sai.
  Nunca envolva regra de negócio inteira em `comEscopoSistema`.
- Um uso novo que não caiba em nenhum dos três motivos é decisão de
  arquitetura, não detalhe de implementação — discuta antes. Cada porta a mais
  na chave mestra é uma a mais para alguém errar depois.
- Auditoria de operação em escopo de sistema grava `ator_tipo = 'sistema'` (ou
  `distribuicao`, quando é o console).

Para revisar todos os usos de uma vez:

```bash
grep -rn "comEscopoSistema" backend/src --include=*.ts | grep -v spec
```

**A tabela anda com o código.** `backend/src/db/escopos-sistema.spec.ts` lê
todos os `comEscopoSistema` do código e esta seção, e falha se um nome do
código não tiver linha aqui, se uma linha citar nome que não existe mais, ou se
o nome não for texto à vista. Completada em 27/09/2026 com 90 nomes; em
29/09/2026 os 4 que abriam a chave mestra com a conta já conhecida
(`auth.renovar`, `aviso.remover_dispositivo`, `aviso.alvos`,
`aviso.limpar_tokens`) passaram para `comConta` — ficam 86, todos em um dos três
motivos. Em 30/09/2026 entraram `regem.fila` e `distribuicao.regem` (a integração
com o Regem): 88.

## Teste manual: provar que a RLS pega

Este teste **não funciona** no SQL Editor do Supabase sem o `set role`: lá você
está logado como `postgres`, que é superusuário e ignora RLS — tudo passaria e
você concluiria, errado, que está protegido.

### Preparação: duas contas e um usuário em cada

Rode como `postgres` (SQL Editor ou `psql` com a `MIGRATION_DATABASE_URL`):

```sql
-- duas contas de teste
insert into conta (nome) values ('Conta A') returning id;  -- anote como <A>
insert into conta (nome) values ('Conta B') returning id;  -- anote como <B>

-- um usuário em cada (senha_hash é texto qualquer aqui; é só teste)
insert into usuario (conta_id, nome, email, senha_hash, papel)
values ('<A>', 'Ana',  'ana@teste.local',  'x', 'dono');
insert into usuario (conta_id, nome, email, senha_hash, papel)
values ('<B>', 'Bruno','bruno@teste.local','x', 'dono');
```

### O teste

Ainda no SQL Editor, mas **assumindo o papel da aplicação**:

```sql
begin;

-- a partir daqui você é regemcast_app: sem bypassrls, sujeito às policies
set local role regemcast_app;

-- 1) sem GUC nenhum: fail-closed. Esperado: 0 linhas.
select count(*) as sem_contexto from usuario;

-- 2) entrando na conta A
select set_config('app.conta_id', '<A>', true);

--    Esperado: 1 (só a Ana)
select count(*) as na_conta_a from usuario;

--    Esperado: 0 linhas — a linha do Bruno EXISTE, mas não para a conta A.
--    Repare que o filtro é explícito pela conta B e mesmo assim não volta nada.
select id, nome, email from usuario where conta_id = '<B>';

-- 3) tentar ESCREVER na conta B estando na conta A.
--    Esperado: erro 42501 "new row violates row-level security policy".
insert into usuario (conta_id, nome, email, senha_hash)
values ('<B>', 'Invasor', 'invasor@teste.local', 'x');

rollback;
```

O resultado que prova o isolamento:

| Passo | Esperado | Se vier diferente |
| --- | --- | --- |
| 1 | `0` | O GUC está sendo herdado de outro lugar, ou a policy está com `or true`. |
| 2 (count) | `1` | Mais que isso: a policy da tabela está errada ou não existe. |
| 2 (select da B) | 0 linhas | **Qualquer linha aqui é vazamento.** Pare tudo. |
| 3 | erro `42501` | Inserção aceita significa `with check` ausente na policy. |

Se o passo 1 voltar o total de usuários do banco em vez de `0`, quase sempre é
um destes: você esqueceu o `set local role regemcast_app`, ou o role foi criado
com `bypassrls`. Confira:

```sql
select rolbypassrls from pg_roles where rolname = 'regemcast_app';  -- false
```

### A mesma prova pelo `psql`, sem `set role`

Mais fiel ao que a API faz, porque conecta de verdade como o usuário dela:

```bash
psql "postgres://regemcast_app:SENHA@localhost:5432/regemcast"
```

```sql
begin;
select count(*) from usuario;                       -- 0
select set_config('app.conta_id', '<A>', true);
select count(*) from usuario;                       -- 1
select * from usuario where conta_id = '<B>';       -- 0 linhas
rollback;
```

### Limpeza

```sql
delete from usuario where email in ('ana@teste.local','bruno@teste.local');
delete from conta where nome in ('Conta A','Conta B');
```

(`auditoria` é append-only: linha registrada lá não se apaga, por trigger e por
permissão. Se o teste gerou auditoria, ela fica — e é assim mesmo.)

## O que quebra o isolamento (lista de vigilância)

- Conectar a API como `postgres`, ou dar `bypassrls` ao role da aplicação.
- Criar tabela com `conta_id` e **esquecer** de ligar a RLS na mesma migration.
  Por isso a regra é: `select rc_rls_conta('tabela');` logo abaixo do
  `create table`, no mesmo arquivo.
- Rodar consulta fora do contexto de transação (o `ContextoDb` estoura de
  propósito para isso não passar batido).
- Espalhar `comEscopoSistema` por conveniência.
- Usar `security definer` numa função sem pensar: ela roda com os privilégios de
  quem a criou e pode furar a policy sem avisar.
