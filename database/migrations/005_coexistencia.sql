-- 005_coexistencia.sql — O cliente mantém o WhatsApp Business no celular.
--
-- A Meta chama isso de "Coexistence": o mesmo número atende conversa individual
-- pelo app do celular E dispara em volume pela Cloud API, com o histórico
-- sincronizado entre os dois.
--
-- Para o nosso público isso não é conforto, é condição de venda: quem hoje
-- dispara na mão pelo WhatsApp Business não troca a ferramenta do dia a dia
-- por uma promessa. Sem coexistência, a primeira pergunta de todo cliente
-- ("vou perder meu WhatsApp?") tem a pior resposta possível.
--
-- Três coisas mudam quando um número é de coexistência, e por isso precisam
-- ficar registradas por número, não por conta:
--
--   1. **O registro na Cloud API é PULADO.** O número já está registrado pelo
--      app do celular; chamar /register nele dá erro.
--   2. **O teto de vazão é 20 mensagens por segundo**, fixo, contra até 80 de
--      um número dedicado. O motor de disparo precisa saber disso para não
--      martelar a Meta e colher 130429.
--   3. **Há um prazo de 24 horas** para sincronizar os dados do app depois do
--      onboarding. Estourado o prazo, a Meta desfaz a conexão e o cliente
--      precisa refazer tudo — então o estado da sincronização precisa ser
--      observável, não implícito.
--
-- Idempotente: só acrescenta colunas.

alter table wa_numero add column if not exists coexistencia boolean not null default false;

comment on column wa_numero.coexistencia is
  'true = o número também é usado no app WhatsApp Business do celular. Pula o /register e limita a vazão a 20 mps.';

-- Estado da sincronização exigida pela coexistência.
--   nao_se_aplica  — número dedicado, não há o que sincronizar
--   pendente       — onboarding feito, sincronização ainda não começou
--   sincronizando  — pedimos à Meta; os dados chegam por webhook, em fases
--   concluida      — recebemos o fim da sincronização
--   expirada       — passou das 24h; a Meta desfaz e o cliente refaz o fluxo
--   falhou         — a Meta recusou (ex.: o cliente não autorizou compartilhar)
alter table wa_numero add column if not exists sincronizacao text not null default 'nao_se_aplica';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'wa_numero_sincronizacao_check'
  ) then
    alter table wa_numero add constraint wa_numero_sincronizacao_check
      check (sincronizacao in ('nao_se_aplica','pendente','sincronizando','concluida','expirada','falhou'));
  end if;
end $$;

alter table wa_numero add column if not exists sincronizacao_em timestamptz;
alter table wa_numero add column if not exists sincronizacao_erro text;

-- O prazo de 24h contado a partir daqui. Guardado em vez de derivado de
-- `criado_em` porque o relógio começa quando o cliente conclui o fluxo, que
-- não é necessariamente quando a linha nasce (um número pode ser reconectado).
alter table wa_numero add column if not exists onboardado_em timestamptz;

-- Quem está com sincronização em aberto, mais antigo primeiro: é a fila que o
-- job de acompanhamento percorre para detectar quem vai estourar o prazo.
create index if not exists idx_wa_numero_sincronizacao
  on wa_numero (sincronizacao, onboardado_em)
  where sincronizacao in ('pendente','sincronizando');
