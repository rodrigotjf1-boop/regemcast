/**
 * Login dos operadores da distribuição.
 *
 * Este login protege um console que enxerga TODAS as contas. Cada decisão abaixo
 * é sobre o que acontece quando alguma coisa dá errado — senha vazada, token de
 * cliente reaproveitado, robô tentando senhas.
 *
 * ## Duas etapas, sempre
 *
 * Não existe sessão de operador sem o código do aplicativo autenticador. O
 * primeiro login leva ao cadastro do código; os seguintes pedem o código. Senha
 * vazada sozinha não abre nada.
 *
 * Entre a senha e o código existe uma PRÉ-SESSÃO: um token de 5 minutos que só
 * serve para dar o passo seguinte. Ela não abre o console — só prova que a
 * senha foi aceita há pouco.
 *
 * ## Segredo de assinatura próprio
 *
 * A sessão do cliente é assinada com `JWT_SECRET`. Se a do operador usasse o
 * mesmo segredo, um token de cliente poderia ser apresentado como de operador —
 * confusão de token, o defeito que dá acesso total a quem tem uma conta comum.
 *
 * O segredo daqui é DERIVADO: HMAC do `JWT_SECRET` com um rótulo próprio. Um
 * token de cliente nunca valida aqui, e um de operador nunca valida no login do
 * cliente — e não é preciso guardar mais uma variável para isso.
 *
 * ## Tentativas
 *
 * Cinco erros seguidos travam o operador por 15 minutos — senha OU código. O
 * código tem só um milhão de combinações; sem trava, um robô as percorre.
 *
 * ## Mesmo tempo para e-mail que existe e que não existe
 *
 * Mesma "isca" do login do cliente: quando o e-mail não existe, gasta o tempo
 * de uma verificação de senha real. Sem isso, a resposta rápida entregaria
 * quais e-mails são de operador.
 */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import argon2 from 'argon2';
import { eq, sql } from 'drizzle-orm';
import { createHmac } from 'node:crypto';

import { env } from '../../config/env';
import { ContextoDb } from '../../db/contexto';
import { acessoDistribuicao, operadorDistribuicao } from '../../db/schema';
import { gerarHashSenha } from '../auth/argon2';
import { cifrarToken, decifrarToken } from '../meta/cripto';
import { codigoConfere, enderecoParaAplicativo, novoSegredo } from './totp';

/** Quantos erros seguidos travam o operador. */
export const MAX_TENTATIVAS = 5;
export const MINUTOS_BLOQUEIO = 15;
const MINUTOS_PRE_SESSAO = 5;

/** O que o próximo passo do login pede. */
export type Etapa = 'codigo' | 'cadastrar_codigo';

/** Os dois tipos de token deste login. O `tipo` impede usar um no lugar do outro. */
interface PayloadPre {
  sub: string;
  tipo: 'pre';
  etapa: Etapa;
  ver: number;
}

export interface PayloadSessao {
  sub: string;
  tipo: 'sessao';
  ver: number;
}

export interface MetaRequisicao {
  ip?: string;
  userAgent?: string;
}

/**
 * O segredo que assina os tokens da distribuição.
 *
 * Derivado, e não o `JWT_SECRET` direto: é isto que impede um token de cliente
 * de valer como token de operador.
 */
export function segredoDaDistribuicao(): string {
  return createHmac('sha256', env.sessao.segredo).update('regemcast:distribuicao:v1').digest('hex');
}

@Injectable()
export class DistribuicaoAuthService {
  private readonly log = new Logger('DistribuicaoAuth');
  private isca: Promise<string> | null = null;

  constructor(
    private readonly ctx: ContextoDb,
    private readonly jwt: JwtService,
  ) {}

  // --------------------------------------------------------------- operador

  /**
   * Cria um operador. Chamado só por rota protegida pela chave-mestra.
   *
   * A chave-mestra passa a servir para isto e só isto: fazer nascer os
   * operadores, que dali em diante entram cada um com o próprio login.
   */
  async criarOperador(nome: string, email: string, senha: string): Promise<{ id: string }> {
    const emailLimpo = email.trim().toLowerCase();
    const hash = await gerarHashSenha(senha);

    return this.ctx.comEscopoSistema('distribuicao.criar_operador', async (db) => {
      const [existente] = await db
        .select({ id: operadorDistribuicao.id })
        .from(operadorDistribuicao)
        .where(sql`lower(${operadorDistribuicao.email}) = ${emailLimpo}`)
        .limit(1);

      if (existente) throw new BadRequestException('Já existe um operador com este e-mail.');

      const [criado] = await db
        .insert(operadorDistribuicao)
        .values({ nome: nome.trim(), email: emailLimpo, senhaHash: hash })
        .returning({ id: operadorDistribuicao.id });

      await db.insert(acessoDistribuicao).values({
        operadorId: criado!.id,
        operadorNome: nome.trim(),
        acao: 'operador.criado',
        detalhe: { email: emailLimpo },
      });

      return { id: criado!.id };
    });
  }

