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
import { MidiaService } from '../midia/midia.service';
import type { SalvarModeloDto } from './dto/salvar-modelo.dto';
import {
  botoesComSaida,
  conferirModelo,
  quantasVariaveis,
  type BotaoDoModelo,
  type CartaoDoModelo,
  type ModeloParaValidar,
  type ProblemaNoModelo,
} from './regras-modelo';

/**
 * Um modelo como a tela lista.
 *
 * Vem INTEIRO, e nao so o resumo, porque a tela precisa reabrir o rascunho para
 * edicao. Rascunho que nao da para reabrir nao e rascunho.
 */
export interface ResumoModelo {
  id: string;
  tipo: string;
  nome: string;
  idioma: string;
  categoria: string;
  /** A categoria que a Meta devolveu, quando reclassificou. */
  categoriaMeta: string | null;
  status: string;
  motivo: string | null;
  corpo: string;
  cabecalhoFormato: string | null;
  cabecalhoTexto: string | null;
  cabecalhoExemplo: string | null;
  cabecalhoMidia: string | null;
  corpoExemplos: string[];
  rodape: string | null;
  botoes: unknown[];
  cartoes: unknown[];
  ltoAtivo: boolean;
  ltoTexto: string | null;
  /** Id na Meta. Preenchido = o modelo existe lá, e editar/excluir chega até ela. */
  metaTemplateId: string | null;
  /** Quando a última edição foi aceita pela Meta. Aprovado aceita 1 a cada 24h. */
  editadoMetaEm: Date | null;
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
    private readonly midia: MidiaService,
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
        tipo: l.tipo,
        nome: l.nome,
        idioma: l.idioma,
        categoria: l.categoria,
        categoriaMeta: l.categoriaMeta,
        status: l.status,
        motivo: l.motivo,
        corpo: l.corpo,
        cabecalhoFormato: l.cabecalhoFormato,
        cabecalhoTexto: l.cabecalhoTexto,
        cabecalhoExemplo: l.cabecalhoExemplo,
        cabecalhoMidia: l.cabecalhoMidia,
        corpoExemplos: (l.corpoExemplos as string[]) ?? [],
        rodape: l.rodape,
        botoes: (l.botoes as unknown[]) ?? [],
        cartoes: (l.cartoes as unknown[]) ?? [],
        ltoAtivo: l.ltoAtivo,
        ltoTexto: l.ltoTexto,
        metaTemplateId: l.metaTemplateId,
        editadoMetaEm: l.editadoMetaEm,
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
        tipo: dto.tipo ?? 'simples',
        cartoes: dto.cartoes ?? [],
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
        if (atual.status === 'enviado') {
          // Em análise a Meta ainda não decidiu; editar agora é editar uma
          // versão que não existe de nenhum dos dois lados.
          throw new BadRequestException(
            'Este modelo está em análise na Meta. Espere a resposta para editar.',
          );
        }
        if (atual.metaTemplateId) {
          // Rede de segurança: modelo que existe na Meta é editado por
          // `editarNaMeta`, e quem escolhe o caminho é `salvar`.
          throw new BadRequestException(
            'Este modelo está na Meta. Use a edição que envia a alteração para ela.',
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
   * O que a tela chama ao salvar.
   *
   * Um caminho só, porque a pessoa só vê "salvar": se o modelo ainda não existe
   * na Meta, grava aqui; se já existe, a alteração vai até lá. Deixar essa
   * escolha para a tela significaria que um dia ela escolheria errado.
   */
  async salvar(
    contaId: string,
    usuarioId: string,
    dto: SalvarModeloDto,
    id?: string,
  ): Promise<{ id: string; status?: string }> {
    if (!id) return this.salvarRascunho(contaId, usuarioId, dto);

    const atual = await this.ctx.comConta(contaId, (db) => this.buscar(db, contaId, id));
    if (!atual.metaTemplateId) return this.salvarRascunho(contaId, usuarioId, dto, id);

    const r = await this.editarNaMeta(contaId, usuarioId, id, dto);
    return { id, status: r.status };
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

    // A mídia chega como REFERÊNCIA (arquivo guardado ou endereço) e precisa
    // virar `header_handle` antes de montar o modelo: a Meta não busca a URL,
    // ela recebe os bytes. Trocar aqui, e não ao salvar o rascunho, evita subir
    // arquivo para a Meta de um modelo que talvez nunca seja enviado.
    let comHandles: SalvarModeloDto;
    try {
      comHandles = await this.resolverMidias(contaId, atual as unknown as SalvarModeloDto);
    } catch (erro) {
      const g = erro instanceof ErroGraph ? erro : null;
      if (g) {
        this.log.warn(`Mídia do modelo ${atual.nome} recusada: ${g.detalheParaLog}`);
        throw new BadRequestException(g.mensagemParaUsuario);
      }
      throw erro;
    }

    const corpo = this.montarComponentes(comHandles);

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

  /**
   * Exclui o modelo — aqui e, quando ele existe lá, na Meta.
   *
   * Duas consequências que o cliente precisa saber ANTES, e que a tela avisa:
   *
   * - mensagens já enviadas e ainda não entregues continuam sendo tentadas por
   *   30 dias; excluir não cancela o que já saiu;
   * - o NOME só volta a ficar livre depois de 30 dias.
   *
   * A ordem é: apaga na Meta primeiro, depois aqui. Se a Meta recusar, nada
   * some do nosso lado — o contrário deixaria um modelo órfão lá, ocupando o
   * nome, sem nenhuma tela onde ele apareça.
   */
  async excluir(contaId: string, usuarioId: string, id: string): Promise<{ ok: true; naMeta: boolean }> {
    const atual = await this.ctx.comConta(contaId, (db) => this.buscar(db, contaId, id));

    if (atual.status === 'enviado') {
      throw new BadRequestException(
        'Este modelo está em análise na Meta. Espere a resposta — depois dela dá para excluir.',
      );
    }

    const naMeta = Boolean(atual.metaTemplateId);
    if (naMeta) {
      const credencial = await this.meta.tokenDaConta(contaId);
      if (!credencial) {
        throw new BadRequestException(
          'Reconecte o WhatsApp antes de excluir: este modelo está na Meta e precisa ser apagado lá também.',
        );
      }
      try {
        await this.graph.excluirModelo(
          credencial.wabaId,
          credencial.token,
          atual.nome,
          atual.metaTemplateId,
        );
      } catch (erro) {
        const g = erro instanceof ErroGraph ? erro : null;
        this.log.warn(`Não consegui excluir o modelo ${atual.nome} na Meta: ${g?.detalheParaLog ?? String(erro)}`);
        throw new BadRequestException(g?.mensagemParaUsuario ?? 'A Meta não conseguiu excluir este modelo agora.');
      }
    }

    return this.ctx.comConta(contaId, async (db) => {
      await db.delete(modelo).where(and(eq(modelo.contaId, contaId), eq(modelo.id, id)));

      await this.auditoria.registrar({
        contaId,
        atorTipo: 'usuario',
        atorUsuarioId: usuarioId,
        acao: 'modelo.excluido',
        entidade: 'modelo',
        entidadeId: id,
        detalhe: { nome: atual.nome, naMeta },
      });

      return { ok: true as const, naMeta };
    });
  }

  /**
   * Edita um modelo que JÁ está na Meta (aprovado ou recusado).
   *
   * Três coisas que só existem aqui:
   *
   * 1. **O limite da Meta.** Modelo aprovado aceita uma edição a cada 24 horas
   *    (e dez a cada 30 dias). Conferimos a janela de 24h ANTES de o cliente
   *    reescrever tudo — a Meta só diria isso depois, com erro genérico.
   * 2. **A categoria não vai junto.** Ela não muda em modelo aprovado; mandá-la
   *    faz a Meta recusar a edição inteira.
   * 3. **O status verdadeiro vem dela.** Depois da edição relemos o modelo na
   *    Meta em vez de adivinhar: dependendo do que mudou, ele volta para
   *    análise ou continua aprovado, e a tela precisa dizer o que é fato.
   */
  async editarNaMeta(
    contaId: string,
    usuarioId: string,
    id: string,
    dto: SalvarModeloDto,
  ): Promise<{ status: string; motivo: string | null }> {
    const atual = await this.ctx.comConta(contaId, (db) => this.buscar(db, contaId, id));

    if (!atual.metaTemplateId) {
      throw new BadRequestException('Este modelo ainda não está na Meta. Envie para aprovação primeiro.');
    }
    if (atual.status === 'enviado') {
      throw new BadRequestException('Este modelo está em análise na Meta. Espere a resposta para editar.');
    }

    if (atual.status === 'aprovado' && atual.editadoMetaEm) {
      const passou = Date.now() - atual.editadoMetaEm.getTime();
      const faltam = Math.ceil((24 * 3_600_000 - passou) / 3_600_000);
      if (faltam > 0) {
        throw new BadRequestException(
          `A Meta aceita uma edição por dia em modelo aprovado. Dá para editar este de novo em ${faltam} hora(s).`,
        );
      }
    }

    // A categoria é a que já está lá: muda-la é modelo novo, não edição.
    const paraValidar = { ...dto, categoria: atual.categoria as SalvarModeloDto['categoria'] };
    const problemas = conferirModelo(this.paraValidacao(paraValidar));
    if (problemas.length) {
      throw new BadRequestException({
        mensagem: 'O modelo tem pontos a corrigir antes de ir para a Meta.',
        problemas,
      });
    }

    const credencial = await this.meta.tokenDaConta(contaId);
    if (!credencial) {
      throw new BadRequestException('Conecte sua conta do WhatsApp antes de editar o modelo.');
    }

    const comHandles = await this.resolverMidias(contaId, paraValidar);
    const corpo = this.montarComponentes(comHandles);
    const componentes = (corpo.components ?? []) as Record<string, unknown>[];

    try {
      await this.graph.editarModelo(atual.metaTemplateId, credencial.token, componentes);
    } catch (erro) {
      const g = erro instanceof ErroGraph ? erro : null;
      this.log.warn(`Edição do modelo ${atual.nome} recusada: ${g?.detalheParaLog ?? String(erro)}`);
      throw new BadRequestException(g?.mensagemParaUsuario ?? 'A Meta recusou a edição do modelo.');
    }

    // O status real, dito por ela. Se a leitura falhar, ficamos com "enviado":
    // é o mais conservador — a tela mostra "em análise" até a próxima leitura,
    // e nunca promete aprovado o que talvez não esteja.
    let status = 'enviado';
    let categoriaMeta: string | null = atual.categoriaMeta;
    try {
      const lido = await this.graph.lerModelo(atual.metaTemplateId, credencial.token);
      const bruto = (lido.status ?? '').toUpperCase();
      if (bruto === 'APPROVED') status = 'aprovado';
      else if (bruto === 'REJECTED') status = 'rejeitado';
      categoriaMeta = lido.category ?? categoriaMeta;
    } catch (erro) {
      this.log.warn(`Não consegui reler o modelo ${atual.nome} depois da edição: ${String(erro)}`);
    }

    await this.ctx.comConta(contaId, async (db) => {
      await db
        .update(modelo)
        .set({
          tipo: dto.tipo ?? 'simples',
          cartoes: dto.cartoes ?? [],
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
          status,
          categoriaMeta,
          motivo: null,
          editadoMetaEm: new Date(),
          respondidoEm: status === 'enviado' ? null : new Date(),
        })
        .where(and(eq(modelo.contaId, contaId), eq(modelo.id, id)));

      await this.auditoria.registrar({
        contaId,
        atorTipo: 'usuario',
        atorUsuarioId: usuarioId,
        acao: 'modelo.editado_na_meta',
        entidade: 'modelo',
        entidadeId: id,
        detalhe: { nome: atual.nome, status },
      });
    });

    return { status, motivo: null };
  }

  // ------------------------------------------------------------------ apoio

  /**
   * Troca cada referência de mídia pelo handle da Meta.
   *
   * Em sequência, e não em paralelo: um carrossel de dez cartões subindo dez
   * arquivos ao mesmo tempo bate no limite de chamadas do app, e o que falha
   * primeiro derruba os outros nove sem dizer qual.
   */
  private async resolverMidias(contaId: string, dto: SalvarModeloDto): Promise<SalvarModeloDto> {
    const resolvido: SalvarModeloDto = { ...dto };

    const ehMidia = dto.cabecalhoFormato && dto.cabecalhoFormato !== 'TEXT';
    if (dto.tipo !== 'carrossel' && ehMidia && dto.cabecalhoMidia) {
      resolvido.cabecalhoMidia = await this.midia.handleParaModelo(contaId, dto.cabecalhoMidia);
    }

    if (dto.tipo === 'carrossel' && dto.cartoes?.length) {
      const cartoes = [];
      for (const cartao of dto.cartoes) {
        cartoes.push({
          ...cartao,
          imagem: cartao.imagem ? await this.midia.handleParaModelo(contaId, cartao.imagem) : cartao.imagem,
        });
      }
      resolvido.cartoes = cartoes;
    }

    return resolvido;
  }


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
      tipo: dto.tipo ?? 'simples',
      cartoes: (dto.cartoes ?? []) as CartaoDoModelo[],
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

    // O carrossel é outra forma, não uma variação: BODY (o balão que aparece
    // acima) seguido de um CAROUSEL com os cartões. Sem cabeçalho, sem rodapé,
    // sem oferta — por isso sai por um caminho próprio em vez de acumular
    // condicionais no caminho do modelo simples.
    if (dto.tipo === 'carrossel') {
      const corpoCarrossel: Record<string, unknown> = { type: 'BODY', text: dto.corpo };
      const exemplosCarrossel = (dto.corpoExemplos ?? []).filter((e) => (e ?? '').trim().length > 0);
      if (exemplosCarrossel.length) {
        corpoCarrossel.example = { body_text: [exemplosCarrossel] };
      }
      componentes.push(corpoCarrossel);

      componentes.push({
        type: 'CAROUSEL',
        cards: (dto.cartoes ?? []).map((cartao) => ({
          components: [
            {
              type: 'HEADER',
              format: 'IMAGE',
              example: { header_handle: [cartao.imagem] },
            },
            { type: 'BODY', text: cartao.corpo },
            { type: 'BUTTONS', buttons: this.montarBotoes((cartao.botoes ?? []) as BotaoDoModelo[]) },
          ],
        })),
      });

      return {
        name: dto.nome,
        language: dto.idioma ?? 'pt_BR',
        category: dto.categoria ?? 'MARKETING',
        components: componentes,
      };
    }

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

    // O botão de saída entra aqui, e não no que o cliente digitou: assim ele
    // vale também para modelos salvos antes desta regra existir.
    const botoes = this.montarBotoes(
      botoesComSaida({
        categoria: (dto.categoria ?? 'MARKETING') as 'MARKETING' | 'UTILITY' | 'AUTHENTICATION',
        tipo: dto.tipo ?? 'simples',
        botoes: (dto.botoes ?? []) as BotaoDoModelo[],
      }),
    );
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
