# Deploy — EasyPanel + Cloudflare

Três serviços, um projeto. O repositório é `rodrigotjf1-boop/regemcast`
(privado), branch `main`. O EasyPanel builda a partir dele.

---

## ⚠️ Antes de escolher subdomínio: o Universal SSL só cobre um nível

O certificado gratuito do Cloudflare cobre **o domínio raiz e subdomínios de
primeiro nível**, e nada mais fundo
([limitações do Universal SSL](https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/limitations/)).

| Hostname | Nível | Universal SSL cobre? |
|---|---|---|
| `dmsregem.com` | raiz | sim |
| `cast.dmsregem.com` | 1º | sim |
| `castapi.dmsregem.com` | 1º | sim |
| `api.cast.dmsregem.com` | **2º** | **não** |

O sintoma quando se erra isso é cruel: o DNS resolve normalmente, o registro
aparece certinho no painel do Cloudflare, e o navegador não dá erro de "site
não encontrado" — **o handshake TLS falha antes de qualquer resposta HTTP**. No
`curl` aparece `SEC_E_ILLEGAL_MESSAGE` ou `alert handshake failure`; no
navegador, uma tela genérica de conexão insegura.

Aconteceu neste projeto: a primeira tentativa usou `api.cast.dmsregem.com` e a
API ficou inalcançável, enquanto `cast.dmsregem.com` funcionava — o que faz
parecer problema do serviço, e não do certificado.

**Regra: todo hostname do Regemcast é de primeiro nível.**

As alternativas, se um dia for inevitável usar segundo nível: pagar o Advanced
Certificate Manager (~US$ 10/mês) e ligar o Total TLS, ou desligar o proxy
(nuvem cinza) e deixar o EasyPanel emitir Let's Encrypt — o que expõe o IP da
VPS e abre mão do Cloudflare na frente.

---

## Hostnames

| Hostname | Serviço | Porta |
|---|---|---|
| `cast.dmsregem.com` | `regemcast-web` | 3001 |
| `castapi.dmsregem.com` | `regemcast-api` | 3000 |

---

## 1. DNS (Cloudflare)

Painel → domínio `dmsregem.com` → **DNS** → **Records** → **Add record**:

| Type | Name | Content | Proxy |
|---|---|---|---|
| `A` | `cast` | IP da VPS | Proxied |
| `A` | `castapi` | IP da VPS | Proxied |

---

## 2. `regemcast-redis`

**+ Service → Redis.** Nome `regemcast-redis`, imagem `redis:7-alpine`. Sem
domínio e sem porta pública — só rede interna. A URL interna fica
`redis://regemcast-redis:6379`.

---

## 3. `regemcast-api`

**Source:** GitHub → `rodrigotjf1-boop/regemcast` → `main`.

**Build:** Dockerfile · path `backend/Dockerfile` · **context `/`** (a raiz —
o Dockerfile copia `database/migrations` de lá).

**Environment:**

```
NODE_ENV=production
PORT=3000
DATABASE_URL=postgres://regemcast_app:SENHA@HOST.supabase.co:5432/postgres
DATABASE_SSL=supabase
REDIS_URL=redis://regemcast-redis:6379
JWT_SECRET=<openssl rand -base64 48>
JWT_TTL_HORAS=12
COOKIE_NOME=regemcast_sess
COOKIE_DOMINIO=
APP_URL=https://cast.dmsregem.com
API_URL=https://castapi.dmsregem.com
CORS_ORIGIN=https://cast.dmsregem.com
TRUST_PROXY=1
TRUST_CLOUDFLARE=true
SWAGGER_ENABLED=false
RASTREIO_BASE_URL=https://castapi.dmsregem.com/r
DIST_TOKEN=<openssl rand -hex 32>
META_GRAPH_VERSAO=v25.0
META_TOKEN_CHAVE=<openssl rand -base64 32>
```

**Domains:** `castapi.dmsregem.com` · porta `3000` · HTTPS ligado.

### Variáveis que os recursos pedem (a API sobe sem elas)

