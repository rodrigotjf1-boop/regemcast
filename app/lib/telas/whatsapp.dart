import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/dados.dart';
import '../api/erro_api.dart';
import '../api/leituras.dart';
import '../api/whatsapp.dart';
import '../componentes/basicos.dart';
import '../componentes/dialogos.dart';
import '../config.dart';
import '../sessao/sessao.dart';
import '../tema/cores.dart';
import '../util/formato.dart' as f;
import 'campanha_detalhe.dart' show BlocoDoErro;

/// O WhatsApp da conta, como a tela do site (`(app)/whatsapp/page.tsx`): a
/// conta na Meta, cada número com a qualidade, o limite da Meta, a velocidade,
/// a cópia dos dados do celular e — no número em coexistência — a pergunta
/// sobre os contatos e as conversas.
///
/// Conectar é pelo site: o cadastro incorporado da Meta roda no navegador,
/// com o login do Facebook, e a Meta não deixa esse login dentro de outro app.
class TelaWhatsapp extends ConsumerWidget {
  const TelaWhatsapp({super.key});

  /// A qualidade como o site fala dela.
  static (String, TomPilula) qualidade(String q) => switch (q) {
    'verde' => ('Qualidade: Boa', TomPilula.sucesso),
    'amarela' => ('Qualidade: Em atenção', TomPilula.atencao),
    'vermelha' => ('Qualidade: Ruim', TomPilula.erro),
    _ => ('Qualidade: Sem informação', TomPilula.neutro),
  };

  void _abrirSite() => launchUrl(
    Uri.parse('$urlWeb/whatsapp'),
    mode: LaunchMode.externalApplication,
  );

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = Cores.de(context);
    final carga = ref.watch(situacaoWhatsappProvider);
    final sessao = ref.watch(sessaoProvider);
    final ehDono = sessao is SessaoAtiva && sessao.sessao.usuario.ehDono;

