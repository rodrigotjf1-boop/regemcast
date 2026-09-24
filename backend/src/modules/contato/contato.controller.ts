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
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';

import type { UsuarioAutenticado } from '../../common/auth.guard';
import { DonoGuard } from '../../common/dono.guard';
import { UsuarioAtual } from '../../common/usuario-atual.decorator';
import { ContatoService } from './contato.service';
import { AdicionarNaListaDto } from './dto/adicionar-na-lista.dto';
import { CriarListaDoPerfilDto, ParametrosSegmentacaoDto } from './dto/segmentacao.dto';
import type { Segmento } from './segmentacao';
import { SegmentacaoService } from './segmentacao.service';
import {
  ConfirmarImportacaoDto,
  ReativarContatoDto,
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
  constructor(
    private readonly servico: ContatoService,
    private readonly segmentacao: SegmentacaoService,
  ) {}

  @Get()
  listar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Query('pagina') pagina?: string,
    @Query('porPagina') porPagina?: string,
    @Query('segmento') segmento?: string,
    @Query('situacao') situacao?: string,
  ) {
    if (situacao && situacao !== 'ativos' && situacao !== 'bloqueados') {
      throw new BadRequestException('Situação desconhecida.');
    }
    return this.servico.listar(
      usuario.contaId,
      Number(pagina) || 1,
      Number(porPagina) || 50,
      segmento || undefined,
      situacao as 'ativos' | 'bloqueados' | undefined,
    );
  }

  // ------------------------------------------------------------ perfis da base

  /** Quantos contatos em cada perfil, com a regra de cada um. */
  @Get('segmentos')
  segmentos(@UsuarioAtual() usuario: UsuarioAutenticado) {
    return this.segmentacao.resumo(usuario.contaId);
  }

  /** Os quatro números da classificação. Do dono: muda a leitura da base inteira. */
  @Put('segmentos/parametros')
  @UseGuards(DonoGuard)
  salvarParametros(@UsuarioAtual() usuario: UsuarioAutenticado, @Body() dto: ParametrosSegmentacaoDto) {
    return this.segmentacao.salvarParametros(usuario.contaId, usuario.id, dto);
  }

  /** Foto do perfil de hoje numa lista — é assim que o perfil vira público de campanha. */
  @Post('segmentos/:segmento/lista')
  criarListaDoPerfil(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('segmento') segmento: string,
    @Body() dto: CriarListaDoPerfilDto,
  ) {
    return this.segmentacao.criarLista(usuario.contaId, usuario.id, segmento as Segmento, dto.nome);
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

  /** Põe o contato numa lista (usado pela tela de conversas). */
  @Post(':id/listas')
  adicionarNaLista(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdicionarNaListaDto,
  ) {
    return this.servico.adicionarNaLista(usuario.contaId, usuario.id, id, dto.listaId);
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

  // ------------------------------------------------------------- bloqueios

  /** Volta à base, a pedido da pessoa. A justificativa fica gravada. */
  @Post(':id/reativar')
  reativar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReativarContatoDto,
  ) {
    return this.servico.reativar(usuario.contaId, usuario.id, id, dto.justificativa);
  }

  /** Apaga os dados pessoais e mantém o número bloqueado (pedido de exclusão). */
  @Post(':id/anonimizar')
  anonimizar(@UsuarioAtual() usuario: UsuarioAutenticado, @Param('id', ParseUUIDPipe) id: string) {
    return this.servico.anonimizar(usuario.contaId, usuario.id, id);
  }

  /** Apaga tudo, inclusive o número — a pessoa pode voltar numa importação. */
  @Delete(':id/permanente')
  apagar(@UsuarioAtual() usuario: UsuarioAutenticado, @Param('id', ParseUUIDPipe) id: string) {
    return this.servico.apagar(usuario.contaId, usuario.id, id);
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
