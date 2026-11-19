"""Gera casos FICTÍCIOS de bases do Bater PDF pro teste diferencial do motor.

Cada caso: pendências (amostra), páginas dos PDFs (texto cru, como o PDFium
extrairia), tipos/leituras/regras do fundo/vínculos conferidos. Nomes, CPFs,
CNPJs e valores são inventados (CPF/CNPJ com dígito verificador válido).

Uso: python -I gerar_casos.py <saida.json> [n_casos] [semente]
"""
import json
import random
import sys
from datetime import date, timedelta

NOMES = ['MARIA', 'JOSÉ', 'ANA', 'JOÃO', 'PEDRO', 'LÚCIA', 'CARLOS', 'FERNANDA', 'PAULO', 'BEATRIZ', 'RAFAEL',
         'JULIANA', 'ANDRÉ', 'MÁRCIA', 'CÉSAR', 'HELENA']
SOBRENOMES = ['SILVA', 'SOUZA', 'OLIVEIRA', 'PEREIRA', 'COSTA', 'ALVES', 'LIMA', 'GONÇALVES', 'ROCHA', 'NUNES', 'MELO',
              'FREITAS', 'CONCEIÇÃO', 'APARECIDA', 'FONSECA', 'BARROS']
EMPRESAS = ['PAPELARIA MODELO LTDA', 'COMERCIAL ÔMEGA EIRELI', 'MERCEARIA BOM PREÇO COMÉRCIO VAREJISTA LTDA',
            'CONSTRUTORA DELTA EMPREENDIMENTOS LTDA', 'TRANSPORTES GAMA LTDA', 'ACADEMIA EXEMPLO DE GINÁSTICA LTDA']
CEDENTES = ['CREDORA BETA SOCIEDADE DE CRÉDITO DIRETO S.A.', 'ZETA SCD S.A.', 'PAPELARIA MODELO LTDA',
            'INDÚSTRIA ÉPSILON S.A.', 'BETA SOLUÇÕES DIGITAIS SOCIEDADE DE CRÉDITO DIRETO S/A']
FUNDOS = [('FUNDO ALFA FIDC RL', 'FUNDO ALFA FUNDO DE INVESTIMENTO EM DIREITOS CREDITÓRIOS RESPONSABILIDADE LIMITADA'),
          ('FIDC SIGMA MULTISSETORIAL', 'SIGMA FUNDO DE INVESTIMENTO EM DIREITOS CREDITÓRIOS MULTISSETORIAL'),
          ('KAPPA FIDC NP', 'KAPPA FUNDO DE INVESTIMENTO EM DIREITOS CREDITÓRIOS NÃO PADRONIZADOS')]
TIPOS = ['CCB DIGITAL', 'CCB PRE DIGITAL', 'DUPLICATA', 'DM - DUPLICATA MERCANTIL', 'NOTA COMERCIAL', 'CONTRATO FISICO',
         'CPRf', 'CONFISSÃO DE DÍVIDA', 'NOTA DE DÉBITO', 'CCB/ ECONSIG', 'CCB PRE FIXADO', '', None]
MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro',
         'novembro', 'dezembro']


def dv(corpo, pesos):
    s = sum(int(d) * p for d, p in zip(corpo, pesos)) % 11
    return '0' if s < 2 else str(11 - s)


def cpf(r):
    corpo = ''.join(str(r.randint(0, 9)) for _ in range(9))
    corpo += dv(corpo, range(10, 1, -1))
    return corpo + dv(corpo, range(11, 1, -1))


def cnpj(r):
    corpo = ''.join(str(r.randint(0, 9)) for _ in range(8)) + '0001'
    corpo += dv(corpo, (5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2))
    return corpo + dv(corpo, (6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2))


def filial(d):
    corpo = d[:8] + '0002'
    corpo += dv(corpo, (5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2))
    return corpo + dv(corpo, (6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2))


def fmt_doc(d):
    if len(d) == 11:
        return f'{d[:3]}.{d[3:6]}.{d[6:9]}-{d[9:]}'
    return f'{d[:2]}.{d[2:5]}.{d[5:8]}/{d[8:12]}-{d[12:]}'


