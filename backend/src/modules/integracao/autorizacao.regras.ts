/**
 * A autorização por clique do Hub DMS (F2, etapa B1): regras puras.
 *
 * O caminho (Padrão DMS §3, ajustado em 20/10/2026; decisões B1-1 a B1-9):
 *
 * 1. o servidor do aplicativo registra o PEDIDO com o token do DMS ID (pedido
 *    empurrado, RFC 9126) e recebe um número de uso único, que vence em 10
 *    minutos. O navegador leva só o aplicativo e esse número: o que a tela mostra
 *    (a conta que pede, as permissões) não se troca no caminho;
 * 2. o dono confere a página, decide o opcional e confirma com a SENHA: nasce a
 *    autorização, com o texto mostrado e a versão dele (a prova), e um CÓDIGO de
 *    uso único (10 minutos) que volta ao endereço cadastrado do aplicativo, com o
 *    `state` e o `iss` (RFC 9207);
 * 3. o aplicativo troca o código pelo segredo da LIGAÇÃO, de servidor para
 *    servidor, com o verificador PKCE (S256). Só aí a ligação nasce ou muda.
 *
 * Quem pode usar a página é a lista curta do código (a classe `dms` do Padrão
 * §1): o catálogo abaixo. O aplicativo só pede o que está nele. Gravar ficou
 * fora até a F5 (decisão B1-3); na F5 parte D, o Liame ganha as opcionais de
 * rascunho e a de PEDIR o disparo, desligadas até o dono ligar. Pela ligação, o
 * disparo só sai por pedido aprovado aqui (`campanha_disparar` recusa a ligação:
 * `SO_PELO_PEDIDO`), e é isso que a tela promete.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { ESCOPOS } from './integracao.regras';

/** Quanto vale o número do pedido e o código de uso único. */
export const VALIDADE_DO_PEDIDO_MS = 10 * 60_000;
export const VALIDADE_DO_CODIGO_MS = 10 * 60_000;

/** A trava da senha na autorização: 5 erradas em 15 minutos travam por 15 minutos (a entrada na conta não). */
export const MAX_ERROS_SENHA_AUTORIZACAO = 5;
export const MINUTOS_TRAVA_AUTORIZACAO = 15;

/** A versão do texto da tela. Mudou uma frase que o dono lê? Sobe a versão: a prova diz qual ele aceitou. */
export const VERSAO_DO_TEXTO = 2;

/** As permissões de GRAVAR que a página pode liberar (F5 parte D). As outras do catálogo só leem. */
export const PERMISSOES_DE_GRAVAR: readonly string[] = ['modelos.rascunhar', 'campanhas.rascunhar', 'campanhas.disparar'];

/** O pedido (ou a ligação) tem alguma permissão de gravar? */
export const temGravacao = (ids: readonly string[]) => ids.some((id) => PERMISSOES_DE_GRAVAR.includes(id));

/** O prefixo do número do pedido (RFC 9126 §2.2) e o do código de uso único. */
const PREFIXO_DO_PEDIDO = 'urn:ietf:params:oauth:request_uri:rct_';
const PREFIXO_DO_CODIGO = 'rct_ac_';

/** Um aplicativo que pode usar a página: o que a tela mostra dele e o que ele pode pedir. */
export interface AplicativoDaAutorizacao {
  produto: string;
  nome: string;
  /** A abertura da tela: o que o aplicativo faz e o que ele NÃO faz (só o que o servidor garante). */
  faz: string;
  /** A abertura quando o pedido traz permissão de gravar (F5 parte D). Sem ela, vale `faz`. */
  fazComGravacao?: string;
  /** Sem chave na tela: sem elas o aplicativo não funciona. */
  necessarias: readonly string[];
  /** O dono decide; nascem desligadas. */
  opcionais: readonly string[];
  /** O motivo de cada permissão, que o aplicativo declara (Padrão §3). */
  motivos: Readonly<Record<string, string>>;
  /** O que acontece com a opcional desligada. */
  semAOpcional: Readonly<Record<string, string>>;
  /**
   * Como a permissão aparece na tela e no e-mail quando o nome do catálogo diria mais do que a ligação pode. Ex.:
   * `campanhas.disparar` pela ligação só PEDE o disparo (o servidor recusa o disparo direto).
   */
  nomes?: Readonly<Record<string, { rotulo: string; frase: string }>>;
  /** Para onde o código volta: só estes, comparados por inteiro. A variável AUTORIZACAO_ENDERECOS_DE_VOLTA troca a lista. */
  enderecosDeVolta: readonly string[];
  /** O endereço do aplicativo para o "Voltar" de quando o pedido não vale: o cadastrado, nunca um que veio no link. */
  inicio: string;
}

