import type { Metadata } from 'next';
import Link from 'next/link';

import { Logotipo } from '@/components/marca/logotipo';

/**
 * Política de privacidade.
 *
 * Existe por três motivos, nesta ordem: é obrigação legal (LGPD), é
 * pré-requisito do App Review da Meta, e é o documento que explica a distinção
 * que sustenta o produto — o Regemcast é **operador** dos contatos que o
 * cliente carrega, e **controlador** apenas dos dados de quem usa o painel.
 * Quem confunde esses dois papéis escreve política errada e responde por dado
 * que não é seu.
 *
 * A data de vigência é fixa, escrita à mão, e muda quando o texto muda. Gerar
 * com `new Date()` faria a página anunciar revisão que não houve.
 */

const ATUALIZADO_EM = '29 de setembro de 2026';
const CONTROLADOR = 'DMS Tecnologias';
const EMAIL = 'suporte@dmsregem.com';

export const metadata: Metadata = {
  title: 'Política de privacidade',
  description:
    'Como o Regemcast trata dados pessoais — de quem usa o painel e dos contatos carregados pelos clientes.',
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

export default function PoliticaDePrivacidade() {
  return (
    <div className="min-h-screen bg-fundo">
      <header className="border-b border-borda bg-superficie">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
          <Link href="/" aria-label="Início">
            <Logotipo />
          </Link>
          <Link
            href="/entrar"
            className="text-sm font-medium text-acento-forte underline decoration-acento decoration-2 underline-offset-4 hover:decoration-4"
          >
            Entrar
          </Link>
        </div>
      </header>

      <main id="conteudo" className="mx-auto max-w-3xl space-y-10 px-5 py-10 sm:py-14">
        <div className="space-y-3">
          <h1 className="text-2xl font-bold tracking-tight text-tinta sm:text-3xl">
            Política de privacidade
          </h1>
          <p className="text-sm text-tinta-suave">
            Em vigor desde {ATUALIZADO_EM}. Controlador: {CONTROLADOR}.
          </p>
        </div>

        <div className="rounded-card border border-borda bg-superficie p-5 text-sm leading-relaxed text-tinta-suave">
          <p>
            <strong className="text-tinta">Resumo em uma frase:</strong> o Regemcast guarda os
            dados de quem usa o painel e, separadamente, processa os contatos que cada cliente
            carrega — esses contatos pertencem ao cliente, não a nós, e só são usados para as
            campanhas que ele mesmo dispara.
          </p>
        </div>

        <Secao titulo="1. Quem somos">
          <p>
            O Regemcast é um serviço de {CONTROLADOR} para envio de campanhas por mensagem, com
            integração via API Oficial do WhatsApp Business.
          </p>
          <p>
            Para dúvidas sobre esta política ou para exercer qualquer direito descrito aqui,
            escreva para{' '}
            <a
              href={`mailto:${EMAIL}`}
              className="font-medium text-acento-forte underline decoration-acento decoration-2 underline-offset-4 hover:decoration-4"
            >
              {EMAIL}
            </a>
            .
          </p>
        </Secao>

        <Secao titulo="2. Dois grupos de dados, dois papéis diferentes">
          <p>
            Esta distinção é o ponto mais importante do documento, porque ela define de quem é
            cada dado e quem responde por ele.
          </p>
          <p>
            <strong className="text-tinta">
              (a) Dados de quem usa o painel — aqui somos o controlador.
            </strong>{' '}
            São os dados da empresa cliente e das pessoas que acessam a conta: nome, e-mail,
            senha (guardada apenas como hash), telefone de contato, dados da empresa e registros
            de uso do sistema. Decidimos por que e como tratamos esses dados, e respondemos por
            eles.
          </p>
          <p>
            <strong className="text-tinta">
              (b) Contatos carregados pelo cliente — aqui somos apenas o operador.
            </strong>{' '}
            São as listas de contatos que cada cliente importa ou cadastra para disparar suas
            campanhas: número de telefone, nome e os atributos que ele mesmo escolher incluir.
            Esses dados pertencem ao cliente. Nós os processamos <em>sob instrução dele</em> e
            para nenhuma outra finalidade.
          </p>
          <p>
            Em termos práticos: nós <strong className="text-tinta">não</strong> usamos os
            contatos de um cliente para nada além das campanhas que ele dispara. Não os
            vendemos, não os compartilhamos com outros clientes, não os usamos para treinar
            nada, não os agregamos a base própria.
          </p>
        </Secao>

        <Secao titulo="3. Consentimento de quem recebe as mensagens">
          <p>
            Cada cliente declara, ao cadastrar ou importar contatos, que possui autorização
            dessas pessoas para enviar mensagens. Essa declaração fica registrada com data,
            hora, origem e quem a fez.
          </p>
          <p>
            A responsabilidade por obter e comprovar esse consentimento é do cliente, que é o
            controlador desses dados. O Regemcast fornece as ferramentas de registro e honra
            pedidos de descadastramento, mas não tem como verificar por conta própria a origem
            de cada autorização.
          </p>
          <p>
            Quem recebe uma mensagem e quer parar de recebê-la pode responder pedindo a saída,
            usar o botão de descadastro da própria mensagem, ou escrever para {EMAIL}. O bloqueio
            é permanente e vale para todas as campanhas daquele cliente — o sistema recusa o
            envio no momento do disparo, não apenas na montagem da lista.
          </p>
        </Secao>

        <Secao titulo="4. Dados obtidos pela integração com a Meta">
          <p>
            Quando um cliente conecta a própria conta do WhatsApp Business, recebemos da Meta:
            o identificador da conta comercial, o identificador e o número de telefone
            comercial, a credencial de acesso que permite enviar em nome dele, e os eventos de
            entrega das mensagens — enviada, entregue, lida ou com falha, e o motivo da falha.
          </p>
          <p>
            Usamos esses dados exclusivamente para operar o serviço contratado: enviar as
            campanhas do cliente, mostrar o resultado delas e manter a conta dele em
            conformidade com as regras da plataforma. As credenciais são guardadas cifradas e
            nunca são exibidas, nem para o próprio cliente.
          </p>
          <p>
            <strong className="text-tinta">
              Quando o cliente escolhe manter o WhatsApp Business no celular
            </strong>{' '}
            — o que a Meta chama de coexistência —, a plataforma também nos envia, com
            autorização dele dada na própria janela da Meta: a lista de contatos do WhatsApp
            daquele número e o histórico de conversas dos{' '}
            <strong className="text-tinta">últimos 180 dias</strong>, além de uma cópia das
            mensagens que ele enviar pelo aplicativo dali em diante. Isso existe para que o
            atendimento pelo celular e as campanhas enviadas por aqui sejam a mesma conversa,
            e não duas histórias separadas.
          </p>
          <p>
            Sobre esses dados somos <strong className="text-tinta">operador</strong>: eles
            pertencem ao cliente e às pessoas que conversaram com ele. Guardamos para operar o
            serviço, não usamos para nenhuma outra finalidade e apagamos junto com a conta,
            conforme o prazo da seção 6. O cliente pode recusar o compartilhamento na janela da
            Meta — nesse caso a conexão continua funcionando para enviar campanhas, apenas sem
            contatos e histórico trazidos do celular.
          </p>
          <p>
            Não usamos dados da Meta para publicidade, não os transferimos para terceiros e não
            os cruzamos com dados de outros clientes.
          </p>
        </Secao>

        <Secao titulo="5. Com quem compartilhamos">
          <p>Apenas com quem é necessário para o serviço funcionar:</p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong className="text-tinta">Meta Platforms</strong> — para entregar as mensagens
              pelo WhatsApp. É o destino final do envio.
            </li>
            <li>
              <strong className="text-tinta">Mercado Pago</strong> — para cobrar a assinatura do
              plano. O pagamento é feito na página do Mercado Pago; nós não recebemos nem guardamos
              dados de cartão.
            </li>
            <li>
              <strong className="text-tinta">Google (Firebase Cloud Messaging)</strong> — para
              entregar os avisos no aplicativo Android. Recebe apenas o identificador do aparelho
              e o texto do aviso.
            </li>
            <li>
              <strong className="text-tinta">Resend</strong> — para enviar e-mails do sistema, como
              códigos de verificação e convites.
            </li>
            <li>
              <strong className="text-tinta">Provedores de infraestrutura</strong> — banco de
              dados e servidores onde o sistema roda, sob contrato e sem acesso ao conteúdo para
              finalidade própria.
            </li>
            <li>
              <strong className="text-tinta">Autoridades</strong> — quando houver ordem legal,
              limitada ao que for exigido.
            </li>
          </ul>
          <p>Não vendemos dados pessoais. Nunca.</p>
        </Secao>

        <Secao titulo="6. Por quanto tempo guardamos">
          <p>
            Dados da conta ficam enquanto ela existir. Encerrada a conta, removemos os dados em
            até 90 dias, exceto o que a lei mandar guardar.
          </p>
          <p>
            Contatos e campanhas ficam enquanto o cliente quiser — ele pode apagá-los a qualquer
            momento pelo painel. O registro de que uma mensagem foi enviada a um número, e de
            que houve consentimento declarado, é mantido mesmo após a exclusão do contato: é a
            prova que protege tanto o cliente quanto quem recebeu a mensagem, em caso de
            questionamento.
          </p>
          <p>
            Registros de auditoria (quem fez o quê, quando) são mantidos por 5 anos e não podem
            ser alterados nem apagados, nem por nós.
          </p>
        </Secao>

        <Secao titulo="7. Segurança">
          <p>
            Os dados de cada conta são isolados no banco por controle de acesso em nível de
            linha, aplicado pelo próprio banco de dados e não apenas pelo código — uma consulta
            que esqueça o filtro não retorna dado de outra conta, retorna vazio.
          </p>
          <p>
            Senhas são guardadas apenas como hash (Argon2id) e não podem ser revertidas.
            Credenciais de integração são cifradas em repouso. Todo o tráfego é por HTTPS com
            verificação de certificado. Toda alteração relevante fica registrada em trilha
            imutável.
          </p>
          <p>
            Nenhuma medida elimina risco por completo. Em caso de incidente com risco relevante
            aos titulares, comunicaremos os afetados e a autoridade competente, conforme a lei.
          </p>
        </Secao>

        <Secao titulo="8. Seus direitos">
          <p>
            A Lei Geral de Proteção de Dados (Lei 13.709/2018) garante a você: confirmação de
            que tratamos seus dados, acesso a eles, correção do que estiver errado ou
            incompleto, anonimização ou eliminação do que for desnecessário, portabilidade,
            informação sobre com quem compartilhamos, e revogação do consentimento.
          </p>
          <p>
            Escreva para {EMAIL} e respondemos em até 15 dias. Se o pedido for sobre mensagens
            que você recebeu de uma empresa que usa o Regemcast, vamos encaminhá-lo a essa
            empresa — ela é a controladora desses dados —, e também registraremos seu
            descadastramento imediatamente, de nossa parte.
          </p>
        </Secao>

        <Secao titulo="9. Cookies">
          <p>
            Usamos um único cookie, de sessão, para manter você conectado ao painel. Ele é
            <code className="mx-1 rounded bg-superficie-2 px-1.5 py-0.5 font-mono text-xs text-acento-forte">
              httpOnly
            </code>
            (não pode ser lido por script), só trafega por HTTPS e expira. Não usamos cookies de
            publicidade nem de rastreamento de terceiros.
          </p>
        </Secao>

        <Secao titulo="10. Aplicativo para Android">
          <p>
            O aplicativo do Regemcast usa a mesma conta do painel e trata os mesmos dados. Além
            deles, trata apenas:
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong className="text-tinta">Identificador de avisos do aparelho</strong> (token
              do Firebase Cloud Messaging), o modelo do aparelho e a versão do aplicativo — para
              enviar avisos de campanha, de modelo e de cobrança. Ao sair da conta no aplicativo,
              o identificador é apagado. Quais avisos chegam é escolha sua, no próprio aplicativo.
            </li>
            <li>
              <strong className="text-tinta">Sessão</strong> — guardada no cofre do próprio Android
              e válida por 30 dias.
            </li>
            <li>
              <strong className="text-tinta">Biometria</strong> — quando você liga a abertura por
              digital ou rosto, a conferência é feita pelo próprio Android. Nenhum dado biométrico
              sai do aparelho ou chega até nós.
            </li>
            <li>
              <strong className="text-tinta">Arquivos de contatos</strong> — o arquivo que você
              escolhe para importar é enviado ao servidor só para ler os números. Ele não é
              guardado; ficam apenas os contatos que você confirmar.
            </li>
            <li>
              <strong className="text-tinta">Imagens, vídeos e documentos dos modelos</strong> — o
              arquivo que você escolhe no celular para o cabeçalho de um modelo, ou para um cartão
              do carrossel, é enviado ao servidor e guardado na sua conta, como acontece no painel.
              Ele segue para a Meta quando o modelo vai para aprovação. O aplicativo só abre a
              galeria ou os arquivos quando você toca em escolher, e não lê mais nada do aparelho.
            </li>
          </ul>
          <p>
            O aplicativo não usa localização, câmera, microfone nem a agenda do celular, e não tem
            anúncios nem rastreamento de terceiros.
          </p>
        </Secao>

        <Secao titulo="11. Exclusão da conta">
          <p>
            O dono da conta pode pedir a exclusão da conta e dos dados a qualquer momento. O passo
            a passo e o que é mantido por obrigação legal estão em{' '}
            <Link href="/excluir-conta" className="font-medium text-acento-forte underline">
              cast.dmsregem.com/excluir-conta
            </Link>
            .
          </p>
        </Secao>

        <Secao titulo="12. Crianças e adolescentes">
          <p>
            O Regemcast é uma ferramenta de trabalho, destinada a empresas. Não é dirigido a
            menores de 18 anos e não coletamos dados de crianças e adolescentes de forma
            intencional.
          </p>
        </Secao>

        <Secao titulo="13. Mudanças nesta política">
          <p>
            Se mudarmos este texto de forma relevante, avisamos os clientes por e-mail ou pelo
            painel antes de a mudança valer. A data no topo indica desde quando esta versão está
            em vigor.
          </p>
        </Secao>

        <footer className="border-t border-borda pt-6 text-sm text-tinta-suave">
          <p>
            {CONTROLADOR} · {EMAIL}
          </p>
          <p className="mt-1">
            Integração via API Oficial do WhatsApp Business. WhatsApp é marca da Meta Platforms,
            Inc., sem relação de patrocínio ou endosso com este serviço.
          </p>
        </footer>
      </main>
    </div>
  );
}
