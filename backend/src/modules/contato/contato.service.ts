/**
 * Base de contatos: importar, listar e descadastrar.
 *
 * A importação acontece em DOIS passos — prévia e confirmação — e isso não é
 * preciosismo de interface. O cliente está prestes a autorizar mensagens para
 * pessoas que ele acha que autorizaram ele; mostrar quantas entram, quantas já
 * existem, quantas foram descartadas e **quantas tiveram o `55` acrescentado
 * por nós** antes de gravar é a diferença entre um import conferido e um import
 * de fé.
 *
 * O consentimento é gravado junto, com origem, data e evidência, porque foi
 * exatamente isso que declaramos à Meta no App Review. A tabela sem essas três
 * colunas transformaria aquela frase em declaração falsa.
 */
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, count, desc, eq, inArray } from 'drizzle-orm';

import { paraCloudApi } from '../../common/telefone';
import { ContextoDb } from '../../db/contexto';
import { contato, contatoLista, contatoListaItem, importacao } from '../../db/schema';
import { AuditoriaService } from '../auditoria/auditoria.service';
import type { ConfirmarImportacaoDto, PreviaImportacaoDto } from './dto/importacao.dto';
import { lerCsv, lerTexto, lerXlsx, detectarColunas, type Linha } from './parsers/tabela';
import { lerVcard, pareceVcard } from './parsers/vcard';

/**
 * Teto de contatos por importação.
 *
 * A prévia volta pelo corpo da resposta e a confirmação sobe pelo corpo do
 * request; sem teto, uma base de 300 mil linhas viraria um JSON que derruba o
 * processo. Cinco mil cobre a base de uma PME com folga — acima disso, o
 * arquivo entra em partes, e a tela diz isso em vez de truncar calada.
 */
export const TETO_IMPORTACAO = 5000;

/** Um contato como a prévia mostra: já normalizado, ainda não gravado. */
export interface ContatoDaPrevia {
  nome: string;
  telefone: string;
  /** `false` quando este número já está na base — a confirmação não duplica. */
  novo: boolean;
  /** `true` quando o número veio sem DDI e assumimos o Brasil. */
  assumiuPais: boolean;
}

export interface ResultadoPrevia {
  /** Quantas linhas o arquivo tinha. */
  totalLidos: number;
  /** Quantas viraram um telefone válido. */
  validos: number;
  /** Quantas não viraram — número curto, coluna errada, linha de cabeçalho. */
  invalidos: number;
  /** Quantas entram de fato. */
  novos: number;
  /** Quantas já estão na base. */
  jaExistem: number;
  /** Quantas tiveram o código do país acrescentado por nós. */
  assumiramPais: number;
  limite: number;
  /** `true` quando o arquivo passou do teto e a prévia foi cortada. */
  truncado: boolean;
  contatos: ContatoDaPrevia[];
}

@Injectable()
export class ContatoService {
  private readonly log = new Logger('Contato');

  constructor(
    private readonly ctx: ContextoDb,
    private readonly auditoria: AuditoriaService,
  ) {}

  // ------------------------------------------------------------------ prévia

