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
