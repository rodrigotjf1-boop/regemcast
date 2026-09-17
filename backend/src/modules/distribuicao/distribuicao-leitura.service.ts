/**
 * O que o console de distribuição lê: contas, uso e erros.
 *
 * ## "Ativa" quer dizer uso, não status de cobrança
 *
 * A cobrança ainda não existe: toda assinatura está em `cortesia`. Classificar
 * por status diria "todas ativas" — verdade no banco e mentira na operação.
 * Por isso a situação vem do que a conta FAZ:
 *
 * - `ativa`      — enviou nos últimos 30 dias
 * - `em_risco`   — o último envio foi entre 30 e 60 dias atrás
 * - `inativa`    — mais de 60 dias sem enviar
 * - `nunca_usou` — nunca enviou uma mensagem
 *
 * `em_risco` é a categoria que mais vale no painel: é quem ainda dá para
 * recuperar com um contato. Quando vira `inativa`, geralmente já foi.
 *
 * ## Uma consulta, não uma por conta
 *
 * Tudo é agregado no banco. Montar a lista buscando o último envio conta a
 * conta faria o console, com quinhentos clientes, abrir quinhentas consultas —
 * e o banco é o mesmo que atende o painel dos clientes.
 *
 * ## Todo acesso fica registrado
 *
 * Cada leitura grava em `acesso_distribuicao` quem viu o quê. Num console que
 * mostra todas as contas, "quem abriu estes dados?" é a pergunta que vem depois
 * de qualquer incidente.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { ContextoDb } from '../../db/contexto';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { retomarPausadasPorTeto } from '../campanha/campanha.service';

export type Situacao = 'ativa' | 'em_risco' | 'inativa' | 'nunca_usou';

export interface ContaNoConsole {
  id: string;
  nome: string;
  cnpj: string | null;
  contaStatus: string;
  criadaEm: string;
  assinaturaStatus: string | null;
  planoNome: string | null;
  cicloInicio: string | null;
  cicloFim: string | null;
  gratisAte: string | null;
  usoCiclo: number;
  teto: number | null;
  /** Uso sobre o teto, de 0 a 100+. Nulo quando não há teto. */
  usoPercentual: number | null;
  ultimoEnvio: string | null;
  envios30d: number;
  ultimoLogin: string | null;
  erros7d: number;
  whatsappPronto: boolean;
  situacao: Situacao;
}

export interface ResumoDoConsole {
  contas: { total: number; ativas: number; emRisco: number; inativas: number; nuncaUsaram: number };
  assinaturas: Record<string, number>;
  disparos: { ciclo: number; ultimos7d: number; ultimas24h: number };
  erros: { ultimas24h: number; contasAfetadas24h: number };
  campanhasEmAndamento: number;
  /** Contas acima de 80% do teto: quem vai precisar de plano maior. */
  perto_do_teto: number;
  /** Receita recorrente: assinaturas pagas e em dia no Mercado Pago. */
  receita: { mrrCentavos: number; pagantes: number; inadimplentes: number; emGratis: number };
}

const iso = (v: unknown): string | null => (v ? new Date(String(v)).toISOString() : null);
const num = (v: unknown): number => Number(v ?? 0);

/**
 * A base de tudo: uma linha por conta, com uso, atividade e erros.
 *
 * Os CTEs agregam cada tabela UMA vez antes do join. Juntar as tabelas cruas e
 * agregar no fim multiplicaria as linhas (cada envio × cada erro × cada login)
 * e as contagens sairiam infladas sem aviso.
 */
