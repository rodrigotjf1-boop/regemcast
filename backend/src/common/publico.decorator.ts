import { SetMetadata } from '@nestjs/common';

/**
 * Marca uma rota como acessível sem sessão.
 *
 * O guard de autenticação é GLOBAL, então este decorator é a única forma de
 * abrir uma rota — e por ser explícito, `grep -rn "@Publico" src/` lista toda
 * a superfície anônima da API numa linha de comando.
 */
export const PUBLICO = 'rc:publico';
export const Publico = () => SetMetadata(PUBLICO, true);
