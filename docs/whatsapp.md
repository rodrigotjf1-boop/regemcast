# Conexão com o WhatsApp (Cloud API oficial)

Como o cliente conecta a própria conta do WhatsApp Business ao Regemcast, o que
a Meta exige em cada caminho, e onde cada regra está implementada.

Regra de leitura: **nada aqui é lembrança**. Toda afirmação sobre o que a Meta
faz tem fonte na documentação dela, linkada no fim.

## O modelo

O Regemcast opera como **Tech Provider**. Na prática:

- A WABA (WhatsApp Business Account) é **do cliente**, não nossa.
- A Meta cobra **o cliente** pelas conversas, direto. Nós cobramos a assinatura
  do software.
- Nós nunca criamos conta de desenvolvedor para o cliente nem pedimos que ele
  manuseie chave. Ele passa pela janela da Meta; o resto é nosso.

## Os dois caminhos, e por que a escolha vem antes do botão

| | Manter o WhatsApp Business (coexistência) | Número dedicado |
|---|---|---|
| O número | O mesmo que ele já usa no celular | Um que não está em nenhum WhatsApp |
| O aplicativo no celular | Continua funcionando | Não existe |
| Contatos e histórico | Copiados do celular | Começa vazio |
| Vazão | **20 mensagens por segundo**, fixo | Até 80 |
| `/register` | **Pulado** — o app já registrou | Obrigatório |
| Prazo | **24 horas** para copiar os dados | Não há |

A escolha muda o `featureType` que abre a janela da Meta, e **não dá para
corrigir depois**: é outro fluxo desde o primeiro clique. Por isso a pergunta
aparece antes do botão em [`conectar-whatsapp.tsx`](../frontend/src/components/app/conectar-whatsapp.tsx),
e não como configuração escondida.

```ts
const FEATURE_TYPE = {
  coexistencia: 'whatsapp_business_app_onboarding',
  dedicado: '',
};
```

Com `featureType` vazio num número que já está no aplicativo, a Meta recusa com
"número já registrado" — que foi exatamente o que travou o primeiro teste.

## O fluxo, na ordem em que a Meta exige

1. **Embedded Signup v4** no navegador. A v2 é descontinuada em 15/10/2026;
   nascemos na v4 e não há migração pela frente.
2. **Troca do `code` por token — em até 30 segundos.** É o prazo real do
   `code`. Por isso ele não passeia por tela de confirmação nem por fila: chega
   do navegador e é trocado no mesmo request.
3. **Leitura da WABA.** Se falhar, o token é inválido e não adianta seguir.
4. **Gravação da conta, com o token cifrado**, antes de qualquer chamada que
   possa falhar no meio — senão o cliente fica com conexão meio feita e sem
   credencial para retomar.
5. **Assinatura do webhook na WABA do cliente.** É individual, por WABA. Sem
   isso, nenhum evento daquela conta chega.
6. **Descoberta do número.** Na coexistência a Meta pode não mandar o
   `phone_number_id` no `sessionInfo`; quando falta, perguntamos à WABA. Abortar
   aqui deixaria o cliente conectado e sem número — parece que deu certo e nada
   funciona.
7. **Registro (dedicado) ou sincronização (coexistência).** Ver abaixo.
8. **O passo que é dele:** cadastrar forma de pagamento no WhatsApp Manager. No
   modelo Tech Provider a Meta cobra o cliente direto; sem isso nenhuma mensagem
   sai, e não temos como fazer por ele.

Tudo isso vive em [`meta.service.ts`](../backend/src/modules/meta/meta.service.ts),
com os testes da bifurcação em `meta.service.spec.ts`.

## Coexistência: o que a Meta copia, e o prazo

Duas chamadas ao mesmo endpoint, uma por tipo:

```http
POST /{PHONE_NUMBER_ID}/smb_app_data
{ "messaging_product": "whatsapp", "sync_type": "smb_app_state_sync" }
{ "messaging_product": "whatsapp", "sync_type": "history" }
```

O 200 delas significa **"pedido enfileirado"**, não "sincronizado". O conteúdo
chega depois, por webhook, em fases. Tratar o 200 como conclusão é o mesmo erro
de achar que "a Meta aceitou" significa "a mensagem chegou".

O que vem:

- **Contatos** (`smb_app_state_sync`) — todos os contatos com número de
  WhatsApp na agenda do aparelho.
- **Histórico** (`history`) — **180 dias** a partir do onboarding, em três
  fases: dia 0–1, dia 1–90, dia 90–180. IDs de mídia só para mensagens dos
  últimos 14 dias.
- **Ecos** (`smb_message_echoes`) — cópia do que ele enviar pelo aplicativo
  dali em diante.

**O prazo é de 24 horas.** Estourado, a Meta desfaz a conexão e o cliente refaz
o fluxo inteiro. Por isso o estado fica gravado em `wa_numero.sincronizacao` —
não implícito em log — e existe o
[`coexistencia.job.ts`](../backend/src/modules/meta/coexistencia.job.ts), que a
cada 15 minutos conclui quem já recebeu o 100%, expira quem ficou 24 horas sem
sinal e tenta de novo quem ficou em `pendente`.

**Onde a Meta avisa o fim — e onde avisava errado aqui.** O `progress` (100 =
terminou) e o erro `2593109` vêm **dentro de cada item de `value.history[]`**
(`history[].metadata.progress`, `history[].errors`), não em `value`. Até
24/09/2026 o webhook procurava em `value`: nenhuma cópia aparecia como
concluída, e o job marcava "expirada" — mandando conectar de novo — quem tinha
terminado. A leitura mora em
[`coexistencia.regras.ts`](../backend/src/modules/meta/coexistencia.regras.ts),
testada com os exemplos da página oficial, e o job também conclui a partir dos
lotes de histórico já guardados.

**Expirar exige 24 horas sem sinal**, não 24 horas desde a conexão: com lotes
de agenda ou histórico chegando, a cópia está andando, e "expirado" seria um
alarme falso.

Estados possíveis:

| Estado | Significa |
|---|---|
| `nao_se_aplica` | Número dedicado; não há app de onde copiar |
| `pendente` | Onboarding feito, pedido ainda não saiu |
| `sincronizando` | Pedimos; os dados chegam por webhook, em fases |
| `concluida` | A Meta sinalizou o fim (`progress` 100 em `history[].metadata`) |
| `expirada` | 24h desde a conexão **e** 24h sem lote nenhum; a Meta desfaz e o cliente refaz |
| `falhou` | A Meta recusou — o caso comum é o código `2593109`, o cliente não autorizar o compartilhamento |

## Coexistência: a pergunta sobre contatos e conversas

