/**
 * As ferramentas de ESCRITA do MCP: o rascunho de modelo e o de campanha.
 *
 * Nenhuma delas faz mensagem sair. O rascunho de modelo fica no RegemCast (não
 * vai para a Meta), e a campanha fica em rascunho (não dispara): quem confere e
 * dá o passo seguinte é uma pessoa da conta, na tela.
 *
 * O que vale para as duas:
 *
 * - **O mesmo serviço e a mesma validação da tela.** O pedido vira o DTO da
 *   rota (`class-validator`) e entra no serviço que a tela chama — não existe
 *   uma segunda regra de modelo ou de campanha aqui.
 * - **Recorte menor que o da tela, de propósito.** Sem números digitados (o
 *   público sai de uma lista ou da base, onde o consentimento está registrado),
 *   sem "enviar para quem está em descanso" (é decisão do dono), sem mídia, sem
 *   carrossel e sem oferta por tempo limitado no modelo.
 * - **Chave de idempotência obrigatória.** Repetir o pedido com a mesma chave
 *   devolve a resposta guardada, sem criar de novo.
 * - **Autor na trilha:** tudo que o serviço audita sai como `integracao`, com o
 *   nome do token (`auditoria/autor-integracao.ts`), e o rascunho guarda o
 *   produto que o criou — é o que a tela mostra como "montada pelo …".
 */
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync, type ValidationError } from 'class-validator';
import { sql } from 'drizzle-orm';
import * as z from 'zod/v4';

import { CriarCampanhaDto } from '../campanha/dto/criar-campanha.dto';
import { ORIGENS_VARIAVEL } from '../campanha/variaveis';
import { ORIGENS_DO_PUBLICO } from '../contato/origem-do-publico';
import { SalvarModeloDto, TIPOS_BOTAO } from '../modelo/dto/salvar-modelo.dto';
import { LIMITE_BOTOES, LIMITE_CABECALHO, LIMITE_CORPO, LIMITE_RODAPE } from '../modelo/regras-modelo';
import { FORMATO_DA_CHAVE, hashDoPedido, PRAZO_HORAS } from './idempotencia.regras';
import { naConta, type ContextoDaFerramenta, type Ferramenta } from './mcp.ferramenta';
import { campanhaParaFora, custoParaFora, esquemaDaCampanha, esquemaDoCusto } from './mcp.leitura';

/** Cria ou altera um rascunho; repetir com a mesma chave não cria de novo. */
const ESCRITA = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

const chaveDeIdempotencia = z
  .string()
  .regex(FORMATO_DA_CHAVE)
  .describe(
    `Uma chave sua, única por ação (8 a 100 caracteres: letras, números, ponto, dois-pontos, hífen, sublinhado). Repetir o MESMO pedido com a mesma chave devolve a mesma resposta, sem criar de novo. Vale por ${PRAZO_HORAS} horas.`,
  );

// ------------------------------------------------------------------ apoio

function mensagensDe(erros: ValidationError[]): string[] {
  return erros.flatMap((e) => [...Object.values(e.constraints ?? {}), ...mensagensDe(e.children ?? [])]);
}

/**
 * O pedido como o DTO da rota, validado como a rota valida (as mesmas opções do
 * `ValidationPipe` global). É o que garante uma regra de forma só.
 */
export function comoDto<T extends object>(Classe: new () => T, dados: Record<string, unknown>): T {
  const limpo = Object.fromEntries(Object.entries(dados).filter(([, v]) => v !== undefined));
  const dto = plainToInstance(Classe, limpo);
  const erros = validateSync(dto, { whitelist: true, forbidNonWhitelisted: true });
  if (erros.length) throw new BadRequestException([...new Set(mensagensDe(erros))].join(' '));
  return dto;
}

/**
 * Roda a ação uma vez por chave. A linha da chave nasce na transação corrente
 * (a da ferramenta): se a ação falha, a chave não fica. Um segundo pedido
 * igual, ao mesmo tempo, espera no índice único até o primeiro confirmar — e
 * então recebe a resposta dele.
 */