  /**
   * Lê o arquivo, normaliza, remove repetidos e diz o que vai acontecer.
   *
   * Nada é gravado aqui. O cliente confere e confirma no passo seguinte.
   */
  async previa(contaId: string, entrada: PreviaImportacaoDto, conteudo: Buffer | string): Promise<ResultadoPrevia> {
    const brutos = await this.extrair(entrada.formato, conteudo);

    // Dedup por telefone JÁ NORMALIZADO. Dedup pelo texto original deixaria
    // passar "(21) 98975-1705" e "5521989751705" como duas pessoas.
    const porTelefone = new Map<string, { nome: string; telefone: string; assumiuPais: boolean }>();
    let invalidos = 0;
    let assumiramPais = 0;

    for (const bruto of brutos) {
      // O vCard traz vários telefones por contato, em ordem de preferência: o
      // primeiro que normalizar vence. Descartar essa lista perderia o contato
      // cujo primeiro celular é um ramal.
      let escolhido: { e164: string; assumiuPaisPadrao: boolean } | null = null;
      for (const candidato of bruto.telefones) {
        const n = paraCloudApi(candidato);
        if (n.e164) {
          escolhido = n;
          break;
        }
      }

      if (!escolhido) {
        invalidos++;
        continue;
      }

      if (escolhido.assumiuPaisPadrao) assumiramPais++;

      const jaVisto = porTelefone.get(escolhido.e164);
      if (!jaVisto) {
        porTelefone.set(escolhido.e164, {
          nome: bruto.nome,
          telefone: escolhido.e164,
          assumiuPais: escolhido.assumiuPaisPadrao,
        });
      } else if (!jaVisto.nome && bruto.nome) {
        // Mesmo número em duas linhas: fica o nome de quem tem nome.
        jaVisto.nome = bruto.nome;
      }
    }

    const unicos = [...porTelefone.values()];

    // Arquivo com linhas mas nenhum telefone: quase sempre é a coluna errada —
    // a heurística escolheu uma que não era telefone, ou os números vieram sem
    // DDD. Devolver uma prévia vazia deixaria a pessoa olhando uma tela que não
    // explica nada; melhor recusar dizendo o que conferir.
    if (!unicos.length && brutos.length) {
      throw new BadRequestException(
        'Não encontrei nenhum telefone válido neste arquivo. Se for planilha, nomeie a coluna como "telefone" ou "celular"; se for texto, confira se os números têm DDD.',
      );
    }

    const existentes = await this.telefonesJaNaBase(contaId, unicos.map((c) => c.telefone));

    const marcados: ContatoDaPrevia[] = unicos.map((c) => ({
      nome: c.nome,
      telefone: c.telefone,
      novo: !existentes.has(c.telefone),
      assumiuPais: c.assumiuPais,
    }));

    const novos = marcados.filter((c) => c.novo).length;

    return {
      totalLidos: brutos.length,
      validos: unicos.length,
      invalidos,
      novos,
      jaExistem: unicos.length - novos,
      assumiramPais,
      limite: TETO_IMPORTACAO,
      truncado: unicos.length > TETO_IMPORTACAO,
      contatos: marcados.slice(0, TETO_IMPORTACAO),
    };
  }

  // ------------------------------------------------------------- confirmação

