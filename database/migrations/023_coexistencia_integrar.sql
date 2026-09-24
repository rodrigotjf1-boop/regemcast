-- 023_coexistencia_integrar.sql — A pergunta da coexistência: trazer, ou não,
-- os contatos e as conversas do WhatsApp Business para o Regemcast.
--
-- Na coexistência, a Meta nos copia a agenda do celular (os contatos com
-- WhatsApp) e os últimos 6 meses de conversa. Pedir essa cópia é OBRIGATÓRIO
-- em até 24 horas: sem o pedido, a Meta desfaz a conexão. Por isso a resposta
-- do lojista não decide SE pedimos — decide se GUARDAMOS o que chega.
--
-- DECISÕES:
--
-- * A resposta fica por NÚMERO, não por conta: a mesma conta pode ter um
--   número em coexistência e outro dedicado só a campanhas.
-- * `integrar_conversas` nulo = ainda não respondeu. Não há valor padrão de
--   propósito: guardar a agenda de alguém exige uma resposta explícita.
-- * O histórico é copiado uma vez só. Quem responde "não" não recupera as
--   conversas antigas depois — a tela avisa antes da resposta.
-- * Os contatos entram com consentimento `declarado`: a declaração do lojista,
--   no momento da resposta, é o registro. O número é de uso empresarial, e a
--   responsabilidade pela agenda é da empresa.
-- * `integrar_lista_id` é a lista "WhatsApp Business" deste número. Contato
--   apagado da agenda do celular sai da lista, mas não da base.
-- * `integrar_importacao_id` é UM registro de importação por número, somando
--   os lotes: a cópia inicial chega em partes, e contato novo salvo no celular
--   continua chegando depois.
--
-- Idempotente: só acrescenta colunas e amplia uma lista de valores.

alter table wa_numero add column if not exists integrar_conversas boolean;
alter table wa_numero add column if not exists integrar_decidido_em timestamptz;
alter table wa_numero add column if not exists integrar_decidido_por uuid
  references usuario(id) on delete set null;
alter table wa_numero add column if not exists integrar_lista_id uuid
  references contato_lista(id) on delete set null;
alter table wa_numero add column if not exists integrar_importacao_id uuid
  references importacao(id) on delete set null;

comment on column wa_numero.integrar_conversas is
  'Coexistencia: true = guardar contatos e conversas do WhatsApp Business; false = descartar o que chega; null = ainda nao respondeu.';

comment on column wa_numero.integrar_lista_id is
  'Lista "WhatsApp Business" deste numero. Recriada pelo codigo se o lojista apagar.';

-- Os contatos da agenda aparecem no histórico de importações com formato próprio.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'importacao_formato_check') then
    alter table importacao drop constraint importacao_formato_check;
  end if;
  alter table importacao add constraint importacao_formato_check
    check (formato in ('vcard','csv','xlsx','texto','cardapioweb','whatsapp_business'));
end $$;
