import 'package:flutter/material.dart';

import '../tema/cores.dart';

/// Pergunta antes de uma ação que não se desfaz. `true` = confirmou.
Future<bool> confirmar(
  BuildContext context, {
  required String titulo,
  required String texto,
  required String botao,
  bool perigo = false,
}) async {
  final c = Cores.de(context);
  final ok = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      backgroundColor: c.superficie,
      title: Text(titulo),
      content: Text(texto, style: TextStyle(color: c.tintaSuave, height: 1.45)),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(ctx, false),
          child: const Text('Voltar'),
        ),
        FilledButton(
          style: FilledButton.styleFrom(
            minimumSize: const Size(0, 44),
            backgroundColor: perigo ? c.erro : null,
            foregroundColor: perigo
                ? (Theme.of(ctx).brightness == Brightness.dark
                      ? const Color(0xFF231632)
                      : Colors.white)
                : null,
          ),
          onPressed: () => Navigator.pop(ctx, true),
          child: Text(botao),
        ),
      ],
    ),
  );
  return ok == true;
}

/// Mostra o resultado de uma ação. O aviso novo toma o lugar do que estiver
/// na tela — como no site, onde o aviso é um só: em fila, quem faz duas ações
/// seguidas leria por segundos o resultado da anterior.
void avisar(BuildContext context, String texto) => ScaffoldMessenger.of(context)
  ..hideCurrentSnackBar()
  ..showSnackBar(SnackBar(content: Text(texto)));
