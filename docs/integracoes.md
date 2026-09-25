# Integrações — cardápio digital → clientes e compras

Menu **Configuração → Integrações** (`/integracoes`). Liga o Regemcast ao
cardápio digital da loja para trazer a base de clientes **e o histórico de
compras de cada um** — o que a importação de arquivo não traz, e o que permite
separar a base por quem compra mais, quem sumiu, quem pede entrega.

A integração é **só leitura**: nenhum método altera nada na loja do cliente.

| Cardápio | Situação |
| --- | --- |
| Cardápio Web | No ar: clientes (importação) e compras (sincronização contínua). |
| Cardápio digital do Regem | Em preparação. Depende de uma API de parceiro, só de leitura, do lado do Regem (pedida ao projeto Regem em 25/09/2026). |

Lista só com nome e número (a agenda exportada do celular, uma planilha) não é
integração: entra por **Contatos → Importar** e se organiza em blocos e por DDD.

## Cardápio Web

### Conexão

Hoje, pelo **token da loja** (`X-API-KEY`), que o dono copia no Portal do
Cardápio Web (Configurações → Integrações → API). Conferido na hora
(`GET /merchant`) e guardado cifrado (`INTEGRACOES_CHAVE`). O modo OAuth
(app "Regemcast" na CW App Store) entra quando o app for aprovado — o cadastro
está em [`estudo-cardapioweb-clientes.md`](estudo-cardapioweb-clientes.md) e
precisa das permissões `customers`, `orders` e `store`.

- **Trocar token** (loja já conectada): mesma loja → nada se perde e a busca de
  pedidos retoma de onde parou; **outra** loja → a busca de pedidos volta a
  "não buscadas" (o dono recomeça), para não misturar duas lojas.
- **Desconectar** apaga a credencial e o estado da sincronização. Os contatos e
  as compras que já vieram ficam na base.

### Clientes

A importação lê a base inteira (`GET /merchant/customers`, 50 por página).
Exige a declaração de consentimento do dono (condição da Meta para a empresa
iniciar a conversa). Só entra como contato quem está com o WhatsApp liberado
na loja (`notifications_enabled`); quem desligou entra **descadastrado**, para o
número não voltar por uma planilha depois. Quem já está na base mantém o
cadastro que tinha.

### Compras (pedidos)

Começam sozinhas ao fim da importação de clientes (ou pelo botão **Buscar
pedidos**). Duas fases, com o ponto em que parou guardado no banco — reinício
ou deploy não perde nada:

| Estado | O que acontece |
| --- | --- |
| `parado` | Nada. Ainda não buscadas (ou token de outra loja). |
| `carga` | O histórico dos últimos 3 anos, uma janela de 180 dias por vez, uma página (100 pedidos) por passo. O histórico não traz o cliente: cada pedido ainda não guardado é aberto (`GET /orders/{id}`). |
| `em_dia` | A cada 30 min, os pedidos alterados desde a última consulta (`GET /orders?updated_since=`). **Atualizar agora** antecipa a consulta. |
| `falhou` | O Cardápio Web recusou (token, permissão, consulta). O motivo aparece na tela; **Tentar de novo** recomeça a carga (o que já está guardado não é aberto de novo) e **Trocar token** retoma de onde parou. |

**O que vira compra:** pedido **fechado** (`closed`), de canal próprio da loja,
com telefone. Fica de fora (e é contado em `pedidos_ignorados`): marketplace
(`ifood`, `food99`/`99food`, `keeta`, `aiqfome` — o cliente é do marketplace e o
telefone vem mascarado), pedido sem cliente ou sem telefone, e a compra de quem
**pediu para sair** (opt-out vence, nas duas formas do celular). Pedido
**cancelado**, mesmo depois de fechado, desfaz a compra.

**Contato da compra:** pelo telefone, nas duas formas do celular (com e sem o
9). Cliente que ainda não está na base é buscado no Cardápio Web
(`GET /merchant/customers/{id}`) e entra pelas **mesmas regras** da importação
de clientes — e só se o dono já fez a declaração de consentimento.

**O que fica guardado:** a tabela `compra` (migration `029_compras.sql`), uma
linha por pedido: data, valor em **centavos**, tipo (entrega / retirada / salão),
canal, bairro e os itens resumidos (nome, quantidade, valor — até 30).
Chave única `(conta_id, fonte, id_externo)`: reler é idempotente. Os totais do
contato (`pedidos`, `total_gasto_centavos`, `primeiro_pedido_em`,
`ultimo_pedido_em`, `metricas_origem = 'cardapioweb'`) são refeitos das compras
num comando só, e alimentam os perfis da base. Contato **anonimizado** perde as
compras junto.

### O que as compras alimentam

Em **Contatos**, tudo conta só quem pode receber (sem descadastro), como o disparo:

