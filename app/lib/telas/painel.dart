import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/contatos.dart';
import '../api/dados.dart';
import '../api/erro_api.dart';
import '../api/leituras.dart';
import '../api/modelos.dart';
import '../componentes/basicos.dart';
import '../componentes/campanha.dart';
import '../config.dart';
import '../sessao/sessao.dart';
import '../tema/cores.dart';
import '../util/formato.dart' as f;
import 'campanha_detalhe.dart';
import 'campanha_formulario.dart';
import 'casca.dart';
import 'importar_contatos.dart';
import 'plano.dart';
import 'whatsapp.dart';

/// O Painel: o que precisa de atenção agora, em uma olhada.
///
/// Ordem pensada para quem abre o app no meio do dia: primeiro o que pode
/// estar dando errado (pagamento, número, campanha parada), depois — para
/// quem está começando — o caminho até o primeiro disparo, o consumo, o
/// número, os indicadores e o que está saindo. O resumo antes do detalhe.
class TelaPainel extends ConsumerWidget {
  const TelaPainel({super.key});

  Future<void> _atualizar(WidgetRef ref) async {
    ref.invalidate(resumoContaProvider);
    ref.invalidate(situacaoWhatsappProvider);
    ref.invalidate(campanhasProvider);
    ref.invalidate(totalContatosProvider);
    ref.invalidate(modelosNaMetaProvider);
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
    // O nome que o dono acabou de mudar em Conta vem do resumo; a sessão
    // guarda o do login.
    final resumo = ref.watch(resumoContaProvider).value;
    final nomeConta = resumo != null && resumo.nomeConta.isNotEmpty
        ? resumo.nomeConta
        : sessao?.conta.nome;

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
                    if (nomeConta != null)
                      Text(
                        nomeConta,
                        style: TextStyle(color: c.tintaSuave, fontSize: 14),
                      ),
                    const SizedBox(height: 14),
                    const _AcoesRapidas(),
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
                _CaminhoAteODisparo(),
                _BlocoPlano(),
                SizedBox(height: 14),
                _BlocoWhatsapp(),
                SizedBox(height: 14),
                _BlocoIndicadores(),
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

/// Abre uma tela do app e, na volta, relê o que ela pode ter mudado: a
/// campanha montada, os contatos importados, o modelo aprovado, o número.
Future<void> _abrirERelear(
  BuildContext context,
  WidgetRef ref,
  Widget tela,
) async {
  await Navigator.of(
    context,
  ).push(MaterialPageRoute<void>(builder: (_) => tela));
  ref.invalidate(campanhasProvider);
  ref.invalidate(resumoContaProvider);
  ref.invalidate(totalContatosProvider);
  ref.invalidate(modelosNaMetaProvider);
  ref.invalidate(situacaoWhatsappProvider);
}

/// "Nova campanha" e "Importar contatos" — os dois atalhos do topo do
/// Painel no site. Lado a lado e do mesmo tamanho; em tela estreita o texto
/// encolhe em vez de quebrar a linha.
class _AcoesRapidas extends ConsumerWidget {
  const _AcoesRapidas();

  static const _texto = TextStyle(
    fontFamily: 'Poppins',
    fontSize: 14,
    fontWeight: FontWeight.w600,
  );
  static const _respiro = EdgeInsets.symmetric(horizontal: 12);

  static Widget _rotulo(String texto) =>
      FittedBox(fit: BoxFit.scaleDown, child: Text(texto, maxLines: 1));

  @override
  Widget build(BuildContext context, WidgetRef ref) => Row(
    children: [
      Expanded(
        child: FilledButton.icon(
          key: const ValueKey('painel-nova-campanha'),
          style: FilledButton.styleFrom(
            minimumSize: const Size(0, 44),
            padding: _respiro,
            textStyle: _texto,
          ),
          onPressed: () =>
              _abrirERelear(context, ref, const TelaFormularioCampanha()),
          icon: const Icon(Icons.add_rounded, size: 18),
          label: _rotulo('Nova campanha'),
        ),
      ),
      const SizedBox(width: 10),
      Expanded(
        child: OutlinedButton.icon(
          key: const ValueKey('painel-importar'),
          style: OutlinedButton.styleFrom(
            minimumSize: const Size(0, 44),
            padding: _respiro,
            textStyle: _texto,
          ),
          onPressed: () =>
              _abrirERelear(context, ref, const TelaImportarContatos()),
          icon: const Icon(Icons.upload_rounded, size: 18),
          label: _rotulo('Importar contatos'),
        ),
      ),
    ],
  );
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

    // Os avisos de cobrança abrem o plano DO APP. No build da Play
    // (`compraNoApp` desligado) eles só informam: a Google proíbe chamar para
    // pagar fora do faturamento dela — nada de "escolha um plano" nem de link
    // para o site.
    if (resumo?.statusAssinatura == 'inadimplente') {
      avisos.add(
        Aviso(
          tom: TomPilula.erro,
          icone: Icons.credit_card_off_rounded,
          texto: compraNoApp
              ? 'O último pagamento do plano não foi aprovado. Regularize para os disparos não pararem.'
              : 'O último pagamento do plano não foi aprovado, e os disparos param enquanto ele estiver pendente.',
          acao: const _BotaoTela(
            chave: 'ver-plano',
            rotulo: 'Ver plano e pagamento',
            tela: TelaPlano(),
          ),
        ),
      );
    }

    final gratis = resumo?.gratisAte;
    if (resumo?.statusAssinatura == 'cortesia' && gratis != null) {
      final dias = gratis.difference(DateTime.now()).inDays;
      if (dias <= 7) {
        final String texto;
        if (dias <= 0) {
          texto = compraNoApp
              ? 'Seu mês grátis terminou. Escolha um plano para continuar disparando.'
              : 'Seu mês grátis terminou, e os disparos ficam parados até a conta ter um plano.';
        } else {
          texto = compraNoApp
              ? 'Seu mês grátis termina em ${f.data(gratis)}. Escolha um plano para os disparos não pararem.'
              : 'Seu mês grátis termina em ${f.data(gratis)}. Depois dele, os disparos param até a conta ter um plano.';
        }
        avisos.add(
          Aviso(
            key: const ValueKey('aviso-gratis'),
            icone: Icons.hourglass_bottom_rounded,
            texto: texto,
            acao: _BotaoTela(
              chave: 'escolher-plano',
              rotulo: compraNoApp ? 'Escolher plano' : 'Ver plano',
              tela: const TelaPlano(),
            ),
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

// ---------------------------------------------------- caminho até o disparo

/// Um passo do "Caminho até o disparo".
class _PassoDoCaminho {
  const _PassoDoCaminho({
    required this.chave,
    required this.titulo,
    required this.descricao,
    required this.icone,
    required this.feito,
    required this.tela,
  });

  final String chave;
  final String titulo;
  final String descricao;
  final IconData icone;
  final bool feito;
  final Widget tela;
}

/// "Caminho até o disparo", como no Painel do site: conectar o número,
/// importar contatos, ter um modelo aprovado e disparar a primeira campanha.
///
/// No site ele fica numa coluna ao lado; no celular empurraria o resto para
/// baixo para sempre — por isso aparece só enquanto falta algum passo, e só
/// com as leituras em mãos: passo que não deu para conferir não vira "falta".
class _CaminhoAteODisparo extends ConsumerWidget {
  const _CaminhoAteODisparo();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = Cores.de(context);
    final whatsapp = ref.watch(situacaoWhatsappProvider);
    final contatos = ref.watch(totalContatosProvider);
    final campanhas = ref.watch(campanhasProvider);
    final conectado = whatsapp.value?.conectado == true;
    // Modelos aprovados só existem na Meta, e só dá para perguntar com o
    // número conectado — sem ele, esse passo ainda não foi feito.
    final modelos = conectado ? ref.watch(modelosNaMetaProvider) : null;

    if (!whatsapp.hasValue ||
        !contatos.hasValue ||
        !campanhas.hasValue ||
        (modelos != null && !modelos.hasValue)) {
      return const SizedBox.shrink();
    }

    final aprovados =
        modelos?.value?.where((m) => m.status == 'aprovado').length ?? 0;
    final passos = [
      _PassoDoCaminho(
        chave: 'passo-numero',
        titulo: 'Conectar o número',
        descricao:
            'Você autoriza na janela da Meta e nós concluímos a conexão.',
        icone: Icons.chat_bubble_outline_rounded,
        feito: conectado,
        tela: const TelaWhatsapp(),
      ),
      _PassoDoCaminho(
        chave: 'passo-contatos',
        titulo: 'Importar contatos',
        descricao: 'Agenda do celular, planilha ou números colados.',
        icone: Icons.group_outlined,
        feito: (contatos.value ?? 0) > 0,
        tela: const TelaImportarContatos(),
      ),
      _PassoDoCaminho(
        chave: 'passo-modelo',
        titulo: 'Ter um modelo aprovado',
        descricao: 'Conferimos as regras da Meta antes de enviar para análise.',
        icone: Icons.description_outlined,
        feito: aprovados > 0,
        tela: const TelaModelosAvulsa(),
      ),
      _PassoDoCaminho(
        chave: 'passo-campanha',
        titulo: 'Disparar a primeira campanha',
        descricao: 'Escolha o público, o modelo e a janela de envio.',
        icone: Icons.campaign_outlined,
        feito: (campanhas.value ?? const <ResumoCampanha>[]).any(
          (camp) => camp.status != 'rascunho',
        ),
        tela: const TelaFormularioCampanha(),
      ),
    ];
    final feitos = passos.where((p) => p.feito).length;
    if (feitos == passos.length) return const SizedBox.shrink();

    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Cartao(
        key: const ValueKey('caminho-ate-o-disparo'),
        destaque: true,
        padding: const EdgeInsets.fromLTRB(18, 16, 12, 6),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.only(right: 6),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      'Caminho até o disparo',
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                  ),
                  Text(
                    '$feitos/${passos.length}',
                    key: const ValueKey('caminho-progresso'),
                    style: const TextStyle(
                      fontWeight: FontWeight.w700,
                      fontFeatures: [FontFeature.tabularFigures()],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 10),
            Padding(
              padding: const EdgeInsets.only(right: 6),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(99),
                child: LinearProgressIndicator(
                  value: feitos / passos.length,
                  minHeight: 6,
                  backgroundColor: c.superficie2,
                  color: c.acento,
                ),
              ),
            ),
            const SizedBox(height: 6),
            for (var i = 0; i < passos.length; i++)
              _LinhaDoPasso(
                numero: i + 1,
                passo: passos[i],
                aoTocar: () => _abrirERelear(context, ref, passos[i].tela),
              ),
          ],
        ),
      ),
    );
  }
}

class _LinhaDoPasso extends StatelessWidget {
  const _LinhaDoPasso({
    required this.numero,
    required this.passo,
    required this.aoTocar,
  });

  final int numero;
  final _PassoDoCaminho passo;
  final VoidCallback aoTocar;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final feito = passo.feito;
    return Semantics(
      label: 'Passo $numero${feito ? ', concluído' : ''}',
      child: InkWell(
        key: ValueKey(passo.chave),
        borderRadius: BorderRadius.circular(12),
        onTap: aoTocar,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 10),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 34,
                height: 34,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: feito ? c.acento : c.superficie,
                  border: Border.all(color: feito ? c.acento : c.borda),
                ),
                child: Icon(
                  feito ? Icons.check_rounded : passo.icone,
                  key: ValueKey('${passo.chave}-${feito ? 'feito' : 'falta'}'),
                  size: 18,
                  color: feito ? c.acentoContraste : c.tintaSuave,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      passo.titulo,
                      style: TextStyle(
                        fontWeight: FontWeight.w600,
                        color: feito ? c.tintaSuave : c.tinta,
                        decoration: feito ? TextDecoration.lineThrough : null,
                        decorationColor: c.acento,
                        decorationThickness: 2,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      passo.descricao,
                      style: TextStyle(
                        color: c.tintaSuave,
                        fontSize: 12.5,
                        height: 1.35,
                      ),
                    ),
                  ],
                ),
              ),
              Icon(Icons.chevron_right_rounded, color: c.tintaSuave),
            ],
          ),
        ),
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
        // Os mesmos nomes da tela do WhatsApp (e do site).
        final (rotulo, tom) = TelaWhatsapp.qualidade(n.qualidade);
        return Cartao(
          key: const ValueKey('painel-whatsapp'),
          aoTocar: () => _abrirERelear(context, ref, const TelaWhatsapp()),
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

// ------------------------------------------------------------ indicadores

/// Contatos e modelos aprovados — dois dos indicadores do Painel do site (os
/// disparos do ciclo estão no plano; as campanhas, logo abaixo). Número só
/// aparece quando veio do servidor: "não consegui ler" nunca vira zero.
class _BlocoIndicadores extends ConsumerWidget {
  const _BlocoIndicadores();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final contatos = ref.watch(totalContatosProvider);
    final whatsapp = ref.watch(situacaoWhatsappProvider);
    final conectado = whatsapp.value?.conectado == true;
    final modelos = conectado ? ref.watch(modelosNaMetaProvider) : null;

    final bool lendoModelos;
    final String? valorModelos;
    final String apoioModelos;
    if (!whatsapp.hasValue) {
      lendoModelos = !whatsapp.hasError;
      valorModelos = null;
      apoioModelos = 'Não consegui ler agora.';
    } else if (modelos == null) {
      lendoModelos = false;
      valorModelos = null;
      apoioModelos = 'Conecte o número para ver os aprovados';
    } else if (!modelos.hasValue) {
      lendoModelos = !modelos.hasError;
      valorModelos = null;
      apoioModelos = 'Não consegui ler agora.';
    } else {
      lendoModelos = false;
      valorModelos = f.numero(
        modelos.value!.where((m) => m.status == 'aprovado').length,
      );
      apoioModelos = 'Prontos para iniciar conversa';
    }

    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Expanded(
            child: _Indicador(
              key: const ValueKey('indicador-contatos'),
              rotulo: 'Contatos',
              icone: Icons.group_outlined,
              carregando: !contatos.hasValue && !contatos.hasError,
              valor: contatos.hasValue ? f.numero(contatos.value!) : null,
              apoio: contatos.hasValue || !contatos.hasError
                  ? 'Na sua base, com autorização registrada'
                  : 'Não consegui ler agora.',
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: _Indicador(
              key: const ValueKey('indicador-modelos'),
              rotulo: 'Modelos aprovados',
              icone: Icons.verified_outlined,
              carregando: lendoModelos,
              valor: valorModelos,
              apoio: apoioModelos,
            ),
          ),
        ],
      ),
    );
  }
}

