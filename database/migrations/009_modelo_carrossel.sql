-- 009_modelo_carrossel.sql — Carrossel: vários produtos numa mensagem só.
--
-- O carrossel não é uma variação do modelo simples: é outra forma. A Meta o
-- monta como um BODY (o balão de texto que aparece acima) seguido de um
-- componente CAROUSEL com 2 a 10 cartões, cada um com a própria imagem, o
-- próprio texto e os próprios botões.
--
-- E ele exclui coisas: modelo de carrossel não tem cabeçalho, não tem rodapé e
-- não aceita oferta por tempo limitado. Guardar os cartões numa coluna separada
-- deixa essa diferença explícita, em vez de espalhar `if formato = carrossel`
-- por todo lado.
--
-- Idempotente: pode rodar duas vezes sem efeito diferente.

-- simples    — cabeçalho + corpo + rodapé + botões
-- carrossel  — corpo + 2 a 10 cartões
alter table modelo
  add column if not exists tipo text not null default 'simples';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'modelo_tipo_check'
  ) then
    alter table modelo
      add constraint modelo_tipo_check check (tipo in ('simples','carrossel'));
  end if;
end $$;

-- Os cartões, em ordem. Cada um: { imagem, corpo, botoes[] }.
--
-- JSON e não tabela filha de propósito. Um cartão não tem vida própria: não é
-- consultado, filtrado nem referenciado de fora — ele só existe dentro do
-- modelo, e some junto com ele. Uma tabela filha aqui cobraria um join em toda
-- leitura para devolver sempre o conjunto inteiro.
alter table modelo
  add column if not exists cartoes jsonb not null default '[]'::jsonb;

comment on column modelo.tipo is
  'simples ou carrossel. Carrossel nao tem cabecalho, rodape nem oferta por tempo limitado.';

comment on column modelo.cartoes is
  'Os cartoes do carrossel, em ordem: { imagem, corpo, botoes[] }. De 2 a 10, todos com a mesma estrutura de botoes.';
