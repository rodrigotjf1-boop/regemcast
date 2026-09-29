/**
 * Mídia dos modelos: guardar o arquivo e trocá-lo por um handle da Meta.
 *
 * A peça que muda tudo: **a Meta não busca a URL da imagem de um modelo — ela
 * recebe os bytes** e devolve um `header_handle`. Só o handle vai no modelo.
 * Então, para o cliente escolher um arquivo do computador, o arquivo precisa
 * ficar guardado aqui até a hora de submeter.
 *
 * As duas formas de referência terminam no mesmo lugar:
 *
 * - `midia:<uuid>` — arquivo enviado pelo cliente, guardado nesta tabela;
 * - `https://…` — endereço público, que baixamos na hora.
 *
 * Nos dois casos quem sobe para a Meta somos nós, e o que volta é um handle.
 */
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';

import { baixarPublico, DownloadFalhou, EnderecoRecusado, type ArquivoBaixado } from '../../common/baixar-publico';
import { ContextoDb } from '../../db/contexto';
import { midia } from '../../db/schema';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { GraphService } from '../meta/graph.service';

/**
 * Tipos aceitos, por formato de cabeçalho, com os tetos da Meta.
 *
 * O documento na Meta vai até 100 MB, mas aqui o teto é 16 MB: o arquivo mora
 * no banco até virar handle, e cem megas numa linha de tabela custam mais em
 * backup e replicação do que valem num cabeçalho de mensagem.
 */
export const TIPOS_ACEITOS: Record<string, { formato: 'IMAGE' | 'VIDEO' | 'DOCUMENT'; maxBytes: number }> = {
  'image/jpeg': { formato: 'IMAGE', maxBytes: 5 * 1024 * 1024 },
  'image/png': { formato: 'IMAGE', maxBytes: 5 * 1024 * 1024 },
  'video/mp4': { formato: 'VIDEO', maxBytes: 16 * 1024 * 1024 },
  'video/3gpp': { formato: 'VIDEO', maxBytes: 16 * 1024 * 1024 },
  'application/pdf': { formato: 'DOCUMENT', maxBytes: 16 * 1024 * 1024 },
};

/** Maior teto entre os tipos: o download por endereço é cortado aqui. */
const TETO_ENDERECO = Math.max(...Object.values(TIPOS_ACEITOS).map((t) => t.maxBytes));

export const PREFIXO_MIDIA = 'midia:';

/** O arquivo como chega do upload. */
export interface ArquivoRecebido {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Injectable()
export class MidiaService {
  private readonly log = new Logger('Midia');