export const APLICATIVOS_DA_AUTORIZACAO: Readonly<Record<string, AplicativoDaAutorizacao>> = {
  liame: {
    produto: 'liame',
    nome: 'Liame',
    faz: 'O Liame mede quais anúncios viraram conversa e venda. Ele só lê o que está listado aqui: não envia mensagem e não muda nada na conta.',
    fazComGravacao:
      'O Liame mede quais anúncios viraram conversa e venda. Se você ligar as opções de campanha, ele também monta campanhas em rascunho e pede o disparo, que só sai quando você, ou quem você autorizou, aprovar aqui.',
    necessarias: ['conta.ler', 'campanhas.ler', 'publicos.ler', 'modelos.ler', 'orcamento.ler'],
    opcionais: ['conversas.anuncio.ler', 'modelos.rascunhar', 'campanhas.rascunhar', 'campanhas.disparar'],
    motivos: {
      'conta.ler': 'Para não propor campanha quando a conta não pode enviar.',
      'campanhas.ler': 'Para comparar o que saiu daqui com o que os anúncios trouxeram.',
      'publicos.ler': 'Para estimar o alcance antes de propor uma campanha.',
      'modelos.ler': 'Para propor campanha só com modelo aprovado pela Meta.',
      'orcamento.ler': 'Para nenhuma proposta passar do teto que você definiu.',
      'conversas.anuncio.ler': 'Para saber qual anúncio trouxe cada conversa.',
      'modelos.rascunhar': 'Para deixar pronto o texto de um modelo novo. Quem envia o modelo para a Meta aprovar é alguém da sua conta, em Modelos.',
      'campanhas.rascunhar': 'Para deixar pronta, em rascunho, a campanha que ele propõe, com o público e o custo estimado.',
      'campanhas.disparar': 'Para pedir o disparo da campanha que ele propôs, sem ninguém digitar tudo de novo. Você aprova aqui, em Para aprovar.',
    },
    semAOpcional: {
      'conversas.anuncio.ler': 'Desligada: o Liame não liga conversa a anúncio. O resto funciona.',
      'modelos.rascunhar': 'Desligada: o Liame não escreve modelo aqui. Ele propõe só com os modelos que você já tem.',
      'campanhas.rascunhar': 'Desligada: o Liame não monta campanha aqui. O resto funciona.',
      'campanhas.disparar': 'Desligada: o Liame não pede disparo. A campanha que ele montar, alguém da sua conta dispara em Campanhas.',
    },
    nomes: {
      'campanhas.disparar': {
        rotulo: 'Pedir o disparo de campanha',
        frase: 'Pedir o disparo de uma campanha que ele montou e pausar as dele. O disparo só sai depois que você, ou quem você autorizou, aprovar aqui.',
      },
    },
    enderecosDeVolta: ['https://api.agencialiame.com/v1/oauth/callback'],
    inicio: 'https://app.agencialiame.com',
  },
};

/** As permissões com telefone ou conteúdo de cliente: num bloco próprio da tela ("Dados dos seus clientes"). */
export const PERMISSOES_COM_DADO_PESSOAL: readonly string[] = ['conversas.anuncio.ler'];

/** O rótulo de uma permissão para este aplicativo: o do catálogo, ou o que o aplicativo pode de verdade (`nomes`). */
export function rotuloNoAplicativo(app: AplicativoDaAutorizacao | undefined, id: string, doCatalogo: string): string {
  return app?.nomes?.[id]?.rotulo ?? doCatalogo;
}

/**
 * O que o aplicativo NÃO pode pela autorização por clique. Só o que o servidor
 * garante: nenhuma permissão do RegemCast entrega nome, telefone da base ou
 * conteúdo de conversa; o rascunho de modelo só muda o que o próprio aplicativo
 * criou e não vai à Meta (`modelo_rascunhar`); a campanha e a pausa, só as dele
 * (`aPropria`); e pela ligação o disparo só sai por pedido aprovado aqui com o
 * código do aplicativo autenticador e o teto de gasto (`SO_PELO_PEDIDO`, F5-1 e
 * F5-6). `grava`: o pedido traz alguma permissão de gravar (ligada ou não).
 */
