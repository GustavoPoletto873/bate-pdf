import roteiroNumerado from '../../../modelos/relatorios/cvm_roteiro_numerado.json';

/**
 * Textos do questionário do relatório CVM (Anexo Normativo II da Resolução CVM 175/22) —
 * transcritos de services/Relatorios/textos_padrao.py do Bate Lastro.
 *
 * Cada seção tem a redação padrão (`sem_ocorrencia`) e, quando houve ocorrência no período,
 * uma alternativa (`com_ocorrencia`). Seções `fixo` têm uma redação só. Qualquer seção aceita
 * uma redação própria (override) na revisão. O roteiro numerado (cvm_01..cvm_19) é o dos
 * modelos sem DC e sem movimentação.
 */

export type Secao = { titulo: string; tipo: 'fixo' | 'variante'; opcoes: Record<string, string> };
export type SnapshotTextos = { cenario: string; roteiro_cvm?: 'numerado' | 'romano' | null; amostra?: { itens?: { descricao: string; quantidade: number }[] } };

const SECOES_SUGERIDAS_POR_MOVIMENTACAO = ['iv_d2', 'iv_f1'];
const SECOES_SO_COM_MOVIMENTACAO = ['iv_d1', 'iv_d2', 'iv_e', 'iv_f1', 'iv_f2'];

