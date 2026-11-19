"""Oráculo: roda o motor Python do Bate Lastro (só a parte pura) sobre casos
FICTÍCIOS e grava entrada + saída esperada em JSON.

Segurança: nada de banco. Antes de importar o motor, qualquer import de
psycopg2/db/boto3/dotenv/sqlalchemy é bloqueado (levanta ImportError) — se o
motor tentasse conectar, o script quebra em vez de tocar produção.

Uso: python -I oraculo.py <backend> <casos.json> <saida.json>
"""
import importlib.abc
import json
import os
import sys

BLOQUEADOS = ('psycopg2', 'db', 'boto3', 'botocore', 'dotenv', 'sqlalchemy', 'asyncpg', 'requests', 'httpx')


class Bloqueio(importlib.abc.MetaPathFinder):
    def find_spec(self, nome, caminho, alvo=None):
        if nome.split('.')[0] in BLOQUEADOS:
            raise ImportError(f'import bloqueado no oráculo: {nome}')
        return None


sys.meta_path.insert(0, Bloqueio())
os.environ['PRE_CLASSIFICACAO_CACHE_PAGINAS'] = '0'
os.environ.pop('PRE_CLASSIFICACAO_PADROES', None)

backend, entrada, saida = sys.argv[1:4]
sys.path.insert(0, backend)

from services.pre_classificacao_service import (  # noqa: E402
    _RE_DOCUMENTO_ACESSORIO, Pagina, aprendizado_da_base, nao_encontrado_vira_d, pre_classificar,
)
from utils.texto_normalizado import normalizar_texto  # noqa: E402


def rodar(caso):
    base = [(p['pdf'], p['pagina'], normalizar_texto(p['texto'])) for p in caso['paginas']]
    primeira = {}
    for pdf, n, t in base:
        if n == 1 and pdf not in primeira:
            primeira[pdf] = t
    mantidas = sorted((x for x in base if not _RE_DOCUMENTO_ACESSORIO.search(primeira.get(x[0], '')[:400])),
                      key=lambda x: (x[0], x[1]))
    paginas = [Pagina.de_texto(pdf, n, t) for pdf, n, t in mantidas]
    externas = [Pagina.de_texto(p['pdf'], p['pagina'], normalizar_texto(p['texto'])) for p in caso.get('paginas_externas', [])]
    aprendizado = aprendizado_da_base(caso.get('vinculos', []), paginas + externas)
    origens = {(o['registro_base_id'], o['campo']): o['coluna_arquivo'] for o in caso.get('origens', [])}
    r = pre_classificar(caso['pendencias'], paginas, caso.get('tipos_pdf', {}), set(caso.get('pdfs_com_leitura', [])),
                        origens, externas, caso.get('pdfs_externos', {}), caso.get('leituras', []),
                        caso.get('regras_fundo', {}), aprendizado, set(caso.get('pdfs_com_lastro', [])))
    return nao_encontrado_vira_d(r)


def para_json(valor):
    raise TypeError(f'valor não serializável na saída: {type(valor).__name__} {valor!r}')


with open(entrada, encoding='utf-8') as f:
    casos = json.load(f)
saidas = []
for caso in casos:
    esperado = rodar(caso)
    saidas.append({**caso, 'esperado': json.loads(json.dumps(esperado, default=para_json))})
with open(saida, 'w', encoding='utf-8') as f:
    json.dump(saidas, f, ensure_ascii=False, separators=(',', ':'))
print(f'{len(saidas)} casos gravados em {saida}')
