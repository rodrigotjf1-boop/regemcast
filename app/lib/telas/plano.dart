import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/conta.dart';
import '../api/erro_api.dart';
import '../componentes/basicos.dart';
import '../componentes/dialogos.dart';
import '../config.dart';
import '../sessao/sessao.dart';
import '../tema/cores.dart';
import '../util/formato.dart' as f;

/// Plano e pagamento: em que pé está a assinatura, quanto do ciclo foi usado,
/// os planos e o histórico de pagamentos.
///
/// O pagamento é no Mercado Pago, no navegador — o app nunca vê cartão. Ao
/// voltar para o app, a tela relê a situação: a confirmação do pagamento chega
/// ao servidor por aviso do Mercado Pago, segundos depois.
class TelaPlano extends ConsumerStatefulWidget {
  const TelaPlano({super.key});

  @override
  ConsumerState<TelaPlano> createState() => _TelaPlanoState();
}

class _TelaPlanoState extends ConsumerState<TelaPlano> {
  late final AppLifecycleListener _ciclo;
  final _emailPagador = TextEditingController();
  bool _outroEmail = false;
  String? _ocupado;

  @override
  void initState() {
    super.initState();
    _ciclo = AppLifecycleListener(
      onResume: () => ref.invalidate(situacaoPlanoProvider),
    );
  }

  @override
  void dispose() {
    _ciclo.dispose();
    _emailPagador.dispose();
    super.dispose();
  }

