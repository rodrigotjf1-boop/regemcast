/**
 * Modelos de mensagem: escrever, conferir e submeter à Meta.
 *
 * O fluxo tem um passo que o painel da Meta não tem: **rascunho**. Um modelo
 * leva minutos para ser escrito e é recusado por detalhes que o formulário dela
 * não menciona — variável colada no fim do corpo, rodapé junto de oferta por
 * tempo limitado, exemplo de cabeçalho em array aninhado. Sem rascunho, cada
 * recusa apaga o trabalho e o cliente recomeça do zero.
 *
 * E há um passo que ela não faz de jeito nenhum: conferir ANTES. As regras
 * moram em `regras-modelo.ts` e rodam aqui, devolvendo o que corrigir em
 * português, antes de qualquer coisa sair daqui.
 */
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';

import { ContextoDb } from '../../db/contexto';
import { modelo } from '../../db/schema';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { ErroGraph, GraphService } from '../meta/graph.service';
import { MetaService } from '../meta/meta.service';
import type { SalvarModeloDto } from './dto/salvar-modelo.dto';
import {
  conferirModelo,
  quantasVariaveis,
  type BotaoDoModelo,
  type ModeloParaValidar,
  type ProblemaNoModelo,
} from './regras-modelo';

/** Um modelo como a tela lista. */
export interface ResumoModelo {
  id: string;
  nome: string;
  idioma: string;
  categoria: string;
  /** A categoria que a Meta devolveu, quando reclassificou. */
  categoriaMeta: string | null;
  status: string;
  motivo: string | null;
  corpo: string;
  cabecalhoTexto: string | null;
  rodape: string | null;
  /** Quantas variáveis distintas o corpo usa. */
  variaveis: number;
  criadoEm: Date;
}

@Injectable()
export class ModeloService {
  private readonly log = new Logger('Modelo');