const BASE = sql`
  with ultimo_envio as (
    select conta_id,
           max(enviada_em) as ultimo,
           count(*) filter (where enviada_em > now() - interval '30 days') as envios_30d
      from campanha_destinatario
     where enviada_em is not null
     group by conta_id
  ),
  ultimo_login as (
    select conta_id, max(ultimo_login_em) as ultimo
      from usuario
     group by conta_id
  ),
  erros as (
    select conta_id, count(*) as erros_7d
      from evento_erro
     where criado_em > now() - interval '7 days' and conta_id is not null
     group by conta_id
  ),
  numero as (
    select conta_id, bool_or(status = 'registrado') as pronto
      from wa_numero
     group by conta_id
  )
  select c.id, c.nome, c.cnpj, c.status as conta_status, c.criado_em,
         a.status as assinatura_status, a.ciclo_inicio, a.ciclo_fim, a.gratis_ate,
         p.nome as plano_nome, p.disparos_mes as teto,
         coalesce(u.disparos, 0) as uso_ciclo,
         ue.ultimo as ultimo_envio,
         coalesce(ue.envios_30d, 0) as envios_30d,
         ul.ultimo as ultimo_login,
         coalesce(e.erros_7d, 0) as erros_7d,
         coalesce(n.pronto, false) as whatsapp_pronto,
         case
           when ue.ultimo is null then 'nunca_usou'
           when ue.ultimo > now() - interval '30 days' then 'ativa'
           when ue.ultimo > now() - interval '60 days' then 'em_risco'
           else 'inativa'
         end as situacao
    from conta c
    left join assinatura a on a.conta_id = c.id
    left join plano p on p.id = coalesce(a.plano_id, c.plano_id)
    -- O uso é do ciclo CORRENTE: casar só por conta somaria os ciclos passados.
    left join uso_ciclo u on u.conta_id = c.id and u.ciclo_inicio = a.ciclo_inicio
    left join ultimo_envio ue on ue.conta_id = c.id
    left join ultimo_login ul on ul.conta_id = c.id
    left join erros e on e.conta_id = c.id
    left join numero n on n.conta_id = c.id
`;

export interface AcessoNoConsole {
  id: string;
  nome: string;
  email: string;
  papel: string;
  status: string;
  doisFatores: string;
  travado: boolean;
  ultimoLoginEm: string | null;
}

@Injectable()
export class DistribuicaoLeituraService {
  constructor(
    private readonly ctx: ContextoDb,
    private readonly auditoria: AuditoriaService,
  ) {}

  /** Quem tem acesso a uma conta, com o método das duas etapas. Nunca segredo nem hash. */
  async acessosDaConta(contaId: string): Promise<AcessoNoConsole[]> {
    return this.ctx.comEscopoSistema('distribuicao.acessos', async (db) => {
      const r = await db.execute(sql`
        select id, nome, email, papel, status, dois_fatores, ultimo_login_em,
               (bloqueado_ate is not null and bloqueado_ate > now()) as travado
          from usuario
         where conta_id = ${contaId}
         order by (papel = 'dono') desc, nome
      `);
      return r.rows.map((l: Record<string, unknown>) => ({
        id: String(l.id),
        nome: String(l.nome),
        email: String(l.email),
        papel: String(l.papel),
        status: String(l.status),
        doisFatores: String(l.dois_fatores),
        travado: l.travado === true,
        ultimoLoginEm: l.ultimo_login_em ? new Date(String(l.ultimo_login_em)).toISOString() : null,
      }));
    });
  }

  /**
   * Suporte: a pessoa perdeu o celular do aplicativo autenticador (ou está
   * travada). Desliga as duas etapas, destrava e derruba as sessões abertas.
   *
   * Só depois de conferir a identidade por fora (e-mail do dono, CNPJ). Fica
   * na auditoria da CONTA, visível ao cliente, e no registro do operador.
   */
  async zerarDuasEtapas(usuarioId: string, operadorNome: string): Promise<{ contaId: string; email: string }> {
    const alvo = await this.ctx.comEscopoSistema('distribuicao.zerar_duas_etapas', async (db) => {
      const r = await db.execute(sql`
        update usuario
           set dois_fatores = 'nenhum',
               totp_segredo_cifrado = null,
               tentativas_falhas = 0,
               bloqueado_ate = null,
               token_versao = token_versao + 1
         where id = ${usuarioId}
        returning conta_id, email
      `);
      return r.rows[0] as { conta_id: string; email: string } | undefined;
    });
    if (!alvo) throw new NotFoundException('Usuário não encontrado.');

    await this.auditoria.registrarForaDeContexto({
      contaId: alvo.conta_id,
      atorTipo: 'distribuicao',
      acao: 'usuario.duas_etapas_zeradas_pelo_suporte',
      entidade: 'usuario',
      entidadeId: usuarioId,
      detalhe: { operador: operadorNome },
    });
    return { contaId: alvo.conta_id, email: alvo.email };
  }

