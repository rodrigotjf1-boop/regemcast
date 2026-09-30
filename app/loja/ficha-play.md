# Ficha do Regemcast na Google Play

Tudo o que o Play Console pede, pronto para copiar. Atualizado para a versão
0.6.0 (código 6) — a que tem os recursos do site. Quando algo mudar no app,
atualize aqui antes de mexer na ficha.

## Arquivos

| O quê | Arquivo | Especificação da Play |
|---|---|---|
| Pacote para envio | `C:\RegemCast-apk\regemcast-0.6.0-play.aab` | AAB assinado com a chave de upload |
| Ícone | `app/loja/icone-512.png` | 512×512, PNG com alfa |
| Imagem de destaque | `app/loja/banner-1024x500.png` | 1024×500 |
| Capturas de celular | `app/loja/capturas/01…08` | 1080×1920 (proporção ≤ 2:1) |

O AAB da Play é gerado com `--dart-define=LOJA_PLAY=true`: a tela de plano
mostra situação, consumo e pagamentos, mas não oferece contratar nem trocar
(política de faturamento da Google) — e nenhum aviso do app chama para pagar
nem abre o plano no site (ERR-029). As capturas não incluem a tela de plano
por isso.

```
flutter build appbundle --release --dart-define=LOJA_PLAY=true
```

## Detalhes do app

- **Nome do app** (máx. 30): `Regemcast`
- **Descrição curta** (máx. 80, esta tem 75):

```
Crie e acompanhe campanhas de mensagens, responda clientes e receba avisos.
```

- **Descrição completa** (máx. 4.000):

```
O Regemcast no celular: monte, dispare e acompanhe as campanhas da sua empresa, responda os clientes e aja na hora quando algo pede atenção.

CAMPANHAS
• Monte a campanha no celular: o modelo aprovado, quem recebe (lista, bloco ou público da base), a janela de envio e a sugestão de horário.
• Veja quanto já saiu, quanto foi entregue, lido e o que falhou — com o motivo de cada falha e quem respondeu.
• Pause, retome, edite a janela de envio e os limites, ou cancele uma campanha.
• Receba um aviso quando a campanha termina ou para sozinha, por conexão, plano ou pagamento.

MODELOS
• Crie e edite modelos com imagem, vídeo ou documento no cabeçalho, carrossel e oferta por tempo limitado, com a prévia de como chegam ao cliente.
• As regras de aprovação são conferidas antes de enviar para análise.
• Saiba na hora quando um modelo é aprovado, recusado ou pausado.
• Todo modelo de marketing leva o botão "Parar promoções": quem toca não recebe mais, e o seu número não perde qualidade.

CONTATOS
• Importe contatos de um arquivo (.vcf, .csv, .xlsx ou .txt) ou colando os números, com prévia antes de gravar e registro de consentimento.
• Veja as compras de cada pessoa, os perfis e os públicos (produtos, bairros, aniversariantes, regiões) e divida a base em blocos.
• Descadastre quem pediu para sair e acompanhe os números sem WhatsApp.

CONVERSAS
• Com as conversas do número ligadas, veja as mensagens dos clientes — com fotos, áudios, vídeos e documentos — e responda dentro da janela de 24 horas.

CONTA E SEGURANÇA
• Plano, consumo do ciclo e histórico de pagamentos.
• Dados da empresa, equipe com acessos, o estado de cada número conectado e as integrações.
• Verificação em duas etapas por aplicativo autenticador ou código por e-mail, e entrada com a biometria do celular.
• As regras de envio que a plataforma de mensagens exige, explicadas em português.

O aplicativo é para quem já tem conta no Regemcast; quem ainda não tem pode pedir uma vaga na lista de espera pelo próprio app. A conexão do número é feita no painel, em cast.dmsregem.com.

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
Entre com o e-mail e a senha abaixo. O app abre no Painel. Campanhas, Contatos e Modelos ficam na barra de baixo (quando as conversas do número estão ligadas, Conversas toma o lugar de Modelos, que vai para "Mais"); Plano, Conta, Usuários, WhatsApp, Integrações e Regras ficam em "Mais". Campanhas e modelos podem ser criados no app. Conectar o número do WhatsApp é feito no painel web (cast.dmsregem.com), porque o login da Meta roda no navegador.
```

