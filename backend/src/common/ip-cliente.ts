/**
 * O IP de quem está do outro lado — o mesmo em todo lugar que precisa dele:
 * limite de tentativas, auditoria e registro do console.
 *
 * Em produção a API fica atrás do Cloudflare e do proxy do EasyPanel. O
 * `req.ip` do Express, com `trust proxy` de um salto, devolve o endereço que o
 * proxy viu — o do servidor do Cloudflare, compartilhado por milhares de
 * pessoas da mesma região. Usado como chave do limite de tentativas, isso faz
 * todo mundo do Rio dividir as mesmas 8 tentativas de login por minuto.
 *
 * Com `TRUST_CLOUDFLARE=true` vale o `cf-connecting-ip`, que o Cloudflare
 * sempre sobrescreve. Só ligue quando TODO o tráfego passar por ele: sem isso,
 * quem chega direto no IP da VPS escolhe o próprio IP no cabeçalho.
 *
 * O valor é conferido com `isIP` porque a coluna da auditoria é `inet`: lixo no
 * cabeçalho não pode derrubar a gravação.
 */
import { isIP } from 'node:net';

import type { Request } from 'express';

import { env } from '../config/env';

export function ipDoCliente(req: Request): string | undefined {
  if (env.rede.trustCloudflare) {
    const bruto = req.headers['cf-connecting-ip'];
    const valor = (Array.isArray(bruto) ? bruto[0] : bruto)?.trim();
    if (valor && isIP(valor)) return valor;
  }
  const ip = req.ip?.trim();
  return ip && isIP(ip) ? ip : undefined;
}
