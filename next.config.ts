import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pacotes que leem arquivos do próprio pacote em tempo de execução (o .wasm
  // do PDFium) ou usam APIs do Node: ficam fora do bundle do servidor.
  serverExternalPackages: ["@embedpdf/pdfium", "exceljs", "@google/genai", "jszip", "@libsql/client"],
  // Na Vercel cada rota leva só os arquivos que o rastreio acha: os modelos .docx e o .wasm do
  // PDFium são lidos por caminho, então vão explícitos.
  outputFileTracingIncludes: {
    "/*": ["./modelos/**/*", "./node_modules/@embedpdf/pdfium/dist/*.wasm"],
  },
  // O navegador precisa saber se manda os arquivos direto ao Vercel Blob (versão na nuvem).
  env: {
    NEXT_PUBLIC_LASTRO_NUVEM: process.env.BLOB_READ_WRITE_TOKEN ? "1" : "",
  },
  // O indicador do modo dev cobre os botões do rodapé do painel de campos.
  devIndicators: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
