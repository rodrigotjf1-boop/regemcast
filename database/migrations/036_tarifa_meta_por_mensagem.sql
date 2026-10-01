-- 036_tarifa_meta_por_mensagem.sql — O que a Meta diz sobre a cobrança de cada mensagem.
--
-- Primeira peça do roteiro da IA (01/10/2026, etapa Base): sem saber o que a
-- Meta cobrou, não existe orçamento de disparos nem custo por campanha.
--
-- Cada aviso de status (`messages` → `statuses[]`) traz o objeto `pricing`:
--
--   "pricing": { "billable": true, "pricing_model": "PMP",
--                "type": "regular", "category": "marketing" }
--
-- Até aqui ele era lido e jogado fora. Passam a ficar guardados, por
-- destinatário, os dois campos que a Meta manda usar para saber se a mensagem
-- foi cobrada e em qual tabela de preço (`billable` está marcado para sair):
--
-- * `tarifa_tipo`      — `regular` (cobrada), `free_customer_service` ou
--                        `free_entry_point` (as duas de graça).
-- * `tarifa_categoria` — `marketing`, `utility`, `authentication`,
--                        `authentication-international`, `service`,
--                        `marketing_lite`, `referral_conversion`.
--
-- São valores da Meta, guardados como vieram e SEM `check`: a lista é dela e
-- cresce sem aviso (o código só aceita texto curto, em minúsculas). O valor em
-- dinheiro NÃO vem no aviso: sai da tabela de tarifas, na etapa do orçamento.
--
-- A Meta cobra na ENTREGA: mensagem cobrada é `tarifa_tipo = 'regular'` com
-- `status in ('entregue', 'lida')` — pelo status, não por `entregue_em`: o aviso
-- de leitura pode chegar sem o de entrega, e mensagem lida foi entregue. O
-- `pricing` chega no aviso de envio e em mais um (entrega ou leitura); vale o
-- primeiro que chegar.
--
-- Nenhuma tabela nova. Idempotente.

-- `campanha_destinatario` é a tabela mais quente do sistema (disparo e
-- webhook): se alguma consulta longa a segurar, o `alter` desiste em 10 s em
-- vez de enfileirar todo o resto atrás dele. Aí é só rodar de novo.
set local lock_timeout = '10s';

alter table campanha_destinatario add column if not exists tarifa_tipo text;
alter table campanha_destinatario add column if not exists tarifa_categoria text;

comment on column campanha_destinatario.tarifa_tipo is
  'O `pricing.type` do aviso da Meta: regular = cobrada (na entrega); free_* = de graca. Nulo = a Meta ainda nao disse.';
comment on column campanha_destinatario.tarifa_categoria is
  'O `pricing.category` do aviso da Meta (marketing, utility, authentication...): a tabela de preco em que a mensagem caiu.';