export async function comIdempotencia<T extends Record<string, unknown>>(
  c: ContextoDaFerramenta,
  ferramenta: string,
  chave: string,
  pedido: unknown,
  acao: () => Promise<T>,
): Promise<T> {
  const db = c.ctx.db;
  const hash = hashDoPedido(pedido);

  const reservada = await db.execute<{ id: string }>(sql`
    insert into integracao_idempotencia (conta_id, token_id, ferramenta, chave, pedido_hash)
    values (${c.quem.contaId}, ${c.quem.tokenId}, ${ferramenta}, ${chave}, ${hash})
    on conflict (token_id, ferramenta, chave) do nothing
    returning id
  `);
  const nova = reservada.rows[0];

  if (!nova) {
    const guardada = await db.execute<{ pedido_hash: string; resposta: T | null }>(sql`
      select pedido_hash, resposta
        from integracao_idempotencia
       where token_id = ${c.quem.tokenId} and ferramenta = ${ferramenta} and chave = ${chave}
       limit 1
    `);
    const antiga = guardada.rows[0];
    if (antiga && antiga.pedido_hash !== hash) {
      throw new UnprocessableEntityException(
        'Esta chave de idempotência já foi usada com outro pedido. Para um pedido novo, use uma chave nova.',
      );
    }
    if (!antiga?.resposta) {
      throw new ConflictException('O pedido com esta chave ainda está sendo concluído. Tente de novo em instantes.');
    }
    return antiga.resposta;
  }

  const resposta = await acao();
  await db.execute(sql`
    update integracao_idempotencia set resposta = ${JSON.stringify(resposta)}::jsonb where id = ${nova.id}::uuid
  `);
  return resposta;
}

// ------------------------------------------------------------------ modelo

const CATEGORIA_NA_META = { marketing: 'MARKETING', utilidade: 'UTILITY' } as const;

