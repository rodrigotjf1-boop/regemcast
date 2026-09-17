/**
 * Verificação em duas etapas do CLIENTE: no login e nas configurações.
 *
 * Opcional, escolhida por cada pessoa em "Conta e usuários":
 *
 * - **app** — o código do aplicativo autenticador (Google Authenticator e
 *   afins). Não depende de e-mail nem de rede na hora do login.
 * - **email** — um código de 6 dígitos enviado a cada login.
 *
 * ## A pré-sessão
 *
 * Senha certa de quem tem duas etapas NÃO abre sessão. Abre uma pré-sessão de 5
 * minutos, em cookie httpOnly restrito ao caminho do login, que só serve para o
 * passo do código. Ela é assinada com segredo DERIVADO (HMAC do JWT_SECRET com
 * rótulo próprio): um token de pré-sessão nunca vale como sessão no guard, e uma
 * sessão nunca vale como pré-sessão aqui.
 *
 * ## Trava
 *
 * Cinco códigos errados travam o acesso por 15 minutos, contados no usuário e
 * incrementados no banco (atômico). O código tem um milhão de combinações; sem a
 * trava, um robô com a senha vazada as percorre.
 *
 * ## Ligar e desligar
 *
 * - Ligar exige provar que funciona: o app só ativa depois de um código válido
 *   do próprio app, e o e-mail só ativa depois do código que chegou nele — que
 *   de quebra marca o e-mail como verificado.
 * - Desligar exige a SENHA. Sessão esquecida aberta num computador não pode ser
 *   usada para tirar a proteção da conta.
 */
import { createHmac } from 'node:crypto';

import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import argon2 from 'argon2';
import { and, eq, sql } from 'drizzle-orm';

import type { UsuarioAutenticado } from '../../common/auth.guard';
import { codigoConfere, enderecoParaAplicativo, novoSegredo } from '../../common/totp';
import { env } from '../../config/env';
import { ContextoDb } from '../../db/contexto';
import { usuario as tUsuario } from '../../db/schema';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { EmailService, mascararEmail } from '../email/email.service';
import { emailDeCodigo } from '../email/modelos-email';
import { cifrarToken, decifrarToken } from '../meta/cripto';
import {
  CodigoVerificacaoService,
  MENSAGEM_CODIGO,
} from '../seguranca/codigo-verificacao.service';

export type MetodoSegundaEtapa = 'email' | 'app';
export type DoisFatores = 'nenhum' | MetodoSegundaEtapa;

export const MAX_ERROS_LOGIN = 5;
export const MINUTOS_TRAVA = 15;
export const MINUTOS_PRE_SESSAO = 5;

interface PayloadPre {
  sub: string;
  conta: string;
  tipo: 'pre_login';
  metodo: MetodoSegundaEtapa;
  ver: number;
}

export interface UsuarioParaSegundaEtapa {
  id: string;
  contaId: string;
  email: string;
  metodo: MetodoSegundaEtapa;
  tokenVersao: number;
}

export interface MetaRequisicao {
  ip?: string;
  userAgent?: string;
}

export interface SituacaoSeguranca {
  doisFatores: DoisFatores;
  emailVerificado: boolean;
  /** O app autenticador só aparece como opção quando o servidor tem a chave. */
  appDisponivel: boolean;
}

/** Segredo das pré-sessões, derivado: nunca vale como o da sessão. */
export function segredoPreLogin(): string {
  return createHmac('sha256', env.sessao.segredo).update('regemcast:pre-login:v1').digest('hex');
}

@Injectable()
export class SegundaEtapaService {
  private readonly log = new Logger('SegundaEtapa');

  constructor(
    private readonly ctx: ContextoDb,
    private readonly jwt: JwtService,
    private readonly auditoria: AuditoriaService,
    private readonly codigos: CodigoVerificacaoService,
    private readonly email: EmailService,
  ) {}

  // ------------------------------------------------------------------ login

  /** Senha aceita de quem tem duas etapas: manda o código (se e-mail) e emite a pré-sessão. */
  async iniciar(u: UsuarioParaSegundaEtapa): Promise<{ preToken: string; emailMascarado: string }> {
    if (u.metodo === 'email') {
      await this.enviarCodigoDeLogin(u, true);
    }

    const payload: PayloadPre = {
      sub: u.id,
      conta: u.contaId,
      tipo: 'pre_login',
      metodo: u.metodo,
      ver: u.tokenVersao,
    };
    const preToken = await this.jwt.signAsync(payload, {
      secret: segredoPreLogin(),
      expiresIn: `${MINUTOS_PRE_SESSAO}m`,
    });
    return { preToken, emailMascarado: mascararEmail(u.email) };
  }

