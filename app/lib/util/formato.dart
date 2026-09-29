import 'package:intl/intl.dart';

/// Números e datas do jeito que a pessoa lê no Brasil: 5.000, 17/10/2026.
///
/// Os mesmos formatos da web (`frontend/src/lib/formato.ts`), para o número
/// do celular e o do computador baterem quando alguém compara os dois.

final _numero = NumberFormat.decimalPattern('pt_BR');
final _data = DateFormat('dd/MM/yyyy', 'pt_BR');
final _dataHora = DateFormat("dd/MM 'às' HH:mm", 'pt_BR');

String numero(num valor) => _numero.format(valor);

String data(DateTime? d) => d == null ? '—' : _data.format(d);

String dataHora(DateTime? d) => d == null ? '—' : _dataHora.format(d);

/// "há 5 min", "ontem", "12/09" — para listas, onde a data exata cansa.
String quando(DateTime? d, {DateTime? agora}) {
  if (d == null) return '—';
  final diff = (agora ?? DateTime.now()).difference(d);
  if (diff.inMinutes < 1) return 'agora';
  if (diff.inMinutes < 60) return 'há ${diff.inMinutes} min';
  if (diff.inHours < 24) return 'há ${diff.inHours} h';
  if (diff.inDays == 1) return 'ontem';
  if (diff.inDays < 7) return 'há ${diff.inDays} dias';
  return DateFormat('dd/MM', 'pt_BR').format(d);
}

/// Dias inteiros desde a data (0 = hoje). Nulo sem data.
int? diasDesde(DateTime? d, {DateTime? agora}) {
  if (d == null) return null;
  final dias = (agora ?? DateTime.now()).difference(d).inHours ~/ 24;
  return dias < 0 ? 0 : dias;
}

/// "hoje", "ontem", "há 9 dias".
String haQuantosDias(int dias) => dias == 0
    ? 'hoje'
    : dias == 1
    ? 'ontem'
    : 'há ${numero(dias)} dias';

/// `2026-10-14` → "14/10" (no ano corrente) ou "14/10/2027".
String diaCurto(String? aaaaMmDd, {DateTime? agora}) {
  final m = RegExp(r'^(\d{4})-(\d{2})-(\d{2})').firstMatch(aaaaMmDd ?? '');
  if (m == null) return '—';
  final ano = int.parse(m.group(1)!);
  return ano == (agora ?? DateTime.now()).year
      ? '${m.group(3)}/${m.group(2)}'
      : '${m.group(3)}/${m.group(2)}/$ano';
}

/// "1 campanha", "3 campanhas".
String plural(int n, String um, String varios) =>
    '${numero(n)} ${n == 1 ? um : varios}';

/// 5521999998888 → +55 21 99999-8888. O que não for número brasileiro sai
/// só com o "+" na frente — melhor mostrar cru do que formatar errado.
String telefone(String e164) {
  final d = e164.replaceAll(RegExp(r'\D'), '');
  if (d.startsWith('55') && (d.length == 12 || d.length == 13)) {
    final ddd = d.substring(2, 4);
    final num = d.substring(4);
    final corte = num.length - 4;
    return '+55 $ddd ${num.substring(0, corte)}-${num.substring(corte)}';
  }
  return d.isEmpty ? '—' : '+$d';
}

/// Porcentagem arredondada de uma parte sobre o todo: "57%". Todo zero → "—".
String porcento(int parte, int todo) =>
    todo <= 0 ? '—' : '${(parte * 100 / todo).round()}%';

/// "Seg, Qua e Sex" a partir de [1, 3, 5]. Vazio = todos os dias.
String diasDaSemana(List<int> dias) {
  const nomes = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  if (dias.isEmpty || dias.length == 7) return 'Todos os dias';
  final ordenados = [...dias]..sort();
  final rotulos = ordenados
      .where((d) => d >= 0 && d <= 6)
      .map((d) => nomes[d])
      .toList();
  if (rotulos.length == 1) return rotulos.first;
  return '${rotulos.sublist(0, rotulos.length - 1).join(', ')} e ${rotulos.last}';
}

/// '09:00:00' → '09:00'.
String hora(String? hhmmss) =>
    hhmmss == null || hhmmss.length < 5 ? '' : hhmmss.substring(0, 5);

final _reais = NumberFormat.currency(locale: 'pt_BR', symbol: r'R$');

/// 9990 → "R$ 99,90".
String reais(int centavos) => _reais.format(centavos / 100);
