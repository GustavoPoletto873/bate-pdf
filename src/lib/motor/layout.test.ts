/* eslint-disable @typescript-eslint/no-explicit-any */
/** Porta de backend/tests/test_perfis_layout.py (dados fictícios). */
import { describe, expect, test } from 'vitest';
import { AprendizadoLayout, CatalogoGlobal, type Aprendizado, type Convencao, carregarCatalogo, montarCatalogo } from './layout';
import { Amostra, aplicarConvencoesAprendidas, aprendizadoDaBase, preClassificarNucleo, vereditosPelaLeitura } from './motor';
import { Contador } from './py';
import { pagina, registro } from './testes-util';

const MODELO = ['duplicata', 'mercantil', 'emitente', 'vencimento', 'sacado', 'endereco', 'pracas', 'pagamento'];
const OUTRO = ['contrato', 'prestacao', 'servicos', 'clausula', 'partes', 'foro', 'comarca', 'rescisao'];
const conv = (veredito: string, titulos: number, acordo: number, fonte: 'layout' | 'catalogo' = 'layout'): Convencao => ({ veredito, titulos, acordo, fonte });

function aprendizado() {
  const pdfs = new Map<string, Set<string>>();
  for (let i = 0; i < 6; i++) pdfs.set(`dup${i}.pdf`, new Set([...MODELO, `nome${i}`]));
  for (let i = 0; i < 3; i++) pdfs.set(`ctr${i}.pdf`, new Set(OUTRO));
  return new AprendizadoLayout(pdfs);
}

describe('AprendizadoLayout', () => {
  test('convenção só com padrão claro', () => {
    const a = aprendizado();
    for (let i = 0; i < 2; i++) a.observar(`dup${i}.pdf`, 'valor_total', 'V', i);
    expect(a.convencao('dup5.pdf', 'valor_total')).toBeNull();
    a.observar('dup2.pdf', 'valor_total', 'V', 2);
    expect(a.convencao('dup5.pdf', 'valor_total')).toEqual(conv('V', 3, 1.0));
    expect(a.convencao('dup5.pdf', 'valor_total', { excluir: 2 })).toBeNull();
    expect(a.convencao('ctr0.pdf', 'valor_total')).toBeNull();
  });

  test('time dividido não vira convenção', () => {
    const a = aprendizado();
    [...'VVVVVVVVDD'].forEach((v, i) => a.observar(`dup${i % 6}.pdf`, 'data_emissao', v, i));
    expect(a.convencao('dup0.pdf', 'data_emissao')).toBeNull();
  });

  test('um D a cada sete V ainda é padrão', () => {
    const a = aprendizado();
    [...'VVVVVVVVVVVVVVVDD'].forEach((v, i) => a.observar(`dup${i % 6}.pdf`, 'valor_total', v, i));
    expect(a.convencao('dup0.pdf', 'valor_total')).toEqual(conv('V', 17, 0.88));
  });

  test('papel e presença separam os vereditos', () => {
    const a = aprendizado();
    for (let i = 0; i < 5; i++) {
      a.observar(`dup${i % 5}.pdf`, 'nome_cessionario', 'V', i, 'lastro', true);
      a.observar(`dup${i % 5}.pdf`, 'nome_cessionario', 'D', 10 + i, 'termo', true);
    }
    expect(a.convencao('dup5.pdf', 'nome_cessionario', { papel: 'termo', presente: true })).toEqual(conv('D', 5, 1.0));
    expect(a.convencao('dup5.pdf', 'nome_cessionario', { papel: 'lastro', presente: true })).toEqual(conv('V', 5, 1.0));
    expect(a.convencao('dup5.pdf', 'nome_cessionario', { papel: 'termo' })).toBeNull();
  });

  test('derrubar valor achado pede padrão mais firme', () => {
    const a = aprendizado();
    [...'DDDDDDDDDV'].forEach((v, i) => {
      a.observar(`dup${i % 6}.pdf`, 'nome_cessionario', v, i, 'termo', true);
      a.observar(`dup${i % 6}.pdf`, 'valor_total', v, i, 'termo');
    });
    expect(a.convencao('dup0.pdf', 'nome_cessionario', { papel: 'termo', presente: true })).toBeNull();
    expect(a.convencao('dup0.pdf', 'valor_total', { papel: 'termo' })).toEqual(conv('D', 10, 0.9));
  });

  test('termo do lote pela aquisição e cedente', () => {
    const a = aprendizado();
    const chave: [string, string] = ['2026-09-01', '11222333000181'];
    for (let i = 0; i < 10; i++) a.observar_vinculo('ctr0.pdf', i, false, chave);
    a.observar_vinculo('ctr1.pdf', 99, true, chave);
    expect(a.pdf_do_lote(chave)).toBe('ctr0.pdf');
    expect(a.pdf_do_lote(chave, 0)).toBeNull();
    a.observar_vinculo('ctr2.pdf', 50, false, chave);
    expect(a.pdf_do_lote(chave)).toBe('ctr0.pdf');
    for (let i = 51; i < 53; i++) a.observar_vinculo('ctr2.pdf', i, false, chave);
    expect(a.pdf_do_lote(chave)).toBeNull();
    expect(a.pdf_do_lote(['2026-09-02', '11222333000181'])).toBeNull();
  });

  test('papel sem padrão usa o modelo se a maioria concorda', () => {
    const a = aprendizado();
    [...'VVVVVD'].forEach((v, i) => a.observar(`dup${i % 6}.pdf`, 'valor_total', v, i, 'termo'));
    for (let i = 0; i < 20; i++) a.observar(`dup${i % 6}.pdf`, 'valor_total', 'V', 100 + i, 'lastro');
    expect(a.convencao('dup0.pdf', 'valor_total', { papel: 'termo' })).toEqual(conv('V', 26, 0.96));
    const b = aprendizado();
    [...'DDV'].forEach((v, i) => b.observar(`dup${i % 6}.pdf`, 'valor_total', v, i, 'termo'));
    for (let i = 0; i < 30; i++) b.observar(`dup${i % 6}.pdf`, 'valor_total', 'V', 100 + i, 'lastro');
    expect(b.convencao('dup0.pdf', 'valor_total', { papel: 'termo' })).toBeNull();
  });

  test('layout de lote', () => {
    const a = aprendizado();
    a.observar_vinculo('ctr0.pdf', 10, false);
    expect(a.eh_layout_de_lote('ctr1.pdf')).toBe(false);
    a.observar_vinculo('ctr0.pdf', 11, false);
    expect(a.eh_layout_de_lote('ctr1.pdf')).toBe(true);
    expect(a.eh_layout_de_lote('ctr1.pdf', 11)).toBe(false);
    expect(a.eh_layout_de_lote('dup0.pdf')).toBe(false);
  });
});

