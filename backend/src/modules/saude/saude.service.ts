/**
 * Healthcheck em dois níveis, porque as duas perguntas são diferentes.
 *
 * `vivo()` responde "o processo está de pé". NÃO toca no banco de propósito:
 * é o alvo do healthcheck do Docker, e um healthcheck que depende do Postgres
 * derruba e recria o contêiner da API toda vez que o banco pisca — trocando
 * uma indisponibilidade de 10 segundos por um ciclo de restart que perde as
 * conexões, a fila em memória e o warm-up.
 *
 * `pronto()` responde "dá para trabalhar": Postgres e Redis respondendo. É o
 * alvo do load balancer, para tirar a réplica do rodízio sem matá-la.
 *
 * QUEM VÊ O QUÊ. As duas rotas de sonda são anônimas e ficam expostas na
 * internet, então o corpo delas é o mínimo: `{postgres, redis}` e o código HTTP.
 * O MOTIVO REAL — nome, mensagem, SQLSTATE e `detail` do driver — vai para o
 * LOG, sempre, e só é servido por HTTP atrás do token do console de
 * distribuição (`/saude/pronto/detalhe`). Devolver isso ao mundo entrega host,
 * porta e topologia interna a quem só precisava saber "dá para usar?": com o
 * Redis fora, `connect ECONNREFUSED 10.0.0.5:6379` é um mapa da rede.
 *
 * Pelo mesmo motivo a versão do build sai do corpo público: ela diz qual
 * release está no ar e, com ela, quais correções ainda NÃO estão.
 */
import { Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Redis from 'ioredis';
import { Pool } from 'pg';

import { env } from '../../config/env';
import { PG_POOL } from '../../db/drizzle.module';

/** Cada checagem tem 3s. Probe que trava é probe que não avisa nada. */
const LIMITE_MS = 3_000;

/** Corpo público do liveness. Sem versão: ver a nota do topo do arquivo. */
export interface CorpoVivo {
  ok: true;
  tempoDeVidaSeg: number;
}

/** Corpo público do readiness. Só o veredito de cada dependência. */
export interface CorpoPronto {
  postgres: 'ok' | 'falhou';
  redis: 'ok' | 'falhou';
}

/** O mesmo diagnóstico que vai para o log. Só atrás do `DistTokenGuard`. */
export interface CorpoProntoDetalhado extends CorpoPronto {
  versao: string;
  tempoDeVidaSeg: number;
  /** Só aparece quando algo falhou. */
  motivos?: Record<string, string>;
}

export interface ResultadoPronto {
  ok: boolean;
  /** O que vai para a internet. */
  publico: CorpoPronto;
  /** O que vai para quem tem o token do console. */
  detalhado: CorpoProntoDetalhado;
}

@Injectable()
export class SaudeService implements OnApplicationShutdown {
  private readonly log = new Logger('Saude');
  private readonly iniciadoEm = Date.now();
  private readonly versao = versaoDoApp();
  private redis: Redis | null = null;
  /**
   * O erro de CONEXÃO mais recente do Redis.
   *
   * Existe porque o erro que o `ping()` devolve quando o servidor está fora é
   * "Reached the max retries per request limit" — verdadeiro e inútil. O motivo
   * de verdade ("connect ECONNREFUSED 10.0.0.5:6379") só aparece no evento
   * 'error', que acontece antes. Guardamos para juntar os dois na resposta.
   */
  private ultimoErroRedis: string | null = null;

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  vivo(): CorpoVivo {
    return { ok: true, tempoDeVidaSeg: this.tempoDeVidaSeg() };
  }

  /**
   * Devolve `ok` separado dos corpos para o controller escolher 200 ou 503 sem
   * passar pelo filtro de erro — uma sonda quer o JSON do diagnóstico, não o
   * envelope de exceção da API.
   *
   * Os dois corpos saem da MESMA checagem: o público e o detalhado nunca
   * discordam, e a rota com token não custa uma segunda rodada de ping.
   */
  async pronto(): Promise<ResultadoPronto> {
    // Em paralelo: sequencial somaria os dois timeouts e a sonda estouraria
    // antes da resposta.
    const [postgres, redis] = await Promise.all([
      this.checarPostgres(),
      this.checarRedis(),
    ]);

    const motivos: Record<string, string> = {};
    if (postgres) motivos.postgres = postgres;
    if (redis) motivos.redis = redis;
    const ok = !postgres && !redis;

    const publico: CorpoPronto = {
      postgres: postgres ? 'falhou' : 'ok',
      redis: redis ? 'falhou' : 'ok',
    };

    if (!ok) {
      // O log é o ÚNICO destino garantido do motivo real — a resposta pública
      // não o carrega mais. Quem está de plantão lê aqui, com a versão junto
      // para saber que build produziu a falha.
      this.log.error(
        `/saude/pronto falhou (versão ${this.versao}) — ${JSON.stringify(motivos)}`,
      );
    }

    return {
      ok,
      publico,
      detalhado: {
        ...publico,
        versao: this.versao,
        tempoDeVidaSeg: this.tempoDeVidaSeg(),
        ...(ok ? {} : { motivos }),
      },
    };
  }

  onApplicationShutdown(): void {
    if (this.redis) {
      // `disconnect()` é síncrono e não estoura em cliente que nunca conectou;
      // `quit()` rejeita com "Connection is closed" nesse caso.
      try {
        this.redis.disconnect();
      } catch {
        /* já estava fechado */
      }
      this.redis = null;
    }
  }

  private tempoDeVidaSeg(): number {
    return Math.floor((Date.now() - this.iniciadoEm) / 1000);
  }

  /** `null` quando está tudo certo; o motivo, quando falhou. */
  private async checarPostgres(): Promise<string | null> {
    try {
      // Fora de contexto de RLS de propósito: `select 1` não lê tabela
      // nenhuma, então não precisa de GUC — e abrir transação com `ContextoDb`
      // aqui faria a sonda segurar uma conexão a mais do pool.
      await comLimite('Postgres', LIMITE_MS, this.pool.query('select 1'));
      return null;
    } catch (erro) {
      return motivoDe(erro);
    }
  }

  private async checarRedis(): Promise<string | null> {
    try {
      const resposta = await comLimite('Redis', LIMITE_MS, this.cliente().ping());
      if (resposta !== 'PONG') {
        return `O Redis respondeu "${resposta}" ao ping, quando o esperado é PONG.`;
      }
      // Deu certo agora: o erro antigo não pode aparecer na próxima falha.
      this.ultimoErroRedis = null;
      return null;
    } catch (erro) {
      const motivo = motivoDe(erro);
      return this.ultimoErroRedis
        ? `${motivo} Último erro de conexão: ${this.ultimoErroRedis}`
        : motivo;
    }
  }

  private cliente(): Redis {
    if (this.redis) return this.redis;

    this.redis = new Redis(env.redis.url, {
      // `lazyConnect` para o boot não depender do Redis: quem depende é
      // /saude/pronto, não o processo subir.
      lazyConnect: true,
      connectTimeout: LIMITE_MS,
      // Uma tentativa só: a sonda quer saber o estado agora, não daqui a 20
      // retentativas.
      maxRetriesPerRequest: 1,
      // Recuo progressivo até 30s. Com retentativa fixa de 1s, um Redis fora
      // do ar por uma noite rende 30 mil linhas de log iguais e enterra o que
      // interessa.
      retryStrategy: (tentativas: number) => Math.min(tentativas * 1_000, 30_000),
    });

    // Sem este handler, um erro de conexão vira 'error' não tratado e derruba
    // o processo inteiro — a sonda de saúde matando a API é o pior desfecho
    // possível. Fica em debug porque a falha já é relatada, com motivo, no log
    // de `/saude/pronto` e no corpo de `/saude/pronto/detalhe`.
    this.redis.on('error', (erro: Error) => {
      this.ultimoErroRedis = motivoDe(erro);
      this.log.debug(`Redis: ${erro.message}`);
    });

    return this.redis;
  }
}

/**
 * Corre a promessa contra um relógio. O perdedor continua pendurado, mas já
 * tem tratamento (o `Promise.race` anexa um), então não vira rejeição não
 * tratada; e `pool.query` devolve o cliente ao pool sozinho quando termina.
 */
async function comLimite<T>(rotulo: string, ms: number, promessa: Promise<T>): Promise<T> {
  let relogio: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promessa,
      new Promise<never>((_, rejeitar) => {
        relogio = setTimeout(
          () => rejeitar(new Error(`${rotulo} não respondeu em ${ms}ms.`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (relogio) clearTimeout(relogio);
  }
}

/** Código e mensagem do erro, como vieram. É o que falta quando dá problema. */
function motivoDe(erro: unknown): string {
  if (erro instanceof Error) {
    const extra = erro as Error & { code?: string; detail?: string };
    return (
      `${extra.name}: ${extra.message}` +
      (extra.code ? ` (code ${extra.code})` : '') +
      (extra.detail ? ` — ${extra.detail}` : '')
    );
  }
  return String(erro);
}

/**
 * Versão do app. `APP_VERSAO` vence (é o que o build carimba); o package.json
 * é o fallback de dev. Lido em try/catch porque o healthcheck não pode falhar
 * por causa de um arquivo ausente na imagem.
 */
function versaoDoApp(): string {
  const doAmbiente = (process.env.APP_VERSAO ?? '').trim();
  if (doAmbiente) return doAmbiente;
  try {
    const bruto = readFileSync(join(process.cwd(), 'package.json'), 'utf8');
    const versao = (JSON.parse(bruto) as { version?: unknown }).version;
    if (typeof versao === 'string' && versao) return versao;
  } catch {
    /* sem package.json na imagem: segue com a versão desconhecida */
  }
  return '0.0.0';
}