O número é de uso empresarial e a agenda é da empresa: o Regemcast só pergunta
ao dono se quer **trazer os contatos e as conversas** do WhatsApp Business. Não
filtra nem separa ninguém — a responsabilidade pela agenda é do lojista, e a
declaração que ele aceita ao responder "sim" é o registro de consentimento dos
contatos (`consentimento_origem = 'declarado'`, com o texto e quem declarou).

Quatro fatos da Meta moldam o fluxo (conferidos na referência oficial em
23/09/2026):

- **O pedido de sincronização é obrigatório.** Sem ele em 24 horas, a Meta
  desfaz a conexão. Então o "não" não cancela o pedido: decide só o que
  guardamos.
- **O histórico vem uma vez só** (6 meses; mídia só dos últimos 14 dias). Quem
  responde "não" não recupera as conversas antigas depois — a tela avisa.
- **A agenda continua chegando** depois da cópia inicial: contato salvo,
  editado ou apagado no celular gera outro `smb_app_state_sync`.
- **Etiquetas não vêm.** O webhook traz só `type: contact` (nome, primeiro nome,
  telefone) com `action` `add` ou `remove`. Quem lê etiqueta é ferramenta não
  oficial — proibida aqui. As listas do Regemcast fazem esse papel.

A resposta fica **por número** (`wa_numero.integrar_conversas`, migration 023) e
é dada na tela de conexão — gravada na mesma transação do número, **antes** do
pedido de sincronização — ou depois, no cartão do número (`POST
/whatsapp/integrar`, só o dono).

| Resposta | Agenda (`smb_app_state_sync`) | Histórico (`history`) | Ao vivo (`messages`) e ecos (`smb_message_echoes`) |
|---|---|---|---|
| sem resposta | guardada como chegou, esperando | guardado, esperando | seguem como sempre (não viram conversa) |
| sim | vira contato na lista "WhatsApp Business"; o conteúdo sai do evento | vira conversa; o conteúdo sai do evento | viram conversa; o conteúdo sai do evento |
| não | o conteúdo sai do evento | o conteúdo sai do evento | o conteúdo sai do evento |

### As conversas (migration 024)

Com "sim", tudo o que é conversa vai para `conversa` (número da empresa ×
pessoa) e `mensagem` — gravado em
[`conversas.service.ts`](../backend/src/modules/meta/conversas.service.ts), a
leitura dos formatos da Meta em
[`conversas.regras.ts`](../backend/src/modules/meta/conversas.regras.ts):

- **histórico** — direção pelo remetente (`from` = cliente da thread → entrada);
  status de `history_context.status`; data ORIGINAL da mensagem;
- **mídia recente** — no histórico, mídia vem como `media_placeholder` (o
  conteúdo omitido). O arquivo chega num aviso `history` à parte
  (`value.messages[]`), com o MESMO wamid, e só dos últimos 14 dias: preenche a
  mensagem que já existe, sem duplicar, e troca o `media_placeholder` pelo tipo
  real (foto, documento…). A mídia que a EMPRESA mandou pode vir sem `to` —
  por isso a aplicação é pelo wamid (`midiasDoHistorico`), sem depender de
  saber a pessoa. Mídia mais antiga fica "📎 Mídia — só no celular";
- **tipos que a API não repassa** — `errors` (visto no histórico em produção,
  fora da documentação) e `unsupported`: gravados sem texto, aparecem como
  "Mensagem só no celular";
- **ao vivo** — o cliente escreveu; o nome do perfil vem de `contacts`;
- **ecos** — o lojista respondeu pelo celular (`to` = cliente): conta como
  resposta e zera as não lidas;
- **status** das respostas — só andam para frente (entregue atrasado não desfaz lida).

Não lidas = mensagens do cliente AO VIVO depois da última resposta (histórico
é passado e não conta). A janela de 24h de texto livre conta da última
mensagem **do cliente** (`conversa.ultima_entrada_em`). Tudo em comandos por
conjunto, com o número travado durante a gravação.

O histórico guardado antes desta gravação existir volta à fila na subida do
servidor (`AgendaService.reenfileirar({ semJanela: true })`), com o índice
`idx_wa_evento_sincronizacao` (migration 025) mantendo a varredura barata.

### A tela "Conversas"

No jeito do WhatsApp Web, em `/conversas`
([`modules/conversa/`](../backend/src/modules/conversa/)). O menu só aparece com
algum número em coexistência com "sim" (`conversasHabilitadas` no `GET /conta`),
e **toda rota confere de novo no servidor**: conta sem isso recebe 404.

- **Lista** — a mais recente primeiro, com nome do contato (ou do perfil),
  último trecho, não lidas e o ponto verde de "janela aberta". Busca por nome
  ou telefone (`%` e `_` digitados valem como eles mesmos).
- **Conversa** — páginas de 60 mensagens (as anteriores sob demanda), separador
  de dia, status das respostas, mídia buscada na Meta na hora (nada guardado
  aqui). Mídia que a Meta mandaria como HTML ou SVG sai como download, nunca
  embutida, com `nosniff` e CSP `sandbox`.
- **Resposta** — texto livre só dentro das 24 horas desde a última mensagem do
  cliente; fora disso a caixa explica e aponta a tela de Campanhas (modelo
  aprovado). A janela é conferida ANTES de chamar a Meta. Quem saiu das
  promoções pode receber resposta: foi a pessoa que escreveu.
- **Adicionar à lista** — o substituto das etiquetas; quem saiu das promoções
  não entra em lista de campanha.
- **Atualização** — conversa aberta a cada 5 s, lista a cada 15 s, pausando
  com a aba escondida. A troca por SSE fica para quando o volume pedir.
- **Guarda das mensagens** — o dono escolhe o prazo (0 = tudo); de hora em
  hora, `ConversaRetencao` apaga o que passou, pela data da mensagem, em
  blocos, e tira a conversa que ficou vazia.

**Por que nada é decidido com resposta que ainda não existe:** a agenda pode
chegar antes de o dono responder, ou antes de a transação da conexão terminar.
Número ainda não gravado faz o evento voltar para a fila (tentativas); número
sem resposta guarda o lote. Quando a resposta existe, a
[retomada](../backend/src/modules/meta/webhook.retomada.ts) devolve à fila os
eventos processados antes dela, e eles passam pelo **mesmo caminho** do webhook
([`agenda.service.ts`](../backend/src/modules/meta/agenda.service.ts)).

Contato que já estava na base fica como está (consentimento e nome); quem pediu
para sair continua fora da lista. Celular antigo que a Meta manda sem o 9º
dígito é corrigido antes de gravar (`doWhatsapp`, em `common/telefone.ts`) —
sem isso, a mesma pessoa viraria dois contatos.

