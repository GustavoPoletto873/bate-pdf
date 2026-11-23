import ExcelJS from 'exceljs';
import { after } from 'next/server';
import { db } from '@/lib/db';
import { ErroDeUso } from '@/lib/api';

/**
 * Análise › NF Status — porta de routes/get/acompanhamento_nota_fiscal.py e de
 * modules/nota_fiscal_eletronica.py (coletar_nota_fiscal) do Bate Lastro.
 *
 * Status como lá: cStat 101/151/110 no XML = "Cancelada"; o resto = "Ativa".
 * A consulta no SERPRO precisa de SERPRO_CONSUMER_KEY e SERPRO_SECRET_KEY no .env.local (os mesmos
 * nomes do .env do Bate Lastro). As chaves nunca vão para a tela nem para o log.
 */

export type StatusNfe = 'Ativa' | 'Cancelada' | 'Erro';
export type OrigemNfe = 'xml_anexo' | 'serpro';

export type NotaFiscal = {
  id: number;
  chave_nfe: string;
  base_id: string;
  base_nome: string | null;
  status_nfe: StatusNfe;
  origem: OrigemNfe;
  mensagem: string | null;
  consulta_data: string;
  tem_xml: boolean;
};

export type FiltroNotas = { status?: 'ativa' | 'cancelada' | 'erro' | null; baseId?: string | null; chave?: string | null };

export function filtroDaUrl(url: URL): FiltroNotas {
  const status = url.searchParams.get('status');
  return {
    status: status === 'ativa' || status === 'cancelada' || status === 'erro' ? status : null,
    baseId: url.searchParams.get('base'),
    chave: url.searchParams.get('chave'),
  };
}

export function statusDoXml(xml: string): Exclude<StatusNfe, 'Erro'> {
  return /<cStat>(101|151|110)<\/cStat>/.test(xml) ? 'Cancelada' : 'Ativa';
}

/** Chave que vale consultar: 44+ dígitos e não começa com 000 (mesma regra do Bate Lastro). */
export function chaveConsultavel(chave: string | null | undefined): chave is string {
  const c = (chave ?? '').replace(/\D/g, '');
  return c.length >= 44 && !c.startsWith('000');
}

export async function registrarNota(n: { chave_nfe: string; base_id: string; status_nfe: StatusNfe; origem: OrigemNfe; xml_content?: string | null; mensagem?: string | null }, agora = new Date()): Promise<void> {
  await (await db()).prepare(`INSERT INTO notas_fiscais (chave_nfe, base_id, status_nfe, origem, mensagem, xml_content, consulta_data)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (chave_nfe, base_id) DO UPDATE SET status_nfe = excluded.status_nfe, origem = excluded.origem,
        mensagem = excluded.mensagem, xml_content = COALESCE(excluded.xml_content, notas_fiscais.xml_content),
        consulta_data = excluded.consulta_data
      -- O XML relido no Anexo não desfaz o que o SERPRO respondeu (a consulta é mais nova que o protocolo).
      WHERE NOT (excluded.origem = 'xml_anexo' AND notas_fiscais.origem = 'serpro' AND notas_fiscais.status_nfe <> 'Erro')`)
    .run(n.chave_nfe.replace(/\D/g, ''), n.base_id, n.status_nfe, n.origem, n.mensagem ?? null, n.xml_content ?? null, agora.toISOString());
}

function condicoes(f: FiltroNotas): { where: string; params: string[] } {
  const partes: string[] = [];
  const params: string[] = [];
  if (f.status === 'ativa') partes.push("n.status_nfe = 'Ativa'");
  else if (f.status === 'cancelada') partes.push("n.status_nfe = 'Cancelada'");
  else if (f.status === 'erro') partes.push("n.status_nfe = 'Erro'");
  if (f.baseId?.trim()) { partes.push('(n.base_id LIKE ? OR b.nome LIKE ?)'); params.push(`%${f.baseId.trim()}%`, `%${f.baseId.trim()}%`); }
  const chave = (f.chave ?? '').replace(/\D/g, '');
  if (chave) { partes.push('n.chave_nfe LIKE ?'); params.push(`%${chave}%`); }
  return { where: partes.length ? `WHERE ${partes.join(' AND ')}` : '', params };
}