const modeloRascunhar: Ferramenta = {
  nome: 'modelo_rascunhar',
  escopo: 'modelos.rascunhar',
  registrar(servidor, c) {
    servidor.registerTool(
      'modelo_rascunhar',
      {
        title: 'Criar ou alterar um rascunho de modelo',
        description:
          'Grava um RASCUNHO de modelo de mensagem no RegemCast: título em texto (opcional), mensagem, rodapé e botões. Não envia para a Meta — uma pessoa da conta confere e envia para aprovação, em Modelos. A resposta traz os problemas que barrariam o envio (regras da Meta, texto igual ao de outro modelo), para corrigir antes. Com `id`, altera um rascunho que este mesmo aplicativo criou. Não aceita imagem, vídeo, documento, carrossel nem oferta por tempo limitado.',
        inputSchema: z.object({
          chaveIdempotencia: chaveDeIdempotencia,
          id: z.string().uuid().optional().describe('O rascunho a alterar. Só um que este aplicativo criou e que ainda não foi enviado à Meta.'),
          nome: z.string().min(1).max(512).describe('Nome técnico: minúsculas, números e sublinhado, como promo_frete_gratis.'),
          categoria: z.enum(['marketing', 'utilidade']).describe('marketing (promoção, novidade) ou utilidade (aviso sobre algo que a pessoa já pediu). Decide o preço e o descanso.'),
          idioma: z.string().max(32).optional().describe('Padrão: pt_BR.'),
          titulo: z.string().max(LIMITE_CABECALHO).optional().describe('O título da mensagem, em texto. Aceita uma variável, {{1}}.'),
          tituloExemplo: z.string().max(200).optional().describe('Um exemplo do valor de {{1}} no título, quando ele tem variável.'),
          corpo: z.string().min(1).max(LIMITE_CORPO).describe('A mensagem. Variáveis como {{1}}, {{2}}, em ordem.'),
          corpoExemplos: z.array(z.string().max(200)).max(10).optional().describe('Um exemplo para cada variável da mensagem, em ordem. A Meta exige.'),
          rodape: z.string().max(LIMITE_RODAPE).optional(),
          botoes: z
            .array(
              z.object({
                tipo: z.enum(TIPOS_BOTAO).describe('URL (abre um endereço), PHONE_NUMBER (liga), QUICK_REPLY (resposta rápida) ou COPY_CODE (copia um código).'),
                texto: z.string().max(64),
                url: z.string().max(2048).optional(),
                telefone: z.string().max(32).optional(),
              }),
            )
            .max(LIMITE_BOTOES)
            .optional(),
        }),
        outputSchema: z.object({
          id: z.string(),
          nome: z.string(),
          idioma: z.string(),
          categoria: z.string(),
          situacao: z.string(),
          problemas: z.array(z.object({ campo: z.string(), mensagem: z.string() })),
          prontoParaEnviar: z.boolean(),
          proximoPasso: z.string(),
        }),
        annotations: ESCRITA,
      },
      async ({ chaveIdempotencia, id, ...pedido }) =>
        naConta(c, 'modelo_rascunhar', () =>
          comIdempotencia(c, 'modelo_rascunhar', chaveIdempotencia, { id, ...pedido }, async () => {
            const dto = comoDto(SalvarModeloDto, {
              tipo: 'simples',
              nome: pedido.nome,
              idioma: pedido.idioma ?? 'pt_BR',
              categoria: CATEGORIA_NA_META[pedido.categoria],
              cabecalhoFormato: pedido.titulo ? 'TEXT' : undefined,
              cabecalhoTexto: pedido.titulo,
              cabecalhoExemplo: pedido.tituloExemplo,
              corpo: pedido.corpo,
              corpoExemplos: pedido.corpoExemplos,
              rodape: pedido.rodape,
              botoes: pedido.botoes,
            });

            if (id) {
              const atual = (await c.servicos.modelos.listar(c.quem.contaId)).find((m) => m.id === id);
              if (!atual) throw new NotFoundException('Modelo não encontrado.');
              if (atual.integracaoProduto !== c.quem.produto) {
                throw new ForbiddenException(
                  'Pelo MCP só dá para alterar um rascunho que este aplicativo criou. Os outros são alterados na tela, por uma pessoa da conta.',
                );
              }
            }

            const salvo = await c.servicos.modelos.salvarRascunho(c.quem.contaId, null, dto, id);
            const problemas = await c.servicos.modelos.conferir(c.quem.contaId, dto, salvo.id);
            return {
              id: salvo.id,
              nome: dto.nome.trim(),
              idioma: dto.idioma ?? 'pt_BR',
              categoria: pedido.categoria,
              situacao: 'rascunho',
              problemas: problemas.map((p) => ({ campo: p.campo, mensagem: p.mensagem })),
              prontoParaEnviar: problemas.length === 0,
              proximoPasso: problemas.length
                ? 'O rascunho foi gravado, mas a Meta o recusaria como está. Corrija os problemas e grave de novo, com o id do rascunho e uma chave nova.'
                : 'O rascunho está gravado e não foi para a Meta. Uma pessoa da conta confere e envia para aprovação, em Modelos.',
            };
          }),
        ),
    );
  },
};

// ---------------------------------------------------------------- campanha

const esquemaDaVariavel = z.object({
  origem: z
    .enum(ORIGENS_VARIAVEL)
    .describe('fixo (o mesmo texto para todos), nome ou primeiro_nome (do contato), cashback_saldo ou cashback_validade (só vai para quem tem cashback válido).'),
  valor: z.string().max(1024).optional().describe('O texto, quando fixo; ou o que usar quando o contato não tem o dado. O saldo do cashback não usa.'),
});

const HORA = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

