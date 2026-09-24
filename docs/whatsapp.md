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
- **mídia recente** — chega num aviso `history` à parte (`value.messages[]`),
  com o MESMO wamid: preenche a mídia da mensagem que já existe, sem duplicar;
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

## Erros e retentativa

O catálogo em [`erros-meta.ts`](../backend/src/modules/meta/erros-meta.ts)
traduz 25 códigos da Meta para pt-BR e classifica cada um em `transitorio`,
`limite`, `destinatario`, `config`, `credencial` ou `politica`. Só `transitorio`
volta automaticamente, e é o catálogo — não um `catch` genérico — que decide.

Dois códigos que importam neste fluxo:

- **`2593109`** — o cliente recusou compartilhar os dados do aplicativo. Não é
  falha nossa nem transitória: marca `falhou` e explica o que fazer.
- **`133010`** — número não registrado. É o erro que aparece quando se pula o
  `/register` num número dedicado — e o texto cru da Meta não diz isso.

## Webhook

- **Verificação (GET)**: fail-closed, comparação em tempo constante.
- **Recebimento (POST)**: assinatura HMAC-SHA256 sobre os **bytes crus** do
  corpo. Sobre o JSON reserializado a assinatura não bate.
- **Registra e responde 200 na hora**; o processamento vem depois. A Meta
  desativa webhook que demora, e processar antes de responder transforma
  lentidão nossa em desassinatura dela.
- **Idempotência** por `wamid` + status: o mesmo `wamid` chega uma vez por
  estado (`sent`, `delivered`, `read`), e colapsar os três perderia dois.
- **Rede de segurança**: `webhook.retomada.ts` reprocessa pendentes a cada
  minuto, porque senão um evento que falhou fica parado até a Meta mandar outro.

### Onde fica a configuração do webhook no painel da Meta

Depende de como o app foi criado. O do Regemcast usa o caso de uso "Connect
with customers through WhatsApp", e nele o caminho é
**Casos de uso → Personalizar → Configuração** — não o `WhatsApp → Configuration`
clássico.

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
  está gravado e exposto em `vazaoMaxima`; falta quem o obedeça.
- **Janela de 24h de atendimento**: quem abre a janela é a mensagem do
  **cliente**, não a resposta do lojista (o eco não abre nada). A conversa já
  guarda `ultima_entrada_em`; a tela de conversas usa isso para escolher entre
  texto livre e modelo aprovado.

## Fontes

- [Onboard WhatsApp Business app users (coexistência)](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users)
- [`smb_app_state_sync` webhook](https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/reference/smb_app_state_sync/)
- [`smb_message_echoes` webhook](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/smb_message_echoes)
- [WhatsApp Cloud API — visão geral](https://developers.facebook.com/docs/whatsapp/cloud-api/)
