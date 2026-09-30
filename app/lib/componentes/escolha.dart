import 'package:flutter/material.dart';

import '../tema/cores.dart';
import 'dialogos.dart';

/// Uma opção de um [CampoDeEscolha].
class OpcaoDeEscolha<T> {
  const OpcaoDeEscolha({
    required this.valor,
    required this.texto,
    this.detalhe,
  });

  final T valor;
  final String texto;

  /// Uma segunda linha, menor ("250 contatos · ainda não usado").
  final String? detalhe;
}

/// Um grupo de opções, com título ("Listas", "Blocos — Base de setembro").
class GrupoDeEscolha<T> {
  const GrupoDeEscolha(this.titulo, this.opcoes);

  final String? titulo;
  final List<OpcaoDeEscolha<T>> opcoes;
}

/// Campo que abre uma folha com as opções agrupadas — o `<select>` com
/// `<optgroup>` do site, no tamanho do celular.
///
/// Rótulo longo ("Bloco 03 · 250 contatos · já enviado em 21/09/2026") não
/// cabe num menu suspenso de celular; na folha ele quebra linha e o grupo
/// aparece como título.
class CampoDeEscolha<T> extends StatelessWidget {
  const CampoDeEscolha({
    super.key,
    required this.rotulo,
    required this.grupos,
    required this.valor,
    required this.aoEscolher,
    this.vazio = 'Escolha…',
    this.carregando = false,
    this.habilitado = true,
    this.ajuda,
  });

  final String rotulo;
  final List<GrupoDeEscolha<T>> grupos;
  final T? valor;
  final ValueChanged<T> aoEscolher;
  final String vazio;
  final bool carregando;
  final bool habilitado;
  final String? ajuda;

  OpcaoDeEscolha<T>? get _escolhida {
    for (final g in grupos) {
      for (final o in g.opcoes) {
        if (o.valor == valor) return o;
      }
    }
    return null;
  }

  Future<void> _abrir(BuildContext context) async {
    final c = Cores.de(context);
    final escolhido = await abrirFolha<_Escolhido<T>>(
      context,
      alca: false,
      forma: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
      ),
      builder: (ctx) => ConstrainedBox(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.of(ctx).size.height * 0.8,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const SizedBox(height: 10),
            Center(
              child: Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: c.borda,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 14, 20, 6),
              child: Text(rotulo, style: Theme.of(ctx).textTheme.titleMedium),
            ),
            Flexible(
              child: ListView(
                shrinkWrap: true,
                padding: const EdgeInsets.only(bottom: 16),
                children: [
                  for (final g in grupos) ...[
                    if (g.titulo != null)
                      Padding(
                        padding: const EdgeInsets.fromLTRB(20, 14, 20, 4),
                        child: Text(
                          g.titulo!.toUpperCase(),
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
                            letterSpacing: 0.6,
                            color: c.tintaSuave,
                          ),
                        ),
                      ),
                    for (final o in g.opcoes)
                      ListTile(
                        title: Text(o.texto),
                        subtitle: o.detalhe == null
                            ? null
                            : Text(
                                o.detalhe!,
                                style: TextStyle(
                                  color: c.tintaSuave,
                                  fontSize: 12.5,
                                ),
                              ),
                        trailing: o.valor == valor
                            ? Icon(Icons.check_rounded, color: c.tinta)
                            : null,
                        selected: o.valor == valor,
                        onTap: () => Navigator.pop(ctx, _Escolhido(o.valor)),
                      ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
    if (escolhido != null) aoEscolher(escolhido.valor);
  }

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final escolhida = _escolhida;
    final ativo = habilitado && !carregando;
    return Semantics(
      button: true,
      enabled: ativo,
      child: InkWell(
        onTap: ativo ? () => _abrir(context) : null,
        borderRadius: BorderRadius.circular(14),
        child: InputDecorator(
          isEmpty: false,
          decoration: InputDecoration(
            labelText: rotulo,
            helperText: ajuda,
            helperMaxLines: 3,
            enabled: ativo,
            suffixIcon: carregando
                ? const Padding(
                    padding: EdgeInsets.all(14),
                    child: SizedBox.square(
                      dimension: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                  )
                : const Icon(Icons.expand_more_rounded),
          ),
          child: Text(
            escolhida?.texto ?? (carregando ? 'Carregando…' : vazio),
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: 16,
              color: escolhida == null ? c.tintaSuave : c.tinta,
            ),
          ),
        ),
      ),
    );
  }
}

/// O que a folha devolve: distingue "escolheu nulo" de "fechou sem escolher".
class _Escolhido<T> {
  const _Escolhido(this.valor);
  final T valor;
}