const CCB_PLATAFORMA = ['cedula', 'credito', 'bancario', 'emitente', 'plataforma', 'credora', 'parcelas', 'juros'];

function baseComCcb(fundo: string, nTitulos: number, veredito: string, extra: string) {
  const pdfs = new Map<string, Set<string>>();
  for (let i = 0; i < Math.max(3, nTitulos); i++) pdfs.set(`${fundo}${i}.pdf`, new Set([...CCB_PLATAFORMA, extra, `${extra}${i}`]));
  const a = new AprendizadoLayout(pdfs);
  for (let i = 0; i < nTitulos; i++) a.observar(`${fundo}${i}.pdf`, 'valor_total', veredito, `${fundo}-${i}`, 'lastro');
  return a;
}

describe('catálogo global', () => {
  const catalogo = () => montarCatalogo(['f1', 'f2', 'f3'].map((f, i) => [`base${i}`, f, baseComCcb(f, 3, 'V', `local${i}`)] as [string, string, AprendizadoLayout]));

  test('modelo de vários fundos entra sem palavras de um fundo só', () => {
    const dados = catalogo();
    expect(dados.layouts!.length).toBe(1);
    const layout = dados.layouts![0];
    expect(new Set(layout.assinatura)).toEqual(new Set(CCB_PLATAFORMA));
    expect([layout.fundos, layout.vereditos['lastro|valor_total|0']]).toEqual([3, { V: 9, D: 0, fundos_V: 3, fundos_D: 0 }]);
  });

  test('fundo que marca diferente tira o consenso', () => {
    const bases = ['f1', 'f2', 'f3'].map((f, i) => [`base${i}`, f, baseComCcb(f, 3, 'V', `local${i}`)] as [string, string, AprendizadoLayout]);
    bases.push(['base9', 'f4', baseComCcb('f4', 2, 'D', 'local9')]);
    const novo = baseComCcb('novo', 0, 'V', 'outra');
    novo.catalogo = new CatalogoGlobal(montarCatalogo(bases));
    expect(novo.convencao('novo0.pdf', 'valor_total', { papel: 'lastro' })).toBeNull();
  });

  test('fundo novo usa o catálogo só sem exemplos próprios', () => {
    const cat = new CatalogoGlobal(catalogo());
    const novo = baseComCcb('novo', 0, 'V', 'outra');
    novo.catalogo = cat;
    expect(novo.convencao('novo0.pdf', 'valor_total', { papel: 'lastro' })).toEqual(conv('V', 9, 1.0, 'catalogo'));
    expect(novo.convencao('novo0.pdf', 'valor_total', { papel: 'termo' })).toBeNull();
    const dividido = baseComCcb('div', 0, 'V', 'outra');
    [...'VVDD'].forEach((v, i) => dividido.observar(`div${i % 3}.pdf`, 'valor_total', v, i, 'lastro'));
    dividido.catalogo = cat;
    expect(dividido.convencao('div0.pdf', 'valor_total', { papel: 'lastro' })).toBeNull();
  });

  test('dados do catálogo (JSON já lido)', () => {
    expect(carregarCatalogo(JSON.parse(JSON.stringify(catalogo())))!.length).toBe(1);
    expect(carregarCatalogo({ ...catalogo(), versao: 1 })!.length).toBe(0);
    expect(carregarCatalogo(null)).toBeNull();
  });
});

