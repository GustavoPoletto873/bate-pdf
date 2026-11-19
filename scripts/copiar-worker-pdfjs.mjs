// Copia o worker do pdf.js para public/ — o visualizador carrega de /pdf.worker.min.mjs,
// sem depender de CDN (o app precisa funcionar sem internet).
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const origem = require.resolve('pdfjs-dist/build/pdf.worker.min.mjs');
mkdirSync(join(raiz, 'public'), { recursive: true });
copyFileSync(origem, join(raiz, 'public', 'pdf.worker.min.mjs'));