  async contas(): Promise<ContaNoConsole[]> {
    return this.ctx.comEscopoSistema('distribuicao.contas', async (db) => {
      const r = await db.execute(sql`${BASE} order by ue.ultimo desc nulls last, c.criado_em desc limit 500`);
      return r.rows.map((l: Record<string, unknown>) => {
        const teto = l.teto === null || l.teto === undefined ? null : num(l.teto);
        const uso = num(l.uso_ciclo);
        return {
          id: String(l.id),
          nome: String(l.nome),
          cnpj: (l.cnpj as string) ?? null,
          contaStatus: String(l.conta_status),
          criadaEm: iso(l.criado_em)!,
          assinaturaStatus: (l.assinatura_status as string) ?? null,
          planoNome: (l.plano_nome as string) ?? null,
          cicloInicio: iso(l.ciclo_inicio),
          cicloFim: iso(l.ciclo_fim),
          gratisAte: iso(l.gratis_ate),
          usoCiclo: uso,
          teto,
          usoPercentual: teto ? Math.round((uso / teto) * 100) : null,
          ultimoEnvio: iso(l.ultimo_envio),
          envios30d: num(l.envios_30d),
          ultimoLogin: iso(l.ultimo_login),
          erros7d: num(l.erros_7d),
          whatsappPronto: Boolean(l.whatsapp_pronto),
          situacao: String(l.situacao) as Situacao,
        };
      });
    });
  }

  async resumo(): Promise<ResumoDoConsole> {
    return this.ctx.comEscopoSistema('distribuicao.resumo', async (db) => {
      const r = await db.execute(sql`
        with base as (${BASE})
        select
          count(*)                                              as total,
          count(*) filter (where situacao = 'ativa')            as ativas,
          count(*) filter (where situacao = 'em_risco')         as em_risco,
          count(*) filter (where situacao = 'inativa')          as inativas,
          count(*) filter (where situacao = 'nunca_usou')       as nunca_usaram,
          coalesce(sum(uso_ciclo), 0)                           as disparos_ciclo,
          count(*) filter (where teto > 0 and uso_ciclo >= teto * 0.8) as perto_do_teto
        from base
      `);

      const assinaturas = await db.execute(sql`
        -- a.status, e não status sem prefixo: conta e assinatura têm as duas
        -- essa coluna, e o nome sozinho é ambíguo (42702). Pego pelo teste
        -- ponta a ponta — a verificação isolada do SQL não cobria esta consulta.
        select coalesce(a.status, 'sem_assinatura') as status, count(*) as total
          from conta c left join assinatura a on a.conta_id = c.id
         group by 1
      `);

      const atividade = await db.execute(sql`
        select
          count(*) filter (where enviada_em > now() - interval '7 days')  as ultimos_7d,
          count(*) filter (where enviada_em > now() - interval '24 hours') as ultimas_24h
        from campanha_destinatario
        where enviada_em > now() - interval '7 days'
      `);

      const erros = await db.execute(sql`
        select count(*) as total, count(distinct conta_id) as contas
          from evento_erro
         where criado_em > now() - interval '24 hours'
      `);

      const campanhas = await db.execute(sql`
        select count(*) as total from campanha where status in ('agendada', 'enviando')
      `);

      const receita = await db.execute(sql`
        select coalesce(sum(p.preco_centavos) filter (where a.status = 'ativa' and a.mp_status = 'authorized'), 0) as mrr,
               count(*) filter (where a.status = 'ativa' and a.mp_status = 'authorized') as pagantes,
               count(*) filter (where a.status = 'inadimplente') as inadimplentes,
               count(*) filter (where a.status = 'cortesia') as em_gratis
          from assinatura a join plano p on p.id = a.plano_id
      `);
      const rc = receita.rows[0] as Record<string, unknown>;

      const b = r.rows[0] as Record<string, unknown>;
      const at = atividade.rows[0] as Record<string, unknown>;
      const er = erros.rows[0] as Record<string, unknown>;

      return {
        contas: {
          total: num(b.total),
          ativas: num(b.ativas),
          emRisco: num(b.em_risco),
          inativas: num(b.inativas),
          nuncaUsaram: num(b.nunca_usaram),
        },
        assinaturas: Object.fromEntries(
          (assinaturas.rows as Record<string, unknown>[]).map((l) => [String(l.status), num(l.total)]),
        ),
        disparos: {
          ciclo: num(b.disparos_ciclo),
          ultimos7d: num(at.ultimos_7d),
          ultimas24h: num(at.ultimas_24h),
        },
        erros: { ultimas24h: num(er.total), contasAfetadas24h: num(er.contas) },
        campanhasEmAndamento: num((campanhas.rows[0] as Record<string, unknown>).total),
        perto_do_teto: num(b.perto_do_teto),
        receita: {
          mrrCentavos: num(rc.mrr),
          pagantes: num(rc.pagantes),
          inadimplentes: num(rc.inadimplentes),
          emGratis: num(rc.em_gratis),
        },
      };
    });
  }

