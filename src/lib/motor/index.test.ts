/** A entrada pública: o que carregar_e_pre_classificar faz no Python, sem banco (dados fictícios). */
import { describe, expect, test } from 'vitest';
import { type PaginaTexto, paginasDaBase, preClassificar } from './index';
import { CCB, TERMO_ANEXO_MULTILINHA, TERMO_QUADRO_RESUMO, registro, registroTermo } from './testes-util';
import { normalizarTexto } from './valores';

const pg = (pdf: string, pagina: number, texto: string): PaginaTexto => ({ pdf, pagina, texto_normalizado: normalizarTexto(texto) });

describe('preClassificar', () => {
  test('não achado sai D sem valor', () => {
    const r = preClassificar({
      pendencias: [registro(1, 'lastro', { valor_total: '999.99', sacado_documento: '111.222.333-96' }) as never],
      paginas: [pg('ccb.pdf', 1, CCB)],
    });
    expect(r.resultados[0].campos.valor_total).toMatchObject({ valor: 'D', encontrado: '', regra: 'nao_encontrado' });
    expect(Object.values(r.resultados[0].campos).some((s) => s.valor === 'P')).toBe(false);
  });

  test('PDF acessório (seguro) fica de fora e as páginas saem ordenadas', () => {
    const paginas = paginasDaBase([
      pg('b.pdf', 2, 'segunda'), pg('seguro.pdf', 1, 'DADOS DO SEGURADO (VOCÊ)\r\nNOME: X'), pg('b.pdf', 1, 'primeira'), pg('a.pdf', 1, 'a'),
    ]);
    expect(paginas.map((p) => `${p.pdf}:${p.numero}`)).toEqual(['a.pdf:1', 'b.pdf:1', 'b.pdf:2']);
  });

  test('o termo de outra base do fundo entra como termo externo', () => {
    const r = preClassificar({
      pendencias: [registroTermo(60, '2029-01-21') as never],
      paginas: [pg('ccb.pdf', 1, CCB)],
      outrasBases: {
        paginas: [{ ...pg('termo.pdf', 1, TERMO_QUADRO_RESUMO), base_id: 'b0' }, { ...pg('termo.pdf', 2, TERMO_ANEXO_MULTILINHA), base_id: 'b0' }],
        rotulos: { b0: 'FUNDO ALFA FIDC RL — ref. 2026-06-30' },
      },
    });
    const termo = r.resultados[0].candidatos.termo;
    expect(termo.processed_pdf).toBe('termo.pdf');
    expect(termo.base_externa).toEqual({ base_id: 'b0', rotulo: 'FUNDO ALFA FIDC RL — ref. 2026-06-30' });
  });

  test('2ª passada: a CCB que só existe noutra base do fundo vira lastro', () => {
    const r = preClassificar({
      pendencias: [registro(62, 'lastro', { valor_total: '111.47', sacado_documento: '111.222.333-96' }) as never],
      paginas: [pg('nada.pdf', 1, 'documento sem relação')],
      outrasBases: { paginas: [{ ...pg('outra_ccb.pdf', 1, CCB), base_id: 'b1' }], rotulos: { b1: 'FUNDO ALFA — ref. 2026-03-31' } },
    });
    const lastro = r.resultados[0].candidatos.lastro;
    expect(lastro.processed_pdf).toBe('outra_ccb.pdf');
    expect(lastro.base_externa).toEqual({ base_id: 'b1', rotulo: 'FUNDO ALFA — ref. 2026-03-31', tipo: 'lastro' });
    expect(r.pdfs_analisados).toBe(2);
  });

  test('termo de outra base nunca entra como lastro na 2ª passada', () => {
    const r = preClassificar({
      pendencias: [registro(63, 'lastro', { valor_total: '111.47', sacado_documento: '111.222.333-96' }) as never],
      paginas: [pg('nada.pdf', 1, 'documento sem relação')],
      outrasBases: { paginas: [{ ...pg('termo.pdf', 1, `${TERMO_QUADRO_RESUMO}111.222.333-96 r$ 111,47 21/01/2029\r\n`), base_id: 'b1' }] },
    });
    expect(r.resultados[0].candidatos.lastro).toBeUndefined();
  });

  test('sem pendências', () => {
    expect(preClassificar({ pendencias: [], paginas: [] })).toMatchObject({ total: 0, resultados: [] });
  });
});
