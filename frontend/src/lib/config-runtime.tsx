/**
 * Endereço da API resolvido em TEMPO DE EXECUÇÃO, não de build.
 *
 * O caminho óbvio seria `NEXT_PUBLIC_API_URL`, mas tudo que começa com
 * `NEXT_PUBLIC_` é substituído no bundle **durante o build**. Isso traz dois
 * problemas de operação:
 *
 * 1. Se o valor não chegar ao build — e no EasyPanel ele depende de a variável
 *    da aba Environment virar `ARG` no Dockerfile —, a falha é **silenciosa**:
 *    o bundle sai com `localhost`, a tela carrega normalmente e só o login
 *    quebra, sem erro que aponte a causa.
 * 2. Trocar o domínio da API exige **rebuildar a imagem**, não reiniciar o
 *    container.
 *
 * Aqui o `layout.tsx` (Server Component) lê a variável no servidor, a cada
 * inicialização, e injeta o valor na página. O cliente lê dali. Trocar a
 * variável e reiniciar basta.
 *
 * `NEXT_PUBLIC_API_URL` continua funcionando como reserva, para quem roda
 * `next dev` sem nada configurado.
 */

const PADRAO_DEV = 'http://localhost:3010/api/v1';
/** Endereço público DESTE site. Usado como base das URLs absolutas do metadata. */
const PADRAO_APP_DEV = 'http://localhost:3011';

/** Chave no `window`. Prefixada para não colidir com nada de biblioteca. */
export const CHAVE_CONFIG = '__REGEMCAST_CONFIG__';

export interface ConfigRuntime {
  apiUrl: string;
  /** Base pública do site, para montar URL absoluta de OG image e afins. */
  appUrl: string;
}

declare global {
  interface Window {
    [CHAVE_CONFIG]?: ConfigRuntime;
  }
}

/** Roda no servidor: lê o ambiente do processo. */
export function configDoServidor(): ConfigRuntime {
  const api = process.env.API_URL_PUBLICA ?? process.env.NEXT_PUBLIC_API_URL ?? PADRAO_DEV;
  const app = process.env.APP_URL_PUBLICA ?? PADRAO_APP_DEV;
  return {
    apiUrl: api.trim().replace(/\/+$/, ''),
    appUrl: app.trim().replace(/\/+$/, ''),
  };
}

/**
 * Roda no navegador: lê o que o servidor injetou. Em Server Component (onde
 * `window` não existe) cai para o ambiente do processo, que é o mesmo valor.
 */
export function configDoCliente(): ConfigRuntime {
  if (typeof window !== 'undefined') {
    const injetada = window[CHAVE_CONFIG];
    if (injetada?.apiUrl) return injetada;
  }
  return configDoServidor();
}

/**
 * Tag que leva a configuração até o navegador.
 *
 * `JSON.stringify` já escapa aspas e barras; o `replace` de `<` cobre o único
 * caso que ele não cobre — a sequência `</script>` dentro de uma string, que
 * fecharia a tag no meio. O valor vem de variável de ambiente do servidor, não
 * de entrada de usuário, mas escapar é barato e a regra vale sempre.
 */
export function ConfigRuntimeScript() {
  const json = JSON.stringify(configDoServidor()).replace(/</g, '\\u003c');
  return (
    <script
      // O conteúdo é gerado aqui, a partir do ambiente do servidor.
      dangerouslySetInnerHTML={{ __html: `window.${CHAVE_CONFIG}=${json};` }}
    />
  );
}
