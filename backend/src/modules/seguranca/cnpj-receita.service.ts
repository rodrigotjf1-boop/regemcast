/**
 * Consulta do CNPJ na Receita, pela BrasilAPI.
 *
 * O dígito verificador sozinho só diz que o número é bem formado — CNPJ baixado,
 * suspenso ou inventado com DV certo passa nele. Aqui a pergunta é outra: esta
 * empresa existe e está ATIVA?
 *
 * ## Falha fechada
 *
 * Se a BrasilAPI estiver fora do ar, o cadastro NÃO segue sem conferência. A
 * resposta diz que a consulta falhou e pede para tentar em alguns minutos.
 * Deixar passar "porque a API caiu" seria a porta aberta para quem descobrir
 * quando ela cai.
 *
 * ## Por que BrasilAPI
 *
 * Gratuita, sem chave, e devolve os campos da base pública da Receita. Se um
 * dia virar gargalo, a troca por um provedor pago acontece só neste arquivo.
 */
import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

import { cnpjValido, normalizarCnpj } from '../conta/cnpj';

export interface CnpjConferido {
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string | null;
  /** Como a Receita escreve: ATIVA, BAIXADA, SUSPENSA, INAPTA, NULA. */
  situacao: string;
  ativa: boolean;
}

const BASE = 'https://brasilapi.com.br/api/cnpj/v1';

/** O que interessa da resposta da BrasilAPI. */
interface RespostaBrasilApi {
  cnpj?: string;
  razao_social?: string;
  nome_fantasia?: string | null;
  descricao_situacao_cadastral?: string;
}

/** Transforma a resposta da BrasilAPI no que o cadastro usa. Separado para teste. */
export function lerRespostaReceita(cnpj: string, corpo: RespostaBrasilApi): CnpjConferido {
  const situacao = (corpo.descricao_situacao_cadastral ?? '').trim().toUpperCase();
  const razaoSocial = (corpo.razao_social ?? '').trim();
  if (!situacao || !razaoSocial) {
    throw new ServiceUnavailableException(
      'A Receita respondeu sem os dados do CNPJ. Tente de novo em alguns minutos.',
    );
  }
  return {
    cnpj,
    razaoSocial,
    nomeFantasia: corpo.nome_fantasia?.trim() || null,
    situacao,
    ativa: situacao === 'ATIVA',
  };
}

@Injectable()
export class CnpjReceitaService {
  private readonly log = new Logger('CnpjReceita');

  /** Confere formato e dígito, e consulta a situação na Receita. */
  async consultar(bruto: string): Promise<CnpjConferido> {
    const cnpj = normalizarCnpj(bruto ?? '');
    if (!cnpj || !cnpjValido(cnpj)) {
      throw new BadRequestException('Confira o CNPJ: os números não formam um CNPJ válido.');
    }

    let resposta: Response;
    try {
      resposta = await fetch(`${BASE}/${cnpj}`, {
        // Sem User-Agent próprio a BrasilAPI (atrás do Cloudflare) responde 403
        // ao fetch do Node — visto no teste ponta a ponta. curl passava, e o
        // defeito só apareceria em produção, como 'Receita fora do ar'.
        headers: { Accept: 'application/json', 'User-Agent': 'RegemCast/1.0 (+https://cast.dmsregem.com)' },
        signal: AbortSignal.timeout(8_000),
      });
    } catch (erro) {
      this.log.warn(`BrasilAPI sem resposta: ${(erro as Error)?.message ?? erro}`);
      throw new ServiceUnavailableException(
        'Não conseguimos consultar a Receita agora. Tente de novo em alguns minutos.',
      );
    }

    // 404: não existe. 400: a BrasilAPI também recusa formato que ela não
    // reconhece — para quem digitou, é o mesmo "não encontrado".
    if (resposta.status === 404 || resposta.status === 400) {
      throw new BadRequestException(
        'Não encontramos este CNPJ na Receita. Confira os números.',
      );
    }

    if (!resposta.ok) {
      this.log.warn(`BrasilAPI respondeu ${resposta.status} para a consulta de CNPJ.`);
      throw new ServiceUnavailableException(
        'Não conseguimos consultar a Receita agora. Tente de novo em alguns minutos.',
      );
    }

    return lerRespostaReceita(cnpj, (await resposta.json()) as RespostaBrasilApi);
  }

  /** Como `consultar`, mas recusa CNPJ que não está ATIVO. */
  async exigirAtivo(bruto: string): Promise<CnpjConferido> {
    const conferido = await this.consultar(bruto);
    if (!conferido.ativa) {
      throw new BadRequestException(
        `Este CNPJ está com a situação "${conferido.situacao}" na Receita. Só é possível criar conta com CNPJ ATIVO.`,
      );
    }
    return conferido;
  }
}