  /** Reenvia o código de login. Só para quem usa e-mail. */
  async reenviar(preToken: string | undefined): Promise<{ emailMascarado: string }> {
    const pre = await this.lerPre(preToken);
    const u = await this.buscar(pre.sub);
    this.conferirVersao(u, pre);
    if (u.doisFatores !== 'email') {
      throw new BadRequestException('Este acesso usa o aplicativo autenticador, não código por e-mail.');
    }
    await this.enviarCodigoDeLogin(
      { id: u.id, contaId: u.contaId, email: u.email, metodo: 'email', tokenVersao: u.tokenVersao },
      false,
    );
    return { emailMascarado: mascararEmail(u.email) };
  }

  /**
   * Confere o código da segunda etapa. Devolve quem pode receber a sessão —
   * quem abre a sessão é o AuthService, o mesmo caminho do login sem duas etapas.
   */
  async confirmar(
    preToken: string | undefined,
    codigo: string,
    meta: MetaRequisicao,
  ): Promise<{ usuarioId: string; contaId: string; metodo: MetodoSegundaEtapa }> {
    const pre = await this.lerPre(preToken);
    const u = await this.buscar(pre.sub);
    this.conferirVersao(u, pre);
    this.recusarSeTravado(u.bloqueadoAte);

    let recusa: string | null = null;

    if (u.doisFatores === 'app') {
      const segredo = this.decifrar(u.totpSegredoCifrado);
      if (!segredo || !codigoConfere(segredo, codigo)) {
        recusa = 'Código não confere. Confira o aplicativo autenticador e tente de novo.';
      }
    } else if (u.doisFatores === 'email') {
      const resultado = await this.codigos.conferir({ finalidade: 'login', email: u.email, codigo });
      if (resultado !== 'ok') recusa = MENSAGEM_CODIGO[resultado];
    } else {
      // Desligou as duas etapas no meio do login: a pré-sessão não vale mais.
      throw new UnauthorizedException('Seu acesso mudou. Entre de novo com a senha.');
    }

    if (recusa) {
      await this.contarFalha(u.id);
      await this.auditoria.registrarForaDeContexto({
        contaId: u.contaId,
        atorTipo: 'usuario',
        atorUsuarioId: u.id,
        acao: 'usuario.login_negado',
        entidade: 'usuario',
        entidadeId: u.id,
        detalhe: { motivo: 'codigo_segunda_etapa', metodo: u.doisFatores },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      throw new UnauthorizedException(recusa);
    }

    await this.ctx.comEscopoSistema('segunda-etapa.zerar', (db) =>
      db
        .update(tUsuario)
        .set({ tentativasFalhas: 0, bloqueadoAte: null })
        .where(eq(tUsuario.id, u.id)),
    );

    return { usuarioId: u.id, contaId: u.contaId, metodo: u.doisFatores };
  }

  // ---------------------------------------------------------- configurações

  async situacao(atual: UsuarioAutenticado): Promise<SituacaoSeguranca> {
    const [u] = await this.ctx.db
      .select({ doisFatores: tUsuario.doisFatores, emailVerificadoEm: tUsuario.emailVerificadoEm })
      .from(tUsuario)
      .where(and(eq(tUsuario.id, atual.id), eq(tUsuario.contaId, atual.contaId)))
      .limit(1);
    if (!u) throw new UnauthorizedException('Sua sessão expirou. Entre de novo.');

    return {
      doisFatores: u.doisFatores as DoisFatores,
      emailVerificado: Boolean(u.emailVerificadoEm),
      appDisponivel: Boolean(env.seguranca.totpChave),
    };
  }

  /** Manda o código para ativar a verificação por e-mail. */
  async enviarCodigoDeAtivacao(atual: UsuarioAutenticado): Promise<{ emailMascarado: string; minutos: number }> {
    const { codigo, minutos } = await this.codigos.emitir({
      finalidade: 'ativar_email',
      email: atual.email,
      usuarioId: atual.id,
    });
    await this.email.enviar(emailDeCodigo(atual.email, 'ativar_email', codigo, minutos));
    return { emailMascarado: mascararEmail(atual.email), minutos };
  }

  async ativarEmail(atual: UsuarioAutenticado, codigo: string, meta: MetaRequisicao): Promise<SituacaoSeguranca> {
    const resultado = await this.codigos.conferir({ finalidade: 'ativar_email', email: atual.email, codigo });
    if (resultado !== 'ok') throw new BadRequestException(MENSAGEM_CODIGO[resultado]);

    await this.ctx.db
      .update(tUsuario)
      .set({ doisFatores: 'email', emailVerificadoEm: sql`coalesce(${tUsuario.emailVerificadoEm}, now())`, totpSegredoCifrado: null })
      .where(and(eq(tUsuario.id, atual.id), eq(tUsuario.contaId, atual.contaId)));

    await this.auditar(atual, 'usuario.dois_fatores_ativado', { metodo: 'email' }, meta);
    return this.situacao(atual);
  }

  /**
   * Começa o cadastro do app: gera o segredo e devolve o endereço do QR code.
   *
   * O segredo é gravado já cifrado, mas `dois_fatores` não muda: só vira 'app'
   * quando um código válido for confirmado. Ativar antes trancaria para fora quem
   * escaneou errado.
   */
  async iniciarApp(atual: UsuarioAutenticado): Promise<{ endereco: string; segredo: string }> {
    const chave = this.chaveTotp();
    const segredo = novoSegredo();

    await this.ctx.db
      .update(tUsuario)
      .set({ totpSegredoCifrado: cifrarToken(segredo, chave) })
      .where(
        and(
          eq(tUsuario.id, atual.id),
          eq(tUsuario.contaId, atual.contaId),
          // Com o app já ativo, trocar o segredo por aqui desligaria o app que
          // funciona sem a pessoa perceber. Primeiro desativa, depois cadastra.
          sql`${tUsuario.doisFatores} <> 'app'`,
        ),
      );

    const [u] = await this.ctx.db
      .select({ doisFatores: tUsuario.doisFatores })
      .from(tUsuario)
      .where(eq(tUsuario.id, atual.id))
      .limit(1);
    if (u?.doisFatores === 'app') {
      throw new BadRequestException('O aplicativo autenticador já está ativo. Desative antes de cadastrar outro.');
    }

    return { endereco: enderecoParaAplicativo(segredo, atual.email, 'RegemCast'), segredo };
  }

  async ativarApp(atual: UsuarioAutenticado, codigo: string, meta: MetaRequisicao): Promise<SituacaoSeguranca> {
    const [u] = await this.ctx.db
      .select({ totpSegredoCifrado: tUsuario.totpSegredoCifrado })
      .from(tUsuario)
      .where(and(eq(tUsuario.id, atual.id), eq(tUsuario.contaId, atual.contaId)))
      .limit(1);

    const segredo = this.decifrar(u?.totpSegredoCifrado ?? null);
    if (!segredo) throw new BadRequestException('Comece o cadastro do aplicativo de novo.');
    if (!codigoConfere(segredo, codigo)) {
      throw new BadRequestException('Código não confere. Confira o aplicativo e tente de novo.');
    }

    await this.ctx.db
      .update(tUsuario)
      .set({ doisFatores: 'app' })
      .where(and(eq(tUsuario.id, atual.id), eq(tUsuario.contaId, atual.contaId)));

    await this.auditar(atual, 'usuario.dois_fatores_ativado', { metodo: 'app' }, meta);
    return this.situacao(atual);
  }

  async desativar(atual: UsuarioAutenticado, senha: string, meta: MetaRequisicao): Promise<SituacaoSeguranca> {
    const [u] = await this.ctx.db
      .select({ senhaHash: tUsuario.senhaHash, doisFatores: tUsuario.doisFatores })
      .from(tUsuario)
      .where(and(eq(tUsuario.id, atual.id), eq(tUsuario.contaId, atual.contaId)))
      .limit(1);
    if (!u) throw new UnauthorizedException('Sua sessão expirou. Entre de novo.');

    let senhaOk = false;
    try {
      senhaOk = await argon2.verify(u.senhaHash, senha ?? '');
    } catch (erro) {
      this.log.error(`Não consegui conferir a senha do usuário ${atual.id}: ${(erro as Error).message}`);
    }
    if (!senhaOk) throw new BadRequestException('A senha está incorreta.');

    await this.ctx.db
      .update(tUsuario)
      .set({ doisFatores: 'nenhum', totpSegredoCifrado: null })
      .where(and(eq(tUsuario.id, atual.id), eq(tUsuario.contaId, atual.contaId)));

    await this.auditar(atual, 'usuario.dois_fatores_desativado', { metodoAnterior: u.doisFatores }, meta);
    return this.situacao(atual);
  }

  // ------------------------------------------------------------------ apoio

  private async enviarCodigoDeLogin(u: UsuarioParaSegundaEtapa, primeiroEnvio: boolean): Promise<void> {
    try {
      const { codigo, minutos } = await this.codigos.emitir({
        finalidade: 'login',
        email: u.email,
        usuarioId: u.id,
      });
      await this.email.enviar(emailDeCodigo(u.email, 'login', codigo, minutos));
    } catch (erro) {
      // No PRIMEIRO envio, um código recente ainda vale (a pessoa clicou em
      // "Entrar" duas vezes): segue para a tela do código em vez de travar o
      // login. No reenvio, a espera precisa aparecer.
      if (primeiroEnvio && erro instanceof HttpException && erro.getStatus() === HttpStatus.TOO_MANY_REQUESTS) {
        return;
      }
      throw erro;
    }
  }

  private async lerPre(token: string | undefined): Promise<PayloadPre> {
    if (!token) throw new UnauthorizedException('A verificação demorou demais. Entre de novo com a senha.');
    let payload: PayloadPre;
    try {
      payload = await this.jwt.verifyAsync<PayloadPre>(token, { secret: segredoPreLogin() });
    } catch {
      throw new UnauthorizedException('A verificação demorou demais. Entre de novo com a senha.');
    }
    if (payload.tipo !== 'pre_login') {
      throw new UnauthorizedException('Etapa de login inválida. Entre de novo com a senha.');
    }
    return payload;
  }

  private async buscar(id: string) {
    const u = await this.ctx.comEscopoSistema('segunda-etapa.buscar', async (db) => {
      const [linha] = await db
        .select({
          id: tUsuario.id,
          contaId: tUsuario.contaId,
          email: tUsuario.email,
          status: tUsuario.status,
          tokenVersao: tUsuario.tokenVersao,
          doisFatores: tUsuario.doisFatores,
          totpSegredoCifrado: tUsuario.totpSegredoCifrado,
          bloqueadoAte: tUsuario.bloqueadoAte,
        })
        .from(tUsuario)
        .where(eq(tUsuario.id, id))
        .limit(1);
      return linha;
    });
    if (!u) throw new UnauthorizedException('Seu acesso mudou. Entre de novo com a senha.');
    return u as typeof u & { doisFatores: DoisFatores };
  }

  /** Senha trocada, acesso suspenso ou método trocado depois da senha: a pré-sessão morre. */
  private conferirVersao(
    u: { status: string; tokenVersao: number; contaId: string; doisFatores: string },
    pre: PayloadPre,
  ): void {
    if (
      u.status !== 'ativo' ||
      u.tokenVersao !== pre.ver ||
      u.contaId !== pre.conta ||
      u.doisFatores !== pre.metodo
    ) {
      throw new UnauthorizedException('Seu acesso mudou. Entre de novo com a senha.');
    }
  }

  recusarSeTravado(bloqueadoAte: Date | null): void {
    if (bloqueadoAte && bloqueadoAte.getTime() > Date.now()) {
      const minutos = Math.ceil((bloqueadoAte.getTime() - Date.now()) / 60_000);
      throw new ForbiddenException(
        `Muitas tentativas erradas. Este acesso está travado por mais ${minutos} minuto(s).`,
      );
    }
  }

  /** Incremento atômico: dez tentativas simultâneas de um robô contam dez. */
  private async contarFalha(usuarioId: string): Promise<void> {
    await this.ctx.comEscopoSistema('segunda-etapa.falha', (db) =>
      db.execute(sql`
        update usuario
           set tentativas_falhas = tentativas_falhas + 1,
               bloqueado_ate = case
                 when tentativas_falhas + 1 >= ${MAX_ERROS_LOGIN}
                 then now() + make_interval(mins => ${MINUTOS_TRAVA})
                 else bloqueado_ate
               end
         where id = ${usuarioId}
      `),
    );
  }

  private chaveTotp(): string {
    const chave = env.seguranca.totpChave;
    if (!chave) {
      throw new ServiceUnavailableException(
        'O aplicativo autenticador não está configurado: falta a variável CONTA_TOTP_CHAVE no servidor.',
      );
    }
    return chave;
  }

  private decifrar(cifrado: string | null): string | null {
    if (!cifrado) return null;
    try {
      return decifrarToken(cifrado, this.chaveTotp());
    } catch (erro) {
      if (erro instanceof ServiceUnavailableException) throw erro;
      this.log.error(`Segredo do aplicativo autenticador ilegível: ${(erro as Error)?.message ?? erro}`);
      return null;
    }
  }

  private async auditar(
    atual: UsuarioAutenticado,
    acao: string,
    detalhe: Record<string, unknown>,
    meta: MetaRequisicao,
  ): Promise<void> {
    await this.auditoria.registrar({
      contaId: atual.contaId,
      atorTipo: 'usuario',
      atorUsuarioId: atual.id,
      acao,
      entidade: 'usuario',
      entidadeId: atual.id,
      detalhe,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  }
}
