# Estudo — puxar a base de clientes do Cardápio Web para o Regemcast

Pesquisa de 19/09/2026. Fontes: documentação oficial da API (docs.cardapioweb.com,
especificações OpenAPI `api-loja`, `api-pedidos`, `api-autenticacao`), central de
ajuda (ajuda.cardapioweb.com), política de privacidade do Cardápio Web, código
já em produção no Regem e **teste real, somente leitura, na loja de teste
(código 59412, produção)** com a chave que o Regem usa.

Tudo marcado **[testado]** foi executado contra a API de produção. O resto vem
da documentação oficial, com o link.

---

## 1. Resposta curta

- **Dá para puxar a base de clientes inteira.** `GET /api/partner/v1/merchant/customers`
  devolve todos os clientes da loja, 50 por página, sem limite de data. **[testado]**
- **Dá para puxar até 3 anos de pedidos.** `GET /api/partner/v1/orders/history`
  aceita início até 3 anos atrás, em janelas de até 6 meses. **[testado: 35 meses
  = 200; 37 meses = 400 "Parâmetros inválidos"]**
- **Métricas por cliente (quantos pedidos, quanto gastou, ticket médio, última
  compra) não vêm prontas.** Nenhum endpoint devolve isso por cliente; é preciso
  calcular a partir dos pedidos, um a um (seção 5).
- **Quanto tempo o Cardápio Web guarda:** a política de privacidade não fixa
  anos — os dados ficam "enquanto existir uma relação contratual" ou enquanto
  necessários/exigidos por lei. O que é garantido por contrato técnico é a
  janela da API: **3 anos de pedidos** e **a base de clientes inteira**.

## 2. Contradição na documentação oficial (resolvida no teste)

A página "Histórico de pedidos" diz no resumo que o início "não pode retroceder
mais de **um ano**"; a descrição do parâmetro `start_date` na mesma página diz
"no máximo **3 anos**", e a página "Resumo de pedidos" repete 3 anos. O teste
real resolveu: **vale 3 anos** (35 meses aceito, 37 meses recusado).

## 3. O que vem de cada cliente

`GET /api/partner/v1/merchant/customers?page=N&per_page=50` **[testado — campos
idênticos à doc]**:

| Campo | Uso no Regemcast |
|---|---|
| `id` | chave para não duplicar e para ligar aos pedidos |
| `name` | nome do contato |
| `phone_number` + `ddi` | telefone → E.164 (normalização que já existe em `common/telefone.ts`) |
| `email`, `birth_date`, `gender` | opcionais; aniversário serve para campanha de aniversariantes |
| `created_at` | desde quando é cliente |
| `loyalty_points`, `cashback_balance` (+ validades) | variável de campanha ("você tem R$ X de cashback") |
| **`notifications_enabled`** | **"Indica se o envio de mensagens via WhatsApp para o cliente está liberado"** — é o descadastro do lado do Cardápio Web |

`GET /api/partner/v1/merchant/customers/{id}` devolve um cliente.

A base do Cardápio Web junta clientes de vários canais: "site, portal,
importação, chatbot, entre outros" (central de ajuda, *Base de Clientes*).

## 4. Autenticação — dois caminhos

| | API Key (legado) | OAuth — app na CW App Store |
|---|---|---|
| Como | Lojista gera o token no Portal (Configurações → Integrações → API) e cola no Regemcast | Lojista clica "Instalar" na CW App Store e autoriza |
| Clientes | Funciona só com `X-API-KEY` **[testado]** | Escopo **`customers`** |
| Pedidos | `X-API-KEY` | Escopo **`orders`** |
| Situação | "Será descontinuado no futuro"; "novas integrações devem usar OAuth" | Obrigatório para app novo; token 2 h + refresh |
| Escopos | Não tem: o token dá acesso amplo à loja | Só o que foi aprovado |

**Recomendação: OAuth, app "Regemcast" na CW App Store**, categoria
**Marketing**, escopos **`customers` + `orders`**. Motivos: a própria Cardápio
Web exige OAuth para integração nova; o lojista não manuseia chave (regra
"o usuário informa, a Regem conclui"); o token só alcança clientes e pedidos; e
a loja da CW App Store vira **canal de aquisição** do Regemcast.

Processo (docs "Cadastro e publicação" e "Instalação e autorização"):
1. Cadastro da integradora e do app por e-mail a `integracao@cardapioweb.com`
   (template na doc). Sandbox e Produção são cadastros separados.
2. Recebemos `client_id` (e `webhook_token`) do Sandbox, integramos e testamos.
3. App público: gravar vídeo da integração. Aprovação em **até 7 dias corridos**.
   Pode ser **privado** (acesso só por link) enquanto não quisermos listar.
4. Só o perfil **Proprietário** instala. Uma instalação por loja; redes com
   várias lojas instalam em cada uma.

O Regem já tem o OAuth com PKCE, o refresh de 2 h e o modo chave prontos em
`backend/src/modules/integracoes/cardapio-web/cardapio-web.service.ts` — serve de
base (copiar e adaptar; os repositórios são separados).

