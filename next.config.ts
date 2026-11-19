import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pacotes que leem arquivos do próprio pacote em tempo de execução (o .wasm
  // do PDFium) ou usam APIs do Node: ficam fora do bundle do servidor.
  serverExternalPackages: ["@embedpdf/pdfium", "exceljs", "@google/genai", "jszip"],
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
