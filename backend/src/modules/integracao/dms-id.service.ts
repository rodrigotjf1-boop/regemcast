/**
 * O DMS ID do Hub DMS, do lado do RegemCast: confere o token que chega na porta
 * MCP e diz onde estão os metadados do recurso (RFC 9728).
 *
 * Tudo nasce desligado (`DMS_ID_LIGADO`). Desligado, a porta segue só com o
 * `rct_it_`, como sempre foi. A configuração é lida a cada chamada, e as chaves
 * públicas do DMS ID ficam guardadas (`ChavesDmsId` do pacote comum): buscadas
 * de novo a cada 10 minutos ou quando chega um `kid` novo, e, se o DMS ID cair,
 * o token já emitido continua conferível com as que estão guardadas.
 */
import { Injectable } from '@nestjs/common';

import { env } from '../../config/env';
import { ChavesDmsId, conferirTokenDmsId, ErroPermissaoFaltando, type TokenDmsId } from '../../dms/integracao-dms';
import { enderecoDosMetadados, PERMISSOES_DO_RECURSO, permissoesDoCatalogo } from './ligacao.regras';

type ConfigDmsId = { ligado: boolean; emissor: string; recurso: string; aplicativos: Record<string, string> };

const DESLIGADO: ConfigDmsId = { ligado: false, emissor: '', recurso: '', aplicativos: {} };

@Injectable()
export class DmsIdService {
  /** Uma `ChavesDmsId` por emissor: troca de emissor na configuração não confere com chave do emissor antigo. */
  private guardadas: { emissor: string; chaves: ChavesDmsId } | null = null;

  private get config(): ConfigDmsId {
    return (env as { dmsId?: ConfigDmsId }).dmsId ?? DESLIGADO;
  }

  get ligado(): boolean {
    return this.config.ligado === true;
  }

  /** Produto → client_id dos aplicativos que a distribuição cadastrou no DMS ID. */
  get aplicativos(): Readonly<Record<string, string>> {
    return this.config.aplicativos;
  }

  /** O endereço que vai no `resource_metadata` do `WWW-Authenticate`. */
  enderecoDosMetadados(): string {
    return enderecoDosMetadados(this.config.recurso);
  }

  /** Os metadados do recurso protegido (RFC 9728): é por eles que o cliente MCP acha o DMS ID. */
  metadados() {
    const { recurso, emissor } = this.config;
    return {
      resource: recurso,
      authorization_servers: [emissor],
      scopes_supported: [...PERMISSOES_DO_RECURSO],
      bearer_methods_supported: ['header'],
      resource_name: 'RegemCast (porta MCP)',
    };
  }

  /**
   * Confere o token do DMS ID: forma, assinatura, emissor, destino (esta porta)
   * e validade. Token que não vale → `ErroTokenDmsId` (401). Token válido sem
   * NENHUMA permissão do RegemCast → `ErroPermissaoFaltando` (403) com todas as
   * permissões: o DMS ID emite token para qualquer destino, até sem permissão
   * (`scope` vazio), então o destino certo sozinho não autoriza nada.
   */
  async conferir(token: string | null): Promise<TokenDmsId> {
    const { emissor, recurso } = this.config;
    const lido = await conferirTokenDmsId(token ?? '', { chaves: this.chaves(emissor), emissor, destino: recurso });
    const permissoes = permissoesDoCatalogo(lido.permissoes);
    if (!permissoes.length) throw new ErroPermissaoFaltando(PERMISSOES_DO_RECURSO);
    return { ...lido, permissoes };
  }

  private chaves(emissor: string): ChavesDmsId {
    if (this.guardadas?.emissor !== emissor) this.guardadas = { emissor, chaves: new ChavesDmsId({ jwks: `${emissor}/jwks` }) };
    return this.guardadas.chaves;
  }
}
