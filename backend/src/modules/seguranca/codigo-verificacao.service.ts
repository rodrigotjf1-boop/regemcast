/**
 * Códigos de 6 dígitos enviados por e-mail.
 *
 * Servem a três momentos: confirmar o e-mail no convite, a segunda etapa do
 * login e a ativação da verificação por e-mail. As regras são as mesmas nos
 * três, então moram aqui:
 *
 * - **Só o HMAC vai para o banco**, com segredo do servidor. Um sha256 simples
 *   não protegeria nada — um milhão de combinações se testam em um segundo.
 * - **Vale 10 minutos e morre no quinto erro.** Sem o teto de erros, um robô
 *   percorre o milhão de combinações dentro da validade.
 * - **Um código novo mata os anteriores.** Senão, pedir três códigos triplica
 *   as chances de quem está adivinhando.
 * - **Reenvio espaçado:** um por minuto, cinco por hora. Sem isso a rota vira
 *   canhão de e-mail contra a caixa de alguém — e queima a reputação do nosso
 *   domínio de envio.
 *
 * O erro conta mesmo quando o request termina em erro: a conferência roda na
 * PRÓPRIA transação, que confirma o incremento antes de a resposta de "código
 * errado" sair. Dentro da transação do request, o rollback apagaria justamente
 * a contagem que trava o robô.
 */
import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';

import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';

import { env } from '../../config/env';
import { ContextoDb } from '../../db/contexto';
import { codigoVerificacao } from '../../db/schema';

export type FinalidadeCodigo = 'convite' | 'login' | 'ativar_email' | 'recuperar_senha';

export const MINUTOS_VALIDADE = 10;
export const MAX_ERROS_POR_CODIGO = 5;
const SEGUNDOS_ENTRE_ENVIOS = 60;
const MAX_ENVIOS_POR_HORA = 5;

export type ResultadoConferencia = 'ok' | 'errado' | 'expirado' | 'esgotado';

/** Segredo próprio dos códigos, derivado do JWT_SECRET com rótulo. */
function segredoDosCodigos(): string {
  return createHmac('sha256', env.sessao.segredo).update('regemcast:codigo-verificacao:v1').digest('hex');
}

/** O id entra no HMAC: o mesmo código em duas linhas gera hashes diferentes. */
export function hashDoCodigo(id: string, codigo: string): string {
  return createHmac('sha256', segredoDosCodigos()).update(`${id}:${codigo}`).digest('hex');
}