  // ------------------------------------------------------------------ senha

  /**
   * Primeiro passo: e-mail e senha.
   *
   * Nunca emite sessão. Emite uma pré-sessão de 5 minutos que só serve para o
   * passo do código.
   */
  async entrar(
    email: string,
    senha: string,
    meta: MetaRequisicao,
  ): Promise<{ etapa: Etapa; preToken: string }> {
    const emailLimpo = email.trim().toLowerCase();

    const operador = await this.ctx.comEscopoSistema('distribuicao.entrar', async (db) => {
      const [o] = await db
        .select()
        .from(operadorDistribuicao)
        .where(sql`lower(${operadorDistribuicao.email}) = ${emailLimpo}`)
        .limit(1);
      return o;
    });

    if (!operador) {
      await this.gastarTempoDeVerificacao(senha);
      await this.registrar(null, null, 'login_negado', meta, { motivo: 'email_desconhecido' });
      throw new UnauthorizedException('E-mail ou senha não conferem.');
    }

    this.recusarSeBloqueado(operador.bloqueadoAte);

    if (operador.status !== 'ativo') {
      await this.registrar(operador.id, operador.nome, 'login_negado', meta, { motivo: 'suspenso' });
      throw new ForbiddenException('Este acesso de operador está suspenso.');
    }

    const confere = await this.conferirSenha(operador.senhaHash, senha, operador.id);
    if (!confere) {
      await this.contarFalha(operador.id);
      await this.registrar(operador.id, operador.nome, 'login_negado', meta, { motivo: 'senha' });
      throw new UnauthorizedException('E-mail ou senha não conferem.');
    }

    const etapa: Etapa = operador.totpAtivo ? 'codigo' : 'cadastrar_codigo';
    const payload: PayloadPre = { sub: operador.id, tipo: 'pre', etapa, ver: operador.tokenVersao };

    const preToken = await this.jwt.signAsync(payload, {
      secret: segredoDaDistribuicao(),
      expiresIn: `${MINUTOS_PRE_SESSAO}m`,
    });

    return { etapa, preToken };
  }

  // ----------------------------------------------------------------- código

  /** Segundo passo, para quem já tem o código cadastrado. */
  async confirmarCodigo(preToken: string, codigo: string, meta: MetaRequisicao): Promise<string> {
    const pre = await this.lerPre(preToken, 'codigo');
    const operador = await this.buscarOperador(pre.sub);

    this.recusarSeBloqueado(operador.bloqueadoAte);
    this.conferirVersao(operador, pre.ver);

    const segredo = this.decifrarSegredo(operador.totpSegredoCifrado);
    if (!segredo || !codigoConfere(segredo, codigo)) {
      await this.contarFalha(operador.id);
      await this.registrar(operador.id, operador.nome, 'codigo_negado', meta, {});
      throw new UnauthorizedException('Código não confere. Confira o aplicativo e tente de novo.');
    }

    return this.abrirSessao(operador, meta);
  }

  /**
   * Primeiro login: gera o segredo e devolve o endereço para o aplicativo.
   *
   * O segredo é gravado já cifrado, mas `totp_ativo` continua falso. Só vira
   * verdade quando o operador confirmar um código — segredo nunca confirmado
   * não protege nada, e ativá-lo antes trancaria para fora quem escaneou errado.
   */
  async iniciarCadastroDoCodigo(preToken: string): Promise<{ endereco: string; segredo: string }> {
    const pre = await this.lerPre(preToken, 'cadastrar_codigo');
    const operador = await this.buscarOperador(pre.sub);
    this.conferirVersao(operador, pre.ver);

    if (operador.totpAtivo) {
      throw new BadRequestException('Este operador já tem o código cadastrado.');
    }

    const chave = this.chaveTotp();
    const segredo = novoSegredo();

    await this.ctx.comEscopoSistema('distribuicao.totp_iniciar', (db) =>
      db
        .update(operadorDistribuicao)
        .set({ totpSegredoCifrado: cifrarToken(segredo, chave) })
        .where(eq(operadorDistribuicao.id, operador.id)),
    );

    return { endereco: enderecoParaAplicativo(segredo, operador.email), segredo };
  }