def doc_impresso(r, d):
    forma = r.random()
    if forma < 0.6:
        return fmt_doc(d)
    if forma < 0.8:
        return d
    if forma < 0.9:
        return d.lstrip('0') or d
    return fmt_doc(d)[:-3] + '-\r\n' + d[-2:] if len(d) == 11 else fmt_doc(d)


def moeda_br(c):
    inteiro, cent = divmod(c, 100)
    return f'{inteiro:,}'.replace(',', '.') + f',{cent:02d}'


def moeda_us(c):
    inteiro, cent = divmod(c, 100)
    return f'{inteiro:,}.{cent:02d}'


def data_br(d, curto=False):
    return d.strftime('%d/%m/%y' if curto else '%d/%m/%Y')


def extenso(d):
    return f'{d.day} de {MESES[d.month - 1]} de {d.year}'


def somar_meses(d, n):
    total = d.month - 1 + n
    ano, mes = d.year + total // 12, total % 12 + 1
    for dia in (d.day, 30, 29, 28):
        try:
            return date(ano, mes, dia)
        except ValueError:
            continue


def nome_pessoa(r):
    return f'{r.choice(NOMES)} {r.choice(SOBRENOMES)} {r.choice(SOBRENOMES)}'


class Titulo:
    def __init__(self, r, rid, fundo, cnpj_fundo, cedente, cnpj_cedente, aquisicao):
        self.rid = rid
        self.tipo = r.choice(TIPOS)
        self.pj = r.random() < 0.25
        self.nome = r.choice(EMPRESAS) if self.pj else nome_pessoa(r)
        self.doc = cnpj(r) if self.pj else cpf(r)
        self.cedente, self.cnpj_cedente = cedente, cnpj_cedente
        self.fundo, self.cnpj_fundo = fundo, cnpj_fundo
        forma_num = r.random()
        base = str(r.randint(100000, 99999999))
        if forma_num < 0.15:
            self.num_pdf = f'{r.randint(10, 99)}C{r.randint(1, 9)}-{r.randint(10000, 99999)}'
            self.num_amostra = "'" + self.num_pdf
        elif forma_num < 0.35:
            self.num_pdf = base
            self.num_amostra = base + f'{r.randint(1, 36):02d}'
        elif forma_num < 0.45:
            self.num_pdf = None
            self.num_amostra = '0'
        elif forma_num < 0.55:
            self.num_pdf = f'{base}-{r.randint(1, 9):02d}'
            self.num_amostra = "'00" + self.num_pdf
        else:
            self.num_pdf = base
            self.num_amostra = base
        self.valor = r.choice([r.randint(5000, 500000), r.randint(10000, 9000000), 111147, 161333, 200000])
        self.emissao = aquisicao - timedelta(days=r.randint(1, 120))
        self.parcelas = r.choice([1, 6, 12, 24, 36])
        self.primeira = somar_meses(self.emissao, 1)
        self.parcela_n = r.randint(1, self.parcelas)
        self.vencimento = somar_meses(self.primeira, self.parcela_n - 1)
        self.final = somar_meses(self.primeira, self.parcelas - 1)
        self.aquisicao = aquisicao


def registro(r, t, tipo_documento, unmatch_id):
    valor = t.valor
    venc, emis, aq = t.vencimento, t.emissao, t.aquisicao
    sorte = r.random()
    if sorte < 0.07:
        valor += r.choice([-1, 1, 3, -4])           # centavos de diferença
    elif sorte < 0.12:
        valor = r.randint(5000, 500000)             # valor que não está em lugar nenhum
    sorte = r.random()
    if sorte < 0.08:
        venc = venc + timedelta(days=1)             # planilha 1 dia depois
    elif sorte < 0.12:
        venc = None
    elif sorte < 0.16:
        venc = venc + timedelta(days=r.randint(2, 40))
    sorte = r.random()
    if sorte < 0.1:
        emis = None
    elif sorte < 0.15:
        emis = emis + timedelta(days=1)
    if r.random() < 0.08:
        aq = aq + timedelta(days=r.choice([1, 3]))
    elif r.random() < 0.05:
        aq = None
    doc = t.doc
    if len(doc) == 14 and r.random() < 0.3:
        doc = filial(doc)
    elif r.random() < 0.06:
        doc = doc.lstrip('0') or doc
    nome = t.nome
    if r.random() < 0.1:
        nome = ' '.join(nome.split()[:2]) + ' DE ARAÚJO'
    return {
        'unmatch_id': unmatch_id, 'registro_base_id': t.rid, 'registro_leitura_id': -1, 'tipo_documento': tipo_documento,
        'base_tipo_recebivel': t.tipo, 'base_numero_documento': t.num_amostra,
        'base_sacado_nome': nome, 'base_sacado_documento': fmt_doc(doc) if r.random() < 0.7 else doc,
        'base_cedente_nome': t.cedente, 'base_cedente_documento': fmt_doc(t.cnpj_cedente),
        'base_valor_total': f'{valor // 100}.{valor % 100:02d}',
        'base_data_emissao': emis.isoformat() if emis else None,
        'base_data_vencimento': venc.isoformat() if venc else None,
        'base_nome_fundo': t.fundo, 'base_cnpj_fundo': fmt_doc(t.cnpj_fundo),
        'base_data_aquisicao': aq.isoformat() if aq else None,
    }


