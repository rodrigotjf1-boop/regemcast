import type { HubService } from './hub.service';

/**
 * O que a telemetria usa do hub, por um símbolo: assim a telemetria não importa o `HubService` (nem, por ele, a
 * configuração), e os testes que sobem o filtro de erro sem `env` continuam subindo.
 */
export const HUB_DOS_ERROS = Symbol('HUB_DOS_ERROS');
export type HubDosErros = Pick<HubService, 'ligado' | 'erro'>;
