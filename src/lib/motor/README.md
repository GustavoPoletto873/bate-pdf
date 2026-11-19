# Motor de pré-classificação (porta do Bate Lastro)

Tradução linha a linha do motor Python do Bate Lastro, branch
`feat/pre-classificacao-bater-pdf`:

| Python (`C:\bate-lastro\backend`) | Aqui |
|---|---|
| `services/pre_classificacao_service.py` (parte pura) | `motor.ts` |
| `services/formas_impressao.py` | `formas.ts` |
| `services/perfis_layout.py` | `layout.ts` |
| `services/perfis_recebivel.py` + `services/regras_fundo.py` (sem banco) | `perfis.ts` |
| `utils/texto_normalizado.py` | `valores.ts` (`normalizarTexto`) |
| `modules/base_direito_creditorio.py` (`colunas_de_vencimento`, `completar_vencimento`) | `vencimento.ts` |
| `carregar_e_pre_classificar` (sem SQL) | `index.ts` (`preClassificar`) |

Ficou de fora o que é banco/cache: `_SQL_*`, `cache_paginas.py` e
`carregar_regras_do_fundo`. Quem chama entrega os dados já em memória.

## Uso

```ts
import { normalizarTexto, preClassificar, regrasDoFundoDaAmostra } from '@/lib/motor';

const resultado = preClassificar({
  pendencias,   // RegistroPendencia[]: uma linha por título e lado em aberto (colunas de _SQL_PENDENCIAS)
  paginas,      // PaginaTexto[]: { pdf, pagina, texto_normalizado: normalizarTexto(textoDoPdfium) }
  regrasFundo: regrasDoFundoDaAmostra(todasAsLinhasDaAmostra, administradoraOuNull),
  vinculos,     // opcional: vínculos já conferidos (aprendizado por layout)
  tiposPdf, pdfsComLeitura, pdfsComLastro, leituras, origens,   // opcionais
  outrasBases,  // opcional: páginas das outras bases do mesmo fundo (termos externos + 2ª passada de lastros)
});
```

- `preClassificar` = `carregar_e_pre_classificar`: tira os PDFs acessórios
  (seguro, pela pág. 1), ordena as páginas por (pdf, página), monta o
  aprendizado com os `vinculos`, roda o núcleo, faz a 2ª passada de lastros de
  outras bases e termina com `naoEncontradoViraD` ("não achado" sai D sem
  valor, regra `nao_encontrado`; P é só do analista).
- `preClassificarNucleo` = `pre_classificar` (sem `nao_encontrado_vira_d`), pros testes.
- `termosDeBusca(forma, valor)` / `formasDeBusca(campo, valor)` / `termoIsoladoEm` — a busca dos campos clicáveis.
- `regrasDoFundo(administradoras, assinatura)` é a função do Python;
  `regrasDoFundoDaAmostra(linhas, administradora)` calcula a assinatura
  (linhas, com emissão, com valor de aquisição ≠ 0) a partir de TODAS as
  linhas da amostra — é o `count(*)` de `registroBases`, não só as pendências.

## Formato da saída

Igual ao JSON da rota `POST /v1/manual-match/{base_id}/pre-classificar` do
Bate Lastro (sem o `base_id`): chaves em snake_case, e onde o Python grava
`None` aqui vai `null`.

```
{ total, resumo: {alta, media, baixa, ambigua, sem_candidato}, pdfs_analisados, paginas_analisadas, regras_fundo,
  resultados: [{
    registro_base_id, confianca, registros: [linhas de pendência como vieram],
    candidatos: { lastro?|termo?|referencia?: {
        processed_pdf, pagina, score, trecho, tem_leitura, confianca, alternativas, regiao: [pág, ini, fim]|null,
        evidencias: [['V'|'D', pág, ini, fim], ...], aviso?, base_externa?, regra? } },
    campos: { numero_documento, sacado_nome, sacado_documento, cedente_nome, cedente_documento, valor_total,
              data_emissao, data_vencimento [, data_aquisicao, nome_cessionario, doc_cessionario]: {
        valor: 'V'|'D'|'P', encontrado, evidencias?: [[pág, ini, fim]], regra?, origem?, fonte?, alerta?,
        confirmado_por?, data_documento?, sem_confirmacao?, convencao?, busca?, parcelas?, no_termo? } } }] }
```

- Datas: ISO `AAAA-MM-DD`. Dinheiro: string com 2 casas (`"1613.33"`), como o `_fmt_moeda` do Python.
- Posições (`evidencias`, `regiao`) são índices no `texto_normalizado` da página.

## Como foi validado

1. **Testes portados** (`*.test.ts`): todos os testes puros de
   `test_pre_classificacao.py`, `test_perfis_layout.py`, `test_perfis_recebivel.py`,
   `test_formas_impressao.py`, `test_regras_fundo.py` e
   `test_vencimento_ajustado.py` (o que não depende de banco/arquivo).
2. **Diferencial** (`diferencial.test.ts`): `__fixtures__/diferencial.json` traz
   47 bases FICTÍCIAS (≈ 500 títulos) com a saída do motor Python; a saída daqui
   tem que ser idêntica. Na porta foram comparados ~780 casos de 9 sementes, 0
   diferenças. Pra regenerar (o oráculo bloqueia qualquer import de banco):

   ```bash
   PY=C:/bate-lastro/backend/.venv/Scripts/python.exe
   $PY -I src/lib/motor/__fixtures__/oraculo/gerar_casos.py casos.json 42 20261118
   $PY -I src/lib/motor/__fixtures__/oraculo/oraculo.py C:/bate-lastro/backend casos.json src/lib/motor/__fixtures__/diferencial.json
   ```

3. **Desempenho**: base sintética de 2.000 títulos (termo + lastro) e 5.020
   páginas classificada em ~1,7 s no Node (extração incluída).

Rodar: `cd "C:/bate-pdf" && npx vitest run src/lib/motor` (com `C:` maiúsculo).

## Diferenças conhecidas em relação ao Python (de propósito)

- **`assinatura` interna**: o Python usa `hash(texto)` (aleatório a cada
  processo) pra deduplicar cópias; aqui é o próprio texto. Não sai na resposta.
- **`_variantes_valor`**: o Python itera um `set` (ordem varia com o hash);
  aqui a ordem é fixa (pt-BR com milhar, pt-BR, americano com milhar,
  americano, 1 casa). Só muda algo se duas formas diferentes do mesmo valor
  estiverem na mesma região e nenhuma for reconhecida como moeda.
- **Posições em texto com caracteres fora do BMP** (emoji etc.): o Python conta
  code points, o JS conta unidades UTF-16. Texto de PDF de cartório/banco não
  tem isso; se tiver, as posições continuam coerentes com o `texto_normalizado`
  em JS.
- `normalizarData` aceita `AAAA-MM-DD` e `AAAAMMDD` (o `fromisoformat` do
  Python 3.12 aceita também semana ISO, que a amostra não usa).
- `src/lib/texto.ts` do app tem outra `normalizarTexto`; dá o mesmo resultado
  no BMP. O motor usa a sua (`valores.ts`), igual ao Python também fora do BMP.
