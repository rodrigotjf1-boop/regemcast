-- 025_wa_evento_sincronizacao.sql — Achar depressa os lotes de sincronização de um número.
--
-- A agenda e o histórico da coexistência (tipos `smb_app_state_sync` e
-- `history`) ficam no registro de eventos até irem para o lugar deles
-- (contatos e conversas). Três rotinas perguntam "quais lotes deste número?":
--
--   * a retomada, que devolve à fila o que chegou antes da resposta do dono;
--   * o job de prazo, que conclui pelo 100% e expira quem ficou sem sinal;
--   * a gravação das conversas, que consome o histórico guardado.
--
-- Sem índice, cada pergunta lê a tabela inteira — e ela cresce a cada status
-- de entrega de campanha. O índice é PARCIAL: só esses dois tipos interessam,
-- e eles são uma fração mínima dos eventos. Nasce pequeno e fica pequeno.
--
-- Criado agora, com a tabela ainda pequena, leva segundos. Índice criado tarde,
-- numa tabela grande, estoura o tempo do SQL Editor — e como o arquivo roda
-- numa transação só, desfaz a migration inteira sem avisar.
--
-- Idempotente.

create index if not exists idx_wa_evento_sincronizacao
  on wa_evento (phone_number_id, recebido_em)
  where tipo in ('history', 'smb_app_state_sync');
