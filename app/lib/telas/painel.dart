import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/dados.dart';
import '../api/erro_api.dart';
import '../api/leituras.dart';
import '../componentes/basicos.dart';
import '../componentes/campanha.dart';
import '../config.dart';
import '../sessao/sessao.dart';
import '../tema/cores.dart';
import '../util/formato.dart' as f;
import 'campanha_detalhe.dart';
import 'campanha_formulario.dart';

/// O Painel: o que precisa de atenção agora, em uma olhada.
///
/// Ordem pensada para quem abre o app no meio do dia: primeiro o que pode
/// estar dando errado (pagamento, número, campanha parada), depois o consumo,
/// depois o que está saindo. O resumo antes do detalhe.
class TelaPainel extends ConsumerWidget {
  const TelaPainel({super.key});

  Future<void> _atualizar(WidgetRef ref) async {
    ref.invalidate(resumoContaProvider);
    ref.invalidate(situacaoWhatsappProvider);
    ref.invalidate(campanhasProvider);
    // Espera as três antes de soltar o "puxar para atualizar": o círculo girando
    // precisa dizer a verdade sobre quando os dados chegaram.
    await Future.wait([
      ref.read(resumoContaProvider.future).catchError((_) => _vazio),
      ref
          .read(situacaoWhatsappProvider.future)
          .catchError(
            (_) => const SituacaoWhatsapp(conectado: false, numeros: []),
          ),
      ref.read(campanhasProvider.future).catchError((_) => <ResumoCampanha>[]),
    ]);
  }

  static const _vazio = ResumoConta(
    nomeConta: '',
    planoNome: null,
    statusAssinatura: null,
    cicloFim: null,
    gratisAte: null,
    disparos: 0,
    teto: null,
    restantes: null,
  );

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final estado = ref.watch(sessaoProvider);
    final sessao = estado is SessaoAtiva ? estado.sessao : null;
    final c = Cores.de(context);

