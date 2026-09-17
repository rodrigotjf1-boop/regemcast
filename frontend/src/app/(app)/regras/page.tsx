import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import {
  IconeAlerta,
  IconeCelular,
  IconeCheck,
  IconeEscudo,
  IconeGrafico,
  IconeModelo,
  IconeOlho,
} from '@/components/app/icones';
import { CabecalhoPagina } from '@/components/ui/cabecalho-pagina';

export const metadata: Metadata = { title: 'Regras da Meta' };

/**
 * Regras da Meta para o WhatsApp oficial.
 *
 * Existe porque quase todo "o sistema travou" de produto de disparo é, na
 * verdade, uma regra da Meta: limite de 250 pessoas, número recém-criado
 * recusado na conexão, modelo de marketing não entregue. Quem conhece a regra
 * antes planeja; quem descobre no meio da campanha acha que o produto falhou.
 *
 * Cada item diz de quem é: **Regra da Meta** (obrigatória, e quem decide é ela)
 * ou **Recomendação** (prática nossa para não esbarrar nas regras). Misturar as
 * duas faria uma sugestão parecer obrigação — ou o contrário, que é pior.
 *
 * Os números vêm da documentação oficial da Meta (links no fim da página),
 * conferida em setembro de 2026. A Meta muda essas regras; quando mudar, esta
 * página muda junto — e a data abaixo também.
 */

const CONFERIDO_EM = 'setembro de 2026';

const SECOES = [
  { id: 'numero', titulo: 'Número' },
  { id: 'verificacao', titulo: 'Verificação' },
  { id: 'limite', titulo: 'Limite de envio' },
  { id: 'qualidade', titulo: 'Qualidade' },
  { id: 'consentimento', titulo: 'Consentimento' },
  { id: 'modelos', titulo: 'Modelos e cobrança' },
  { id: 'boas-praticas', titulo: 'Boas práticas' },
];

const DEGRAUS = [
  { valor: '250', rotulo: 'início' },
  { valor: '2 mil', rotulo: 'verificação ou volume' },
  { valor: '10 mil', rotulo: '' },
  { valor: '100 mil', rotulo: '' },
  { valor: 'Ilimitado', rotulo: '' },
];

const FONTES = [
  {
    titulo: 'Limites de mensagens',
    url: 'https://developers.facebook.com/docs/whatsapp/messaging-limits',
  },
  {
    titulo: 'Conectar número do app WhatsApp Business (coexistência)',
    url: 'https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users',
  },
  {
    titulo: 'Qualidade do número de telefone',
    url: 'https://www.facebook.com/business/help/896873687365001',
  },
  { titulo: 'Política de Mensagens do WhatsApp Business', url: 'https://whatsappbusiness.com/pt-br/policy/' },
  { titulo: 'Preços da plataforma', url: 'https://developers.facebook.com/docs/whatsapp/pricing' },
  {
    titulo: 'Limite de mensagens de marketing por pessoa',
    url: 'https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/marketing-templates/per-user-limits',
  },
];