    return Scaffold(
      appBar: AppBar(title: const Text('WhatsApp')),
      body: carga.when(
        loading: () => const Padding(
          padding: EdgeInsets.all(20),
          child: Cartao(child: Esqueleto(altura: 160)),
        ),
        // Nunca "não conectado" no lugar do erro: se a leitura falhou, o
        // estado da conexão é desconhecido.
        error: (e, _) => Padding(
          padding: const EdgeInsets.all(20),
          child: EstadoErro(
            titulo: 'Não consegui carregar a conexão',
            mensagem: mensagemDoErro(e),
            aoTentar: () => ref.invalidate(situacaoWhatsappProvider),
          ),
        ),
        data: (s) => RefreshIndicator(
          color: c.acentoContraste,
          backgroundColor: c.acento,
          onRefresh: () async {
            ref
              ..invalidate(situacaoWhatsappProvider)
              ..invalidate(saudeDaContaProvider);
            await ref
                .read(situacaoWhatsappProvider.future)
                .catchError((_) => s);
          },
          child: ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: respiroDaTela(context),
            children: [
              if (!s.conectado || s.numeros.isEmpty)
                Aviso(
                  key: const ValueKey('sem-conexao'),
                  tom: TomPilula.acento,
                  icone: Icons.link_rounded,
                  texto:
                      'Conecte a conta de WhatsApp Business da sua empresa para poder enviar campanhas. A conexão é feita pelo site, com o login da sua empresa na Meta — leva poucos minutos.',
                  acao: TextButton(
                    onPressed: _abrirSite,
                    child: const Text('Conectar no site'),
                  ),
                )
              else ...[
                _Conta(situacao: s),
                const SizedBox(height: 14),
                const CartaoDaSaude(),
                _AvisoDeVencimento(expiraEm: s.tokenExpiraEm),
                const SizedBox(height: 14),
                for (final n in s.numeros) ...[
                  CartaoDoNumero(numero: n, ehDono: ehDono),
                  const SizedBox(height: 14),
                ],
              ],
              Text(
                'Trocar ou acrescentar número, e refazer a conexão, é pelo site.',
                style: TextStyle(color: c.tintaSuave, fontSize: 12.5),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// O sinal da saúde como a tela fala dele.
(String, TomPilula) sinalDaSaude(String sinal) => switch (sinal) {
  'pode_enviar' => ('Tudo certo', TomPilula.sucesso),
  'com_restricao' => ('Atenção', TomPilula.atencao),
  'bloqueado' => ('Bloqueado', TomPilula.erro),
  _ => ('Sem resposta', TomPilula.neutro),
};

/// A saúde da conta na Meta: "posso enviar agora e, se não, o que eu resolvo?".
///
/// O servidor pergunta à Meta e devolve pronto: um sinal geral e um item por
/// coisa conferida (a conta, a empresa, o número, o pagamento, a conexão), cada
/// problema com o que fazer. O app não traduz nem decide nada.
class CartaoDaSaude extends ConsumerStatefulWidget {
  const CartaoDaSaude({super.key});

  @override
  ConsumerState<CartaoDaSaude> createState() => _CartaoDaSaudeState();
}

class _CartaoDaSaudeState extends ConsumerState<CartaoDaSaude> {
  bool _conferindo = false;
  String? _erro;

  Future<void> _conferir() async {
    setState(() {
      _conferindo = true;
      _erro = null;
    });
    try {
      await ref.read(servicoWhatsappProvider).conferirSaude();
      ref.invalidate(saudeDaContaProvider);
      await ref.read(saudeDaContaProvider.future);
    } catch (e) {
      _erro = mensagemDoErro(e);
    }
    if (mounted) setState(() => _conferindo = false);
  }

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final carga = ref.watch(saudeDaContaProvider);
    final suave = TextStyle(color: c.tintaSuave, fontSize: 12.5, height: 1.45);
    final saude = carga.value;

    if (saude == null) {
      // Lendo pela primeira vez: o lugar do cartão. Sem resposta do servidor
      // não se afirma nada — nem "pode", nem "não pode".
      if (carga.isLoading) {
        return const Cartao(child: Esqueleto(altura: 96));
      }
      if (!carga.hasError) return const SizedBox.shrink();
      return Cartao(
        key: const ValueKey('saude-erro'),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Saúde da conta na Meta',
              style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 6),
            Text(
              'Não consegui conferir a saúde da conta agora. ${mensagemDoErro(carga.error!)}',
              style: suave,
            ),
            const SizedBox(height: 6),
            TextButton(
              onPressed: () => ref.invalidate(saudeDaContaProvider),
              child: const Text('Tentar de novo'),
            ),
          ],
        ),
      );
    }

    final (rotulo, tom) = sinalDaSaude(saude.sinal);
    return Cartao(
      key: const ValueKey('saude'),
      destaque: saude.sinal == 'bloqueado',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'SAÚDE DA CONTA NA META',
            style: TextStyle(
              color: c.tintaSuave,
              fontSize: 11.5,
              fontWeight: FontWeight.w600,
              letterSpacing: .6,
            ),
          ),
          const SizedBox(height: 6),
          Wrap(
            spacing: 8,
            runSpacing: 6,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Text(
                saude.titulo,
                key: const ValueKey('saude-titulo'),
                style: const TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.w600,
                ),
              ),
              Pilula(rotulo, tom: tom),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            saude.resumo,
            style: TextStyle(color: c.tintaSuave, height: 1.45),
          ),
          const SizedBox(height: 4),
          Row(
            children: [
              Expanded(
                child: Text(
                  saude.lidaEm != null
                      ? 'Conferida em ${f.dataHora(saude.lidaEm)}'
                      : 'Ainda não conferida',
                  style: suave,
                ),
              ),
              TextButton(
                key: const ValueKey('saude-conferir'),
                onPressed: _conferindo ? null : _conferir,
                child: Text(_conferindo ? 'Conferindo…' : 'Conferir agora'),
              ),
            ],
          ),
          if (_erro != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(
                'Não consegui conferir de novo agora. $_erro',
                key: const ValueKey('saude-erro-conferir'),
                style: TextStyle(color: c.erro, fontSize: 12.5, height: 1.4),
              ),
            ),
          for (final item in saude.itens) ...[
            Divider(height: 20, color: c.borda),
            _ItemDaSaude(item: item),
          ],
        ],
      ),
    );
  }
}

class _ItemDaSaude extends StatelessWidget {
  const _ItemDaSaude({required this.item});

