/**
 * O botão de saída que o servidor acrescenta a todo modelo de MARKETING.
 *
 * Aqui ele existe só para a tela mostrar o que vai ser enviado — quem decide é
 * o backend (`backend/src/modules/modelo/regras-modelo.ts`, `BOTAO_SAIDA`).
 * Mudou lá, muda aqui: são os dois lados do mesmo acordo, e a tela nunca deve
 * prometer um botão diferente do que a Meta vai receber.
 */
import type { BotaoDoModelo, CategoriaModelo } from '@/lib/tipos';

export const BOTAO_SAIDA: BotaoDoModelo = { tipo: 'QUICK_REPLY', texto: 'Parar promoções' };

/** Quantos botões o cliente pode montar num modelo de marketing: o 10º é o nosso. */
export const LIMITE_BOTOES_MARKETING = 9;

/** Este modelo leva o botão de saída? Só marketing simples — no carrossel não cabe. */
export function levaBotaoDeSaida(
  categoria: CategoriaModelo | undefined,
  tipo?: 'simples' | 'carrossel',
): boolean {
  return (categoria ?? 'MARKETING') === 'MARKETING' && (tipo ?? 'simples') === 'simples';
}