/** Seis dígitos, com zero à esquerda, de fonte criptográfica. */
export function novoCodigo(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** Tira espaço e traço — o e-mail mostra "123 456". */
export function limparCodigo(bruto: string): string {
  return String(bruto ?? '').replace(/\D/g, '');
}

@Injectable()
export class CodigoVerificacaoService {
  constructor(private readonly ctx: ContextoDb) {}

  /**
   * Cria o código e devolve em claro para quem vai mandar o e-mail.
   *
   * Recusa com 429 quando o reenvio vem cedo demais — a mensagem diz quanto
   * esperar, em vez de só "tente mais tarde".
   */
  async emitir(dados: {
    finalidade: FinalidadeCodigo;
    email: string;
    usuarioId?: string | null;
    listaEsperaId?: string | null;
  }): Promise<{ codigo: string; minutos: number }> {
    const email = dados.email.trim().toLowerCase();

    return this.ctx.comEscopoSistema(`codigo.emitir.${dados.finalidade}`, async (db) => {
      // Serializa por e-mail + finalidade: dois cliques simultâneos em "reenviar"
      // não furam o espaçamento.
      await db.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`regemcast.codigo.${dados.finalidade}.${email}`}))`,
      );

      const envios = await db.execute(sql`
        select count(*) filter (where criado_em > now() - interval '1 hour') as ultima_hora,
               extract(epoch from (now() - max(criado_em))) as segundos_desde_ultimo
          from codigo_verificacao
         where finalidade = ${dados.finalidade} and email = ${email}
      `);
      const linha = envios.rows[0] as { ultima_hora: string | number; segundos_desde_ultimo: string | null };

      const segundos = linha.segundos_desde_ultimo === null ? null : Number(linha.segundos_desde_ultimo);
      if (segundos !== null && segundos < SEGUNDOS_ENTRE_ENVIOS) {
        const falta = Math.ceil(SEGUNDOS_ENTRE_ENVIOS - segundos);
        throw new HttpException(
          `Acabamos de enviar um código. Aguarde ${falta} segundo(s) para pedir outro.`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      if (Number(linha.ultima_hora) >= MAX_ENVIOS_POR_HORA) {
        throw new HttpException(
          'Muitos códigos pedidos na última hora. Use o último que chegou ou tente de novo mais tarde.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      // Código novo mata os anteriores ainda abertos.
      await db
        .update(codigoVerificacao)
        .set({ expiraEm: sql`now()` })
        .where(
          and(
            eq(codigoVerificacao.finalidade, dados.finalidade),
            eq(codigoVerificacao.email, email),
            isNull(codigoVerificacao.usadoEm),
            gt(codigoVerificacao.expiraEm, sql`now()`),
          ),
        );

      const id = randomUUID();
      const codigo = novoCodigo();

      await db.insert(codigoVerificacao).values({
        id,
        finalidade: dados.finalidade,
        email,
        usuarioId: dados.usuarioId ?? null,
        listaEsperaId: dados.listaEsperaId ?? null,
        codigoHash: hashDoCodigo(id, codigo),
        expiraEm: sql`now() + make_interval(mins => ${MINUTOS_VALIDADE})`,
      });

      return { codigo, minutos: MINUTOS_VALIDADE };
    });
  }

  /**
   * Confere o código digitado contra o último código aberto.
   *
   * Transação própria: o erro fica contado mesmo que o request termine em erro.
   * No acerto, o código é marcado como usado e não vale uma segunda vez.
   */
  async conferir(dados: {
    finalidade: FinalidadeCodigo;
    email: string;
    codigo: string;
  }): Promise<ResultadoConferencia> {
    const email = dados.email.trim().toLowerCase();
    const digitado = limparCodigo(dados.codigo);

    return this.ctx.comEscopoSistema(`codigo.conferir.${dados.finalidade}`, async (db) => {
      const [aberto] = await db
        .select({
          id: codigoVerificacao.id,
          codigoHash: codigoVerificacao.codigoHash,
          tentativas: codigoVerificacao.tentativas,
        })
        .from(codigoVerificacao)
        .where(
          and(
            eq(codigoVerificacao.finalidade, dados.finalidade),
            eq(codigoVerificacao.email, email),
            isNull(codigoVerificacao.usadoEm),
            gt(codigoVerificacao.expiraEm, sql`now()`),
          ),
        )
        .orderBy(desc(codigoVerificacao.criadoEm))
        .limit(1)
        // Duas conferências simultâneas do mesmo código não passam as duas.
        .for('update');

      if (!aberto) return 'expirado';
      if (aberto.tentativas >= MAX_ERROS_POR_CODIGO) return 'esgotado';

      const esperado = Buffer.from(aberto.codigoHash, 'hex');
      const recebido = Buffer.from(hashDoCodigo(aberto.id, digitado), 'hex');
      const confere =
        digitado.length === 6 && esperado.length === recebido.length && timingSafeEqual(esperado, recebido);

      if (!confere) {
        await db
          .update(codigoVerificacao)
          .set({ tentativas: sql`${codigoVerificacao.tentativas} + 1` })
          .where(eq(codigoVerificacao.id, aberto.id));
        return 'errado';
      }

      await db
        .update(codigoVerificacao)
        .set({ usadoEm: sql`now()` })
        .where(eq(codigoVerificacao.id, aberto.id));
      return 'ok';
    });
  }
}

/** A frase de cada recusa, para as rotas não inventarem textos diferentes. */
export const MENSAGEM_CODIGO: Record<Exclude<ResultadoConferencia, 'ok'>, string> = {
  errado: 'Código não confere. Confira o e-mail e tente de novo.',
  expirado: 'Este código expirou ou já foi usado. Peça um novo.',
  esgotado: 'Muitas tentativas erradas neste código. Peça um novo.',
};
