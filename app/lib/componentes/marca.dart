import 'package:flutter/material.dart';

import '../tema/cores.dart';

/// O símbolo do Regemcast: o balão lima com o pulso de disparo.
///
/// Desenhado aqui, e não carregado de imagem, porque são dois traços — e assim
/// ele fica nítido em qualquer tamanho e pode pulsar enquanto algo carrega.
/// As coordenadas são as do `frontend/public/marca/simbolo.svg` (100×100).
class SimboloMarca extends StatelessWidget {
  const SimboloMarca({super.key, this.tamanho = 40, this.pulso = 1});

  final double tamanho;

  /// De 0 a 1: quanto do traço do pulso está desenhado. Anima a "chegada".
  final double pulso;

  @override
  Widget build(BuildContext context) => SizedBox.square(
    dimension: tamanho,
    child: CustomPaint(painter: _PintorSimbolo(pulso)),
  );
}

class _PintorSimbolo extends CustomPainter {
  _PintorSimbolo(this.pulso);

  final double pulso;

  @override
  void paint(Canvas canvas, Size size) {
    final e = size.width / 100;
    canvas.scale(e);

    final balao = Path()
      ..moveTo(26, 16)
      ..lineTo(74, 16)
      ..arcToPoint(const Offset(86, 28), radius: const Radius.circular(12))
      ..lineTo(86, 60)
      ..arcToPoint(const Offset(74, 72), radius: const Radius.circular(12))
      ..lineTo(44, 72)
      ..lineTo(28, 88)
      ..lineTo(31, 72)
      ..lineTo(26, 72)
      ..arcToPoint(const Offset(14, 60), radius: const Radius.circular(12))
      ..lineTo(14, 28)
      ..arcToPoint(const Offset(26, 16), radius: const Radius.circular(12))
      ..close();
    canvas.drawPath(balao, Paint()..color = const Color(0xFFA3E635));

    final traco = Path()
      ..moveTo(24, 48)
      ..lineTo(32, 48)
      ..lineTo(38, 38)
      ..lineTo(44, 48)
      ..lineTo(50, 30)
      ..lineTo(56, 48)
      ..lineTo(62, 40)
      ..lineTo(68, 48)
      ..lineTo(76, 48);

    final pincel = Paint()
      ..color = Colors.white
      ..style = PaintingStyle.stroke
      ..strokeWidth = 6
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;

    if (pulso >= 1) {
      canvas.drawPath(traco, pincel);
      return;
    }
    for (final m in traco.computeMetrics()) {
      canvas.drawPath(m.extractPath(0, m.length * pulso.clamp(0, 1)), pincel);
    }
  }

  @override
  bool shouldRepaint(_PintorSimbolo antigo) => antigo.pulso != pulso;
}

/// Símbolo + nome, como na barra lateral da web.
class Logotipo extends StatelessWidget {
  const Logotipo({super.key, this.tamanho = 34, this.sobreEscuro = false});

  final double tamanho;
  final bool sobreEscuro;

  @override
  Widget build(BuildContext context) {
    final cor = sobreEscuro ? Cores.lateralTinta : Cores.de(context).tinta;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        SimboloMarca(tamanho: tamanho),
        SizedBox(width: tamanho * 0.28),
        Text(
          'RegemCast',
          style: TextStyle(
            fontFamily: 'Poppins',
            fontWeight: FontWeight.w700,
            fontSize: tamanho * 0.62,
            letterSpacing: -0.4,
            color: cor,
          ),
        ),
      ],
    );
  }
}

/// O símbolo desenhando o pulso em laço — o "carregando" da marca.
///
/// Respeita "remover animações" do Android: sem animação, o símbolo fica
/// parado e inteiro, e a tela continua dizendo que está carregando.
class CarregandoMarca extends StatefulWidget {
  const CarregandoMarca({super.key, this.tamanho = 64, this.rotulo});

  final double tamanho;
  final String? rotulo;

  @override
  State<CarregandoMarca> createState() => _CarregandoMarcaState();
}

class _CarregandoMarcaState extends State<CarregandoMarca>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1400),
  );

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (MediaQuery.of(context).disableAnimations) {
      _c.value = 1;
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
  Widget build(BuildContext context) {
    return Semantics(
      label: widget.rotulo ?? 'Carregando',
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          AnimatedBuilder(
            animation: _c,
            builder: (_, _) => SimboloMarca(
              tamanho: widget.tamanho,
              pulso: Curves.easeInOutCubic.transform(_c.value),
            ),
          ),
          if (widget.rotulo != null) ...[
            const SizedBox(height: 16),
            Text(
              widget.rotulo!,
              style: TextStyle(color: Cores.de(context).tintaSuave),
            ),
          ],
        ],
      ),
    );
  }
}
