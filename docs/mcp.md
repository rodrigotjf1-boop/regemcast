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
  acessos do console. Nenhum dos dois guarda o token.

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
  escopo diz isso por extenso;
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

As conversas por anúncio, os rascunhos e o disparo entram nos próximos PRs.

## O que falta

- Conversas abertas por anúncio: guardar a origem do anúncio na conversa e a
  leitura que o Liame espera (contrato `docs/integracoes/regemcast.md` do Liame).
- Rascunho de modelo e de campanha; o autor "integração" na auditoria.
- Disparo para produto da DMS: planejar (público, custo, saldo do orçamento) e
  executar, com chave de idempotência.
- "Aplicativos conectados" no app Android.
- No Liame: o conector que consome estas ferramentas, e a emenda da ADR-008 e
  da ADR-019 registrando a decisão 2.

## Fontes

- [Especificação MCP 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28) (conferida em 02/10/2026: sem estado, pedidos autocontidos, negociação por pedido).
- [SDK TypeScript v2 — servir por HTTP](https://ts.sdk.modelcontextprotocol.io/v2/serving/http) (`createMcpHandler`, `handler.fetch(request, { authInfo, parsedBody })`, clientes da geração 2025 atendidos sem estado).
- Liame: `docs/adr/ADR-008-mcp.md`, `docs/adr/ADR-019-integracao-regem-regemcast.md`, `docs/base-conhecimento.md` §8.1 e §13.1.
