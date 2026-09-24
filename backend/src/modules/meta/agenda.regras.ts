/**
 * A agenda do WhatsApp Business (coexistência) — as regras, sem banco.
 *
 * Na coexistência a Meta nos manda a agenda do celular pelo webhook
 * `smb_app_state_sync`: a cópia inicial, em lotes, e depois cada contato que o
 * lojista salvar, editar ou apagar no aparelho. O formato, conferido na
 * referência oficial do webhook:
 *
 *     value.state_sync[] = {
 *       type: 'contact',
 *       contact: { full_name, first_name, phone_number },   // só dígitos, com o país
 *       action: 'add' | 'remove',                           // sem nome na remoção
 *       metadata: { timestamp }
 *     }
 *
 * Etiquetas NÃO vêm: a Meta não as sincroniza, e só ferramenta não oficial as
 * lê. As listas do Regemcast fazem esse papel.
 */
import { doWhatsapp, paraCloudApi } from '../../common/telefone';

/**
 * O que o dono declara ao responder "sim".
 *
 * O número é de uso empresarial e a agenda é da empresa: esta declaração é o
 * registro de consentimento dos contatos que vierem do celular. O texto é UM
 * só — a tela o recebe do servidor (`GET /whatsapp/config`) e a auditoria grava
 * este mesmo texto, então o que foi mostrado é o que fica registrado.
 */
export const DECLARACAO_INTEGRACAO =
  'Os contatos do WhatsApp Business deste número são clientes da empresa e podem receber mensagens dela. ' +
  'A responsabilidade por essa agenda é da empresa.';

/** O que fazer com um lote, conforme a resposta do dono. */
export type Destino = 'aplicar' | 'aguardar' | 'descartar';

/**
 * O que acontece com o conteúdo do evento depois de processado.
 *
 * `guardar` — fica como chegou, esperando a resposta (ou a etapa que o usa).
 * `esvaziar` — o conteúdo sai do registro de eventos: ou já foi gravado no
 * lugar dele, ou o dono respondeu "não".
 */
export type DestinoDoEvento = 'guardar' | 'esvaziar';

/**
 * Agenda: `true` grava, `false` descarta, sem resposta espera.
 *
 * Esperar significa guardar o lote como chegou: quando o dono responder, a
 * retomada o reprocessa. Descartar apaga o conteúdo do evento — quem disse
 * "não" não tem a agenda guardada em lugar nenhum.
 */
export function destinoDaAgenda(integrar: boolean | null): Destino {
  if (integrar === true) return 'aplicar';
  if (integrar === false) return 'descartar';
  return 'aguardar';
}

/**
 * Histórico de conversas: só o "não" decide por ora.
 *
 * Com "sim" ou sem resposta, o lote espera: é a gravação das conversas
 * (próxima etapa) que vai consumi-lo. Descartar aqui perderia de vez os 6
 * meses de conversa — a Meta só manda o histórico uma vez.
 */
export function destinoDoHistorico(integrar: boolean | null): Destino {
  return integrar === false ? 'descartar' : 'aguardar';
}

export interface ContatoDaAgenda {
  telefone: string;
  nome: string | null;
}

export interface LoteDaAgenda {
  /** Salvos ou editados no celular: entram (ou continuam) na base e na lista. */
  adicionar: ContatoDaAgenda[];
  /** Apagados da agenda do celular: saem da lista do número, não da base. */
  remover: string[];
  /** Número que não é telefone válido nem depois da correção do 9º dígito. */
  invalidos: number;
  /** Item de outro tipo ou ação desconhecida: registrado, não aplicado. */
  ignorados: number;
}

const TAMANHO_NOME = 120;

function nomeDe(contato: Record<string, unknown> | undefined): string | null {
  const bruto = [contato?.full_name, contato?.first_name].find((v) => typeof v === 'string' && v.trim());
  if (typeof bruto !== 'string') return null;
  return bruto.trim().replace(/\s+/g, ' ').slice(0, TAMANHO_NOME);
}

/**
 * Separa um lote em quem entra e quem sai.
 *
 * O mesmo número pode aparecer duas vezes no lote (salvou e apagou); vale a
 * ÚLTIMA ação, na ordem em que a Meta mandou. Ação que não conhecemos não é
 * tratada como "add" — assumir o sentido de um campo novo é como se grava
 * contato que o dono apagou.
 */
export function separarAgenda(itens: unknown): LoteDaAgenda {
  const lista = Array.isArray(itens) ? itens : [];
  const finais = new Map<string, { acao: 'add' | 'remove'; nome: string | null }>();
  let invalidos = 0;
  let ignorados = 0;

  for (const bruto of lista) {
    const item = (bruto ?? {}) as Record<string, unknown>;
    const acao = item.action;
    if (item.type !== 'contact' || (acao !== 'add' && acao !== 'remove')) {
      ignorados++;
      continue;
    }

    const contato = item.contact as Record<string, unknown> | undefined;
    const { e164 } = paraCloudApi(`+${doWhatsapp(contato?.phone_number)}`);
    if (!e164) {
      invalidos++;
      continue;
    }

    // Reinsere para a ordem do Map refletir a última ação.
    finais.delete(e164);
    finais.set(e164, { acao, nome: acao === 'add' ? nomeDe(contato) : null });
  }

  const adicionar: ContatoDaAgenda[] = [];
  const remover: string[] = [];
  for (const [telefone, f] of finais) {
    if (f.acao === 'add') adicionar.push({ telefone, nome: f.nome });
    else remover.push(telefone);
  }
  return { adicionar, remover, invalidos, ignorados };
}
