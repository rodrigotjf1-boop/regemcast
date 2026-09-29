import 'dart:async';
import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../sessao/sessao.dart';
import 'cliente_api.dart';

/// A mídia dos modelos: a imagem, o vídeo ou o PDF do cabeçalho, e a imagem de
/// cada cartão do carrossel.
///
/// A Meta não busca a URL da mídia de um modelo — ela recebe os bytes. Então o
/// arquivo sobe para nós agora (`POST /midia`) e só vira `header_handle` na
/// hora de submeter o modelo, no servidor. O que o modelo guarda é a
/// referência: `midia:<uuid>` (arquivo enviado) ou um endereço `https://`.

const _mb = 1024 * 1024;

/// Um tipo de arquivo que a Meta aceita no cabeçalho.
class TipoDeMidia {
  const TipoDeMidia(this.mime, this.formato, this.maxBytes);

  final String mime;

  /// `IMAGE`, `VIDEO` ou `DOCUMENT` — o formato do cabeçalho.
  final String formato;
  final int maxBytes;
}

/// Os mesmos tipos e tetos do servidor (`TIPOS_ACEITOS` em
/// `backend/src/modules/midia/midia.service.ts`). Aqui é só um filtro prévio,
/// para não subir 20 MB pelos dados móveis e ouvir "não" no fim: quem decide é
/// o servidor, que confere também os primeiros bytes do arquivo.
const tiposDeMidia = <String, TipoDeMidia>{
  'jpg': TipoDeMidia('image/jpeg', 'IMAGE', 5 * _mb),
  'jpeg': TipoDeMidia('image/jpeg', 'IMAGE', 5 * _mb),
  'png': TipoDeMidia('image/png', 'IMAGE', 5 * _mb),
  'mp4': TipoDeMidia('video/mp4', 'VIDEO', 16 * _mb),
  '3gp': TipoDeMidia('video/3gpp', 'VIDEO', 16 * _mb),
  'pdf': TipoDeMidia('application/pdf', 'DOCUMENT', 16 * _mb),
};

/// As extensões que o seletor do Android mostra para cada formato.
List<String> extensoesDoFormato(String formato) => [
  for (final e in tiposDeMidia.entries)
    if (e.value.formato == formato) e.key,
];

/// Como o formato aparece na tela.
String rotuloDoFormato(String formato) => switch (formato) {
  'IMAGE' => 'imagem',
  'VIDEO' => 'vídeo',
  _ => 'documento',
};

/// O que a Meta aceita, dito como a pessoa entende.
String aceitaDoFormato(String formato) => switch (formato) {
  'IMAGE' => 'JPG ou PNG · até 5 MB',
  'VIDEO' => 'MP4 · até 16 MB',
  _ => 'PDF · até 16 MB',
};

String extensaoDe(String nome) {
  final ponto = nome.lastIndexOf('.');
  return ponto < 0 ? '' : nome.substring(ponto + 1).toLowerCase();
}

/// Por que este arquivo não serve para o formato — ou nulo, se serve.
///
/// `tamanho` nulo = o Android não disse; aí quem confere é o servidor.
String? problemaDoArquivo(String nome, int? tamanho, String formato) {
  final ext = extensaoDe(nome);
  final tipo = tiposDeMidia[ext];
  if (tipo == null || tipo.formato != formato) {
    final aceita = switch (formato) {
      'IMAGE' => 'imagem em JPG ou PNG',
      'VIDEO' => 'vídeo em MP4',
      _ => 'documento em PDF',
    };
    return ext.isEmpty
        ? 'A Meta aceita $aceita. Escolha outro arquivo.'
        : 'A Meta aceita $aceita, e este arquivo é .$ext. Escolha outro, ou salve neste formato.';
  }
  if (tamanho != null && tamanho > tipo.maxBytes) {
    return 'Este arquivo passa do limite de ${tipo.maxBytes ~/ _mb} MB para ${rotuloDoFormato(formato)}.';
  }
  return null;
}

// ------------------------------------------------------------- o seletor