  Future<void> _abrirPagamento(String url) =>
      launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);

  Future<void> _escolher(SituacaoPlano s, PlanoOferta p) async {
    if (s.pago) {
      final reduz =
          s.planoAtual != null && p.precoCentavos < s.planoAtual!.precoCentavos;
      final ok = await confirmar(
        context,
        titulo: reduz ? 'Reduzir para ${p.nome}?' : 'Mudar para ${p.nome}?',
        texto: reduz
            ? 'O plano atual vale até ${f.data(s.cicloFim)}. O ${p.nome} começa na virada do ciclo, com ${f.numero(p.disparosMes)} disparos por mês.'
            : 'Os disparos a mais valem já neste ciclo, e as próximas cobranças do Mercado Pago saem no valor de ${f.reais(p.precoCentavos)}.',
        botao: reduz ? 'Reduzir' : 'Mudar',
      );
      if (!ok || !mounted) return;
    }
    setState(() => _ocupado = p.id);
    try {
      final r = await ref
          .read(servicoContaProvider)
          .contratar(
            p.id,
            emailPagador: _outroEmail ? _emailPagador.text : null,
          );
      if (!mounted) return;
      switch (r) {
        case ContratacaoCheckout(:final url):
          avisar(
            context,
            'Abrindo o Mercado Pago. Conclua o pagamento lá e volte para o app.',
          );
          await _abrirPagamento(url);
        case ContratacaoResolvida(:final mensagem):
          avisar(context, mensagem);
      }
      ref.invalidate(situacaoPlanoProvider);
    } catch (e) {
      if (mounted) avisar(context, mensagemDoErro(e));
    } finally {
      if (mounted) setState(() => _ocupado = null);
    }
  }

  Future<void> _cancelar(SituacaoPlano s) async {
    final ok = await confirmar(
      context,
      titulo: s.pago ? 'Cancelar a renovação?' : 'Cancelar a contratação?',
      texto: s.pago
          ? 'Os disparos param em ${f.data(s.cicloFim)}, quando o ciclo pago acabar. Contatos, modelos e histórico continuam na conta.'
          : 'O link de pagamento deixa de valer.',
      botao: 'Confirmar cancelamento',
      perigo: true,
    );
    if (!ok || !mounted) return;
    setState(() => _ocupado = 'cancelar');
    try {
      await ref.read(servicoContaProvider).cancelar();
      if (!mounted) return;
      avisar(
        context,
        s.pago ? 'Renovação cancelada.' : 'Contratação cancelada.',
      );
      ref.invalidate(situacaoPlanoProvider);
    } catch (e) {
      if (mounted) avisar(context, mensagemDoErro(e));
    } finally {
      if (mounted) setState(() => _ocupado = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final carga = ref.watch(situacaoPlanoProvider);
    final sessao = ref.watch(sessaoProvider);
    final ehDono = sessao is SessaoAtiva && sessao.sessao.usuario.ehDono;

    return Scaffold(
      appBar: AppBar(title: const Text('Plano e pagamento')),
      body: carga.when(
        loading: () => const Padding(
          padding: EdgeInsets.all(20),
          child: Column(
            children: [
              Cartao(child: Esqueleto(altura: 90)),
              SizedBox(height: 14),
              Cartao(child: Esqueleto(altura: 160)),
            ],
          ),
        ),
        error: (e, _) => Padding(
          padding: const EdgeInsets.all(20),
          child: EstadoErro(
            titulo: 'Não consegui ler o plano',
            mensagem: mensagemDoErro(e),
            aoTentar: () => ref.invalidate(situacaoPlanoProvider),
          ),
        ),
        data: (s) => RefreshIndicator(
          color: c.acentoContraste,
          backgroundColor: c.acento,
          onRefresh: () async {
            ref.invalidate(situacaoPlanoProvider);
            await ref.read(situacaoPlanoProvider.future).catchError((_) => s);
          },
          child: ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 28),
            children: [
              if (_situacao(s) case final aviso?) ...[
                aviso,
                const SizedBox(height: 14),
              ],
              _Consumo(situacao: s),
              if (compraNoApp && s.checkoutPendenteUrl != null && !s.pago) ...[
                const SizedBox(height: 14),
                Aviso(
                  tom: TomPilula.acento,
                  icone: Icons.payments_outlined,
                  texto:
                      'Você começou a contratar${s.checkoutPendentePlano == null ? '' : ' o plano ${s.checkoutPendentePlano}'} e o pagamento ainda não foi concluído.',
                  acao: TextButton(
                    onPressed: () => _abrirPagamento(s.checkoutPendenteUrl!),
                    child: const Text('Concluir no Mercado Pago'),
                  ),
                ),
              ],
              const SizedBox(height: 22),
              Text('Planos', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 8),
              if (!compraNoApp)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: Text(
                    'A contratação e a troca de plano são feitas na sua conta do RegemCast, fora do app.',
                    style: TextStyle(
                      color: c.tintaSuave,
                      fontSize: 13,
                      height: 1.45,
                    ),
                  ),
                )
              else if (!s.cobrancaDisponivel)
                const Padding(
                  padding: EdgeInsets.only(bottom: 10),
                  child: Aviso(
                    texto:
                        'A contratação pelo Mercado Pago ainda não está disponível. Fale com o suporte do RegemCast.',
                  ),
                )
              else if (!ehDono)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: Text(
                    'Só o dono da conta pode contratar ou trocar de plano.',
                    style: TextStyle(color: c.tintaSuave, fontSize: 13),
                  ),
                ),
              for (final p in s.planos)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: _CartaoPlano(
                    plano: p,
                    atual: s.ehAtual(p),
                    rotulo: s.rotuloDo(p),
                    ocupado: _ocupado == p.id,
                    aoEscolher:
                        compraNoApp &&
                            ehDono &&
                            s.podeEscolher(p) &&
                            _ocupado == null
                        ? () => _escolher(s, p)
                        : null,
                    mostrarBotao: compraNoApp,
                  ),
                ),
              if (compraNoApp &&
                  ehDono &&
                  s.cobrancaDisponivel &&
                  !s.pago &&
                  s.recontratarEm == null) ...[
                CheckboxListTile(
                  value: _outroEmail,
                  onChanged: (v) => setState(() => _outroEmail = v ?? false),
                  controlAffinity: ListTileControlAffinity.leading,
                  contentPadding: EdgeInsets.zero,
                  title: const Text(
                    'Vou pagar com uma conta do Mercado Pago de outro e-mail',
                    style: TextStyle(fontSize: 14),
                  ),
                ),
                if (_outroEmail)
                  TextField(
                    controller: _emailPagador,
                    keyboardType: TextInputType.emailAddress,
                    autocorrect: false,
                    decoration: const InputDecoration(
                      labelText: 'E-mail da conta do Mercado Pago',
                    ),
                  ),
              ],
              const SizedBox(height: 8),
              Text(
                'O pagamento do plano renova todo mês. A cobrança das mensagens enviadas pelo WhatsApp é da Meta, na conta da sua empresa, e é separada do plano.',
                style: TextStyle(
                  color: c.tintaSuave,
                  fontSize: 12.5,
                  height: 1.45,
                ),
              ),
              const SizedBox(height: 22),
              Text(
                'Pagamentos',
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 8),
              _Pagamentos(cobrancas: s.cobrancas),
              if (ehDono &&
                  (s.mpStatus == 'authorized' || s.mpStatus == 'pending')) ...[
                const SizedBox(height: 22),
                OutlinedButton(
                  style: OutlinedButton.styleFrom(
                    foregroundColor: c.erro,
                    side: BorderSide(color: c.erro.withValues(alpha: 0.4)),
                  ),
                  onPressed: _ocupado != null ? null : () => _cancelar(s),
                  child: Text(
                    s.pago ? 'Cancelar renovação' : 'Cancelar contratação',
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  /// O quadro do topo — as mesmas frases da página do site.
  Widget? _situacao(SituacaoPlano s) {
    if (s.bloqueado) {
      return Aviso(
        tom: TomPilula.erro,
        icone: Icons.block_rounded,
        texto: s.status == 'cancelada'
            ? 'Sua assinatura terminou e os disparos estão parados. Escolha um plano para voltar a enviar.'
            : 'Os disparos estão parados por falta de pagamento. As campanhas voltam sozinhas quando o pagamento for confirmado.',
      );
    }
    if (s.status == 'cortesia') {
      return Aviso(
        tom: TomPilula.acento,
        icone: Icons.card_giftcard_rounded,
        texto:
            'Primeiro mês grátis até ${f.data(s.gratisAte)}. Escolha um plano antes de ${f.data(s.disparosParamEm)} para os disparos não pararem.',
      );
    }
    if (s.status == 'inadimplente') {
      return Aviso(
        tom: TomPilula.erro,
        icone: Icons.credit_card_off_rounded,
        texto:
            'O último pagamento não foi aprovado. Os disparos param em ${f.data(s.disparosParamEm)} se ele não for regularizado — confira o meio de pagamento no Mercado Pago.',
      );
    }
    if (s.renovacaoCancelada) {
      return Aviso(
        icone: Icons.event_busy_rounded,
        texto:
            'Renovação cancelada. Seu plano vale até ${f.data(s.cicloFim)}.${s.recontratarEm != null ? ' A partir dessa data você pode contratar de novo — antes disso seria pagar o mesmo mês duas vezes.' : ''}',
      );
    }
    if (s.status == 'ativa') {
      return Aviso(
        tom: TomPilula.sucesso,
        icone: Icons.check_circle_outline_rounded,
        texto:
            'Plano ${s.planoAtual?.nome ?? ''} ativo e em dia. Renova em ${f.data(s.cicloFim)}.',
      );
    }
    return null;
  }
}

class _Consumo extends StatelessWidget {
  const _Consumo({required this.situacao});

  final SituacaoPlano situacao;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final s = situacao;
    final teto = s.teto;
    final fracao = teto == null || teto == 0
        ? null
        : (s.disparos / teto).clamp(0, 1).toDouble();
    return Cartao(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            s.planoAtual?.nome ?? 'Sem plano contratado',
            style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 10),
          Text.rich(
            TextSpan(
              children: [
                TextSpan(
                  text: f.numero(s.disparos),
                  style: const TextStyle(
                    fontWeight: FontWeight.w700,
                    fontSize: 22,
                  ),
                ),
                TextSpan(
                  text: teto == null
                      ? ' disparos neste ciclo'
                      : ' de ${f.numero(teto)} disparos neste ciclo',
                  style: TextStyle(color: c.tintaSuave),
                ),
              ],
            ),
          ),
          if (fracao != null) ...[
            const SizedBox(height: 10),
            ClipRRect(
              borderRadius: BorderRadius.circular(99),
              child: LinearProgressIndicator(
                value: fracao,
                minHeight: 8,
                backgroundColor: c.superficie2,
                color: fracao >= 0.9 ? c.erro : c.acento,
              ),
            ),
          ],
          const SizedBox(height: 10),
          Text(
            'Ciclo termina em ${f.data(s.cicloFim)}',
            style: TextStyle(color: c.tintaSuave, fontSize: 13),
          ),
          if (s.planoProximoCiclo != null)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                'A partir de ${f.data(s.cicloFim)}: plano ${s.planoProximoCiclo!.nome}.',
                style: TextStyle(color: c.tintaSuave, fontSize: 13),
              ),
            ),
        ],
      ),
    );
  }
}