def ccb_texto(r, t, outra_pessoa=False):
    nome, doc = (nome_pessoa(r), cpf(r)) if outra_pessoa else (t.nome, t.doc)
    linhas = []
    titulo = r.choice(['CÉDULA DE CRÉDITO BANCÁRIO', 'CEDULA DE CREDITO BANCARIO', 'CONTRATO DE CONFISSÃO DE DÍVIDA',
                       'TERMO DE EMISSÃO DE NOTAS COMERCIAIS'])
    if t.num_pdf and r.random() < 0.9:
        linhas.append(f'{titulo} Nº {t.num_pdf}')
    else:
        linhas.append(titulo)
    if r.random() < 0.5:
        linhas.append(f'CREDOR: {t.cedente} CNPJ {fmt_doc(t.cnpj_cedente)}')
    else:
        linhas += ['CREDORA', f'{t.cedente}, inscrita no CNPJ/MF sob o nº {fmt_doc(t.cnpj_cedente)}.']
    if r.random() < 0.5:
        linhas.append(f'EMITENTE: {nome} CPF/CNPJ {doc_impresso(r, doc)}')
    else:
        linhas += ['QUADRO I - QUALIFICAÇÃO DO EMITENTE', f'NOME: {nome}', f'CPF: {doc_impresso(r, doc)}']
    if r.random() < 0.85:
        linhas.append(f'DATA DE EMISSÃO: {data_br(t.emissao)}' if r.random() < 0.8 else f'Data da operação: {extenso(t.emissao)}')
    forma_valor = r.random()
    if forma_valor < 0.6:
        linhas.append(f'VALOR DA PARCELA: R$ {moeda_br(t.valor)}')
    elif forma_valor < 0.75:
        linhas.append(f'valor da parcela: r$ {t.valor // 100}.{t.valor % 100:02d}')
    elif forma_valor < 0.85:
        linhas.append(f'VALOR TOTAL: R$ {moeda_br(t.valor * t.parcelas)} EM {t.parcelas} PARCELAS')
    else:
        linhas += ['7. Valor das', 'parcelas:', moeda_br(t.valor)]
    forma_crono = r.random()
    if forma_crono < 0.4:
        linhas.append(f'VENCIMENTO DA 1ª PARCELA: {data_br(t.primeira)} VENCIMENTO FINAL: {data_br(t.final)}')
    elif forma_crono < 0.6:
        linhas += [f'vencimento das parcelas: {data_br(t.primeira)}', f'quantidade de parcelas: {t.parcelas}']
    elif forma_crono < 0.75:
        linhas.append(f'VENCIMENTO: {data_br(t.vencimento)}')
    elif forma_crono < 0.8:
        linhas.append(f'VENCIMENTO FINAL: {data_br(t.final)}')
    elif forma_crono < 0.88:
        linhas += ['9. Vencimento da', '1ª parcela:', data_br(t.primeira), '10. Vencimento da', 'última parcela:', data_br(t.final)]
    if r.random() < 0.15:
        linhas.append(f'IOF (financiado): {moeda_br(r.randint(100, 5000))} 1,20 %*')
    paginas = ['\r\n'.join(linhas) + '\r\n']
    if r.random() < 0.5 and t.parcelas >= 3:
        tabela = ' '.join(f'{i + 1:03d} {data_br(somar_meses(t.primeira, i))} R${moeda_br(t.valor)}' for i in range(min(t.parcelas, 12)))
        paginas.append(tabela + '\r\n')
    if r.random() < 0.15:
        paginas.append(f'12. CESSÃO/ENDOSSO. O EMITENTE DECLARA CIÊNCIA DO ENDOSSO DESTA CÉDULA AO {t.fundo}, '
                       f'CNPJ {fmt_doc(t.cnpj_fundo)}\r\n')
    if r.random() < 0.3:
        paginas.append(f'Documento assinado eletronicamente.\r\nassinado em: {data_br(t.aquisicao - timedelta(days=r.randint(0, 3)))}\r\n')
    return paginas


