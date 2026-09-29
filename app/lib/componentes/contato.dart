import 'package:flutter/material.dart';

import '../tema/cores.dart';
import '../util/formato.dart' as f;

/// Peças das telas de contatos — as mesmas regras de
/// `frontend/src/app/(app)/contatos/page.tsx` e dos componentes de públicos.

/// Como o consentimento foi obtido, em palavras que o cliente entende.
String? origemDoConsentimento(String? origem) => switch (origem) {
  'declarado' => 'Declarado na importação',
  'formulario' => 'Formulário',
  'conversa' => 'Conversa iniciada pela pessoa',
  'api' => 'Sistema do cliente',
  _ => null,
};

/// Por onde a pessoa saiu.
String comoSaiu(String? origem) => switch (origem) {
  'botao_modelo' => 'Tocou em "Parar promoções"',
  'preferencia_whatsapp' => 'Parou o marketing pelo WhatsApp',
  'mensagem' => 'Respondeu pedindo para sair',
  'painel' => 'Descadastrado no painel',
  'cardapioweb' => 'Desligou o WhatsApp no Cardápio Web',
  'pedido_exclusao' => 'Pediu a exclusão dos dados',
  null || '' => 'Não informado',
  _ => origem,
};

/// "AB" de "Ana Beatriz Souza"; "#" sem nome.
String iniciais(String? nome) {
  final partes = (nome ?? '')
      .trim()
      .split(RegExp(r'\s+'))
      .where((p) => p.isNotEmpty)
      .toList();
  if (partes.isEmpty) return '#';
  if (partes.length == 1) {
    final p = partes.first;
    return (p.length > 1 ? p.substring(0, 2) : p).toUpperCase();
  }
  return (partes.first[0] + partes.last[0]).toUpperCase();
}

/// O círculo com as iniciais. A cor sai do telefone: a mesma pessoa tem
/// sempre a mesma cor.
class AvatarContato extends StatelessWidget {
  const AvatarContato({super.key, required this.nome, required this.telefone});

  final String? nome;
  final String telefone;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final soma = telefone.codeUnits.fold<int>(0, (t, u) => t + u);
    final (fundo, frente) = switch (soma % 4) {
      0 => (c.acento, c.acentoContraste),
      1 => (c.realce, const Color(0xFF231632)),
      2 => (c.tinta, c.superficie),
      _ => (c.acentoSuave, c.acentoForte),
    };
    return ExcludeSemantics(
      child: Container(
        width: 36,
        height: 36,
        alignment: Alignment.center,
        decoration: BoxDecoration(color: fundo, shape: BoxShape.circle),
        child: Text(
          iniciais(nome),
          style: TextStyle(
            color: frente,
            fontSize: 12,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
    );
  }
}

/// A cor de cada perfil: verde para quem está bem, âmbar para quem esfria,
/// vermelho para quem some (`COR_PERFIL` do site). Devolve fundo e borda.
(Color, Color) corDoPerfil(BuildContext context, String? perfil) {
  final c = Cores.de(context);
  final escuro = Theme.of(context).brightness == Brightness.dark;
  Color a(Color cor, double claro, double noEscuro) =>
      cor.withValues(alpha: escuro ? noEscuro : claro);
  return switch (perfil) {
    'campeoes' => (a(c.sucesso, .10, .16), a(c.sucesso, .40, .50)),
    'fieis' => (a(c.sucesso, .05, .09), a(c.sucesso, .30, .40)),
    'novos' => (a(c.acento, .14, .14), a(c.acento, .60, .55)),
    'promissores' => (a(c.acento, .07, .08), a(c.acento, .40, .35)),
    'atencao' => (a(c.realce, .18, .12), a(c.atencao, .40, .45)),
    'em_risco' => (a(c.realce, .30, .18), a(c.atencao, .50, .55)),
    'nao_posso_perder' => (a(c.erro, .08, .16), a(c.erro, .40, .50)),
    'perdidos' => (c.superficie2, c.borda),
    _ => (c.superficie, c.borda),
  };
}

/// O perfil do contato, como etiqueta.
class EtiquetaDePerfil extends StatelessWidget {
  const EtiquetaDePerfil({super.key, required this.perfil, required this.nome});

  final String perfil;
  final String nome;

  @override
  Widget build(BuildContext context) {
    final (fundo, borda) = corDoPerfil(context, perfil);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
      decoration: BoxDecoration(
        color: fundo,
        border: Border.all(color: borda),
        borderRadius: BorderRadius.circular(99),
      ),
      child: Text(
        nome,
        style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w600,
          color: Cores.de(context).tinta,
        ),
      ),
    );
  }
}

