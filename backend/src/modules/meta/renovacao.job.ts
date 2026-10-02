/**
 * Renova sozinho a autorização de cada conta, antes de ela vencer.
 *
 * O token do Embedded Signup vence em 60 dias. Vencido, a Meta recusa tudo com
 * 190 e o dono precisa reconectar pela janela dela. Enquanto o token ainda
 * vale, a Meta tem uma renovação oficial — a troca
 * `grant_type=fb_exchange_token` com `set_token_expires_in_60_days=true` —, que
 * devolve um token novo de 60 dias sem ninguém precisar fazer nada.
 *
 * A cada hora pega até 20 contas cuja autorização vence em menos de 53 dias
 * (ou seja: emitida há mais de uma semana), uma de cada vez:
 *
 * 1. troca o token pelo novo;
 * 2. confere que o novo enxerga a conta — sem isso, não grava;
 * 3. grava o token novo (cifrado), a validade e "renovada agora".
 *
 * Renovar toda semana, e não na véspera, é a margem: se a Meta recusar, são
 * sete semanas de tentativas diárias antes de vencer — e o aviso e o botão
 * "Reconectar" da tela aparecem na última.
 *
 * O que falha fica anotado em `token_renovacao_erro` (o código, nunca a frase
 * nem o token) e a conta só volta a ser tentada no dia seguinte. Fica no banco,
 * e não só no log, porque a documentação da Meta não diz se a renovação vale
 * para a autorização que o Embedded Signup emite: é por essa coluna que se
 * descobre.
 *
 * Fora daqui: autorização sem prazo (não vence), e a que já venceu (a Meta só
 * renova o que ainda vale — aí é reconectar).
 *
 * Nenhuma transação fica aberta durante a chamada à Meta. Escopo de sistema:
 * job sem conta (motivo A, `docs/rls.md`).
 */
import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { eq, sql } from 'drizzle-orm';

import { env } from '../../config/env';
import { ContextoDb } from '../../db/contexto';
import { waConta } from '../../db/schema';
import { cifrarToken, decifrarToken } from './cripto';
import { ErroGraph, GraphService } from './graph.service';

const INTERVALO_MS = 60 * 60_000;
const POR_VOLTA = 20;
/** Renova quando faltam menos dias que isto: uma semana depois de emitida (a autorização dura 60). */
export const RENOVAR_QUANDO_FALTAM_DIAS = 53;
/** Falha sem código da Meta (rede, tempo esgotado, resposta sem token). */
export const SEM_CODIGO = -1;

interface ContaParaRenovar {
  id: string;
  waba_id: string;
  token_cifrado: string;
}

@Injectable()
export class RenovacaoJob {
  private readonly log = new Logger('RenovacaoDaAutorizacao');
  private rodando = false;

  constructor(
    private readonly ctx: ContextoDb,
    private readonly graph: GraphService,
  ) {}

  @Interval(INTERVALO_MS)
  async acompanhar(): Promise<void> {
    if (this.rodando) return;
    this.rodando = true;
    try {
      await this.renovarVencendo();
    } catch (erro) {
      // Nunca deixa subir: exceção aqui derruba o agendador.
      this.log.error(`Renovação das autorizações falhou: ${(erro as Error)?.message ?? String(erro)}`, (erro as Error)?.stack);
    } finally {
      this.rodando = false;
    }
  }

  /** Renova as autorizações que estão para vencer. Devolve quantas foram renovadas. */
  async renovarVencendo(): Promise<number> {
    const contas = await this.ctx.comEscopoSistema('meta.renovacao.vencendo', async (db) => {
      const r = await db.execute(sql`
        select id, waba_id, token_cifrado
          from wa_conta
         where token_cifrado is not null
           and token_expira_em is not null
           and token_expira_em > now()
           and token_expira_em < now() + make_interval(days => ${RENOVAR_QUANDO_FALTAM_DIAS})
           and (token_renovacao_em is null or token_renovacao_em < now() - interval '24 hours')
         order by token_expira_em
         limit ${POR_VOLTA}
      `);
      return r.rows as unknown as ContaParaRenovar[];
    });

    let renovadas = 0;
    for (const c of contas) {
      if (await this.renovar(c)) renovadas++;
    }
    return renovadas;
  }

  private async renovar(c: ContaParaRenovar): Promise<boolean> {
    let atual: string;
    try {
      atual = decifrarToken(c.token_cifrado, env.meta.tokenChave);
    } catch (erro) {
      this.log.error(`Não consegui decifrar o token da WABA ${this.mascarar(c.waba_id)}: ${String(erro)}`);
      await this.anotar(c.id, { tokenRenovacaoEm: new Date(), tokenRenovacaoErro: SEM_CODIGO });
      return false;
    }

    try {
      const novo = await this.graph.renovarToken(atual);
      if (!novo.token) throw new Error('a Meta respondeu sem o token novo');
      // O token novo enxerga a conta? Sem isso, fica o que está guardado.
      await this.graph.dadosDaWaba(c.waba_id, novo.token);

      const agora = new Date();
      await this.anotar(c.id, {
        tokenCifrado: cifrarToken(novo.token, env.meta.tokenChave),
        tokenEm: agora,
        // Sem prazo na resposta, a Meta não disse: "sem prazo", e não uma data inventada.
        tokenExpiraEm: novo.expiraEm && novo.expiraEm > 0 ? new Date(agora.getTime() + novo.expiraEm * 1000) : null,
        tokenRenovacaoEm: agora,
        tokenRenovacaoErro: null,
      });
      this.log.log(`Autorização da WABA ${this.mascarar(c.waba_id)} renovada.`);
      return true;
    } catch (erro) {
      const codigo = erro instanceof ErroGraph ? (erro.codigo ?? SEM_CODIGO) : SEM_CODIGO;
      this.log.warn(
        `Não consegui renovar a autorização da WABA ${this.mascarar(c.waba_id)}: ${erro instanceof ErroGraph ? erro.detalheParaLog : String(erro)}`,
      );
      await this.anotar(c.id, { tokenRenovacaoEm: new Date(), tokenRenovacaoErro: codigo });
      return false;
    }
  }

  private async anotar(waContaId: string, valores: Partial<typeof waConta.$inferInsert>): Promise<void> {
    await this.ctx.comEscopoSistema('meta.renovacao.gravar', (db) => db.update(waConta).set(valores).where(eq(waConta.id, waContaId)));
  }

  private mascarar(valor: string): string {
    return valor.length <= 4 ? '••••' : `••••${valor.slice(-4)}`;
  }
}