export async function listarNotas(f: FiltroNotas & { pagina?: number; tamanho?: number } = {}) {
  const c = await db();
  const tamanho = Math.min(100, Math.max(1, f.tamanho ?? 20));
  const { where, params } = condicoes(f);
  const resumo = (await c.prepare(`SELECT COUNT(*) total,
      COALESCE(SUM(n.status_nfe = 'Ativa'), 0) ativas, COALESCE(SUM(n.status_nfe = 'Cancelada'), 0) canceladas, COALESCE(SUM(n.status_nfe = 'Erro'), 0) erros
    FROM notas_fiscais n LEFT JOIN bases b ON b.id = n.base_id ${where}`).get<{ total: number; ativas: number; canceladas: number; erros: number }>(...params))!;
  const paginas = Math.max(1, Math.ceil(resumo.total / tamanho));
  const pagina = Math.min(paginas, Math.max(1, f.pagina ?? 1));
  const dados = ((await c.prepare(`SELECT n.id, n.chave_nfe, n.base_id, b.nome AS base_nome, n.status_nfe, n.origem, n.mensagem, n.consulta_data,
      (n.xml_content IS NOT NULL) AS tem_xml
    FROM notas_fiscais n LEFT JOIN bases b ON b.id = n.base_id ${where}
    ORDER BY n.consulta_data DESC, n.id DESC LIMIT ? OFFSET ?`).all(...params, tamanho, (pagina - 1) * tamanho)) as (Omit<NotaFiscal, 'tem_xml'> & { tem_xml: number })[])
    .map((n) => ({ ...n, tem_xml: Boolean(n.tem_xml) }));
  return {
    dados,
    paginacao: { pagina, tamanho, total: resumo.total, paginas },
    resumo: { total: resumo.total, ativas: resumo.ativas, canceladas: resumo.canceladas, erros: resumo.erros },
  };
}

export async function xmlDaNota(id: number): Promise<{ chave_nfe: string; xml: string }> {
  const r = await (await db()).prepare('SELECT chave_nfe, xml_content FROM notas_fiscais WHERE id = ?').get<{ chave_nfe: string; xml_content: string | null }>(id);
  if (!r?.xml_content) throw new ErroDeUso('XML não encontrado para esta nota fiscal.', 404);
  return { chave_nfe: r.chave_nfe, xml: r.xml_content };
}

const ROTULO_ORIGEM: Record<OrigemNfe, string> = { xml_anexo: 'XML do Anexo', serpro: 'Consulta SERPRO' };

