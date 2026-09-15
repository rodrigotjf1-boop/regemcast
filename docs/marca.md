# Marca Regemcast

Fonte da verdade: **`kit/LEIA-ME.md`**. Este arquivo é o resumo operacional —
o que precisa ser obedecido ao escrever código e texto. Onde divergirem, o kit
vence.

Direção **04 "Pulso", versão Lima**. Família Regem · DMS Tecnologia.

## Grafia do nome

**Regemcast** — um `R` maiúsculo, o resto minúsculo. Não é "RegemCast" nem
"REGEMCAST". No logotipo o wordmark aparece todo em minúsculas (`regemcast`),
porque é assim que o vetor foi fechado.

## Cores

| Uso | Nome | HEX |
|---|---|---|
| Ação, destaque | Lima Pulso | `#A3E635` |
| Base: fundo escuro e texto | Ameixa | `#2B1B3D` |
| Destaque secundário | Amarelo | `#FFD166` |
| Fundo claro | Creme | `#FFF3EA` |

As três regras que mandam, e por quê:

1. **Painel usa ameixa como base; lima só em ação e destaque.** Lima não é cor
   de fundo de tela.
2. **Sobre lima, texto sempre em ameixa. Nunca branco.** Medido: lima sobre
   branco dá **1,36:1** — reprovado em qualquer critério de contraste. Lima
   sobre ameixa dá **9,6:1**.
3. **Não escureça nem esverdeie o lima.** Ele precisa manter distância do verde
   do WhatsApp (`#25D366`), que é mais escuro e mais verde. Isso vale inclusive
   para estado de *hover*: não existe "lima escuro".

Da regra 2 decorre uma que o kit não precisou escrever, mas o código precisa
respeitar: **lima não serve como cor de texto sobre fundo claro**. Por isso, em
`globals.css`:

| Token | Tema claro | Tema escuro | Para quê |
|---|---|---|---|
| `--cor-acento` | lima | lima | **preenchimento** (botão, selo) |
| `--cor-acento-contraste` | ameixa | ameixa | texto **sobre** lima |
| `--cor-acento-forte` | **ameixa** | **lima** | texto, link, ênfase |
| `--cor-acento-suave` | lima diluído | ameixa clara | fundo de selo e aviso |

No tema escuro o lima está sobre ameixa, então ali ele **pode** ser texto.

## Tipografia

**Poppins** (SIL OFL). Vendorizada em `frontend/src/fonts/` como `.woff2`, com
`@font-face` em `globals.css`.

Não use `next/font/google`: ele baixa a fonte **durante o build**, e trava
quando a máquina de build não tem rede — foi problema real no Regem. O arquivo
já está no repositório; o build não depende de rede.

O wordmark do logo já vem em curvas nos vetores, então não depende de fonte
instalada em lugar nenhum.

## Regras da Meta — valem para nome, código e texto

Estas não são preferência estética. Descumprir arrisca o App Review e a conta.

- **Nunca** use "WhatsApp", "WA" ou "Zap" no **nome do produto**, no **ícone**,
  no **domínio**, ou combinado ao logo Regemcast.
- Em descrição (loja, site, post, `<meta description>`) use o descritor exato:
  **"Integração via API Oficial do WhatsApp Business"**. Ele está como
  constante `DESCRITOR` em `frontend/src/app/layout.tsx`.
- **Não** use o verde do WhatsApp `#25D366` como cor de marca.
- **Não** prometa "selo verificado": a verificação é concedida pela Meta à conta
  do cliente, não pelo app.

Na interface, prefira nomear a ação ("Conectar o número") a nomear a plataforma
alheia ("Conectar o WhatsApp").

## Onde cada arquivo é usado

| Arquivo | Onde |
|---|---|
| `frontend/public/favicon.ico`, `favicon-32/192/512.png` | aba do navegador, PWA |
| `frontend/public/apple-touch-icon.png` | atalho no iOS |
| `frontend/public/marca/og.png` | prévia ao compartilhar link |
| `frontend/public/marca/logo-horizontal-{claro,escuro}.svg` | peças que precisam do lockup completo |
| `frontend/src/components/marca/logotipo.tsx` | lockup da interface (símbolo inline + wordmark) |

O símbolo é inline no componente, não `<img>`, porque o traço do pulso muda com
o tema — branco no claro, ameixa no escuro — via `--cor-pulso`.

## Respiro e tamanho mínimo

- Respiro: altura do balão ÷ 4, em todos os lados.
- Lockup horizontal: mínimo **120 px** de largura em tela, 30 mm impresso.
  Abaixo disso, só o símbolo. Abaixo de 24 px, use `favicon-16/32`, que têm o
  pulso mais grosso.

## O que ainda não foi usado

O kit traz muito mais do que o painel consome hoje: ícones Android completos
(`kit/icones/android/`), 5 animações em GIF/MPEG/WebM/Lottie
(`kit/animacoes/`), peças de redes sociais e o hero do site
(`kit/redes-sociais/`, `kit/site/`). Entram quando existir app Android, landing
ou campanha — não antes.

Para regenerar o kit a partir dos vetores, veja a última seção de
`kit/LEIA-ME.md` (requer Python, Playwright e ffmpeg).
