import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          // 绘图与编辑器等重依赖单独分包，改善缓存
          konva: ["konva", "react-konva"],
          codemirror: ["@uiw/react-codemirror", "@codemirror/lang-markdown", "@codemirror/theme-one-dark"],
        },
      },
    },
  },
});