**O descadastro vale para as duas formas do celular.** A importação de arquivo
guarda o número como veio, então a base pode ter a pessoa com ou sem o 9. O
pedido de saída ("Parar promoções", "sair") bloqueia a pessoa em qualquer forma
que já exista na base — e só cria linha nova, na forma com o 9, se não houver
nenhuma. A trava do disparo (`marcarDescadastrados`) confere as duas formas, e
a migration 026 bloqueou os "gêmeos" que ficaram para trás antes da correção. A
regra do gêmeo é uma só: `gemeoDoCelular`, em `common/telefone.ts`.

### O que a coexistência TIRA do cliente

Isto é material de venda, não detalhe técnico — e está na tela da escolha,
recolhido num "O que muda no seu WhatsApp Business", mais o lembrete dos 14
dias fixo no cartão do número:

- **Listas de transmissão ficam somente leitura.** Quem dispara na mão hoje usa
  exatamente isso. É o item que mais dói, e o que mais justifica o produto.
- Editar e apagar mensagem param de funcionar nas conversas individuais.
- Mensagens temporárias, visualização única e localização em tempo real são
  desativadas nas conversas individuais.
- O cliente precisa **abrir o aplicativo ao menos uma vez a cada 14 dias**, ou a
  Meta encerra a conexão.
- A elegibilidade é julgada pela Meta por conta: *"available only to businesses
  actively using the WhatsApp Business App, based on Meta's review of account
  age and messaging quality"*. Conta nova ou com qualidade ruim é recusada, e aí
  o caminho é número dedicado.

### O que o cliente precisa saber, e onde ele lê isso

O aplicativo tem que ficar **aberto no celular** durante a cópia. Se fechar
antes, a cópia para onde estiver. Isso aparece três vezes, de propósito: na
escolha antes de conectar, na tela de sucesso e no cartão do número em
`/whatsapp` — porque é a única instrução do onboarding que, se ignorada, custa
refazer tudo.

### LGPD

O histórico traz conversa de terceiros — os clientes do nosso cliente. Sobre
esses dados o Regemcast é **operador**, e o cliente é o controlador. Está
declarado na seção 4 da
[política de privacidade](../frontend/src/app/privacidade/page.tsx), com o prazo
de 180 dias dito por extenso e a informação de que ele pode recusar o
compartilhamento na própria janela da Meta.

## Limite de envio

Pessoas DIFERENTES alcançadas com modelo, fora de conversa aberta, numa janela
MÓVEL de 24 horas. Desde 07/10/2025 o limite é do **portfólio** — todos os
números dele dividem o mesmo teto — e os degraus são **250 → 2.000 → 10.000 →
100.000 → sem teto**. Sobe para 2.000 com a empresa verificada ou com 2.000
entregas de boa qualidade em 30 dias; daí em diante sozinho, em até 6 horas,
para quem usa metade do limite em 7 dias com qualidade alta.

- **Leitura:** o campo `whatsapp_business_manager_messaging_limit` do número
  (v24.0+; o antigo `messaging_limit_tier` foi descontinuado), na conexão e de 6
  em 6 horas pelo [`limite.job.ts`](../backend/src/modules/meta/limite.job.ts);
  e o aviso `business_capability_update`, que chega pela WABA, sem número — por
  isso o evento guarda o `entry.id` (e ele entra na chave de idempotência).
- **Formatos:** a documentação se contradiz (nome do degrau, número ou `-1`);
  [`limite.regras.ts`](../backend/src/modules/meta/limite.regras.ts) aceita os
  três e trata o desconhecido como "não sabemos" — nunca como "sem teto".
- **No disparo:** cada rodada conta, dentro da trava por conta, quantas pessoas
  a conta já alcançou em 24 h. Cheio, a rodada não pega ninguém e a campanha
  **espera** — não pausa — e continua sozinha quando a vaga abre. A tela da
  campanha mostra o motivo e a hora.
- **Nos blocos** (Contatos → Dividir em blocos, migration 028): a base, uma
  lista, uma importação, um perfil ou um estado (pelo DDD) vira listas de 250,
  500, 750, 1.000 ou do tamanho escolhido — e os tamanhos só são liberados até o
  limite de hoje (decisão do dono, 25/09/2026). É o "envio de um dia" para lista
  só com nome e número, como a agenda exportada do celular: um bloco por vez,
  olhando entrega, leitura e quem pediu para sair antes do próximo. Cada bloco é
  uma `contato_lista` com `divisao_id` e `bloco`; a divisão inteira é um comando
  só no banco ([`divisao.service.ts`](../backend/src/modules/contato/divisao.service.ts)).

## Descanso, número sem WhatsApp e resposta (Fase 4A)

- **Descanso entre campanhas.** Quem recebeu campanha de MARKETING nos últimos
  N dias fica de fora da próxima (`descanso`, que não é falha e não conta no
  plano). N é da conta (Conta → Dados da conta, padrão 3, 0 desliga) e é
  copiado para a campanha ao criar — mudar depois não mexe em campanha
  existente. Só modelo de marketing; o dono pode liberar uma campanha. A regra
  (`recebeuMarketingRecente`) conta o que saiu de verdade (enviada, entregue,
  lida) e o que está saindo (`enviando`), nas duas formas do celular, e roda
  na reserva da rodada, dentro da trava por conta. Motivo: a Meta limita o
  marketing por pessoa (131049) e pune quem insiste; mandar menos para quem
  acabou de receber protege a qualidade do número.