  final ItemDaSaude item;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final cor = switch (item.sinal) {
      'pode_enviar' => c.sucesso,
      'com_restricao' => c.atencao,
      'bloqueado' => c.erro,
      _ => c.tintaSuave,
    };
    // A autorização que vence (sem código) já tem o aviso com o botão de
    // reconectar logo abaixo do cartão: aqui fica só a linha. A que a Meta
    // recusou (190) não tem outro lugar, e aparece.
    final problemas = item.chave == 'conexao'
        ? item.problemas.where((p) => p.codigo != null).toList()
        : item.problemas;
    return Column(
      key: ValueKey('saude-${item.chave}'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.only(top: 6, right: 10),
              child: Container(
                width: 8,
                height: 8,
                decoration: BoxDecoration(color: cor, shape: BoxShape.circle),
              ),
            ),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    item.rotulo,
                    style: const TextStyle(
                      fontWeight: FontWeight.w600,
                      fontFeatures: [FontFeature.tabularFigures()],
                    ),
                  ),
                  Text(
                    item.resumo,
                    style: TextStyle(
                      color: c.tintaSuave,
                      fontSize: 13,
                      height: 1.4,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        for (final problema in problemas)
          Container(
            margin: const EdgeInsets.only(top: 10),
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: c.superficie2,
              borderRadius: BorderRadius.circular(14),
            ),
            // Sem o atalho "Abrir WhatsApp": a tela já é esta.
            child: BlocoDoErro(erro: problema.semTela()),
          ),
      ],
    );
  }
}

/// A conta conectada: nome, "Conectada", a WABA, a moeda e os números.
class _Conta extends StatelessWidget {
  const _Conta({required this.situacao});

