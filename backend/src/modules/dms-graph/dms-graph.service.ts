/**
 * O DMS Graph no Regemcast (migration 052). "Graph" aqui é o produto da DMS, não a Graph API da Meta.
 *
 * - O CLIQUE: o dono empurra o pedido ao Graph (RFC 9126 + PKCE, com o token do DMS ID do Regemcast), o responsável
 *   autoriza na página do Graph e, na volta, o código vira a ligação da conta, guardada cifrada.
 * - O AJUSTE DE VÍDEO do cabeçalho: sem IA e sem franquia. A ferramenta devolve o número da tarefa na hora; a tela consulta
 *   e, quando fica pronto, o resultado vira UMA mídia nova da conta. A original não muda, e o modelo só passa a usar a nova
 *   quando a pessoa salvar.
 *
 * Nenhuma chamada ao Graph roda dentro de transação: segurar a conexão durante o envio de 12 MB esgotaria o pool.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';

import { env } from '../../config/env';
import { ContextoDb } from '../../db/contexto';
import { midia } from '../../db/schema';
import { ClienteDmsId, ClienteMcp, lerChave, montarChaveIdempotencia } from '../../dms/integracao-dms';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { cifrarToken, decifrarToken } from '../meta/cripto';
import {
  AJUSTE_MAX_BYTES,
  FERRAMENTA_AJUSTAR,
  FERRAMENTA_CONSULTAR,
  FRASE_ACIMA_DO_LIMITE,
  PERMISSAO_AJUSTAR,
  PERMISSOES_DO_REGEMCAST,
  RESULTADO_MAX_BYTES,
  VALIDADE_DO_PEDIDO_MS,
  chaveDoAjuste,
  cnpjDaConta,
  conferirAjuste,
  conferirVolta,
  corpoDoPedido,
  falhaDoGraph,
  formatoDoNumero,
  gerarPedido,
  hashDoEstado,
  ligacaoDaTroca,
  ligadoParaConta,
  lerConfigDmsGraph,
  lerTarefa,
  linkValido,
  pareceMp4,
  urlDaPagina,
  type ConfigDmsGraph,
  type PedidoDeAjuste,
  type SituacaoDaTarefa,
} from './dms-graph.regras';

const COMECE_DE_NOVO = 'Comece de novo pelo botão “Conectar ao DMS Graph”.';
const NAO_DISPONIVEL = 'O DMS Graph não está disponível nesta conta agora. Fale com o suporte do Regemcast.';
const SEM_LIGACAO = 'Conecte o DMS Graph em Configuração › Integrações para ajustar o vídeo.';
const PRAZO_DO_ENVIO_MS = 60_000;
const PRAZO_DA_CONSULTA_MS = 10_000;
const PRAZO_DO_DOWNLOAD_MS = 60_000;

export type SituacaoDmsGraph = {
  /** A distribuição ligou o Graph para esta conta. Falso: a tela não mostra nada. */
  disponivel: boolean;
  podeLigar: boolean;
  contaTemCnpj: boolean;
  ligacao: null | { contaNome: string | null; desde: string; por: string | null; permissoes: string[]; ultimoUso: string | null };
  /** O acesso foi tirado do lado do Graph: quando. A tela avisa e oferece conectar de novo. */
  desligadaPeloGraphEm: string | null;
};

export type AjusteDaTela =
  | { id: string; situacao: 'processando' }
  | { id: string; situacao: 'pronto'; referencia: string; bytes: number; largura: number | null; altura: number | null; duracaoMs: number | null }
  | { id: string; situacao: 'erro'; frase: string; podeRepetir: boolean };

type LinhaDoAjuste = {
  id: string;
  usuario_id: string | null;
  situacao: 'pedindo' | 'processando' | 'pronto' | 'erro';
  tarefa: string | null;
  midia_origem_id: string;
  midia_resultado_id: string | null;
  erro_frase: string | null;
  pode_repetir: boolean;
  bytes: number | null;
  largura: number | null;
  altura: number | null;
  duracao_ms: number | null;
};

const COLUNAS_DO_AJUSTE = sql`id, usuario_id, situacao, tarefa, midia_origem_id, midia_resultado_id, erro_frase, pode_repetir, bytes, largura, altura, duracao_ms`;

function paraTela(l: LinhaDoAjuste): AjusteDaTela {
  if (l.situacao === 'pronto' && l.midia_resultado_id) {
    return { id: l.id, situacao: 'pronto', referencia: `midia:${l.midia_resultado_id}`, bytes: Number(l.bytes), largura: l.largura, altura: l.altura, duracaoMs: l.duracao_ms };
  }
  if (l.situacao === 'erro') return { id: l.id, situacao: 'erro', frase: l.erro_frase ?? 'Não deu para ajustar este vídeo.', podeRepetir: l.pode_repetir };
  if (l.situacao === 'processando') return { id: l.id, situacao: 'processando' };
  // `pedindo` sem quem esteja pedindo: o servidor reiniciou no meio. A mesma chave retoma sem processar duas vezes.
  return { id: l.id, situacao: 'erro', frase: 'O pedido foi interrompido. Tente de novo.', podeRepetir: true };
}

