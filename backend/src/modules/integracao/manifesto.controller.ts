/**
 * O MANIFESTO da porta de integração (Padrão DMS §13; Hub DMS, F4 parte A), SEM credencial: é a documentação pública da
 * porta MCP, e só dela. Fora do prefixo `/api/v1` (`ROTAS_FORA_DO_PREFIXO`), como os metadados do recurso (RFC 9728).
 * Fora do `RegistroDaPorta`: não é chamada da porta.
 */
import { Controller, Get, Header } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { Publico } from '../../common/publico.decorator';
import { CAMINHO_DO_MANIFESTO } from './ligacao.regras';
import { manifestoDaPorta } from './manifesto';

@Controller()
@Publico()
@ApiExcludeController()
export class ManifestoController {
  @Get(CAMINHO_DO_MANIFESTO)
  @Header('Cache-Control', 'public, max-age=300')
  manifesto() {
    return manifestoDaPorta();
  }
}
