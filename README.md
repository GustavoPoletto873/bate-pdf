# Lastro — a versão local do Bate Lastro

Uma cópia do **Bate Lastro** (branch `feat/pre-classificacao-bater-pdf`) que roda neste computador, para a equipe
continuar trabalhando quando o Bate Lastro estiver fora do ar. Mesmas pastas do menu e mesmas rotas:

- **Home** (`/`): continue de onde parou, suas bases e o passo a passo.
- **Gestão** › Upload Base (`/base`), Anexo (`/anexo`), Fundos (`/cadastro-fundo`), Treinar IA (`/treinamento-ia`),
  Relatórios CVM/NIX (`/relatorios`), Amostra (`/amostra`), BlackList (`/blacklist`).
- **Análise** › Dashboard (`/home`), Visualizar (`/visualizar`), Lotes (`/lotes`), NF Status (`/acompanhamento-nota-fiscal`).
- **Bates** (`/auditoria-selection`) › Gestão de Bates (`/pre-matches`), Resultados (`/results`) e o **Bater PDF**
  com pré-classificação (`/bases/<id>`).
- **Perfil** (`/perfil`): modo escuro e a chave do Gemini.

Um usuário só, sem login. Banco SQLite e arquivos ficam numa pasta de dados local; não fala com o banco nem com o S3
do Bate Lastro. A leitura dos documentos no Anexo usa o **Gemini** (internet + chave; veja "Leitura por IA").

Fluxo, igual ao do Bate Lastro: **Fundos → Upload Base → Anexo (leitura pelo Gemini) → Lotes → Gestão de Bates**
(*Processar Base* gera os pré-bates com a mesma cascata de 11 critérios; confirme ou rejeite; o resto se resolve no
Bater PDF) **→ Resultados** (exporta `resultados_matching_<CNPJ>_<data_hora>.xlsx`, o formato do Bate Lastro, para o
*Inserir Resultado* de lá). A seção "Fluxo" abaixo detalha o Bater PDF.

## Como rodar

Precisa do **Node.js 24** (ou 22.13+). O banco é SQLite via libSQL (`@libsql/client`).

```bash
npm install
npm run dev          # http://localhost:3000
```

Para uso no dia a dia, sem modo de desenvolvimento: `npm run build` e depois `npm start`.

Os dados ficam em `./data` (banco `bate-pdf.db` e `pdfs/<base>/<sha256>.pdf`). Para usar outra pasta (ex.: um disco
com mais espaço), defina `BATE_PDF_DADOS=C:\caminho\da\pasta` antes de iniciar. A pasta `data/` não vai para o Git.

## Versão na nuvem (Vercel)

O mesmo código roda nos dois modos; quem escolhe são as variáveis de ambiente (modelo em `.env.example`):

| | Local (padrão) | Nuvem |
|---|---|---|
| Banco | arquivo `data/bate-pdf.db` | Turso (`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`) |
| PDFs e arquivos | pasta `data/` | Vercel Blob privado (`BLOB_READ_WRITE_TOKEN`) |
| Login | nenhum (liga com `SESSAO_SEGREDO`) | sempre: e-mail + senha + authenticator, contas por convite (`SESSAO_SEGREDO`, `CHAVE_INSTALACAO`) |
| Indexação dos PDFs | processo à parte (`scripts/indexador.ts`) | no servidor, depois da resposta; retomada quando a base é aberta |
| Fila de leitura (Gemini) | contínua no servidor | por requisição; retomada quando o lote é acompanhado |
| Envio de arquivos | direto para a rota | navegador → Blob (sem o limite de 4,5 MB da Vercel) → rota |

Antes do primeiro deploy com dados reais: confirmar a liberação interna para guardar dados dos fundos na nuvem.

Passo a passo (as contas e chaves são criadas por quem administra; nunca vão para o Git):

1. **Turso**: criar o banco (`turso db create lastro`), pegar a URL (`turso db show lastro --url`) e um token
   (`turso db tokens create lastro`). O esquema é criado sozinho na primeira requisição.
