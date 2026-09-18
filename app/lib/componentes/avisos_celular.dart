import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/erro_api.dart';
import '../push/push.dart';
import '../tema/cores.dart';
import 'basicos.dart';
import 'dialogos.dart';

/// Quais avisos este celular recebe. A escolha é por aparelho: dá para
/// receber tudo no celular do trabalho e só cobrança no pessoal.
class AvisosCelular extends ConsumerStatefulWidget {
  const AvisosCelular({super.key, required this.aoPermitir});

  /// Pede a permissão de novo e registra o aparelho.
  final Future<void> Function() aoPermitir;

  @override
  ConsumerState<AvisosCelular> createState() => _AvisosCelularState();
}

class _AvisosCelularState extends ConsumerState<AvisosCelular> {
  String? _mudando;

  Future<void> _mudar(String tipo, bool ligado) async {
    setState(() => _mudando = tipo);
    try {
      await ref.read(servicoPushProvider).definir(tipo, ligado);
      ref.invalidate(preferenciasAvisoProvider);
      await ref.read(preferenciasAvisoProvider.future);
    } catch (e) {
      if (mounted) avisar(context, mensagemDoErro(e));
    } finally {
      if (mounted) setState(() => _mudando = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final carga = ref.watch(preferenciasAvisoProvider);

    Widget linha(String tipo, String titulo, String texto, bool valor) =>
        SwitchListTile(
          value: valor,
          activeThumbColor: c.acentoContraste,
          activeTrackColor: c.acento,
          title: Text(
            titulo,
            style: const TextStyle(fontWeight: FontWeight.w600),
          ),
          subtitle: Text(
            texto,
            style: TextStyle(color: c.tintaSuave, fontSize: 13),
          ),
          onChanged: _mudando != null ? null : (v) => _mudar(tipo, v),
        );

    return Cartao(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 6),
      child: carga.when(
        loading: () => const Padding(
          padding: EdgeInsets.all(12),
          child: Esqueleto(altura: 60),
        ),
        error: (_, _) => const SizedBox.shrink(),
        data: (p) => p == null
            ? ListTile(
                leading: const Icon(Icons.notifications_off_outlined),
                title: const Text(
                  'Avisos desligados neste celular',
                  style: TextStyle(fontWeight: FontWeight.w600),
                ),
                subtitle: Text(
                  'Permita as notificações para saber quando uma campanha termina ou para, e quando a Meta responde sobre um modelo.',
                  style: TextStyle(color: c.tintaSuave, fontSize: 13),
                ),
                trailing: TextButton(
                  onPressed: () async {
                    await widget.aoPermitir();
                    ref.invalidate(preferenciasAvisoProvider);
                  },
                  child: const Text('Permitir'),
                ),
              )
            : Column(
                children: [
                  linha(
                    'campanhas',
                    'Campanhas',
                    'Terminou, ou parou por conexão, plano ou pagamento.',
                    p.campanhas,
                  ),
                  linha(
                    'modelos',
                    'Modelos',
                    'A Meta aprovou, recusou ou pausou um modelo.',
                    p.modelos,
                  ),
                  linha(
                    'cobranca',
                    'Pagamento',
                    'Cobrança do plano recusada. Só chega para o dono.',
                    p.cobranca,
                  ),
                ],
              ),
      ),
    );
  }
}