  final SituacaoWhatsapp situacao;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final s = situacao;
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: c.tinta,
        borderRadius: BorderRadius.circular(22),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 52,
            height: 52,
            decoration: BoxDecoration(
              color: c.acento,
              borderRadius: BorderRadius.circular(16),
            ),
            child: Icon(
              Icons.verified_user_rounded,
              color: c.acentoContraste,
              size: 28,
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  s.contaNome ?? 'Conta conectada',
                  style: TextStyle(
                    color: c.superficie,
                    fontSize: 18,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 6),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    const Pilula('Conectada', tom: TomPilula.acento),
                    if (s.webhookAssinadoEm == null)
                      const Pilula(
                        'Status de entrega pendente',
                        tom: TomPilula.atencao,
                      ),
                  ],
                ),
                const SizedBox(height: 8),
                Text(
                  [
                    if (s.wabaId != null) 'WABA ${s.wabaId}',
                    if (s.moeda != null) 'Cobrança da Meta em ${s.moeda}',
                    f.plural(s.numeros.length, 'número', 'números'),
                  ].join(' · '),
                  style: TextStyle(
                    color: c.superficie.withValues(alpha: .72),
                    fontSize: 12.5,
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
                ),
                // A Meta cobra as mensagens direto desta conta: o atalho para
                // o cartão, a moeda e o fuso. No app da Play nada leva a uma
                // página de pagamento fora dele.
                if (s.pagamentoUrl != null && compraNoApp) ...[
                  const SizedBox(height: 12),
                  OutlinedButton.icon(
                    key: const ValueKey('w-pagamento-meta'),
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size(0, 40),
                      foregroundColor: c.acento,
                      side: BorderSide(color: c.acento.withValues(alpha: .5)),
                    ),
                    onPressed: () => launchUrl(
                      Uri.parse(s.pagamentoUrl!),
                      mode: LaunchMode.externalApplication,
                    ),
                    icon: const Icon(Icons.open_in_new_rounded, size: 18),
                    label: const Text('Pagamento na Meta'),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    'A Meta cobra as mensagens direto desta conta do WhatsApp. O cartão, a moeda e o fuso horário ficam lá.',
                    style: TextStyle(
                      color: c.superficie.withValues(alpha: .72),
                      fontSize: 12.5,
                      height: 1.4,
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

/// A autorização do Embedded Signup vence em 60 dias: o aviso aparece só na
/// última semana (antes disso seria ruído que ensina a ignorar o aviso).
class _AvisoDeVencimento extends StatelessWidget {
  const _AvisoDeVencimento({required this.expiraEm});

  final DateTime? expiraEm;

  @override
  Widget build(BuildContext context) {
    final fim = expiraEm;
    if (fim == null) return const SizedBox.shrink();
    final dias = (fim.difference(DateTime.now()).inHours / 24).ceil();
    if (dias > 7) return const SizedBox.shrink();
    final venceu = dias <= 0;
    return Padding(
      padding: const EdgeInsets.only(top: 14),
      child: Aviso(
        key: const ValueKey('vencimento'),
        tom: venceu ? TomPilula.erro : TomPilula.atencao,
        icone: Icons.schedule_rounded,
        texto: venceu
            ? 'A autorização do WhatsApp venceu e nenhuma campanha sai até você reconectar.'
            : 'A autorização do WhatsApp vence em ${f.plural(dias, 'dia', 'dias')}. Reconecte antes disso para as campanhas não pararem.',
        acao: TextButton(
          onPressed: () => launchUrl(
            Uri.parse('$urlWeb/whatsapp'),
            mode: LaunchMode.externalApplication,
          ),
          child: const Text('Reconectar no site'),
        ),
      ),
    );
  }
}

/// Um número: pronto ou não, qualidade, limite da Meta, velocidade, a cópia
/// dos dados do celular e os contatos e conversas.
class CartaoDoNumero extends StatelessWidget {
  const CartaoDoNumero({super.key, required this.numero, required this.ehDono});

  final NumeroWhatsapp numero;
  final bool ehDono;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final n = numero;
    final (rotuloQ, tomQ) = TelaWhatsapp.qualidade(n.qualidade);
    final suave = TextStyle(color: c.tintaSuave, fontSize: 12.5, height: 1.45);
    final limite = n.semTeto
        ? 'Sem teto'
        : n.tierLimite != null
        ? '${f.numero(n.tierLimite!)} pessoas / 24h'
        : 'Ainda não informado';

    return Cartao(
      key: ValueKey('numero-${n.phoneNumberId}'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      n.telefone ?? 'Número sem identificação',
                      style: const TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.w600,
                        fontFeatures: [FontFeature.tabularFigures()],
                      ),
                    ),
                    if (n.nome != null)
                      Text(
                        n.nome!,
                        style: TextStyle(color: c.tintaSuave, fontSize: 13),
                      ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              n.status == 'registrado'
                  ? const Pilula('Pronto para enviar', tom: TomPilula.sucesso)
                  : n.status == 'suspenso'
                  ? const Pilula('Suspenso pela Meta', tom: TomPilula.erro)
                  : const Pilula(
                      'Registro pendente',
                      tom: TomPilula.atencao,
                      vivo: true,
                    ),
            ],
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              Pilula(rotuloQ, tom: tomQ),
              if (n.coexistencia)
                const Pilula(
                  'Também no seu celular',
                  tom: TomPilula.acento,
                  ponto: false,
                ),
              if (n.vazaoMaxima != null)
                Pilula('até ${n.vazaoMaxima} msg/s', ponto: false),
            ],
          ),
          const SizedBox(height: 14),
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: c.superficie2,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: c.borda),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'LIMITE DA META',
                  style: TextStyle(
                    color: c.tintaSuave,
                    fontSize: 11.5,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 1.2,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  limite,
                  key: const ValueKey('limite'),
                  style: const TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w700,
                    fontFeatures: [FontFeature.tabularFigures()],
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  'Este limite é da Meta e conta pessoas diferentes em 24 horas — é separado do teto do seu plano, e vale para todos os números do seu portfólio na Meta. Começa em 250 e sobe para 2.000 (empresa verificada, ou 2.000 entregas de boa qualidade em 30 dias); depois 10.000, 100.000 e sem teto, sozinho.',
                  style: suave,
                ),
                const SizedBox(height: 6),
                Text(
                  'As campanhas obedecem a esse limite: quando ele enche, a campanha espera e continua sozinha quando a janela de 24 horas abrir vaga.',
                  style: suave,
                ),
                if (n.vazaoMaxima != null) ...[
                  const SizedBox(height: 6),
                  Text(
                    'Velocidade de envio: até ${n.vazaoMaxima} mensagens por segundo.${n.coexistencia ? ' É o teto de quem mantém o aplicativo no celular — um número dedicado chega a 80.' : ''}',
                    style: suave,
                  ),
                ],
              ],
            ),
          ),
          _Sincronizacao(numero: n),
          if (n.coexistencia) ...[
            const SizedBox(height: 14),
            ContatosEConversas(numero: n, ehDono: ehDono),
            const SizedBox(height: 10),
            // Lembrete permanente: a Meta derruba a conexão de quem passa 14
            // dias sem abrir o aplicativo.
            Text(
              'Abra o WhatsApp Business no celular ao menos uma vez a cada 13 dias. Sem isso a Meta encerra a conexão e você precisa conectar o número de novo.',
              style: suave,
            ),
          ],
          if (n.qualidade == 'amarela' || n.qualidade == 'vermelha') ...[
            const SizedBox(height: 12),
            const Aviso(
              tom: TomPilula.atencao,
              icone: Icons.report_outlined,
              texto:
                  'Muita gente marcou suas mensagens como indesejadas. Sete dias assim e a Meta reduz seu limite de envio. Vale reduzir o volume e revisar para quem está mandando.',
            ),
          ],
          if (n.status == 'suspenso') ...[
            const SizedBox(height: 12),
            const Aviso(
              tom: TomPilula.erro,
              icone: Icons.block_rounded,
              texto:
                  'A Meta suspendeu este número: nada sai por ele. O motivo aparece no Meta Business Suite.',
            ),
          ],
        ],
      ),
    );
  }
}