const campanhaRascunhar: Ferramenta = {
  nome: 'campanha_rascunhar',
  escopo: 'campanhas.rascunhar',
  registrar(servidor, c) {
    servidor.registerTool(
      'campanha_rascunhar',
      {
        title: 'Montar uma campanha em rascunho',
        description:
          'Monta uma campanha em RASCUNHO: o modelo (precisa estar aprovado na Meta), o público (uma lista ou um público da base — nunca números soltos), as variáveis e, se quiser, a janela de horário e o ritmo. Nada é enviado: uma pessoa da conta confere e dispara, em Campanhas. A resposta traz quantas pessoas entraram, quem ficou de fora e o custo estimado na Meta. Use publico_estimar antes para ver o tamanho do público, e modelos_listar para o nome do modelo e quantas variáveis ele espera.',
        inputSchema: z.object({
          chaveIdempotencia: chaveDeIdempotencia,
          nome: z.string().min(2).max(120).describe('O nome da campanha, para a pessoa da conta encontrá-la.'),
          modeloNome: z.string().min(1).max(512).describe('O nome do modelo aprovado, como veio em modelos_listar.'),
          modeloIdioma: z.string().max(32).optional().describe('Padrão: pt_BR.'),
          publico: z.object({
            origem: z.enum(ORIGENS_DO_PUBLICO).describe('De onde sai o público: lista, importacao, base (toda a base), perfil, regiao (estado, pelo DDD) ou publico (um público pronto).'),
            origemId: z.string().uuid().optional().describe('O id da lista ou da importação, quando a origem é uma delas.'),
            segmento: z.string().optional().describe('O id do perfil, quando a origem é perfil (veja publicos_listar).'),
            uf: z.string().length(2).optional().describe('A sigla do estado, quando a origem é regiao.'),
            publico: z.string().optional().describe('O id do público pronto, quando a origem é publico (veja publicos_listar).'),
            publicoValor: z.string().max(80).optional().describe('O bairro, o mês (1 a 12) ou o produto, quando o público pede.'),
          }),
          variaveis: z.array(esquemaDaVariavel).max(10).optional().describe('Uma para cada variável da mensagem do modelo, em ordem: a primeira é {{1}}.'),
          variavelDoTitulo: esquemaDaVariavel.optional().describe('Só quando o título do modelo tem variável.'),
          janelaDias: z.array(z.number().int().min(0).max(6)).max(7).optional().describe('Dias em que pode enviar: 0 = domingo … 6 = sábado. Vazio = qualquer dia.'),
          janelaInicio: z.string().regex(HORA).optional().describe('Início do horário de envio, HH:MM, no fuso da conta. Só vale junto do fim.'),
          janelaFim: z.string().regex(HORA).optional().describe('Fim do horário de envio, HH:MM.'),
          pausaSegundos: z.number().int().min(0).max(3600).optional().describe('Segundos entre uma mensagem e a próxima.'),
          maxPorDia: z.number().int().min(1).optional(),
          maxPorSemana: z.number().int().min(1).optional(),
          maxPorMes: z.number().int().min(1).optional(),
        }),
        outputSchema: z.object({
          campanha: esquemaDaCampanha,
          custo: esquemaDoCusto,
          descansoDias: z.number().nullable(),
          proximoPasso: z.string(),
        }),
        annotations: { ...ESCRITA, openWorldHint: true },
      },
      async ({ chaveIdempotencia, ...pedido }) =>
        naConta(c, 'campanha_rascunhar', () =>
          comIdempotencia(c, 'campanha_rascunhar', chaveIdempotencia, pedido, async () => {
            const dto = comoDto(CriarCampanhaDto, {
              nome: pedido.nome,
              modeloNome: pedido.modeloNome,
              modeloIdioma: pedido.modeloIdioma ?? 'pt_BR',
              daBase: pedido.publico,
              variaveisLista: pedido.variaveis,
              variavelCabecalho: pedido.variavelDoTitulo,
              janelaDias: pedido.janelaDias,
              janelaInicio: pedido.janelaInicio,
              janelaFim: pedido.janelaFim,
              pausaSegundos: pedido.pausaSegundos,
              maxPorDia: pedido.maxPorDia,
              maxPorSemana: pedido.maxPorSemana,
              maxPorMes: pedido.maxPorMes,
            });
            // Como operador: quem integra não libera o descanso — é decisão do dono.
            const criada = await c.servicos.campanhas.criar(c.quem.contaId, null, dto, 'operador');
            const r = await c.servicos.campanhas.detalhe(c.quem.contaId, criada.id);
            return {
              campanha: campanhaParaFora(r),
              custo: custoParaFora(r.custo),
              descansoDias: r.descansoDias ?? null,
              proximoPasso:
                'A campanha está em rascunho: nenhuma mensagem saiu. Uma pessoa da conta confere e dispara, em Campanhas.',
            };
          }),
        ),
    );
  },
};

export const FERRAMENTAS_DE_ESCRITA: readonly Ferramenta[] = [modeloRascunhar, campanhaRascunhar];
