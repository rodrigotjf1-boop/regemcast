/**
 * A decisão da Meta sobre o nome de exibição de um número
 * (`phone_number_name_update`).
 *
 * Enquanto o nome não é aprovado o número envia com limite menor — foi o que a
 * primeira leitura real da saúde mostrou (02/10/2026). A decisão chega por este
 * aviso, que já estava assinado e ia para o "sem tratamento próprio": o dono só
 * saberia olhando o painel da Meta.
 *
 * Aqui ficam as regras puras: ler o aviso sem confiar no formato e montar o
 * texto que vai para o celular.
 */

export type DecisaoDoNome = 'aprovado' | 'recusado' | 'em_analise' | 'adiado';

const DECISAO: Record<string, DecisaoDoNome> = {
  APPROVED: 'aprovado',
  REJECTED: 'recusado',
  PENDING: 'em_analise',
  DEFERRED: 'adiado',
};

/** Os motivos de recusa da Meta, ditos do jeito que dá para agir. `UNKNOWN` fica sem motivo. */
const MOTIVO: Record<string, string> = {
  NAME_EMPLOYEE_ISSUE: 'o nome traz o nome de uma pessoa ou de um funcionário',
  NAME_ENDCLIENT_NOTRELATED: 'o nome cita outra empresa, sem relação com a sua',
  NAME_FORMAT_UNACCEPTABLE: 'o formato do nome não é aceito',
  NAME_INDIVIDUAL_ISSUE: 'o nome traz o nome de uma pessoa',
  NAME_NOT_CONSISTENT: 'o nome não bate com a marca da empresa',
};

export interface DecisaoLida {
  decisao: DecisaoDoNome;
  /** O nome que foi analisado. */
  nome: string | null;
  /** Por que foi recusado, em português. Nulo quando a Meta não disse ou não conhecemos o motivo. */
  motivo: string | null;
  /** O telefone do número, em E.164 (`+5521…`), para achar a nossa linha. */
  telefoneE164: string | null;
}

/** Lê o aviso. Nulo quando não traz uma decisão que reconhecemos. */
export function lerDecisaoDoNome(v: Record<string, unknown>): DecisaoLida | null {
  const decisao = DECISAO[String(v.decision ?? '').trim().toUpperCase()];
  if (!decisao) return null;
  const texto = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim() : null);
  const digitos = String(v.display_phone_number ?? '').replace(/\D/g, '');
  return {
    decisao,
    nome: texto(v.requested_verified_name),
    motivo: decisao === 'recusado' ? (MOTIVO[String(v.rejection_reason ?? '').trim().toUpperCase()] ?? null) : null,
    telefoneE164: digitos.length >= 8 && digitos.length <= 15 ? `+${digitos}` : null,
  };
}

/**
 * O aviso no celular. Só a decisão final avisa: "em análise" e "adiado" não
 * mudam nada para quem envia.
 */
export function avisoDoNome(d: DecisaoLida): { titulo: string; corpo: string } | null {
  const qual = d.nome ? `: ${d.nome}` : '';
  if (d.decisao === 'aprovado') {
    return {
      titulo: `Nome de exibição aprovado${qual}`,
      corpo: 'A Meta aprovou o nome de exibição do número. A restrição por nome não aprovado deixa de valer.',
    };
  }
  if (d.decisao === 'recusado') {
    return {
      titulo: `Nome de exibição recusado${qual}`,
      corpo: `A Meta recusou o nome de exibição do número${d.motivo ? `: ${d.motivo}` : ''}. Ajuste o nome no Gerenciador do WhatsApp, na Meta, e envie de novo.`,
    };
  }
  return null;
}
