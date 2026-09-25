/**
 * Ícones da navegação.
 *
 * Inline e à mão, em vez de biblioteca: são seis desenhos, e uma dependência
 * de ícones traz milhares — junto com um peso que a tela de login paga sem
 * usar nenhum deles.
 *
 * Todos herdam `currentColor` e têm o mesmo traço (1,6), o mesmo quadro (24) e
 * a mesma densidade visual. Ícone que destoa em peso chama atenção para si e
 * desorganiza a fileira inteira.
 *
 * O do WhatsApp é um balão GENÉRICO, de propósito: a regra de marca do kit
 * mantém o logotipo da Meta fora da nossa interface.
 */

type Props = { className?: string };

function Base({ className, children }: Props & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className ?? 'h-4 w-4'}
    >
      {children}
    </svg>
  );
}

/** Painel: indicadores. */
export function IconePainel(p: Props) {
  return (
    <Base {...p}>
      <rect x="3" y="3" width="7" height="8" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="11" width="7" height="10" rx="1.5" />
    </Base>
  );
}

/** Conexão: um balão de conversa genérico. */
export function IconeConversa(p: Props) {
  return (
    <Base {...p}>
      <path d="M21 11.5a8 8 0 0 1-11.6 7.1L4 20l1.4-5A8 8 0 1 1 21 11.5Z" />
    </Base>
  );
}

/** Conversas: dois balões, um respondendo o outro. */
export function IconeBalao(p: Props) {
  return (
    <Base {...p}>
      <path d="M15 9.5a5.5 5.5 0 0 1-8 4.9L3.5 15.5l1-3.2A5.5 5.5 0 1 1 15 9.5Z" />
      <path d="M17.6 8.3A5.5 5.5 0 0 1 19.5 17l1 3.2-3.5-1.1a5.5 5.5 0 0 1-6.3-1.4" />
    </Base>
  );
}

/** Modelos: um documento com linhas. */
export function IconeModelo(p: Props) {
  return (
    <Base {...p}>
      <path d="M6 3h8l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      <path d="M14 3v4h4" />
      <path d="M8.5 12.5h7M8.5 16.5h4.5" />
    </Base>
  );
}

/** Contatos: duas pessoas. */
export function IconeContatos(p: Props) {
  return (
    <Base {...p}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19.5a5.5 5.5 0 0 1 11 0" />
      <path d="M16 5.5a3 3 0 0 1 0 5.8M17.5 19.5a5.5 5.5 0 0 0-2.2-4.4" />
    </Base>
  );
}

/** Campanhas: disparo. */
export function IconeCampanha(p: Props) {
  return (
    <Base {...p}>
      <path d="M21 3 10.5 13.5" />
      <path d="M21 3l-6.8 18-3.7-7.5L3 9.8 21 3Z" />
    </Base>
  );
}

