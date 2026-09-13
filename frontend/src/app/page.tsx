'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { Spinner } from '@/components/ui/spinner';
import { auth } from '@/lib/servicos';

/**
 * Porta de entrada. A sessão é um cookie httpOnly — o navegador não consegue
 * lê-lo, então quem responde "estou logado?" é a API.
 */
export default function Raiz() {
  const router = useRouter();

  useEffect(() => {
    const controle = new AbortController();
    let vivo = true;

    auth
      .eu(controle.signal)
      .then(() => {
        if (vivo) router.replace('/painel');
      })
      .catch(() => {
        if (vivo) router.replace('/entrar');
      });

    return () => {
      vivo = false;
      controle.abort();
    };
  }, [router]);

  return (
    <main id="conteudo" className="grid min-h-screen place-items-center p-6">
      <p className="flex items-center gap-3 text-sm text-tinta-suave">
        <Spinner rotulo={null} />
        Abrindo o RegemCast…
      </p>
    </main>
  );
}