@Injectable()
export class DmsGraphService {
  private readonly log = new Logger('DmsGraph');
  /** Um cliente por aplicativo: guarda o token do DMS ID até vencer, entre as contas. Não guarda nada de conta. */
  private dmsId: { chave: string; cliente: ClienteDmsId } | null = null;

  constructor(
    private readonly ctx: ContextoDb,
    private readonly auditoria: AuditoriaService,
  ) {}

  private segredoDaCifra(): string {
    if (!env.integracoes.chave) throw new ServiceUnavailableException(NAO_DISPONIVEL);
    return env.integracoes.chave;
  }

  private config(contaId?: string): ConfigDmsGraph {
    const c = lerConfigDmsGraph();
    if (!c.ligado || (contaId && !ligadoParaConta(contaId))) {
      if (c.motivo && process.env.DMS_GRAPH_LIGADO === 'true') this.log.warn(`a configuração do DMS Graph não está pronta: ${c.motivo}`);
      throw new ServiceUnavailableException(NAO_DISPONIVEL);
    }
    this.segredoDaCifra();
    return c;
  }

  private clienteDmsId(c: ConfigDmsGraph): ClienteDmsId {
    const chave = `${c.emissor}|${c.aplicativo}`;
    if (!this.dmsId || this.dmsId.chave !== chave) {
      this.dmsId = {
        chave,
        cliente: new ClienteDmsId({ emissor: c.emissor, aplicativo: c.aplicativo, segredo: c.segredo, buscar: (url, init) => fetch(url, init) }),
      };
    }
    return this.dmsId.cliente;
  }

  private clienteMcp(c: ConfigDmsGraph, ligacao: string, prazoMs: number): ClienteMcp {
    return new ClienteMcp({
      endereco: c.endereco,
      recurso: c.endereco,
      permissoes: PERMISSOES_DO_REGEMCAST,
      dmsId: this.clienteDmsId(c),
      ligacao,
      cliente: { nome: 'regemcast', versao: (process.env.APP_VERSAO ?? '').trim() || 'desconhecida' },
      buscar: (url, init) => fetch(url, init),
      // Quem repete é a pessoa, pelo botão: repetir aqui mandaria os 12 MB de novo com ela esperando.
      tentativas: 1,
      tempoLimiteMs: prazoMs,
    });
  }

