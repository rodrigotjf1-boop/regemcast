import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../tema/cores.dart';

/// O cartão do app: superfície, borda fina e canto de 18 — como os da web.
class Cartao extends StatelessWidget {
  const Cartao({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(18),
    this.aoTocar,
    this.destaque = false,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final VoidCallback? aoTocar;

  /// Borda lima: o cartão que pede atenção agora.
  final bool destaque;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final conteudo = Padding(padding: padding, child: child);
    return Material(
      color: c.superficie,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(18),
        side: BorderSide(
          color: destaque ? c.acento : c.borda,
          width: destaque ? 1.5 : 1,
        ),
      ),
      clipBehavior: Clip.antiAlias,
      child: aoTocar == null
          ? conteudo
          : InkWell(onTap: aoTocar, child: conteudo),
    );
  }
}

enum TomPilula { neutro, sucesso, atencao, erro, acento }

/// A pílula de situação: cor E texto, nunca só cor (daltonismo, tela ao sol).
class Pilula extends StatelessWidget {
  const Pilula(
    this.texto, {
    super.key,
    this.tom = TomPilula.neutro,
    this.ponto = true,
    this.vivo = false,
  });

  final String texto;
  final TomPilula tom;
  final bool ponto;

  /// O ponto pulsa: algo está acontecendo agora.
  final bool vivo;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final escuro = Theme.of(context).brightness == Brightness.dark;
    final (fundo, frente) = switch (tom) {
      TomPilula.sucesso => (
        c.sucesso.withValues(alpha: escuro ? 0.18 : 0.12),
        c.sucesso,
      ),
      TomPilula.atencao => (
        c.realce.withValues(alpha: escuro ? 0.18 : 0.35),
        escuro ? c.realce : c.atencao,
      ),
      TomPilula.erro => (c.erro.withValues(alpha: escuro ? 0.18 : 0.1), c.erro),
      TomPilula.acento => (c.acento, c.acentoContraste),
      TomPilula.neutro => (c.superficie2, c.tintaSuave),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: fundo,
        borderRadius: BorderRadius.circular(99),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (ponto) ...[
            vivo ? _PontoVivo(cor: frente) : _Ponto(cor: frente),
            const SizedBox(width: 6),
          ],
          Flexible(
            child: Text(
              texto,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: frente,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Ponto extends StatelessWidget {
  const _Ponto({required this.cor});
  final Color cor;

  @override
  Widget build(BuildContext context) => Container(
    width: 7,
    height: 7,
    decoration: BoxDecoration(color: cor, shape: BoxShape.circle),
  );
}

class _PontoVivo extends StatefulWidget {
  const _PontoVivo({required this.cor});
  final Color cor;

  @override
  State<_PontoVivo> createState() => _PontoVivoState();
}

class _PontoVivoState extends State<_PontoVivo>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1200),
  );

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (MediaQuery.of(context).disableAnimations) {
      _c.stop();
    } else if (!_c.isAnimating) {
      _c.repeat();
    }
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => SizedBox.square(
    dimension: 7,
    child: AnimatedBuilder(
      animation: _c,
      builder: (_, _) => Stack(
        clipBehavior: Clip.none,
        alignment: Alignment.center,
        children: [
          Transform.scale(
            scale: 1 + _c.value * 1.6,
            child: Container(
              decoration: BoxDecoration(
                color: widget.cor.withValues(alpha: 0.45 * (1 - _c.value)),
                shape: BoxShape.circle,
              ),
            ),
          ),
          Container(
            decoration: BoxDecoration(
              color: widget.cor,
              shape: BoxShape.circle,
            ),
          ),
        ],
      ),
    ),
  );
}

/// O anel de consumo do plano: a cor muda ANTES de estourar.
class AnelUso extends StatelessWidget {
  const AnelUso({
    super.key,
    required this.fracao,
    this.tamanho = 132,
    required this.centro,
  });

  /// De 0 a 1. Nulo = sem teto.
  final double? fracao;
  final double tamanho;
  final Widget centro;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final f = fracao ?? 0;
    final cor = f >= 0.9 ? c.erro : (f >= 0.75 ? c.realce : c.acento);
    final animar = !MediaQuery.of(context).disableAnimations;
    return SizedBox.square(
      dimension: tamanho,
      child: TweenAnimationBuilder<double>(
        tween: Tween(begin: animar ? 0 : f, end: f),
        duration: const Duration(milliseconds: 900),
        curve: Curves.easeOutCubic,
        builder: (_, valor, filho) => CustomPaint(
          painter: _PintorAnel(valor, cor, c.superficie2),
          child: Center(child: filho),
        ),
        child: centro,
      ),
    );
  }
}

class _PintorAnel extends CustomPainter {
  _PintorAnel(this.fracao, this.cor, this.trilho);