class AprendizadoFixo implements Aprendizado {
  constructor(private respostas: Record<string, Convencao>, private contagens: Record<string, Record<string, number>> = {}) {}
  convencao(_pdf: string, campo: string, o: { papel?: string | null; presente?: boolean } = {}) {
    return this.respostas[`${campo}|${o.papel ?? null}|${o.presente ?? false}`] ?? null;
  }
  vereditos(_pdf: string, campo: string, o: { papel?: string | null; presente?: boolean } = {}) {
    const c = new Contador<string>();
    for (const [k, n] of Object.entries(this.contagens[`${campo}|${o.papel ?? null}|${o.presente ?? false}`] ?? {})) c.add(k, n);
    return c;
  }
}

const fixo = (r: Record<string, Convencao>, c: Record<string, Record<string, number>> = {}) => new AprendizadoFixo(r, c);
const indiceQueTraz = (traz: boolean) => ({ amostraNoPdf: () => traz });

describe('convenção com valor achado no documento', () => {
  const amostra = () => Amostra.deRegistro(registro(1, 'termo_cessao', { nome_fundo: 'FUNDO ALFA FIDC' }), ['termo']);
  const candidatos = { termo: { processed_pdf: 'ccb.pdf' } };
  const campos = (): any => ({ nome_cessionario: { valor: 'V', encontrado: null, evidencias: [[1, 10, 20]], origem: 'termo' } });

  test('time não aceita a fonte: vira D', () => {
    const c = campos();
    aplicarConvencoesAprendidas(amostra(), c, candidatos, fixo({ 'nome_cessionario|termo|true': conv('D', 59, 0.89) }));
    expect([c.nome_cessionario.valor, c.nome_cessionario.regra]).toEqual(['D', 'convencao_do_layout']);
  });

  test('achado nunca vira V nem usa o papel errado', () => {
    const c = campos();
    aplicarConvencoesAprendidas(amostra(), c, candidatos, fixo({ 'nome_cessionario|lastro|true': conv('D', 30, 1.0) }));
    expect(c.nome_cessionario.regra).toBeUndefined();
  });

  test('campo que veio da CCB e o termo não traz segue o modelo do termo', () => {
    const a = Amostra.deRegistro(registro(1, 'termo_cessao', { sacado_documento: '111.444.777-35' }), ['termo']);
    const c: any = { sacado_documento: { valor: 'V', encontrado: null, evidencias: [[1, 5, 19]], origem: 'referencia' } };
    aplicarConvencoesAprendidas(a, c, { termo: { processed_pdf: 'termo.pdf' }, referencia: { processed_pdf: 'ccb.pdf' } },
      fixo({ 'sacado_documento|termo|false': conv('D', 20, 0.95) }), indiceQueTraz(false));
    expect([c.sacado_documento.valor, c.sacado_documento.origem]).toEqual(['D', 'termo']);
  });

  test('V achado em outro documento segue a convenção do "não traz"', () => {
    const a = Amostra.deRegistro(registro(1, 'termo_cessao', { data_vencimento: '2026-09-10' }), ['termo']);
    for (const [traz, esperado] of [[false, 'D'], [true, 'V']] as [boolean, string][]) {
      const c: any = { data_vencimento: { valor: 'V', encontrado: null, evidencias: [[1, 5, 15]], origem: 'termo' } };
      aplicarConvencoesAprendidas(a, c, { termo: { processed_pdf: 'termo.pdf' } }, fixo({ 'data_vencimento|termo|false': conv('D', 39, 0.97) }), indiceQueTraz(traz));
      expect(c.data_vencimento.valor, String(traz)).toBe(esperado);
    }
  });

  test('valor do termo segue o layout mesmo com a CCB pendente', () => {
    const a = Amostra.deRegistro(registro(1, 'termo_cessao', { valor_total: '333.33' }), ['termo', 'lastro']);
    const f = fixo({ 'valor_total|termo|false': conv('V', 30, 1.0) });
    const valor = (cands: any) => {
      const c: any = { valor_total: { valor: 'P', encontrado: null, origem: 'termo' } };
      aplicarConvencoesAprendidas(a, c, cands, f);
      return c.valor_total.valor;
    };
    expect(valor({ termo: { processed_pdf: 'termo.pdf' } })).toBe('V');
    expect(valor({ termo: { processed_pdf: 'termo.pdf' }, lastro: { processed_pdf: 'ccb.pdf' } })).toBe('V');
  });

  test('padrão de outros fundos tem regra própria e nunca dá V', () => {
    const aplicar = (v: string) => {
      const c: any = { nome_cessionario: { valor: 'P', encontrado: null, origem: 'termo' } };
      aplicarConvencoesAprendidas(amostra(), c, candidatos, fixo({ 'nome_cessionario|termo|false': conv(v, 12, 0.92, 'catalogo') }));
      return c.nome_cessionario;
    };
    expect([aplicar('D').valor, aplicar('D').regra]).toEqual(['D', 'convencao_de_outros_fundos']);
    expect(aplicar('V').valor).toBe('P');
  });

  test('achado com o time dividido no layout pede olho', () => {
    const aplicar = (contagem: Record<string, number>) => {
      const c = campos();
      aplicarConvencoesAprendidas(amostra(), c, candidatos, fixo({}, { 'nome_cessionario|termo|true': contagem }));
      return c.nome_cessionario;
    };
    const dividido = aplicar({ D: 56, V: 10 });
    expect([dividido.valor, dividido.sem_confirmacao]).toEqual(['V', 'time_dividido']);
    expect(aplicar({ V: 1403 }).sem_confirmacao).toBeUndefined();
    expect(aplicar({ D: 1, V: 3 }).sem_confirmacao).toBeUndefined();
  });

  test('V às cegas sem aprendizado fica sem confirmação', () => {
    const aplicar = (ap: Aprendizado | null) => {
      const c: any = { numero_documento: { valor: 'V', encontrado: null, regra: 'nao_consta_no_documento', origem: 'termo' } };
      const a = Amostra.deRegistro(registro(1, 'termo_cessao', { numero_documento: "'4321987" }), ['termo']);
      aplicarConvencoesAprendidas(a, c, { termo: { processed_pdf: 'termo.pdf' } }, ap);
      return c.numero_documento;
    };
    expect(aplicar(null).sem_confirmacao).toBe('sem_documento');
    const comFundo = aplicar(fixo({ 'numero_documento|termo|false': conv('V', 30, 1.0) }));
    expect([comFundo.valor, comFundo.sem_confirmacao]).toEqual(['V', undefined]);
  });

  test('documento abaixo da régua não ganha V pela convenção do layout', () => {
    const f = fixo({ 'nome_cessionario|termo|false': conv('V', 30, 1.0) });
    const aplicar = (confianca: string) => {
      const c: any = { nome_cessionario: { valor: 'P', encontrado: null, origem: 'termo' } };
      aplicarConvencoesAprendidas(amostra(), c, { termo: { processed_pdf: 'termo.pdf', confianca } }, f);
      return c.nome_cessionario;
    };
    expect(aplicar('baixa').valor).toBe('V');
    expect(aplicar('sem_candidato').valor).toBe('P');
    const c: any = { numero_documento: { valor: 'V', encontrado: null, regra: 'nao_consta_no_documento', origem: 'termo' } };
    const a = Amostra.deRegistro(registro(1, 'termo_cessao', { numero_documento: "'4321987" }), ['termo']);
    aplicarConvencoesAprendidas(a, c, { termo: { processed_pdf: 'termo.pdf', confianca: 'sem_candidato' } },
      fixo({ 'numero_documento|termo|false': conv('V', 30, 1.0) }));
    expect(c.numero_documento.sem_confirmacao).toBe('sem_documento');
  });

  test('V só de outro documento sem aprendizado fica sem confirmação', () => {
    const a = Amostra.deRegistro(registro(1, 'termo_cessao', { sacado_documento: '111.444.777-35' }), ['termo']);
    let c: any = { sacado_documento: { valor: 'V', encontrado: null, evidencias: [[1, 5, 19]], origem: 'termo' } };
    aplicarConvencoesAprendidas(a, c, { termo: { processed_pdf: 'termo.pdf' } }, null, indiceQueTraz(false));
    expect([c.sacado_documento.valor, c.sacado_documento.sem_confirmacao]).toEqual(['V', 'outro_documento']);
    c = { sacado_documento: { valor: 'V', encontrado: null, evidencias: [[1, 5, 19]], origem: 'termo' } };
    aplicarConvencoesAprendidas(a, c, { termo: { processed_pdf: 'termo.pdf' } },
      fixo({ 'sacado_documento|termo|false': conv('V', 20, 1.0) }), indiceQueTraz(false));
    expect(c.sacado_documento.sem_confirmacao).toBeUndefined();
  });
});

