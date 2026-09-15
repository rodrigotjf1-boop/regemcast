# App Review da Meta — o que falta e como submeter

Estado dos portões da Meta para o app do Regemcast:

| Portão | Situação |
|---|---|
| Verificação de Negócio | ✅ aprovada |
| Verificação de Acesso (Access Verification) | ✅ aprovada |
| App Review — `whatsapp_business_management` | ⏳ pode ser gravado **hoje** |
| App Review — `whatsapp_business_messaging` | 🔒 **bloqueado**: exige envio funcionando |

## A ordem é da Meta, não nossa

O Regemcast **ainda não é Tech Provider** — quem é, é o app do Regem, e pelo
fluxo oficial essa condição é do app, não da pessoa. A ordem que a Meta publica
para virar Tech Provider é esta, e o que importa é onde o App Review aparece:

1. Criar o app ✅
2. Verificação de negócio ✅
3. Configuração do app (ícone, política de privacidade, categoria) ✅
4. **Envio dos vídeos**
5. **Documentação para o App Review**
6. **Aprovação → Acesso Avançado**
7. **Onboarding de Tech Provider no painel do app**

O App Review vem **antes** do onboarding de Tech Provider. E a coexistência
exige ser Tech Provider (*"You must already be a Solution Partner or Tech
Provider"*). Logo: **não existe caminho que faça a coexistência funcionar antes
da análise do app.** Tentamos, em 15/set/2026, e o beco é este.

Consequência prática: o que destrava tudo é o **número de teste** da Meta
(WhatsApp → Configuração da API), grátis, com WABA própria, até 5 destinatários
de teste e o modelo `hello_world` pré-aprovado. É contra ele que a Fase 4 nasce
e os dois vídeos são gravados.

## Sem Acesso Avançado, ninguém conecta — nem para testar

Confirmado em produção, em 15/set/2026: com o app **Ao vivo** e só Acesso
Padrão, o Embedded Signup recusa o onboarding com

> "O app do parceiro não tem as permissões de mensagens e Gerenciamento do
> WhatsApp Business avançadas que são necessárias para a integração."
> (#2655111)

A documentação é explícita: *"You will not be able to onboard business
customers until your app has been approved for advanced access for each of the
permissions it requires."*

**A saída não é um contorno, é o caminho previsto pela Meta:** com o app em
**modo Desenvolvimento**, as permissões aparecem normalmente na tela de
autorização *"to anyone who has an admin, developer, or tester role on your
app"*. É assim que se constrói e se grava o vídeo antes de pedir a análise.

Por isso o app fica em **Desenvolvimento** até o App Review sair. Voltar para
**Ao vivo** é o último passo, depois da aprovação — não antes.

## A conclusão que muda a ordem das coisas

O vídeo de `whatsapp_business_messaging` precisa mostrar o app **enviando e
recebendo mensagem**. Hoje o Regemcast conecta a conta, lê números, qualidade e
tier, e recebe webhook de entrega — mas **não envia nada**: não existe módulo de
modelo nem de campanha, e nenhuma rota de disparo.

Ou seja: **não dá para submeter as duas permissões agora.** A ordem real é:

1. App em **Desenvolvimento**; o dono conecta a própria WABA (funciona porque
   ele é admin do app).
2. Fase 4 mínima — um modelo aprovado e um envio de teste que funcione de ponta
   a ponta, com o status voltando pelo webhook.
3. Gravar os dois vídeos.
4. Submeter as duas permissões juntas.
5. Aprovado, virar o app para **Ao vivo** e abrir para a lista de espera.

Dá para submeter só `whatsapp_business_management` antes, e é uma decisão
defensável (a análise leva ~24h e um "aprovado" adianta o outro pedido). Mas
submeter `whatsapp_business_messaging` com vídeo que não mostra envio é pedir
rejeição — e rejeição entra no histórico do app.

## Vídeo 1 — `whatsapp_business_management` (pode ser gravado hoje)

A Meta exige *"a short recording that shows clear evidence of how your app uses
the `whatsapp_business_management` permission"*, e o uso declarado é **gerenciar
os números e os modelos de mensagem do cliente**.

Grave a tela do **painel do lojista** (`cast.dmsregem.com`), não a do
desenvolvedor, não o Business Manager da Meta.

Roteiro, sem cortes:

1. Faça login no painel com uma conta de cliente. Deixe a URL visível.
2. Vá em **WhatsApp**. Mostre a tela de conexão com as duas opções — manter o
   WhatsApp Business ou número dedicado.
3. Clique em **Conectar meu número**. Deixe a janela da Meta abrir e passe pelo
   fluxo até o fim. É este o pedaço que prova que a conexão é do cliente, pelo
   Embedded Signup, e não um número nosso.
4. De volta ao painel, mostre o cartão do número: telefone, nome de exibição,
   **qualidade** e **limite da Meta**. Esses três vêm de
   `GET /{waba-id}/phone_numbers` — é a permissão em uso, na tela.
5. Se o número exigir PIN, mostre a tela de registro do número.
6. Encerre mostrando o estado da sincronização (coexistência) ou o crachá
   "Pronto para enviar".

Não fale — a narração não é exigida e legenda errada atrapalha. Se quiser
explicar, use texto na tela em inglês.

## Vídeo 2 — `whatsapp_business_messaging` (depois da Fase 4)

Exigência textual da Meta: *"The screencast recording should be made in the
business interface, not in the consumer experience."* Ou seja: a tela do
lojista, não a do consumidor recebendo.

Roteiro, para quando existir envio:

1. Login no painel, mesma conta.
2. Mostre a lista de contatos com o **opt-in registrado** (origem, data, prova).
   Isso responde antes da pergunta que o revisor sempre faz.
3. Mostre o modelo de mensagem aprovado que será usado.
4. Dispare uma campanha pequena — dois ou três contatos de teste, de números
   que você controla.
5. Mostre o resultado por destinatário: enviada, entregue, lida. Esses estados
   chegam por webhook, e mostrá-los prova o "receive".
6. Mostre o celular recebendo, **de relance**. O foco do vídeo é o painel.

## Textos da submissão

A Meta lê em inglês. Abaixo o texto para colar em cada permissão, e a tradução
só para conferência.

### `whatsapp_business_management`

> Regemcast is a Tech Provider. Our customers are small and medium businesses in
> Brazil that connect their own WhatsApp Business Account through Embedded
> Signup — we never host numbers on their behalf.
>
> We use `whatsapp_business_management` to manage, on each customer's behalf and
> with their authorization: their business phone numbers (read the number, its
> display name, quality rating and messaging limit tier; register the number
> when required), and their message templates (create, list and check approval
> status). The customer sees all of this in our dashboard, in their own
> language, and no credential is ever shown or handled by them.

*Em português, para conferência: somos Tech Provider; nossos clientes são PMEs
brasileiras que conectam a própria WABA pelo Embedded Signup; usamos a permissão
para gerenciar os números deles (ler número, nome de exibição, qualidade e tier;
registrar quando preciso) e os modelos de mensagem (criar, listar, acompanhar
aprovação).*

### `whatsapp_business_messaging`

> Regemcast is a Tech Provider. We send marketing and utility messages on behalf
> of our customers, using approved message templates and their own WhatsApp
> Business Account, connected through Embedded Signup.
>
> We use `whatsapp_business_messaging` to send those template messages to
> contacts who have given the customer explicit opt-in — recorded with source,
> timestamp and evidence — and to receive delivery status webhooks (sent,
> delivered, read, failed) and customer replies, so the business can honour
> opt-out requests immediately and see what actually reached each person.

*Em português: enviamos mensagens de marketing e utilidade em nome dos clientes,
por modelo aprovado e pela WABA deles; recebemos os webhooks de status e as
respostas, para honrar descadastro na hora e mostrar o que de fato chegou.*

## Antes de clicar em enviar

- [ ] O app está em modo **Live**, não Development.
- [ ] URL de política de privacidade preenchida e **acessível sem login** —
      `https://cast.dmsregem.com/privacidade`.
- [ ] Ícone e nome do app sem "WhatsApp", "WA" ou "Zap" — a Meta rejeita por
      isso, e é regra nossa também.
- [ ] O vídeo mostra a **interface do lojista**, com URL visível.
- [ ] O vídeo não mostra token, segredo nem tela de desenvolvedor.
- [ ] Se houver conta de teste, as credenciais estão no campo de instruções.

## Fontes

- [App Review para provedores da WhatsApp Business Platform](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/app-review)
- [Exemplo de submissão](https://developers.facebook.com/docs/whatsapp/solution-providers/app-review/sample-submission)
- [Permissões do WhatsApp](https://developers.facebook.com/documentation/business-messaging/whatsapp/permissions)
- [Become a Tech Provider](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers)