/// Um arquivo escolhido no aparelho. Os bytes são lidos só depois de conferir
/// o tipo e o tamanho: ler um vídeo de 40 MB para depois recusar é desperdício.
class ArquivoEscolhido {
  const ArquivoEscolhido({
    required this.nome,
    required this.tamanho,
    required this.ler,
  });

  final String nome;

  /// Em bytes, quando o Android informa.
  final int? tamanho;
  final Future<Uint8List> Function() ler;
}

/// Abre o seletor do Android no formato pedido. Nulo = a pessoa desistiu.
typedef EscolherMidia = Future<ArquivoEscolhido?> Function(String formato);

/// O seletor fica atrás de um provider para o teste trocá-lo por um falso:
/// o canal nativo não existe no `flutter test`, e esperar por ele trava o
/// teste sem erro nenhum (LIC-027).
final escolherMidiaProvider = Provider<EscolherMidia>(
  (ref) => _escolherNoAparelho,
);

Future<ArquivoEscolhido?> _escolherNoAparelho(String formato) async {
  // Filtrar pelo tipo já no seletor: só aparece o que a Meta aceita, e a
  // pessoa não chega a escolher a foto em WEBP que seria recusada.
  final arquivo = await FilePicker.pickFile(
    type: FileType.custom,
    allowedExtensions: extensoesDoFormato(formato),
  );
  if (arquivo == null) return null;
  return ArquivoEscolhido(
    nome: arquivo.name,
    tamanho: arquivo.lengthSync() ?? await arquivo.length(),
    ler: arquivo.readAsBytes,
  );
}

// ------------------------------------------------------------ o servidor

/// `POST /midia`: o arquivo guardado e a referência que o modelo usa.
class MidiaEnviada {
  const MidiaEnviada({
    required this.id,
    required this.referencia,
    required this.formato,
    required this.nome,
  });

  final String id;

  /// `midia:<uuid>`.
  final String referencia;
  final String formato;
  final String nome;

  factory MidiaEnviada.deJson(Map<String, dynamic> j) => MidiaEnviada(
    id: '${j['id']}',
    referencia: '${j['referencia']}',
    formato: '${j['formato'] ?? ''}',
    nome: '${j['nome'] ?? ''}',
  );
}

const prefixoMidia = 'midia:';

/// O id da mídia guardada, ou nulo se a referência é um endereço.
String? idDaMidia(String referencia) => referencia.startsWith(prefixoMidia)
    ? referencia.substring(prefixoMidia.length)
    : null;

bool ehEndereco(String referencia) =>
    RegExp(r'^https?://', caseSensitive: false).hasMatch(referencia);

final servicoMidiaProvider = Provider<ServicoMidia>(
  (ref) => ServicoMidia(ref.read(clienteApiProvider)),
);

class ServicoMidia {
  ServicoMidia(this._api);

  final ClienteApi _api;

  /// Sobe o arquivo. O tipo vai declarado, como o navegador faz.
  Future<MidiaEnviada> enviar(String nome, Uint8List bytes) async {
    final tipo = tiposDeMidia[extensaoDe(nome)];
    final r =
        await _api.enviarArquivo(
              '/midia',
              campo: 'arquivo',
              bytes: bytes,
              nomeArquivo: nome,
              tipoMime: tipo?.mime,
            )
            as Map<String, dynamic>;
    return MidiaEnviada.deJson(r);
  }
}

/// Os bytes de uma mídia guardada (`GET /midia/:id`), para a miniatura e a
/// prévia. Fica cinco minutos na memória depois de sair da tela: voltar ao
/// modelo não baixa de novo, e uma sessão longa não acumula imagens.
final bytesDaMidiaProvider = FutureProvider.autoDispose
    .family<Uint8List, String>((ref, id) async {
      final bytes = await ref.read(clienteApiProvider).baixar('/midia/$id');
      final vinculo = ref.keepAlive();
      final prazo = Timer(const Duration(minutes: 5), vinculo.close);
      ref.onDispose(prazo.cancel);
      return bytes;
    });