O bloco acima é o mínimo para a API **subir**. As de baixo são opcionais para o
processo e **obrigatórias para o recurso**: sem elas a API não cai — o recurso
é que responde 503 dizendo qual variável falta, só quando alguém o usa. Foi
assim que a `INTEGRACOES_CHAVE` passou despercebida em produção até o dia de
ligar a primeira conta ao Regem (ERR-033). Ao criar o serviço, confira a lista
inteira; **variável nova no código entra aqui no mesmo PR**.

| Variável | Para quê | Como gerar / de onde vem |
| --- | --- | --- |
| `INTEGRACOES_CHAVE` | Cifra as credenciais das integrações (token da loja do Cardápio Web, token do Regem). Sem ela nenhuma integração liga. **Não trocar depois de usar**: o que foi guardado deixa de abrir. | `openssl rand -base64 32` (32 bytes em base64) |
| `REGEM_API_URL` | Base da API de integração do Regem. | Padrão `https://api.dmsregem.com/api/v1`; só definir para apontar a outro ambiente |
| `CARDAPIOWEB_API_URL` | Base da API do Cardápio Web. | Padrão `https://integracao.cardapioweb.com` |
| `META_APP_ID`, `META_APP_SECRET`, `META_CONFIG_ID`, `META_VERIFY_TOKEN` | Conexão do WhatsApp (Embedded Signup) e webhook da Meta. | Painel do app na Meta — ver [`whatsapp.md`](whatsapp.md) |
| `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SEGREDO` | Assinaturas pelo Mercado Pago. Sem o token, contratar responde 503; sem o segredo, os avisos são gravados e nunca processados. | Painel do Mercado Pago (conta da SISTER TECNOLOGIA) |
| `CARENCIA_DIAS` | Dias sem pagamento até os disparos pararem (fim do grátis, cobrança recusada, integração com o Regem desligada). | Padrão `5` |
| `RESEND_API_KEY`, `EMAIL_REMETENTE` | E-mails do sistema (códigos, convites, fim do grátis). Em produção, sem a chave o envio recusa com 503. | Painel do Resend |
| `CONTA_TOTP_CHAVE` | Cifra o segredo do aplicativo autenticador dos clientes. | `openssl rand -base64 32` |
| `DIST_TOTP_CHAVE`, `DIST_COOKIE_NOME`, `DIST_TTL_HORAS` | Console de distribuição: duas etapas dos operadores, cookie e validade da sessão. | Chave: `openssl rand -base64 32`; os outros têm padrão (`regemcast_dist`, `8`) |
| `FIREBASE_CONTA_SERVICO` | Avisos (push) do app Android. Sem ela o push fica desligado e nada mais muda. | JSON da conta de serviço do Firebase, em texto ou base64 |
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_BUCKET` | Arquivo de mídia dos modelos e das conversas. | Supabase → Project Settings → API; bucket padrão `regemcast-midia` |
| `JWT_TTL_APP_DIAS` | Validade da sessão do aplicativo. | Padrão `30` |
| `TETO_CLIENTES_NOVOS_7D` | Quantas contas novas por semana a lista de espera libera. | Padrão `10` |
| `DATABASE_CA_CERT`, `DATABASE_POOL_MAX` | Ajustes da conexão com o banco. | Só em caso especial; ver abaixo |

### Por que `DATABASE_SSL=supabase`, e não `require`

O Postgres do Supabase — direto ou pelo pooler — apresenta certificado
assinado pela **CA raiz própria deles**, que é auto-assinada e **não está no
bundle do Node**. Com `require`, a conexão morre com
`self-signed certificate in certificate chain` (SELF_SIGNED_CERT_IN_CHAIN).

Comprovado contra o servidor real:

```
$ openssl s_client -connect aws-0-sa-east-1.pooler.supabase.com:5432 -starttls postgres
  verify error:num=19:self-signed certificate in certificate chain

$ openssl s_client ... -CAfile backend/certs/supabase-root-2021.crt
  Verify return code: 0 (ok)