def linha_termo(r, t, layout):
    valor = t.valor if r.random() < 0.9 else t.valor + r.randint(1, 50000)
    venc = t.vencimento if r.random() < 0.9 else t.vencimento - timedelta(days=1)
    num = t.num_pdf or '0000000000'
    doc = doc_impresso(r, t.doc).replace('\r\n', '')
    if layout == 0:
        return f'{num} {t.nome} {doc} R$ {moeda_br(valor)} {data_br(venc)}\r\n'
    if layout == 1:
        partes = t.nome.split()
        return f'{num}\r\n{" ".join(partes[:2]).lower()}\r\n{" ".join(partes[2:]).lower()}\r\n{doc} r$ {moeda_br(valor)} {data_br(venc)}\r\n'
    if layout == 2:
        return f'{t.doc} - {t.nome} {num} {data_br(venc)} {moeda_br(valor)} {moeda_br(valor * 3 // 4)}\r\n'
    return f'{num} R$ {moeda_br(valor)} {data_br(venc)}\r\n'


def termo_paginas(r, titulos, cedente, cnpj_cedente, fundo_extenso, cnpj_fundo, aquisicao):
    cabecalho = [r.choice(['TERMO DE CESSÃO DE DIREITOS CREDITÓRIOS', 'TERMO DE ENDOSSO E AQUISIÇÃO DE DIREITOS CREDITÓRIOS',
                           'INSTRUMENTO PARTICULAR DE CESSÃO DE CRÉDITOS'])]
    outro_fundo = r.random() < 0.1
    cabecalho.append(f'CEDENTE: {cedente} CNPJ {fmt_doc(cnpj_cedente)}')
    if outro_fundo:
        cabecalho.append(f'CESSIONÁRIA: OUTRO FUNDO FIDC, CNPJ {fmt_doc(cnpj(r))}')
    else:
        cabecalho.append(f'CESSIONÁRIA: {fundo_extenso} CNPJ {fmt_doc(cnpj_fundo) if r.random() < 0.8 else cnpj_fundo}')
    forma = r.random()
    if forma < 0.5:
        cabecalho.append(f'Data de aquisição: {data_br(aquisicao)}')
    elif forma < 0.7:
        cabecalho.append(f'Data de pagamento: {data_br(aquisicao)}')
    elif forma < 0.78:
        cabecalho.append(f'São Paulo, sexta-feira, {extenso(aquisicao)}.')
    elif forma < 0.85:
        cabecalho.append(f'data de emissao: {data_br(aquisicao)}')
    else:
        cabecalho.append(f'São Paulo, {extenso(aquisicao)}.')
    layout = r.randint(0, 3)
    paginas = ['\r\n'.join(cabecalho) + '\r\n']
    corpo = ['ANEXO I - RELAÇÃO DE TÍTULOS']
    for t in titulos:
        if r.random() < 0.9:
            corpo.append(linha_termo(r, t, layout).rstrip('\r\n'))
    if r.random() < 0.5:
        paginas[0] += '\r\n'.join(corpo) + '\r\n'
    else:
        paginas.append('\r\n'.join(corpo) + '\r\n')
    if r.random() < 0.3:
        paginas.append(f'Assinaturas eletrônicas registradas.\r\nassinado em: {data_br(aquisicao)}\r\n')
    return paginas


def listagem(r, titulos):
    linhas = ['relatorio de arquivos validados pagina 1 de 3', 'nº documento parcela vencimento valor aquisicao sacado']
    for t in titulos:
        linhas.append(f'{t.num_pdf or "0"} 01 {data_br(t.vencimento)} r$ {moeda_br(t.valor)} {data_br(t.aquisicao)} '
                      f'{fmt_doc(t.doc)} {t.nome.lower()}')
    return ['\r\n'.join(linhas) + '\r\n']