/// A cópia dos dados do celular (coexistência): o único passo do onboarding
/// com prazo — 24 horas, contadas pela Meta. Estourado, ela desfaz a conexão.
/// Os estados são os do servidor (ERR-028: o app esperava `erro`, que o
/// servidor nunca manda, e a falha da cópia nunca aparecia).
class _Sincronizacao extends StatelessWidget {
  const _Sincronizacao({required this.numero});

  final NumeroWhatsapp numero;

  @override
  Widget build(BuildContext context) {
    final n = numero;
    if (!n.coexistencia) return const SizedBox.shrink();
    final texto = switch (n.sincronizacao) {
      'pendente' => (
        TomPilula.atencao,
        'Preparando a cópia dos seus dados',
        'Mantenha o WhatsApp Business aberto no celular. A cópia dos contatos e das conversas começa em instantes.',
      ),
      'sincronizando' => (
        TomPilula.atencao,
        'Copiando seus contatos e conversas',
        'Mantenha o WhatsApp Business aberto no celular até terminar. Se fechar antes, a cópia para onde estiver.',
      ),
      'concluida' => (
        TomPilula.sucesso,
        'Contatos e conversas copiados',
        'Você continua atendendo pelo celular normalmente — o que chegar por lá também aparece aqui.',
      ),
      'expirada' => (
        TomPilula.erro,
        'O prazo para copiar os dados terminou',
        'A Meta desfez a conexão. Conecte o número de novo e mantenha o WhatsApp Business aberto no celular durante a cópia.',
      ),
      'falhou' => (
        TomPilula.erro,
        'Não conseguimos copiar os dados do seu celular',
        'Conecte o número de novo. Na janela da Meta, autorize o compartilhamento dos dados do aplicativo quando ela pedir.',
      ),
      _ => null,
    };
    if (texto == null) return const SizedBox.shrink();
    final (tom, titulo, explicacao) = texto;
    final horas = n.horasParaSincronizar;
    final prazo = horas == null
        ? null
        : horas <= 0
        ? 'O prazo terminou.'
        : horas < 1
        ? 'Falta menos de 1 hora para o prazo acabar.'
        : 'Faltam ${f.plural(horas.floor(), 'hora', 'horas')} para o prazo acabar.';
    final refazer =
        n.sincronizacao == 'expirada' || n.sincronizacao == 'falhou';
    return Padding(
      padding: const EdgeInsets.only(top: 14),
      child: Aviso(
        key: ValueKey('sincronizacao-${n.sincronizacao}'),
        tom: tom,
        icone: switch (tom) {
          TomPilula.sucesso => Icons.check_circle_outline_rounded,
          TomPilula.erro => Icons.sync_problem_rounded,
          _ => Icons.sync_rounded,
        },
        texto: '$titulo. $explicacao${prazo != null ? ' $prazo' : ''}',
        acao: refazer
            ? TextButton(
                onPressed: () => launchUrl(
                  Uri.parse('$urlWeb/whatsapp'),
                  mode: LaunchMode.externalApplication,
                ),
                child: const Text('Conectar de novo no site'),
              )
            : null,
      ),
    );
  }
}

