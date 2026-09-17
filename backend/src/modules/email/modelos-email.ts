/**
 * Os e-mails que o RegemCast manda.
 *
 * HTML com estilo em linha e tabela: é o único formato que Gmail, Outlook e o
 * app de e-mail do celular mostram igual. Classe CSS e flex somem no Outlook.
 *
 * Sempre com versão em texto puro ao lado — é ela que aparece na prévia da
 * caixa de entrada e em quem lê e-mail sem HTML.
 *
 * O código aparece grande, sozinho e com espaço: quem lê no celular copia o
 * número, não a frase.
 */
import type { EmailParaEnviar } from './email.service';

const AMEIXA = '#231632';
const LIMA = '#A3E635';
const SUAVE = '#6A5F76';

function escapar(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function moldura(titulo: string, corpo: string): string {
  return `<!doctype html>
<html lang="pt-BR"><body style="margin:0;padding:0;background:#F8F5F2;font-family:Arial,Helvetica,sans-serif;color:${AMEIXA}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F8F5F2;padding:32px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #E5DFE8">
<tr><td style="background:${AMEIXA};padding:20px 28px">
<span style="display:inline-block;background:${LIMA};color:${AMEIXA};font-weight:bold;border-radius:8px;padding:4px 10px;font-size:14px">RegemCast</span>
</td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 12px;font-size:20px;color:${AMEIXA}">${escapar(titulo)}</h1>
${corpo}
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #E5DFE8;font-size:12px;color:${SUAVE}">
Você recebeu este e-mail porque ele foi usado no RegemCast. Se não foi você, ignore — nada muda sem o código.
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

const FINALIDADE: Record<string, { assunto: string; titulo: string; frase: string }> = {
  convite: {
    assunto: 'Seu código para criar a conta no RegemCast',
    titulo: 'Confirme o seu e-mail',
    frase: 'Use este código para confirmar o e-mail e criar a sua conta no RegemCast.',
  },
  login: {
    assunto: 'Seu código de acesso ao RegemCast',
    titulo: 'Código de acesso',
    frase: 'Alguém entrou com a sua senha no RegemCast. Se foi você, use este código para concluir.',
  },
  ativar_email: {
    assunto: 'Confirme a verificação em duas etapas no RegemCast',
    titulo: 'Ative a verificação por e-mail',
    frase: 'Use este código para ativar a verificação em duas etapas por e-mail na sua conta.',
  },
};

export function emailDeCodigo(
  para: string,
  finalidade: 'convite' | 'login' | 'ativar_email',
  codigo: string,
  minutos: number,
): EmailParaEnviar {
  const f = FINALIDADE[finalidade];
  const espacado = `${codigo.slice(0, 3)} ${codigo.slice(3)}`;
  const aviso =
    finalidade === 'login'
      ? 'Se não foi você, troque a sua senha agora: alguém sabe qual é.'
      : 'Não compartilhe este código com ninguém. A equipe do RegemCast nunca pede o código.';

  return {
    para,
    assunto: f.assunto,
    texto: `${f.frase}\n\nCódigo: ${espacado}\n\nVale por ${minutos} minutos.\n${aviso}`,
    html: moldura(
      f.titulo,
      `<p style="margin:0 0 20px;font-size:15px;line-height:1.5;color:${SUAVE}">${escapar(f.frase)}</p>
<p style="margin:0 0 20px;text-align:center"><span style="display:inline-block;background:#F3EFEB;border-radius:12px;padding:14px 22px;font-size:32px;letter-spacing:8px;font-weight:bold;font-family:'Courier New',monospace;color:${AMEIXA}">${escapar(espacado)}</span></p>
<p style="margin:0 0 8px;font-size:14px;color:${SUAVE}">Vale por ${minutos} minutos.</p>
<p style="margin:0;font-size:14px;color:${SUAVE}">${escapar(aviso)}</p>`,
    ),
  };
}

export function emailDeConvite(para: string, nome: string, link: string, expiraEm: Date): EmailParaEnviar {
  const data = expiraEm.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const primeiroNome = nome.trim().split(/\s+/)[0] || nome;

  return {
    para,
    assunto: 'Sua vaga no RegemCast foi liberada',
    texto:
      `Olá, ${primeiroNome}!\n\nSua vaga no RegemCast foi liberada. Crie a sua conta pelo link abaixo:\n${link}\n\n` +
      `O convite vale até ${data}. Tenha em mãos o CNPJ da empresa — ele precisa estar ativo na Receita.`,
    html: moldura(
      'Sua vaga foi liberada',
      `<p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:${SUAVE}">Olá, ${escapar(primeiroNome)}! Chegou a sua vez na lista de espera do RegemCast.</p>
<p style="margin:0 0 24px;text-align:center"><a href="${escapar(link)}" style="display:inline-block;background:${LIMA};color:${AMEIXA};font-weight:bold;text-decoration:none;border-radius:12px;padding:14px 28px;font-size:16px">Criar minha conta</a></p>
<p style="margin:0 0 8px;font-size:14px;color:${SUAVE}">O convite vale até <strong style="color:${AMEIXA}">${escapar(data)}</strong>.</p>
<p style="margin:0 0 16px;font-size:14px;color:${SUAVE}">Tenha em mãos o CNPJ da empresa — ele precisa estar ativo na Receita. Vamos confirmar o seu e-mail com um código.</p>
<p style="margin:0;font-size:12px;color:${SUAVE};word-break:break-all">Se o botão não abrir, copie este endereço: ${escapar(link)}</p>`,
    ),
  };
}

/**
 * Aviso de fim do grátis (7 dias, 3 dias e no dia).
 *
 * Diz a data exata em que os DISPAROS param e o que continua funcionando — quem
 * lê "sua conta será bloqueada" acha que perde os contatos e os modelos.
 */
export function emailFimDoGratis(
  para: string,
  nomeConta: string,
  gratisAte: Date,
  disparosParamEm: Date,
  link: string,
): EmailParaEnviar {
  const fmt = (d: Date) => d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const hoje = gratisAte.getTime() <= Date.now();
  const titulo = hoje ? 'Seu mês grátis terminou' : `Seu mês grátis termina em ${fmt(gratisAte)}`;
  const frase = hoje
    ? `O mês grátis de ${nomeConta} no RegemCast terminou. Escolha um plano para continuar disparando.`
    : `O mês grátis de ${nomeConta} no RegemCast termina em ${fmt(gratisAte)}. Escolha um plano para os disparos não pararem.`;
  const corte = `Sem plano pago, os disparos param em ${fmt(disparosParamEm)}. Contatos, modelos e histórico continuam na sua conta.`;

  return {
    para,
    assunto: titulo,
    texto: `${frase}\n\n${corte}\n\nEscolher plano: ${link}`,
    html: moldura(
      titulo,
      `<p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:${SUAVE}">${escapar(frase)}</p>
<p style="margin:0 0 24px;font-size:14px;line-height:1.5;color:${SUAVE}">${escapar(corte)}</p>
<p style="margin:0;text-align:center"><a href="${escapar(link)}" style="display:inline-block;background:${LIMA};color:${AMEIXA};font-weight:bold;text-decoration:none;border-radius:12px;padding:14px 28px;font-size:16px">Escolher plano</a></p>`,
    ),
  };
}