2. **Vercel**: importar o repositório; em *Storage*, criar um **Blob privado** e ligá-lo ao projeto (cria o
   `BLOB_READ_WRITE_TOKEN`); cadastrar as demais variáveis e fazer o deploy. `SESSAO_SEGREDO` (32+ caracteres) e
   `CHAVE_INSTALACAO` (16+) podem ser gerados com
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.
   O `vercel.json` dá 300 s às rotas da API (indexação e leitura por IA rodam depois da resposta).
3. **Primeiro acesso**: abrir o app. Sem nenhuma conta, a tela de entrar pede a `CHAVE_INSTALACAO` e cria o primeiro
   administrador (senha + authenticator). Depois, em **Perfil › Usuários**, ele convida as outras pessoas.

### Login

O mesmo modelo do Bate Lastro e do `dashboard-lastro`: **e-mail + senha** e, em seguida, o **código de 6 dígitos do
authenticator** (Google ou Microsoft Authenticator, nome “Lastro Bate PDF”). O authenticator é obrigatório.

- **Contas por convite.** Um administrador, em **Perfil › Usuários**, informa nome, e-mail e perfil e recebe um link
  (48 h, uso único). Pelo link a pessoa cria a senha e configura o authenticator. Só e-mails `@denvercontabil.com.br`
  (`ACESSO_DOMINIOS`) ou os liberados em `ACESSO_EMAILS`.
- **Senha forte**, com a regra do Bate Lastro: 12+ caracteres, maiúscula, minúscula, número, símbolo e sem 3 iguais ou
  em sequência.
- **Esqueceu a senha ou trocou de celular:** o administrador gera um link de redefinição (*Redefinir acesso*). Não há
  envio de e-mail.
- **Sessão:** cookie httpOnly cifrado (AES-256-GCM, chave derivada do `SESSAO_SEGREDO`), registrada na conta: sair,
  desativar ou encerrar sessões derruba o acesso (em até 30 s nas outras instâncias). Sem usar por 30 dias, pede login.
- **Proteções:** limite de tentativas por IP e por conta; cada código vale uma vez; senhas com scrypt; segredo do
  authenticator cifrado; o convite guarda só o hash do token.
- As contas ficam no banco do app (tabela `contas`). **Não troque o `SESSAO_SEGREDO`** depois de criar contas: ele
  cifra os segredos do authenticator, e todos teriam de configurar de novo.
- Na versão local, sem `SESSAO_SEGREDO`, não há login (abre direto, como sempre). Com ele, o login liga também no
  computador.

Limites conhecidos na nuvem: a consulta de NF Status mostra o progresso só quando a página cai na mesma instância
que iniciou a consulta (a consulta em si termina); a indexação de muitos PDFs grandes anda em rodadas de ~3 min.

## Fluxo

1. **Nova base → planilha.** De preferência o `resultados_matching_<CNPJ>_*.xlsx` exportado em Resultados do Bate
   Lastro: ele traz o `ID_BASE` de cada título e o que já está batido (STATUS V fica de fora). Sem ele, serve a
   **amostra do fundo** (.xlsx ou .csv); as colunas são reconhecidas pelo mesmo mapeamento do upload do Bate Lastro
   (`NU_DOCUMENTO`, `NOME_SACADO`, `DOC_SACADO`, `VALOR_NOMINAL`, `DATA_VENCIMENTO_ORIGINAL`/`_AJUSTADA`…).
   Informe o **CNPJ do fundo**: sem ele, a volta para o Bate Lastro é recusada.
2. **PDFs.** Arraste a pasta inteira. O texto é extraído com o **PDFium** (WebAssembly), a mesma biblioteca e a mesma
   chamada (`FPDFText_GetText`) do `pypdfium2` do Bate Lastro: o texto sai idêntico ao que o motor foi calibrado. Como
   lá, não há OCR: PDF escaneado fica “sem texto” e fora da busca.
