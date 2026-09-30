import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../componentes/basicos.dart';
import '../tema/cores.dart';

/// Regras da Meta para o WhatsApp oficial — o mesmo conteúdo da página do
/// site (`frontend/src/app/(app)/regras/page.tsx`). Mudou lá, muda aqui.
///
/// Cada item diz de quem é: **Regra da Meta** (obrigatória, quem decide é ela)
/// ou **Recomendação** (prática nossa para não esbarrar nas regras).

const _conferidoEm = 'setembro de 2026';

class _Regra {
  const _Regra(this.titulo, this.texto);
  final String titulo;
  final String texto;
}

class _Secao {
  const _Secao({
    required this.icone,
    required this.titulo,
    this.descricao,
    this.recomendacao = false,
    required this.regras,
  });

  final IconData icone;
  final String titulo;
  final String? descricao;
  final bool recomendacao;
  final List<_Regra> regras;
}

const _secoes = [
  _Secao(
    icone: Icons.smartphone_rounded,
    titulo: 'Antes de conectar o número',
    descricao:
        'Vale para quem vai manter o WhatsApp Business no celular e usar o mesmo número aqui.',
    regras: [
      _Regra(
        'O número precisa já estar em uso no app WhatsApp Business',
        'A conexão mantendo o app no celular é feita para empresas que já atendem pelo WhatsApp Business. Número recém-criado costuma ser recusado: parceiros oficiais da Meta orientam pelo menos 7 dias de uso ativo, com conversas de verdade, antes de conectar.',
      ),
      _Regra(
        'App atualizado e celular com câmera',
        'O app WhatsApp Business precisa estar na versão 2.24.17 ou mais nova. A conexão é confirmada lendo um QR code, por isso o celular precisa de câmera.',
      ),
      _Regra(
        '24 horas para copiar contatos e conversas',
        'Depois de conectar, a cópia dos contatos e do histórico precisa terminar em 24 horas. Se o prazo passar, a Meta desfaz a conexão e é preciso conectar de novo. Mantenha o app aberto no celular durante a cópia.',
      ),
      _Regra(
        'Abra o app no celular com frequência',
        'Sem abrir o WhatsApp Business no celular por cerca de duas semanas, a Meta encerra a conexão. Abra o app ao menos uma vez a cada 13 dias.',
      ),
      _Regra(
        'Velocidade menor com o app no celular',
        'Número usado no app e aqui ao mesmo tempo envia no máximo 20 mensagens por segundo. Um número dedicado, só para disparos, chega a 80.',
      ),
    ],
  ),
  _Secao(
    icone: Icons.verified_user_outlined,
    titulo: 'Empresa verificada na Meta',
    descricao:
        'A verificação é feita pela sua empresa, na conta dela na Meta — o Regemcast não faz nem acelera.',
    regras: [
      _Regra(
        'Verifique a empresa no Meta Business Suite',
        'A verificação fica na Central de Segurança, dentro das configurações da empresa no Meta Business Suite. Os dados informados precisam ser iguais aos do documento da empresa (razão social, CNPJ, endereço) e do site.',
      ),
      _Regra(
        'Prazo da análise',
        'A resposta pode vir em minutos ou levar até 14 dias úteis. Se for recusada, o motivo aparece na própria Central de Segurança.',
      ),
      _Regra(
        'O que a verificação libera',
        'É um dos caminhos para sair do limite inicial de 250 pessoas por dia — e é o mais rápido para quem está começando.',
      ),
    ],
  ),
  _Secao(
    icone: Icons.trending_up_rounded,
    titulo: 'Limite de envio',
    descricao:
        'É da Meta e é diferente do teto de disparos do seu plano no Regemcast. Os dois valem ao mesmo tempo.',
    regras: [
      _Regra(
        'Começa em 250 pessoas a cada 24 horas',
        'Conta nova só consegue iniciar conversa com 250 pessoas diferentes num período móvel de 24 horas. Responder a quem escreveu para você, dentro da janela de atendimento, não conta.',
      ),
      _Regra(
        'Como chegar a 2 mil',
        'Por um destes caminhos: verificar a empresa na Meta, ou entregar 2 mil mensagens de modelo para pessoas diferentes em 30 dias, com modelos de boa qualidade.',
      ),
      _Regra(
        'Depois disso, sobe sozinho com o tempo',
        'A Meta sobe para 10 mil, 100 mil e ilimitado automaticamente quando a qualidade está boa e você usa ao menos metade do limite atual em 7 dias. A mudança acontece em até 6 horas.',
      ),
      _Regra(
        'O limite é da empresa, não do número',
        'Todos os números do mesmo portfólio empresarial na Meta dividem o mesmo limite. Um número pode consumir o limite inteiro.',
      ),
    ],
  ),
  _Secao(
    icone: Icons.visibility_outlined,
    titulo: 'Qualidade do número',
    descricao: 'A Meta mede como as pessoas reagem às suas mensagens.',
    regras: [
      _Regra(
        'Verde, amarela ou vermelha',
        'A nota vem principalmente de bloqueios e denúncias recentes. Ela aparece na tela do WhatsApp, em cada número.',
      ),
      _Regra(
        'Qualidade baixa trava o crescimento',
        'Com a qualidade baixa, o limite de envio não sobe. Modelos que recebem muitos bloqueios podem ser pausados pela Meta e deixar de enviar.',
      ),
    ],
  ),
  _Secao(
    icone: Icons.check_circle_outline_rounded,
    titulo: 'Consentimento e bom uso',
    descricao: 'Da Política de Mensagens do WhatsApp Business.',
    regras: [
      _Regra(
        'Só para quem autorizou',
        'Envie apenas para quem deu o número e autorizou receber mensagens da sua empresa. Lista comprada, copiada de grupos ou tirada da internet não vale como autorização.',
      ),
      _Regra(
        'Pediu para sair, sai',
        'Todo pedido para parar de receber precisa ser respeitado. No Regemcast, quem se descadastra fica marcado e não recebe as próximas campanhas.',
      ),
      _Regra(
        'Mensagem esperada, sem enganar',
        'A mensagem precisa ser o que a pessoa espera receber de você. Nada de conteúdo enganoso, surpresa ou spam.',
      ),
      _Regra(
        'Produtos e assuntos proibidos',
        'A Meta proíbe, entre outros: armas, drogas e medicamentos controlados, álcool, jogos de azar, serviços de encontros e marketing multinível. A lista completa está na política.',
      ),
      _Regra(
        'O que acontece se descumprir',
        'A Meta pode restringir ou remover o acesso ao WhatsApp Business e, em casos graves, proibir a empresa de usar os produtos do WhatsApp.',
      ),
    ],
  ),
  _Secao(
    icone: Icons.description_outlined,
    titulo: 'Modelos, janela de atendimento e cobrança',
    regras: [
      _Regra(
        'Quem começa a conversa usa modelo aprovado',
        'Toda conversa iniciada pela empresa precisa de um modelo aprovado pela Meta. As categorias são Marketing, Utilidade e Autenticação — e a Meta pode mudar a categoria que você escolheu.',
      ),
      _Regra(
        'Janela de atendimento de 24 horas',
        'Quando a pessoa escreve para você, abre uma janela de 24 horas a partir da última mensagem dela. Dentro dela, dá para responder livremente, sem modelo.',
      ),
      _Regra(
        'A Meta cobra por mensagem de modelo entregue',
        'Desde julho de 2025, a cobrança é por mensagem entregue e depende da categoria e do país do número. Marketing é sempre cobrado; utilidade enviada dentro da janela de atendimento não é. Essa cobrança é da Meta, na conta da sua empresa, e é separada do plano do Regemcast.',
      ),
      _Regra(
        'Limite de marketing por pessoa',
        'A Meta limita quantas mensagens de marketing cada pessoa recebe de todas as empresas juntas. Quando o limite é atingido, a mensagem não é entregue e aparece como falha (código 131049). Espere pelo menos 24 horas antes de tentar de novo para essa pessoa.',
      ),
    ],
  ),
  _Secao(
    icone: Icons.lightbulb_outline_rounded,
    titulo: 'Boas práticas',
    descricao: 'Não são regras da Meta: são o jeito de não esbarrar nelas.',
    recomendacao: true,
    regras: [
      _Regra(
        'Comece pequeno e cresça aos poucos',
        'Nas primeiras semanas, envie para quem mais conhece a sua empresa. Boa resposta no começo ajuda a qualidade e a subir de limite.',
      ),
      _Regra(
        'Use a janela de envio',
        'Configure dias e horários comerciais na campanha. Mensagem fora de hora gera mais bloqueio.',
      ),
      _Regra(
        'Personalize e dê motivo para ler',
        'Use o nome da pessoa e diga logo por que ela está recebendo. Mensagem genérica é a que mais é denunciada.',
      ),
      _Regra(
        'Todo modelo de marketing sai com o botão "Parar promoções"',
        'Nós acrescentamos esse botão como último de todo modelo de marketing, e ele não ocupa um dos seus: você monta até 9, o décimo é o nosso. Quem toca entra na sua lista de bloqueio na hora e não recebe mais disparos, inclusive os que já estavam na fila. É o que evita o caminho caro: sem saída fácil, a pessoa bloqueia o número da empresa, e bloqueio derruba a qualidade, que leva semanas para voltar. Quem responder "sair", "parar" ou "stop" por escrito também entra na lista.',
      ),
      _Regra(
        'Mantenha a lista limpa',
        'Remova números que falham sempre e respeite o descadastro na hora. Enviar para quem não responde há meses derruba a qualidade.',
      ),
    ],
  ),
];

