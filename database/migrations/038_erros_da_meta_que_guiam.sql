-- 038_erros_da_meta_que_guiam.sql — O erro da Meta diz o que houve e o que fazer, e erro da conta para a campanha.
--
-- Achado no teste do dono (01/10/2026): o primeiro disparo de modelo com imagem
-- foi aceito pela Meta e recusado depois, pelo aviso de entrega, com o código
-- 131042 (pagamento da conta do WhatsApp não configurado). O código não estava
-- no catálogo: a tela mostrou a frase da Meta em inglês, com um endereço de 200
-- caracteres que criava rolagem lateral, e "registre para investigarmos". E o
-- erro é da CONTA — a mensagem seguinte teria a mesma resposta —, mas nada
-- parava a campanha: cada destinatário viraria "falhou", um por um.
--
-- * `campanha_destinatario.erro_meta` — a frase da Meta, crua, de cada falha.
--   Não é o que a tela mostra como explicação (essa sai do catálogo, pelo
--   código, na leitura): fica para o "o que a Meta respondeu" e para tirar dela
--   o endereço que a própria Meta manda para resolver (pagamento, termos).
-- * `campanha.pausa_erro_codigo` e `campanha.pausa_erro_meta` — o código e a
--   frase da Meta que pausaram a campanha, para o aviso da tela dizer o motivo
--   e o que fazer sem depender de um destinatário marcado como falha.
-- * `campanha.pausa_motivo` aceita `conta_meta` — a Meta recusou por um
--   problema da conta ou do número (pagamento, conta restrita, registro): a
--   campanha para na primeira recusa, com a fila guardada. Credencial caída
--   continua em `conexao`, e modelo recusado em `modelo`.
--
-- Idempotente. Tem `drop constraint`: aplicar pelo SQL Editor (LIC-171).

set local lock_timeout = '10s';

-- ---------------------------------------------------------------- destinatário
-- Tabela quente (disparo e webhook): coluna nula, sem reescrever nada.
alter table campanha_destinatario add column if not exists erro_meta text;

comment on column campanha_destinatario.erro_meta is
  'A frase da Meta, crua, da falha deste destinatario (ate 1000 caracteres). A explicacao da tela sai do catalogo, pelo erro_codigo.';

-- ---------------------------------------------------------------- campanha
alter table campanha add column if not exists pausa_erro_codigo integer;
alter table campanha add column if not exists pausa_erro_meta text;

comment on column campanha.pausa_erro_codigo is
  'O codigo de erro da Meta que pausou a campanha (pausa_motivo = modelo, conta_meta ou conexao). Nulo nas outras pausas.';
comment on column campanha.pausa_erro_meta is
  'A frase da Meta, crua, do erro que pausou a campanha. Dela sai o endereco que a Meta manda para resolver.';

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'ck_campanha_pausa_motivo') then
    alter table campanha drop constraint ck_campanha_pausa_motivo;
  end if;
  alter table campanha add constraint ck_campanha_pausa_motivo
    check (pausa_motivo is null or pausa_motivo in ('conexao', 'teto_plano', 'inadimplencia', 'manual', 'modelo', 'conta_meta'));
end $$;
