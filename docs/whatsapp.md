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
cada 15 minutos carimba quem venceu e tenta de novo quem ficou em `pendente`.

Estados possíveis:

| Estado | Significa |
|---|---|
| `nao_se_aplica` | Número dedicado; não há app de onde copiar |
| `pendente` | Onboarding feito, pedido ainda não saiu |
| `sincronizando` | Pedimos; os dados chegam por webhook, em fases |
| `concluida` | A Meta sinalizou o fim |
| `expirada` | Passou das 24h; a Meta desfaz e o cliente refaz |
| `falhou` | A Meta recusou — o caso comum é o código `2593109`, o cliente não autorizar o compartilhamento |

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

- **App Review** das permissões `whatsapp_business_management` e
  `whatsapp_business_messaging`: vídeo de tela por permissão + descrição
  escrita. Verificação de Negócio e Verificação de Acesso já estão aprovadas.
- **Vazão de 20 mps** respeitada pelo motor de disparo (Fase 4). O valor já
  está gravado e exposto em `vazaoMaxima`; falta quem o obedeça.
- **Janela de 24h de atendimento**: o eco (`smb_message_echoes`) de uma resposta
  do lojista abre a janela com aquele contato. Hoje só registramos; na Fase 4 o
  motor usa isso para escolher entre modelo aprovado e texto livre.

## Fontes

- [Onboard WhatsApp Business app users (coexistência)](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users)
- [`smb_app_state_sync` webhook](https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/reference/smb_app_state_sync/)
- [`smb_message_echoes` webhook](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/smb_message_echoes)
- [WhatsApp Cloud API — visão geral](https://developers.facebook.com/docs/whatsapp/cloud-api/)
