/**
 * Quem usa o Regem não paga o Regemcast (decisão do dono, 30/09/2026).
 *
 * A conta LIGADA ao Regem (a integração de `modules/regem`, que só a
 * distribuição liga) é grátis enquanto estiver ligada:
 *
 * - não tem teto de disparos do plano — vale só o limite da própria conta do
 *   WhatsApp na Meta (`capacidadeDaMeta`);
 * - os disparos não param por falta de pagamento, a conta não vira
 *   inadimplente e não recebe os avisos de fim do grátis.
 *
 * Desligou a integração, a gratuidade acaba: sem plano pago, os disparos param
 * depois da carência (`CARENCIA_DIAS`), contada do desligamento
 * (`RegemService.desligar`).
 *
 * A regra mora AQUI, num lugar só, e é calculada na hora (não é um estado
 * gravado na assinatura): ligar e desligar valem no mesmo instante, sem nada
 * para sincronizar.
 */
import { sql, type SQL } from 'drizzle-orm';

/**
 * Marca em `assinatura.avisos_enviados`: o grátis terminou porque a integração
 * com o Regem foi desligada — o aviso por e-mail sai com a frase própria.
 */
export const MARCA_REGEM_DESLIGADO = 'regem_desligado';

/** A conta (coluna ou valor com o id) está ligada ao Regem? Para usar dentro de uma consulta. */
export function ligadaAoRegem(conta: SQL): SQL<boolean> {
  return sql<boolean>`exists (
    select 1 from integracao_regem ir
     where ir.conta_id = ${conta} and ir.credencial_cifrada is not null
  )`;
}
