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

/// "1 campanha", "3 campanhas".
String plural(int n, String um, String varios) =>
    '${numero(n)} ${n == 1 ? um : varios}';