3. **Bater PDF.** Lista de pendências (uma linha por título × Termo/Lastro) à esquerda, busca e visualizador à
   direita. Cada campo tem V/D/P; D aceita o valor que o documento traz (vazio = “o documento não traz”). A lupa ao
   lado de cada valor procura esse valor nos PDFs nas formas em que costuma estar impresso. **P bloqueia o vínculo**,
   e um lote com qualquer linha travada não vincula nenhuma (mesmas regras do Bate Lastro).
4. **Pré-classificar.** O motor do Bate Lastro, portado para TypeScript (`src/lib/motor/`), sugere o PDF de cada lado
   e o V/D de cada campo, com a regra e a evidência. Não grava nada sozinho: as sugestões aparecem apagadas, com
   contorno roxo, até alguém decidir.
5. **Conferência.** Os títulos agrupados por motivo (“Tudo confere”, “Confiança baixa”, “o documento traz outra Data
   de Aquisição”…), com recortes do PDF destacando os valores (verde V, âmbar D). **Vincular N** grava as sugestões
   dos marcados e vincula; **Deixar pendente** grava P nos não marcados.
6. **Exportar para o Bate Lastro.** Em Resultados, baixe o `resultados_matching_<CNPJ>_<data_hora>.xlsx` e, no Bate Lastro,
   *Gestão de Bates → Inserir Resultado* (sem renomear o arquivo). Lá aparece a prévia antes de gravar.

## A volta para o Bate Lastro

O arquivo segue o formato que `importar_resultado_matching_service.ler_planilha` lê (conferido rodando o próprio leitor
do Bate Lastro sobre arquivos gerados aqui):

- abas `TERMO` e `LASTRO`, título `DADOS TERMO`/`DADOS LASTRO` em A1, cabeçalho na linha 3;
- `STATUS = V` só nos títulos batidos aqui (o importador só grava STATUS V; a planilha nunca desfaz um bate);
- `DIV_*` = as marcações V/D/P; `LEITURA_*` = o que o documento traz (V → o valor da amostra; D → o digitado);
- `ID_BASE` quando a base veio do `resultados_matching`; senão o Bate Lastro acha o título por nº do documento +
  valor nominal (precisa ser único na base de lá);
- CNPJ do fundo no nome do arquivo e em `BASE_CNPJ_FUNDO`;
- colunas extras no fim (`PDF_ARQUIVO`, `PDF_PAGINA`, `ORIGEM_BATE_PDF`), ignoradas pelo importador, como rastro.

**Limitação:** o Inserir Resultado cria a leitura como `origem_leitura='planilha'`, **sem o PDF anexado**. O nome do PDF
e a página vão nas colunas extras. O **backup .json** (Exportar → Backup completo) guarda tudo, inclusive qual PDF e
qual página foram vinculados, para uma importação completa no futuro.

## Diferenças em relação ao Bate Lastro

- **Sem leituras de IA.** O motor usa só o texto dos PDFs (as leituras da IA entravam como evidência auxiliar de valor
  em PDF escaneado).
- **Aprendizado local.** O motor aprende com os vínculos feitos aqui (nesta base e nas outras bases locais do mesmo
  CNPJ), não com o histórico de produção. Na primeira pré-classificação de uma base nova, mais títulos caem em “Para
  decidir” (o mesmo comportamento de “fundo novo” do Bate Lastro). Re-rodar depois de conferir alguns títulos espalha
  o aprendizado.
- **Sem login na versão local** (a não ser com `SESSAO_SEGREDO`). É uma ferramenta local. Duas abas na mesma base funcionam, mas o servidor é um só.
- **A pré-classificação roda no processo do servidor.** Numa base muito grande, o servidor fica ocupado até terminar.

## Leitura por IA (Gemini)

