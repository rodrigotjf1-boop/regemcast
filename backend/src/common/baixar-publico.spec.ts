import { conferirEndereco, EnderecoRecusado, ipPublico } from './baixar-publico';

describe('baixar-publico', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.20.0.5',
    '192.168.0.10',
    '169.254.169.254',
    '100.64.1.1',
    '0.0.0.0',
    '::1',
    '::',
    'fd00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
  ])('recusa o IP interno %s', (ip) => {
    expect(ipPublico(ip)).toBe(false);
  });

  it.each(['8.8.8.8', '104.16.1.1', '2606:4700::1111'])('aceita o IP público %s', (ip) => {
    expect(ipPublico(ip)).toBe(true);
  });

  it.each([
    'http://exemplo.com/a.png',
    'https://user:senha@exemplo.com/a.png',
    'https://exemplo.com:8080/a.png',
    'https://127.0.0.1/a.png',
    'https://[::1]/a.png',
    'ftp://exemplo.com/a.png',
    'não é endereço',
  ])('recusa o endereço %s', (url) => {
    expect(() => conferirEndereco(url)).toThrow(EnderecoRecusado);
  });

  it('aceita https público na porta padrão', () => {
    expect(conferirEndereco('https://exemplo.com/imagem.png').hostname).toBe('exemplo.com');
  });
});