def duplicata(r, t):
    return [f'DUPLICATA MERCANTIL Nº {t.num_pdf or "S/N"}\r\nEMITENTE {t.cedente} CNPJ {fmt_doc(t.cnpj_cedente)}\r\n'
            f'NF/FATURA VALOR VENCIMENTO\r\n{(t.num_pdf or "1").split("-")[0]} R$ {moeda_br(t.valor)} {data_br(t.vencimento)}\r\n'
            f'DATA EMISSÃO {data_br(t.emissao)} VENCIMENTO: {data_br(t.vencimento)}\r\n'
            f'NOME: {t.nome}\r\nCPF/CNPJ {doc_impresso(r, t.doc)}\r\n']


def seguro(r, t):
    return [f'DADOS DO SEGURADO (VOCÊ)\r\nNOME: {t.nome} CPF: {fmt_doc(t.doc)}\r\n'
            f'BILHETE NÚMERO {r.randint(10 ** 12, 10 ** 13 - 1)} DATA DE EMISSÃO:{data_br(t.emissao)}\r\n'
            f'OBRIGAÇÃO (DÍVIDA) A QUAL O SEGURO ESTÁ VINCULADO: {moeda_br(t.valor)}\r\n']


def dossie(r, t):
    return [f'CONSULTA CADASTRAL\r\nNOME: {t.nome} CPF {fmt_doc(t.doc)}\r\nSCORE {r.randint(300, 900)} SITUACAO REGULAR\r\n']