## 5. Métricas por cliente: como, e quanto custa

Não existe métrica por cliente na API:
- `orders/history` devolve só `id, status, order_type, order_timing,
  sales_channel, created_at, updated_at` — **sem o cliente**.
- `orders/summary` e `orders/summary/grouped` dão totais da loja, sem filtro nem
  agrupamento por cliente (e exigem OAuth).
- O cliente (`customer.id`, `name`, `phone`, `ddi`), o total e os itens só vêm em
  `GET /orders/{id}`.

Logo, para ter histórico por cliente: listar o histórico e abrir cada pedido.
Limites oficiais, **por loja**: histórico 5 req/min (100 pedidos por página);
detalhe 300 req a cada 3 min.

| Loja com 2 anos de uso | Pedidos | Listar histórico | Abrir pedidos | Total, uma vez |
|---|---|---|---|---|
| 10 pedidos/dia | ~7.300 | ~15 min | ~1 h 15 | **~1 h 30** |
| 40 pedidos/dia | ~29.200 | ~1 h | ~4 h 50 | **~6 h** |
| 100 pedidos/dia | ~73.000 | ~2 h 30 | ~12 h | **~15 h** |

Roda uma vez, em segundo plano, com a loja usando o sistema normalmente. Daí em
diante, pedido novo chega por webhook (`order_id`) ou polling de 8 h e atualiza
as métricas na hora. A base de clientes em si é rápida: 8.000 clientes = 160
páginas ≈ 2 min.

O que dá para calcular por cliente: primeira e última compra (recência),
número de pedidos (frequência), total gasto e ticket médio (valor), produtos
mais comprados, canal/dia/horário preferidos — o suficiente para a matriz RFV
que o próprio Cardápio Web usa (Campeões, Fiéis, Em risco, Perdidos…) e para
segmentar campanhas ("não compra há 30 dias", "comprou pizza 3+ vezes").

## 6. Cuidados que decidem se isso é seguro de oferecer

1. **Pedidos de marketplace no Cardápio Web.** O histórico inclui iFood, 99Food,
   Keeta e aiqfome (`sales_channel`). No iFood o telefone é **mascarado** (0800 +
   localizador, confirmado na homologação do Regem) — não é um WhatsApp. Esses
   clientes pertencem ao marketplace: **excluir** `ifood`, `food99`, `keeta`,
   `aiqfome` da importação de contatos.
2. **Quem é dono do dado.** A política do Cardápio Web diz: "A Cardápio Web é
   Operadora do tratamento em relação aos dados dos clientes dos
   Estabelecimentos cadastrados… os controladores [são] os Estabelecimentos."
   Mesmo desenho do Regemcast: o restaurante é o controlador e pode autorizar
   outro operador. A autorização é a instalação do app pelo Proprietário.
