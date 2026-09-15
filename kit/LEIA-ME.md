# Regemcast — Kit de mídia (direção 04 · Pulso · versão Lima)

Produto: app Android de disparos e campanhas via API Oficial do WhatsApp Business, com painel de controle. Família Regem · DMS Tecnologia.

## Estrutura

```
logo/
  svg/   12 arquivos vetoriais mestres (fonte de tudo)
  pdf/   mesmos 12, em PDF vetorial
  eps/   mesmos 12, em EPS (PostScript nível 3, RGB) para gráfica
  png/   2400 px de largura, fundo transparente
  jpeg/  2400 px, fundo branco (versões claras) ou ameixa (versões escuras)
icones/
  play-store/  icone-play-store-512.png (obrigatório na Play Console) e 1024
  android/     mipmap-*dpi (ic_launcher, foreground, background), drawable-*dpi (ícone de status),
               mipmap-anydpi-v26/ic_launcher.xml, drawable/*.xml (vector drawables), values/
  web/         favicon.ico, favicon.svg, favicon-16…512.png, apple-touch-icon-180.png
  svg/         fontes vetoriais dos ícones
animacoes/
  01-abertura-app        1080×1920 · 2,6 s · splash (fundo lima)
  02-loader-disparo      400×400  · loop 1,6 s · fundo transparente
  03-logo-reveal-video   1920×1080 · 3,4 s · abertura para vídeo (fundo ameixa)
  04-sticker-redes       512×512  · loop 1,2 s · fundo transparente
  05-indicador-ao-vivo   240×240  · loop 1,5 s · fundo transparente
  Cada pasta: .gif, .mp4 (H.264), .webm (VP9, com alfa nas transparentes), .html (fonte da animação).
  02 e 05 também em Lottie (.json).
redes-sociais/  png + jpeg: avatar, capas LinkedIn/Facebook, banner Play Store, 3 posts feed, 3 stories
site/           png + jpeg: hero 1920×1080 e OG image 1200×630
build/          scripts que geram tudo a partir dos vetores (Python + Playwright + ffmpeg)
```

Nomenclatura dos logos: `regemcast-{simbolo|horizontal|vertical}-{cor-claro|cor-escuro|mono-preto|mono-branco}`.
- **cor-claro**: para fundos claros (wordmark ameixa)
- **cor-escuro**: para fundos escuros (wordmark branca)
- **mono-preto / mono-branco**: uma cor, para carimbo, gravação, impressão 1 cor. O pulso é "recortado" para o fundo.

## Cores

| Uso | Nome | HEX | RGB | CMYK aprox. |
|---|---|---|---|---|
| Principal (balão, ações) | Lima Pulso | #A3E635 | 163 230 53 | 35 0 85 0 |
| Base (fundos, texto) | Ameixa | #2B1B3D | 43 27 61 | 80 90 40 40 |
| Destaque secundário | Amarelo | #FFD166 | 255 209 102 | 0 18 65 0 |
| Fundo claro | Creme | #FFF3EA | 255 243 234 | 0 5 8 0 |
| Texto sobre escuro | Branco | #FFFFFF | 255 255 255 | 0 0 0 0 |

Regra prática: painel web e documentos usam **ameixa** como base e **lima** só em ações e destaques. Peças de aquisição (posts, stories, banner) podem inverter: fundo lima, tipografia ameixa. Nunca coloque texto branco sobre lima — o contraste não passa; sobre lima, texto sempre em ameixa.

## Tipografia

- Wordmark: **Poppins Bold** com cantos suavizados (já convertida em curvas em todos os vetores — não depende de fonte instalada).
- Textos de apoio: **Poppins** (SIL Open Font License, gratuita — Google Fonts).
- Observação: na apresentação das 5 direções o wordmark aparecia em Nunito Black. O kit foi fechado em Poppins Bold suavizada, que é a fonte disponível para vetorização neste ambiente e mantém o mesmo tom (geométrica, arredondada). Se preferir Nunito, basta trocar `FONT` em `build/textpath.py` e rodar `build/masters.py` novamente.

## Área de respiro e tamanho mínimo

- Respiro: a altura do balão do símbolo ÷ 4, em todos os lados.
- Tamanho mínimo do lockup horizontal: 120 px de largura (tela) / 30 mm (impresso).
- Abaixo disso, use só o símbolo. Abaixo de 24 px, use `icones/web/favicon-16/32` (pulso mais grosso).

## Android — como usar os ícones

1. Copie `icones/android/mipmap-*`, `drawable-*`, `drawable/`, `values/` e `mipmap-anydpi-v26/` para `app/src/main/res/`.
2. `ic_launcher.xml` já declara background (cor), foreground e monochrome (ícone temático do Android 13+).
3. Ícone de notificação: `ic_stat_regemcast` (branco com pulso recortado). Use com `setSmallIcon()` e `setColor(0xFFA3E635)`.
4. Play Console: `icones/play-store/icone-play-store-512.png` (512×512, 32-bit PNG, sem transparência) e `redes-sociais/png/banner-play-store-1024x500.png` como gráfico de destaque.

## Regras de marca em relação à Meta / WhatsApp

- Nunca use "WhatsApp", "WA", "Zap" ou o logo do WhatsApp no nome do app, no ícone, no domínio ou combinado ao logo Regemcast.
- Nas descrições (loja, site, posts) use o descritor exato: "Integração via API Oficial do WhatsApp Business".
- Não use o verde do WhatsApp (#25D366) como cor de marca. O lima #A3E635 é bem mais amarelado e claro que ele; mantenha essa distância — não escureça nem esverdeie o lima em nenhuma peça, e mantenha o ameixa como cor dominante nos fundos.
- Não prometa "selo verificado": a verificação é concedida pela Meta à conta do cliente, não pelo app.

## Animações — notas

- GIFs foram reduzidos (240–640 px) para redes e chat. Para vídeo e site prefira MP4/WebM, que têm qualidade e peso melhores.
- WebM das animações 02, 04 e 05 tem canal alfa (fundo transparente) — funciona em Chrome/Edge/Firefox e no Android.
- Os arquivos Lottie (02 e 05) foram gerados por script. Antes de usar em produção, abra no [LottieFiles](https://lottiefiles.com/) ou no app para conferir; se algo não bater, os .html da mesma pasta são a referência visual.
- Splash do Android 12+: use o símbolo em `logo/svg/regemcast-simbolo-cor-escuro.svg` com fundo `#A3E635` no `windowSplashScreenBackground`, e a animação 01 como splash customizada nas versões anteriores.

## Regenerar o kit

```
cd build
python3 masters.py && python3 eps.py     # vetores
python3 icons.py                          # ícones
python3 anim.py && python3 lottie.py      # animações
python3 social.py                         # redes e site
```
Requer Python 3 (Pillow, fontTools), Node com Playwright/Chromium e ffmpeg.
