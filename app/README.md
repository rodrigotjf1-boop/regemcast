# RegemCast — app Android

O RegemCast no celular, com os mesmos recursos do site (decisão do dono em
29/09/2026). Já no app:

- **modelos** — criar e editar com o mesmo editor do site: imagem, vídeo e
  documento no cabeçalho, carrossel, oferta por tempo limitado e a prévia clara
  e escura. As regras da Meta continuam num lugar só: o `POST /modelos/conferir`
  do servidor, que o app chama antes de enviar;
- **campanhas** — montar (modelo aprovado com as variáveis e a origem de cada
  uma, "Quem recebe" por lista/bloco, da base ou números digitados, a prévia de
  quantos recebem, o descanso, a sugestão de horário e a janela de envio),
  editar, disparar, pausar e acompanhar — com a espera pelo limite da Meta e
  quem respondeu;
- **contatos** — a base com as compras de cada pessoa (pedidos, gasto, última
  compra, o que costuma pedir, cashback), o perfil e como ela autorizou; os
  perfis (com as regras do dono), os públicos pelas compras, produtos, bairros,
  aniversariantes e regiões pelo DDD para filtrar e virar lista; dividir em
  blocos com o resultado de cada bloco; os bloqueios (voltar à base com o
  pedido registrado, apagar dados, apagar tudo) e os números sem WhatsApp; e a
  importação com as colunas extras da planilha (e-mail, aniversário, pedidos,
  total gasto e última compra), igual à do site;
- **conversas** — com as conversas ligadas (coexistência + "Sim, trazer"), a
  aba Conversas toma o lugar de Modelos na barra e Modelos vai para "Mais"
  (decisão do dono em 29/09/2026). A lista e a conversa aberta se atualizam
  sozinhas (15 s e 5 s, só com a tela na frente); resposta de texto só dentro
  da janela de 24 horas; fotos na hora, áudio e vídeo no play (`video_player`,
  com a sessão no cabeçalho) e documentos salvos no celular pela janela do
  Android; "Adicionar à lista" e a guarda das mensagens (só o dono).

Nenhuma rota do servidor recusa a sessão do app (`escopo: app`); ele decide só
a validade e a renovação da sessão.

Leitura que falha **não** se repete sozinha: o Riverpod 3 repetiria até 10
vezes com a tela em "carregando" (`ProviderScope(retry: semRepeticao)` no
`main.dart`) — o erro aparece na hora, com o "Tentar de novo".

Flutter 3.44 · Android 7.0+ (minSdk 24) · pacote `com.dmsregem.regemcast`.

## Estrutura

```
lib/
  config.dart          endereço da API e do site (definidos no build)
  api/                 cliente HTTP, erros legíveis, modelos de dados, leituras
  sessao/              cofre (Keystore) e o controle da sessão
  tema/                cores e tema — as MESMAS da web (frontend/src/app/globals.css)
  componentes/         marca, cartão, pílula, anel de consumo, estados, prévia do WhatsApp
  telas/               entrar, portas (abrindo/biometria/sem conexão), casca, painel,
                       modelos (lista, detalhe e o editor), campanhas, contatos
                       (lista, públicos, blocos e listas), dividir em blocos,
                       bloqueios, importar e conversas (lista e a conversa)
test/                  cliente da API, dados, telas (entrada, campanhas, editor de
                       modelo, contatos, conversas); capturas das telas
```

## Sessão e segurança

- O login manda `dispositivo: "app"`; a API devolve o token no corpo, com
  validade de 30 dias (`JWT_TTL_APP_DIAS`) e renovação automática perto do fim.
- O token mora no cofre do Android (`flutter_secure_storage`), nunca em texto.
  O backup automático está desligado no manifesto para ele não ir para outro
  aparelho.
- Duas etapas: o cookie da pré-sessão fica só em memória e só vai para as rotas
  de `/auth/login`.
- Biometria opcional para reabrir, oferecida uma vez após o primeiro login.
- Trocar a senha ou suspender o acesso derruba a sessão do app na hora.

## Mídia dos modelos

O arquivo escolhido no celular sobe para `POST /midia` (multipart, com o tipo
declarado na parte — o servidor aceita pelo tipo e pelos primeiros bytes) e o
modelo guarda a referência `midia:<uuid>`. O seletor do Android já filtra o que
a Meta aceita (JPG/PNG até 5 MB, MP4 até 16 MB, PDF até 16 MB), e o tamanho é
conferido antes de subir pelos dados móveis. O seletor fica atrás de
`escolherMidiaProvider` para o teste trocá-lo por um falso (o canal nativo não
existe no `flutter test`).

## Rodar

```
flutter pub get
flutter run                                                    # contra produção
flutter run --dart-define=API_URL=http://10.0.2.2:3010/api/v1  # API local no emulador
```

O manifesto de depuração libera `http` só para esse teste local; o APK de
produção aceita apenas `https`.

## Testes

```
flutter analyze
flutter test
CAPTURAS=1 flutter test test/capturas_test.dart --update-goldens   # imagens em test/_capturas/
```

O CI roda análise e testes em toda PR que mexe em `app/`.

## Gerar o APK

```
flutter build apk --release        # build/app/outputs/flutter-apk/app-release.apk
flutter build appbundle --release  # para a Play Store (.aab)
```

A cada versão, suba `version:` no `pubspec.yaml` (`0.1.0+1` → `0.2.0+2`): o
número depois do `+` é o `versionCode`, e a Play recusa um que não seja maior
que o anterior.

## A chave de upload (Play Store)

O APK de produção é assinado com a chave de upload, que **não fica no
repositório**:

- `C:\RegemCast-chaves\regemcast-upload.jks` — a chave;
- `C:\RegemCast-chaves\key.properties` — senhas e caminho (cópia de
  `app/android/key.properties`, que o Git ignora).

**Guarde uma cópia dos dois arquivos fora deste computador** (cofre de senhas ou
armazenamento criptografado). Sem eles não dá para publicar atualização. Com a
assinatura de apps da Play ativada, a Google guarda a chave final e a de upload
pode ser trocada pelo suporte — mas isso leva dias.

Sem o `key.properties` (no CI, ou numa máquina nova), o release assina com a
chave de depuração: compila, e a Play recusa — não há como publicar com a chave
errada por engano.

## Ícone

Gerado a partir do símbolo da marca (`assets/marca/`). Para refazer:
`dart run flutter_launcher_icons`.