export const SECOES: Record<string, Secao> = {
  i_a: {
    titulo: 'I.a) Verificação de vencidos e inadimplidos/substituídos',
    tipo: 'fixo',
    opcoes: { padrao: 'No referido período, o Fundo não possui novos direitos creditórios inadimplidos/substituídos.' },
  },
  ii: {
    titulo: 'II) Registro dos direitos creditórios em registradora',
    tipo: 'fixo',
    opcoes: { padrao: 'O Fundo não possui direitos creditórios registrados em registradora.' },
  },
  iii: {
    titulo: 'III) Ações judiciais ou processos administrativos',
    tipo: 'fixo',
    opcoes: { padrao: 'O crédito adquirido pelo Fundo se trata de um direito creditório objeto de processo judicial.' },
  },
  iv_a: {
    titulo: 'IV.a) Alteração na política de investimento',
    tipo: 'variante',
    opcoes: {
      sem_ocorrencia: 'Durante o período analisado, não foram realizadas alterações relevantes na política de investimento do Fundo capazes de impactar materialmente a composição, o perfil de risco, a rentabilidade ou os critérios de elegibilidade dos ativos integrantes da carteira. O Fundo permaneceu enquadrado aos limites e parâmetros estabelecidos em seu Regulamento e na regulamentação aplicável, incluindo a Resolução CVM nº 175/22 e alterações posteriores.',
      com_ocorrencia: 'Durante o período analisado, foram promovidos ajustes na política de investimento do Fundo, conforme aprovado nas instâncias competentes e refletido no Regulamento vigente. As alterações tiveram como objetivo adequar a estratégia de alocação às condições de mercado e às necessidades operacionais do Fundo, podendo impactar a composição da carteira, o perfil de risco e a rentabilidade esperada dos ativos. O Fundo permaneceu enquadrado aos limites regulatórios e operacionais aplicáveis.',
    },
  },
  iv_b1: {
    titulo: 'IV.b1) Critérios de concessão de crédito dos originadores',
    tipo: 'fixo',
    opcoes: {
      padrao: 'Os critérios de concessão de crédito adotados pelos originadores permanecem fundamentados em procedimentos internos de análise cadastral, avaliação da capacidade financeira dos devedores, histórico de relacionamento comercial, verificação documental e análise de risco de crédito, observadas as políticas internas aplicáveis de cada originador e a regulamentação vigente.\n\nAdicionalmente, os direitos creditórios cedidos ao Fundo permanecem sujeitos aos critérios de elegibilidade previstos no Regulamento e demais documentos da operação.',
    },
  },
  iv_b2: {
    titulo: 'IV.b2) Alterações nos critérios de concessão de crédito',
    tipo: 'variante',
    opcoes: {
      sem_ocorrencia: 'No período analisado, não foram identificadas alterações relevantes nos critérios de concessão de crédito adotados pelos originadores que pudessem impactar materialmente a qualidade, composição ou perfil de risco dos direitos creditórios cedidos ao Fundo.',
      com_ocorrencia: 'No período analisado, determinados originadores promoveram ajustes em seus critérios internos de concessão de crédito, incluindo parâmetros de análise cadastral, limites operacionais e políticas de aprovação. Tais alterações tiveram como objetivo adequar os processos internos às condições de mercado e às diretrizes de gestão de risco, sem desenquadramento das condições previstas nos documentos da operação.',
    },
  },
  iv_c: {
    titulo: 'IV.c) Alterações nas garantias',
    tipo: 'fixo',
    opcoes: {
      padrao: 'No período analisado, não foram identificadas alterações relevantes nas garantias vinculadas ao conjunto de direitos creditórios integrantes da carteira do Fundo.\n\nAs garantias eventualmente associadas às operações permanecem formalizadas conforme previsto nos documentos da operação e sujeitas aos procedimentos de controle e monitoramento aplicáveis.',
    },
  },
  iv_d1: {
    titulo: 'IV.d1) Contratos relevantes firmados para a cessão',
    tipo: 'variante',
    opcoes: {
      sem_ocorrencia: 'No período de referência, não foram celebrados novos contratos relevantes relacionados à cessão de direitos creditórios além daqueles já previstos na estrutura operacional do Fundo.',
      com_ocorrencia: 'No período analisado, foram celebrados instrumentos contratuais relacionados à cessão e operacionalização dos direitos creditórios integrantes da carteira do Fundo, observadas as condições previstas no Regulamento, nos contratos de cessão e na regulamentação aplicável.',
    },
  },
  iv_d2: {
    titulo: 'IV.d2) Caráter definitivo da cessão',
    tipo: 'variante',
    opcoes: {
      sem_ocorrencia: 'As cessões de direitos creditórios realizadas no âmbito do Fundo observaram as condições estabelecidas nos respectivos instrumentos contratuais, podendo possuir caráter definitivo ou prever hipóteses específicas de recompra, resolução ou coobrigação, conforme aplicável à estrutura de cada operação.\nNão foram identificadas, no período analisado, ocorrências relevantes relacionadas à descaracterização das cessões realizadas.',
      com_ocorrencia: 'As cessões de direitos creditórios realizadas no período observaram as disposições previstas nos respectivos instrumentos contratuais, incluindo hipóteses específicas de recompra, coobrigação e resolução da cessão em situações previamente definidas entre as partes.\nNo período analisado, ocorreram eventos pontuais de recompra/substituição de direitos creditórios em razão de desenquadramento aos critérios de elegibilidade e/ou inconsistências documentais identificadas nos procedimentos de monitoramento da carteira, sem impacto material na continuidade operacional do Fundo.',
    },
  },
  iv_e: {
    titulo: 'IV.e) Impacto dos eventos de pré-pagamento',
    tipo: 'variante',
    opcoes: {
      sem_ocorrencia: 'Eventos de pré-pagamento dos direitos creditórios integrantes da carteira podem impactar o fluxo financeiro originalmente projetado para o Fundo, antecipando o retorno do principal e potencialmente reduzindo a rentabilidade esperada das operações, especialmente em cenários de desconto financeiro ou redução da remuneração originalmente pactuada.\n\nNo período analisado, não foram observados eventos relevantes de pré-pagamento com impacto material sobre o patrimônio líquido ou a rentabilidade do Fundo.',
      com_ocorrencia: 'No período analisado, foram observados eventos de pré-pagamento relacionados a determinados direitos creditórios integrantes da carteira do Fundo, resultando na antecipação parcial dos fluxos financeiros originalmente projetados.\n\nTais eventos ocasionaram alteração no prazo médio da carteira e redução parcial da rentabilidade esperada das operações liquidadas antecipadamente, especialmente em razão da interrupção da apropriação futura dos encargos originalmente pactuados. Contudo, os impactos observados permaneceram compatíveis com a estratégia e a política de investimento do Fundo.',
    },
  },
  iv_f1: {
    titulo: 'IV.f1) Momento da alienação',
    tipo: 'variante',
    opcoes: {
      sem_ocorrencia: 'Nos termos previstos nos documentos da operação e no Regulamento do Fundo, os direitos creditórios integrantes da carteira poderão ser alienados antes ou após seus respectivos vencimentos, conforme decisão de gestão e condições de mercado.\nNo período analisado, não foram registradas alienações relevantes de direitos creditórios.',
      com_ocorrencia: 'No decorrer do período analisado, o Fundo realizou alienações pontuais de direitos creditórios antes de seus respectivos vencimentos, conforme permitido nos documentos da operação e no Regulamento do Fundo.\nAs alienações ocorreram no contexto da gestão ordinária da carteira, envolvendo operações de reenquadramento, gestão de liquidez e mitigação de risco de crédito, sem comprometimento relevante da estrutura patrimonial do Fundo.',
    },
  },
  iv_f2: {
    titulo: 'IV.f2) Motivação da alienação',
    tipo: 'fixo',
    opcoes: {
      padrao: 'Eventuais alienações de direitos creditórios poderão ocorrer por motivos relacionados à gestão de liquidez, reenquadramento da carteira, mitigação de risco de crédito, estratégia de investimento ou atendimento às condições previstas nos documentos da operação.',
    },
  },
  iv_g: {
    titulo: 'IV.g) Descontinuidade da originação ou cessão',
    tipo: 'variante',
    opcoes: {
      sem_ocorrencia: 'Uma eventual descontinuidade na originação, aquisição ou cessão de direitos creditórios poderá impactar negativamente a capacidade de reinvestimento do Fundo, sua rentabilidade e a manutenção de seu volume operacional, podendo resultar em redução de receitas e descasamento de fluxos financeiros.\nNo período analisado, não foram identificados eventos de descontinuidade operacional com impacto material sobre o patrimônio líquido ou a rentabilidade do Fundo.',
      com_ocorrencia: 'No período analisado, foram observadas reduções temporárias no volume de originação/cessão de direitos creditórios por determinados cedentes/originadores, impactando parcialmente o ritmo de recomposição da carteira do Fundo.\nTal cenário ocasionou aumento temporário da posição de caixa e alteração no perfil de alocação dos ativos, com possível reflexo na rentabilidade projetada do Fundo. Não obstante, a administração e a gestão adotaram medidas de acompanhamento e recomposição da carteira, visando preservar o enquadramento regulatório e a continuidade operacional do Fundo.',
    },
  },
  iv_h: {
    titulo: 'IV.h) Regularidade dos fluxos financeiros',
    tipo: 'variante',
    opcoes: {
      sem_ocorrencia: 'No período analisado, não foram identificados eventos relevantes capazes de afetar materialmente a regularidade dos fluxos financeiros oriundos dos direitos creditórios integrantes da carteira do Fundo, incluindo eventos de liquidação antecipada, vencimento antecipado, inadimplemento relevante ou outras ocorrências extraordinárias.',
      com_ocorrencia: 'No período analisado, foram identificadas ocorrências pontuais relacionadas ao atraso no fluxo de liquidação de determinados direitos creditórios integrantes da carteira do Fundo, incluindo inadimplementos, prorrogações negociais e/ou eventos operacionais associados aos cedentes e devedores.\nOs eventos registrados impactaram parcialmente a regularidade dos fluxos financeiros originalmente projetados, demandando acompanhamento reforçado por parte da administração, gestão e demais prestadores de serviço envolvidos na estrutura do Fundo.\nAté o encerramento do período, as ocorrências permaneciam sob monitoramento e tratamento conforme os procedimentos previstos nos documentos da operação.',
    },
  },
  v_a: {
    titulo: 'V.a) Precatórios na ordem de pagamento da União',
    tipo: 'fixo',
    opcoes: {
      padrao: 'Conforme informações disponibilizadas no período analisado, os precatórios integrantes da carteira do Fundo permanecem submetidos à ordem constitucional de pagamento aplicável, não tendo sido identificadas alterações relevantes quanto à sua posição processual ou expectativa de liquidação.',
    },
  },
  v_b: {
    titulo: 'V.b) Impugnação judicial ou fatos supervenientes',
    tipo: 'variante',
    opcoes: {
      sem_ocorrencia: 'No período analisado, não foram identificadas impugnações judiciais, decisões supervenientes ou outros eventos relevantes capazes de alterar materialmente a expectativa de recebimento, a ordem cronológica ou o prazo estimado de pagamento dos precatórios integrantes da carteira do Fundo.',
      com_ocorrencia: 'No período analisado, foram identificados eventos processuais e/ou manifestações judiciais relacionadas a determinados precatórios integrantes da carteira do Fundo, incluindo impugnações, pedidos de revisão de cálculos, questionamentos processuais e demais fatos supervenientes capazes de impactar o prazo estimado de liquidação dos ativos.\nAs discussões processuais permanecem em acompanhamento pelos assessores jurídicos e demais prestadores de serviço envolvidos, sendo avaliados os potenciais impactos sobre a expectativa de recebimento, a ordem cronológica de pagamento e a valorização dos ativos integrantes da carteira do Fundo.\nAté o encerramento do período, não foi possível mensurar de forma definitiva os efeitos financeiros decorrentes dos eventos mencionados.',
    },
  },
};

