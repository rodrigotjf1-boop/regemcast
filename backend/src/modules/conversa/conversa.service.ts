/**
 * A tela de conversas: listar, abrir, responder, marcar como lida, abrir mídia
 * e o prazo de guarda.
 *
 * O que CHEGA (histórico, mensagens ao vivo, ecos do celular) é gravado do lado
 * do webhook, em `meta/conversas.service.ts`. Aqui é o lado da tela: tudo na
 * transação do request, com a RLS da conta.
 *
 * Só existe para conta com algum número em coexistência cujo dono respondeu
 * "sim". A trava é no servidor — conta sem isso recebe 404 em toda rota,
 * mesmo digitando o endereço; o menu escondido é só a consequência.
 */
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, desc, eq, like, lt, or, sql, type SQL } from 'drizzle-orm';

import { env } from '../../config/env';
import { ContextoDb } from '../../db/contexto';
import { conta, contato, conversa, mensagem, usuario, waConta, waNumero } from '../../db/schema';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { resumoDaMensagem } from '../meta/conversas.regras';
import { decifrarToken } from '../meta/cripto';
import { ErroGraph, ErroMidia, GraphService } from '../meta/graph.service';

/** A janela de texto livre: 24 horas desde a última mensagem do cliente. */
const JANELA_MS = 24 * 3_600_000;
/** Mensagens por página ao abrir uma conversa. */
const POR_PAGINA = 60;
/** Conversas na lista. A busca alcança as que ficam de fora. */
const CONVERSAS_NA_LISTA = 100;
/** A mídia passa pela memória do servidor: acima disto, abrir no celular. */
const TETO_MIDIA = 25 * 1024 * 1024;

/**
 * Tipos que o navegador pode mostrar embutidos. Qualquer outro sai como
 * download, com tipo genérico — um HTML ou SVG servido pelo nosso domínio
 * seria um jeito de rodar script na sessão do lojista.
 */
const MIDIA_EMBUTIVEL = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'audio/ogg',
  'audio/mpeg',
  'audio/mp4',
  'audio/aac',
  'audio/amr',
  'video/mp4',
  'video/3gpp',
]);

export interface ConversaResumo {
  id: string;
  telefone: string;
  /** O nome do contato na base; sem ele, o nome do perfil no WhatsApp. */
  nome: string | null;
  contatoId: string | null;
  /** A pessoa pediu para sair das promoções (continua podendo receber resposta). */
  optOut: boolean;
  naoLidas: number;
  ultimaMensagem: string | null;
  ultimaMensagemEm: string | null;
  /** Até quando dá para responder com texto livre. `null` = janela fechada. */
  janelaAteEm: string | null;
  /** O número da empresa desta conversa (a conta pode ter mais de um). */
  numero: string | null;
}

export interface MensagemDaConversa {
  id: string;
  direcao: 'entrada' | 'saida';
  origem: string;
  tipo: string;
  texto: string | null;
  temMidia: boolean;
  midiaMime: string | null;
  midiaNome: string | null;
  status: string | null;
  erroCodigo: number | null;
  erroTitulo: string | null;
  enviadaPor: string | null;
  criadaEm: string;
}

function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

function janelaAte(ultimaEntradaEm: Date | null): Date | null {
  if (!ultimaEntradaEm) return null;
  const fim = new Date(ultimaEntradaEm.getTime() + JANELA_MS);
  return fim.getTime() > Date.now() ? fim : null;
}

