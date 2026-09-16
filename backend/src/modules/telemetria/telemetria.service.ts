/**
 * Telemetria: grava o erro onde dá para consultar.
 *
 * A auditoria desta semana mostrou que o tratamento de erro do produto está
 * bom — filtro global, mensagem traduzida, referência curta, causa real no log.
 * O problema era onde o erro PARAVA: no log do contêiner. Isso responde "o que
 * houve nesta requisição" quando alguém já sabe que houve problema; não
 * responde "quantas contas bateram no erro 190 esta semana?".
 *
 * Três regras, e todas são sobre o que NÃO pode acontecer:
 *
 * 1. **Telemetria nunca derruba nada.** Gravar é fogo-e-esquece; se o banco
 *    estiver fora, o erro original continua sendo tratado e respondido. Um
 *    registro de erro que causa erro é o pior tipo de defeito, porque some
 *    justamente quando mais se precisa dele.
 *
 * 2. **Transação própria.** Quando o filtro de erro roda, a transação do
 *    request pode já estar abortada. Gravar nela falharia calado.
 *
 * 3. **Sem dado pessoal.** Telefone vai mascarado, token não entra, corpo de
 *    mensagem não entra. A tabela é da DISTRIBUIÇÃO e a regra de não registrar
 *    dado pessoal vale aqui como vale no log.
 */
import { Injectable, Logger } from '@nestjs/common';

import { ContextoDb } from '../../db/contexto';
import { eventoErro } from '../../db/schema';

export type OrigemErro = 'api' | 'meta' | 'banco' | 'fila' | 'webhook';

export interface EventoDeErro {
  contaId?: string | null;
  referencia?: string | null;
  rota?: string | null;
  metodo?: string | null;
  status?: number | null;
  origem: OrigemErro;
  classe?: string | null;
  codigo?: number | null;
  mensagem?: string | null;
  detalhe?: Record<string, unknown>;
}

/** Teto da mensagem: stack inteiro numa linha de tabela não ajuda ninguém a ler. */
const LIMITE_MENSAGEM = 2000;

/**
 * Tira da mensagem o que parece dado pessoal ou segredo.
 *
 * Mensagem de erro de biblioteca costuma ecoar o valor que causou o problema —
 * e esse valor às vezes é um telefone ou um token.
 */
export function higienizar(texto: string | null | undefined): string | null {
  if (!texto) return null;
  return texto
    .slice(0, LIMITE_MENSAGEM)
    // Tokens de acesso da Meta começam com EAA e são longos.
    .replace(/EAA[A-Za-z0-9]{20,}/g, 'EAA[token-omitido]')
    // Bearer <qualquer coisa>
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [omitido]')
    // Sequências longas de dígitos: telefone, CPF, cartão. Mantém os 4 últimos.
    .replace(/\+?\d{9,15}/g, (m) => `***${m.slice(-4)}`);
}

@Injectable()
export class TelemetriaService {
  private readonly log = new Logger('Telemetria');

  constructor(private readonly ctx: ContextoDb) {}

  /**
   * Registra um erro. Não espera, não lança.
   *
   * Devolve a promessa só para teste; quem chama em produção ignora.
   */
  registrar(evento: EventoDeErro): Promise<void> {
    return this.gravar(evento).catch((falha) => {
      // Só o log: telemetria que falha não pode virar mais um erro na tela.
      this.log.warn(`Não consegui gravar a telemetria: ${(falha as Error)?.message ?? falha}`);
    });
  }

  private async gravar(e: EventoDeErro): Promise<void> {
    await this.ctx.comEscopoSistema('telemetria.registrar', (db) =>
      db.insert(eventoErro).values({
        contaId: e.contaId ?? null,
        referencia: e.referencia ?? null,
        rota: e.rota ? e.rota.slice(0, 300) : null,
        metodo: e.metodo ?? null,
        status: e.status ?? null,
        origem: e.origem,
        classe: e.classe ?? null,
        codigo: e.codigo ?? null,
        mensagem: higienizar(e.mensagem),
        detalhe: e.detalhe ?? {},
      }),
    );
  }
}
