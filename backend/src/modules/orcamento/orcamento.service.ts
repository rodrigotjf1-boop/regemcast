/**
 * O orçamento de disparos da conta: ler e definir os tetos.
 *
 * Qualquer pessoa da conta lê (o operador dispara dentro do orçamento e precisa
 * ver quanto sobra); só o dono define — decisão dele, em 02/10/2026. A rota
 * confere pelo `DonoGuard`.
 *
 * Mudou o orçamento, as campanhas que ele tinha pausado voltam para a fila na
 * hora: a rodada seguinte confere a folga e, se ainda não couber, pausa de novo.
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';

import { ContextoDb } from '../../db/contexto';
import { conta } from '../../db/schema';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { estadoDoOrcamento, retomarPausadasPeloOrcamento } from './orcamento.consulta';
import { conferirTetos, orcamentoParaTela, type OrcamentoParaTela, type Periodo } from './orcamento.regras';

@Injectable()
export class OrcamentoService {
  constructor(
    private readonly ctx: ContextoDb,
    private readonly auditoria: AuditoriaService,
  ) {}

  /** Os tetos e quanto já saiu em cada período. */
  async ler(contaId: string, papel: 'dono' | 'operador'): Promise<OrcamentoParaTela> {
    const estado = await estadoDoOrcamento(this.ctx.db, contaId);
    return orcamentoParaTela(estado.tetos, estado.usos, estado.moeda, estado.tarifas.length > 0, papel === 'dono');
  }

  /**
   * Define os três tetos de uma vez — a tela manda os três campos, e campo
   * vazio tira o teto daquele período.
   */
  async definir(
    contaId: string,
    usuarioId: string,
    entrada: Partial<Record<Periodo, unknown>>,
  ): Promise<OrcamentoParaTela> {
    const tetos = conferirTetos(entrada);
    if ('erro' in tetos) throw new BadRequestException(tetos.erro);

    const [antes] = await this.ctx.db
      .select({ dia: conta.orcamentoDiaCentavos, semana: conta.orcamentoSemanaCentavos, mes: conta.orcamentoMesCentavos })
      .from(conta)
      .where(eq(conta.id, contaId))
      .limit(1);

    await this.ctx.db
      .update(conta)
      .set({ orcamentoDiaCentavos: tetos.dia, orcamentoSemanaCentavos: tetos.semana, orcamentoMesCentavos: tetos.mes })
      .where(eq(conta.id, contaId));

    // Teto novo, avisos novos: o de 80% e o de 100% voltam a valer para o período corrente.
    await this.ctx.db.execute(sql`delete from orcamento_aviso where conta_id = ${contaId}`);
    const retomadas = await retomarPausadasPeloOrcamento(this.ctx.db, contaId);

    await this.auditoria.registrar({
      contaId,
      atorTipo: 'usuario',
      atorUsuarioId: usuarioId,
      acao: 'conta.orcamento_alterado',
      entidade: 'conta',
      entidadeId: contaId,
      detalhe: { antes: antes ?? null, depois: tetos, campanhasRetomadas: retomadas },
    });

    return this.ler(contaId, 'dono');
  }
}