class _CartaoPlano extends StatelessWidget {
  const _CartaoPlano({
    required this.plano,
    required this.atual,
    required this.rotulo,
    required this.ocupado,
    required this.aoEscolher,
    required this.mostrarBotao,
  });

  final PlanoOferta plano;
  final bool atual;
  final String rotulo;
  final bool ocupado;
  final VoidCallback? aoEscolher;
  final bool mostrarBotao;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final p = plano;
    final porMil = p.disparosMes == 0
        ? null
        : (p.precoCentavos / p.disparosMes * 1000).round();
    return Cartao(
      destaque: atual,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  p.nome,
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              if (atual) const Pilula('Atual', tom: TomPilula.sucesso),
            ],
          ),
          const SizedBox(height: 6),
          Text.rich(
            TextSpan(
              children: [
                TextSpan(
                  text: f.reais(p.precoCentavos),
                  style: const TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                TextSpan(
                  text: '/mês',
                  style: TextStyle(color: c.tintaSuave),
                ),
              ],
            ),
          ),
          const SizedBox(height: 4),
          Text(
            '${f.numero(p.disparosMes)} disparos por mês'
            '${porMil == null ? '' : ' · ${f.reais(porMil)} a cada mil'}',
            style: TextStyle(color: c.tintaSuave, fontSize: 13),
          ),
          if (mostrarBotao) ...[
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: atual
                  ? OutlinedButton(onPressed: aoEscolher, child: Text(rotulo))
                  : FilledButton(
                      onPressed: aoEscolher,
                      child: ocupado
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : Text(rotulo),
                    ),
            ),
          ],
        ],
      ),
    );
  }
}