/// Um público em forma de ficha (bairro, mês, produto, estado): o nome e
/// quantos há. Tocar escolhe; tocar de novo solta.
class FichaDePublico extends StatelessWidget {
  const FichaDePublico({
    super.key,
    required this.rotulo,
    required this.total,
    required this.ativa,
    required this.aoTocar,
    this.destaque = false,
  });

  final String rotulo;
  final int total;
  final bool ativa;
  final VoidCallback aoTocar;

  /// O mês de hoje, entre os aniversariantes.
  final bool destaque;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final rotuloMaiusculo = rotulo.isEmpty
        ? rotulo
        : rotulo[0].toUpperCase() + rotulo.substring(1);
    return Semantics(
      button: true,
      selected: ativa,
      child: Material(
        color: ativa ? c.acento.withValues(alpha: .16) : c.superficie,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(99),
          side: BorderSide(
            color: ativa
                ? c.acento
                : destaque
                ? c.acento.withValues(alpha: .7)
                : c.borda,
            width: ativa ? 2 : 1,
          ),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: aoTocar,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Flexible(
                  child: Text(
                    rotuloMaiusculo,
                    style: TextStyle(
                      fontWeight: FontWeight.w600,
                      fontSize: 13.5,
                      color: c.tinta,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Text(
                  f.numero(total),
                  style: TextStyle(
                    color: c.tintaSuave,
                    fontSize: 13,
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Um cartão de público ou perfil: nome, regra, quanto gastou e quantos há.
class CartaoDePublico extends StatelessWidget {
  const CartaoDePublico({
    super.key,
    required this.nome,
    required this.regra,
    required this.total,
    required this.ativo,
    required this.aoTocar,
    this.gasto,
    this.perfil,
  });

  final String nome;
  final String regra;
  final int total;
  final bool ativo;
  final VoidCallback aoTocar;

  /// "R$ 12.400,00 no total · ticket R$ 48,00".
  final String? gasto;

  /// Pinta o cartão com a cor do perfil.
  final String? perfil;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final (fundo, borda) = perfil != null
        ? corDoPerfil(context, perfil)
        : (ativo ? c.acento.withValues(alpha: .08) : c.superficie, c.borda);
    return Semantics(
      button: true,
      selected: ativo,
      child: Material(
        color: fundo,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: BorderSide(
            color: ativo ? c.acento : borda,
            width: ativo ? 2 : 1,
          ),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: aoTocar,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        nome,
                        style: TextStyle(
                          fontWeight: FontWeight.w600,
                          fontSize: 14.5,
                          color: c.tinta,
                        ),
                      ),
                      if (regra.isNotEmpty) ...[
                        const SizedBox(height: 2),
                        Text(
                          regra,
                          style: TextStyle(
                            color: c.tintaSuave,
                            fontSize: 12.5,
                            height: 1.35,
                          ),
                        ),
                      ],
                      if (gasto != null) ...[
                        const SizedBox(height: 4),
                        Text(
                          gasto!,
                          style: TextStyle(
                            color: c.tinta,
                            fontSize: 12.5,
                            fontFeatures: const [FontFeature.tabularFigures()],
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(width: 12),
                Text(
                  f.numero(total),
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                    color: c.tinta,
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Título de seção com a nota curta ao lado (ou embaixo, sem espaço).
class TituloDeSecao extends StatelessWidget {
  const TituloDeSecao(this.titulo, {super.key, this.nota, this.acao});

  final String titulo;
  final String? nota;
  final Widget? acao;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                titulo,
                style: Theme.of(context).textTheme.titleMedium,
              ),
            ),
            ?acao,
          ],
        ),
        if (nota != null) ...[
          const SizedBox(height: 2),
          Text(
            nota!,
            style: TextStyle(color: c.tintaSuave, fontSize: 12.5, height: 1.4),
          ),
        ],
      ],
    );
  }
}

/// Subtítulo de grupo ("QUANTO GASTAM"), com o complemento em caixa normal.
class TituloDeGrupo extends StatelessWidget {
  const TituloDeGrupo(this.titulo, {super.key, this.complemento});

  final String titulo;
  final String? complemento;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    return Text.rich(
      TextSpan(
        children: [
          TextSpan(
            text: titulo.toUpperCase(),
            style: const TextStyle(
              fontWeight: FontWeight.w700,
              letterSpacing: 0.9,
              fontSize: 11.5,
            ),
          ),
          if (complemento != null)
            TextSpan(
              text: ' — $complemento',
              style: const TextStyle(fontSize: 12),
            ),
        ],
      ),
      style: TextStyle(color: c.tintaSuave),
    );
  }
}