  final double fracao;
  final Color cor;
  final Color trilho;

  @override
  void paint(Canvas canvas, Size size) {
    const espessura = 12.0;
    final rect = Offset.zero & size;
    final area = rect.deflate(espessura / 2);
    final base = Paint()
      ..color = trilho
      ..style = PaintingStyle.stroke
      ..strokeWidth = espessura;
    canvas.drawArc(area, 0, math.pi * 2, false, base);
    if (fracao <= 0) return;
    final arco = Paint()
      ..color = cor
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round
      ..strokeWidth = espessura;
    canvas.drawArc(area, -math.pi / 2, math.pi * 2 * fracao, false, arco);
  }

  @override
  bool shouldRepaint(_PintorAnel antigo) =>
      antigo.fracao != fracao || antigo.cor != cor;
}

/// "Não consegui carregar" + o motivo + tentar de novo. Nunca uma lista vazia
/// no lugar do erro: vazio é uma afirmação sobre os dados, e ela seria falsa.
class EstadoErro extends StatelessWidget {
  const EstadoErro({
    super.key,
    required this.titulo,
    required this.mensagem,
    required this.aoTentar,
  });

  final String titulo;
  final String mensagem;
  final VoidCallback aoTentar;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    return Cartao(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.error_outline_rounded, color: c.erro),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  titulo,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(mensagem, style: TextStyle(color: c.tintaSuave, height: 1.4)),
          const SizedBox(height: 14),
          OutlinedButton.icon(
            onPressed: aoTentar,
            icon: const Icon(Icons.refresh_rounded),
            label: const Text('Tentar de novo'),
          ),
        ],
      ),
    );
  }
}

/// Bloco cinza que respira enquanto o dado chega — mesmo formato do que vem.
class Esqueleto extends StatefulWidget {
  const Esqueleto({
    super.key,
    this.altura = 16,
    this.largura = double.infinity,
    this.raio = 10,
  });

  final double altura;
  final double largura;
  final double raio;

  @override
  State<Esqueleto> createState() => _EsqueletoState();
}

class _EsqueletoState extends State<Esqueleto>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1100),
  );

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (MediaQuery.of(context).disableAnimations) {
      _c.value = 0.5;
      _c.stop();
    } else if (!_c.isAnimating) {
      _c.repeat(reverse: true);
    }
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    return AnimatedBuilder(
      animation: _c,
      builder: (_, _) => Container(
        height: widget.altura,
        width: widget.largura,
        decoration: BoxDecoration(
          color: Color.lerp(c.superficie2, c.borda, _c.value),
          borderRadius: BorderRadius.circular(widget.raio),
        ),
      ),
    );
  }
}

/// Faixa de aviso: fundo suave, ícone e texto. Para o que pede ação.
class Aviso extends StatelessWidget {
  const Aviso({
    super.key,
    required this.texto,
    this.tom = TomPilula.atencao,
    this.icone,
    this.acao,
  });

  final String texto;
  final TomPilula tom;
  final IconData? icone;
  final Widget? acao;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final escuro = Theme.of(context).brightness == Brightness.dark;
    final (fundo, frente) = switch (tom) {
      TomPilula.erro => (
        c.erro.withValues(alpha: escuro ? 0.16 : 0.08),
        c.erro,
      ),
      TomPilula.sucesso => (
        c.sucesso.withValues(alpha: escuro ? 0.16 : 0.08),
        c.sucesso,
      ),
      TomPilula.acento => (c.acentoSuave, c.tinta),
      _ => (
        c.realce.withValues(alpha: escuro ? 0.14 : 0.28),
        escuro ? c.realce : c.atencao,
      ),
    };
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: fundo,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(
                icone ?? Icons.info_outline_rounded,
                size: 20,
                color: frente,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  texto,
                  style: TextStyle(color: frente, height: 1.4, fontSize: 14),
                ),
              ),
            ],
          ),
          if (acao != null) ...[const SizedBox(height: 10), acao!],
        ],
      ),
    );
  }
}

/// O respiro de uma tela que rola: o de sempre MAIS a barra de navegação do
/// Android (ERR-030).
///
/// Desde o Android 15 o app desenha por trás das barras do sistema
/// (edge-to-edge), e um respiro fixo deixa o fim da tela atrás dos botões do
/// Android — com os três botões, a barra tem uns 48 pontos; o respiro, 28.
/// Num Scaffold com barra de baixo (as abas, um botão fixo embaixo), o
/// Scaffold já descontou a barra do sistema e a soma é zero.
EdgeInsets respiroDaTela(
  BuildContext context, {
  double lados = 20,
  double topo = 8,
  double fim = 28,
}) => EdgeInsets.fromLTRB(
  lados,
  topo,
  lados,
  fim + MediaQuery.paddingOf(context).bottom,
);