export default function PaginaRegras() {
  return (
    <div className="space-y-6 lg:space-y-8">
      <CabecalhoPagina
        icone={<IconeEscudo />}
        sobretitulo="Ajuda"
        titulo="Regras da Meta"
        descricao="O que a Meta exige para conectar um número e enviar mensagens pelo WhatsApp oficial — e o que acontece quando uma regra não é seguida."
      />

      {/* Aviso de autoria: estas regras não são nossas. */}
      <section className="anima-entrada relative isolate overflow-hidden rounded-3xl bg-lateral p-6 text-lateral-tinta shadow-flutuante sm:p-8">
        <div aria-hidden="true" className="fundo-pontos-claro absolute inset-0 -z-10" />
        <div
          aria-hidden="true"
          className="anima-aurora absolute -right-16 -top-24 -z-10 h-72 w-72 rounded-full bg-acento/[0.14] blur-3xl"
        />
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-realce text-tinta">
            <IconeAlerta className="h-6 w-6" />
          </span>
          <div className="space-y-2">
            <h2 className="text-lg font-semibold text-lateral-tinta">
              Estas regras são da Meta, não do RegemCast
            </h2>
            <p className="max-w-3xl text-sm leading-relaxed text-lateral-suave">
              O WhatsApp oficial é da Meta, e ela decide quem conecta, quanto cada número pode enviar e
              quando um número é limitado ou suspenso. O RegemCast segue essas regras e confere o que
              dá antes do envio, mas não tem como liberar uma exceção. Descumprir pode limitar ou
              bloquear o seu número — e a decisão é da Meta.
            </p>
            <p className="text-xs text-lateral-suave">
              Conferido na documentação oficial em {CONFERIDO_EM}. A Meta atualiza estas regras de
              tempos em tempos.
            </p>
          </div>
        </div>
      </section>

      {/* Atalhos das seções */}
      <nav aria-label="Seções desta página" className="-mx-1 overflow-x-auto px-1">
        <ul className="flex gap-2">
          {SECOES.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className="inline-flex whitespace-nowrap rounded-full border border-borda bg-superficie px-3.5 py-1.5 text-sm text-tinta-suave shadow-sm transition-colors hover:border-acento hover:text-tinta"
              >
                {s.titulo}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <Secao
        id="numero"
        icone={<IconeCelular className="h-5 w-5" />}
        titulo="Antes de conectar o número"
        descricao="Vale para quem vai manter o WhatsApp Business no celular e usar o mesmo número aqui."
      >
        <Regra titulo="O número precisa já estar em uso no app WhatsApp Business">
          A conexão mantendo o app no celular é feita para empresas que já atendem pelo WhatsApp
          Business. Número recém-criado costuma ser recusado: parceiros oficiais da Meta orientam{' '}
          <strong className="text-tinta">pelo menos 7 dias de uso ativo</strong>, com conversas de
          verdade, antes de conectar.
        </Regra>
        <Regra titulo="App atualizado e celular com câmera">
          O app WhatsApp Business precisa estar na versão 2.24.17 ou mais nova. A conexão é confirmada
          lendo um QR code, por isso o celular precisa de câmera.
        </Regra>
        <Regra titulo="24 horas para copiar contatos e conversas">
          Depois de conectar, a cópia dos contatos e do histórico precisa terminar em 24 horas. Se o
          prazo passar, a Meta desfaz a conexão e é preciso conectar de novo. Mantenha o app aberto no
          celular durante a cópia.
        </Regra>
        <Regra titulo="Abra o app no celular com frequência">
          Sem abrir o WhatsApp Business no celular por cerca de duas semanas, a Meta encerra a conexão.
          Abra o app ao menos uma vez a cada 13 dias.
        </Regra>
        <Regra titulo="Velocidade menor com o app no celular">
          Número usado no app e aqui ao mesmo tempo envia no máximo 20 mensagens por segundo. Um número
          dedicado, só para disparos, chega a 80.
        </Regra>
      </Secao>

      <Secao
        id="verificacao"
        icone={<IconeEscudo className="h-5 w-5" />}
        titulo="Empresa verificada na Meta"
        descricao="A verificação é feita pela sua empresa, na conta dela na Meta — o RegemCast não faz nem acelera."
      >
        <Regra titulo="Verifique a empresa no Meta Business Suite">
          A verificação fica na <strong className="text-tinta">Central de Segurança</strong>, dentro
          das configurações da empresa no Meta Business Suite. Os dados informados precisam ser iguais
          aos do documento da empresa (razão social, CNPJ, endereço) e do site.
        </Regra>
        <Regra titulo="Prazo da análise">
          A resposta pode vir em minutos ou levar até 14 dias úteis. Se for recusada, o motivo aparece
          na própria Central de Segurança.
        </Regra>
        <Regra titulo="O que a verificação libera">
          É um dos caminhos para sair do limite inicial de 250 pessoas por dia — e é o mais rápido
          para quem está começando.
        </Regra>
      </Secao>

      <Secao
        id="limite"
        icone={<IconeGrafico className="h-5 w-5" />}
        titulo="Limite de envio"
        descricao="É da Meta e é diferente do teto de disparos do seu plano no RegemCast. Os dois valem ao mesmo tempo."
      >
        <div className="rounded-xl border border-borda bg-superficie-2/60 p-4 sm:col-span-2">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-tinta-suave">
            Pessoas diferentes por 24 horas
          </p>
          <ol className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {DEGRAUS.map((d, i) => (
              <li
                key={d.valor}
                className={
                  i === 0
                    ? 'rounded-xl bg-acento p-3 text-center text-acento-contraste shadow-brilho'
                    : 'rounded-xl border border-borda bg-superficie p-3 text-center'
                }
              >
                <span className="numerico block text-lg font-semibold">{d.valor}</span>
                <span className="block text-[0.7rem] opacity-80">{d.rotulo || `degrau ${i + 1}`}</span>
              </li>
            ))}
          </ol>
        </div>
        <Regra titulo="Começa em 250 pessoas a cada 24 horas">
          Conta nova só consegue iniciar conversa com 250 pessoas diferentes num período móvel de 24
          horas. Responder a quem escreveu para você, dentro da janela de atendimento, não conta.
        </Regra>
        <Regra titulo="Como chegar a 2 mil">
          Por um destes caminhos: verificar a empresa na Meta, ou entregar 2 mil mensagens de modelo
          para pessoas diferentes em 30 dias, com modelos de boa qualidade.
        </Regra>
        <Regra titulo="Depois disso, sobe sozinho com o tempo">
          A Meta sobe para 10 mil, 100 mil e ilimitado automaticamente quando a qualidade está boa e
          você usa ao menos metade do limite atual em 7 dias. A mudança acontece em até 6 horas.
        </Regra>
        <Regra titulo="O limite é da empresa, não do número">
          Todos os números do mesmo portfólio empresarial na Meta dividem o mesmo limite. Um número pode
          consumir o limite inteiro.
        </Regra>
      </Secao>

      <Secao
        id="qualidade"
        icone={<IconeOlho className="h-5 w-5" />}
        titulo="Qualidade do número"
        descricao="A Meta mede como as pessoas reagem às suas mensagens."
      >
        <Regra titulo="Verde, amarela ou vermelha">
          A nota vem principalmente de bloqueios e denúncias recentes. Ela aparece na tela do WhatsApp,
          em cada número.
        </Regra>
        <Regra titulo="Qualidade baixa trava o crescimento">
          Com a qualidade baixa, o limite de envio não sobe. Modelos que recebem muitos bloqueios podem
          ser pausados pela Meta e deixar de enviar.
        </Regra>
      </Secao>

      <Secao
        id="consentimento"
        icone={<IconeCheck className="h-5 w-5" />}
        titulo="Consentimento e bom uso"
        descricao="Da Política de Mensagens do WhatsApp Business."
      >
        <Regra titulo="Só para quem autorizou">
          Envie apenas para quem deu o número e autorizou receber mensagens da sua empresa. Lista
          comprada, copiada de grupos ou tirada da internet não vale como autorização.
        </Regra>
        <Regra titulo="Pediu para sair, sai">
          Todo pedido para parar de receber precisa ser respeitado. No RegemCast, quem se descadastra
          fica marcado e não recebe as próximas campanhas.
        </Regra>
        <Regra titulo="Mensagem esperada, sem enganar">
          A mensagem precisa ser o que a pessoa espera receber de você. Nada de conteúdo enganoso,
          surpresa ou spam.
        </Regra>
        <Regra titulo="Produtos e assuntos proibidos">
          A Meta proíbe, entre outros: armas, drogas e medicamentos controlados, álcool, jogos de azar,
          serviços de encontros e marketing multinível. A lista completa está na política.
        </Regra>
        <Regra titulo="O que acontece se descumprir">
          A Meta pode restringir ou remover o acesso ao WhatsApp Business e, em casos graves, proibir a
          empresa de usar os produtos do WhatsApp.
        </Regra>
      </Secao>

      <Secao
        id="modelos"
        icone={<IconeModelo className="h-5 w-5" />}
        titulo="Modelos, janela de atendimento e cobrança"
      >
        <Regra titulo="Quem começa a conversa usa modelo aprovado">
          Toda conversa iniciada pela empresa precisa de um modelo aprovado pela Meta. As categorias
          são Marketing, Utilidade e Autenticação — e a Meta pode mudar a categoria que você escolheu.
        </Regra>
        <Regra titulo="Janela de atendimento de 24 horas">
          Quando a pessoa escreve para você, abre uma janela de 24 horas a partir da última mensagem
          dela. Dentro dela, dá para responder livremente, sem modelo.
        </Regra>
        <Regra titulo="A Meta cobra por mensagem de modelo entregue">
          Desde julho de 2025, a cobrança é por mensagem entregue e depende da categoria e do país do
          número. Marketing é sempre cobrado; utilidade enviada dentro da janela de atendimento não é.
          Essa cobrança é da Meta, na conta da sua empresa, e é separada do plano do RegemCast.
        </Regra>
        <Regra titulo="Limite de marketing por pessoa">
          A Meta limita quantas mensagens de marketing cada pessoa recebe de todas as empresas juntas.
          Quando o limite é atingido, a mensagem não é entregue e aparece como falha (código 131049).
          Espere pelo menos 24 horas antes de tentar de novo para essa pessoa.
        </Regra>
      </Secao>

      <Secao
        id="boas-praticas"
        icone={<IconeGrafico className="h-5 w-5" />}
        titulo="Boas práticas"
        descricao="Não são regras da Meta: são o jeito de não esbarrar nelas."
        recomendacao
      >
        <Regra titulo="Comece pequeno e cresça aos poucos" recomendacao>
          Nas primeiras semanas, envie para quem mais conhece a sua empresa. Boa resposta no começo
          ajuda a qualidade e a subir de limite.
        </Regra>
        <Regra titulo="Use a janela de envio" recomendacao>
          Configure dias e horários comerciais na campanha. Mensagem fora de hora gera mais bloqueio.
        </Regra>
        <Regra titulo="Personalize e dê motivo para ler" recomendacao>
          Use o nome da pessoa e diga logo por que ela está recebendo. Mensagem genérica é a que mais é
          denunciada.
        </Regra>
        <Regra titulo="Mantenha a lista limpa" recomendacao>
          Remova números que falham sempre e respeite o descadastro na hora. Enviar para quem não
          responde há meses derruba a qualidade.
        </Regra>
      </Secao>

      <section className="anima-entrada rounded-card border border-borda bg-superficie p-5 shadow-card">
        <h2 className="text-base font-semibold text-tinta">Fontes oficiais</h2>
        <p className="mt-1 text-sm text-tinta-suave">
          Em caso de dúvida, vale o que está na documentação da Meta.
        </p>
        <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {FONTES.map((f) => (
            <li key={f.url}>
              <a
                href={f.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-xl border border-borda px-3 py-2.5 text-sm text-tinta transition-colors hover:border-acento hover:bg-superficie-2/60"
              >
                {f.titulo}
                <span className="sr-only"> (abre em nova aba)</span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Secao({
  id,
  icone,
  titulo,
  descricao,
  recomendacao = false,
  children,
}: {
  id: string;
  icone: ReactNode;
  titulo: string;
  descricao?: string;
  recomendacao?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-titulo`}
      className="anima-entrada scroll-mt-24 rounded-card border border-borda bg-superficie shadow-card"
    >
      <div className="flex items-start gap-3 border-b border-borda px-5 py-4">
        <span
          aria-hidden="true"
          className={
            recomendacao
              ? 'grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-superficie-2 text-tinta-suave'
              : 'grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-acento text-acento-contraste'
          }
        >
          {icone}
        </span>
        <div>
          <h2 id={`${id}-titulo`} className="text-base font-semibold text-tinta">
            {titulo}
          </h2>
          {descricao ? <p className="text-sm text-tinta-suave">{descricao}</p> : null}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function Regra({
  titulo,
  recomendacao = false,
  children,
}: {
  titulo: string;
  recomendacao?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-borda p-4">
      <span
        className={
          recomendacao
            ? 'w-fit rounded-full border border-borda bg-superficie-2 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider text-tinta-suave'
            : 'w-fit rounded-full border border-realce bg-realce/60 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider text-tinta'
        }
      >
        {recomendacao ? 'Recomendação' : 'Regra da Meta'}
      </span>
      <h3 className="text-sm font-semibold text-tinta">{titulo}</h3>
      <p className="text-sm leading-relaxed text-tinta-suave">{children}</p>
    </div>
  );
}
