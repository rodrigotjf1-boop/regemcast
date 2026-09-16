'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { CarregandoMarca } from '@/components/marca/carregando-marca';
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

  return <CarregandoMarca texto="Abrindo o RegemCast…" />;
}