  /** Uma chamada às rotas do clique, com o token do DMS ID. Só à origem da configuração e sem seguir redirecionamento. */
  private async chamarOGraph(c: ConfigDmsGraph, caminho: string, corpo: unknown, cabecalhos: Record<string, string> = {}, metodo = 'POST') {
    let token: string;
    try {
      token = await this.clienteDmsId(c).token(c.endereco, PERMISSOES_DO_REGEMCAST);
    } catch (e) {
      this.log.warn(`o DMS ID não entregou o token do Regemcast (${e instanceof Error ? e.message : 'erro'})`);
      throw new ServiceUnavailableException('O DMS ID não respondeu agora. Tente de novo em instantes.');
    }
    let r: Response;
    try {
      r = await fetch(new URL(caminho, c.origem).href, {
        method: metodo,
        redirect: 'manual',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json', ...cabecalhos },
        body: metodo === 'DELETE' ? undefined : JSON.stringify(corpo),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      this.log.warn(`sem resposta do DMS Graph em ${caminho} (${e instanceof Error ? e.name : 'erro'})`);
      throw new ServiceUnavailableException('O DMS Graph não respondeu agora. Tente de novo em instantes.');
    }
    return { status: r.status, corpo: (await r.json().catch(() => null)) as Record<string, unknown> | null };
  }

  private async ligacaoViva(contaId: string) {
    return this.ctx.comConta(contaId, async (db) => {
      const r = await db.execute(sql`
        select id, segredo_cifrado, conta_graph_nome, permissoes, criada_em, criada_por_nome, ultimo_uso_em
          from dms_graph_ligacao where conta_id = ${contaId} and revogada_em is null limit 1`);
      return (
        (r.rows[0] as
          | { id: string; segredo_cifrado: string; conta_graph_nome: string | null; permissoes: string[]; criada_em: Date; criada_por_nome: string | null; ultimo_uso_em: Date | null }
          | undefined) ?? null
      );
    });
  }

  /** `GET /integracoes/dms-graph`: o que o cartão mostra. Desligado para a conta: só `disponivel: false`. */
  async situacao(contaId: string, papel: 'dono' | 'operador'): Promise<SituacaoDmsGraph> {
    const c = lerConfigDmsGraph();
    const base: SituacaoDmsGraph = { disponivel: false, podeLigar: papel === 'dono', contaTemCnpj: false, ligacao: null, desligadaPeloGraphEm: null };
    if (!c.ligado || !ligadoParaConta(contaId) || !env.integracoes.chave) return base;
    return this.ctx.comConta(contaId, async (db) => {
      const [k] = (await db.execute(sql`select cnpj from conta where id = ${contaId}`)).rows as { cnpj: string | null }[];
      const [l] = (
        await db.execute(sql`
          select conta_graph_nome, permissoes, criada_em, criada_por_nome, ultimo_uso_em, revogada_em, revogada_origem
            from dms_graph_ligacao where conta_id = ${contaId}
           order by (revogada_em is null) desc, criada_em desc limit 1`)
      ).rows as {
        conta_graph_nome: string | null;
        permissoes: string[];
        criada_em: Date;
        criada_por_nome: string | null;
        ultimo_uso_em: Date | null;
        revogada_em: Date | null;
        revogada_origem: string | null;
      }[];
      const contaTemCnpj = cnpjDaConta(k?.cnpj) !== null;
      if (!l || l.revogada_em) {
        const peloGraph = l?.revogada_em && l.revogada_origem === 'graph' ? new Date(l.revogada_em).toISOString() : null;
        return { ...base, disponivel: true, contaTemCnpj, desligadaPeloGraphEm: peloGraph };
      }
      return {
        ...base,
        disponivel: true,
        contaTemCnpj,
        ligacao: {
          contaNome: l.conta_graph_nome,
          desde: new Date(l.criada_em).toISOString(),
          por: l.criada_por_nome,
          permissoes: l.permissoes ?? [],
          ultimoUso: l.ultimo_uso_em ? new Date(l.ultimo_uso_em).toISOString() : null,
        },
      };
    });
  }

  /** "Conectar ao DMS Graph": abre o pedido lá e devolve a página, para onde o navegador vai. Toda recusa vem antes de gravar. */
  async iniciarClique(contaId: string, u: { id: string; email: string }): Promise<{ url: string }> {
    const c = this.config(contaId);
    const segredo = this.segredoDaCifra();
    const [conta] = await this.ctx.comConta(contaId, async (db) => (await db.execute(sql`select nome, cnpj from conta where id = ${contaId}`)).rows as { nome: string; cnpj: string | null }[]);
    if (!conta) throw new NotFoundException('Conta não encontrada.');
    const cnpj = cnpjDaConta(conta.cnpj);
    if (!cnpj) throw new BadRequestException('Informe o CNPJ da empresa antes de conectar: a conta da empresa no DMS Graph nasce pelo CNPJ.');

    const p = gerarPedido();
    const r = await this.chamarOGraph(
      c,
      '/v1/dms-id/autorizacao/pedido',
      corpoDoPedido({ aplicativo: c.aplicativo, volta: c.volta, estado: p.estado, desafio: p.desafio, contaId, contaNome: conta.nome, contaCnpj: cnpj, contaEmail: u.email }),
    );
    const numero = r.corpo?.request_uri;
    if (r.status < 200 || r.status >= 300 || !formatoDoNumero(numero)) {
      this.log.error(`o DMS Graph recusou o pedido da conta ${contaId} (${r.status}): ${String(r.corpo?.type ?? r.corpo?.title ?? '').slice(0, 120)}`);
      if (r.status === 503) throw new ServiceUnavailableException('O DMS Graph pausou novas ligações por enquanto. Tente de novo mais tarde.');
      throw new ServiceUnavailableException('O DMS Graph não aceitou abrir a conexão agora. Fale com o suporte do Regemcast.');
    }
    await this.ctx.comConta(contaId, async (db) => {
      await db.execute(sql`
        insert into dms_graph_pedido (conta_id, usuario_id, estado_hash, verificador_cifrado, permissoes, vence_em)
        values (${contaId}, ${u.id}, ${p.estadoHash}, ${cifrarToken(p.verificador, segredo)},
                string_to_array(${PERMISSOES_DO_REGEMCAST.join(' ')}, ' '), ${new Date(Date.now() + VALIDADE_DO_PEDIDO_MS).toISOString()}::timestamptz)`);
      // Os pedidos velhos da conta saem aqui (não há rotina para eles).
      await db.execute(sql`delete from dms_graph_pedido where conta_id = ${contaId} and vence_em < now() - interval '1 day'`);
    });
    return { url: urlDaPagina(r.corpo?.authorization_endpoint, c.origem, c.aplicativo, numero) };
  }

  /** A volta do Graph: gasta o pedido (uma vez, de quem começou), troca o código e grava a ligação. */
  async concluirClique(
    contaId: string,
    u: { id: string; nome: string },
    q: { code?: unknown; state?: unknown; iss?: unknown; error?: unknown },
  ): Promise<{ situacao: 'conectado'; contaNome: string | null } | { situacao: 'recusado' }> {
    const c = this.config(contaId);
    const segredo = this.segredoDaCifra();
    const v = conferirVolta(q, c.origem);
    if (v.tipo === 'invalida') throw new BadRequestException(`Não deu para concluir: ${v.motivo}. ${COMECE_DE_NOVO}`);

    const pedido = await this.ctx.comConta(contaId, async (db) => {
      const r = await db.execute(sql`
        update dms_graph_pedido set usado_em = now()
         where estado_hash = ${hashDoEstado(v.estado)} and conta_id = ${contaId} and usuario_id = ${u.id}
           and usado_em is null and vence_em > now()
         returning verificador_cifrado`);
      return (r.rows[0] as { verificador_cifrado: string } | undefined) ?? null;
    });
    if (!pedido) throw new BadRequestException(`Este pedido de conexão não vale mais: já foi usado, venceu ou foi aberto por outra pessoa. ${COMECE_DE_NOVO}`);
    if (v.tipo === 'recusa') {
      if (v.motivo === 'recusado') return { situacao: 'recusado' };
      throw new BadRequestException(`O DMS Graph não reconheceu o pedido de conexão. ${COMECE_DE_NOVO}`);
    }

    const r = await this.chamarOGraph(c, '/v1/dms-id/autorizacao/token', {
      grant_type: 'authorization_code',
      client_id: c.aplicativo,
      code: v.codigo,
      redirect_uri: c.volta,
      code_verifier: decifrarToken(pedido.verificador_cifrado, segredo),
    });
    if (r.status !== 200) {
      this.log.error(`a troca do código da conta ${contaId} foi recusada pelo DMS Graph (${r.status})`);
      throw new BadRequestException(`O DMS Graph não aceitou concluir a conexão. ${COMECE_DE_NOVO}`);
    }
    const lg = ligacaoDaTroca(r.corpo);
    if (!lg) {
      // Com um segredo de verdade, mas sem a permissão de ajustar: ele não fica vivo lá sem uso.
      const bruta = r.corpo?.ligacao;
      const lida = lerChave(bruta);
      if (typeof bruta === 'string' && lida?.tipo === 'lg' && lida.produto === 'graph') await this.avisarDesligar(c, bruta);
      this.log.error(`a troca do código da conta ${contaId} veio sem a ligação esperada: nada foi guardado`);
      throw new ServiceUnavailableException('O DMS Graph respondeu sem a permissão de ajustar vídeo. Nada foi guardado; fale com o suporte do Regemcast.');
    }
    const quem = u.nome.trim().slice(0, 120) || 'dono da conta';
    await this.ctx.comConta(contaId, async (db) => {
      // Duas voltas ao mesmo tempo: uma de cada vez. Sem travar o que referencia a conta (`no key`).
      await db.execute(sql`select 1 from conta where id = ${contaId} for no key update`);
      // Ligar de novo gira o segredo no Graph: a anterior já não vale lá e sai na mesma transação.
      await db.execute(sql`
        update dms_graph_ligacao set revogada_em = clock_timestamp(), revogada_origem = 'troca', revogada_por = ${quem}
         where conta_id = ${contaId} and revogada_em is null`);
      await db.execute(sql`
        insert into dms_graph_ligacao (conta_id, segredo_cifrado, prefixo, conta_graph, conta_graph_nome, permissoes, criada_por, criada_por_nome)
        values (${contaId}, ${cifrarToken(lg.ligacao, segredo)}, ${lg.prefixo}, ${lg.contaGraph}, ${lg.contaNome},
                string_to_array(${lg.permissoes.join(' ')}, ' '), ${u.id}, ${quem})`);
      await this.auditoria.registrar({
        contaId,
        atorTipo: 'usuario',
        atorUsuarioId: u.id,
        acao: 'dms_graph.ligado',
        entidade: 'dms_graph_ligacao',
        detalhe: { contaGraph: lg.contaNome, permissoes: lg.permissoes, prefixo: lg.prefixo },
      });
    });
    return { situacao: 'conectado', contaNome: lg.contaNome };
  }

  private async avisarDesligar(c: ConfigDmsGraph, ligacao: string): Promise<void> {
    try {
      const r = await this.chamarOGraph(c, '/v1/dms-id/ligacao', null, { 'dms-ligacao': ligacao }, 'DELETE');
      if (r.status >= 300 && r.status !== 401) this.log.warn(`o DMS Graph não confirmou o desligar (${r.status})`);
    } catch (e) {
      this.log.warn(`avisar o DMS Graph do desligar falhou (${e instanceof Error ? e.message : 'erro'}); aqui já está desligada`);
    }
  }

  /** Desliga aqui na hora e avisa o Graph; falha lá não segura o desligar. Repetir não dá erro. */
  async desligar(contaId: string, u: { id: string; nome: string }): Promise<{ desligada: boolean }> {
    const quem = u.nome.trim().slice(0, 120) || 'dono da conta';
    const viva = await this.ctx.comConta(contaId, async (db) => {
      const r = await db.execute(sql`
        update dms_graph_ligacao set revogada_em = clock_timestamp(), revogada_origem = 'dono', revogada_por = ${quem}
         where conta_id = ${contaId} and revogada_em is null
         returning id, prefixo, segredo_cifrado`);
      const l = r.rows[0] as { id: string; prefixo: string; segredo_cifrado: string } | undefined;
      if (l) {
        await this.auditoria.registrar({
          contaId,
          atorTipo: 'usuario',
          atorUsuarioId: u.id,
          acao: 'dms_graph.desligado',
          entidade: 'dms_graph_ligacao',
          entidadeId: l.id,
          detalhe: { prefixo: l.prefixo },
        });
      }
      return l ?? null;
    });
    if (!viva) return { desligada: false };
    // Sem o piloto de propósito: a conta que saiu da lista ainda desliga o que ligou.
    const c = lerConfigDmsGraph();
    if (c.motivo === null && env.integracoes.chave) {
      try {
        await this.avisarDesligar(c, decifrarToken(viva.segredo_cifrado, env.integracoes.chave));
      } catch {
        this.log.warn('a ligação desligada não abriu para avisar o DMS Graph; aqui já está desligada');
      }
    }
    return { desligada: true };
  }

  private async marcarDesfeita(contaId: string, ligacaoId: string): Promise<void> {
    await this.ctx.comConta(contaId, (db) =>
      db.execute(sql`
        update dms_graph_ligacao set revogada_em = clock_timestamp(), revogada_origem = 'graph', revogada_por = 'DMS Graph'
         where id = ${ligacaoId} and conta_id = ${contaId} and revogada_em is null`),
    );
  }

  /** Dá para ajustar esta mídia? A tela pergunta antes de mostrar os controles. */
  async mediaParaAjuste(contaId: string, midiaId: string): Promise<{ bytes: number; podeAjustar: boolean; motivo: string | null }> {
    const m = await this.metadados(contaId, midiaId);
    const motivo = this.motivoDeNaoAjustar(m);
    return { bytes: m.tamanhoBytes, podeAjustar: motivo === null, motivo };
  }

  private motivoDeNaoAjustar(m: { tipoMime: string; tamanhoBytes: number; temBytes: boolean }): string | null {
    if (!m.temBytes) return 'O arquivo deste vídeo não está mais guardado. Envie de novo para ajustar.';
    if (m.tipoMime !== 'video/mp4') return 'Para ajustar, envie o vídeo em MP4. Ele continua valendo no modelo como está.';
    if (m.tamanhoBytes > AJUSTE_MAX_BYTES) return FRASE_ACIMA_DO_LIMITE;
    return null;
  }

  private async metadados(contaId: string, midiaId: string) {
    const [m] = await this.ctx.comConta(contaId, (db) =>
      db
        .select({ nome: midia.nomeArquivo, tipoMime: midia.tipoMime, tamanhoBytes: midia.tamanhoBytes, temBytes: sql<boolean>`${midia.conteudo} is not null` })
        .from(midia)
        .where(and(eq(midia.contaId, contaId), eq(midia.id, midiaId)))
        .limit(1),
    );
    if (!m) throw new NotFoundException('Vídeo não encontrado.');
    return m;
  }

  /**
   * Pede o ajuste. A mesma mídia com o mesmo pedido cai no MESMO ajuste: pronto, devolve o resultado; em curso, segue; com
   * um erro que pode repetir, roda de novo com a mesma chave no Graph.
   */
  async ajustar(contaId: string, usuarioId: string, midiaId: string, dados: PedidoDeAjuste): Promise<AjusteDaTela> {
    const c = this.config(contaId);
    const conferido = conferirAjuste(dados);
    if ('erro' in conferido) throw new BadRequestException(conferido.erro);
    const ligacao = await this.ligacaoViva(contaId);
    if (!ligacao) throw new ConflictException(SEM_LIGACAO);
    if (!ligacao.permissoes.includes(PERMISSAO_AJUSTAR)) throw new ConflictException('A ligação com o DMS Graph não tem o ajuste de vídeo. Conecte de novo em Configuração › Integrações.');
    const m = await this.metadados(contaId, midiaId);
    const recusa = this.motivoDeNaoAjustar(m);
    if (recusa) throw new BadRequestException(recusa);

    const chave = chaveDoAjuste(contaId, midiaId, conferido.pedido);
    const linha = await this.ctx.comConta(contaId, async (db) => {
      await db.execute(sql`
        insert into dms_graph_ajuste (conta_id, usuario_id, midia_origem_id, chave, pedido)
        values (${contaId}, ${usuarioId}, ${midiaId}, ${chave}, ${JSON.stringify(conferido.pedido)}::jsonb)
        on conflict (conta_id, chave) do nothing`);
      const r = await db.execute(sql`select ${COLUNAS_DO_AJUSTE} from dms_graph_ajuste where conta_id = ${contaId} and chave = ${chave} limit 1`);
      return r.rows[0] as LinhaDoAjuste;
    });
    if (linha.situacao === 'pronto') return paraTela(linha);
    if (linha.situacao === 'processando') return this.consultar(contaId, linha.id);
    if (linha.situacao === 'erro' && !linha.pode_repetir) return paraTela(linha);

    let segredoDaLigacao: string;
    try {
      segredoDaLigacao = decifrarToken(ligacao.segredo_cifrado, this.segredoDaCifra());
    } catch {
      this.log.error(`a ligação da conta ${contaId} com o DMS Graph não abre com a INTEGRACOES_CHAVE`);
      return this.gravarErro(contaId, linha.id, 'cifra', 'A ligação com o DMS Graph precisa ser refeita. Conecte de novo em Configuração › Integrações.', false);
    }
    const [arquivo] = await this.ctx.comConta(contaId, (db) =>
      db.select({ conteudo: midia.conteudo }).from(midia).where(and(eq(midia.contaId, contaId), eq(midia.id, midiaId))).limit(1),
    );
    if (!arquivo?.conteudo) return this.gravarErro(contaId, linha.id, 'sem-arquivo', 'O arquivo deste vídeo não está mais guardado. Envie de novo para ajustar.', false);

    try {
      const dadosDaTarefa = await this.clienteMcp(c, segredoDaLigacao, PRAZO_DO_ENVIO_MS).chamar(FERRAMENTA_AJUSTAR, {
        video: { mimeType: 'video/mp4', arquivoBase64: Buffer.from(arquivo.conteudo).toString('base64') },
        ...conferido.argumentos,
        // Pelo id do ajuste: se o resultado vencer lá, a próxima tentativa nasce noutra linha e não bate na chave gasta.
        chaveIdempotencia: montarChaveIdempotencia('regemcast-ajuste', linha.id),
      });
      const t = lerTarefa(dadosDaTarefa, c.origem);
      if (!t) {
        this.log.warn(`${FERRAMENTA_AJUSTAR} respondeu fora do formato (conta ${contaId})`);
        return this.gravarErro(contaId, linha.id, 'fora-do-formato', 'O DMS Graph respondeu de um jeito inesperado. Tente de novo em instantes.', true);
      }
      await this.ctx.comConta(contaId, (db) =>
        db.execute(sql`
          update dms_graph_ajuste set tarefa = ${t.tarefa}::uuid, situacao = 'processando', erro_codigo = null, erro_frase = null,
                                      pode_repetir = false, atualizado_em = now()
           where id = ${linha.id} and conta_id = ${contaId} and situacao in ('pedindo', 'erro')`),
      );
      return this.aplicarTarefa(contaId, c, linha.id, ligacao.id, t);
    } catch (e) {
      return this.depoisDaFalha(contaId, linha.id, ligacao.id, e);
    }
  }

  /** Como está o ajuste. Em curso, pergunta ao Graph; pronto lá, baixa e guarda como mídia da conta. */
  async consultar(contaId: string, ajusteId: string): Promise<AjusteDaTela> {
    const linha = await this.lerAjuste(contaId, ajusteId);
    if (linha.situacao !== 'processando' || !linha.tarefa) return paraTela(linha);
    const c = this.config(contaId);
    const ligacao = await this.ligacaoViva(contaId);
    if (!ligacao) return this.gravarErro(contaId, linha.id, 'sem-ligacao', SEM_LIGACAO, false);
    let segredoDaLigacao: string;
    try {
      segredoDaLigacao = decifrarToken(ligacao.segredo_cifrado, this.segredoDaCifra());
    } catch {
      this.log.error(`a ligação da conta ${contaId} com o DMS Graph não abre com a INTEGRACOES_CHAVE`);
      return this.gravarErro(contaId, linha.id, 'cifra', 'A ligação com o DMS Graph precisa ser refeita. Conecte de novo em Configuração › Integrações.', false);
    }
    try {
      const dados = await this.clienteMcp(c, segredoDaLigacao, PRAZO_DA_CONSULTA_MS).chamar(FERRAMENTA_CONSULTAR, { tarefa: linha.tarefa }, { leitura: true });
      const t = lerTarefa(dados, c.origem);
      if (!t || t.tarefa !== linha.tarefa) {
        this.log.warn(`${FERRAMENTA_CONSULTAR} respondeu fora do formato (conta ${contaId})`);
        return this.gravarErro(contaId, linha.id, 'fora-do-formato', 'O DMS Graph respondeu de um jeito inesperado. Tente de novo.', true);
      }
      return this.aplicarTarefa(contaId, c, linha.id, ligacao.id, t);
    } catch (e) {
      const f = falhaDoGraph(e);
      // Uma consulta que falhou por rede não muda o ajuste: a tela pergunta de novo e o trabalho segue lá.
      if (f.podeRepetir && f.codigo !== 'nao-encontrado') return { id: linha.id, situacao: 'processando' };
      return this.depoisDaFalha(contaId, linha.id, ligacao.id, e);
    }
  }

  private async lerAjuste(contaId: string, ajusteId: string): Promise<LinhaDoAjuste> {
    const l = await this.ctx.comConta(contaId, async (db) => {
      const r = await db.execute(sql`select ${COLUNAS_DO_AJUSTE} from dms_graph_ajuste where id = ${ajusteId} and conta_id = ${contaId} limit 1`);
      return r.rows[0] as LinhaDoAjuste | undefined;
    });
    if (!l) throw new NotFoundException('Ajuste não encontrado.');
    return l;
  }

  private async aplicarTarefa(contaId: string, c: ConfigDmsGraph, ajusteId: string, ligacaoId: string, t: SituacaoDaTarefa): Promise<AjusteDaTela> {
    if (t.situacao === 'processando') return { id: ajusteId, situacao: 'processando' };
    if (t.situacao === 'erro') return this.gravarErro(contaId, ajusteId, t.codigo, t.frase, t.podeRepetir);
    return this.baixarEGuardar(contaId, c, ajusteId, ligacaoId, t);
  }

  /** Baixa FORA de transação e grava numa só: a linha travada garante uma mídia só, com duas abas consultando juntas. */
  private async baixarEGuardar(
    contaId: string,
    c: ConfigDmsGraph,
    ajusteId: string,
    ligacaoId: string,
    t: Extract<SituacaoDaTarefa, { situacao: 'pronto' }>,
  ): Promise<AjusteDaTela> {
    if (!linkValido(t.link, c.origem)) return this.gravarErro(contaId, ajusteId, 'link-invalido', 'O DMS Graph devolveu um endereço inesperado. Tente de novo.', true);
    const baixado = await this.baixar(t.link, t.bytes);
    if (baixado === 'vencido') return this.liberarChave(contaId, ajusteId);
    // Falha de rede: a tarefa segue pronta lá, e a próxima consulta baixa de novo.
    if (baixado === 'falhou') return { id: ajusteId, situacao: 'processando' };
    if (baixado === 'torto') return this.gravarErro(contaId, ajusteId, 'arquivo-invalido', 'O vídeo ajustado veio com defeito. Tente de novo.', true);

    return this.ctx.comConta(contaId, async (db) => {
      const r = await db.execute(sql`select ${COLUNAS_DO_AJUSTE} from dms_graph_ajuste where id = ${ajusteId} and conta_id = ${contaId} for update`);
      const linha = r.rows[0] as LinhaDoAjuste | undefined;
      if (!linha) throw new NotFoundException('Ajuste não encontrado.');
      if (linha.situacao !== 'processando') return paraTela(linha);
      const [origem] = await db.select({ nome: midia.nomeArquivo }).from(midia).where(and(eq(midia.contaId, contaId), eq(midia.id, linha.midia_origem_id))).limit(1);
      const base = (origem?.nome ?? 'video').replace(/\.[^.]+$/, '').slice(0, 200);
      const [nova] = await db
        .insert(midia)
        .values({ contaId, nomeArquivo: `${base}-ajustado.mp4`, tipoMime: 'video/mp4', tamanhoBytes: baixado.length, conteudo: baixado, criadoPor: linha.usuario_id })
        .returning({ id: midia.id });
      const atualizado = await db.execute(sql`
        update dms_graph_ajuste
           set situacao = 'pronto', midia_resultado_id = ${nova!.id}, bytes = ${baixado.length}, largura = ${t.largura}, altura = ${t.altura},
               duracao_ms = ${t.duracaoMs}, erro_codigo = null, erro_frase = null, pode_repetir = false, atualizado_em = now()
         where id = ${ajusteId} and conta_id = ${contaId}
         returning ${COLUNAS_DO_AJUSTE}`);
      await db.execute(sql`update dms_graph_ligacao set ultimo_uso_em = now() where id = ${ligacaoId} and conta_id = ${contaId} and revogada_em is null`);
      await this.auditoria.registrar({
        contaId,
        ...(linha.usuario_id ? { atorTipo: 'usuario' as const, atorUsuarioId: linha.usuario_id } : { atorTipo: 'sistema' as const }),
        acao: 'dms_graph.video_ajustado',
        entidade: 'midia',
        entidadeId: nova!.id,
        detalhe: { ajuste: ajusteId, origem: linha.midia_origem_id, bytes: baixado.length },
      });
      return paraTela(atualizado.rows[0] as LinhaDoAjuste);
    });
  }

  /** Lê o arquivo sem passar do teto, mesmo que o servidor mande mais do que declarou. */
  private async baixar(link: string, bytesDeclarados: number): Promise<Buffer | 'vencido' | 'falhou' | 'torto'> {
    let r: Response;
    try {
      r = await fetch(link, { redirect: 'manual', signal: AbortSignal.timeout(PRAZO_DO_DOWNLOAD_MS) });
    } catch (e) {
      this.log.warn(`o download do vídeo ajustado falhou (${e instanceof Error ? e.name : 'erro'})`);
      return 'falhou';
    }
    if (r.status === 404 || r.status === 410) return 'vencido';
    if (r.status !== 200 || !r.body) {
      this.log.warn(`o download do vídeo ajustado respondeu ${r.status}`);
      return 'falhou';
    }
    const leitor = r.body.getReader();
    const partes: Buffer[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await leitor.read();
        if (done) break;
        total += value.byteLength;
        if (total > RESULTADO_MAX_BYTES) {
          await leitor.cancel().catch(() => undefined);
          return 'torto';
        }
        partes.push(Buffer.from(value));
      }
    } catch (e) {
      this.log.warn(`o download do vídeo ajustado parou no meio (${e instanceof Error ? e.name : 'erro'})`);
      return 'falhou';
    }
    const b = Buffer.concat(partes);
    return b.length === bytesDeclarados && pareceMp4(b) ? b : 'torto';
  }

  private async depoisDaFalha(contaId: string, ajusteId: string, ligacaoId: string, e: unknown): Promise<AjusteDaTela> {
    const f = falhaDoGraph(e);
    this.log.warn(`o DMS Graph não fez o ajuste da conta ${contaId} (${f.codigo})`);
    if (f.ligacaoDesfeita) await this.marcarDesfeita(contaId, ligacaoId);
    // A chave que o Graph já não aceita (o resultado venceu): a próxima tentativa nasce numa linha nova.
    if (f.codigo === 'nao-encontrado' || f.codigo === 'chave-reutilizada') return this.liberarChave(contaId, ajusteId);
    return this.gravarErro(contaId, ajusteId, f.codigo, f.frase, f.podeRepetir);
  }

  private async liberarChave(contaId: string, ajusteId: string): Promise<AjusteDaTela> {
    const frase = 'O resultado deste ajuste venceu. Clique em “Ajustar vídeo” para fazer de novo.';
    await this.ctx.comConta(contaId, (db) =>
      db.execute(sql`
        update dms_graph_ajuste
           set chave = chave || ':vencida:' || id::text, situacao = 'erro', erro_codigo = 'vencido', erro_frase = ${frase},
               pode_repetir = false, atualizado_em = now()
         where id = ${ajusteId} and conta_id = ${contaId} and situacao <> 'pronto'`),
    );
    return { id: ajusteId, situacao: 'erro', frase, podeRepetir: true };
  }

  private async gravarErro(contaId: string, ajusteId: string, codigo: string, frase: string, podeRepetir: boolean): Promise<AjusteDaTela> {
    const l = await this.ctx.comConta(contaId, async (db) => {
      const r = await db.execute(sql`
        update dms_graph_ajuste
           set situacao = 'erro', erro_codigo = ${codigo.slice(0, 40)}, erro_frase = ${frase.slice(0, 300)}, pode_repetir = ${podeRepetir}, atualizado_em = now()
         where id = ${ajusteId} and conta_id = ${contaId} and situacao <> 'pronto'
         returning ${COLUNAS_DO_AJUSTE}`);
      return r.rows[0] as LinhaDoAjuste | undefined;
    });
    // Outra aba já concluiu: vale o resultado dela.
    return l ? paraTela(l) : paraTela(await this.lerAjuste(contaId, ajusteId));
  }
}