class _Indicador extends StatelessWidget {
  const _Indicador({
    super.key,
    required this.rotulo,
    required this.icone,
    required this.carregando,
    required this.valor,
    required this.apoio,
  });

  final String rotulo;
  final IconData icone;
  final bool carregando;
  final String? valor;
  final String apoio;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    // O número logo abaixo do ícone: nos dois cartões ele fica na mesma
    // altura, mesmo quando um rótulo quebra em duas linhas.
    return Cartao(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icone, size: 20, color: c.tintaSuave),
          const SizedBox(height: 8),
          if (carregando)
            const Esqueleto(altura: 28, largura: 72)
          else
            Text(
              valor ?? '—',
              style: const TextStyle(
                fontSize: 24,
                fontWeight: FontWeight.w700,
                height: 1.15,
                fontFeatures: [FontFeature.tabularFigures()],
              ),
            ),
          const SizedBox(height: 4),
          Text(
            rotulo,
            style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 2),
          Text(
            apoio,
            style: TextStyle(color: c.tintaSuave, fontSize: 12, height: 1.35),
          ),
        ],
      ),
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

/// Abre uma tela do próprio app — o plano, que já não precisa do site.
class _BotaoTela extends ConsumerWidget {
  const _BotaoTela({
    required this.chave,
    required this.rotulo,
    required this.tela,
  });

  final String chave;
  final String rotulo;
  final Widget tela;

  @override
  Widget build(BuildContext context, WidgetRef ref) => Align(
    alignment: Alignment.centerLeft,
    child: OutlinedButton(
      key: ValueKey(chave),
      style: OutlinedButton.styleFrom(minimumSize: const Size(0, 40)),
      onPressed: () => _abrirERelear(context, ref, tela),
      child: Text(rotulo),
    ),
  );
}
