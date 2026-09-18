import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/date_symbol_data_local.dart';

import 'push/push.dart';
import 'sessao/sessao.dart';
import 'telas/casca.dart';
import 'telas/entrar.dart';
import 'telas/portas.dart';
import 'tema/tema.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Datas e números em português: "17/10/2026", "5.000".
  await initializeDateFormatting('pt_BR');
  // Retrato: as listas e o anel de consumo foram desenhados para ele.
  await SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]);
  runApp(const ProviderScope(child: AppRegemCast()));
}

class AppRegemCast extends StatelessWidget {
  const AppRegemCast({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'RegemCast',
      debugShowCheckedModeBanner: false,
      theme: temaDoApp(Brightness.light),
      darkTheme: temaDoApp(Brightness.dark),
      themeMode: ThemeMode.system,
      locale: const Locale('pt', 'BR'),
      supportedLocales: const [Locale('pt', 'BR')],
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      home: const _Raiz(),
    );
  }
}

/// Uma tela por estado da sessão. Nada de rota para "voltar" ao login: sair
/// troca a raiz, e o botão voltar do Android não reabre a conta de ninguém.
class _Raiz extends ConsumerWidget {
  const _Raiz();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    ref.listen(sessaoProvider, (antes, agora) {
      if (antes is SessaoAtiva && agora is SessaoAusente) {
        ref.read(servicoPushProvider).desativar(avisarServidor: false);
      }
    });
    final estado = ref.watch(sessaoProvider);
    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 280),
      child: switch (estado) {
        SessaoIniciando() => const TelaAbrindo(key: ValueKey('abrindo')),
        SessaoAusente(:final aviso) => TelaEntrar(
          key: const ValueKey('entrar'),
          aviso: aviso,
        ),
        SessaoTravada() => const TelaDesbloquear(key: ValueKey('travada')),
        SessaoSemConexao(:final mensagem) => TelaSemConexao(
          key: const ValueKey('sem-conexao'),
          mensagem: mensagem,
        ),
        SessaoAtiva() => const Casca(key: ValueKey('casca')),
      },
    );
  }
}