  /** Confirma o primeiro código e, só então, ativa as duas etapas e abre a sessão. */
  async confirmarCadastroDoCodigo(preToken: string, codigo: string, meta: MetaRequisicao): Promise<string> {
    const pre = await this.lerPre(preToken, 'cadastrar_codigo');
    const operador = await this.buscarOperador(pre.sub);

    this.recusarSeBloqueado(operador.bloqueadoAte);
    this.conferirVersao(operador, pre.ver);

    const segredo = this.decifrarSegredo(operador.totpSegredoCifrado);
    if (!segredo) {
      throw new BadRequestException('Comece o cadastro do código de novo.');
    }
    if (!codigoConfere(segredo, codigo)) {
      await this.contarFalha(operador.id);
      await this.registrar(operador.id, operador.nome, 'codigo_negado', meta, { cadastro: true });
      throw new UnauthorizedException('Código não confere. Confira o aplicativo e tente de novo.');
    }

    await this.ctx.comEscopoSistema('distribuicao.totp_ativar', (db) =>
      db
        .update(operadorDistribuicao)
        .set({ totpAtivo: true })
        .where(eq(operadorDistribuicao.id, operador.id)),
    );

    await this.registrar(operador.id, operador.nome, 'codigo_cadastrado', meta, {});
    return this.abrirSessao(operador, meta);
  }

  // ----------------------------------------------------------------- sessão

  /** Valida a sessão de um request. Usado pelo guard do console. */
  async validarSessao(token: string): Promise<{ id: string; nome: string; email: string }> {
    let payload: PayloadSessao;
    try {
      payload = await this.jwt.verifyAsync<PayloadSessao>(token, { secret: segredoDaDistribuicao() });
    } catch {
      throw new UnauthorizedException('Sua sessão de operador expirou. Entre de novo.');
    }

    // A pré-sessão é assinada com o mesmo segredo, mas NÃO abre o console.
    if (payload.tipo !== 'sessao') {
      throw new UnauthorizedException('Conclua a verificação em duas etapas.');
    }

    const operador = await this.buscarOperador(payload.sub).catch(() => null);
    if (!operador || operador.status !== 'ativo' || operador.tokenVersao !== payload.ver) {
      throw new UnauthorizedException('Sua sessão de operador expirou. Entre de novo.');
    }
    // Defesa em profundidade: sessão sem duas etapas ativas não deveria existir.
    if (!operador.totpAtivo) {
      throw new UnauthorizedException('Conclua a verificação em duas etapas.');
    }

    return { id: operador.id, nome: operador.nome, email: operador.email };
  }

  /** Registra no livro de acessos. Nunca derruba o request que o chamou. */
  async registrar(
    operadorId: string | null,
    operadorNome: string | null,
    acao: string,
    meta: MetaRequisicao,
    detalhe: Record<string, unknown>,
    contaId: string | null = null,
  ): Promise<void> {
    try {
      await this.ctx.comEscopoSistema('distribuicao.registrar_acesso', (db) =>
        db.insert(acessoDistribuicao).values({
          operadorId,
          operadorNome,
          acao,
          contaId,
          detalhe,
          ip: meta.ip ?? null,
          userAgent: meta.userAgent?.slice(0, 300) ?? null,
        }),
      );
    } catch (erro) {
      this.log.error(`Não consegui registrar o acesso "${acao}": ${(erro as Error)?.message ?? erro}`);
    }
  }

  // ------------------------------------------------------------------ apoio

  private async abrirSessao(
    operador: { id: string; nome: string; tokenVersao: number },
    meta: MetaRequisicao,
  ): Promise<string> {
    await this.ctx.comEscopoSistema('distribuicao.sessao', (db) =>
      db
        .update(operadorDistribuicao)
        .set({ tentativasFalhas: 0, bloqueadoAte: null, ultimoLoginEm: new Date() })
        .where(eq(operadorDistribuicao.id, operador.id)),
    );

    await this.registrar(operador.id, operador.nome, 'login', meta, {});

    const payload: PayloadSessao = { sub: operador.id, tipo: 'sessao', ver: operador.tokenVersao };
    return this.jwt.signAsync(payload, {
      secret: segredoDaDistribuicao(),
      expiresIn: `${env.distribuicao.ttlHoras}h`,
    });
  }