**Anúncios:** não contém anúncios.

**Classificação do conteúdo** (questionário IARC): categoria *Utilitário,
produtividade, comunicação ou outro*. Responder **Não** a violência, sexo,
linguagem, drogas, jogos de azar, compras digitais e localização. Interação
entre usuários: era **Não** até a 0.5.0. A partir da 0.6.0 o app tem as
**conversas** (a empresa lê e responde, por texto, as mensagens que os clientes
mandam no WhatsApp, com fotos, áudios e documentos recebidos): recomendado
responder **Sim** à pergunta sobre usuários trocarem mensagens — é troca de
conteúdo com pessoas de fora do app. A decisão é sua, na hora do questionário.

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
| Informações pessoais → Nome (de quem usa a conta e de quem pede vaga na lista de espera) | Sim | Sim | Funcionalidade do app; Gerenciamento da conta |
| Informações pessoais → Endereço de e-mail (idem) | Sim | Sim | Funcionalidade do app; Gerenciamento da conta |
| Informações pessoais → Número de telefone (dos contatos importados e, opcional, de quem pede vaga na lista de espera) | Sim | Não | Funcionalidade do app; Comunicações do desenvolvedor |
| Informações financeiras → Histórico de compras (pagamentos do plano) | Sim | Não | Gerenciamento da conta |
| Mensagens → Outras mensagens no app (as respostas às conversas do WhatsApp, enviadas pelo app) — **novo na 0.6.0** | Sim | Não | Funcionalidade do app |
| Fotos e vídeos → Fotos e Vídeos (a mídia do cabeçalho dos modelos, escolhida no celular) — **novo na 0.6.0** | Sim | Não | Funcionalidade do app |
| Arquivos e documentos (o arquivo de importação e o PDF do cabeçalho dos modelos) | Sim — o arquivo de importação é processado temporariamente; o PDF do modelo fica guardado | Não | Funcionalidade do app |
| Outro conteúdo gerado pelo usuário (texto dos modelos) | Sim | Não | Funcionalidade do app |
| IDs do dispositivo ou outros IDs (identificador de avisos) | Sim | Não | Funcionalidade do app |

Não coletado: localização, contatos da agenda (o app não pede acesso a ela: a
importação é por arquivo), áudio gravado, atividade de navegação, dados de
saúde, diagnóstico de falhas, dados de cartão (o pagamento é na página do
Mercado Pago). As fotos, áudios e documentos que os clientes mandam nas
conversas chegam pelo servidor — o app só mostra; não é coleta do aparelho.

## Assinatura do app e quem já tem o APK

- Aceite o **Play App Signing** com chave gerada pela Google. A chave de upload
  é `C:\RegemCast-chaves\regemcast-upload.jks` — ela assina o AAB; a Google
  reassina para distribuir.
- O pacote `com.dmsregem.regemcast` já foi instalado fora da Play (APK). Se o
  Console pedir prova de posse da chave, é esta mesma chave de upload.
- Quem tem o APK instalado precisa **desinstalar antes** de instalar pela Play:
  a assinatura da Play é outra e o Android recusa a atualização por cima.

## Notas da versão (0.6.0)

```
O app agora faz o que o painel faz: crie campanhas e modelos (com imagem, vídeo, documento e carrossel), veja as compras e os públicos da sua base, responda as conversas do WhatsApp, acompanhe o número e as integrações, ligue a verificação em duas etapas e recupere a senha sem sair do app.
```

Notas da 0.5.0 (a primeira): "Primeira versão do Regemcast para Android:
campanhas, modelos, contatos, plano e conta na palma da mão, com avisos no
celular."
