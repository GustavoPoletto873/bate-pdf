/* eslint-disable @typescript-eslint/no-explicit-any */
/** Ajudantes dos testes (dados fictícios), como em backend/tests/test_pre_classificacao.py. */
import { Pagina, type Obj } from './motor';
import { normalizarTexto } from './valores';

export function pagina(pdf: string, numero: number, texto: string): Pagina {
  return Pagina.deTexto(pdf, numero, normalizarTexto(texto));
}

export function registro(rid: any, tipo: string, campos: Record<string, unknown> = {}): Obj {
  const base: Obj = {
    registro_base_id: rid,
    tipo_documento: tipo,
    base_numero_documento: null,
    base_sacado_nome: null,
    base_sacado_documento: null,
    base_cedente_nome: null,
    base_cedente_documento: null,
    base_valor_total: null,
    base_data_emissao: null,
    base_data_vencimento: null,
    base_nome_fundo: null,
    base_cnpj_fundo: null,
    base_data_aquisicao: null,
  };
  for (const [k, v] of Object.entries(campos)) base[`base_${k}`] = v;
  return base;
}

export function vd(status: Obj) {
  return { valor: status.valor, encontrado: status.encontrado };
}

export function valores(resultado: Obj): Record<string, string> {
  return Object.fromEntries(Object.entries(resultado.campos as Obj).map(([c, s]) => [c, s.valor]));
}

export const DUPLICATA = (
  'DUPLICATA DE PRESTAÇÃO DE SERVIÇOS\r\n'
  + 'EMITENTE PAPELARIA MODELO LTDA CNPJ 11.222.333/0001-81\r\n'
  + 'NF/FATURA NÚMERO FATURA VALOR DUPLICATA NÚMERO DUPLICATA VALOR VENCIMENTO\r\n'
  + '52635 R$ 1.613,33 52635-01 R$ 1.613,33 05/09/2026\r\n'
  + 'DATA EMISSÃO 05/08/2026 VENCIMENTO: 05/09/2026\r\n'
  + 'NOME: EXEMPLO ACADEMIA DE GINASTICA LTDA\r\n'
  + 'CNPJ/MF 33.444.555/0002-07 INSC. ESTADUAL:\r\n'
);

export const TERMO_CODIGOS = (
  'TERMO DE CESSÃO DE DIREITOS CREDITÓRIOS\r\n'
  + 'CESSIONÁRIA: FUNDO ALFA FIDC CNPJ 11.444.777/0001-61\r\n'
  + '1A2B-30001 MARIA ALVES COSTA 111.444.777-35 R$ 1.000,00 10/09/2026\r\n'
  + '3C4D-40002 MARIA ALVES COSTA 111.444.777-35 R$ 1.500,00 10/03/2027\r\n'
  + '5E6F-50003 OUTRA PESSOA 529.982.247-25 R$ 700,00 10/12/2026\r\n'
);

export const TERMO_ANEXO_MULTILINHA = (
  'titulo de credito sacado cpf/cnpj valor (r$) vencimento\r\n'
  + '0000000000\r\nmaria aparecida\r\nfonseca lima\r\n'
  + '111.222.333-96 r$ 111,47 21/12/2028\r\n'
  + '0000000000\r\nmaria aparecida\r\nfonseca lima\r\n'
  + '111.222.333-96 r$ 111,47 21/01/2029\r\n'
  + '0000000000 jose roberto alves 222.333.444-05 r$ 285,70 21/12/2028\r\n'
  + 'pagina 2 de 2\r\n'
);

export const TERMO_QUADRO_RESUMO = (
  'termo de cessao de direitos creditorios\r\n'
  + '1. cessionario\r\nfundo alfa fundo de investimentos em direitos creditorios responsabilidade limitada, '
  + 'inscrito no cnpj/me sob o nº 11444777000161\r\n'
  + '2. cedente\r\ndenominacao social: credora beta sociedade de credito direto\r\ns.a-22333444000181\r\n'
  + 'data de aquisicao: 20/08/2026\r\n'
);

export const CCB = (
  'cedula de credito bancario credito do trabalhador\r\n'
  + 'agencia: matriz cod.: 0001-9 data de emissao: 28/03/2026 cedula nº.: 85930008\r\n'
  + 'credor: nome: credora beta sociedade de credito direto s.a.\r\ncnpj: 22.333.444/0001-81\r\n'
  + 'emitente: nome:maria aparecida fonseca lima\r\ncpf: 111.222.333-96\r\n'
  + 'valor total financiado: r$ 1380.65 valor liberado: r$ 1337.94\r\n'
  + 'vencimento das parcelas: 21/06/2026 valor da parcela: r$ 111.47\r\n'
  + 'vencimento final: 21/05/2027 vencimento da 1ª parcela: 21/06/2026\r\n'
  + 'iof: r$ 0.00\r\n'
);

export function registroTermo(rid: any, vencimento: string | null, emissao: string | null = '2026-03-28') {
  return registro(rid, 'termo_cessao', {
    numero_documento: '0', valor_total: '111.47', data_vencimento: vencimento, data_emissao: emissao, data_aquisicao: '2026-08-20',
    sacado_documento: '111.222.333-96', sacado_nome: 'MARIA APARECIDA FONSECA LIMA',
    cedente_nome: 'CREDORA BETA SOCIEDADE DE CREDITO DIRETO S.A', cedente_documento: '22.333.444/0001-81',
    nome_fundo: 'FUNDO ALFA FIDC RL', cnpj_fundo: '11.444.777/0001-61',
  });
}
