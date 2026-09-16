import { Logotipo } from './logotipo';

/**
 * Tela de espera com a marca: o pulso correndo pelo balão.
 *
 * Aparece nos primeiros instantes (conferindo a sessão, abrindo o app). É a
 * primeira coisa que a pessoa vê, então é a marca — e não um spinner genérico.
 */
export function CarregandoMarca({ texto }: { texto: string }) {
  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-lateral p-6">
      <div aria-hidden="true" className="fundo-pontos-claro absolute inset-0" />
      <div
        aria-hidden="true"
        className="anima-aurora absolute left-1/2 top-1/2 h-96 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full bg-acento/15 blur-3xl"
      />
      <div className="relative flex flex-col items-center gap-5" role="status">
        <span className="relative grid place-items-center">
          <span aria-hidden="true" className="ponto-vivo absolute h-14 w-14 rounded-full text-acento/30" />
          <Logotipo sobreEscuro animado tamanho="lg" mostrarNome={false} />
        </span>
        <p className="text-sm text-lateral-suave">{texto}</p>
      </div>
    </div>
  );
}
