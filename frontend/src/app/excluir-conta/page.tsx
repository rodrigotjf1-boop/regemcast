import type { Metadata } from 'next';
import Link from 'next/link';

import { Logotipo } from '@/components/marca/logotipo';

/**
 * Como pedir a exclusão da conta e dos dados.
 *
 * Página pública e sem login de propósito: a Google Play exige um endereço
 * onde qualquer pessoa descubra como apagar a conta — inclusive quem já
 * desinstalou o aplicativo e não consegue mais entrar. Diz também o que NÃO é
 * apagado, e por quê: prometer "apagamos tudo" e guardar a trilha de auditoria
 * seria mentir na ficha da loja.
 */

const EMAIL = 'suporte@dmsregem.com';

export const metadata: Metadata = {
  title: 'Excluir conta',
  description: 'Como pedir a exclusão da conta do Regemcast e dos dados, e o que é mantido por lei.',
  robots: { index: true, follow: true },
};

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold tracking-tight text-tinta">{titulo}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-tinta-suave">{children}</div>
    </section>
  );
}

export default function ExcluirConta() {
  return (
    <div className="min-h-screen bg-fundo">
      <header className="border-b border-borda bg-superficie">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
          <Link href="/" aria-label="Início">
            <Logotipo />
          </Link>
          <Link
            href="/privacidade"
            className="text-sm font-medium text-acento-forte underline decoration-acento decoration-2 underline-offset-4 hover:decoration-4"
          >
            Política de privacidade
          </Link>
        </div>
      </header>

      <main id="conteudo" className="mx-auto max-w-3xl space-y-10 px-5 py-10 sm:py-14">
        <div className="space-y-3">
          <h1 className="text-2xl font-bold tracking-tight text-tinta sm:text-3xl">
            Excluir a conta do Regemcast
          </h1>
          <p className="text-sm text-tinta-suave">
            Vale para o painel (cast.dmsregem.com) e para o aplicativo Android, que usam a mesma
            conta.
          </p>
        </div>

        <Secao titulo="Como pedir">
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              Se houver plano pago, cancele a renovação em <strong className="text-tinta">Plano e
              pagamento</strong> (no painel ou no aplicativo) para não haver nova cobrança.
            </li>
            <li>
              Escreva para{' '}
              <a href={`mailto:${EMAIL}?subject=Excluir%20conta%20Regemcast`} className="font-medium text-acento-forte underline">
                {EMAIL}
              </a>{' '}
              a partir do e-mail do <strong className="text-tinta">dono da conta</strong>, com o
              assunto &quot;Excluir conta Regemcast&quot; e o nome da empresa.
            </li>
            <li>
              Respondemos em até 15 dias para confirmar o pedido. Confirmado, a conta é encerrada
              na hora — ninguém mais entra — e os dados são removidos em até 90 dias.
            </li>
          </ol>
          <p>
            Quer remover só o acesso de uma pessoa da equipe? O dono faz isso na hora, em{' '}
            <strong className="text-tinta">Usuários</strong>, sem precisar escrever para nós. Uma
            pessoa da equipe que queira apagar os próprios dados pode escrever para o mesmo
            e-mail.
          </p>
        </Secao>

        <Secao titulo="O que é apagado">
          <ul className="list-disc space-y-2 pl-5">
            <li>Os dados da empresa e de todas as pessoas com acesso à conta.</li>
            <li>Contatos, listas, modelos salvos, campanhas e o histórico de envio.</li>
            <li>A conexão com o WhatsApp e a credencial de acesso guardada.</li>
            <li>Os aparelhos registrados para avisos no aplicativo.</li>
          </ul>
        </Secao>

        <Secao titulo="O que é mantido, e por quanto tempo">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong className="text-tinta">Registro de pagamentos</strong> — pelo prazo que a lei
              fiscal exige.
            </li>
            <li>
              <strong className="text-tinta">Trilha de auditoria</strong> (quem fez o quê, e
              quando) — por 5 anos, sem possibilidade de alteração.
            </li>
            <li>
              <strong className="text-tinta">Prova de envio e de consentimento declarado</strong> —
              o registro de que uma mensagem foi enviada a um número e de que havia autorização.
              Protege a empresa e quem recebeu a mensagem em caso de questionamento.
            </li>
          </ul>
          <p>
            O número de WhatsApp e os modelos aprovados continuam na conta da sua empresa na Meta:
            são seus, e não dependem do Regemcast.
          </p>
        </Secao>

        <footer className="border-t border-borda pt-6 text-sm text-tinta-suave">
          <p>DMS Tecnologias · {EMAIL}</p>
        </footer>
      </main>
    </div>
  );
}