Em **Gestão › Anexo**, cada PDF enviado é classificado e lido pelo **Google Gemini**, como no Bate Lastro (mesmo
modelo, `gemini-3.1-flash-lite`, mesmos schemas e descrições de campo, até 3 tentativas devolvendo o erro de
validação ao modelo). As leituras viram linhas em `leituras` (uma por título/parcela) e aparecem em **Análise ›
Visualizar**; o andamento fica em **Análise › Lotes**. XML de NF-e é lido aqui mesmo, sem IA. PDF acima de 50 páginas
não vai para a IA. Precisa de internet e de uma chave da API (cada leitura é cobrada pelo Google; tokens e custo ficam em
`uso_ia`). Crie `.env.local` na raiz (não vai para o Git) e reinicie o app:

```
GEMINI_API_KEY=sua-chave
GEMINI_MODELO=gemini-3.1-flash-lite   # opcional
```

Sem a chave, os PDFs ficam com erro e podem ser lidos depois com **Tentar de novo**. A fila roda dentro do servidor
(2 leituras por vez); se o servidor parar no meio, a leitura interrompida vira erro e **não** é refeita sozinha.

## Telas trazidas depois

- **Bater PDF** no layout do Bate Lastro: busca + PDF à esquerda, tabela "O que ainda falta resolver" à direita (um selo
  V/D/P por campo, "Buscar" em cada linha), divisória arrastável, recolher a tabela e tela cheia.
- **Relatórios CVM/NIX**: carteira do informe mensal FIDC da CVM (dados abertos, baixado por competência e guardado em
  `<dados>/cvm/`), base de auditoria do trimestre, revisão dos textos do questionário e emissão em `.docx` com os
  modelos do Bate Lastro (`modelos/relatorios/`), um fundo ou em lote (.zip). Garantias saem como n/i (como lá); a
  assinatura do sócio e a logo da administradora não vêm para cá. Razão social e endereço da administradora são
  preenchidos na própria revisão.
- **Treinar IA**: tipos de documento treinados (descrever → testar num PDF → salvar; o salvar exige teste da mesma
  configuração) entram na classificação e na leitura do Anexo. "Documentos para treinar" lista o que a IA classificou
  como outro documento / intervenção humana, com grupos, ignorar e "Ler de novo".
- **NF Status**: situação das NF-e pelos XML lidos no Anexo e, com `SERPRO_CONSUMER_KEY`/`SERPRO_SECRET_KEY` no
  `.env.local`, pela consulta no SERPRO (cobrada). Exporta Excel e o XML de cada nota.
- **Resultados › Exportar documentos**: ZIP para o dossiê (pastas das operações, XML das NF-e,
  `00_INDICE_AUDITORIA.xlsx` e `SHA256SUMS.txt`).
- **Gestão de Bates**: Leitura Termos/Lastros conta documentos lidos (as linhas aparecem no detalhe).

## Estrutura

| Pasta/arquivo | O que é |
|---|---|
| `src/app/` | Telas (Next.js App Router) e a API (`src/app/api/**/route.ts`) |
| `src/components/bater/` | Bater PDF: lista, detalhe dos campos, busca, conferência, diálogos |
| `src/components/pdf/` | Visualizador (pdf.js) e recortes |
| `src/lib/motor/` | Motor de pré-classificação portado de `backend/services/pre_classificacao_service.py` (+ formas de impressão, perfis, aprendizado por layout, regras do fundo) |
| `src/lib/planilha/` | Leitura da planilha (resultados_matching ou amostra) e geração do resultados_matching |
| `src/lib/repo.ts`, `src/lib/db.ts` | Banco local (SQLite com busca por trigramas, como o `pg_trgm`) |
| `src/lib/pdf/pdfium.ts` | PDFium no servidor: coordenadas dos caracteres para destaques e recortes |
| `scripts/indexador.ts` | Extração de texto em processo à parte (não trava o servidor) |

## Testes

```bash
npm test
```

> No Windows, rode a partir de `C:\bate-pdf` com o **C maiúsculo**: com o diretório atual em `c:\` minúsculo o
> vitest carrega o próprio módulo duas vezes e todo teste falha com “failed to find the current suite”.