describe('vínculo antigo', () => {
  test('sem marcação ensina só o V da leitura igual à amostra', () => {
    const reg = {
      ...registro(1, 'duplicata', { numero_documento: "'00123", valor_total: '10.00', sacado_nome: 'Ana Lima', data_vencimento: '2026-09-10', cedente_nome: 'Papelaria Modelo' }),
      leitura_numero_documento: '123', leitura_valor_total: '10.0', leitura_sacado_nome: 'ANA  LIMA',
      leitura_data_vencimento: '2026-09-11', leitura_cedente_nome: null,
    };
    expect(vereditosPelaLeitura(reg)).toEqual({ numero_documento: 'V', valor_total: 'V', sacado_nome: 'V' });
  });
});

describe('convenção na pré-classificação', () => {
  test('três títulos conferidos ensinam o quarto', () => {
    const DUP = (n: string, nome: string, cpf: string) => `DUPLICATA MERCANTIL Nº ${n}\r\nEMITENTE PAPELARIA MODELO LTDA CNPJ 11.222.333/0001-81\r\n`
      + `SACADO ${nome} CPF ${cpf}\r\nVENCIMENTO 10/09/2026 PRACAS DE PAGAMENTO ENDERECO\r\n`;
    const TITULOS = [['70001', 'ANA LIMA SOUZA', '123.456.789-09'], ['70002', 'JOAO PEREIRA DIAS', '987.654.321-00'],
      ['70003', 'MARIA ALVES COSTA', '111.444.777-35'], ['70004', 'PEDRO ROCHA NUNES', '529.982.247-25']];
    const paginas = TITULOS.map(([n, nome, cpf], i) => pagina(`dup${i}.pdf`, 1, DUP(n, nome, cpf)));
    const regs = TITULOS.map(([n, nome, cpf], i) => registro(i, 'duplicata', {
      numero_documento: n, sacado_nome: nome, sacado_documento: cpf, valor_total: '500.00', data_vencimento: '2026-09-10', data_emissao: '2026-08-05',
    }));
    const vinculos = regs.slice(0, 3).map((r, i) => ({ ...r, processed_pdf: `dup${i}.pdf`, marcacoes_campos: { data_emissao: 'D', valor_total: 'V' } }));
    const ap = aprendizadoDaBase(vinculos, paginas);
    const sem = preClassificarNucleo([regs[3]], paginas, { tiposPdf: {}, pdfsComLeitura: [] }).resultados[0].campos;
    const com = preClassificarNucleo([regs[3]], paginas, { tiposPdf: {}, pdfsComLeitura: [], aprendizado: ap }).resultados[0].campos;
    expect([sem.data_emissao.valor, sem.data_emissao.regra]).toEqual(['V', 'data_so_na_amostra']);
    expect([com.data_emissao.valor, com.data_emissao.regra, com.data_emissao.convencao.titulos]).toEqual(['D', 'convencao_do_layout', 3]);
    expect([com.valor_total.valor, com.valor_total.regra]).toEqual(['V', 'convencao_do_layout']);
  });
});
