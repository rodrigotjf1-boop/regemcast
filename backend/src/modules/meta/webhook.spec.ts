/**
 * Quem pede para sair, sai — e quem só usou a palavra numa frase, não.
 *
 * O teste existe porque os dois erros custam caro e em direções opostas:
 * ignorar um pedido de saída derruba a qualidade do número da empresa; bloquear
 * quem não pediu tira da base um cliente que queria continuar recebendo.
 */
import { ehPedidoDeSaida } from './webhook.service';

describe('ehPedidoDeSaida', () => {
  it.each([
    'Parar promoções',
    'parar promocoes',
    'PARAR',
    'Sair',
    'sair da lista',
    'stop',
    'Descadastrar!',
    'Não quero mais receber',
  ])('entende "%s" como pedido de saída', (texto) => {
    expect(ehPedidoDeSaida(texto)).toBe(true);
  });

  it.each([
    'não vou parar de comprar com vocês',
    'quero sair só depois da promoção',
    'oi, chegou meu pedido?',
    '',
    '   ',
  ])('não confunde "%s" com pedido de saída', (texto) => {
    expect(ehPedidoDeSaida(texto)).toBe(false);
  });
});
