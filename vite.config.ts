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
      watch: {
        // tauri dev 时 cargo 会持续写入 target 目录，监听会导致 EBUSY 崩溃
        ignored: ["**/src-tauri/target/**", "**/release/**", "**/portable/**", "**/dist/**"],
      },
    },
    build: {
      target: "chrome105",
      outDir: portable ? "portable" : "dist",
      emptyOutDir: true,
    },
  };
});
