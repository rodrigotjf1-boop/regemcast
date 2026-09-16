/**
 * O loader da marca, do kit (`animacoes/02-loader-disparo`).
 *
 * Usado só onde existe uma espera de VERDADE — o disparo de uma campanha, que
 * fala com a Meta uma vez por destinatário. Num carregamento de meio segundo
 * ele seria enfeite, e enfeite que pisca é ruído.
 *
 * `.webm` com alfa (13 KB) e `.gif` de reserva para quem não reproduz VP9. O
 * vídeo é decorativo: fica fora da árvore de acessibilidade, e o texto ao lado
 * é quem conta o que está acontecendo.
 *
 * `prefers-reduced-motion` não é tratado aqui por escolha de CSS, e sim porque
 * quem usa este componente mostra o texto junto — a informação nunca depende do
 * movimento.
 */
export function LoaderDisparo({ rotulo }: { rotulo: string }) {
  return (
    <div className="flex items-center gap-3">
      <video
        className="h-10 w-10 shrink-0"
        autoPlay
        loop
        muted
        playsInline
        aria-hidden
        poster="/marca/simbolo.svg"
      >
        <source src="/marca/loader-disparo.webm" type="video/webm" />
        {/* Reserva para quem não reproduz VP9 com alfa. Precisa ser <img> cru:
            o conteúdo de reserva de <video> é lido pelo navegador antes de o
            React montar, e next/image não existe nesse momento. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/marca/loader-disparo.gif" alt="" className="h-10 w-10" />
      </video>
      <p className="text-sm text-tinta-suave" role="status">
        {rotulo}
      </p>
    </div>
  );
}
