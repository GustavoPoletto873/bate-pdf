import { describe, expect, test } from 'vitest';
import JSZip from 'jszip';
import { deflateSync } from 'node:zlib';
import { caminhoRelativo, chaveDaOperacao, MAX_DOCUMENTOS, montarPreview, operacaoPelaPastaDoArquivo, previaValida } from './caminhos';
import { lerXmlDocumento, leiturasDaNfe } from './nfe';
import { imagemParaPdf, ImagemRecusada } from './imagem';
import { contarPaginas, PdfIlegivel } from './paginas';
import { expandirZip, ZipRecusado } from './zip';
import { normalizarLeitura } from '@/lib/leituras';

describe('agrupamento (agrupamentoLote.js e anexo_paths.py)', () => {
  test('agrupa pela pasta completa, distinguindo pastas com o mesmo nome', () => {
    const p = montarPreview(['a/OP/nota.xml', 'b/OP/contrato.pdf', 'a/OP/termo.pdf'], true);
    expect(p.total_operacoes).toBe(2);
    expect(p.grupos.map((g) => g.arquivos)).toEqual([['nota.xml', 'termo.pdf'], ['contrato.pdf']]);
  });
  test('duplicados sem diferenciar maiúsculas e arquivos soltos', () => {
    const p = montarPreview(['OP/nota.xml', 'op/NOTA.xml', 'solto.pdf'], true);
    expect(p.total_documentos).toBe(2);
    expect(p.duplicados).toEqual(['op/NOTA.xml']);
    expect(p.soltos).toEqual(['solto.pdf']);
    expect(previaValida(p)).toBe(false);
  });
  test('sem agrupamento aceita soltos e não cria operações', () => {
    const p = montarPreview(['nota.xml', 'OP/contrato.pdf'], false);
    expect(p.total_operacoes).toBe(0);
    expect(p.documentos.every((d) => d.operacao === null)).toBe(true);
    expect(previaValida(p)).toBe(true);
  });
  test('limite de documentos', () => {
    const paths = Array.from({ length: MAX_DOCUMENTOS }, (_, i) => `op/${i}.pdf`);
    expect(montarPreview(paths, true).excedeLimite).toBe(false);
    expect(montarPreview([...paths, 'op/extra.pdf'], true).excedeLimite).toBe(true);
  });
  test('caminho_relativo recusa absoluto, .., : e controle', () => {
    expect(caminhoRelativo('a\\b\\c.pdf')).toBe('a/b/c.pdf');
    for (const ruim of ['/a.pdf', 'a/../b.pdf', 'C:/a.pdf', 'a//b.pdf', 'a/\u0001.pdf', '']) expect(() => caminhoRelativo(ruim)).toThrow('Caminho relativo inválido');
    expect(operacaoPelaPastaDoArquivo('raiz/000.296.826-65_300422131/CCB.pdf')).toEqual({ nome: '000.296.826-65_300422131', caminho: 'raiz/000.296.826-65_300422131' });
    expect(operacaoPelaPastaDoArquivo('CCB.pdf')).toBeNull();
    expect(chaveDaOperacao('Raiz/OP/x.pdf', true)?.chave).toBe('raiz/op');
    expect(chaveDaOperacao('Raiz/OP/x.pdf', false)?.chave).toBe('raiz/op/x.pdf');
  });
});

const NFE = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <NFe><infNFe Id="NFe35260811222333000181550010000012341000012345" versao="4.00">
    <ide><nNF>1234</nNF><dhEmi>2026-08-01T10:00:00-03:00</dhEmi></ide>
    <emit><CNPJ>11222333000181</CNPJ><xNome>EMPRESA FICTICIA &amp; CIA LTDA</xNome></emit>
    <dest><CPF>12345678909</CPF><xNome>JOAO DA SILVA</xNome></dest>
    <cobr><dup><nDup>001</nDup><dVenc>2026-09-10</dVenc><vDup>1613.33</vDup></dup>
          <dup><nDup>002</nDup><dVenc>2026-10-10</dVenc><vDup>1613.34</vDup></dup></cobr>
  </infNFe></NFe>
  <protNFe><infProt><chNFe>35260811222333000181550010000012341000012345</chNFe><cStat>100</cStat></infProt></protNFe>
