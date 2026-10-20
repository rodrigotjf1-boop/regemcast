/**
 * A tela da autorização por clique, montada no SERVIDOR (função pura).
 *
 * A página só desenha o que vem daqui, e é este mesmo conteúdo, com a decisão
 * do dono, que vira o texto guardado como prova (`integracao_autorizacao.texto`,
 * com a versão). Assim a prova é o que a tela mostrou, não uma cópia que pode
 * divergir. Os textos são os do protótipo aprovado pelo dono em 20/10/2026
 * (página "Autorização por clique" do Hub DMS); o nome do produto segue a regra
 * da marca ("Regemcast").
 */
import { descreverEscopos } from './integracao.regras';
import {
  naoPode,
  PERMISSOES_COM_DADO_PESSOAL,
  VERSAO_DO_TEXTO,
  type AplicativoDaAutorizacao,
  type ContaQuePede,
} from './autorizacao.regras';

/** A data da versão atual do texto (sobe junto com VERSAO_DO_TEXTO). */
export const DATA_DO_TEXTO = '20/10/2026';

export interface PermissaoNaTela {
  id: string;
  rotulo: string;
  frase: string;
  motivo: string;
  dadoPessoal: boolean;
  /** O que acontece com ela desligada (só nas opcionais). */
  semEla: string | null;
}

export interface TelaDaAutorizacao {
  versao: number;
  aplicativo: { produto: string; nome: string; selo: string; empresa: string; cnpj: string; detalhes: string; inicio: string };
  titulo: string;
  abertura: string;
  contaQuePede: ContaQuePede & { outraEmpresa: boolean };
  conta: { nome: string; cnpj: string | null };
  necessarias: PermissaoNaTela[];
  opcionais: PermissaoNaTela[];
  /** A conta já tem uma ligação ativa com o aplicativo: o pedido é "mais permissões" (ou renovar). */
  jaLigada: null | { desde: string; escopos: { id: string; rotulo: string }[]; novas: string[] };
  naoPode: { rotulo: string; frase: string }[];
  nota: string;
  rodape: string;
}

export interface EntradaDaTela {
  app: AplicativoDaAutorizacao;
  empresa: { razaoSocial: string; cnpj: string };
  redirectUri: string;
  pedido: { necessarias: readonly string[]; opcionais: readonly string[]; contaQuePede: ContaQuePede };
  conta: { nome: string; cnpj: string | null };
  outraEmpresa: boolean;
  ligacaoAtiva: null | { criadoEm: Date; escopos: readonly string[] };
}

/** CNPJ com a máscara de sempre: 11.222.333/0001-81. */
export function formatarCnpj(cnpj: string | null): string {
  const d = (cnpj ?? '').replace(/\D/g, '');
  if (d.length !== 14) return cnpj ?? '';
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

const dataCurta = (d: Date) =>
  `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;

function naTela(ids: readonly string[], app: AplicativoDaAutorizacao): PermissaoNaTela[] {
  return descreverEscopos(ids).map((e) => ({
    id: e.id,
    rotulo: e.rotulo,
    frase: e.descricao,
    motivo: app.motivos[e.id] ?? '',
    dadoPessoal: PERMISSOES_COM_DADO_PESSOAL.includes(e.id),
    semEla: app.semAOpcional[e.id] ?? null,
  }));
}

export function montarTela(e: EntradaDaTela): TelaDaAutorizacao {
  const { app } = e;
  const pedidas = [...e.pedido.necessarias, ...e.pedido.opcionais];
  const jaLigada = e.ligacaoAtiva
    ? {
        desde: e.ligacaoAtiva.criadoEm.toISOString(),
        escopos: descreverEscopos(e.ligacaoAtiva.escopos).map(({ id, rotulo }) => ({ id, rotulo })),
        novas: pedidas.filter((p) => !e.ligacaoAtiva!.escopos.includes(p)),
      }
    : null;

  let titulo = `O ${app.nome} quer acessar a sua conta do Regemcast`;
  let abertura = app.faz;
  if (jaLigada) {
    const desde = dataCurta(e.ligacaoAtiva!.criadoEm);
    if (jaLigada.novas.length) {
      titulo = jaLigada.novas.length === 1 ? `O ${app.nome} pede mais uma permissão` : `O ${app.nome} pede mais ${jaLigada.novas.length} permissões`;
      const rotulos = descreverEscopos(jaLigada.novas).map((p) => p.rotulo.toLowerCase());
      abertura = `O ${app.nome} já lê esta conta desde ${desde} e agora pede para ver também: ${rotulos.join(', ')}. Se você disser não, ele continua com o que já tinha.`;
    } else {
      titulo = `O ${app.nome} pede para renovar o acesso à sua conta`;
      abertura = `O ${app.nome} já lê esta conta desde ${desde}. Autorizar de novo troca o acesso dele: o anterior para de valer quando ele receber o novo. Se você disser não, nada muda.`;
    }
  }

  return {
    versao: VERSAO_DO_TEXTO,
    aplicativo: {
      produto: app.produto,
      nome: app.nome,
      selo: app.nome.charAt(0).toUpperCase(),
      empresa: e.empresa.razaoSocial,
      cnpj: formatarCnpj(e.empresa.cnpj),
      detalhes: `A DMS conferiu a empresa, o CNPJ e o endereço de volta (${new URL(e.redirectUri).host}). O nome e o logotipo sozinhos não provam quem é: confira a empresa e o CNPJ.`,
      inicio: app.inicio,
    },
    titulo,
    abertura,
    contaQuePede: { ...e.pedido.contaQuePede, cnpj: e.pedido.contaQuePede.cnpj ? formatarCnpj(e.pedido.contaQuePede.cnpj) : null, outraEmpresa: e.outraEmpresa },
    conta: { nome: e.conta.nome, cnpj: e.conta.cnpj ? formatarCnpj(e.conta.cnpj) : null },
    necessarias: naTela(e.pedido.necessarias, app),
    opcionais: naTela(e.pedido.opcionais, app),
    jaLigada,
    naoPode: naoPode(app.nome),
    nota: `A ligação vai direto do Regemcast para o ${app.nome}: ninguém vê nem copia código ou senha. Vale até você desligar, em Integrações › Aplicativos conectados, ou no próprio ${app.nome}.`,
    rodape: `Fica registrado: quem autorizou, quando, este texto (versão ${VERSAO_DO_TEXTO}, de ${DATA_DO_TEXTO}) e o que foi liberado. Você recebe um e-mail e um aviso no celular.`,
  };
}

/** O texto guardado como prova: a tela inteira e a decisão do dono. */
export function textoGuardado(
  tela: TelaDaAutorizacao,
  decisao: { opcionaisLigadas: readonly string[]; confirmouOutraEmpresa: boolean },
): Record<string, unknown> {
  return {
    ...tela,
    opcionais: tela.opcionais.map((o) => ({ ...o, ligada: decisao.opcionaisLigadas.includes(o.id) })),
    confirmouOutraEmpresa: tela.contaQuePede.outraEmpresa ? decisao.confirmouOutraEmpresa : null,
  };
}
