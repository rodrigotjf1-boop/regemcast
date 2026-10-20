/**
 * O aviso ao dono a cada ligação nova (Padrão DMS §3, decisão B1-4 do Hub DMS):
 * e-mail sempre, que não se desliga, e aviso no celular do tipo `seguranca`.
 *
 * - **Ligação por clique** (nova, com mais permissões ou renovada): vai mesmo
 *   quando foi o próprio dono que autorizou. É o recibo, e o alarme se não foi ele.
 * - **Ligação que nasceu sozinha de um token antigo** (a troca automática,
 *   decisão F2-3): o alcance é o mesmo; muda a forma, e o dono passa a ver a
 *   ligação em "Aplicativos conectados".
 *
 * Nada aqui lança: quem chama faz `void` depois de gravar. O aviso perdido vira
 * linha de log com o motivo, nunca uma ligação desfeita.
 */
import { Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';

import { env } from '../../config/env';
import { ContextoDb } from '../../db/contexto';
import { conta, usuario } from '../../db/schema';
import { AvisoService } from '../aviso/aviso.service';
import { EmailService } from '../email/email.service';
import { emailAplicativoLigado, emailLigacaoMudouDeForma } from '../email/modelos-email';
import { descreverEscopos } from './integracao.regras';

export type TipoDeLigacaoNova = 'nova' | 'mais' | 'renovada';

/** "às 10:12 de 20/10/2026", no fuso da conta. */
export function quandoNoFuso(d: Date, fuso: string): string {
  const hora = d.toLocaleTimeString('pt-BR', { timeZone: fuso, hour: '2-digit', minute: '2-digit' });
  const data = d.toLocaleDateString('pt-BR', { timeZone: fuso });
  return `às ${hora} de ${data}`;
}

const dataNoFuso = (d: Date, fuso: string) => d.toLocaleDateString('pt-BR', { timeZone: fuso });

@Injectable()
export class AvisoDeLigacao {
  private readonly log = new Logger('AvisoDeLigacao');

  constructor(
    private readonly ctx: ContextoDb,
    private readonly email: EmailService,
    private readonly avisos: AvisoService,
  ) {}

  private get linkDaTela(): string {
    return `${env.rede.appUrl.replace(/\/+$/, '')}/integracoes`;
  }

  /** O dono ativo da conta, com o nome e o fuso da conta. Transação própria: o aviso sai depois da de quem chamou. */
  private async dono(contaId: string): Promise<{ email: string; nome: string; contaNome: string; fuso: string } | null> {
    const [l] = await this.ctx.comConta(contaId, (db) =>
      db
        .select({ email: usuario.email, nome: usuario.nome, contaNome: conta.nome, fuso: conta.timezone })
        .from(usuario)
        .innerJoin(conta, eq(conta.id, usuario.contaId))
        .where(and(eq(usuario.contaId, contaId), eq(usuario.papel, 'dono'), eq(usuario.status, 'ativo')))
        .limit(1),
    );
    return l ?? null;
  }

  async ligacaoPorClique(
    contaId: string,
    d: { aplicativo: string; contaQuePede: { nome: string; cnpj: string | null }; escopos: readonly string[]; tipo: TipoDeLigacaoNova; quando: Date },
  ): Promise<void> {
    try {
      const dono = await this.dono(contaId);
      if (!dono) {
        this.log.warn(`Aviso de ligação do ${d.aplicativo} não saiu: a conta ${contaId} não tem dono ativo.`);
        return;
      }
      const liberadas = descreverEscopos(d.escopos).map((e) => e.rotulo.toLowerCase());
      const titulo =
        d.tipo === 'nova' ? `${d.aplicativo} ligado à sua conta` : d.tipo === 'mais' ? `${d.aplicativo} com mais permissões` : `${d.aplicativo} autorizado de novo`;
      await Promise.all([
        this.email
          .enviar(
            emailAplicativoLigado(dono.email, {
              nome: dono.nome,
              aplicativo: d.aplicativo,
              contaNome: dono.contaNome,
              contaQuePede: d.contaQuePede,
              quando: quandoNoFuso(d.quando, dono.fuso),
              liberadas,
              tipo: d.tipo,
              link: this.linkDaTela,
            }),
          )
          .catch((erro: unknown) => this.log.warn(`E-mail de ligação do ${d.aplicativo} para a conta ${contaId} não saiu: ${String(erro)}`)),
        // O app não tem a tela dos aplicativos conectados: o aviso diz onde desligar, não promete desligar pelo toque.
        this.avisos.avisar(contaId, 'seguranca', { titulo, corpo: 'Não foi você? Desligue em Integrações, no site do Regemcast.' }, { soDono: true }),
      ]);
    } catch (erro) {
      this.log.warn(`Aviso de ligação do ${d.aplicativo} para a conta ${contaId} não saiu: ${String(erro)}`);
    }
  }

  async ligacaoMigrada(contaId: string, d: { aplicativo: string; escopos: readonly string[]; liberadoEm: Date; desde: Date }): Promise<void> {
    try {
      const dono = await this.dono(contaId);
      if (!dono) return;
      await this.email.enviar(
        emailLigacaoMudouDeForma(dono.email, {
          nome: dono.nome,
          aplicativo: d.aplicativo,
          desde: dataNoFuso(d.desde, dono.fuso),
          liberadoEm: dataNoFuso(d.liberadoEm, dono.fuso),
          permissoes: descreverEscopos(d.escopos).map((e) => e.rotulo.toLowerCase()),
          link: this.linkDaTela,
        }),
      );
    } catch (erro) {
      this.log.warn(`Aviso de ligação migrada do ${d.aplicativo} para a conta ${contaId} não saiu: ${String(erro)}`);
    }
  }
}