def caso(r, indice):
    fundo, fundo_extenso = r.choice(FUNDOS)
    cnpj_fundo = cnpj(r)
    cedente = r.choice(CEDENTES)
    cnpj_cedente = cnpj(r)
    aquisicao = date(2026, r.randint(1, 12), r.randint(1, 28))
    n = r.randint(3, 18)
    titulos = [Titulo(r, 1000 * indice + i, fundo, cnpj_fundo, cedente, cnpj_cedente, aquisicao) for i in range(n)]
    paginas, externas, pdfs_externos, tipos_pdf = [], [], {}, {}
    pdfs_lastro, pdfs_termo = [], []

    def add(pdf, textos, destino=paginas, numero_inicial=1):
        for k, texto in enumerate(textos):
            destino.append({'pdf': pdf, 'pagina': numero_inicial + k, 'texto': texto})

    for t in titulos:
        sorte = r.random()
        if sorte < 0.65:
            pdf = f'ccb_{t.rid}_{r.randint(1000, 9999)}.pdf'
            add(pdf, ccb_texto(r, t))
            pdfs_lastro.append(pdf)
            if r.random() < 0.1:
                copia = f'copia_{pdf}'
                add(copia, ccb_texto(r, t))
        elif sorte < 0.8:
            pdf = f'dup_{t.rid}.pdf'
            add(pdf, duplicata(r, t))
            pdfs_lastro.append(pdf)
        elif sorte < 0.85:
            add(f'dossie_{t.rid}.pdf', dossie(r, t))
        if r.random() < 0.08:
            add(f'seguro_{t.rid}.pdf', seguro(r, t))
        if r.random() < 0.05:
            add(f'outra_{t.rid}.pdf', ccb_texto(r, t, outra_pessoa=True))
    n_termos = r.choice([1, 1, 2])
    fatias = [titulos[i::n_termos] for i in range(n_termos)]
    for k, fatia in enumerate(fatias):
        pdf = f'termo_{indice}_{k}.pdf'
        textos = termo_paginas(r, fatia, cedente, cnpj_cedente, fundo_extenso, cnpj_fundo, aquisicao)
        if r.random() < 0.2:
            add(pdf, textos, externas)
            pdfs_externos[pdf] = {'base_id': f'outra_{indice}', 'rotulo': f'{fundo} — ref. 2026-06-30'}
        else:
            add(pdf, textos)
            pdfs_termo.append(pdf)
    if r.random() < 0.3:
        add(f'relatorio_{indice}.pdf', listagem(r, titulos))
    for pdf in pdfs_termo + pdfs_lastro:
        if r.random() < 0.4:
            tipos_pdf[pdf] = pdf.startswith('termo')

    pendencias, vinculos = [], []
    uid = 1
    for t in titulos:
        lados = r.choice([['lastro'], ['termo_cessao'], ['lastro', 'termo_cessao'], ['lastro', 'termo_cessao']])
        if r.random() < 0.35:
            # Título já conferido: ensina o layout.
            pdf = next((p['pdf'] for p in paginas if str(t.rid) in p['pdf']), None)
            if pdf:
                reg = registro(r, t, r.choice(['lastro', 'termo_cessao', 'termo']), None)
                marcas = {c: r.choice(['V', 'V', 'V', 'D'] if r.random() < 0.7 else ['V', 'D']) for c in ('data_emissao', 'valor_total', 'sacado_nome', 'numero_documento',
                                                                      'data_vencimento', 'cedente_documento')}
                vinc = {**reg, 'processed_pdf': pdf, 'marcacoes_campos': marcas if r.random() < 0.8 else None,
                        'leitura_numero_documento': t.num_pdf, 'leitura_valor_total': reg['base_valor_total'],
                        'leitura_sacado_nome': t.nome, 'leitura_sacado_documento': t.doc,
                        'leitura_data_vencimento': reg['base_data_vencimento']}
                vinculos.append(vinc)
                continue
        for lado in lados:
            pendencias.append(registro(r, t, lado, uid))
            uid += 1
    if not pendencias:
        pendencias.append(registro(r, titulos[0], 'lastro', uid))
    todos_pdfs = sorted({p['pdf'] for p in paginas})
    leituras = []
    for t in r.sample(titulos, k=min(len(titulos), r.randint(0, 3))):
        leituras.append({'pdf': f'escaneado_{t.rid}.pdf' if r.random() < 0.5 else r.choice(todos_pdfs),
                         'documento': fmt_doc(t.doc), 'valor': f'{t.valor // 100}.{t.valor % 100:02d}'})
    regras = {}
    if r.random() < 0.2:
        regras = {'nao_enviados': ['data_emissao'], 'valor_pela_amostra': True, 'administradora': 'QI TECH', 'origem': 'assinatura'}
    origens = []
    if r.random() < 0.3:
        origens.append({'registro_base_id': 0, 'campo': 'DATA_VENCIMENTO_ORIGINAL', 'coluna_arquivo': 'DATA_VENCIMENTO_ORIGINAL'})
        for t in r.sample(titulos, k=min(2, len(titulos))):
            origens.append({'registro_base_id': t.rid, 'campo': 'DATA_VENCIMENTO_ORIGINAL', 'coluna_arquivo': 'DATA_VENCIMENTO_AJUSTADA'})
    return {
        'nome': f'gerado_{indice}',
        'pendencias': pendencias,
        'paginas': paginas,
        'paginas_externas': externas,
        'pdfs_externos': pdfs_externos,
        'tipos_pdf': tipos_pdf,
        'pdfs_com_leitura': [p for p in todos_pdfs if r.random() < 0.3],
        'pdfs_com_lastro': [p for p in pdfs_lastro if r.random() < 0.5] + [p for p in pdfs_termo if r.random() < 0.2],
        'leituras': leituras,
        'regras_fundo': regras,
        'vinculos': vinculos,
        'origens': origens,
    }


