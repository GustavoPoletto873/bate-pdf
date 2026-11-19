import { deflateSync, inflateSync } from 'node:zlib';

/**
 * Imagem (JPG/PNG) → PDF de uma página, como o anexo_processamento.preparar_pdf do Bate
 * Lastro (que usa o PyMuPDF): o Gemini só recebe PDF. Sem dependência nova: o JPEG entra
 * como está (/DCTDecode) e o PNG vira /FlateDecode (com o canal alfa descartado).
 * Formato que não dá para converter limpo é recusado pedindo o PDF.
 */

export class ImagemRecusada extends Error {}

const MAX_MEGAPIXELS = 50_000_000;
const PEDIR_PDF = 'Converta a imagem para PDF e envie de novo.';

type Imagem = { largura: number; altura: number; dicionario: string; dados: Uint8Array };

function lerJpeg(b: Uint8Array): Imagem {
  if (b[0] !== 0xff || b[1] !== 0xd8) throw new ImagemRecusada(`Imagem JPG inválida. ${PEDIR_PDF}`);
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const marcador = b[i + 1];
    if (marcador === 0xd8 || marcador === 0x01 || (marcador >= 0xd0 && marcador <= 0xd7) || marcador === 0xff) { i += marcador === 0xff ? 1 : 2; continue; }
    const tamanho = (b[i + 2] << 8) | b[i + 3];
    const ehSof = marcador >= 0xc0 && marcador <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marcador);
    if (ehSof) {
      const altura = (b[i + 5] << 8) | b[i + 6];
      const largura = (b[i + 7] << 8) | b[i + 8];
      const componentes = b[i + 9];
      const cor = componentes === 1 ? '/DeviceGray' : componentes === 3 ? '/DeviceRGB' : componentes === 4 ? '/DeviceCMYK' : null;
      if (!cor || !largura || !altura) throw new ImagemRecusada(`Formato de JPG não suportado. ${PEDIR_PDF}`);
      const decode = componentes === 4 ? ' /Decode [1 0 1 0 1 0 1 0]' : '';
      return { largura, altura, dados: b, dicionario: `/ColorSpace ${cor} /BitsPerComponent 8 /Filter /DCTDecode${decode}` };
    }
    i += 2 + tamanho;
  }
  throw new ImagemRecusada(`Imagem JPG inválida. ${PEDIR_PDF}`);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Desfaz os filtros de linha do PNG (8 bits por amostra). */
function desfiltrar(dados: Uint8Array, largura: number, altura: number, bpp: number): Uint8Array {
  const linha = largura * bpp;
  const saida = new Uint8Array(linha * altura);
  let p = 0;
  for (let y = 0; y < altura; y++) {
    const filtro = dados[p++];
    const ini = y * linha;
    for (let x = 0; x < linha; x++) {
      const bruto = dados[p++];
      const a = x >= bpp ? saida[ini + x - bpp] : 0;
      const b = y > 0 ? saida[ini - linha + x] : 0;
      const c = x >= bpp && y > 0 ? saida[ini - linha + x - bpp] : 0;
      let v: number;
      switch (filtro) {
        case 0: v = bruto; break;
        case 1: v = bruto + a; break;
        case 2: v = bruto + b; break;
        case 3: v = bruto + ((a + b) >> 1); break;
        case 4: v = bruto + paeth(a, b, c); break;
        default: throw new ImagemRecusada(`Imagem PNG inválida. ${PEDIR_PDF}`);
      }
      saida[ini + x] = v & 0xff;
    }
  }
  return saida;
}

