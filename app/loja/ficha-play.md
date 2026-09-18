# Ficha do Regemcast na Google Play

Tudo o que o Play Console pede, pronto para copiar. Vale para a primeira
publicação (versão 0.5.0, código 5). Quando algo mudar no app, atualize aqui
antes de mexer na ficha.

## Arquivos

| O quê | Arquivo | Especificação da Play |
|---|---|---|
| Pacote para envio | `C:\RegemCast-apk\regemcast-0.5.0-play.aab` | AAB assinado com a chave de upload |
| Ícone | `app/loja/icone-512.png` | 512×512, PNG com alfa |
| Imagem de destaque | `app/loja/banner-1024x500.png` | 1024×500 |
| Capturas de celular | `app/loja/capturas/01…08` | 1080×1920 (proporção ≤ 2:1) |

O AAB da Play é gerado com `--dart-define=LOJA_PLAY=true`: a tela de plano
mostra situação, consumo e pagamentos, mas não oferece contratar nem trocar
(política de faturamento da Google). As capturas não incluem a tela de plano
por isso.

```
flutter build appbundle --release --dart-define=LOJA_PLAY=true
```

## Detalhes do app

- **Nome do app** (máx. 30): `Regemcast`
- **Descrição curta** (máx. 80, esta tem 77):

```
Acompanhe, pause e edite suas campanhas de mensagens e receba avisos na hora.
```

- **Descrição completa** (máx. 4.000):

```
O Regemcast no celular: acompanhe as campanhas da sua empresa enquanto elas saem, e aja na hora quando algo pede atenção.

CAMPANHAS
• Veja quanto já saiu, quanto foi entregue, lido e o que falhou — com o motivo de cada falha.
• Pause, retome, edite a janela de envio e os limites, ou cancele uma campanha.
• Receba um aviso quando a campanha termina ou para sozinha, por conexão, plano ou pagamento.

MODELOS
• Veja cada modelo de mensagem como ele chega para o cliente.
• Edite o texto, envie rascunhos para aprovação e exclua o que não usa mais.
• Saiba na hora quando um modelo é aprovado, recusado ou pausado.
• Todo modelo de marketing leva o botão "Parar promoções": quem toca não recebe mais, e o seu número não perde qualidade.

CONTATOS
• Importe contatos de um arquivo (.vcf, .csv, .xlsx ou .txt) ou colando os números, com prévia antes de gravar e registro de consentimento.
• Organize em listas e descadastre quem pediu para sair.

CONTA
• Plano, consumo do ciclo e histórico de pagamentos.
• Dados da empresa, equipe com acessos e o estado de cada número conectado.
• As regras de envio que a plataforma de mensagens exige, explicadas em português.

Entrada com senha e, se quiser, com a biometria do celular.

O aplicativo é para quem já tem conta no Regemcast. A criação de campanhas e de modelos novos é feita no painel, em cast.dmsregem.com.

Integração via API Oficial do WhatsApp Business. WhatsApp é marca da Meta Platforms, Inc., sem relação de patrocínio ou endosso com este serviço.
```

## Categoria e contato

- **Tipo:** App · **Categoria:** Empresas
- **E-mail:** `suporte@dmsregem.com`
- **Site:** `https://cast.dmsregem.com`
- **Política de privacidade:** `https://cast.dmsregem.com/privacidade`

## Conteúdo do app (Painel → Política → Conteúdo do app)

**Acesso ao app** → "Todas ou algumas funcionalidades estão restritas" → adicionar
instruções com um login de revisão:

- Crie um acesso só para a revisão, **sem duas etapas** (com elas a Google não
  consegue entrar). Recomendado: numa conta de demonstração, com alguns contatos,
  listas e campanhas em rascunho — um operador na conta real conseguiria
  pausar ou excluir campanhas e modelos de verdade.
- Texto das instruções:

```
Entre com o e-mail e a senha abaixo. O app abre no Painel. Campanhas, Modelos e Contatos ficam na barra de baixo; Plano, Conta, Usuários, WhatsApp e Regras ficam em "Mais". Criar campanha e criar modelo são feitos no painel web (cast.dmsregem.com), por decisão de produto.
```

**Anúncios:** não contém anúncios.

**Classificação do conteúdo** (questionário IARC): categoria *Utilitário,
produtividade, comunicação ou outro*. Responder **Não** a violência, sexo,
linguagem, drogas, jogos de azar, compras digitais e localização. Interação
entre usuários: **Não** (o app gerencia campanhas; não há bate-papo nem conteúdo
compartilhado entre pessoas no app).

**Público-alvo:** 18 anos ou mais. Não é voltado a crianças.

**App de notícias:** não · **Governo:** não · **Recursos financeiros:** não ·
**Saúde:** não.

**Exclusão de conta:** `https://cast.dmsregem.com/excluir-conta`

## Segurança dos dados (Data safety)

- Coleta ou compartilha dados? **Sim**.
- Criptografia em trânsito? **Sim** (HTTPS em todas as chamadas).
- A pessoa pode pedir exclusão? **Sim** — `https://cast.dmsregem.com/excluir-conta`.
- **Compartilhamento: nenhum tipo marcado como compartilhado.** Google (push)
  e Mercado Pago atuam como prestadores de serviço, o que a Play não conta como
  compartilhamento.

| Tipo (nome na Play) | Coletado | Obrigatório | Finalidade |
|---|---|---|---|
| Informações pessoais → Nome | Sim | Sim | Funcionalidade do app; Gerenciamento da conta |
| Informações pessoais → Endereço de e-mail | Sim | Sim | Funcionalidade do app; Gerenciamento da conta |
| Informações pessoais → Número de telefone (dos contatos importados) | Sim | Não | Funcionalidade do app |
| Informações financeiras → Histórico de compras (pagamentos do plano) | Sim | Não | Gerenciamento da conta |
| Arquivos e documentos (arquivo de importação) | Sim, **processado temporariamente** | Não | Funcionalidade do app |
| Outro conteúdo gerado pelo usuário (texto dos modelos) | Sim | Não | Funcionalidade do app |
| IDs do dispositivo ou outros IDs (identificador de avisos) | Sim | Não | Funcionalidade do app |

Não coletado: localização, contatos da agenda, fotos, áudio, mensagens,
atividade de navegação, dados de saúde, diagnóstico de falhas, dados de cartão
(o pagamento é na página do Mercado Pago).

## Assinatura do app e quem já tem o APK

- Aceite o **Play App Signing** com chave gerada pela Google. A chave de upload
  é `C:\RegemCast-chaves\regemcast-upload.jks` — ela assina o AAB; a Google
  reassina para distribuir.
- O pacote `com.dmsregem.regemcast` já foi instalado fora da Play (APK). Se o
  Console pedir prova de posse da chave, é esta mesma chave de upload.
- Quem tem o APK instalado precisa **desinstalar antes** de instalar pela Play:
  a assinatura da Play é outra e o Android recusa a atualização por cima.

## Notas da versão (0.5.0)

```
Primeira versão do Regemcast para Android: campanhas, modelos, contatos, plano e conta na palma da mão, com avisos no celular.
```