/** Texto de busca seguro para LIKE: `%` e `_` do usuário valem como eles mesmos. */
function padraoDeBusca(termo: string): string {
  return `%${termo.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

@Injectable()
export class ConversaService {
  private readonly log = new Logger('Conversas');

  constructor(
    private readonly ctx: ContextoDb,
    private readonly graph: GraphService,
    private readonly auditoria: AuditoriaService,
  ) {}

  // ------------------------------------------------------------ a trava

  /** Algum número da conta guarda conversas? (coexistência + resposta "sim") */
  async habilitadas(contaId: string): Promise<boolean> {
    const [linha] = await this.ctx.db
      .select({ id: waNumero.id })
      .from(waNumero)
      .where(and(eq(waNumero.contaId, contaId), eq(waNumero.coexistencia, true), eq(waNumero.integrarConversas, true)))
      .limit(1);
    return Boolean(linha);
  }

  private async exigirHabilitadas(contaId: string): Promise<void> {
    if (!(await this.habilitadas(contaId))) {
      throw new NotFoundException(
        'As conversas não estão ligadas nesta conta. Ligue em WhatsApp → "Contatos e conversas do celular".',
      );
    }
  }

  // ------------------------------------------------------------ leitura

  private camposDaConversa() {
    return {
      id: conversa.id,
      telefone: conversa.telefoneE164,
      nomeContato: contato.nome,
      nomePerfil: conversa.nomePerfil,
      contatoId: contato.id,
      optOut: contato.optOut,
      naoLidas: conversa.naoLidas,
      ultimaMensagem: conversa.ultimaMensagem,
      ultimaMensagemEm: conversa.ultimaMensagemEm,
      ultimaEntradaEm: conversa.ultimaEntradaEm,
      numero: waNumero.telefoneE164,
    };
  }

  private paraResumo(l: {
    id: string;
    telefone: string;
    nomeContato: string | null;
    nomePerfil: string | null;
    contatoId: string | null;
    optOut: boolean | null;
    naoLidas: number;
    ultimaMensagem: string | null;
    ultimaMensagemEm: Date | null;
    ultimaEntradaEm: Date | null;
    numero: string | null;
  }): ConversaResumo {
    return {
      id: l.id,
      telefone: l.telefone,
      nome: l.nomeContato ?? l.nomePerfil,
      contatoId: l.contatoId,
      optOut: l.optOut === true,
      naoLidas: l.naoLidas,
      ultimaMensagem: l.ultimaMensagem,
      ultimaMensagemEm: iso(l.ultimaMensagemEm),
      janelaAteEm: iso(janelaAte(l.ultimaEntradaEm)),
      numero: l.numero,
    };
  }

  /** As conversas da conta, a mais recente primeiro. Busca por nome ou telefone. */
  async listar(contaId: string, busca?: string): Promise<ConversaResumo[]> {
    await this.exigirHabilitadas(contaId);

    const termo = busca?.trim().slice(0, 80) ?? '';
    const digitos = termo.replace(/\D/g, '');
    let filtro: SQL | undefined = eq(conversa.contaId, contaId);
    if (termo) {
      const porNome = sql`coalesce(${contato.nome}, ${conversa.nomePerfil}, '') ilike ${padraoDeBusca(termo)}`;
      filtro = and(filtro, digitos.length >= 3 ? or(porNome, like(conversa.telefoneE164, padraoDeBusca(digitos))) : porNome);
    }

    const linhas = await this.ctx.db
      .select(this.camposDaConversa())
      .from(conversa)
      .innerJoin(waNumero, eq(waNumero.id, conversa.waNumeroId))
      .leftJoin(contato, and(eq(contato.contaId, conversa.contaId), eq(contato.telefoneE164, conversa.telefoneE164)))
      .where(filtro)
      .orderBy(sql`${conversa.ultimaMensagemEm} desc nulls last`)
      .limit(CONVERSAS_NA_LISTA);

    return linhas.map((l) => this.paraResumo(l));
  }

  async detalhe(contaId: string, conversaId: string): Promise<ConversaResumo> {
    await this.exigirHabilitadas(contaId);
    const [l] = await this.ctx.db
      .select(this.camposDaConversa())
      .from(conversa)
      .innerJoin(waNumero, eq(waNumero.id, conversa.waNumeroId))
      .leftJoin(contato, and(eq(contato.contaId, conversa.contaId), eq(contato.telefoneE164, conversa.telefoneE164)))
      .where(and(eq(conversa.contaId, contaId), eq(conversa.id, conversaId)))
      .limit(1);
    if (!l) throw new NotFoundException('Conversa não encontrada.');
    return this.paraResumo(l);
  }

  /**
   * As mensagens de uma conversa, da mais antiga para a mais nova, em páginas.
   * `antesDe` pede a página anterior (rolar para cima).
   */
  async mensagens(contaId: string, conversaId: string, antesDe?: Date): Promise<MensagemDaConversa[]> {
    await this.detalhe(contaId, conversaId);

    const linhas = await this.ctx.db
      .select({
        id: mensagem.id,
        direcao: mensagem.direcao,
        origem: mensagem.origem,
        tipo: mensagem.tipo,
        texto: mensagem.texto,
        temMidia: sql<boolean>`${mensagem.midiaId} is not null`,
        midiaMime: mensagem.midiaMime,
        midiaNome: mensagem.midiaNome,
        status: mensagem.status,
        erroCodigo: mensagem.erroCodigo,
        erroTitulo: mensagem.erroTitulo,
        enviadaPor: usuario.nome,
        criadaEm: mensagem.criadaEm,
      })
      .from(mensagem)
      .leftJoin(usuario, eq(usuario.id, mensagem.enviadaPor))
      .where(
        and(
          eq(mensagem.contaId, contaId),
          eq(mensagem.conversaId, conversaId),
          antesDe ? lt(mensagem.criadaEm, antesDe) : undefined,
        ),
      )
      .orderBy(desc(mensagem.criadaEm))
      .limit(POR_PAGINA);

    return linhas.reverse().map((l) => ({
      ...l,
      direcao: l.direcao as MensagemDaConversa['direcao'],
      criadaEm: l.criadaEm.toISOString(),
    }));
  }

  /** Abriu a conversa: zera as não lidas. */
  async marcarLida(contaId: string, conversaId: string): Promise<{ ok: true }> {
    await this.exigirHabilitadas(contaId);
    const [l] = await this.ctx.db
      .update(conversa)
      .set({ naoLidas: 0, lidaEm: new Date() })
      .where(and(eq(conversa.contaId, contaId), eq(conversa.id, conversaId)))
      .returning({ id: conversa.id });
    if (!l) throw new NotFoundException('Conversa não encontrada.');
    return { ok: true };
  }

  // ------------------------------------------------------------ resposta

  /**
   * Responde com texto livre — só dentro da janela de 24 horas aberta pela
   * última mensagem do cliente. Fora dela a Meta recusa (131047) e só modelo
   * aprovado inicia conversa.
   *
   * Quem pediu para sair das PROMOÇÕES pode receber resposta: foi a pessoa que
   * escreveu, e responder é atendimento, não campanha.
   */
  async responder(contaId: string, usuarioId: string, conversaId: string, texto: string): Promise<MensagemDaConversa> {
    await this.exigirHabilitadas(contaId);
    const corpo = texto.trim();
    if (!corpo) throw new BadRequestException('Escreva a mensagem.');

    const [c] = await this.ctx.db
      .select({
        telefone: conversa.telefoneE164,
        ultimaEntradaEm: conversa.ultimaEntradaEm,
        phoneNumberId: waNumero.phoneNumberId,
        tokenCifrado: waConta.tokenCifrado,
      })
      .from(conversa)
      .innerJoin(waNumero, eq(waNumero.id, conversa.waNumeroId))
      .innerJoin(waConta, eq(waConta.id, waNumero.waContaId))
      .where(and(eq(conversa.contaId, contaId), eq(conversa.id, conversaId)))
      .limit(1);
    if (!c) throw new NotFoundException('Conversa não encontrada.');

    if (!janelaAte(c.ultimaEntradaEm)) {
      throw new BadRequestException(
        'A janela de 24 horas para responder já fechou: ela abre quando a pessoa manda mensagem. ' +
          'Para falar com ela de novo, só com um modelo aprovado, pela tela de Campanhas.',
      );
    }
    if (!c.tokenCifrado) {
      throw new BadRequestException('A conexão com o WhatsApp está sem credencial. Conecte o número de novo.');
    }

    let wamid: string;
    try {
      wamid = await this.graph.enviarTexto(
        c.phoneNumberId,
        { para: c.telefone, texto: corpo },
        decifrarToken(c.tokenCifrado, env.meta.tokenChave),
      );
    } catch (erro) {
      if (erro instanceof ErroGraph) {
        this.log.warn(`Resposta na conversa ${conversaId} recusada pela Meta: ${erro.detalheParaLog}`);
        throw new BadRequestException(erro.mensagemParaUsuario);
      }
      throw erro;
    }

    const agora = new Date();
    const [gravada] = await this.ctx.db
      .insert(mensagem)
      .values({
        contaId,
        conversaId,
        wamid,
        direcao: 'saida',
        origem: 'painel',
        tipo: 'text',
        texto: corpo,
        status: 'enviando',
        enviadaPor: usuarioId,
        criadaEm: agora,
      })
      .returning({ id: mensagem.id });

    await this.ctx.db
      .update(conversa)
      .set({ ultimaMensagem: resumoDaMensagem('text', corpo), ultimaMensagemEm: agora, naoLidas: 0, lidaEm: agora })
      .where(and(eq(conversa.contaId, contaId), eq(conversa.id, conversaId)));

    // Sem o texto: a mensagem está na conversa, e a trilha guarda quem, quando e qual.
    await this.auditoria.registrar({
      contaId,
      atorTipo: 'usuario',
      atorUsuarioId: usuarioId,
      acao: 'conversa.resposta_enviada',
      entidade: 'conversa',
      entidadeId: conversaId,
      detalhe: { wamid },
    });

    const [autor] = await this.ctx.db.select({ nome: usuario.nome }).from(usuario).where(eq(usuario.id, usuarioId)).limit(1);
    return {
      id: gravada!.id,
      direcao: 'saida',
      origem: 'painel',
      tipo: 'text',
      texto: corpo,
      temMidia: false,
      midiaMime: null,
      midiaNome: null,
      status: 'enviando',
      erroCodigo: null,
      erroTitulo: null,
      enviadaPor: autor?.nome ?? null,
      criadaEm: agora.toISOString(),
    };
  }

  // ------------------------------------------------------------ mídia

  /**
   * Os bytes de uma mídia da conversa, buscados na Meta na hora.
   *
   * Nada fica guardado aqui: a mídia é do cliente e mora na Meta. Mídia
   * antiga pode já ter saído de lá — e a mensagem diz isso, em vez de erro.
   */
  async midia(
    contaId: string,
    mensagemId: string,
  ): Promise<{ conteudo: Buffer; tipoMime: string; embutir: boolean; nome: string | null }> {
    await this.exigirHabilitadas(contaId);
    const [m] = await this.ctx.db
      .select({
        midiaId: mensagem.midiaId,
        midiaNome: mensagem.midiaNome,
        tokenCifrado: waConta.tokenCifrado,
      })
      .from(mensagem)
      .innerJoin(conversa, eq(conversa.id, mensagem.conversaId))
      .innerJoin(waNumero, eq(waNumero.id, conversa.waNumeroId))
      .innerJoin(waConta, eq(waConta.id, waNumero.waContaId))
      .where(and(eq(mensagem.contaId, contaId), eq(mensagem.id, mensagemId)))
      .limit(1);
    if (!m?.midiaId) throw new NotFoundException('Esta mensagem não tem mídia para abrir.');
    if (!m.tokenCifrado) throw new BadRequestException('A conexão com o WhatsApp está sem credencial. Conecte o número de novo.');

    try {
      const { conteudo, tipoMime } = await this.graph.baixarMidia(
        m.midiaId,
        decifrarToken(m.tokenCifrado, env.meta.tokenChave),
        TETO_MIDIA,
      );
      const tipo = tipoMime.split(';')[0]!.trim().toLowerCase();
      const embutir = MIDIA_EMBUTIVEL.has(tipo);
      return { conteudo, tipoMime: embutir ? tipo : 'application/octet-stream', embutir, nome: m.midiaNome };
    } catch (erro) {
      if (erro instanceof ErroMidia) throw new BadRequestException(erro.message);
      if (erro instanceof ErroGraph) {
        this.log.warn(`Mídia da mensagem ${mensagemId} recusada pela Meta: ${erro.detalheParaLog}`);
        throw new BadRequestException('Esta mídia não está mais disponível na Meta.');
      }
      throw erro;
    }
  }

  // ------------------------------------------------------------ prazo de guarda

  async configuracao(contaId: string): Promise<{ retencaoDias: number }> {
    await this.exigirHabilitadas(contaId);
    const [c] = await this.ctx.db
      .select({ retencaoDias: conta.conversasRetencaoDias })
      .from(conta)
      .where(eq(conta.id, contaId))
      .limit(1);
    return { retencaoDias: c?.retencaoDias ?? 0 };
  }

  /** Só o dono. 0 = guardar tudo; N = o job apaga o que passou de N dias. */
  async salvarConfiguracao(contaId: string, usuarioId: string, retencaoDias: number): Promise<{ retencaoDias: number }> {
    await this.exigirHabilitadas(contaId);
    const antes = await this.configuracao(contaId);
    await this.ctx.db.update(conta).set({ conversasRetencaoDias: retencaoDias }).where(eq(conta.id, contaId));
    await this.auditoria.registrar({
      contaId,
      atorTipo: 'usuario',
      atorUsuarioId: usuarioId,
      acao: 'conversa.retencao_alterada',
      entidade: 'conta',
      entidadeId: contaId,
      detalhe: { antes: antes.retencaoDias, depois: retencaoDias },
    });
    return { retencaoDias };
  }
}
