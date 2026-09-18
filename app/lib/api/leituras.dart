import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../sessao/sessao.dart';
import 'dados.dart';

/// As leituras que as telas usam, uma por bloco.
///
/// Separadas de propósito, como na web: se a Meta estiver fora do ar, o bloco
/// do WhatsApp mostra o erro e o consumo do plano — que não depende dela —
/// continua aparecendo. Uma leitura só derrubaria a tela inteira por um cartão.
///
/// `autoDispose`: saiu da tela, esquece. Voltar relê do servidor, e o número
/// que aparece é sempre o de agora.

final resumoContaProvider = FutureProvider.autoDispose<ResumoConta>((
  ref,
) async {
  final dados = await ref.read(clienteApiProvider).get('/conta');
  return ResumoConta.deJson(dados as Map<String, dynamic>);
});

final situacaoWhatsappProvider = FutureProvider.autoDispose<SituacaoWhatsapp>((
  ref,
) async {
  final dados = await ref.read(clienteApiProvider).get('/whatsapp/situacao');
  return SituacaoWhatsapp.deJson(dados as Map<String, dynamic>);
});

final campanhasProvider = FutureProvider.autoDispose<List<ResumoCampanha>>((
  ref,
) async {
  final dados = await ref.read(clienteApiProvider).get('/campanhas');
  return (dados as List)
      .whereType<Map<String, dynamic>>()
      .map(ResumoCampanha.deJson)
      .toList();
});