const _fontes = [
  (
    'Limites de mensagens',
    'https://developers.facebook.com/docs/whatsapp/messaging-limits',
  ),
  (
    'Conectar número do app WhatsApp Business (coexistência)',
    'https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users',
  ),
  (
    'Qualidade do número de telefone',
    'https://www.facebook.com/business/help/896873687365001',
  ),
  (
    'Política de Mensagens do WhatsApp Business',
    'https://whatsappbusiness.com/pt-br/policy/',
  ),
  (
    'Preços da plataforma',
    'https://developers.facebook.com/docs/whatsapp/pricing',
  ),
  (
    'Limite de marketing por pessoa',
    'https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/marketing-templates/per-user-limits',
  ),
];

class TelaRegras extends StatelessWidget {
  const TelaRegras({super.key});

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Regras da Meta')),
      body: ListView(
        padding: respiroDaTela(context),
        children: [
          const Aviso(
            tom: TomPilula.acento,
            icone: Icons.warning_amber_rounded,
            texto:
                'Estas regras são da Meta, não do Regemcast. Ela decide quem conecta, quanto cada número pode enviar e quando um número é limitado ou suspenso. Descumprir pode limitar ou bloquear o seu número.',
          ),
          const SizedBox(height: 6),
          Text(
            'Conferido na documentação oficial em $_conferidoEm.',
            style: TextStyle(color: c.tintaSuave, fontSize: 12),
          ),
          const SizedBox(height: 14),
          for (final s in _secoes)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: _CartaoSecao(secao: s),
            ),
          const SizedBox(height: 10),
          Text(
            'Fontes oficiais',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 4),
          Text(
            'Em caso de dúvida, vale o que está na documentação da Meta.',
            style: TextStyle(color: c.tintaSuave, fontSize: 13),
          ),
          const SizedBox(height: 8),
          Cartao(
            padding: EdgeInsets.zero,
            child: Column(
              children: [
                for (var i = 0; i < _fontes.length; i++) ...[
                  if (i > 0) Divider(height: 1, color: c.borda),
                  ListTile(
                    title: Text(
                      _fontes[i].$1,
                      style: const TextStyle(fontSize: 14),
                    ),
                    trailing: const Icon(Icons.open_in_new_rounded, size: 18),
                    onTap: () => launchUrl(
                      Uri.parse(_fontes[i].$2),
                      mode: LaunchMode.externalApplication,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _CartaoSecao extends StatelessWidget {
  const _CartaoSecao({required this.secao});

  final _Secao secao;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final s = secao;
    return Cartao(
      padding: EdgeInsets.zero,
      child: Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          tilePadding: const EdgeInsets.fromLTRB(14, 6, 14, 6),
          childrenPadding: const EdgeInsets.fromLTRB(14, 0, 14, 14),
          shape: const Border(),
          leading: Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: s.recomendacao ? c.superficie2 : c.acento,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(
              s.icone,
              size: 20,
              color: s.recomendacao ? c.tintaSuave : c.acentoContraste,
            ),
          ),
          title: Text(
            s.titulo,
            style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15),
          ),
          subtitle: s.descricao == null
              ? null
              : Text(
                  s.descricao!,
                  style: TextStyle(color: c.tintaSuave, fontSize: 12.5),
                ),
          children: [
            for (final r in s.regras)
              Container(
                width: double.infinity,
                margin: const EdgeInsets.only(top: 10),
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  border: Border.all(color: c.borda),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Pilula(
                      s.recomendacao ? 'Recomendação' : 'Regra da Meta',
                      tom: s.recomendacao ? TomPilula.neutro : TomPilula.acento,
                      ponto: false,
                    ),
                    const SizedBox(height: 8),
                    Text(
                      r.titulo,
                      style: const TextStyle(
                        fontWeight: FontWeight.w600,
                        fontSize: 14,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      r.texto,
                      style: TextStyle(
                        color: c.tintaSuave,
                        fontSize: 13.5,
                        height: 1.45,
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}