export const SECOES_NUMERADAS: Record<string, Secao> = Object.fromEntries(
  (roteiroNumerado as { chave: string; titulo: string; texto: string }[]).map((i) => [i.chave, { titulo: i.titulo, tipo: 'fixo', opcoes: { padrao: i.texto } }]),
);

function secoesDoRoteiro(s: SnapshotTextos): Record<string, Secao> {
  const numerado = s.roteiro_cvm === 'numerado' || (!s.roteiro_cvm && ['SEM_DC', 'SEM_MOVIMENTACAO'].includes(s.cenario));
  if (!numerado) return SECOES;
  if (s.cenario !== 'SEM_MOVIMENTACAO' || !SECOES_NUMERADAS.cvm_04) return SECOES_NUMERADAS;
  const c4 = SECOES_NUMERADAS.cvm_04;
  return {
    ...SECOES_NUMERADAS,
    cvm_04: {
      ...c4,
      opcoes: {
        padrao: c4.opcoes.padrao.replace(
          'O Fundo não possui direitos creditórios na data base para verificação de lastro.',
          'O Fundo não apresentou movimentação de direitos creditórios no período para verificação de lastro.',
        ),
      },
    },
  };
}

export type SecaoParaRevisar = { chave: string; titulo: string; tipo: Secao['tipo']; opcoes: { valor: string; texto: string }[] };