- **Número sem WhatsApp.** 131026 ("não tem WhatsApp, não aceitou os termos ou
  usa versão antiga") em DUAS campanhas diferentes marca o contato
  (`sem_whatsapp_em`): ele sai dos envios e de todos os públicos e contagens, e
  aparece em Contatos → Bloqueios → Sem WhatsApp, com "Tentar de novo" (só as
  recusas depois disso contam para marcar de novo). Vale a recusa na hora do
  envio e a que chega pelo aviso de status.
- **Resposta à campanha.** A mensagem que responde a uma nossa chega com
  `context.id` = o `wamid` da campanha: marca `respondida_em` no destinatário
  (em qualquer número — não depende das conversas ligadas). Só o fato; o texto
  não é guardado. "Parar promoções" e os pedidos de saída não contam.

## Parou ou voltou a aceitar marketing pelo WhatsApp

A pessoa pode, no próprio WhatsApp, parar de receber marketing da empresa — e
voltar depois. A Meta avisa pelo `user_preferences` (formato conferido na
documentação oficial em 26/09/2026, em `meta/preferencias.regras.ts`) e, se
mesmo assim alguém mandar marketing, recusa com o erro `131050` no aviso de
entrega (só lá, nunca no envio; a Meta manda não reenviar).

- **Parou** (`stop`, ou a falha `131050`): a pessoa entra nos bloqueios com a
  origem `preferencia_whatsapp` ("Parou o marketing pelo WhatsApp" em Contatos
  → Bloqueios), nas duas formas do celular, e o que ainda não saiu para ela
  vira falha "Pediu para sair" — como o botão "Parar promoções".
- **Voltou** (`resume`): desfaz SÓ o bloqueio que veio daqui, e só de quem tem
  autorização registrada na base. Quem também pediu para sair pelo botão ou
  por mensagem continua de fora — o pedido direto à empresa vale mais; o dono
  reativa em Bloqueios, se for o caso.
- **Assinatura do aviso:** o campo `user_preferences` precisa estar ligado nos
  webhooks do app na Meta (Conectar no WhatsApp → Etapa 2. Configuração de
  produção → Configurar webhooks). Sem ele, o `131050` ainda pega quem parou —
  mas só depois de uma tentativa.

## Quem recebe: lista, público da base ou números (migration 033)

"Quem recebe" tem três caminhos, e a campanha aceita **um** deles:

- **Uma lista:** as listas e os blocos, como antes.
- **Da base:** toda a base, uma importação (arquivo ou Cardápio Web), um
  perfil, um estado pelo DDD ou um público pronto (VIP, "Pedem à noite",
  "Já compraram…", bairro, aniversário, engajamento).
  - Existe porque os contatos importados sem escolher lista — as planilhas de
    clientes exportadas do Anota Aí (ativos, em potencial, inativos), por
    exemplo — não apareciam em lugar nenhum da campanha (pedido do dono,
    26/09/2026).
  - `GET /contatos/importacoes` lista as importações com quantos de cada uma
    ainda podem receber.
- **Digitar números:** até 500.

Como funciona:

- **Uma regra só:** quem entra em cada origem vem de `contato/origem-do-publico.ts`,
  a mesma dos blocos. Por isso a lista de importações, a prévia, a campanha
  montada e os blocos dão o mesmo número.
- **Foto na montagem:** o público é uma foto tirada ao **montar**. Os
  destinatários são copiados na hora, como com a lista. Quem entrar na base
  depois não recebe aquela campanha. É o padrão do Klaviyo, que fecha o
  público ao agendar.
- **Prévia única:** `POST /campanhas/previa` recebe lista ou público da base e
  devolve, numa consulta, quantos podem receber, quantos estão em descanso e
  a sugestão de horário. Substitui as duas prévias da 4A e da 4B.
- **Cartão da campanha:** a campanha guarda `publico_origem` e
  `publico_rotulo` ("Toda a base", "Importação: clientes.xlsx", "Perfil: Em
  risco", "Pedem à noite"). O cartão e o detalhe mostram o rótulo, e o tipo
  do modelo (Marketing, Utilidade, Autenticação) ao lado do nome do modelo.
- **Lista pelo caminho da base:** se chegar `daBase` com origem `lista`, ela
  vira campanha de lista, com `lista_id`. Assim "já enviado em…" e o
  resultado por bloco continuam valendo.

## Cashback na campanha (Fase 4C, migration 034)

Duas variáveis saem do cashback do Cardápio Web (o saldo é lido como está em
`docs/integracoes.md`):

- **Saldo do cashback:** "R$ 1.234,50". Não tem texto reserva: quem recebe
  sempre tem saldo.
- **Validade do cashback:** "30/09", ou "30/09/2027" quando é de outro ano. O
  texto reserva vale para quem tem saldo sem data para vencer.

O formato é montado em SQL, porque a campanha é montada no banco. Não usa
`to_char` de número, que segue o idioma do servidor.

Mensagem com variável de cashback só vai para quem tem cashback válido:

- **Na montagem:** só entra quem tem saldo que vale hoje, no fuso da conta —
  vale para lista e para público da base. A prévia (`soComCashback`) conta do
  mesmo jeito e diz de quantos do público.
- **A cada rodada do envio** (`conferirCashbackDaFila`, junto com a marcação
  de quem saiu):
  - quem usou ou perdeu o saldo depois da montagem sai da fila como "Cashback
    usado ou vencido" — nada é enviado e não conta no plano;
  - quem ainda tem recebe o saldo e a validade DO DIA, não os da montagem.
  - Para isso a campanha guarda de onde sai cada variável
    (`campanha.variaveis_lista`).
- **As opções só aparecem em conta com saldo lido** (a mesma marca que mostra o
  cashback em Contatos).

## O modelo da campanha é o que a Meta diz

A tela só oferece modelo aprovado, mas a tela não é a trava. Ao criar a
campanha — e ao editar um rascunho mexendo no modelo ou no público — o servidor
lê a lista de modelos da conta na Meta (a mesma que alimenta a tela) e confere:

- **Existe e está aprovado.** Achado pelo id quando ele vem; senão por nome e
  idioma (o mesmo nome em outro idioma é outro modelo). Modelo em análise,
  recusado, pausado ou desativado é recusado com o estado na frase.
- **Nome, idioma, id e categoria gravados são os da Meta.** O que a tela manda
  nesses campos não é usado. Importa porque a **categoria decide o descanso**
  entre promoções: marketing dito "utilidade" pelo pedido descansa do mesmo
  jeito.
- **As variáveis fecham com o texto.** Um valor para cada variável do corpo —
  `{{1}}` repetido conta uma vez. A mais ou a menos, a Meta recusaria TODAS as
  mensagens (132000) depois do disparo; a recusa passa a vir antes de gravar.
  Trocar só o modelo de um rascunho confere as variáveis que a campanha já tem.
- **A lista segue o cursor da Graph até o fim** (`modelosDaWaba`): conta com
  mais de 200 modelos não perde os da segunda página.
- **Sem a Meta no ar, a campanha não é criada** — a tela também não teria
  modelos para mostrar. O erro dela chega traduzido.

O que o modelo exige no ENVIO além das variáveis do corpo é a seção seguinte.

## O que o modelo exige no envio (migration 037)

Criar um modelo e enviar um modelo são dois formatos diferentes. Na criação a
Meta recebe um EXEMPLO de cada parte; no envio, o valor de verdade vai de novo,
a cada mensagem. Faltando um, ela recusa a mensagem (132000 / 132012). Até a
migration 037 o disparo só preenchia as variáveis do corpo — modelo com imagem,
cupom, oferta ou carrossel era aceito na campanha e recusado em todas as
mensagens.

**A forma vem da Meta; os valores, do modelo como foi criado no Regemcast**
(`meta/envio.regras.ts`, decisões do dono em 01/10/2026):

| O que o modelo tem | O que vai no envio | De onde sai |
| --- | --- | --- |
| Imagem, vídeo ou documento no cabeçalho | `header` com a mídia | A mídia do próprio modelo (`modelo.cabecalho_midia`) |
| Variável no título (cabeçalho de texto) | `header` com o texto | Campo da campanha (`variavelCabecalho`): texto fixo, ou o nome do contato com um reserva. Resolvido na montagem, por pessoa (`campanha_destinatario.variavel_cabecalho`) |
| Oferta por tempo limitado | `limited_time_offer` com o vencimento | Agora + as horas do modelo (`modelo.lto_horas`; sem valor, 3). Instante ABSOLUTO em milissegundos — o exemplo da própria Meta traz uma duração e contradiz a descrição do campo |
| Botão de copiar código | `button` / `copy_code` na posição que a Meta deu ao botão | O código cadastrado no modelo |
| Carrossel | `carousel` com um cartão por imagem, na ordem | A imagem de cada cartão do modelo; a resposta rápida do cartão vai com o próprio texto como `payload` |

- **É uma foto tirada ao criar a campanha** (`campanha.envio`), como o público:
  editar o modelo depois não muda campanha montada. Nulo = só o corpo, e o
  envio sai pelo caminho de sempre (toda campanha antiga).
- **A validade da oferta muda sem passar pela Meta**
  (`PATCH /modelos/:id/oferta`, corpo `{ horas }`, de 1 a 720; nulo = o padrão,
  3). As horas ficam só aqui — a Meta recebe o vencimento a cada mensagem, não
  no modelo —, então mudar não gasta a edição do dia de modelo aprovado nem o
  devolve à análise. Vale para a campanha montada ou editada depois, e fica na
  auditoria (`modelo.validade_da_oferta`). No editor, do site e do app, é o
  campo "Validade da oferta, em horas" e, em modelo que já está na Meta, o
  botão "Salvar só a validade". O `PUT /modelos/:id` também leva `ltoHoras`, e
  os dois clientes mandam o campo: o servidor grava o que chega, e quem não
  mandasse apagaria as horas.
- **O app monta a campanha com as mesmas regras do site**: a variável do
  título (`variavelCabecalho`), as linhas que dizem o que a mensagem leva do
  modelo, o aviso do que o disparo ainda não sabe mandar e o aviso da campanha
  pausada pelo modelo.
- **Recusa antes de gravar**, com a frase dizendo o que falta: modelo com mídia
  ou cupom que não foi criado pelo Regemcast (não temos o arquivo nem o código),
  arquivo que não está mais guardado, variável do título sem valor. E o que o
  disparo ainda não sabe mandar: botão de link com variável, cabeçalho de
  localização, cartão com variável no texto, modelo de código de verificação.
- **A mídia sobe à Meta uma vez, não uma por destinatário.** Enviar exige o id
  de `POST /{numero}/media` — outra rota, e outro identificador, que o
  `header_handle` da criação. O id vale 30 dias e fica em `midia_envio`, por
  número (usamos por 25). Endereço público vai como `link`.
- **A Meta recusou o MODELO (132000 a 132016): a campanha para na primeira
  recusa** e pausa com `pausa_motivo = modelo`. Só aquela mensagem falha; o
  resto da rodada volta para a fila, intacto. Antes, cada destinatário virava
  "falhou", um por um, até a fila acabar. O mesmo vale quando o arquivo do
  modelo some depois de a campanha ser montada. Rede caída ao subir o arquivo
  não pausa: a rodada volta à fila e a campanha tenta de novo sozinha.
- **Tipo de botão que não conhecemos não é recusado de antemão.** Se ele não
  pedir nada, o envio funciona; se pedir, a Meta recusa a primeira mensagem e a
  campanha pausa pelo modelo.

## Erros e retentativa

O catálogo em [`erros-meta.ts`](../backend/src/modules/meta/erros-meta.ts)
cobre a lista oficial de códigos da Cloud API (conferida em 01/10/2026: 68
códigos, mais a faixa de 200 a 299) e diz três coisas de cada um. É o catálogo — não um `catch` genérico —
que decide o que volta.

| O que o catálogo diz | Para quê |
| --- | --- |
| `classe` (`transitorio`, `limite`, `destinatario`, `config`, `credencial`, `politica`) | Se a mensagem é tentada de novo |
| `alcance` (`destinatario`, `modelo`, `conta`, `passageiro`) | Se a campanha segue, espera ou **para** |
| `titulo`, `explicacao`, `acao`, `quem`, `tela` | O que a tela mostra: o que houve, o que fazer, quem resolve e em que tela |

**O erro que guia (migration 038).** Achado no teste do dono (01/10/2026): o
131042 (pagamento da conta do WhatsApp não configurado) não estava no catálogo,
e a tela mostrou a frase da Meta em inglês, com um endereço de 200 caracteres,
e "registre para investigarmos".

- **A frase da Meta nunca é a explicação.** Ela fica guardada à parte
  (`campanha_destinatario.erro_meta`) e a tela a mostra recolhida, em "O que a
  Meta respondeu". O endereço que ela traz para resolver (pagamento, termos)
  vira um botão de rótulo curto — só endereço `https` da própria Meta.
- **A explicação sai do catálogo na leitura, pelo código** — não da frase
  gravada no dia da falha. A falha antiga ganha o texto de hoje, inclusive a que
  foi gravada como "código não mapeado". A exceção é a recusa passageira que
  desistiu: fica a frase que diz quantas vezes tentamos, e a ação não promete
  nova tentativa.
- **Código fora da lista** ganha texto honesto: diz que não conhecemos, manda
  falar com o suporte informando o código e guarda o que a Meta respondeu.
- **Erro da conta para a campanha na primeira recusa** (`alcance = conta`:
  pagamento, conta restrita, registro do número, credencial), como já acontecia
  com o modelo. No envio, ninguém vira falha: quem a rodada tinha pego volta
  para a fila, inclusive o da primeira recusa. Quando a recusa chega depois,
  pelo aviso de entrega (a Meta aceita e recusa em seguida — foi o caso do
  131042), quem já tinha sido aceito fica como falha, com o motivo, e a
  campanha que ainda está saindo pausa. `pausa_motivo = conta_meta` (ou
  `conexao`, na credencial), com `pausa_erro_codigo` e `pausa_erro_meta` para a
  tela dizer o motivo e o que fazer. Retomar limpa os três.
- **"Por que falhou"**: `GET /campanhas/:id` traz `falhasPorMotivo`, as falhas
  agrupadas pelo código, do motivo mais comum para o menos, cada um com o que
  fazer. `GET /campanhas/:id/destinatarios` traz `erro` em cada falha;
  `erroTitulo` e `erroDetalhe` seguem, já com o texto do catálogo, para o app
  que ainda não lê `erro`.
- **No app da Play**, o botão que abre o pagamento na Meta não aparece (nada
  ali leva a uma página de pagamento fora do app); a explicação fica.
- **O botão do pagamento não depende da frase da Meta.** Ela nem sempre manda
  o endereço (em 01/10/2026 a primeira recusa do 131042 veio com ele, a segunda
  sem). O servidor monta o endereço da conta de pagamento do WhatsApp
  (`meta/pagamento.ts`: `billing_hub/accounts/details` com o `business_id` e o
  `asset_id` = a WABA) e o usa no erro 131042 quando a Meta não mandou o dela, e
  na tela **WhatsApp**, no botão "Pagamento na Meta" — o atalho que existe
  antes do disparo. O `business_id` (o portfólio de negócios dono da conta) vem
  do Embedded Signup na conexão; conta conectada antes disso é perguntada à
  Meta uma vez, quando a tela do WhatsApp abre (`owner_business_info`), e a
  falha dessa pergunta só deixa a tela sem o botão. A cobrança é da conta do
  WhatsApp (a WABA), não de cada número.

No envio da campanha:

- **A Meta respondeu recusando por ritmo ou instabilidade** (`transitorio` ou
  `limite`, com resposta HTTP): ela não aceitou a mensagem, então tentar de novo
  não duplica nada. O destinatário volta para a fila com hora marcada (a espera
  do catálogo, dobrando, até 1 h), no máximo 3 vezes. **130429** e **80007**
  fazem a campanha inteira esperar — continuar a rodada seria bater no mesmo
  muro com os próximos.
- **A rede caiu ou o tempo esgotou no meio do envio** (sem resposta): não dá
  para saber se a mensagem chegou. Não reenviamos — duplicar é pior que perder
  —, e a tela diz exatamente isso.
- **131049** (limite de marketing por pessoa) chega depois, pelo aviso de
  entrega. Não reenviamos sozinhos: a Meta pune quem insiste com quem atingiu o
  limite.

Dois códigos que importam neste fluxo:

- **`2593109`** — o cliente recusou compartilhar os dados do aplicativo. Não é
  falha nossa nem transitória: marca `falhou` e explica o que fazer.
- **`133010`** — número não registrado. É o erro que aparece quando se pula o
  `/register` num número dedicado — e o texto cru da Meta não diz isso.

## Saúde da conta na Meta (migration 039)

"Posso enviar agora e, se não, o que eu resolvo?" A Meta responde isso no campo
`health_status` da conta do WhatsApp (a WABA) e de cada número: um veredito
(`AVAILABLE`, `LIMITED`, `BLOCKED`) e a lista do que está por trás dele — a
conta, a empresa (o portfólio de negócios), o aplicativo, o número —, cada item
com o próprio estado, o erro (`error_code`, `error_description`) e a solução que
ela sugere (`possible_solution`). O Regemcast não lia: no teste de 01/10/2026 a
conta estava sem pagamento e isso só apareceu **depois** do disparo, na recusa
de cada mensagem (131042).

**O que é lido** (`meta/saude.service.ts`, três chamadas por volta, cada uma
com tempo máximo de 6 s e sem retentativa):

1. `GET /{waba}?fields=health_status` — o veredito da conta. É a que importa: sem
   ela, nada é gravado.
2. `GET /{waba}?fields=currency,timezone_id,primary_funding_id,business_verification_status`
   — a cobrança, à parte: um campo recusado ali não pode esconder a saúde.
3. `GET /{numero}?fields=health_status` — de cada número registrado.

Fica em `wa_conta` (`saude_estado`, `saude`, `saude_em`, `moeda`, `fuso`,
`pagamento_id`, `verificacao_negocio`) e em `wa_numero` (`saude_estado`,
`saude`, `saude_em`). O `fuso` é um número interno da Meta (`timezone_id`):
fica guardado e não vai para a tela.

**Quando é lido:**

| Caminho | Validade da leitura guardada |
| --- | --- |
| A tela (`GET /whatsapp/saude`) | 10 minutos |
| "Conferir agora" (`?atualizar=1`) | 20 segundos — o botão não vira martelo na Meta |
| O disparo e a retomada da campanha | 2 minutos — só vale o que a Meta disse agora |
| Logo depois de conectar o WhatsApp | lê na hora |
| A rotina (`meta/saude.job.ts`) | a cada 30 min, até 50 contas com leitura vencida |
| O aviso `account_update` da Meta | relê na hora (menos os só informativos) |

**As regras** (`meta/saude.regras.ts`):

- **"Não sei" nunca vira "pode" nem "não pode".** A Meta fora do ar, o token
  vencido ou um veredito que não reconhecemos não gravam nada; a tela mostra a
  última leitura, com a hora dela, ou "Ainda não conferimos com a Meta".
- **O que barra o disparo:** só o veredito da Meta (conta ou número `BLOCKED`) e
  a autorização vencida — e só com leitura **fresca**. Bloqueio guardado de
  ontem não segura o disparo de hoje: sem resposta da Meta o disparo segue, e a
  campanha pausa na primeira recusa (seção "Erros e retentativa").
- **A leitura do disparo é gravada em transação própria.** A recusa desfaz a
  transação do pedido; gravada nela, a leitura sumia — a tela ficava com o
  estado velho e o aviso de "bloqueou agora" saía de novo a cada tentativa.
- **O pagamento é aviso nosso, nunca bloqueio.** Sem moeda ou sem
  `primary_funding_id` a tela mostra "Confira o pagamento da conta na Meta", com
  o atalho para a conta de pagamento (o mesmo endereço do botão "Pagamento na
  Meta"). Quem bloqueia é só o veredito dela. Se a cobrança não pôde ser lida, o
  item nem aparece.
- **A frase da Meta nunca é a explicação.** A Meta não publica a lista dos
  códigos da saúde, só exemplos. O título e a explicação saem do QUE está com
  problema (conta, empresa, aplicativo, número) e do QUANTO (limita ou
  bloqueia); o erro e a solução dela vão em "O que a Meta respondeu", com o
  código. Problema do **aplicativo** é conosco ("fale com o suporte").
- **Aviso no celular** (categoria campanhas) quando a conta ou um número **vira**
  bloqueado — uma vez por virada, não a cada leitura.
- **Autorização caída (190)** na rotina: a conta só é tentada de novo no dia
  seguinte.

**Na tela:** o cartão "Saúde da conta na Meta" em **WhatsApp** (site e app): o
sinal geral (Pode enviar · Envia com restrição · Não pode enviar agora), quando
foi conferida, o botão "Conferir agora" e um item por coisa conferida, do que
mais pede atenção para o que está certo — cada problema com o que houve, o que
fazer e de quem depende. Na **campanha** em rascunho ou pausada, um aviso antes
do botão de disparar quando a Meta aponta algo, com o atalho para a tela do
WhatsApp. No app da Play o atalho para o pagamento na Meta não aparece.

**O aviso `account_update`** (e `account_review_update`): relê a saúde da conta
na hora — é ela que diz se dá para enviar, o aviso só diz que algo mudou. Não
relê nos só informativos (`VOLUME_BASED_PRICING_TIER_UPDATE`,
`BUSINESS_PRIMARY_LOCATION_COUNTRY_UPDATE`, `PARTNER_ADDED`,
`PARTNER_APP_INSTALLED`, `AD_ACCOUNT_LINKED`, `MM_LITE_TERMS_SIGNED`,
`AUTH_INTL_PRICE_ELIGIBILITY_UPDATE`,
`PARTNER_CLIENT_CERTIFICATION_STATUS_UPDATE`). De passagem, guarda o
`waba_info.owner_business_id` quando a conta ainda não tem o negócio — é com ele
que se monta o endereço do pagamento.

## Qualidade e categoria do modelo

Depois de aprovado, um modelo ainda recebe dois sinais da Meta, e os dois
mexem no envio e no bolso (`meta/modelo-sinais.ts`):

- **Qualidade** (`quality_score`: GREEN, YELLOW, RED, UNKNOWN). Vem do que os
  destinatários fazem com a mensagem — bloqueio, denúncia, "parar promoções".
  Em RED o modelo está, nas palavras dela, "em perigo de ser pausado ou
  desativado"; pausado, nenhuma campanha com ele sai.
- **Categoria** (`category`, `correct_category`, `previous_category`). A Meta
  reclassifica o que considera marketing disfarçado de utilidade: avisa com 24
  horas e muda. O preço por mensagem muda junto (marketing custa várias vezes
  a utilidade), e as regras de envio também.

**Na lista de modelos** (`GET /whatsapp/modelos`, lida da Meta a cada visita)
cada modelo traz `qualidade` (`verde`, `amarela`, `vermelha`, `desconhecida`),
`categoriaPrevista` (a `correct_category`, só quando difere da atual — a Meta
devolve o campo também quando o modelo já está na categoria certa),
`categoriaAnterior` e `alertas`, as frases prontas do que pede atenção. A tela
(site e app) mostra o crachá da qualidade, o "era utilidade" e os alertas; não
traduz nada. Modelo novo ou sem informação fica sem crachá — "desconhecida"
nunca vira "boa".

Os três campos são pedidos junto dos de sempre. **Se a Meta recusar os campos
novos (#100), a lista é pedida de novo sem eles** e segue: é ela que deixa
montar campanha, e um campo a mais não pode derrubá-la.

**Pelos avisos**, que é o que permite avisar no celular na hora (categoria
"modelos" dos avisos):

| Aviso da Meta | O que acontece |
| --- | --- |
| `message_template_quality_update` | Só a QUEDA avisa (verde → amarela, → vermelha; ou modelo novo que já nasce amarelo ou vermelho). Melhora e "sem informação" ficam quietas. Nada é gravado: a tela lê a qualidade na lista. |
| `template_category_update`, aviso das 24 horas (`correct_category` + `category_update_timestamp`) | Avisa de onde para onde e QUANDO, na hora do fuso da conta. O nosso registro não muda. |
| `template_category_update`, mudança feita (`previous_category` + `new_category`) | Grava a categoria nova em `modelo.categoria_meta` (a que pedimos continua em `categoria`) e avisa. |

No aviso de categoria o campo `new_category` significa coisas diferentes nos
dois formatos — a categoria de HOJE no aviso das 24 horas, a NOVA na mudança
feita. O código lê pelo campo que só um deles tem (`correct_category`).

O dono é avisado mesmo quando o modelo foi criado fora do Regemcast: sem linha
nossa, a conta sai da WABA do aviso (`entry.id`).

**O que este PR não faz:** campanha em rascunho criada quando o modelo era de
utilidade guarda a categoria daquele momento (e, com ela, a decisão do descanso
de marketing). A categoria é relida da Meta ao editar a campanha, não ao
disparar.

## Modelos: análise antes de enviar

Nada vai para a Meta sem passar pela análise (`modelo/regras-modelo.ts`): o
botão "Enviar para aprovação" e o salvar de modelo que já está lá conferem
primeiro e, com problema, **não enviam nada** — cada ponto aparece na seção do
formulário, com o que trocar. A recusa da Meta chega horas depois, com um
código só; a nossa chega na hora, completa.

As regras seguem a página oficial de revisão de modelos (motivos de recusa) e a
de componentes, conferidas em 25/09/2026:

| Motivo de recusa da Meta | O que a análise barra |
| --- | --- |
| Variável fora do padrão ("mismatched curly braces") | `{nome}`, `{{nome}}`, `{{1}` — em mensagem, cabeçalho, rodapé e botões; com a troca sugerida (`{{1}}` + "nome do contato" na campanha) |
| Variável com `#`, `$`, `%` | qualquer coisa entre chaves que não seja número |
| Variáveis fora de sequência | `{{1}}`, `{{2}}`, `{{4}}` |
| Variável demais para o tamanho | menos de 2N + 1 palavras fixas para N variáveis (a Meta não publica o número; a fórmula é a que os provedores documentam) |
| Variável no começo ou no fim | "dangling parameters" |
| Pedido de dado sensível | senha, dados de cartão, CPF, RG |
| Tom de ameaça | ação judicial, negativação, protesto, Serasa |
| Cópia de outro modelo | mesmo texto de mensagem e rodapé de outro modelo da conta (nossos e os da lista da Meta) |
| Limites dos componentes | cabeçalho 60 (sem formatação), mensagem 1.024, rodapé 60, botão 25, telefone 20, até 10 botões (2 de link, 1 de telefone, 1 de copiar código) |

Recusado mesmo assim (conteúdo que só a revisão da Meta julga): o motivo aparece
em português (`meta/motivos-modelo.ts`) e o caminho é **Editar** — a correção
volta para a Meta com o mesmo nome. Criar outro com nome novo e o mesmo texto só
repete a recusa.

## Webhook

- **Verificação (GET)**: fail-closed, comparação em tempo constante.
- **Recebimento (POST)**: assinatura HMAC-SHA256 sobre os **bytes crus** do
  corpo. Sobre o JSON reserializado a assinatura não bate.
- **Registra e responde 200 na hora**; o processamento vem depois. A Meta
  desativa webhook que demora, e processar antes de responder transforma
  lentidão nossa em desassinatura dela.
- **Idempotência** por `wamid` + status: o mesmo `wamid` chega uma vez por
  estado (`sent`, `delivered`, `read`), e colapsar os três perderia dois.
  Aviso sem id de mensagem (conta, número, modelo) é identificado pelo conteúdo
  MAIS o momento em que a Meta o disparou (`entry.time`): o reenvio repete os
  dois e é descartado; o mesmo conteúdo em outro momento é outro evento. Só com
  o conteúdo, o segundo "modelo pausado" ou a segunda queda de qualidade —
  iguais à primeira, semanas depois — eram descartados para sempre.
- **Rede de segurança**: `webhook.retomada.ts` reprocessa pendentes a cada
  minuto, porque senão um evento que falhou fica parado até a Meta mandar outro.

### Os campos que o Regemcast trata

Cada um precisa estar assinado no aplicativo da Meta; campo não assinado não
chega, e nada avisa que falta.

| Campo | Para quê |
| --- | --- |
| `messages` | Status de entrega, respostas, pedido de saída, conversas |
| `message_template_status_update` | Modelo aprovado, recusado, pausado, desativado |
| `message_template_quality_update` | Queda de qualidade do modelo |
| `template_category_update` | A Meta vai mudar, ou mudou, a categoria do modelo |
| `phone_number_quality_update` | Qualidade do número |
| `business_capability_update`, `messaging_limit_update` | Limite de envio |
| `account_update`, `account_review_update` | Restrição, desativação, mudança na conta (relê a saúde) |
| `user_preferences` | Parou ou voltou a aceitar marketing |
| `smb_app_state_sync`, `history`, `smb_message_echoes` | Coexistência: agenda, histórico e ecos do celular |

### Onde fica a configuração do webhook no painel da Meta

Depende de como o app foi criado. O do Regemcast usa o caso de uso "Connect
with customers through WhatsApp", e nele o caminho é
**Casos de uso → Personalizar → Configuração** — não o `WhatsApp → Configuration`
clássico.

## Tarifa da Meta por mensagem (migration 036)

Quem paga a mensagem é a conta do cliente, direto à Meta. O Regemcast não cobra
nem repassa esse valor; ele só precisa **saber** quanto foi, para o orçamento de
disparos e o custo por campanha (roteiro da IA, 01/10/2026).

- **De onde vem.** Cada aviso de status traz o objeto `pricing`
  (`billable`, `pricing_model`, `type`, `category`). Ele vem no aviso de envio
  (`sent`) e em **mais um** — entrega ou leitura —, não nos três.
- **O que é guardado.** `type` e `category`, como vieram, em
  `campanha_destinatario.tarifa_tipo` e `tarifa_categoria`
  (`meta/tarifa.regras.ts`). A Meta manda usar os dois juntos; `billable` está
  marcado para sair numa versão futura e por isso não é lido. A cobrança antiga,
  por conversa (`pricing_model: "CBP"`), é ignorada: lá o campo tinha outro
  significado.
- **Vale a primeira.** O segundo aviso da mesma mensagem, ou um reenvio, não
  reescreve a tarifa. Aviso fora de ordem (o `sent` depois do `read`) não mexe
  no status, mas a tarifa que ele traz é guardada.
- **Mensagem cobrada** = `tarifa_tipo = 'regular'` **e** status `entregue` ou
  `lida`. A Meta cobra na entrega, não no envio; e a conta é pelo status, não por
  `entregue_em`, porque a leitura pode chegar sem o aviso de entrega. Os tipos
  `free_customer_service` e `free_entry_point` saem de graça.
- **O valor em dinheiro não vem no aviso.** Ele sai da tabela de tarifas da
  Meta, por categoria e pelo país de quem recebe — entra com o orçamento de
  disparos. O relatório `pricing_analytics` da Meta (custo aproximado, na moeda
  da conta) fica como conferência.
- **Lista aberta.** `marketing_lite` e `referral_conversion` entraram na lista
  de categorias depois; valor novo é guardado como veio, sem `check` no banco.

## O que ainda falta

- **Acesso Avançado — e ele bloqueia a coexistência inteira.** Testado em
  produção: com Acesso Padrão, o Embedded Signup nunca troca a tela de "digite
  um número novo" pela de conectar o WhatsApp Business, e a Meta responde
  `#2655111` ("o app do parceiro não tem as permissões avançadas"). Todos os
  pré-requisitos documentados estavam satisfeitos — os três webhooks inclusive.
  Ver [`app-review.md`](./app-review.md) para a ordem forçada pela Meta.
- **App Review** das permissões `whatsapp_business_management` e
  `whatsapp_business_messaging`: vídeo de tela por permissão + descrição
  escrita. Verificação de Negócio e Verificação de Acesso já estão aprovadas.
- **Vazão de 20 mps** respeitada pelo motor de disparo (Fase 4). O valor já
  está gravado e exposto em `vazaoMaxima`; falta quem o obedeça (o lote de 20
  por rodada fica bem abaixo dele hoje, e a recusa de ritmo já desacelera).
- **Janela de 24h de atendimento**: quem abre a janela é a mensagem do
  **cliente**, não a resposta do lojista (o eco não abre nada). A conversa já
  guarda `ultima_entrada_em`; a tela de conversas usa isso para escolher entre
  texto livre e modelo aprovado.

## Fontes

- [Revisão de modelos — motivos de recusa](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-review/) · [Componentes de modelo](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/components/) (conferidas em 25/09/2026)

- Envio de modelo: [Media card carousel templates](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/marketing-templates/media-card-carousel-templates) · [Coupon code templates](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/marketing-templates/coupon-templates) · [Limited-time offer templates](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/marketing-templates/limited-time-offer-templates) · [Custom marketing templates](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/marketing-templates/custom-marketing-templates) · [Media (upload para envio)](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/media) (conferidas em 01/10/2026)
- [Status messages webhook reference (objeto `pricing`)](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/status) · [Pricing (cobrança por mensagem, na entrega)](https://developers.facebook.com/docs/whatsapp/pricing) (conferidas em 01/10/2026)
- [Messaging and Calling Health Status (`health_status`)](https://developers.facebook.com/docs/whatsapp/cloud-api/health-status) · [`account_update` webhook](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/account_update) (conferidas em 01/10/2026)
- [`message_template_quality_update` webhook](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/message_template_quality_update) · [`template_category_update` webhook](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/template_category_update) · [Template quality](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-quality) · [WhatsApp Message Template (campos `quality_score`, `correct_category`, `previous_category`)](https://developers.facebook.com/docs/graph-api/reference/whats-app-business-hsm/) (conferidas em 02/10/2026)
- [Messaging limits (limite de envio, portfólio)](https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits/)
- [`business_capability_update` webhook](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/business_capability_update/)
- [Per-user marketing template limits (131049)](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/marketing-templates/per-user-limits/)

- [Onboard WhatsApp Business app users (coexistência)](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users)
- [`smb_app_state_sync` webhook](https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/reference/smb_app_state_sync/)
- [`smb_message_echoes` webhook](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/smb_message_echoes)
- [WhatsApp Cloud API — visão geral](https://developers.facebook.com/docs/whatsapp/cloud-api/)