/** Conta: engrenagem simplificada. */
export function IconeConta(p: Props) {
  return (
    <Base {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 14.5a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5v.2a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H2a2 2 0 1 1 0-4h.2a1.6 1.6 0 0 0 1.4-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H8a1.6 1.6 0 0 0 1-1.5V2a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 1 1.4 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V8a1.6 1.6 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.4 1Z" />
    </Base>
  );
}

/** Sair. */
export function IconeSair(p: Props) {
  return (
    <Base {...p}>
      <path d="M15 17l5-5-5-5" />
      <path d="M20 12H9" />
      <path d="M12 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h6" />
    </Base>
  );
}

/** Seta para baixo, do menu do usuário. */
export function IconeSeta(p: Props) {
  return (
    <Base {...p}>
      <path d="m6 9 6 6 6-6" />
    </Base>
  );
}

/** Mais: criar algo novo. */
export function IconeMais(p: Props) {
  return (
    <Base {...p}>
      <path d="M12 5v14M5 12h14" />
    </Base>
  );
}

/** Seta para a direita: seguir para o detalhe. */
export function IconeSetaDireita(p: Props) {
  return (
    <Base {...p}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </Base>
  );
}

/** Seta para a esquerda: voltar. */
export function IconeVoltar(p: Props) {
  return (
    <Base {...p}>
      <path d="M19 12H5M11 18l-6-6 6-6" />
    </Base>
  );
}

/** Atualizar: duas setas em círculo. */
export function IconeAtualizar(p: Props) {
  return (
    <Base {...p}>
      <path d="M20 11a8 8 0 0 0-14.3-4.9L4 8" />
      <path d="M4 4v4h4" />
      <path d="M4 13a8 8 0 0 0 14.3 4.9L20 16" />
      <path d="M20 20v-4h-4" />
    </Base>
  );
}

/** Confirmado. */
export function IconeCheck(p: Props) {
  return (
    <Base {...p}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </Base>
  );
}

/** Dois tiques: entregue (e, destacado, lida). */
export function IconeCheckDuplo(p: Props) {
  return (
    <Base {...p}>
      <path d="m2.5 12.5 4.5 4.5 9.5-9.5" />
      <path d="m11.5 16.5.5.5 9.5-9.5" />
    </Base>
  );
}

/** Relógio: agendado, janela de envio. */
export function IconeRelogio(p: Props) {
  return (
    <Base {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </Base>
  );
}

/** Menu (três linhas), para abrir a navegação no celular. */
export function IconeMenu(p: Props) {
  return (
    <Base {...p}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Base>
  );
}

/** Fechar. */
export function IconeFechar(p: Props) {
  return (
    <Base {...p}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Base>
  );
}

/** Atenção. */
export function IconeAlerta(p: Props) {
  return (
    <Base {...p}>
      <path d="M12 3.5 21.5 20h-19L12 3.5Z" />
      <path d="M12 10v4.5M12 17.2v.1" />
    </Base>
  );
}

/** Telefone celular. */
export function IconeCelular(p: Props) {
  return (
    <Base {...p}>
      <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
      <path d="M10.5 18.5h3" />
    </Base>
  );
}

/** Escudo: segurança, verificação. */
export function IconeEscudo(p: Props) {
  return (
    <Base {...p}>
      <path d="M12 3 19.5 6v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6L12 3Z" />
      <path d="m9 12 2.2 2.2L15.5 10" />
    </Base>
  );
}

/** Gráfico de linha: desempenho. */
export function IconeGrafico(p: Props) {
  return (
    <Base {...p}>
      <path d="M3.5 20.5h17" />
      <path d="m5 15 4.5-4.5 3.5 3.5L19.5 7.5" />
      <path d="M15 7.5h4.5V12" />
    </Base>
  );
}

/** Olho: lida. */
export function IconeOlho(p: Props) {
  return (
    <Base {...p}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.8" />
    </Base>
  );
}

/** Upload: importar arquivo. */
export function IconeImportar(p: Props) {
  return (
    <Base {...p}>
      <path d="M12 15.5V3.5M7 8.5l5-5 5 5" />
      <path d="M4 14.5v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
    </Base>
  );
}

/** Raio: energia, velocidade de envio. */
export function IconeRaio(p: Props) {
  return (
    <Base {...p}>
      <path d="M13 2.5 4.5 13.5H12l-1 8 8.5-11H12l1-8Z" />
    </Base>
  );
}

/** Lixeira. */
export function IconeLixeira(p: Props) {
  return (
    <Base {...p}>
      <path d="M4.5 6.5h15M9.5 6.5V4.5h5v2M6.5 6.5l1 13a1.5 1.5 0 0 0 1.5 1.5h6a1.5 1.5 0 0 0 1.5-1.5l1-13" />
    </Base>
  );
}

/** Cartão: plano e pagamento. */
export function IconeCartao(p: Props) {
  return (
    <Base {...p}>
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      <path d="M2.5 10h19M6.5 15h4" />
    </Base>
  );
}

/** Lápis: editar. */
export function IconeEditar(p: Props) {
  return (
    <Base {...p}>
      <path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
      <path d="m14.5 7.5 3 3" />
    </Base>
  );
}

/** Blocos: a base fatiada em partes iguais. */
export function IconeBlocos(p: Props) {
  return (
    <Base {...p}>
      <rect x="3" y="4" width="18" height="4" rx="1.2" />
      <rect x="3" y="10" width="18" height="4" rx="1.2" />
      <rect x="3" y="16" width="11" height="4" rx="1.2" />
    </Base>
  );
}

/** Tomada: integrações — o Regemcast ligado a outro sistema. */
export function IconeIntegracao(p: Props) {
  return (
    <Base {...p}>
      <path d="M9 3v4M15 3v4" />
      <path d="M6.5 7h11v3.5a5.5 5.5 0 0 1-11 0V7Z" />
      <path d="M12 16v5" />
    </Base>
  );
}

/** Mapa: regiões pelo DDD. */
export function IconeMapa(p: Props) {
  return (
    <Base {...p}>
      <path d="M12 21s-6.5-5.4-6.5-11a6.5 6.5 0 0 1 13 0c0 5.6-6.5 11-6.5 11Z" />
      <circle cx="12" cy="10" r="2.3" />
    </Base>
  );
}
