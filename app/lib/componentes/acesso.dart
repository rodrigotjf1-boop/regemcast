import 'package:flutter/material.dart';

import '../tema/cores.dart';
import 'basicos.dart';
import 'marca.dart';

/// O molde das telas de quem ainda não entrou — entrar, recuperar a senha e
/// a lista de espera —, como o `LayoutAcesso` do site: o topo escuro da marca
/// e, embaixo, o cartão com o formulário.
class MoldeDeAcesso extends StatelessWidget {
  const MoldeDeAcesso({
    super.key,
    required this.titulo,
    required this.texto,
    required this.child,
    this.podeVoltar = false,
  });

  /// A frase grande do topo.
  final String titulo;
  final String texto;
  final Widget child;

  /// Tela aberta por cima da entrada: mostra a seta de voltar.
  final bool podeVoltar;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    return Scaffold(
      backgroundColor: c.fundo,
      body: CustomScrollView(
        slivers: [
          SliverToBoxAdapter(
            child: _Topo(titulo: titulo, texto: texto, podeVoltar: podeVoltar),
          ),
          SliverPadding(
            padding: respiroDaTela(context, topo: 20, fim: 32),
            sliver: SliverToBoxAdapter(
              child: Cartao(padding: const EdgeInsets.all(22), child: child),
            ),
          ),
        ],
      ),
    );
  }
}

/// O topo escuro da marca, como o lado esquerdo da entrada na web.
class _Topo extends StatelessWidget {
  const _Topo({
    required this.titulo,
    required this.texto,
    required this.podeVoltar,
  });

  final String titulo;
  final String texto;
  final bool podeVoltar;

  @override
  Widget build(BuildContext context) {
    final topo = MediaQuery.of(context).padding.top;
    return Container(
      padding: EdgeInsets.fromLTRB(24, topo + (podeVoltar ? 8 : 28), 24, 36),
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Cores.lateral, Cores.lateral2],
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (podeVoltar) ...[
            Transform.translate(
              offset: const Offset(-12, 0),
              child: IconButton(
                key: const ValueKey('voltar-acesso'),
                tooltip: 'Voltar',
                icon: const Icon(
                  Icons.arrow_back_rounded,
                  color: Cores.lateralTinta,
                ),
                onPressed: () => Navigator.of(context).maybePop(),
              ),
            ),
            const SizedBox(height: 8),
          ],
          const Logotipo(sobreEscuro: true, tamanho: 36),
          const SizedBox(height: 28),
          Text(
            'INTEGRAÇÃO VIA API OFICIAL DO WHATSAPP BUSINESS',
            style: TextStyle(
              color: const Color(0xFFA3E635).withValues(alpha: 0.95),
              fontSize: 11,
              letterSpacing: 1.4,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 10),
          Text(
            titulo,
            style: const TextStyle(
              color: Cores.lateralTinta,
              fontSize: 28,
              fontWeight: FontWeight.w700,
              height: 1.15,
              letterSpacing: -0.5,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            texto,
            style: const TextStyle(
              color: Cores.lateralSuave,
              fontSize: 15,
              height: 1.4,
            ),
          ),
        ],
      ),
    );
  }
}

/// O título e o texto de cada passo, dentro do cartão.
class CabecalhoDoCartao extends StatelessWidget {
  const CabecalhoDoCartao({
    super.key,
    required this.titulo,
    this.texto,
    this.icone,
  });

  final String titulo;
  final String? texto;
  final IconData? icone;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            if (icone != null) ...[
              Icon(icone, color: c.tinta),
              const SizedBox(width: 10),
            ],
            Expanded(
              child: Text(
                titulo,
                style: Theme.of(context).textTheme.titleMedium,
              ),
            ),
          ],
        ),
        if (texto != null) ...[
          const SizedBox(height: 8),
          Text(texto!, style: TextStyle(color: c.tintaSuave, height: 1.45)),
        ],
      ],
    );
  }
}

/// O botão principal com o "girando" enquanto o pedido está no ar.
class BotaoDeAcesso extends StatelessWidget {
  const BotaoDeAcesso({
    super.key,
    required this.rotulo,
    required this.ocupado,
    required this.aoTocar,
  });

  final String rotulo;
  final bool ocupado;
  final VoidCallback aoTocar;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    return FilledButton(
      onPressed: ocupado ? null : aoTocar,
      child: ocupado
          ? SizedBox.square(
              dimension: 22,
              child: CircularProgressIndicator(
                strokeWidth: 2.5,
                color: c.acentoContraste,
              ),
            )
          : Text(rotulo),
    );
  }
}
