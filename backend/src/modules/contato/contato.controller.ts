/**
 * Rotas de contatos.
 *
 * A importação tem duas etapas e três portas de entrada — arquivo, texto
 * colado, e a confirmação. O formato NUNCA é escolhido pelo cliente numa
 * caixinha: ele vem da extensão do arquivo. Pedir para a pessoa dizer se o
 * arquivo dela é "csv" ou "xlsx" é transferir para ela um trabalho que o
 * servidor faz melhor — e é um lugar a mais para errar.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';

import type { UsuarioAutenticado } from '../../common/auth.guard';
import { UsuarioAtual } from '../../common/usuario-atual.decorator';
import { ContatoService } from './contato.service';
import {
  ConfirmarImportacaoDto,
  CriarListaDto,
  PreviaTextoDto,
  type Formato,
} from './dto/importacao.dto';

/**
 * Teto do arquivo enviado.
 *
 * 5 MB cobre um `.vcf` de milhares de contatos e uma planilha grande. Acima
 * disso o arquivo entra em partes — e o cliente lê isso em vez de esperar um
 * upload que o servidor vai recusar calado.
 */
const TAMANHO_MAXIMO = 5 * 1024 * 1024;

/** Extensão → formato. É o servidor que decide, não o cliente. */
function formatoPeloNome(nome: string): Formato {
  const ext = nome.toLowerCase().split('.').pop() ?? '';
  if (ext === 'vcf' || ext === 'vcard') return 'vcard';
  if (ext === 'xlsx' || ext === 'xlsm') return 'xlsx';
  if (ext === 'csv' || ext === 'tsv' || ext === 'txt') return 'csv';
  throw new BadRequestException(
    'Formato não reconhecido. Envie .vcf (contatos do celular), .csv, .txt ou .xlsx.',
  );
}

@ApiTags('Contatos')
@Controller('contatos')
export class ContatoController {
  constructor(private readonly servico: ContatoService) {}

  @Get()
  listar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Query('pagina') pagina?: string,
    @Query('porPagina') porPagina?: string,
  ) {
    return this.servico.listar(
      usuario.contaId,
      Number(pagina) || 1,
      Number(porPagina) || 50,
    );
  }

  /** Prévia a partir de um arquivo. Nada é gravado. */
  @Post('importacao/arquivo')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('arquivo', { limits: { fileSize: TAMANHO_MAXIMO } }))
  async previaDeArquivo(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @UploadedFile() arquivo?: { originalname: string; buffer: Buffer; size: number },
  ) {
    if (!arquivo) throw new BadRequestException('Escolha um arquivo.');

    const formato = formatoPeloNome(arquivo.originalname);
    const previa = await this.servico.previa(usuario.contaId, { formato }, arquivo.buffer);
    return { ...previa, formato, arquivoNome: arquivo.originalname };
  }

  /** Prévia a partir de números colados. Nada é gravado. */
  @Post('importacao/texto')
  async previaDeTexto(@UsuarioAtual() usuario: UsuarioAutenticado, @Body() dto: PreviaTextoDto) {
    const previa = await this.servico.previa(usuario.contaId, { formato: 'texto' }, dto.texto);
    return { ...previa, formato: 'texto' as const };
  }

  /** Confirma a importação: aqui sim os contatos são gravados. */
  @Post('importacao')
  confirmar(@UsuarioAtual() usuario: UsuarioAutenticado, @Body() dto: ConfirmarImportacaoDto) {
    return this.servico.importar(usuario.contaId, usuario.id, dto);
  }

  @Get('listas')
  listas(@UsuarioAtual() usuario: UsuarioAutenticado) {
    return this.servico.listas(usuario.contaId);
  }

  @Post('listas')
  criarLista(@UsuarioAtual() usuario: UsuarioAutenticado, @Body() dto: CriarListaDto) {
    return this.servico.criarLista(usuario.contaId, usuario.id, dto.nome, dto.descricao);
  }

  @Get('listas/:id/publico')
  publico(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.servico
      .publicoDaLista(usuario.contaId, id)
      .then((total) => ({ total }));
  }

  /** Descadastro: marca a linha, não apaga. Apagar deixaria o número voltar. */
  @Delete(':id')
  descadastrar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.servico.descadastrar(usuario.contaId, usuario.id, id);
  }
}