    return RefreshIndicator(
      color: c.acentoContraste,
      backgroundColor: c.acento,
      onRefresh: () => _atualizar(ref),
      child: CustomScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        slivers: [
          SliverSafeArea(
            bottom: false,
            sliver: SliverPadding(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
              sliver: SliverToBoxAdapter(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      sessao == null
                          ? 'Painel'
                          : 'Olá, ${sessao.usuario.primeiroNome}',
                      style: Theme.of(context).textTheme.headlineSmall,
                    ),
                    if (sessao != null)
                      Text(
                        sessao.conta.nome,
                        style: TextStyle(color: c.tintaSuave, fontSize: 14),
                      ),
                  ],
                ),
              ),
            ),
          ),
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 28),
            sliver: SliverList.list(
              children: const [
                _BlocoAlertas(),
                _BlocoPlano(),
                SizedBox(height: 14),
                _BlocoWhatsapp(),
                SizedBox(height: 22),
                _BlocoCampanhas(),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------- alertas

/// Só aparece quando há o que dizer: pagamento atrasado, grátis acabando,
/// campanha parada por motivo que a pessoa precisa resolver.
class _BlocoAlertas extends ConsumerWidget {
  const _BlocoAlertas();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final resumo = ref.watch(resumoContaProvider).value;
    final campanhas =
        ref.watch(campanhasProvider).value ?? const <ResumoCampanha>[];
    final avisos = <Widget>[];

    if (resumo?.statusAssinatura == 'inadimplente') {
      avisos.add(
        Aviso(
          tom: TomPilula.erro,
          icone: Icons.credit_card_off_rounded,
          texto:
              'O último pagamento do plano não foi aprovado. Regularize para os disparos não pararem.',
          acao: _BotaoWeb(rotulo: 'Ver plano e pagamento', caminho: '/plano'),
        ),
      );
    }

    final gratis = resumo?.gratisAte;
    if (resumo?.statusAssinatura == 'cortesia' && gratis != null) {
      final dias = gratis.difference(DateTime.now()).inDays;
      if (dias <= 7) {
        avisos.add(
          Aviso(
            icone: Icons.hourglass_bottom_rounded,
            texto: dias <= 0
                ? 'Seu mês grátis terminou. Escolha um plano para continuar disparando.'
                : 'Seu mês grátis termina em ${f.data(gratis)}. Escolha um plano para os disparos não pararem.',
            acao: _BotaoWeb(rotulo: 'Escolher plano', caminho: '/plano'),
          ),
        );
      }
    }

    final porTeto = campanhas
        .where((c) => c.status == 'pausada' && c.pausaMotivo == 'teto_plano')
        .length;
    if (porTeto > 0) {
      avisos.add(
        Aviso(
          icone: Icons.speed_rounded,
          texto:
              '${f.plural(porTeto, 'campanha pausada', 'campanhas pausadas')} porque os disparos do plano acabaram. '
              'Elas voltam sozinhas quando o ciclo virar ou com um plano maior.',
        ),
      );
    }

    final porConexao = campanhas
        .where((c) => c.status == 'pausada' && c.pausaMotivo == 'conexao')
        .length;
    if (porConexao > 0) {
      avisos.add(
        Aviso(
          tom: TomPilula.erro,
          icone: Icons.link_off_rounded,
          texto:
              '${f.plural(porConexao, 'campanha parou', 'campanhas pararam')} porque a conexão com o WhatsApp caiu. '
              'Reconecte pelo site e retome.',
        ),
      );
    }

    if (avisos.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Column(
        children: [
          for (final a in avisos)
            Padding(padding: const EdgeInsets.only(bottom: 10), child: a),
        ],
      ),
    );
  }
}

// ------------------------------------------------------------------ plano

class _BlocoPlano extends ConsumerWidget {
  const _BlocoPlano();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = Cores.de(context);
    final carga = ref.watch(resumoContaProvider);

    return carga.when(
      loading: () => const Cartao(
        child: Row(
          children: [
            Esqueleto(altura: 120, largura: 120, raio: 60),
            SizedBox(width: 18),
            Expanded(
              child: Column(
                children: [
                  Esqueleto(),
                  SizedBox(height: 10),
                  Esqueleto(largura: 120),
                ],
              ),
            ),
          ],
        ),
      ),
      error: (e, _) => EstadoErro(
        titulo: 'Não consegui ler o consumo do plano',
        mensagem: mensagemDoErro(e),
        aoTentar: () => ref.invalidate(resumoContaProvider),
      ),
      data: (r) {
        final fracao = r.fracao;
        final porcento = fracao == null ? '—' : '${(fracao * 100).round()}%';
        final rodape = r.statusAssinatura == 'cortesia' && r.gratisAte != null
            ? 'Grátis até ${f.data(r.gratisAte)}'
            : r.cicloFim != null
            ? 'Renova em ${f.data(r.cicloFim)}'
            : null;

        return Cartao(
          child: Row(
            children: [
              AnelUso(
                fracao: fracao,
                tamanho: 118,
                centro: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      porcento,
                      style: const TextStyle(
                        fontSize: 24,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    Text(
                      'usado',
                      style: TextStyle(fontSize: 12, color: c.tintaSuave),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 18),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'PLANO ${(r.planoNome ?? 'sem plano').toUpperCase()}',
                      style: TextStyle(
                        fontSize: 11,
                        letterSpacing: 1.2,
                        fontWeight: FontWeight.w600,
                        color: c.tintaSuave,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text.rich(
                      TextSpan(
                        children: [
                          TextSpan(
                            text: f.numero(r.disparos),
                            style: const TextStyle(
                              fontSize: 22,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          TextSpan(
                            text: r.teto == null
                                ? ' disparos'
                                : ' de ${f.numero(r.teto!)}',
                            style: TextStyle(fontSize: 14, color: c.tintaSuave),
                          ),
                        ],
                      ),
                    ),
                    Text(
                      'disparos neste ciclo',
                      style: TextStyle(fontSize: 13, color: c.tintaSuave),
                    ),
                    if (r.restantes != null) ...[
                      const SizedBox(height: 8),
                      Pilula(
                        '${f.numero(r.restantes!)} restantes',
                        tom: (fracao ?? 0) >= 0.9
                            ? TomPilula.erro
                            : TomPilula.acento,
                        ponto: false,
                      ),
                    ],
                    if (rodape != null) ...[
                      const SizedBox(height: 8),
                      Text(
                        rodape,
                        style: TextStyle(fontSize: 12, color: c.tintaSuave),
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

// --------------------------------------------------------------- WhatsApp

class _BlocoWhatsapp extends ConsumerWidget {
  const _BlocoWhatsapp();

  static (String, TomPilula) _qualidade(String q) => switch (q) {
    'verde' => ('Qualidade alta', TomPilula.sucesso),
    'amarela' => ('Qualidade média', TomPilula.atencao),
    'vermelha' => ('Qualidade baixa', TomPilula.erro),
    _ => ('Qualidade em avaliação', TomPilula.neutro),
  };

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = Cores.de(context);
    final carga = ref.watch(situacaoWhatsappProvider);

    return carga.when(
      loading: () => const Cartao(
        child: Column(
          children: [
            Esqueleto(),
            SizedBox(height: 10),
            Esqueleto(largura: 160),
          ],
        ),
      ),
      error: (e, _) => EstadoErro(
        titulo: 'Não consegui ler o WhatsApp',
        mensagem: mensagemDoErro(e),
        aoTentar: () => ref.invalidate(situacaoWhatsappProvider),
      ),
      data: (s) {
        final n = s.principal;
        if (!s.conectado || n == null) {
          return Aviso(
            icone: Icons.chat_bubble_outline_rounded,
            texto:
                'Nenhum número de WhatsApp conectado. A conexão é feita pelo site, com a conta da Meta.',
            acao: _BotaoWeb(rotulo: 'Conectar pelo site', caminho: '/whatsapp'),
          );
        }
        final (rotulo, tom) = _qualidade(n.qualidade);
        return Cartao(
          child: Row(
            children: [
              Container(
                width: 46,
                height: 46,
                decoration: BoxDecoration(
                  color: c.acentoSuave,
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Icon(Icons.phone_iphone_rounded, color: c.tinta),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      n.telefone ?? n.nome ?? 'Número conectado',
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      n.tierLimite == null
                          ? 'Limite de envio: definido pela Meta'
                          : 'Até ${f.numero(n.tierLimite!)} pessoas por dia',
                      style: TextStyle(fontSize: 13, color: c.tintaSuave),
                    ),
                    // Embaixo, e não ao lado: ao lado ela espremia o número em
                    // duas linhas em qualquer celular de tela estreita.
                    const SizedBox(height: 8),
                    Pilula(rotulo, tom: tom),
                  ],
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

// -------------------------------------------------------------- campanhas

class _BlocoCampanhas extends ConsumerWidget {
  const _BlocoCampanhas();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = Cores.de(context);
    final carga = ref.watch(campanhasProvider);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Campanhas', style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 10),
        carga.when(
          loading: () => const Column(
            children: [
              Cartao(child: Esqueleto(altura: 54)),
              SizedBox(height: 10),
              Cartao(child: Esqueleto(altura: 54)),
            ],
          ),
          error: (e, _) => EstadoErro(
            titulo: 'Não consegui ler as campanhas',
            mensagem: mensagemDoErro(e),
            aoTentar: () => ref.invalidate(campanhasProvider),
          ),
          data: (lista) {
            if (lista.isEmpty) {
              return Cartao(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Nenhuma campanha ainda',
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'Escolha um modelo aprovado e quem recebe. Montar não envia nada: você confere e dispara na tela seguinte.',
                      style: TextStyle(color: c.tintaSuave, height: 1.4),
                    ),
                    const SizedBox(height: 12),
                    OutlinedButton.icon(
                      style: OutlinedButton.styleFrom(
                        minimumSize: const Size(0, 42),
                      ),
                      onPressed: () async {
                        await Navigator.of(context).push(
                          MaterialPageRoute(
                            builder: (_) => const TelaFormularioCampanha(),
                          ),
                        );
                        ref.invalidate(campanhasProvider);
                        ref.invalidate(resumoContaProvider);
                      },
                      icon: const Icon(Icons.add_rounded, size: 18),
                      label: const Text('Montar a primeira'),
                    ),
                  ],
                ),
              );
            }
            // O que está saindo primeiro; depois as mais recentes.
            final ordenadas = [...lista]
              ..sort((a, b) {
                final pa = a.emAndamento ? 0 : (a.status == 'pausada' ? 1 : 2);
                final pb = b.emAndamento ? 0 : (b.status == 'pausada' ? 1 : 2);
                if (pa != pb) return pa.compareTo(pb);
                return (b.criadoEm ?? DateTime(0)).compareTo(
                  a.criadoEm ?? DateTime(0),
                );
              });
            return Column(
              children: [
                for (final camp in ordenadas.take(6))
                  Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: CartaoCampanha(
                      campanha: camp,
                      aoTocar: () async {
                        await Navigator.of(context).push(
                          MaterialPageRoute(
                            builder: (_) => TelaCampanhaDetalhe(
                              id: camp.id,
                              nomeInicial: camp.nome,
                            ),
                          ),
                        );
                        // Voltou: pode ter pausado, cancelado ou disparado.
                        ref.invalidate(campanhasProvider);
                        ref.invalidate(resumoContaProvider);
                      },
                    ),
                  ),
              ],
            );
          },
        ),
      ],
    );
  }
}

/// Abre uma página do site. Para o que continua sendo feito no computador.
class _BotaoWeb extends StatelessWidget {
  const _BotaoWeb({required this.rotulo, required this.caminho});

  final String rotulo;
  final String caminho;

  @override
  Widget build(BuildContext context) => Align(
    alignment: Alignment.centerLeft,
    child: OutlinedButton.icon(
      style: OutlinedButton.styleFrom(minimumSize: const Size(0, 40)),
      onPressed: () => launchUrl(
        Uri.parse('$urlWeb$caminho'),
        mode: LaunchMode.externalApplication,
      ),
      icon: const Icon(Icons.open_in_new_rounded, size: 18),
      label: Text(rotulo),
    ),
  );
}