  /**
   * Grava os contatos revisados.
   *
   * O consentimento é obrigatório: sem ele o contato não entra. Não é validação
   * de formulário — é a condição que a Meta exige para disparo iniciado pela
   * empresa, e a que declaramos no App Review.
   */
  async importar(
    contaId: string,
    usuarioId: string,
    dto: ConfirmarImportacaoDto,
  ): Promise<{ importacaoId: string; gravados: number; jaExistiam: number }> {
    if (!dto.consentimento) {
      throw new BadRequestException(
        'Confirme que estes contatos autorizaram receber mensagens desta empresa. Sem esse aceite não podemos importar.',
      );
    }
    if (!dto.contatos.length) {
      throw new BadRequestException('Nenhum contato para importar.');
    }
    if (dto.contatos.length > TETO_IMPORTACAO) {
      throw new BadRequestException(
        `Cada importação aceita até ${TETO_IMPORTACAO} contatos. Divida o arquivo em partes.`,
      );
    }

    return this.ctx.comConta(contaId, async (db) => {
      // Normaliza de novo, do lado do servidor. A prévia é uma cortesia para a
      // tela; confiar no que volta dela seria confiar no cliente.
      const normalizados = new Map<string, string>();
      for (const c of dto.contatos) {
        const n = paraCloudApi(c.telefone);
        if (n.e164 && !normalizados.has(n.e164)) {
          normalizados.set(n.e164, (c.nome ?? '').trim().slice(0, 120));
        }
      }

      if (!normalizados.size) {
        throw new BadRequestException('Nenhum dos contatos enviados tem telefone válido.');
      }

      const telefones = [...normalizados.keys()];
      const existentes = await this.telefonesJaNaBase(contaId, telefones, db);
      const novos = telefones.filter((t) => !existentes.has(t));

      const [registro] = await db
        .insert(importacao)
        .values({
          contaId,
          formato: dto.formato,
          arquivoNome: dto.arquivoNome ?? null,
          totalLidos: dto.contatos.length,
          validos: telefones.length,
          invalidos: dto.contatos.length - telefones.length,
          novos: novos.length,
          jaExistiam: telefones.length - novos.length,
          listaId: dto.listaId ?? null,
          criadoPor: usuarioId,
        })
        .returning({ id: importacao.id });

      const agora = new Date();
      const evidencia =
        dto.evidencia?.trim() ||
        (dto.arquivoNome ? `Importado do arquivo ${dto.arquivoNome}` : 'Importação manual');

      // `onConflictDoNothing` na unique (conta_id, telefone_e164): reimportar o
      // mesmo arquivo não duplica, e não sobrescreve o consentimento anterior —
      // que pode ser mais antigo e mais forte que este.
      const inseridos = await db
        .insert(contato)
        .values(
          telefones.map((telefone) => ({
            contaId,
            telefoneE164: telefone,
            nome: normalizados.get(telefone) || null,
            consentimentoOrigem: 'declarado' as const,
            consentimentoEm: agora,
            consentimentoEvidencia: evidencia,
            importacaoId: registro!.id,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: contato.id });

      // Vincular à lista usa TODOS os telefones, não só os recém-inseridos: um
      // contato que já existia na base mas não estava nesta lista precisa entrar.
      if (dto.listaId) {
        await this.vincularALista(db, contaId, dto.listaId, telefones);
      }

      await this.auditoria.registrar({
        contaId,
        atorTipo: 'usuario',
        atorUsuarioId: usuarioId,
        acao: 'contato.importado',
        entidade: 'importacao',
        entidadeId: registro!.id,
        detalhe: {
          formato: dto.formato,
          arquivo: dto.arquivoNome ?? null,
          gravados: inseridos.length,
          jaExistiam: telefones.length - inseridos.length,
          lista: dto.listaId ?? null,
        },
      });

      this.log.log(
        `Importação ${registro!.id}: ${inseridos.length} novos, ${telefones.length - inseridos.length} já existiam.`,
      );

      return {
        importacaoId: registro!.id,
        gravados: inseridos.length,
        jaExistiam: telefones.length - inseridos.length,
      };
    });
  }

  // ------------------------------------------------------------------ listas

  async listas(contaId: string) {
    return this.ctx.comConta(contaId, async (db) => {
      const linhas = await db
        .select({
          id: contatoLista.id,
          nome: contatoLista.nome,
          descricao: contatoLista.descricao,
          criadoEm: contatoLista.criadoEm,
        })
        .from(contatoLista)
        .where(eq(contatoLista.contaId, contaId))
        .orderBy(desc(contatoLista.criadoEm));

      // Contagem por lista: uma consulta agregada, não uma por lista.
      const totais = await db
        .select({
          listaId: contatoListaItem.listaId,
          total: count(contatoListaItem.id),
        })
        .from(contatoListaItem)
        .where(eq(contatoListaItem.contaId, contaId))
        .groupBy(contatoListaItem.listaId);

      const porLista = new Map(totais.map((t) => [t.listaId, Number(t.total)]));
      return linhas.map((l) => ({ ...l, total: porLista.get(l.id) ?? 0 }));
    });
  }

  async criarLista(contaId: string, usuarioId: string, nome: string, descricao?: string) {
    const limpo = nome.trim();
    if (limpo.length < 2) throw new BadRequestException('Dê um nome à lista.');

    return this.ctx.comConta(contaId, async (db) => {
      const [criada] = await db
        .insert(contatoLista)
        .values({ contaId, nome: limpo, descricao: descricao?.trim() || null })
        .returning({ id: contatoLista.id });

      await this.auditoria.registrar({
        contaId,
        atorTipo: 'usuario',
        atorUsuarioId: usuarioId,
        acao: 'contato.lista.criada',
        entidade: 'contato_lista',
        entidadeId: criada!.id,
        detalhe: { nome: limpo },
      });

      return { id: criada!.id };
    });
  }

  // ---------------------------------------------------------------- contatos

  /** Contatos da conta, mais recentes primeiro. */
  async listar(contaId: string, pagina = 1, porPagina = 50) {
    const limite = Math.min(Math.max(porPagina, 1), 200);
    const salto = (Math.max(pagina, 1) - 1) * limite;

    return this.ctx.comConta(contaId, async (db) => {
      const [{ total }] = await db
        .select({ total: count(contato.id) })
        .from(contato)
        .where(eq(contato.contaId, contaId));

      const itens = await db
        .select({
          id: contato.id,
          nome: contato.nome,
          telefone: contato.telefoneE164,
          optOut: contato.optOut,
          consentimentoOrigem: contato.consentimentoOrigem,
          consentimentoEm: contato.consentimentoEm,
          criadoEm: contato.criadoEm,
        })
        .from(contato)
        .where(eq(contato.contaId, contaId))
        .orderBy(desc(contato.criadoEm))
        .limit(limite)
        .offset(salto);

      return { total: Number(total), pagina: Math.max(pagina, 1), porPagina: limite, itens };
    });
  }

  /**
   * Descadastra um contato.
   *
   * Marca a linha em vez de apagá-la: apagar deixaria o número livre para
   * voltar na próxima importação, e a pessoa que pediu para sair receberia de
   * novo. A marca é o que impede isso.
   */
  async descadastrar(contaId: string, usuarioId: string, contatoId: string, origem = 'painel') {
    return this.ctx.comConta(contaId, async (db) => {
      const alterados = await db
        .update(contato)
        .set({ optOut: true, optOutEm: new Date(), optOutOrigem: origem })
        .where(and(eq(contato.contaId, contaId), eq(contato.id, contatoId)))
        .returning({ id: contato.id });

      if (!alterados.length) throw new NotFoundException('Contato não encontrado.');

      await this.auditoria.registrar({
        contaId,
        atorTipo: 'usuario',
        atorUsuarioId: usuarioId,
        acao: 'contato.descadastrado',
        entidade: 'contato',
        entidadeId: contatoId,
        detalhe: { origem },
      });

      return { ok: true };
    });
  }

  // ------------------------------------------------------------------ apoio

  /** Lê o arquivo do formato informado e devolve nome + telefones candidatos. */
  private async extrair(
    formato: string,
    conteudo: Buffer | string,
  ): Promise<{ nome: string; telefones: string[] }[]> {
    if (formato === 'vcard') {
      const texto = typeof conteudo === 'string' ? conteudo : conteudo.toString('utf8');
      if (!pareceVcard(texto)) {
        throw new BadRequestException(
          'Este arquivo não parece um .vcf de contatos. Exporte os contatos pelo aplicativo do celular e tente de novo.',
        );
      }
      return lerVcard(texto);
    }

    let linhas: Linha[];
    if (formato === 'xlsx') {
      const buffer = typeof conteudo === 'string' ? Buffer.from(conteudo) : conteudo;
      linhas = await lerXlsx(buffer);
    } else if (formato === 'csv') {
      linhas = lerCsv(typeof conteudo === 'string' ? conteudo : conteudo.toString('utf8'));
    } else if (formato === 'texto') {
      linhas = lerTexto(typeof conteudo === 'string' ? conteudo : conteudo.toString('utf8'));
    } else {
      throw new BadRequestException(`Formato não reconhecido: ${formato}.`);
    }

    if (!linhas.length) throw new BadRequestException('O arquivo está vazio.');

    const colunas = detectarColunas(linhas);
    if (colunas.telefone < 0) {
      throw new BadRequestException(
        'Não encontrei uma coluna de telefone. Nomeie a coluna como "telefone" ou "celular" e tente de novo.',
      );
    }

    const corpo = colunas.temCabecalho ? linhas.slice(1) : linhas;
    return corpo.map((linha) => ({
      nome: colunas.nome >= 0 ? (linha[colunas.nome] ?? '').slice(0, 120) : '',
      telefones: [linha[colunas.telefone] ?? ''],
    }));
  }

  /**
   * Quais destes telefones já estão na base da conta.
   *
   * Em fatias de 500 porque `in (...)` com cinco mil parâmetros derruba o
   * planejador — e porque o driver tem teto de parâmetros por consulta.
   */
  private async telefonesJaNaBase(
    contaId: string,
    telefones: string[],
    db?: Parameters<Parameters<ContextoDb['comConta']>[1]>[0],
  ): Promise<Set<string>> {
    const unicos = [...new Set(telefones.filter(Boolean))];
    if (!unicos.length) return new Set();

    const consultar = async (handle: NonNullable<typeof db>) => {
      const achados = new Set<string>();
      for (let i = 0; i < unicos.length; i += 500) {
        const fatia = unicos.slice(i, i + 500);
        const linhas = await handle
          .select({ telefone: contato.telefoneE164 })
          .from(contato)
          .where(and(eq(contato.contaId, contaId), inArray(contato.telefoneE164, fatia)));
        linhas.forEach((l) => achados.add(l.telefone));
      }
      return achados;
    };

    if (db) return consultar(db);
    return this.ctx.comConta(contaId, (handle) => consultar(handle));
  }

  /** Coloca os telefones na lista, sem duplicar quem já está. */
  private async vincularALista(
    db: Parameters<Parameters<ContextoDb['comConta']>[1]>[0],
    contaId: string,
    listaId: string,
    telefones: string[],
  ): Promise<void> {
    const [lista] = await db
      .select({ id: contatoLista.id })
      .from(contatoLista)
      .where(and(eq(contatoLista.contaId, contaId), eq(contatoLista.id, listaId)))
      .limit(1);

    if (!lista) throw new NotFoundException('Lista não encontrada.');

    for (let i = 0; i < telefones.length; i += 500) {
      const fatia = telefones.slice(i, i + 500);
      const ids = await db
        .select({ id: contato.id })
        .from(contato)
        .where(and(eq(contato.contaId, contaId), inArray(contato.telefoneE164, fatia)));

      if (!ids.length) continue;

      await db
        .insert(contatoListaItem)
        .values(ids.map((c) => ({ contaId, listaId, contatoId: c.id })))
        .onConflictDoNothing();
    }
  }

  /**
   * Quantos contatos elegíveis a lista tem.
   *
   * Elegível = não descadastrado. É o número que a campanha usa como público, e
   * ele NUNCA é lido de contador guardado: contador denormalizado mente no dia
   * em que um dos dois caminhos de atualização falha.
   */
  async publicoDaLista(contaId: string, listaId: string): Promise<number> {
    return this.ctx.comConta(contaId, async (db) => {
      const [linha] = await db
        .select({ total: count(contatoListaItem.id) })
        .from(contatoListaItem)
        .innerJoin(contato, eq(contato.id, contatoListaItem.contatoId))
        .where(
          and(
            eq(contatoListaItem.contaId, contaId),
            eq(contatoListaItem.listaId, listaId),
            eq(contato.optOut, false),
          ),
        );
      return Number(linha?.total ?? 0);
    });
  }
}