export async function exportarNotas(f: FiltroNotas): Promise<Buffer> {
  const { where, params } = condicoes(f);
  const linhas = (await (await db()).prepare(`SELECT n.chave_nfe, n.consulta_data, n.status_nfe, n.origem, n.base_id, b.nome AS base_nome, n.mensagem
    FROM notas_fiscais n LEFT JOIN bases b ON b.id = n.base_id ${where} ORDER BY n.consulta_data DESC`).all(...params)) as
    { chave_nfe: string; consulta_data: string; status_nfe: string; origem: OrigemNfe; base_id: string; base_nome: string | null; mensagem: string | null }[];
  if (!linhas.length) throw new ErroDeUso('Nenhuma nota fiscal para exportar com esse filtro.', 404);
  const livro = new ExcelJS.Workbook();
  const ws = livro.addWorksheet('Notas Fiscais', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'Chave NFe', key: 'chave', width: 48 },
    { header: 'Data Consulta', key: 'data', width: 20 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Origem', key: 'origem', width: 18 },
    { header: 'Base', key: 'base', width: 36 },
    { header: 'Base ID', key: 'base_id', width: 38 },
    { header: 'Mensagem', key: 'mensagem', width: 40 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const l of linhas) {
    ws.addRow({
      chave: l.chave_nfe, data: new Date(l.consulta_data).toLocaleString('pt-BR'), status: l.status_nfe, origem: ROTULO_ORIGEM[l.origem] ?? l.origem,
      base: l.base_nome ?? '', base_id: l.base_id, mensagem: l.mensagem ?? '',
    });
  }
  return Buffer.from(await livro.xlsx.writeBuffer());
}

// ---------------------------------------------------------------------------
// Consulta no SERPRO (Consulta NF-e DF)
// ---------------------------------------------------------------------------

export function credenciaisSerpro(): { chave: string; segredo: string } | null {
  const chave = process.env.SERPRO_CONSUMER_KEY?.trim();
  const segredo = process.env.SERPRO_SECRET_KEY?.trim();
  return chave && segredo ? { chave, segredo } : null;
}

export async function chavesDaBase(baseId: string): Promise<string[]> {
  const linhas = await (await db()).prepare('SELECT DISTINCT chave_nfe FROM titulos WHERE base_id = ? AND chave_nfe IS NOT NULL').all<{ chave_nfe: string }>(baseId);
  return [...new Set(linhas.map((l) => l.chave_nfe.replace(/\D/g, '')).filter(chaveConsultavel))];
}

type Progresso = { base_id: string; total: number; feitas: number; ativas: number; canceladas: number; erros: number; terminou: boolean; erro: string | null; iniciado_em: string };
const progressos = new Map<string, Progresso>();

export function progressoConsulta(baseId: string): Progresso | null {
  return progressos.get(baseId) ?? null;
}

/** Tira as credenciais de qualquer texto que vá para a tela. */
function semSegredo(texto: string): string {
  const cred = credenciaisSerpro();
  let t = texto;
  if (cred) for (const s of [cred.chave, cred.segredo]) t = t.split(s).join('***');
  return t.slice(0, 300);
}

export type Buscar = typeof fetch;

async function tokenSerpro(buscar: Buscar): Promise<string> {
  const cred = credenciaisSerpro();
  if (!cred) throw new ErroDeUso('Configure SERPRO_CONSUMER_KEY e SERPRO_SECRET_KEY no .env.local para consultar as notas.');
  const r = await buscar('https://gateway.apiserpro.serpro.gov.br/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${cred.chave}:${cred.segredo}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!r.ok) throw new ErroDeUso(`O SERPRO recusou as credenciais (HTTP ${r.status}). Confira as chaves no .env.local.`, 502);
  const j = (await r.json()) as { access_token?: string };
  if (!j.access_token) throw new ErroDeUso('O SERPRO não devolveu o token de acesso.', 502);
  return j.access_token;
}

/**
 * Consulta todas as chaves da base, uma por vez (como o Bate Lastro). Roda em segundo plano:
 * a tela acompanha por `progressoConsulta`.
 */
export async function iniciarConsulta(baseId: string, buscar: Buscar = fetch): Promise<Progresso> {
  const atual = progressos.get(baseId);
  if (atual && !atual.terminou) throw new ErroDeUso('A consulta desta base já está rodando.', 409);
  if (!credenciaisSerpro()) throw new ErroDeUso('Configure SERPRO_CONSUMER_KEY e SERPRO_SECRET_KEY no .env.local (os mesmos nomes do Bate Lastro) e reinicie o app.');
  const chaves = await chavesDaBase(baseId);
  if (!chaves.length) throw new ErroDeUso('Esta base não tem chave de NF-e válida (CHAVE_NFE com 44 dígitos) para consultar.');
  const p: Progresso = { base_id: baseId, total: chaves.length, feitas: 0, ativas: 0, canceladas: 0, erros: 0, terminou: false, erro: null, iniciado_em: new Date().toISOString() };
  progressos.set(baseId, p);
  const tarefa = (async () => {
    try {
      const token = await tokenSerpro(buscar);
      for (const chave of chaves) {
        try {
          const r = await buscar(`https://gateway.apiserpro.serpro.gov.br/consulta-nfe-df/api/v1/nfe/${chave}`, {
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/xml' },
          });
          const corpo = await r.text();
          if (!r.ok) {
            await registrarNota({ chave_nfe: chave, base_id: baseId, status_nfe: 'Erro', origem: 'serpro', mensagem: `HTTP ${r.status}: ${semSegredo(corpo)}` });
            p.erros++;
          } else {
            const status = statusDoXml(corpo);
            await registrarNota({ chave_nfe: chave, base_id: baseId, status_nfe: status, origem: 'serpro', xml_content: corpo });
            if (status === 'Ativa') p.ativas++;
            else p.canceladas++;
          }
        } catch (e) {
          await registrarNota({ chave_nfe: chave, base_id: baseId, status_nfe: 'Erro', origem: 'serpro', mensagem: semSegredo(e instanceof Error ? e.message : String(e)) });
          p.erros++;
        }
        p.feitas++;
      }
    } catch (e) {
      p.erro = semSegredo(e instanceof Error ? e.message : 'Falha na consulta.');
    } finally {
      p.terminou = true;
    }
  })();
  // Na nuvem a função só vive enquanto a requisição dura: segura até a consulta terminar.
  try { after(() => tarefa); } catch { /* fora de requisição (testes) */ }
  return p;
}

/** Bases com chave de NF-e, para o seletor da consulta. */
export async function basesComChaves(): Promise<{ id: string; nome: string; chaves: number; consultadas: number }[]> {
  const linhas = await (await db()).prepare(`SELECT b.id, b.nome,
      (SELECT COUNT(DISTINCT t.chave_nfe) FROM titulos t WHERE t.base_id = b.id AND length(t.chave_nfe) >= 44) AS chaves,
      (SELECT COUNT(*) FROM notas_fiscais n WHERE n.base_id = b.id) AS consultadas
    FROM bases b ORDER BY b.criado_em DESC`).all<{ id: string; nome: string; chaves: number; consultadas: number }>();
  return linhas.filter((b) => b.chaves > 0 || b.consultadas > 0);
}