/** Seções a revisar, com as opções de texto. */
export function secoesPara(s: SnapshotTextos): SecaoParaRevisar[] {
  return Object.entries(secoesDoRoteiro(s))
    .filter(([chave]) => !(s.cenario === 'SEM_MOVIMENTACAO' && SECOES_SO_COM_MOVIMENTACAO.includes(chave)))
    .map(([chave, secao]) => ({ chave, titulo: secao.titulo, tipo: secao.tipo, opcoes: Object.entries(secao.opcoes).map(([valor, texto]) => ({ valor, texto })) }));
}

/** Pré-seleção: recompra/substituição na amostra sugere "com ocorrência" na cessão e na alienação. */
export function escolhasIniciais(s: SnapshotTextos): Record<string, string> {
  const houveRecompra = (s.amostra?.itens ?? []).some((i) => i.descricao === 'Recompra' && i.quantidade > 0);
  const escolhas: Record<string, string> = {};
  for (const [chave, secao] of Object.entries(secoesDoRoteiro(s))) {
    const opcoes = Object.keys(secao.opcoes);
    if (secao.tipo === 'fixo') escolhas[chave] = opcoes[0];
    else escolhas[chave] = houveRecompra && SECOES_SUGERIDAS_POR_MOVIMENTACAO.includes(chave) ? 'com_ocorrencia' : 'sem_ocorrencia';
  }
  return escolhas;
}

/** Texto final de cada seção. Precedência: override > variante escolhida > padrão. Fora do cenário = vazio. */
export function resolverTextos(s: SnapshotTextos, escolhas: Record<string, string>, overrides: Record<string, string> = {}): Record<string, string> {
  const visiveis = new Set(secoesPara(s).map((x) => x.chave));
  const textos: Record<string, string> = {};
  for (const [chave, secao] of Object.entries({ ...SECOES, ...SECOES_NUMERADAS, ...secoesDoRoteiro(s) })) {
    if (!visiveis.has(chave)) { textos[chave] = ''; continue; }
    const proprio = (overrides[chave] ?? '').trim();
    if (proprio) { textos[chave] = proprio; continue; }
    const escolhido = escolhas[chave];
    textos[chave] = escolhido && escolhido in secao.opcoes ? secao.opcoes[escolhido] : Object.values(secao.opcoes)[0];
  }
  return textos;
}
