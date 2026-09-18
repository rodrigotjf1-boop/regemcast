import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../componentes/marca.dart';
import '../sessao/sessao.dart';
import '../tema/cores.dart';

/// As telas de passagem: abrindo, travado pela biometria, sem conexão. Ficam
/// juntas porque são a mesma coisa — o fundo da marca e uma frase dizendo o
/// que está acontecendo.
class _FundoDaMarca extends StatelessWidget {
  const _FundoDaMarca({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: Cores.lateral,
    body: DecoratedBox(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [Cores.lateral, Cores.lateral2],
        ),
      ),
      child: SafeArea(
        child: Center(
          child: Padding(padding: const EdgeInsets.all(28), child: child),
        ),
      ),
    ),
  );
}

class TelaAbrindo extends StatelessWidget {
  const TelaAbrindo({super.key});

  @override
  Widget build(BuildContext context) =>
      const _FundoDaMarca(child: CarregandoMarca(tamanho: 76));
}

/// Sessão guardada, biometria ligada: pede o dedo/rosto antes de mostrar.
class TelaDesbloquear extends ConsumerStatefulWidget {
  const TelaDesbloquear({super.key});

  @override
  ConsumerState<TelaDesbloquear> createState() => _TelaDesbloquearState();
}

class _TelaDesbloquearState extends ConsumerState<TelaDesbloquear> {
  bool _falhou = false;

  @override
  void initState() {
    super.initState();
    // Pede na hora: quem abriu o app quer entrar, não achar um botão.
    WidgetsBinding.instance.addPostFrameCallback((_) => _pedir());
  }

  Future<void> _pedir() async {
    final ok = await ref.read(sessaoProvider.notifier).desbloquear();
    if (!ok && mounted) setState(() => _falhou = true);
  }

  @override
  Widget build(BuildContext context) {
    final estado = ref.watch(sessaoProvider);
    final nome = estado is SessaoTravada
        ? estado.sessao.usuario.primeiroNome
        : '';
    return _FundoDaMarca(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const SimboloMarca(tamanho: 72),
          const SizedBox(height: 24),
          Text(
            nome.isEmpty ? 'Bem-vindo de volta' : 'Olá, $nome',
            style: const TextStyle(
              color: Cores.lateralTinta,
              fontSize: 24,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            _falhou
                ? 'Não deu para confirmar. Tente de novo.'
                : 'Confirme que é você para abrir o app.',
            textAlign: TextAlign.center,
            style: const TextStyle(color: Cores.lateralSuave, fontSize: 15),
          ),
          const SizedBox(height: 28),
          FilledButton.icon(
            onPressed: _pedir,
            icon: const Icon(Icons.fingerprint_rounded),
            label: const Text('Desbloquear'),
          ),
          const SizedBox(height: 8),
          TextButton(
            onPressed: () => ref.read(sessaoProvider.notifier).sair(),
            style: TextButton.styleFrom(foregroundColor: Cores.lateralSuave),
            child: const Text('Entrar com outra conta'),
          ),
        ],
      ),
    );
  }
}

/// Tem sessão guardada, mas o servidor não respondeu. A sessão NÃO é apagada.
class TelaSemConexao extends ConsumerWidget {
  const TelaSemConexao({super.key, required this.mensagem});

  final String mensagem;

  @override
  Widget build(BuildContext context, WidgetRef ref) => _FundoDaMarca(
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        const Icon(Icons.wifi_off_rounded, color: Cores.lateralSuave, size: 56),
        const SizedBox(height: 20),
        const Text(
          'Sem conexão',
          style: TextStyle(
            color: Cores.lateralTinta,
            fontSize: 24,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 8),
        Text(
          mensagem,
          textAlign: TextAlign.center,
          style: const TextStyle(color: Cores.lateralSuave, height: 1.4),
        ),
        const SizedBox(height: 28),
        FilledButton.icon(
          onPressed: () => ref.read(sessaoProvider.notifier).iniciar(),
          icon: const Icon(Icons.refresh_rounded),
          label: const Text('Tentar de novo'),
        ),
      ],
    ),
  );
}
