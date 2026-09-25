-- 026_descadastro_celular_antigo.sql — Quem pediu para sair fica bloqueado nas DUAS formas do celular.
--
-- Celular brasileiro cadastrado no WhatsApp antes do 9º dígito chega da Meta
-- com 12 dígitos (55 21 8975-1705). A base pode ter a mesma pessoa na outra
-- forma (55 21 98975-1705): a importação de arquivo guarda o número como veio.
-- Até esta versão, o pedido de saída ("Parar promoções", "sair") gravava o
-- bloqueio só na forma que chegou — e o contato na outra forma continuava
-- recebendo campanha.
--
-- O código novo bloqueia as duas formas, e o disparo confere as duas. Esta
-- migration acerta o que ficou para trás: todo contato ativo cujo "gêmeo" está
-- bloqueado passa a ficar bloqueado também, com a mesma data e origem, e cada
-- um ganha a sua linha na auditoria.
--
-- A regra do gêmeo é a de `gemeoDoCelular` (backend/src/common/telefone.ts):
-- 13 dígitos com o 9 seguido de 6 a 9 → tira o 9; 12 dígitos começando em 6 a
-- 9 → põe o 9. Fixo e número de fora não têm gêmeo.
--
-- Só dados, sem estrutura: o código não depende dela. Idempotente — rodar de
-- novo não acha mais ninguém.

with gemeos as (
  update contato c
     set opt_out = true,
         opt_out_em = coalesce(c.opt_out_em, o.opt_out_em, now()),
         opt_out_origem = coalesce(c.opt_out_origem, o.opt_out_origem)
    from contato o
   where o.conta_id = c.conta_id
     and o.opt_out = true
     and c.opt_out = false
     and o.telefone_e164 = case
           when c.telefone_e164 ~ '^55[0-9]{2}9[6-9][0-9]{7}$'
             then substr(c.telefone_e164, 1, 4) || substr(c.telefone_e164, 6)
           when c.telefone_e164 ~ '^55[0-9]{2}[6-9][0-9]{7}$'
             then substr(c.telefone_e164, 1, 4) || '9' || substr(c.telefone_e164, 5)
         end
  returning c.id, c.conta_id, c.telefone_e164, c.opt_out_origem
)
insert into auditoria (conta_id, ator_tipo, acao, entidade, entidade_id, detalhe)
select g.conta_id, 'sistema', 'contato.opt_out', 'contato', g.id::text,
       jsonb_build_object(
         'origem', g.opt_out_origem,
         'motivo', 'mesmo celular com e sem o 9º dígito (migration 026)',
         'telefone', '••••' || right(g.telefone_e164, 4)
       )
  from gemeos g;
