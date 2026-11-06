import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig(({ mode }) => {
  const portable = mode === "portable";

  return {
    base: portable ? "./" : "/",
    clearScreen: false,
    plugins: portable ? [viteSingleFile({ removeViteModuleLoader: true })] : [],
    server: {
      port: 5173,
      strictPort: true,
    },
    build: {
      target: "chrome105",
      outDir: portable ? "portable" : "dist",
      emptyOutDir: true,
    },
  };
});