export function naoPode(nome: string, grava = false): { rotulo: string; frase: string }[] {
  const envio = grava
    ? [
        {
          rotulo: 'Disparar sem a sua aprovação',
          frase: `Cada disparo que o ${nome} pede espera você, ou quem você autorizou, aprovar aqui, com o código do aplicativo autenticador e um teto de gasto. Sem "Pedir o disparo de campanha" ligado, ele nem pede.`,
        },
        {
          rotulo: 'Mexer no que não é dele',
          frase: `Com os rascunhos ligados, o ${nome} só cria rascunhos e muda os que ele mesmo criou. Enviar um modelo para a Meta é com a sua conta.`,
        },
      ]
    : [
        { rotulo: 'Enviar mensagens ou disparar campanhas', frase: 'Esta autorização não inclui envio.' },
        { rotulo: 'Criar ou mudar campanhas e modelos', frase: `O ${nome} só lê.` },
      ];
  return [
    ...envio,
    { rotulo: 'Ver a sua lista de contatos', frase: `Nome e telefone da sua base ficam aqui. O ${nome} vê só quantos são em cada público.` },
    { rotulo: 'Ler o conteúdo das conversas', frase: 'Nem com as conversas por anúncio ligadas.' },
    { rotulo: 'Entrar na sua conta', frase: `O ${nome} não recebe a sua senha nem a sua sessão.` },
  ];
}

// ------------------------------------------------------------------ números e códigos

const resumo = (texto: string) => createHash('sha256').update(texto, 'utf8').digest('hex');

/** Um número de pedido novo (o `request_uri` da RFC 9126). Em claro só na resposta do pedido. */
export function gerarNumeroDoPedido(): { numero: string; resumo: string } {
  const numero = PREFIXO_DO_PEDIDO + randomBytes(32).toString('base64url');
  return { numero, resumo: resumo(numero) };
}

/** O resumo de um número que chegou, ou nulo se ele nem tem a forma de um número nosso. */
export function resumoDoNumero(numero: unknown): string | null {
  if (typeof numero !== 'string' || !/^urn:ietf:params:oauth:request_uri:rct_[A-Za-z0-9_-]{43}$/.test(numero)) return null;
  return resumo(numero);
}

/** Um código de uso único novo. Em claro só no endereço de volta. */
export function gerarCodigo(): { codigo: string; resumo: string } {
  const codigo = PREFIXO_DO_CODIGO + randomBytes(32).toString('base64url');
  return { codigo, resumo: resumo(codigo) };
}

/** O resumo de um código que chegou, ou nulo se ele nem tem a forma de um código nosso. */
export function resumoDoCodigo(codigo: unknown): string | null {
  if (typeof codigo !== 'string' || !/^rct_ac_[A-Za-z0-9_-]{43}$/.test(codigo)) return null;
  return resumo(codigo);
}

/** O verificador PKCE confere com o desafio guardado? S256 em tempo constante; forma da RFC 7636 §4.1. */
export function verificadorConfere(verificador: unknown, desafio: string): boolean {
  if (typeof verificador !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(verificador)) return false;
  const calculado = Buffer.from(createHash('sha256').update(verificador, 'ascii').digest('base64url'));
  const guardado = Buffer.from(desafio);
  return calculado.length === guardado.length && timingSafeEqual(calculado, guardado);
}

// ------------------------------------------------------------------ o pedido

/** Os campos do pedido, como chegam no corpo (formulário da RFC 9126 ou JSON). */
export interface CorpoDoPedido {
  response_type?: unknown;
  client_id?: unknown;
  redirect_uri?: unknown;
  scope?: unknown;
  state?: unknown;
  code_challenge?: unknown;
  code_challenge_method?: unknown;
  conta_nome?: unknown;
  conta_cnpj?: unknown;
  conta_email?: unknown;
  conta_marca?: unknown;
}

/** A conta que pede, no sistema do aplicativo. */
export interface ContaQuePede {
  nome: string;
  cnpj: string | null;
  email: string;
  marca: string | null;
}

export interface PedidoConferido {
  redirectUri: string;
  necessarias: string[];
  opcionais: string[];
  state: string;
  desafio: string;
  contaQuePede: ContaQuePede;
}

const texto = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/**
 * Confere o pedido do aplicativo (o do token do DMS ID). Devolve o que gravar,
 * ou a frase do primeiro campo errado — para quem programa o aplicativo, não
 * para o dono, que nunca vê esta resposta.
 */