  constructor(
    private readonly ctx: ContextoDb,
    private readonly graph: GraphService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /** Guarda o arquivo e devolve a referência que o modelo vai usar. */
  async guardar(
    contaId: string,
    usuarioId: string,
    arquivo: ArquivoRecebido,
  ): Promise<{ id: string; referencia: string; formato: string; nome: string }> {
    const regra = TIPOS_ACEITOS[arquivo.mimetype];

    if (!regra) {
      throw new BadRequestException(
        'Tipo de arquivo não aceito pela Meta. Envie JPG ou PNG (imagem), MP4 (vídeo) ou PDF (documento).',
      );
    }
    if (arquivo.size > regra.maxBytes) {
      const mb = Math.round(regra.maxBytes / (1024 * 1024));
      throw new BadRequestException(`Este arquivo passa do limite de ${mb} MB para este tipo.`);
    }

    // Conferir a assinatura dos bytes, e não só a extensão ou o mimetype que o
    // navegador declarou: os dois são escritos pelo cliente e mentem fácil. Um
    // executável renomeado para .jpg passaria na extensão.
    if (!this.bytesBatemComTipo(arquivo.buffer, arquivo.mimetype)) {
      throw new BadRequestException(
        'O conteúdo do arquivo não corresponde ao tipo dele. Exporte de novo pelo programa de origem.',
      );
    }

    return this.ctx.comConta(contaId, async (db) => {
      const [criada] = await db
        .insert(midia)
        .values({
          contaId,
          nomeArquivo: arquivo.originalname.slice(0, 255),
          tipoMime: arquivo.mimetype,
          tamanhoBytes: arquivo.size,
          conteudo: arquivo.buffer,
          criadoPor: usuarioId,
        })
        .returning({ id: midia.id });

      await this.auditoria.registrar({
        contaId,
        atorTipo: 'usuario',
        atorUsuarioId: usuarioId,
        acao: 'midia.enviada',
        entidade: 'midia',
        entidadeId: criada!.id,
        detalhe: { tipo: arquivo.mimetype, bytes: arquivo.size },
      });

      return {
        id: criada!.id,
        referencia: `${PREFIXO_MIDIA}${criada!.id}`,
        formato: regra.formato,
        nome: arquivo.originalname,
      };
    });
  }

  /** Os bytes, para a prévia da tela. */
  async ler(contaId: string, id: string): Promise<{ conteudo: Buffer; tipoMime: string }> {
    return this.ctx.comConta(contaId, async (db) => {
      const [achada] = await db
        .select({ conteudo: midia.conteudo, tipoMime: midia.tipoMime })
        .from(midia)
        .where(and(eq(midia.contaId, contaId), eq(midia.id, id)))
        .limit(1);

      if (!achada?.conteudo) throw new NotFoundException('Arquivo não encontrado.');
      return { conteudo: achada.conteudo, tipoMime: achada.tipoMime };
    });
  }

  /**
   * O formato (`IMAGE`, `VIDEO`, `DOCUMENT`) de cada mídia guardada, pelo id.
   *
   * Serve para conferir, antes de ir à Meta, se o arquivo combina com o
   * cabeçalho: uma imagem escolhida para um cabeçalho que depois virou vídeo
   * seria enviada como vídeo — e recusada.
   */
  async formatosDe(contaId: string, ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const linhas = await this.ctx.comConta(contaId, (db) =>
      db
        .select({ id: midia.id, tipoMime: midia.tipoMime })
        .from(midia)
        .where(and(eq(midia.contaId, contaId), inArray(midia.id, ids))),
    );
    return new Map(linhas.map((l) => [l.id, TIPOS_ACEITOS[l.tipoMime]?.formato ?? '']));
  }

  /** As mídias da conta, sem os bytes. */
  async listar(contaId: string) {
    return this.ctx.comConta(contaId, (db) =>
      db
        .select({
          id: midia.id,
          nome: midia.nomeArquivo,
          tipoMime: midia.tipoMime,
          tamanhoBytes: midia.tamanhoBytes,
          criadoEm: midia.criadoEm,
        })
        .from(midia)
        .where(eq(midia.contaId, contaId))
        .orderBy(desc(midia.criadoEm))
        .limit(100),
    );
  }

  /**
   * Transforma a referência do modelo num `header_handle` da Meta.
   *
   * Para arquivo guardado, o handle fica em cache: reenviar um modelo recusado
   * não sobe o mesmo arquivo de novo.
   */
  async handleParaModelo(contaId: string, referencia: string): Promise<string> {
    if (referencia.startsWith(PREFIXO_MIDIA)) {
      const id = referencia.slice(PREFIXO_MIDIA.length);

      const guardada = await this.ctx.comConta(contaId, async (db) => {
        const [achada] = await db
          .select()
          .from(midia)
          .where(and(eq(midia.contaId, contaId), eq(midia.id, id)))
          .limit(1);
        return achada;
      });

      if (!guardada) throw new BadRequestException('O arquivo do cabeçalho não foi encontrado.');
      if (guardada.metaHandle) return guardada.metaHandle;
      if (!guardada.conteudo) {
        throw new BadRequestException('O arquivo do cabeçalho não está mais disponível. Envie de novo.');
      }

      // Fora de transação: o upload pode levar segundos, e segurar a conexão de
      // banco durante isso é o que esgota o pool sob carga.
      const handle = await this.graph.enviarMidiaParaModelo(guardada.conteudo, guardada.tipoMime);

      await this.ctx.comConta(contaId, (db) =>
        db
          .update(midia)
          .set({ metaHandle: handle, metaHandleEm: new Date() })
          .where(and(eq(midia.contaId, contaId), eq(midia.id, id))),
      );

      return handle;
    }

    if (/^https?:\/\//i.test(referencia)) {
      return this.handleDeEndereco(referencia);
    }

    throw new BadRequestException('Referência de mídia inválida. Envie um arquivo ou informe um endereço.');
  }

  /** Baixa um endereço público e sobe para a Meta. */
  private async handleDeEndereco(url: string): Promise<string> {
    let baixado: ArquivoBaixado;
    try {
      baixado = await baixarPublico(url, { limiteBytes: TETO_ENDERECO });
    } catch (erro) {
      if (erro instanceof EnderecoRecusado) throw new BadRequestException(`${erro.message} Ou envie o arquivo.`);
      if (erro instanceof DownloadFalhou) {
        // O motivo detalhado fica no log: devolver o status de um endereço
        // qualquer ao cliente é o que transformaria isto numa sonda de rede.
        this.log.warn(`Mídia por endereço recusada (${erro.motivo}): ${erro.message}`);
        throw new BadRequestException(
          erro.motivo === 'grande'
            ? 'A mídia desse endereço passa do limite de tamanho da Meta.'
            : erro.motivo === 'privado'
              ? 'Esse endereço não é público. Informe um link https aberto na internet, ou envie o arquivo.'
              : 'Não conseguimos baixar a mídia desse endereço. Confira se ele abre sem login, ou envie o arquivo.',
        );
      }
      throw erro;
    }

    const regra = TIPOS_ACEITOS[baixado.tipoMime];
    if (!regra || !this.bytesBatemComTipo(baixado.conteudo, baixado.tipoMime)) {
      throw new BadRequestException('O endereço não aponta para uma imagem JPG/PNG, vídeo MP4 ou PDF.');
    }
    if (baixado.conteudo.length > regra.maxBytes) {
      throw new BadRequestException('A mídia desse endereço passa do limite de tamanho da Meta.');
    }

    return this.graph.enviarMidiaParaModelo(baixado.conteudo, baixado.tipoMime);
  }

  /**
   * Confere a assinatura dos primeiros bytes.
   *
   * Extensão e mimetype são escritos pelo cliente. A assinatura é o arquivo.
   */
  private bytesBatemComTipo(buf: Buffer, tipo: string): boolean {
    if (buf.length < 12) return false;
    const comeca = (...b: number[]) => b.every((v, i) => buf[i] === v);

    switch (tipo) {
      case 'image/jpeg':
        return comeca(0xff, 0xd8, 0xff);
      case 'image/png':
        return comeca(0x89, 0x50, 0x4e, 0x47);
      case 'application/pdf':
        return comeca(0x25, 0x50, 0x44, 0x46); // %PDF
      case 'video/mp4':
      case 'video/3gpp':
        // MP4 e 3GP têm "ftyp" a partir do byte 4.
        return buf.toString('ascii', 4, 8) === 'ftyp';
      default:
        return false;
    }
  }
}
