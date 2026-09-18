# RegemCast — app Android

O RegemCast no celular: acompanhar campanhas, disparar, pausar e editar o que já
existe. Criar modelo e montar campanha continuam na web — por decisão de produto,
e a regra vive no servidor (sessão do app tem escopo `app`, e as duas rotas de
criação recusam esse escopo).

Flutter 3.44 · Android 7.0+ (minSdk 24) · pacote `com.dmsregem.regemcast`.

## Estrutura

```
lib/
  config.dart          endereço da API e do site (definidos no build)
  api/                 cliente HTTP, erros legíveis, modelos de dados, leituras
  sessao/              cofre (Keystore) e o controle da sessão
  tema/                cores e tema — as MESMAS da web (frontend/src/app/globals.css)
  componentes/         marca, cartão, pílula, anel de consumo, estados
  telas/               entrar, portas (abrindo/biometria/sem conexão), casca, painel
test/                  cliente da API, dados, tela de entrada; capturas das telas
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