  constructor(
    private readonly ctx: ContextoDb,
    private readonly meta: MetaService,
    private readonly graph: GraphService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /** Confere sem gravar nada. É o botão "conferir regras" da tela. */
  conferir(dto: SalvarModeloDto): ProblemaNoModelo[] {
    return conferirModelo(this.paraValidacao(dto));
  }

  /** Modelos da conta, mais recentes primeiro. */
  async listar(contaId: string): Promise<ResumoModelo[]> {
    return this.ctx.comConta(contaId, async (db) => {
      const linhas = await db
        .select()
        .from(modelo)
        .where(eq(modelo.contaId, contaId))
        .orderBy(desc(modelo.criadoEm));

      return linhas.map((l) => ({
        id: l.id,
        nome: l.nome,
        idioma: l.idioma,
        categoria: l.categoria,
        categoriaMeta: l.categoriaMeta,
        status: l.status,
        motivo: l.motivo,
        corpo: l.corpo,
        cabecalhoTexto: l.cabecalhoTexto,
        rodape: l.rodape,
        variaveis: quantasVariaveis(l.corpo),
        criadoEm: l.criadoEm,
      }));
    });
  }

  /**
   * Salva o rascunho.
   *
   * Um rascunho pode estar errado: é rascunho. As regras da Meta só travam no
   * envio. Barrar aqui obrigaria a pessoa a escrever o modelo inteiro sem
   * conseguir sair da tela no meio.
   */
  async salvarRascunho(
    contaId: string,
    usuarioId: string,
    dto: SalvarModeloDto,
    id?: string,
  ): Promise<{ id: string }> {
    const nome = (dto.nome ?? '').trim();
    if (!nome) throw new BadRequestException('Dê um nome técnico ao modelo.');

    return this.ctx.comConta(contaId, async (db) => {
      const valores = {
        contaId,
        nome,
        idioma: dto.idioma ?? 'pt_BR',
        categoria: dto.categoria ?? 'MARKETING',
        cabecalhoFormato: dto.cabecalhoFormato ?? null,
        cabecalhoTexto: dto.cabecalhoTexto ?? null,
        cabecalhoExemplo: dto.cabecalhoExemplo ?? null,
        cabecalhoMidia: dto.cabecalhoMidia ?? null,
        corpo: dto.corpo ?? '',
        corpoExemplos: dto.corpoExemplos ?? [],
        rodape: dto.rodape ?? null,
        botoes: dto.botoes ?? [],
        ltoAtivo: dto.ltoAtivo ?? false,
        ltoTexto: dto.ltoTexto ?? null,
      };

      if (id) {
        const atual = await this.buscar(db, contaId, id);
        if (atual.status !== 'rascunho' && atual.status !== 'rejeitado') {
          // Modelo já submetido não se edita: a Meta guarda a versão dela, e
          // mudar a nossa faria a tela mentir sobre o que foi aprovado.
          throw new BadRequestException(
            'Este modelo já foi enviado para a Meta e não pode mais ser editado. Crie outro com um nome novo.',
          );
        }

        await db
          .update(modelo)
          .set({ ...valores, status: 'rascunho', motivo: null })
          .where(and(eq(modelo.contaId, contaId), eq(modelo.id, id)));

        return { id };
      }

      const [criado] = await db
        .insert(modelo)
        .values({ ...valores, status: 'rascunho', criadoPor: usuarioId })
        .returning({ id: modelo.id });

      await this.auditoria.registrar({
        contaId,
        atorTipo: 'usuario',
        atorUsuarioId: usuarioId,
        acao: 'modelo.rascunho.criado',
        entidade: 'modelo',
        entidadeId: criado!.id,
        detalhe: { nome, categoria: valores.categoria },
      });

      return { id: criado!.id };
    });
  }

  /**
   * Submete o modelo à Meta.
   *
   * Confere primeiro. Se algo estiver errado, a resposta lista TUDO que precisa
   * ser corrigido, em português — e nada é enviado. A Meta devolveria uma
   * mensagem genérica, horas depois, sobre o primeiro problema que encontrasse.
   */
  async enviarParaAprovacao(
    contaId: string,
    usuarioId: string,
    id: string,
  ): Promise<{ status: string; motivo: string | null }> {
    const credencial = await this.meta.tokenDaConta(contaId);
    if (!credencial) {
      throw new BadRequestException('Conecte sua conta do WhatsApp antes de criar modelos.');
    }

    const atual = await this.ctx.comConta(contaId, (db) => this.buscar(db, contaId, id));

    if (atual.status !== 'rascunho' && atual.status !== 'rejeitado') {
      throw new BadRequestException(
        `Este modelo já foi enviado (está "${atual.status}"). Crie outro para submeter de novo.`,
      );
    }

    const problemas = conferirModelo(this.paraValidacao(atual as unknown as SalvarModeloDto));
    if (problemas.length) {
      throw new BadRequestException({
        mensagem: 'O modelo precisa de ajustes antes de ir para a Meta.',
        problemas,
      });
    }

    const corpo = this.montarComponentes(atual as unknown as SalvarModeloDto);

    // A chamada fica FORA da transação: uma ida à Meta pode levar segundos, e
    // segurar a conexão de banco enquanto isso é o que esgota o pool sob carga.
    let resposta: { id: string; status?: string; category?: string };
    try {
      resposta = await this.graph.criarModelo(credencial.wabaId, credencial.token, corpo);
    } catch (erro) {
      const g = erro instanceof ErroGraph ? erro : null;
      const motivo = g?.mensagemParaUsuario ?? 'A Meta recusou o modelo.';

      this.log.warn(`Modelo ${atual.nome} recusado: ${g?.detalheParaLog ?? String(erro)}`);

      // O motivo é gravado AGORA porque a Meta o diz uma vez só. Sem isto, o
      // cliente tenta de novo às cegas.
      await this.ctx.comConta(contaId, (db) =>
        db
          .update(modelo)
          .set({ status: 'rejeitado', motivo, respondidoEm: new Date() })
          .where(and(eq(modelo.contaId, contaId), eq(modelo.id, id))),
      );

      throw new BadRequestException(motivo);
    }

    // A Meta devolve APPROVED, PENDING ou REJECTED. "PENDING" é o normal: a
    // análise leva minutos ou horas, e o estado final chega por webhook.
    const status = (resposta.status ?? 'PENDING').toUpperCase() === 'APPROVED' ? 'aprovado' : 'enviado';

    await this.ctx.comConta(contaId, async (db) => {
      await db
        .update(modelo)
        .set({
          status,
          metaTemplateId: resposta.id,
          // Guardada separada da nossa: a Meta reclassifica utilidade que ela
          // considera marketing, e o preço da mensagem muda junto.
          categoriaMeta: resposta.category ?? null,
          motivo: null,
          enviadoEm: new Date(),
          respondidoEm: status === 'aprovado' ? new Date() : null,
        })
        .where(and(eq(modelo.contaId, contaId), eq(modelo.id, id)));

      await this.auditoria.registrar({
        contaId,
        atorTipo: 'usuario',
        atorUsuarioId: usuarioId,
        acao: 'modelo.enviado',
        entidade: 'modelo',
        entidadeId: id,
        detalhe: { nome: atual.nome, metaId: resposta.id, status },
      });
    });

    return { status, motivo: null };
  }

  /** Apaga o rascunho. Modelo já enviado sai pela Meta, não por aqui. */
  async excluir(contaId: string, usuarioId: string, id: string): Promise<{ ok: true }> {
    return this.ctx.comConta(contaId, async (db) => {
      const atual = await this.buscar(db, contaId, id);

      if (atual.status !== 'rascunho' && atual.status !== 'rejeitado') {
        throw new BadRequestException(
          'Este modelo está na Meta. Para removê-lo, use a opção de excluir na lista de modelos aprovados.',
        );
      }

      await db.delete(modelo).where(and(eq(modelo.contaId, contaId), eq(modelo.id, id)));

      await this.auditoria.registrar({
        contaId,
        atorTipo: 'usuario',
        atorUsuarioId: usuarioId,
        acao: 'modelo.excluido',
        entidade: 'modelo',
        entidadeId: id,
        detalhe: { nome: atual.nome },
      });

      return { ok: true as const };
    });
  }

  // ------------------------------------------------------------------ apoio

  private async buscar(
    db: Parameters<Parameters<ContextoDb['comConta']>[1]>[0],
    contaId: string,
    id: string,
  ) {
    const [achado] = await db
      .select()
      .from(modelo)
      .where(and(eq(modelo.contaId, contaId), eq(modelo.id, id)))
      .limit(1);

    if (!achado) throw new NotFoundException('Modelo não encontrado.');
    return achado;
  }

  /** O DTO no formato que as regras entendem. */
  private paraValidacao(dto: SalvarModeloDto): ModeloParaValidar {
    return {
      nome: dto.nome ?? '',
      idioma: dto.idioma ?? 'pt_BR',
      categoria: (dto.categoria ?? 'MARKETING') as ModeloParaValidar['categoria'],
      cabecalhoFormato: dto.cabecalhoFormato ?? null,
      cabecalhoTexto: dto.cabecalhoTexto ?? null,
      cabecalhoExemplo: dto.cabecalhoExemplo ?? null,
      cabecalhoMidia: dto.cabecalhoMidia ?? null,
      corpo: dto.corpo ?? '',
      corpoExemplos: dto.corpoExemplos ?? [],
      rodape: dto.rodape ?? null,
      botoes: (dto.botoes ?? []) as BotaoDoModelo[],
      ltoAtivo: dto.ltoAtivo ?? false,
      ltoTexto: dto.ltoTexto ?? null,
    };
  }

  /**
   * Monta os componentes no formato da Graph.
   *
   * Duas armadilhas moram aqui, e as duas custaram modelo recusado no Regem:
   *
   * 1. O exemplo do CABEÇALHO vai em array SIMPLES (`["Maria"]`); o do CORPO vai
   *    em array ANINHADO (`[["Maria"]]`). Trocar os dois é a recusa mais comum.
   * 2. A oferta por tempo limitado entra ENTRE o cabeçalho e o corpo, nessa
   *    ordem exata, e proíbe rodapé.
   */
  private montarComponentes(dto: SalvarModeloDto): Record<string, unknown> {
    const componentes: Record<string, unknown>[] = [];
    const ehLto = !!dto.ltoAtivo;

    if (dto.cabecalhoFormato === 'TEXT' && !ehLto) {
      const cabecalho: Record<string, unknown> = {
        type: 'HEADER',
        format: 'TEXT',
        text: dto.cabecalhoTexto,
      };
      if (/\{\{\s*1\s*\}\}/.test(dto.cabecalhoTexto ?? '')) {
        // Array SIMPLES. O corpo, logo abaixo, usa aninhado.
        cabecalho.example = { header_text: [(dto.cabecalhoExemplo ?? '').trim() || 'exemplo'] };
      }
      componentes.push(cabecalho);
    } else if (dto.cabecalhoFormato && dto.cabecalhoFormato !== 'TEXT' && dto.cabecalhoMidia) {
      componentes.push({
        type: 'HEADER',
        format: dto.cabecalhoFormato,
        example: { header_handle: [dto.cabecalhoMidia] },
      });
    }

    if (ehLto) {
      componentes.push({
        type: 'LIMITED_TIME_OFFER',
        limited_time_offer: {
          text: (dto.ltoTexto ?? '').trim() || 'Oferta!',
          has_expiration: true,
        },
      });
    }

    const corpo: Record<string, unknown> = { type: 'BODY', text: dto.corpo };
    const exemplos = (dto.corpoExemplos ?? []).filter((e) => (e ?? '').trim().length > 0);
    if (exemplos.length) {
      // Array ANINHADO. É o formato que a Meta espera para o corpo.
      corpo.example = { body_text: [exemplos] };
    }
    componentes.push(corpo);

    if (dto.rodape && !ehLto) componentes.push({ type: 'FOOTER', text: dto.rodape });

    const botoes = this.montarBotoes((dto.botoes ?? []) as BotaoDoModelo[]);
    if (botoes.length) componentes.push({ type: 'BUTTONS', buttons: botoes });

    return {
      name: dto.nome,
      language: dto.idioma ?? 'pt_BR',
      category: dto.categoria ?? 'MARKETING',
      components: componentes,
    };
  }

  private montarBotoes(botoes: BotaoDoModelo[]): Record<string, unknown>[] {
    return botoes.map((b) => {
      if (b.tipo === 'URL') return { type: 'URL', text: b.texto, url: b.url };
      if (b.tipo === 'PHONE_NUMBER') {
        return { type: 'PHONE_NUMBER', text: b.texto, phone_number: b.telefone };
      }
      if (b.tipo === 'COPY_CODE') return { type: 'COPY_CODE', example: b.texto };
      return { type: 'QUICK_REPLY', text: b.texto };
    });
  }
}
