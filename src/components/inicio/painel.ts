import { painelInicial, type CartaoAuditoria, type ResumoStatus } from '@/app/api/auditorias/selecao';

/**
 * Dados da Home (PaginaInicial.jsx do Bate Lastro): saudação pela hora, a frase-resumo, as bases em
 * andamento para "continue de onde parou" e a contagem por status. Só no servidor (lê o banco).
 */

const numero = new Intl.NumberFormat('pt-BR');
const plural = (n: number, um: string, varios: string) => `${numero.format(n)} ${n === 1 ? um : varios}`;

export function saudacao(data: Date): string {
  const h = data.getHours();
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

/** "há 5 min", "há 3 h", "ontem", "há 4 dias" (haQuantoTempo). */
export function haQuantoTempo(iso: string | null, agora: Date): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const min = Math.max(0, Math.floor((agora.getTime() - t) / 60_000));
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const dias = Math.floor(h / 24);
  if (dias === 1) return 'ontem';
  if (dias < 30) return `há ${dias} dias`;
  return new Date(t).toLocaleDateString('pt-BR');
}

export function fraseDoResumo(resumo: ResumoStatus): string {
  const partes = [
    resumo.em_andamento ? `você tem ${plural(resumo.em_andamento, 'auditoria', 'auditorias')} em andamento` : null,
    resumo.a_iniciar ? `${plural(resumo.a_iniciar, 'base espera', 'bases esperam')} os bates` : null,
  ].filter(Boolean);
  if (partes.length) return `Hoje ${partes.join(' e ')}.`;
  return resumo.total ? 'Nenhuma auditoria pendente.' : 'Tudo pronto para a sua primeira auditoria.';
}

export type PainelInicio = {
  saudacao: string;
  data: string;
  frase: string;
  resumo: ResumoStatus;
  em_andamento: (CartaoAuditoria & { quando: string | null })[];
};

export async function montarPainelInicio(agora = new Date()): Promise<PainelInicio> {
  const { resumo, em_andamento } = await painelInicial(4);
  return {
    saudacao: saudacao(agora),
    data: agora.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).replace(/^./, (c) => c.toUpperCase()),
    frase: fraseDoResumo(resumo),
    resumo,
    em_andamento: em_andamento.map((c) => ({ ...c, quando: haQuantoTempo(c.ultima_atividade, agora) })),
  };
}