class _Pagamentos extends StatelessWidget {
  const _Pagamentos({required this.cobrancas});

  final List<CobrancaPlano> cobrancas;

  static (String, TomPilula) _situacao(String status) => switch (status) {
    'aprovada' => ('Paga', TomPilula.sucesso),
    'pendente' => ('Pendente', TomPilula.atencao),
    'recusada' => ('Recusada', TomPilula.erro),
    'cancelada' => ('Cancelada', TomPilula.neutro),
    'estornada' => ('Estornada', TomPilula.neutro),
    _ => (status, TomPilula.neutro),
  };

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    if (cobrancas.isEmpty) {
      return Cartao(
        child: Text(
          'Nenhum pagamento ainda.',
          style: TextStyle(color: c.tintaSuave),
        ),
      );
    }
    return Cartao(
      padding: EdgeInsets.zero,
      child: Column(
        children: [
          for (var i = 0; i < cobrancas.length; i++) ...[
            if (i > 0) Divider(height: 1, indent: 16, color: c.borda),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          f.reais(cobrancas[i].valorCentavos),
                          style: const TextStyle(fontWeight: FontWeight.w600),
                        ),
                        Text(
                          [
                            f.data(cobrancas[i].data),
                            ?cobrancas[i].plano,
                          ].join(' · '),
                          style: TextStyle(color: c.tintaSuave, fontSize: 12.5),
                        ),
                        if (cobrancas[i].motivo != null)
                          Padding(
                            padding: const EdgeInsets.only(top: 2),
                            child: Text(
                              cobrancas[i].motivo!,
                              style: TextStyle(color: c.erro, fontSize: 12.5),
                            ),
                          ),
                      ],
                    ),
                  ),
                  Builder(
                    builder: (_) {
                      final (rotulo, tom) = _situacao(cobrancas[i].status);
                      return Pilula(rotulo, tom: tom);
                    },
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}