/// "Contatos e conversas do celular", no número em coexistência — o
/// `IntegracaoDoNumero` do site. Três estados: sem resposta (o dono responde
/// aqui; o que a Meta já mandou espera), "sim" (entrando; o dono pode parar)
/// e "não" (nada fica guardado; o dono pode passar a trazer).
///
/// Quem não é dono vê o estado, mas não responde: a resposta carrega a
/// declaração sobre a agenda da empresa. O servidor recusa do mesmo jeito.
class ContatosEConversas extends ConsumerStatefulWidget {
  const ContatosEConversas({
    super.key,
    required this.numero,
    required this.ehDono,
  });

  final NumeroWhatsapp numero;
  final bool ehDono;

  @override
  ConsumerState<ContatosEConversas> createState() => _ContatosEConversasState();
}

class _ContatosEConversasState extends ConsumerState<ContatosEConversas> {
  bool _editando = false;
  bool? _escolha;
  bool _salvando = false;

  bool get _perguntando =>
      widget.ehDono && (widget.numero.integrarConversas == null || _editando);

  Future<void> _salvar(bool integrar) async {
    setState(() => _salvando = true);
    try {
      await ref
          .read(servicoWhatsappProvider)
          .integrar(widget.numero.phoneNumberId, integrar);
      if (!mounted) return;
      avisar(
        context,
        integrar
            ? 'Resposta salva. Os contatos que já chegaram entram na sua base em até um minuto.'
            : 'Resposta salva. Nada da agenda nem das conversas deste número fica guardado.',
      );
      setState(() {
        _editando = false;
        _escolha = null;
      });
      // A aba Conversas aparece (ou some) na hora.
      ref
        ..invalidate(situacaoWhatsappProvider)
        ..invalidate(resumoContaProvider);
    } catch (e) {
      if (mounted) avisar(context, mensagemDoErro(e));
    } finally {
      if (mounted) setState(() => _salvando = false);
    }
  }

  Future<void> _parar() async {
    final ok = await confirmar(
      context,
      titulo: 'Parar de trazer?',
      texto:
          'Parar de trazer os contatos e as conversas deste número? O que já entrou continua na sua base. O que chegar daqui para frente não fica guardado.',
      botao: 'Parar de trazer',
      perigo: true,
    );
    if (ok) await _salvar(false);
  }

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final n = widget.numero;
    final suave = TextStyle(color: c.tintaSuave, fontSize: 13, height: 1.45);

    Widget conteudo;
    if (_perguntando) {
      final declaracao = ref.watch(declaracaoIntegracaoProvider);
      conteudo = declaracao.when(
        loading: () => Text('Carregando a pergunta…', style: suave),
        error: (e, _) => Text(
          mensagemDoErro(e),
          style: TextStyle(color: c.erro, fontSize: 13),
        ),
        data: (texto) => _Pergunta(
          declaracao: texto,
          escolha: _escolha,
          salvando: _salvando,
          editando: _editando,
          aoEscolher: (v) => setState(() => _escolha = v),
          aoSalvar: () => _salvar(_escolha!),
          aoCancelar: () => setState(() {
            _editando = false;
            _escolha = null;
          }),
        ),
      );
    } else if (n.integrarConversas == null) {
      conteudo = Text(
        'O dono da conta ainda não respondeu se quer trazer os contatos e as conversas deste número. Até lá, o que chegar do celular fica guardado esperando a resposta.',
        style: suave,
      );
    } else if (n.integrarConversas!) {
      conteudo = Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Pilula('Trazendo para o Regemcast', tom: TomPilula.sucesso),
          const SizedBox(height: 8),
          Text(
            'Os contatos da agenda entram na lista WhatsApp Business deste número. Contato novo salvo no celular entra sozinho; contato apagado lá sai da lista, mas não da sua base.',
            style: suave,
          ),
          if (widget.ehDono) ...[
            const SizedBox(height: 6),
            TextButton(
              key: const ValueKey('parar-de-trazer'),
              style: TextButton.styleFrom(
                foregroundColor: c.erro,
                padding: EdgeInsets.zero,
              ),
              onPressed: _salvando ? null : _parar,
              child: const Text('Parar de trazer'),
            ),
          ],
        ],
      );
    } else {
      conteudo = Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Pilula('Não trazemos', ponto: false),
          const SizedBox(height: 8),
          Text(
            'Nada da agenda nem das conversas deste número fica guardado aqui. O número serve só para as campanhas.',
            style: suave,
          ),
          if (widget.ehDono) ...[
            const SizedBox(height: 6),
            TextButton(
              key: const ValueKey('passar-a-trazer'),
              style: TextButton.styleFrom(padding: EdgeInsets.zero),
              onPressed: () => setState(() => _editando = true),
              child: const Text('Passar a trazer'),
            ),
          ],
        ],
      );
    }

    return Container(
      key: ValueKey('conversas-${n.phoneNumberId}'),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: c.superficie2,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: c.borda),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'CONTATOS E CONVERSAS DO CELULAR',
            style: TextStyle(
              color: c.tintaSuave,
              fontSize: 11.5,
              fontWeight: FontWeight.w700,
              letterSpacing: 1.2,
            ),
          ),
          const SizedBox(height: 10),
          conteudo,
        ],
      ),
    );
  }
}