</nfeProc>`;

describe('NF-e XML (nota_fiscal_eletronica._processar_xml_nfe)', () => {
  test('uma leitura por duplicata', () => {
    const r = lerXmlDocumento(NFE);
    expect(r.tipo).toBe('nfe_xml');
    if (r.tipo !== 'nfe_xml') return;
    expect(r.status_nfe).toBe('Ativa');
    expect(r.registros).toHaveLength(2);
    expect(r.registros[0]).toMatchObject({ NU_DOCUMENTO: '1234-001', DOC_CEDENTE: '11.222.333/0001-81', DOC_SACADO: '123.456.789-09', NOME_CEDENTE: 'EMPRESA FICTICIA & CIA LTDA', DATA_EMISSAO: '2026-08-01', NUMERO_PARCELA: 1, QUANTIDADE_PARCELAS: 2 });
    const linhas = leiturasDaNfe(r.registros, { operacaoId: 'op', documentoId: 1 }).map(normalizarLeitura);
    expect(linhas[1]).toMatchObject({ tipo_recebivel: 'NOTA FISCAL ELETRONICA', valor_nominal: '1613.34', data_vencimento: '2026-10-10', numero_documento: '1234-002' });
  });
  test('XML sem NF-e, sem duplicatas e com DTD', () => {
    expect(lerXmlDocumento('<raiz><x>1</x></raiz>').tipo).toBe('outro_xml');
    expect(() => lerXmlDocumento(NFE.replace(/<cobr>[\s\S]*<\/cobr>/, ''))).toThrow('Nenhuma duplicata (cobr/dup) encontrada no XML');
    expect(() => lerXmlDocumento('<!DOCTYPE x [<!ENTITY a "b">]><x>&a;</x>')).toThrow('XML com DTD/entidades não é permitido');
  });
});

function pngRgb(largura: number, altura: number, tipoCor: 2 | 6): Uint8Array {
  const canais = tipoCor === 6 ? 4 : 3;
  const linhas: number[] = [];
  for (let y = 0; y < altura; y++) {
    linhas.push(0);
    for (let x = 0; x < largura * canais; x++) linhas.push((x * 37 + y) & 0xff);
  }
  const chunk = (tipo: string, dados: Uint8Array) => {
    const b = Buffer.alloc(12 + dados.length);
    b.writeUInt32BE(dados.length, 0);
    b.write(tipo, 4, 'latin1');
    Buffer.from(dados).copy(b, 8);
    return b; // CRC não conferido pelo conversor
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr[8] = 8; ihdr[9] = tipoCor;
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.from(linhas))), chunk('IEND', new Uint8Array(0))]));
}

describe('imagem → PDF e contagem de páginas (PDFium)', () => {
  test('PNG RGB e RGBA viram PDF de uma página', async () => {
    for (const tipo of [2, 6] as const) {
      const pdf = imagemParaPdf(pngRgb(4, 3, tipo), '.png');
      expect(new TextDecoder('latin1').decode(pdf.slice(0, 8))).toBe('%PDF-1.4');
      expect(await contarPaginas(pdf)).toBe(1);
    }
  });
  test('JPEG inválido é recusado pedindo PDF; PDF quebrado não abre', async () => {
    expect(() => imagemParaPdf(new Uint8Array([1, 2, 3]), '.jpg')).toThrow(ImagemRecusada);
    await expect(contarPaginas(new TextEncoder().encode('%PDF-1.4 lixo'))).rejects.toBeInstanceOf(PdfIlegivel);
  });
});

describe('ZIP no servidor (anexo_service.expandir_arquivo)', () => {
  test('caminho interno, ignora __MACOSX e formatos não aceitos', async () => {
    const zip = new JSZip();
    zip.file('OP1/ccb.pdf', '%PDF-1.4 teste');
    zip.file('OP1/nota.xml', '<x/>');
    zip.file('OP1/leia.txt', 'x');
    zip.file('__MACOSX/OP1/._ccb.pdf', 'x');
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    const r = await expandirZip(bytes, 'lote.zip', { ler: true });
    expect(r.map((e) => e.caminho).sort()).toEqual(['OP1/ccb.pdf', 'OP1/nota.xml']);
    expect(r.find((e) => e.caminho === 'OP1/ccb.pdf')?.origem).toBe('lote.zip!/OP1/ccb.pdf');
    expect(new TextDecoder().decode(r.find((e) => e.caminho === 'OP1/nota.xml')!.bytes)).toBe('<x/>');
  });
  test('bomba de compressão e ZIP corrompido são recusados', async () => {
    const zip = new JSZip();
    zip.file('a.pdf', 'A'.repeat(500_000));
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    await expect(expandirZip(bytes, 'b.zip')).rejects.toThrow('ZIP excede os limites');
    await expect(expandirZip(new Uint8Array([1, 2, 3, 4]), 'c.zip')).rejects.toBeInstanceOf(ZipRecusado);
  });
});
