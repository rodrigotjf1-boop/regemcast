/**
 * O aviso a quem aprova disparos (Hub DMS, F5 parte B): o dono e quem ele
 * autorizou, ativos, recebem um e-mail e o aviso no celular quando outro
 * produto da DMS pede um disparo, e de novo na metade do prazo se ninguém
 * respondeu (decisão F5-4). WhatsApp não: a mensagem é cobrada.
 *
 * O e-mail nunca traz código: aprovar só se faz na tela, com o aplicativo
 * autenticador (decisão F5-1). Nada aqui lança: quem chama faz `void` depois
 * de gravar, e o aviso perdido vira linha de log com o motivo.
 */
import { Injectable, Logger } from '@nestjs/common';
import { and, eq, or } from 'drizzle-orm';

import { env } from '../../config/env';
import { ContextoDb } from '../../db/contexto';
import { acaoPedido, conta, usuario } from '../../db/schema';
import { AvisoService } from '../aviso/aviso.service';
import { EmailService } from '../email/email.service';
import { emailPedidoDeDisparo } from '../email/modelos-email';
import { quandoNoFuso } from '../integracao/aviso-de-ligacao.service';
import { dinheiro } from '../orcamento/custo.regras';
import { nomeDoProduto, type PlanoDoDisparo } from './aprovacao.regras';

@Injectable()
export class AvisoDeAprovacao {
  private readonly log = new Logger('AvisoDeAprovacao');

  constructor(
    private readonly ctx: ContextoDb,
    private readonly email: EmailService,
    private readonly avisos: AvisoService,
  ) {}

  private link(id: string): string {
    return `${String(env.rede?.appUrl ?? '').replace(/\/+$/, '')}/campanhas/para-aprovar/${id}`;
  }

  /** O pedido novo (ou o lembrete): e-mail a cada pessoa que pode aprovar, e o aviso no celular dela. */
  async pedidoNovo(contaId: string, id: string, lembrete: boolean, planoConhecido?: PlanoDoDisparo): Promise<void> {
    try {
      const dados = await this.ctx.comConta(contaId, async (db) => {
        const [p] = await db
          .select({ plano: acaoPedido.plano, aplicativo: acaoPedido.aplicativo, criadoEm: acaoPedido.criadoEm, venceEm: acaoPedido.venceEm, situacao: acaoPedido.situacao })
          .from(acaoPedido)
          .where(and(eq(acaoPedido.id, id), eq(acaoPedido.contaId, contaId)))
          .limit(1);
        if (!p) return null;
        const pessoas = await db
          .select({ id: usuario.id, email: usuario.email, nome: usuario.nome, papel: usuario.papel, fuso: conta.timezone })
          .from(usuario)
          .innerJoin(conta, eq(conta.id, usuario.contaId))
          .where(and(eq(usuario.contaId, contaId), eq(usuario.status, 'ativo'), or(eq(usuario.papel, 'dono'), eq(usuario.aprovaDisparos, true))));
        return { p, pessoas };
      });
      if (!dados || dados.p.situacao !== 'aguardando') return;
      if (!dados.pessoas.length) {
        this.log.warn(`Pedido de disparo ${id} sem ninguém para aprovar na conta ${contaId}: nenhum dono ativo.`);
        return;
      }
      const plano = (planoConhecido ?? dados.p.plano) as PlanoDoDisparo;
      const aplicativo = nomeDoProduto(dados.p.aplicativo);
      const custo = plano.custo?.estimadoCentavos != null && plano.custo.moeda ? dinheiro(plano.custo.estimadoCentavos, plano.custo.moeda) : null;
      const cupom = plano.cupom ? (plano.cupom.descricao ? `${plano.cupom.codigo} (${plano.cupom.descricao})` : plano.cupom.codigo) : null;
      const titulo = lembrete ? `Lembrete: pedido de disparo de ${plano.nome}` : `Pedido de disparo: ${plano.nome}`;
      const corpo = `${plano.publico.aceitaram} ${plano.publico.aceitaram === 1 ? 'pessoa' : 'pessoas'}${custo ? `, cerca de ${custo}` : ''}. Toque para ver.`;

      await Promise.all([
        ...dados.pessoas.map((u) =>
          this.email
            .enviar(
              emailPedidoDeDisparo(u.email, {
                nome: u.nome,
                aplicativo,
                campanha: plano.nome,
                quando: quandoNoFuso(dados.p.criadoEm, u.fuso),
                pessoas: plano.publico.aceitaram,
                custo,
                cupom,
                venceEm: quandoNoFuso(dados.p.venceEm, u.fuso),
                lembrete,
                link: this.link(id),
              }),
            )
            .catch((erro: unknown) => this.log.warn(`E-mail do pedido de disparo ${id} não saiu: ${String(erro)}`)),
        ),
        // Só a quem pode aprovar: o dono e quem ele autorizou.
        this.avisos.avisar(contaId, 'campanhas', { titulo, corpo, dados: { tela: 'para-aprovar', pedidoId: id } }, { soQuemAprova: true }),
      ]);
    } catch (erro) {
      this.log.warn(`Aviso do pedido de disparo ${id} na conta ${contaId} não saiu: ${String(erro)}`);
    }
  }
}