3. **Consentimento para WhatsApp (Meta).** Pedir comida não é autorizar
   campanha. A política da Meta exige que a pessoa tenha autorizado receber
   mensagens da empresa (ver /regras). Regras propostas:
   - importar **só** `notifications_enabled = true`; quem está `false` entra já
     **descadastrado** (bloqueia qualquer importação futura do mesmo número);
   - origem do consentimento `cardapioweb`, evidência automática ("cliente da
     loja X no Cardápio Web desde <created_at>, WhatsApp liberado em <data da
     sincronização>") e o lojista confirma a mesma declaração da importação de
     arquivo;
   - todo modelo de marketing já sai com "Parar promoções".
4. **Descadastro não volta para o Cardápio Web.** A API não tem endpoint para
   alterar cliente. Quem sai pelo Regemcast fica bloqueado aqui; no Cardápio
   Web continua como estava. Precisa ficar claro na tela.
5. **Sincronização precisa respeitar a saída de lá.** A cada rodada, cliente que
   virou `notifications_enabled = false` no Cardápio Web vira descadastrado aqui.

## 7. Contexto competitivo (central de ajuda do Cardápio Web)

- **Todo plano do Cardápio Web já tem disparo de WhatsApp** ("Food Marketing /
  Campanhas WhatsApp"), com segmentação por total de pedidos, ticket médio,
  tempo desde a última compra e aniversariantes — mas conectado **por QR Code**
  (não é a API oficial; risco de bloqueio do número, que eles tentam reduzir
  com "até 3 variações de mensagem").
- A **integração oficial com a Meta** foi lançada para chatbot e notificações
  de pedido, e diz textualmente: "o envio de campanhas através da API da Meta
  **ainda não está disponível** neste lançamento. Essa será a próxima etapa."

Leitura: o valor do Regemcast para o lojista do Cardápio Web é **campanha pela
API oficial** (sem risco de banimento por QR Code) com a base e o histórico que
ele já tem. A janela existe **até** o Cardápio Web lançar campanhas oficiais —
o que eles já anunciaram como próximo passo.

## 8. Outras plataformas pesquisadas

| Plataforma | Base de clientes pela API? | Fonte |
|---|---|---|
| **Cardápio Web** | **Sim** — lista completa + pedidos de 3 anos | docs oficiais + teste |
| iFood | **Não** — telefone mascarado (0800 + localizador); cliente é do iFood | homologação do Regem |
| Open Delivery (Abrasel) | **Não** — só pedidos; cliente vem dentro do pedido | especificação oficial `openapi.yaml` |
| Delivery Direto | **Não** para o lojista — Store API tem `customers/me` (visão do próprio consumidor, para apps de pedido) | developers.deliverydireto.com.br |
| Anota Aí | **Não confirmado** — a integração do Regem usa pedidos e cardápio; a documentação pública (Stoplight) não abriu por acesso automático. Perguntar ao suporte da Anota Aí | — |
| 99Food / Keeta | Marketplace, mesma lógica do iFood (cliente é do marketplace) | — |

## 9. Proposta de implementação (se aprovado)

1. **Cadastro no Cardápio Web** (Sandbox): integradora SISTER TECNOLOGIA / app
   "Regemcast", Marketing, escopos `customers` + `orders`, privado no início.
2. **Migration** (vai para o dono aplicar antes do merge): tabela de conexão
   por conta (tokens cifrados, estado da sincronização) + no contato: id
   externo, data de nascimento, e métricas (primeira/última compra, pedidos,
   total, ticket médio) — ou tabela própria de métricas.
3. **Conectar** em Contatos → "Conectar Cardápio Web" (OAuth PKCE).
4. **Sincronização inicial** em segundo plano: clientes (minutos) → lista
   "Clientes Cardápio Web"; histórico de pedidos (horas, com barra de
   progresso) → métricas. Operação em massa set-based.
5. **Contínuo**: webhook de pedido + reconciliação diária (novos clientes e
   descadastros).
6. **Campanha por segmento**: "não compra há X dias", "Y+ pedidos",
   aniversariantes do mês — usando as métricas.

## 10. Perguntas para o Cardápio Web (antes de construir)

- `GET /merchant/customers` tem ordenação garantida ou filtro por data de
  atualização (para sincronizar só o que mudou)?
- `notifications_enabled` muda só quando o cliente responde "SAIR"? Há data da
  mudança?
- Há webhook de cliente novo ou alterado?
- Para app público com escopo `customers`, há exigência extra de LGPD
  (termo, DPA) na aprovação?

## 11. Cadastro na CW App Store — rascunho do e-mail (Sandbox)

Enviar para `integracao@cardapioweb.com`. Dois e-mails, como pede a doc
("Cadastro e publicação"): primeiro a integradora, depois o app. Anexar o logo
`app/loja/icone-512.png` e até 5 imagens da tela de Contatos → Cardápio Web.

**Assunto:** Cadastro de integradora - SISTER TECNOLOGIA LTDA

```
--- DADOS DA INTEGRADORA ---
Nome: SISTER TECNOLOGIA LTDA (produto Regemcast)
CNPJ: [conferir]
E-mail: [e-mail oficial de contato]
Telefone: [telefone oficial]
Site: https://cast.dmsregem.com
Descrição: Plataforma de campanhas de WhatsApp pela API oficial da Meta para restaurantes e pequenos negócios.
```

**Assunto:** Cadastro de app - Regemcast

```
--- INFORMAÇÕES BÁSICAS ---
Nome do app: Regemcast
Categoria: Marketing
Descrição curta: Campanhas de WhatsApp pela API oficial da Meta para a base de clientes da sua loja. Importe os clientes do Cardápio Web em um clique, respeitando quem desligou as mensagens.
Descrição completa: O Regemcast envia campanhas de WhatsApp pela API oficial da Meta, com modelos aprovados, janela de envio, limites por dia e o botão "Parar promoções" em toda mensagem de marketing. Ao instalar, a base de clientes da loja entra no Regemcast: só quem está com o WhatsApp liberado no Cardápio Web recebe; quem desligou entra descadastrado. O dono acompanha entregas, leituras e falhas de cada campanha pelo site e pelo app Android.

--- URLs DO APP ---
Redirect URI: https://castapi.dmsregem.com/api/v1/integracoes/cardapioweb/oauth/callback
URL de instalação: https://cast.dmsregem.com/contatos?importar=cardapioweb
URL de login: https://cast.dmsregem.com/painel

--- PERMISSÕES ---
customers (listar clientes)
store (consultar a loja — nome exibido na conexão)

--- WEBHOOK (opcional) ---
(sem webhook nesta versão)

--- VISIBILIDADE ---
[x] Privado  (por enquanto; público depois do vídeo e da aprovação)
```

Pendências do nosso lado antes da produção: implementar o OAuth com PKCE (o
Regem tem pronto para copiar), a URL de instalação e a rota de callback acima.
O escopo `orders` (métricas por cliente) entra quando essa parte for construída
— lojas já instaladas precisam reinstalar para ganhar escopo novo.