- **Perfis da base** (Campeões, Fiéis, Em risco…): a regra continua a de
  recência e frequência; cada perfil passa a mostrar **quanto gastou** e o
  **ticket médio** (o "M" do RFM).
- **Públicos pelas compras** (`contato/publicos.ts`, uma definição só para a
  contagem, o filtro da tabela, a lista e os blocos):

  | Público | Regra |
  | --- | --- |
  | VIP | os 10% que mais gastaram (percentil 90 do total gasto, em reais inteiros) |
  | Ticket alto / médio / baixo | os terços do ticket médio (total ÷ pedidos) da própria loja |
  | Um pedido só | 1 pedido, comprado dentro do "ativo" dos perfis — chamar para o segundo |
  | Rumo ao 10º pedido | 9 pedidos |
  | Pedem entrega / Retiram na loja / Consomem no salão | o jeito de comprar mais frequente (empate: o mais recente) |
  | Bairro | o bairro mais frequente nas entregas, sem ligar para maiúscula |
  | Aniversariantes | o mês da data de nascimento (o Cardápio Web manda) |

  VIP e ticket são **relativos à loja**: uma pizzaria e uma loja de açaí têm
  tickets diferentes, e um corte fixo em reais não serviria às duas.
- Bairro e jeito de comprar ficam guardados no contato (`contato.bairro`,
  `contato.tipo_preferido`, migration 030), refeitos a cada sincronização junto
  com os totais; o resto é calculado na consulta.
- **Planilha não passa por cima das compras:** quem tem compras sincronizadas
  tem os totais calculados delas; a planilha só completa e-mail e aniversário.
- Cada público vira lista ("Criar lista com estes contatos") ou blocos
  (`lista_divisao.origem = 'publico'`), como os perfis.

### Limites da API e o ritmo

Conferidos na documentação oficial em 25/09/2026
([histórico](https://docs.cardapioweb.com/api-reference/pedidos/historico-de-pedidos.md),
[consulta de alterados](https://docs.cardapioweb.com/api-reference/pedidos/polling-de-pedidos.md),
[detalhe](https://docs.cardapioweb.com/api-reference/pedidos/consultar-detalhes-do-pedido.md)):

| Rota | Limite por loja | Regras |
| --- | --- | --- |
| `GET /orders/history` | 5 por minuto | Início até **3 anos** atrás; janela de até **6 meses**; 100 por página; só fechados e cancelados; sem o cliente. Fora disso: 400 "Parâmetros inválidos". |
| `GET /orders?updated_since=` | 300 a cada 3 min | `updated_since` de até 24 h, mas devolve só os alterados nas **últimas 8 horas**, tudo de uma vez (sem paginação). |
| `GET /orders/{id}` | 300 a cada 3 min | O pedido inteiro. |

Daí as regras do código:

- A carga começa **2 dias dentro** do limite de 3 anos (a carga de loja grande
  leva horas, e o limite conta de hoje) e, se ficar parada por dias, recomeça
  dentro dele.
- Consulta parada há **mais de 7 h** (a de alterados só alcança 8 h) vira carga
  a partir de 1 h antes da última consulta.
- Um passo faz no máximo 1 consulta de histórico e abre os pedidos com 650 ms
  entre um e outro (~92 por minuto); o próximo passo da mesma loja sai 15 s
  depois. Nenhuma chamada ao Cardápio Web acontece com transação aberta.
- O job (`CardapiowebPedidosJob`, a cada 15 s) reserva até 8 lojas por volta com
  uma trava no banco (`pedidos_trava_ate`, 5 min) — dois processos nunca cuidam
  da mesma loja, e a trava de processo que caiu vence sozinha. A reserva é uma
  **CTE materializada** (`where id in (select … limit N for update skip
  locked)` reserva mais que N com a RLS ligada). Espera a importação de
  clientes da loja terminar.

### Erros

| Erro | O que acontece |
| --- | --- |
| 429 | Espera 60 s e continua do mesmo ponto. |
| 5xx, rede, tempo esgotado | Espera 120 s e continua. |
| 401, 403 e demais 4xx | Para (`falhou`) com o motivo na tela. |
| 400 numa janela com mais de 1 ano | A janela é pulada (a documentação já disse "1 ano" num lugar e "3 anos" em outro). Numa janela recente, para — é erro de verdade. |
| Erro nosso (banco, código) | Motivo genérico na tela, detalhe no log; tenta de novo em 5 min. |

### Limitação conhecida

Pedido **criado antes** de uma parada de mais de 7 h e **cancelado durante**
ela não é visto pela carga que cobre o buraco (a carga pega os pedidos
**criados** no período). Essa compra continua guardada — só uma carga completa
(**Tentar de novo**, depois de a busca parar) a desfaz. Raro: pedido fechado
raramente é cancelado horas depois.