  private async lerPre(token: string, etapaEsperada: Etapa): Promise<PayloadPre> {
    let payload: PayloadPre;
    try {
      payload = await this.jwt.verifyAsync<PayloadPre>(token, { secret: segredoDaDistribuicao() });
    } catch {
      throw new UnauthorizedException('A verificação demorou demais. Entre de novo com a senha.');
    }
    // Pré-sessão de uma etapa não serve para a outra, nem sessão serve como pré.
    if (payload.tipo !== 'pre' || payload.etapa !== etapaEsperada) {
      throw new UnauthorizedException('Etapa de login inválida. Entre de novo com a senha.');
    }
    return payload;
  }

  private async buscarOperador(id: string) {
    const operador = await this.ctx.comEscopoSistema('distribuicao.buscar_operador', async (db) => {
      const [o] = await db
        .select()
        .from(operadorDistribuicao)
        .where(eq(operadorDistribuicao.id, id))
        .limit(1);
      return o;
    });
    if (!operador) throw new UnauthorizedException('Operador não encontrado. Entre de novo.');
    return operador;
  }

  /** Senha trocada ou acesso suspenso depois da pré-sessão: ela morre junto. */
  private conferirVersao(operador: { status: string; tokenVersao: number }, versao: number) {
    if (operador.status !== 'ativo' || operador.tokenVersao !== versao) {
      throw new UnauthorizedException('Seu acesso mudou. Entre de novo com a senha.');
    }
  }

  private recusarSeBloqueado(bloqueadoAte: Date | null) {
    if (bloqueadoAte && bloqueadoAte.getTime() > Date.now()) {
      const minutos = Math.ceil((bloqueadoAte.getTime() - Date.now()) / 60_000);
      throw new ForbiddenException(
        `Muitas tentativas erradas. Este acesso está travado por mais ${minutos} minuto(s).`,
      );
    }
  }

  /**
   * Conta uma falha e trava ao atingir o teto.
   *
   * Incremento atômico no banco, e não ler-somar-gravar: dez tentativas
   * simultâneas de um robô precisam contar dez.
   */
  private async contarFalha(operadorId: string): Promise<void> {
    await this.ctx.comEscopoSistema('distribuicao.falha', (db) =>
      db.execute(sql`
        update operador_distribuicao
           set tentativas_falhas = tentativas_falhas + 1,
               bloqueado_ate = case
                 when tentativas_falhas + 1 >= ${MAX_TENTATIVAS}
                 then now() + make_interval(mins => ${MINUTOS_BLOQUEIO})
                 else bloqueado_ate
               end
         where id = ${operadorId}
      `),
    );
  }

  private chaveTotp(): string {
    const chave = env.distribuicao.totpChave;
    if (!chave) {
      // Recusa em vez de cair na chave da Meta: misturar as duas faria um
      // vazamento expor os dois segredos de uma vez.
      throw new ServiceUnavailableException(
        'A verificação em duas etapas não está configurada: falta a variável DIST_TOTP_CHAVE no servidor.',
      );
    }
    return chave;
  }

  private decifrarSegredo(cifrado: string | null): string | null {
    if (!cifrado) return null;
    try {
      return decifrarToken(cifrado, this.chaveTotp());
    } catch (erro) {
      if (erro instanceof ServiceUnavailableException) throw erro;
      this.log.error(`Segredo de duas etapas ilegível: ${(erro as Error)?.message ?? erro}`);
      return null;
    }
  }

  private async conferirSenha(hash: string, senha: string, operadorId: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, senha);
    } catch (erro) {
      this.log.error(`Não consegui conferir a senha do operador ${operadorId}: ${(erro as Error).message}`);
      return false;
    }
  }

  /** Gasta o tempo de uma verificação real quando o e-mail não existe. */
  private async gastarTempoDeVerificacao(senha: string): Promise<void> {
    try {
      this.isca ??= gerarHashSenha('isca-de-tempo-da-distribuicao');
      await argon2.verify(await this.isca, senha);
    } catch {
      /* O tempo já foi gasto; a resposta ao operador não muda. */
    }
  }
}
