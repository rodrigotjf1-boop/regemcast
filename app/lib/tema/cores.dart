import 'package:flutter/material.dart';

/// As cores do RegemCast — as MESMAS da web (`frontend/src/app/globals.css`).
///
/// Duas regras da marca que valem aqui também:
///
/// - **Lima é preenchimento, nunca texto** sobre fundo claro: lima em texto
///   claro não lê. Sobre lima, o texto é sempre ameixa.
/// - O escuro não é o claro invertido: cada tom foi escolhido para manter o
///   contraste (os números nos comentários são a razão de contraste).
class Cores {
  const Cores._({
    required this.fundo,
    required this.superficie,
    required this.superficie2,
    required this.tinta,
    required this.tintaSuave,
    required this.borda,
    required this.acento,
    required this.acentoForte,
    required this.acentoSuave,
    required this.acentoContraste,
    required this.realce,
    required this.sucesso,
    required this.atencao,
    required this.erro,
  });

  final Color fundo;
  final Color superficie;
  final Color superficie2;
  final Color tinta;
  final Color tintaSuave;
  final Color borda;

  /// Lima. Só preenchimento.
  final Color acento;

  /// Texto e link de destaque: ameixa no claro, lima no escuro (11,6:1).
  final Color acentoForte;
  final Color acentoSuave;

  /// Texto sobre o lima: sempre ameixa (11,3:1).
  final Color acentoContraste;
  final Color realce;
  final Color sucesso;
  final Color atencao;
  final Color erro;

  static const claro = Cores._(
    fundo: Color(0xFFF8F5F2),
    superficie: Color(0xFFFFFFFF),
    superficie2: Color(0xFFF3EFEB),
    tinta: Color(0xFF231632),
    tintaSuave: Color(0xFF6A5F76), // 5,5:1 no fundo
    borda: Color(0xFFE5DFE8),
    acento: Color(0xFFA3E635),
    acentoForte: Color(0xFF231632),
    acentoSuave: Color(0xFFEEF8DB),
    acentoContraste: Color(0xFF231632),
    realce: Color(0xFFFFD166),
    sucesso: Color(0xFF15803D),
    atencao: Color(0xFF8A5A00),
    erro: Color(0xFFB3261E),
  );

  static const escuro = Cores._(
    fundo: Color(0xFF140E1B),
    superficie: Color(0xFF1E1628),
    superficie2: Color(0xFF271D33),
    tinta: Color(0xFFF2EEF6), // 16,5:1
    tintaSuave: Color(0xFFA89EB4), // 6,8:1 na superfície
    borda: Color(0xFF352A44),
    acento: Color(0xFFA3E635),
    acentoForte: Color(0xFFA3E635),
    acentoSuave: Color(0xFF2B213A),
    acentoContraste: Color(0xFF231632),
    realce: Color(0xFFFFD166),
    sucesso: Color(0xFF86EFAC),
    atencao: Color(0xFFFFD166),
    erro: Color(0xFFFCA5A5),
  );

  /// A barra lateral da web: o escuro da marca, igual nos dois temas.
  static const lateral = Color(0xFF180F22);
  static const lateral2 = Color(0xFF241832);
  static const lateralTinta = Color(0xFFF2EEF6);
  static const lateralSuave = Color(0xFFB0A6BE);

  static Cores de(BuildContext context) =>
      Theme.of(context).brightness == Brightness.dark ? escuro : claro;
}