export function conferirPedido(
  corpo: CorpoDoPedido,
  app: AplicativoDaAutorizacao,
  clientIdDoToken: string,
  enderecosDeVolta: readonly string[],
): PedidoConferido | { erro: string } {
  if (corpo.response_type !== 'code') return { erro: 'response_type precisa ser "code".' };
  if (corpo.client_id !== undefined && corpo.client_id !== clientIdDoToken) {
    return { erro: 'client_id não é o do token do DMS ID que fez o pedido.' };
  }

  const redirectUri = texto(corpo.redirect_uri);
  if (!enderecosDeVolta.includes(redirectUri)) return { erro: 'redirect_uri não é um endereço de volta cadastrado para este aplicativo.' };

  const pedidas = texto(corpo.scope).split(/\s+/).filter(Boolean);
  if (!pedidas.length) return { erro: 'scope precisa trazer ao menos uma permissão.' };
  if (new Set(pedidas).size !== pedidas.length) return { erro: 'scope tem permissão repetida.' };
  const fora = pedidas.find((p) => !app.necessarias.includes(p) && !app.opcionais.includes(p));
  if (fora) return { erro: `A permissão "${fora}" não pode ser pedida por este aplicativo na autorização por clique.` };
  const naOrdem = (lista: readonly string[]) => ESCOPOS.map((e) => e.id).filter((id) => lista.includes(id) && pedidas.includes(id));

  const state = typeof corpo.state === 'string' ? corpo.state : '';
  if (!/^[\x21-\x7e]{16,200}$/.test(state)) return { erro: 'state precisa ter de 16 a 200 caracteres visíveis.' };
  if (corpo.code_challenge_method !== 'S256') return { erro: 'code_challenge_method precisa ser "S256".' };
  const desafio = typeof corpo.code_challenge === 'string' ? corpo.code_challenge : '';
  if (!/^[A-Za-z0-9_-]{43}$/.test(desafio)) return { erro: 'code_challenge precisa ser o SHA-256 do verificador, em base64url (43 caracteres).' };

  const nome = texto(corpo.conta_nome);
  if (nome.length < 1 || nome.length > 120) return { erro: 'conta_nome precisa ter de 1 a 120 caracteres.' };
  const cnpjBruto = texto(corpo.conta_cnpj);
  const cnpj = cnpjBruto ? cnpjBruto.replace(/[.\-/\s]/g, '') : '';
  if (cnpj && !/^\d{14}$/.test(cnpj)) return { erro: 'conta_cnpj precisa ter 14 dígitos (ou ficar vazio).' };
  const email = texto(corpo.conta_email).toLowerCase();
  if (email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { erro: 'conta_email precisa ser um e-mail.' };
  const marca = texto(corpo.conta_marca);
  if (marca.length > 120) return { erro: 'conta_marca pode ter até 120 caracteres.' };

  return {
    redirectUri,
    necessarias: naOrdem(app.necessarias),
    opcionais: naOrdem(app.opcionais),
    state,
    desafio,
    contaQuePede: { nome, cnpj: cnpj || null, email, marca: marca || null },
  };
}

/** A conta que pede é de outra empresa? Sem CNPJ conta como outra (Padrão §3). */
export function ehOutraEmpresa(cnpjQuePede: string | null, cnpjDaConta: string | null): boolean {
  const so = (v: string | null) => (v ?? '').replace(/\D/g, '');
  return !so(cnpjQuePede) || so(cnpjQuePede) !== so(cnpjDaConta);
}

/** As permissões liberadas: as necessárias e as opcionais que o dono ligou (só as pedidas), na ordem do catálogo. */
export function permissoesLiberadas(pedido: { necessarias: readonly string[]; opcionais: readonly string[] }, ligadas: readonly string[]): string[] {
  const valem = new Set([...pedido.necessarias, ...pedido.opcionais.filter((o) => ligadas.includes(o))]);
  return ESCOPOS.map((e) => e.id).filter((id) => valem.has(id));
}

/**
 * O endereço de volta com os parâmetros (`code` ou `error`, o `state` e o `iss`).
 * Monta pelo `URL`: o endereço cadastrado pode trazer parâmetros dele, que ficam.
 */
export function enderecoDeVolta(redirectUri: string, parametros: Record<string, string>): string {
  const u = new URL(redirectUri);
  for (const [nome, valor] of Object.entries(parametros)) u.searchParams.set(nome, valor);
  return u.toString();
}

/**
 * Confere uma lista de endereços de volta da configuração: https (http só para
 * localhost fora de produção), sem usuário e senha, sem fragmento (LIC-119).
 * Devolve a frase do primeiro errado, ou nulo.
 */
export function enderecoDeVoltaInvalido(endereco: string, producao: boolean): string | null {
  let u: URL;
  try {
    u = new URL(endereco);
  } catch {
    return `"${endereco}" não é um endereço.`;
  }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local && !producao)) return `"${endereco}" precisa ser https.`;
  if (u.username || u.password) return `"${endereco}" não pode ter usuário nem senha.`;
  if (u.hash) return `"${endereco}" não pode ter fragmento (#).`;
  return null;
}
