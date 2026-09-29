import 'basicos.dart';

/// A categoria do modelo (quem decide é a Meta), como a tela fala dela: o nome
/// e o que ela muda no envio — as mesmas frases da web
/// (`frontend/src/lib/categorias.ts`). Chega em português da lista da Meta
/// (marketing, utilidade, autenticação) ou em inglês do nosso registro
/// (MARKETING, UTILITY, AUTHENTICATION); categoria nova aparece como veio.

String _chave(String? categoria) {
  final c = (categoria ?? '').trim().toLowerCase();
  return switch (c) {
    'utility' => 'utilidade',
    'authentication' || 'autenticacao' => 'autenticação',
    _ => c,
  };
}

/// "Marketing", "Utilidade", "Autenticação" — ou como veio, com maiúscula.
String? nomeDaCategoria(String? categoria) {
  final c = _chave(categoria);
  if (c.isEmpty) return null;
  return switch (c) {
    'marketing' => 'Marketing',
    'utilidade' => 'Utilidade',
    'autenticação' => 'Autenticação',
    _ => '${c[0].toUpperCase()}${c.substring(1)}',
  };
}

/// O que a categoria muda no envio, para a linha abaixo do modelo.
String? explicacaoDaCategoria(String? categoria) => switch (_chave(categoria)) {
  'marketing' =>
    'Promoção e novidade. Entra no descanso entre campanhas e no limite de marketing por pessoa da Meta.',
  'utilidade' =>
    'Aviso sobre um pedido, uma conta ou um agendamento da pessoa, sem promoção. Não entra no descanso.',
  'autenticação' =>
    'Código de verificação para a pessoa entrar em algum lugar. Não serve para campanha.',
  _ => null,
};

/// Marketing no acento, utilidade neutra, autenticação em atenção.
TomPilula tomDaCategoria(String? categoria) => switch (_chave(categoria)) {
  'marketing' => TomPilula.acento,
  'autenticação' => TomPilula.atencao,
  _ => TomPilula.neutro,
};

bool ehMarketing(String? categoria) => _chave(categoria) == 'marketing';
