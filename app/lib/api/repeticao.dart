/// Leitura que falhou NÃO é repetida sozinha.
///
/// O Riverpod 3 repete toda leitura que falha até 10 vezes (de 0,2 s a 6,4 s,
/// ~40 s no total) e, enquanto isso, o estado fica "carregando": a tela
/// mostrava o esqueleto em vez do motivo e do "Tentar de novo" — e um 404 (as
/// conversas desligadas, a mídia que a Meta já apagou) virava 10 pedidos
/// inúteis ao servidor. Aqui o erro aparece na hora, como no site; quem
/// precisa de dado novo relê de propósito (puxar a tela, "Tentar de novo" e
/// as telas que se atualizam sozinhas). Ver ERR-026.
Duration? semRepeticao(int tentativas, Object erro) => null;