function lerPng(b: Uint8Array): Imagem {
  const assinatura = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!assinatura.every((v, i) => b[i] === v)) throw new ImagemRecusada(`Imagem PNG inválida. ${PEDIR_PDF}`);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let i = 8;
  let largura = 0, altura = 0, bits = 0, tipoCor = -1, entrelacado = 0;
  let paleta: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (i + 8 <= b.length) {
    const tamanho = dv.getUint32(i);
    const tipo = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
    const dados = b.subarray(i + 8, i + 8 + tamanho);
    if (tipo === 'IHDR') {
      largura = dv.getUint32(i + 8);
      altura = dv.getUint32(i + 12);
      bits = b[i + 16];
      tipoCor = b[i + 17];
      entrelacado = b[i + 20];
    } else if (tipo === 'PLTE') paleta = dados;
    else if (tipo === 'IDAT') idat.push(dados);
    else if (tipo === 'IEND') break;
    i += 12 + tamanho;
  }
  if (!largura || !altura || !idat.length) throw new ImagemRecusada(`Imagem PNG inválida. ${PEDIR_PDF}`);
  if (entrelacado) throw new ImagemRecusada(`PNG entrelaçado não é suportado. ${PEDIR_PDF}`);
  const comprimido = Buffer.concat(idat);
  const parametros = (cores: number, bpc: number) =>
    `/Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors ${cores} /BitsPerComponent ${bpc} /Columns ${largura} >>`;

  if ((tipoCor === 0 || tipoCor === 2) && (bits === 8 || (tipoCor === 0 && [1, 2, 4].includes(bits)))) {
    const cores = tipoCor === 2 ? 3 : 1;
    return { largura, altura, dados: comprimido,
      dicionario: `/ColorSpace ${cores === 3 ? '/DeviceRGB' : '/DeviceGray'} /BitsPerComponent ${bits} ${parametros(cores, bits)}` };
  }
  if (tipoCor === 3 && paleta && [1, 2, 4, 8].includes(bits)) {
    const hex = Buffer.from(paleta).toString('hex');
    return { largura, altura, dados: comprimido,
      dicionario: `/ColorSpace [/Indexed /DeviceRGB ${paleta.length / 3 - 1} <${hex}>] /BitsPerComponent ${bits} ${parametros(1, bits)}` };
  }
  if ((tipoCor === 4 || tipoCor === 6) && bits === 8) {
    const canais = tipoCor === 6 ? 4 : 2;
    const pixels = desfiltrar(inflateSync(comprimido), largura, altura, canais);
    const cores = canais - 1;
    const semAlfa = new Uint8Array(largura * altura * cores);
    for (let p = 0, q = 0; p < pixels.length; p += canais) for (let k = 0; k < cores; k++) semAlfa[q++] = pixels[p + k];
    return { largura, altura, dados: deflateSync(semAlfa),
      dicionario: `/ColorSpace ${cores === 3 ? '/DeviceRGB' : '/DeviceGray'} /BitsPerComponent 8 /Filter /FlateDecode` };
  }
  throw new ImagemRecusada(`Formato de PNG não suportado (${bits} bits). ${PEDIR_PDF}`);
}

function montarPdf(img: Imagem): Uint8Array {
  // Página do tamanho da imagem (72 pt por polegada a 96 px), limitada ao máximo do PDF.
  let escala = 0.75;
  const maior = Math.max(img.largura, img.altura) * escala;
  if (maior > 14_000) escala *= 14_000 / maior;
  const w = +(img.largura * escala).toFixed(2);
  const h = +(img.altura * escala).toFixed(2);
  const conteudo = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
  const partes: (string | Uint8Array)[] = [];
  const offsets: number[] = [];
  let tamanho = 0;
  const add = (p: string | Uint8Array) => {
    const bytes = typeof p === 'string' ? Buffer.from(p, 'latin1') : p;
    partes.push(bytes);
    tamanho += bytes.length;
  };
  const objeto = (n: number, corpo: string | (string | Uint8Array)[]) => {
    offsets[n] = tamanho;
    add(`${n} 0 obj\n`);
    for (const p of Array.isArray(corpo) ? corpo : [corpo]) add(p);
    add('\nendobj\n');
  };
  add('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
  objeto(1, '<< /Type /Catalog /Pages 2 0 R >>');
  objeto(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  objeto(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  objeto(4, [`<< /Type /XObject /Subtype /Image /Width ${img.largura} /Height ${img.altura} ${img.dicionario} /Length ${img.dados.length} >>\nstream\n`, img.dados, '\nendstream']);
  objeto(5, `<< /Length ${conteudo.length} >>\nstream\n${conteudo}\nendstream`);
  const xref = tamanho;
  add(`xref\n0 6\n0000000000 65535 f \n${[1, 2, 3, 4, 5].map((n) => `${String(offsets[n]).padStart(10, '0')} 00000 n \n`).join('')}`);
  add(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Uint8Array(Buffer.concat(partes.map((p) => (typeof p === 'string' ? Buffer.from(p, 'latin1') : p))));
}

/** Converte JPG/PNG em PDF. Lança ImagemRecusada com a mensagem para a pessoa. */
export function imagemParaPdf(bytes: Uint8Array, ext: string): Uint8Array {
  const img = ext === '.png' ? lerPng(bytes) : lerJpeg(bytes);
  if (img.largura * img.altura > MAX_MEGAPIXELS) throw new ImagemRecusada('Imagem excede 50 megapixels.');
  return montarPdf(img);
}
