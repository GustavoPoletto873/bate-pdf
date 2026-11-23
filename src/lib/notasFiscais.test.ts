import { beforeAll, describe, expect, test, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Banco num diretório temporário; dados e chaves fictícios.
process.env.BATE_PDF_DADOS = mkdtempSync(join(tmpdir(), 'bate-pdf-nf-'));
let nf: typeof import('./notasFiscais');
let repo: typeof import('./repo');

beforeAll(async () => {
  nf = await import('./notasFiscais');
  repo = await import('./repo');
});

const chave = (n: number) => `352603${'0'.repeat(14)}550010${String(n).padStart(9, '0')}1000000${n % 10}0`.slice(0, 44);

function base(chaves: string[]) {
  return repo.criarBase({
    nome: 'Base NF', nome_fundo: 'FIDC EXEMPLO', cnpj_fundo: '12345678000195', data_referencia: '2026-09-30', administradora: null,
    origem: 'amostra', arquivo_origem: 'amostra.xlsx',
    titulos: chaves.map((c, i) => ({
      linha_origem: i + 2, id_base_origem: null, numero_documento: String(100 + i), sacado_nome: 'JOAO DA SILVA', sacado_documento: '12345678909',
      cedente_nome: 'EMPRESA FICTICIA LTDA', cedente_documento: '11222333000181', valor_total: '10.00', valor_aquisicao: null,
      data_emissao: '2026-08-01', data_vencimento: '2026-10-10', data_aquisicao: null, nome_fundo: 'FIDC EXEMPLO', cnpj_fundo: '12345678000195',
      tipo_recebivel: 'DUPLICATA', chave_nfe: c, lados: {},
    })),
  });
}

describe('NF Status', () => {
  test('status pelo cStat, como o Bate Lastro', () => {
    expect(nf.statusDoXml('<protNFe><cStat>100</cStat></protNFe>')).toBe('Ativa');
    expect(nf.statusDoXml('<retConsSit><cStat>101</cStat></retConsSit>')).toBe('Cancelada');
    expect(nf.chaveConsultavel('000' + '1'.repeat(41))).toBe(false);
    expect(nf.chaveConsultavel(chave(1))).toBe(true);
  });

  test('registra, filtra, e o XML relido não desfaz a consulta do SERPRO', () => {
    const id = base([]);
    nf.registrarNota({ chave_nfe: chave(1), base_id: id, status_nfe: 'Ativa', origem: 'xml_anexo', xml_content: '<a/>' });
    nf.registrarNota({ chave_nfe: chave(2), base_id: id, status_nfe: 'Cancelada', origem: 'serpro', xml_content: '<b/>' });
    nf.registrarNota({ chave_nfe: chave(2), base_id: id, status_nfe: 'Ativa', origem: 'xml_anexo', xml_content: '<c/>' });
    const todas = nf.listarNotas({ baseId: id });
    expect(todas.resumo).toMatchObject({ total: 2, ativas: 1, canceladas: 1 });
    expect(nf.listarNotas({ baseId: id, status: 'cancelada' }).dados.map((n) => n.chave_nfe)).toEqual([chave(2)]);
    expect(nf.listarNotas({ chave: chave(1).slice(-10) }).dados).toHaveLength(1);
    const n2 = todas.dados.find((n) => n.chave_nfe === chave(2))!;
    expect(nf.xmlDaNota(n2.id).xml).toBe('<b/>');
  });

  test('consulta no SERPRO: token, uma chamada por chave, sem vazar a credencial', async () => {
    process.env.SERPRO_CONSUMER_KEY = 'chave-ficticia';
    process.env.SERPRO_SECRET_KEY = 'segredo-ficticio';
    const id = base([chave(11), chave(12), chave(13), '0001']);
    const buscar = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith('/token')) return Response.json({ access_token: 'tok' });
      if (u.endsWith(chave(11))) return new Response('<cStat>100</cStat>');
      if (u.endsWith(chave(12))) return new Response('<cStat>101</cStat>');
      return new Response('falhou segredo-ficticio', { status: 500 });
    });
    const p = nf.iniciarConsulta(id, buscar as unknown as typeof fetch);
    expect(p.total).toBe(3);
    await vi.waitFor(() => expect(nf.progressoConsulta(id)?.terminou).toBe(true));
    expect(nf.progressoConsulta(id)).toMatchObject({ feitas: 3, ativas: 1, canceladas: 1, erros: 1 });
    const erro = nf.listarNotas({ baseId: id, status: 'erro' }).dados[0];
    expect(erro.mensagem).toContain('***');
    expect(erro.mensagem).not.toContain('segredo-ficticio');
    expect(buscar).toHaveBeenCalledTimes(4);
    delete process.env.SERPRO_CONSUMER_KEY;
    delete process.env.SERPRO_SECRET_KEY;
  });

  test('sem credenciais, a consulta é recusada com o que fazer', () => {
    const id = base([chave(21)]);
    expect(() => nf.iniciarConsulta(id)).toThrow(/SERPRO_CONSUMER_KEY/);
  });
});
