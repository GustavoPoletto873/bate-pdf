import { ErroDeUso, responder } from '@/lib/api';
import { criarBase, listarBases } from '@/lib/repo';
import { lerPlanilha } from '@/lib/planilha/importar';
import type { Lado } from '@/lib/campos';

export const dynamic = 'force-dynamic';

export async function GET() {
  return responder(() => Response.json({ bases: listarBases() }));
}

/**
 * Cria uma base a partir da planilha (multipart):
 * - arquivo: resultados_matching_*.xlsx do Bate Lastro, ou a amostra (.xlsx/.csv)
 * - previa=1: só lê e devolve o resumo, sem gravar
 * - nome, nome_fundo, cnpj_fundo, data_referencia, administradora (opcionais)
 * - lados: "termo,lastro" — na amostra, quais lados nascem pendentes
 */
export async function POST(request: Request) {
  return responder(async () => {
    const form = await request.formData();
    const arquivo = form.get('arquivo');
    if (!(arquivo instanceof File)) throw new ErroDeUso('Envie a planilha da base.');
    const conteudo = new Uint8Array(await arquivo.arrayBuffer());
    const lido = await lerPlanilha(conteudo, arquivo.name);

    const campo = (n: string) => {
      const v = form.get(n);
      return typeof v === 'string' && v.trim() ? v.trim() : null;
    };
    const cnpjInformado = campo('cnpj_fundo')?.replace(/\D/g, '') || null;
    if (cnpjInformado && cnpjInformado.length !== 14) throw new ErroDeUso('O CNPJ do fundo precisa ter 14 dígitos.');
    const lados = (campo('lados') ?? 'termo,lastro').split(',').filter((l): l is Lado => l === 'termo' || l === 'lastro');

    const resumo = {
      formato: lido.formato,
      titulos: lido.titulos.length,
      pendentes: {
        termo: lido.formato === 'amostra' ? (lados.includes('termo') ? lido.titulos.length : 0) : lido.titulos.filter((t) => t.lados.termo === 'pendente').length,
        lastro: lido.formato === 'amostra' ? (lados.includes('lastro') ? lido.titulos.length : 0) : lido.titulos.filter((t) => t.lados.lastro === 'pendente').length,
      },
      ja_batidos: lido.titulos.reduce((n, t) => n + (t.lados.termo === 'ja_batido' ? 1 : 0) + (t.lados.lastro === 'ja_batido' ? 1 : 0), 0),
      nome_fundo: lido.nome_fundo,
      cnpj_fundo: lido.cnpj_fundo,
      mapeamento: lido.mapeamento,
      avisos: lido.avisos,
      exemplo: lido.titulos.slice(0, 5),
    };
    if (campo('previa') === '1') return Response.json({ previa: resumo });

    if (!lados.length) throw new ErroDeUso('Escolha ao menos um lado (Termo ou Lastro) para conferir.');
    const nomeFundo = campo('nome_fundo') ?? lido.nome_fundo;
    const cnpj = cnpjInformado ?? lido.cnpj_fundo;
    const dataRef = campo('data_referencia');
    const nome = campo('nome') ?? [nomeFundo ?? arquivo.name.replace(/\.[^.]+$/, ''), dataRef].filter(Boolean).join(' — ');
    const id = criarBase({
      nome,
      nome_fundo: nomeFundo,
      cnpj_fundo: cnpj,
      data_referencia: dataRef,
      administradora: campo('administradora'),
      origem: lido.formato,
      arquivo_origem: arquivo.name,
      titulos: lido.titulos,
      lados,
    });
    return Response.json({ id, resumo }, { status: 201 });
  });
}