/// A pergunta: nenhuma opção vem marcada — guardar a agenda de alguém exige
/// uma resposta explícita. A declaração aparece junto do "sim", porque é ela
/// que o dono aceita ao escolher.
class _Pergunta extends StatelessWidget {
  const _Pergunta({
    required this.declaracao,
    required this.escolha,
    required this.salvando,
    required this.editando,
    required this.aoEscolher,
    required this.aoSalvar,
    required this.aoCancelar,
  });

  final String declaracao;
  final bool? escolha;
  final bool salvando;
  final bool editando;
  final ValueChanged<bool> aoEscolher;
  final VoidCallback aoSalvar;
  final VoidCallback aoCancelar;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final suave = TextStyle(color: c.tintaSuave, fontSize: 12.5, height: 1.45);
    Widget opcao({
      required bool valor,
      required String titulo,
      required List<String> textos,
    }) {
      final marcada = escolha == valor;
      return Semantics(
        inMutuallyExclusiveGroup: true,
        checked: marcada,
        child: Material(
          color: marcada ? c.acentoSuave : c.superficie,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
            side: BorderSide(
              color: marcada ? c.acento : c.borda,
              width: marcada ? 2 : 1,
            ),
          ),
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            key: ValueKey('integrar-$valor'),
            onTap: salvando ? null : () => aoEscolher(valor),
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    marcada
                        ? Icons.radio_button_checked_rounded
                        : Icons.radio_button_unchecked_rounded,
                    size: 20,
                    color: marcada ? c.acentoForte : c.tintaSuave,
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          titulo,
                          style: const TextStyle(fontWeight: FontWeight.w600),
                        ),
                        for (final t in textos) ...[
                          const SizedBox(height: 4),
                          Text(t, style: suave),
                        ],
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Text(
          'Trazer os contatos e as conversas deste número para o Regemcast?',
          style: TextStyle(fontWeight: FontWeight.w600, height: 1.35),
        ),
        const SizedBox(height: 10),
        opcao(
          valor: true,
          titulo: 'Sim, trazer',
          textos: [
            'Os contatos da agenda entram na sua base, numa lista própria, e as conversas dos últimos 6 meses ficam guardadas.',
            'Ao escolher sim, você declara: “$declaracao”',
          ],
        ),
        const SizedBox(height: 8),
        opcao(
          valor: false,
          titulo: 'Não trazer',
          textos: [
            'O número serve só para as campanhas. Nada da agenda nem das conversas fica guardado aqui.',
          ],
        ),
        const SizedBox(height: 8),
        Text(
          'A Meta manda o histórico de conversas uma vez só, logo depois da conexão. Se responder não, as conversas antigas não poderão ser trazidas depois — só o que chegar dali para frente.',
          style: suave,
        ),
        const SizedBox(height: 10),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            FilledButton(
              key: const ValueKey('salvar-resposta'),
              style: FilledButton.styleFrom(minimumSize: const Size(0, 42)),
              onPressed: escolha == null || salvando ? null : aoSalvar,
              child: salvando
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Salvar resposta'),
            ),
            if (editando)
              TextButton(
                onPressed: salvando ? null : aoCancelar,
                child: const Text('Cancelar'),
              ),
          ],
        ),
      ],
    );
  }
}