  /**
   * Estende o grátis de uma conta.
   *
   * Para negociação e para contas internas (como a de revisão da Meta). Conta de
   * volta ao grátis sai da inadimplência, recebe os avisos de fim do grátis de
   * novo e tem as campanhas paradas por falta de pagamento devolvidas à fila.
   * Não mexe em quem já paga pelo Mercado Pago.
   */
  async estenderGratis(contaId: string, dias: number): Promise<{ gratisAte: string }> {
    if (!Number.isInteger(dias) || dias < 1 || dias > 365) {
      throw new BadRequestException('Informe de 1 a 365 dias.');
    }
    return this.ctx.comEscopoSistema('distribuicao.estender_gratis', async (db) => {
      const r = await db.execute(sql`
        update assinatura
           set gratis_ate = greatest(coalesce(gratis_ate, now()), now()) + make_interval(days => ${dias}),
               status = case when status in ('cortesia', 'inadimplente', 'cancelada') then 'cortesia' else status end,
               inadimplente_desde = case when status in ('cortesia', 'inadimplente', 'cancelada') then null else inadimplente_desde end,
               avisos_enviados = '{}'
         where conta_id = ${contaId}
           and mp_status is distinct from 'authorized'
        returning gratis_ate
      `);
      if (!r.rows.length) {
        throw new NotFoundException('Conta sem assinatura, ou já paga pelo Mercado Pago — o grátis não se aplica.');
      }
      await retomarPausadasPorTeto(db, [contaId], ['inadimplencia']);
      return { gratisAte: new Date(String((r.rows[0] as { gratis_ate: string }).gratis_ate)).toISOString() };
    });
  }

  /**
   * Telemetria: erros agrupados e os mais recentes.
   *
   * Agrupado por código porque é assim que o problema se mostra: um erro 190
   * em doze contas é UM problema (token vencendo em massa), não doze.
   */
  async telemetria(dias = 7) {
    const janela = Math.min(Math.max(Math.floor(dias), 1), 90);

    return this.ctx.comEscopoSistema('distribuicao.telemetria', async (db) => {
      const porCodigo = await db.execute(sql`
        select codigo, classe, origem,
               count(*) as ocorrencias,
               count(distinct conta_id) as contas,
               max(criado_em) as ultima
          from evento_erro
         where criado_em > now() - make_interval(days => ${janela})
         group by codigo, classe, origem
         order by ocorrencias desc
         limit 50
      `);

      const recentes = await db.execute(sql`
        select e.id, e.criado_em, e.origem, e.classe, e.codigo, e.status,
               e.metodo, e.rota, e.referencia, e.mensagem, c.nome as conta_nome, e.conta_id
          from evento_erro e
          left join conta c on c.id = e.conta_id
         where e.criado_em > now() - make_interval(days => ${janela})
         order by e.criado_em desc
         limit 100
      `);

      return {
        dias: janela,
        porCodigo: (porCodigo.rows as Record<string, unknown>[]).map((l) => ({
          codigo: l.codigo === null ? null : num(l.codigo),
          classe: (l.classe as string) ?? null,
          origem: String(l.origem),
          ocorrencias: num(l.ocorrencias),
          contas: num(l.contas),
          ultima: iso(l.ultima),
        })),
        recentes: (recentes.rows as Record<string, unknown>[]).map((l) => ({
          id: String(l.id),
          criadoEm: iso(l.criado_em),
          origem: String(l.origem),
          classe: (l.classe as string) ?? null,
          codigo: l.codigo === null ? null : num(l.codigo),
          status: l.status === null ? null : num(l.status),
          metodo: (l.metodo as string) ?? null,
          rota: (l.rota as string) ?? null,
          referencia: (l.referencia as string) ?? null,
          mensagem: (l.mensagem as string) ?? null,
          contaNome: (l.conta_nome as string) ?? null,
          contaId: (l.conta_id as string) ?? null,
        })),
      };
    });
  }
}
