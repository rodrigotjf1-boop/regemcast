-- 027_disparo_limite_meta.sql — O disparo obedece ao limite da Meta e tenta de novo quando ela pede calma.
--
-- Até aqui o limite de envio da Meta (pessoas diferentes por 24 horas, hoje
-- do PORTFÓLIO: 250 → 2.000 → 10.000 → 100.000 → sem teto) só aparecia na
-- tela. O disparo não o lia, e a recusa por ritmo (130429, 80007) virava falha
-- definitiva — embora a tela prometesse que "nenhuma mensagem se perde".
--
-- Três colunas e um índice:
--
--   * campanha.retomar_em — até quando esperar porque a Meta pediu calma. NÃO
--     é pausa: a campanha segue ativa e o worker só a pula até lá, sem ninguém
--     precisar retomar.
--   * campanha_destinatario.tentativas / proxima_tentativa_em — a nova
--     tentativa do destinatário que a Meta RECUSOU (respondeu com erro de ritmo
--     ou instabilidade). Rede caída no meio do envio não entra: não dá para
--     saber se a mensagem chegou, e reenviar duplicaria.
--   * idx_campanha_destinatario_enviada — conta, a cada rodada, quantas pessoas
--     a conta já alcançou nas últimas 24 horas. Parcial (só o que saiu).
--
-- Colunas antes do código: o Drizzle pede a lista explícita de colunas, e o
-- deploy que chega antes da migration quebra toda consulta à tabela.
--
-- Idempotente.

alter table campanha add column if not exists retomar_em timestamptz;

alter table campanha_destinatario add column if not exists tentativas smallint not null default 0;
alter table campanha_destinatario add column if not exists proxima_tentativa_em timestamptz;

create index if not exists idx_campanha_destinatario_enviada
  on campanha_destinatario (conta_id, enviada_em)
  where enviada_em is not null;
