import 'package:flutter/material.dart';

import 'cores.dart';

/// O tema do app, montado a partir das cores da marca.
///
/// Material 3 como base, mas com as NOSSAS cores em cada papel — o esquema
/// gerado automaticamente a partir do lima daria verdes que a marca não usa.
ThemeData temaDoApp(Brightness brilho) {
  final c = brilho == Brightness.dark ? Cores.escuro : Cores.claro;

  final esquema = ColorScheme(
    brightness: brilho,
    primary: c.acento,
    onPrimary: c.acentoContraste,
    primaryContainer: c.acentoSuave,
    onPrimaryContainer: c.tinta,
    secondary: c.realce,
    onSecondary: const Color(0xFF231632),
    error: c.erro,
    onError: brilho == Brightness.dark ? const Color(0xFF231632) : Colors.white,
    surface: c.superficie,
    onSurface: c.tinta,
    onSurfaceVariant: c.tintaSuave,
    surfaceContainerHighest: c.superficie2,
    outline: c.borda,
    outlineVariant: c.borda,
  );

  final base = ThemeData(
    useMaterial3: true,
    colorScheme: esquema,
    brightness: brilho,
    fontFamily: 'Poppins',
    scaffoldBackgroundColor: c.fundo,
    splashFactory: InkSparkle.splashFactory,
  );

  final texto = base.textTheme.apply(bodyColor: c.tinta, displayColor: c.tinta);

  return base.copyWith(
    textTheme: texto.copyWith(
      headlineSmall: texto.headlineSmall?.copyWith(
        fontWeight: FontWeight.w700,
        letterSpacing: -0.3,
      ),
      titleLarge: texto.titleLarge?.copyWith(
        fontWeight: FontWeight.w600,
        letterSpacing: -0.2,
      ),
      titleMedium: texto.titleMedium?.copyWith(fontWeight: FontWeight.w600),
      labelSmall: texto.labelSmall?.copyWith(
        letterSpacing: 1.1,
        fontWeight: FontWeight.w600,
      ),
    ),
    appBarTheme: AppBarTheme(
      backgroundColor: c.fundo,
      foregroundColor: c.tinta,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      centerTitle: false,
      titleTextStyle: TextStyle(
        fontFamily: 'Poppins',
        fontSize: 20,
        fontWeight: FontWeight.w600,
        color: c.tinta,
      ),
    ),
    cardTheme: CardThemeData(
      color: c.superficie,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(18),
        side: BorderSide(color: c.borda),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: c.acento,
        foregroundColor: c.acentoContraste,
        disabledBackgroundColor: c.acento.withValues(alpha: 0.4),
        minimumSize: const Size.fromHeight(52),
        textStyle: const TextStyle(
          fontFamily: 'Poppins',
          fontSize: 16,
          fontWeight: FontWeight.w600,
        ),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: c.tinta,
        side: BorderSide(color: c.borda),
        minimumSize: const Size.fromHeight(48),
        textStyle: const TextStyle(
          fontFamily: 'Poppins',
          fontSize: 15,
          fontWeight: FontWeight.w600,
        ),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: c.acentoForte,
        textStyle: const TextStyle(
          fontFamily: 'Poppins',
          fontWeight: FontWeight.w600,
        ),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: c.superficie,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: BorderSide(color: c.borda),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: BorderSide(color: c.borda),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: BorderSide(
          color: brilho == Brightness.dark ? c.acento : c.tinta,
          width: 2,
        ),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: BorderSide(color: c.erro),
      ),
      labelStyle: TextStyle(color: c.tintaSuave),
      hintStyle: TextStyle(color: c.tintaSuave.withValues(alpha: 0.7)),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: c.superficie,
      surfaceTintColor: Colors.transparent,
      indicatorColor: c.acento,
      height: 68,
      labelTextStyle: WidgetStateProperty.resolveWith(
        (estados) => TextStyle(
          fontFamily: 'Poppins',
          fontSize: 12,
          fontWeight: estados.contains(WidgetState.selected)
              ? FontWeight.w600
              : FontWeight.w500,
          color: estados.contains(WidgetState.selected)
              ? c.tinta
              : c.tintaSuave,
        ),
      ),
      iconTheme: WidgetStateProperty.resolveWith(
        (estados) => IconThemeData(
          color: estados.contains(WidgetState.selected)
              ? c.acentoContraste
              : c.tintaSuave,
        ),
      ),
    ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: Cores.lateral,
      contentTextStyle: const TextStyle(
        fontFamily: 'Poppins',
        color: Cores.lateralTinta,
      ),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    ),
    dividerTheme: DividerThemeData(color: c.borda, space: 1),
    progressIndicatorTheme: ProgressIndicatorThemeData(
      color: c.acento,
      linearTrackColor: c.superficie2,
    ),
  );
}
