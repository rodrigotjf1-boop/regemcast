import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/midia.dart';
import '../api/modelos.dart';
import 'previa_mensagem.dart';

/// O que dá para mostrar agora de uma referência de mídia.
///
/// - arquivo recém-escolhido: os bytes que já estão no aparelho (`locais`) —
///   sem baixar de volta o que acabou de subir;
/// - `midia:<uuid>`: os bytes do servidor, com a sessão (a rota é autenticada);
/// - `https://…`: o endereço, direto.
///
/// Nulo enquanto carrega ou quando não há imagem: a prévia mostra o espaço
/// reservado.
ImageProvider? imagemDaReferencia(
  WidgetRef ref,
  String? referencia, {
  Map<String, Uint8List> locais = const {},
}) {
  final r = referencia?.trim() ?? '';
  if (r.isEmpty) return null;
  final local = locais[r];
  if (local != null) return MemoryImage(local);
  final id = idDaMidia(r);
  if (id != null) {
    final bytes = ref.watch(bytesDaMidiaProvider(id)).value;
    return bytes == null ? null : MemoryImage(bytes);
  }
  if (ehEndereco(r)) return NetworkImage(r);
  return null;
}

/// A prévia de um modelo inteiro — a mesma do editor do site: cabeçalho de
/// texto ou mídia, oferta, corpo, rodapé, botões (com o "Parar promoções" do
/// marketing, que vai junto) e os cartões do carrossel.
class PreviaDoModelo extends ConsumerWidget {
  const PreviaDoModelo({
    super.key,
    required this.dados,
    this.locais = const {},
    this.comExemplos = true,
    this.escuro,
  });

  final DadosModelo dados;
  final Map<String, Uint8List> locais;

  /// Variáveis preenchidas com os exemplos (o editor) ou mostradas como
  /// `{{n}}` (o detalhe, que lista os exemplos à parte).
  final bool comExemplos;
  final bool? escuro;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final d = dados;
    final simples = !d.ehCarrossel;
    return PreviaMensagem(
      corpo: d.corpo,
      cabecalho: simples && d.cabecalhoFormato == 'TEXT'
          ? d.cabecalhoTexto
          : null,
      cabecalhoExemplo: d.cabecalhoExemplo,
      cabecalhoMidia: simples && d.cabecalhoDeMidia ? d.cabecalhoFormato : null,
      imagemCabecalho: simples && d.cabecalhoFormato == 'IMAGE'
          ? imagemDaReferencia(ref, d.cabecalhoMidia, locais: locais)
          : null,
      rodape: simples && !d.ltoAtivo ? d.rodape : null,
      oferta: simples && d.ltoAtivo ? d.ltoTexto : null,
      botoes: simples
          ? [
              for (final b in botoesComSaida(d.categoria, d.tipo, d.botoes))
                (b.tipo, b.texto),
            ]
          : const [],
      cartoes: d.ehCarrossel
          ? [
              for (final c in d.cartoes)
                CartaoPrevia(
                  corpo: c.corpo,
                  imagem: imagemDaReferencia(ref, c.imagem, locais: locais),
                  botoes: [for (final b in c.botoes) (b.tipo, b.texto)],
                ),
            ]
          : const [],
      exemplos: comExemplos ? d.corpoExemplos : null,
      escuro: escuro,
    );
  }
}