```

`supabase` usa a raiz que vem no repositório (`backend/certs/`) e mantém a
verificação **real**. A saída fácil seria `rejectUnauthorized: false`, que é o
que quase todo tutorial manda: aquilo mantém a criptografia e joga fora a
autenticação — continua interceptável, porque nada garante que do outro lado
está mesmo o seu banco.

Existe `no-verify` como escape de emergência, e ele grita no log a cada boot.

### Por que `COOKIE_DOMINIO` fica VAZIO

Vazio significa cookie **host-only**: o navegador o devolve só para
`castapi.dmsregem.com`, que é quem o emitiu.

Preencher seria pior em qualquer variação. `cast.dmsregem.com` não funcionaria
— `castapi` é **irmão**, não subdomínio dele, e não receberia o cookie. E
`.dmsregem.com` funcionaria, mas mandaria o cookie de sessão do Regemcast
também para `app.dmsregem.com` e `api.dmsregem.com`, que são do **Regem**.

Host-only funciona entre os dois porque `SameSite=Lax` olha o domínio
registrável, não o host: `cast.dmsregem.com` e `castapi.dmsregem.com` têm o
mesmo `dmsregem.com`, logo são **same-site** (ainda que cross-origin). O
`fetch` com `credentials: 'include'` leva o cookie, e o CORS já autoriza
credenciais.

---

## 4. `regemcast-web`

**Source:** mesmo repositório e branch.

**Build:** Dockerfile · path `frontend/Dockerfile` · **context `/`** ·
**sem build args** (não existe nenhum).

**Environment:**

```
NODE_ENV=production
PORT=3001
API_URL_PUBLICA=https://castapi.dmsregem.com/api/v1
```

`API_URL_PUBLICA`, e não `NEXT_PUBLIC_API_URL`: o endereço é lido pelo servidor
Next **a cada inicialização** e injetado na página (ver
`frontend/src/lib/config-runtime.tsx`). A imagem é a mesma em qualquer
ambiente, e trocar de domínio é trocar a variável e **reiniciar** — sem
rebuildar.

**Domains:** `cast.dmsregem.com` · porta `3001` · HTTPS ligado.

---

## 5. Conferir, nesta ordem

```bash
# 1. a API responde e o TLS fecha
curl -sS https://castapi.dmsregem.com/api/v1/saude
#    esperado: {"ok":true,"tempoDeVidaSeg":N}

# 2. banco e fila
curl -sS https://castapi.dmsregem.com/api/v1/saude/pronto
#    esperado: {"postgres":"ok","redis":"ok"}

# 3. a web sobe
curl -sI https://cast.dmsregem.com | head -1

# 4. e aponta para a API certa
curl -s https://cast.dmsregem.com/entrar | grep -o '__REGEMCAST_CONFIG__={[^}]*}'
```

Se o passo 1 falhar com erro de TLS e não de HTTP, releia a primeira seção
deste arquivo: quase sempre é o nível do subdomínio.

Se um deploy falhar no boot, o log do EasyPanel traz o nome exato da variável
que falta — `config/env.ts` derruba o processo no start em vez de deixar virar
um 500 obscuro no primeiro request.

---

## Migrations

Os dois serviços ficam em **auto-deploy**: o merge na `main` implanta sozinho.
Não há clique manual para segurar o código enquanto a migration não foi
aplicada — a ordem "migration antes do merge" é a única proteção.

**Se o auto-deploy parar de funcionar**, o suspeito número um é a URL do
webhook, não o EasyPanel. Ele gera o webhook a partir do endereço do próprio
painel; se o painel não tiver domínio na hora em que o serviço foi criado, sai
`http://<ip>:3000/api/deploy/<token>` — e o GitHub não alcança isso. Aconteceu
aqui em 15/set/2026: toda entrega voltava `failed to connect to host` / 502
com a caixa de auto-deploy marcada. Diagnóstico, sem abrir o painel:

```bash
gh api repos/rodrigotjf1-boop/regemcast/hooks --jq '.[] | "\(.active)  \(.config.url)"'
gh api repos/rodrigotjf1-boop/regemcast/hooks/<id>/deliveries?per_page=5 --jq '.[] | "\(.delivered_at) \(.status) \(.status_code)"'
```

A correção é trocar só o host para `https://painel.dmstecnologias.com`,
mantendo o token de cada serviço.

---

O deploy **não** aplica migration. A regra do projeto é: quem aplica na nuvem é
o dono, à mão, conferindo antes (ver [`banco.md`](./banco.md)). O código sobe
no merge; a migration vai antes dele, nunca depois — entre os dois, o Drizzle
pede colunas que ainda não existem e a tela fica vazia sem erro.