def lote_aprendido(r, indice):
    """Base com muitos títulos do mesmo termo de lote já vinculados (documento do lote) e duplicatas de um mesmo layout."""
    fundo, fundo_extenso = r.choice(FUNDOS)
    cnpj_fundo, cedente, cnpj_cedente = cnpj(r), r.choice(CEDENTES), cnpj(r)
    aquisicao = date(2026, 9, 1)
    titulos = [Titulo(r, 1000 * indice + i, fundo, cnpj_fundo, cedente, cnpj_cedente, aquisicao) for i in range(16)]
    paginas = [{'pdf': 'lote.pdf', 'pagina': 1, 'texto': f'TERMO DE CESSÃO DE CRÉDITOS EM LOTE\r\nCEDENTE: {cedente} CNPJ '
                f'{fmt_doc(cnpj_cedente)}\r\nCESSIONÁRIA: {fundo_extenso} CNPJ {fmt_doc(cnpj_fundo)}\r\n'
                f'Data de aquisição: {data_br(aquisicao)}\r\nOs créditos cedidos constam do arquivo eletrônico.\r\n'},
               {'pdf': 'lote_b.pdf', 'pagina': 1, 'texto': f'TERMO DE CESSÃO DE CRÉDITOS EM LOTE\r\nCEDENTE: {cedente} CNPJ '
                f'{fmt_doc(cnpj_cedente)}\r\nCESSIONÁRIA: {fundo_extenso} CNPJ {fmt_doc(cnpj_fundo)}\r\n'
                f'Data de aquisição: {data_br(aquisicao)}\r\nOs créditos cedidos constam do arquivo eletrônico.\r\n'}]
    for t in titulos:
        paginas.append({'pdf': f'dup_{t.rid}.pdf', 'pagina': 1, 'texto': duplicata(r, t)[0]})
    vinculos, pendencias = [], []
    limite = r.choice([3, 5, 12])
    for i, t in enumerate(titulos):
        reg = registro(r, t, 'termo_cessao', i + 1)
        reg['base_data_aquisicao'] = aquisicao.isoformat()
        if i < limite:
            vinculos.append({**reg, 'processed_pdf': 'lote.pdf', 'marcacoes_campos': {'data_aquisicao': 'V', 'nome_cessionario': 'V',
                                                                                         'doc_cessionario': 'V', 'sacado_nome': 'D'}})
            vinculos.append({**reg, 'tipo_documento': 'lastro', 'processed_pdf': f'dup_{t.rid}.pdf',
                             'marcacoes_campos': {'data_emissao': 'D', 'valor_total': 'V', 'sacado_nome': 'V'}})
        else:
            pendencias.append(reg)
            pendencias.append({**reg, 'tipo_documento': 'lastro', 'unmatch_id': 100 + i})
    return {'nome': f'lote_{indice}', 'pendencias': pendencias, 'paginas': paginas, 'paginas_externas': [], 'pdfs_externos': {},
            'tipos_pdf': {'lote.pdf': True, 'lote_b.pdf': True}, 'pdfs_com_leitura': [], 'pdfs_com_lastro': [], 'leituras': [],
            'regras_fundo': {}, 'vinculos': vinculos, 'origens': []}


def layout_dividido(r, indice):
    """Duplicatas do mesmo modelo; o time marcou o nome do sacado (presente no documento) dos dois jeitos."""
    fundo, _ = r.choice(FUNDOS)
    cnpj_fundo, cedente, cnpj_cedente = cnpj(r), r.choice(CEDENTES), cnpj(r)
    aquisicao = date(2026, 5, 4)
    titulos = [Titulo(r, 1000 * indice + i, fundo, cnpj_fundo, cedente, cnpj_cedente, aquisicao) for i in range(10)]
    paginas, vinculos, pendencias = [], [], []
    for i, t in enumerate(titulos):
        t.tipo = 'DUPLICATA'
        paginas.append({'pdf': f'dup_{t.rid}.pdf', 'pagina': 1, 'texto': duplicata(r, t)[0]})
        reg = registro(r, t, 'lastro', i + 1)
        if i < 7:
            vinculos.append({**reg, 'processed_pdf': f'dup_{t.rid}.pdf',
                             'marcacoes_campos': {'sacado_nome': 'D' if i < 2 else 'V', 'valor_total': 'V', 'data_emissao': 'D'}})
        else:
            pendencias.append(reg)
    return {'nome': f'dividido_{indice}', 'pendencias': pendencias, 'paginas': paginas, 'paginas_externas': [], 'pdfs_externos': {},
            'tipos_pdf': {}, 'pdfs_com_leitura': [], 'pdfs_com_lastro': [], 'leituras': [], 'regras_fundo': {},
            'vinculos': vinculos, 'origens': []}


def main():
    saida = sys.argv[1]
    n = int(sys.argv[2]) if len(sys.argv) > 2 else 60
    semente = int(sys.argv[3]) if len(sys.argv) > 3 else 20261118
    r = random.Random(semente)
    casos = [caso(r, i) for i in range(n)] + [lote_aprendido(r, n + i) for i in range(3)] + [layout_dividido(r, n + 3 + i) for i in range(2)]
    with open(saida, 'w', encoding='utf-8') as f:
        json.dump(casos, f, ensure_ascii=False)
    print(f'{len(casos)} casos em {saida}')


main()
