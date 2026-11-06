import "./styles/base.css";
import "./styles/markdown.css";
import "./styles/code.css";

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { Sidebar } from "./components/Sidebar";
import { renderMarkdown } from "./markdown/render";
import {
  fileMtime,
  isTauri,
  markDropHint,
  openExternal,
  openFileDialog,
  openFolderDialog,
  readFile,
  registerDropHandler,
  resolveAssetUrl,
} from "./api/backend";
import { basename, countText, dirname, joinPath } from "./utils";
import { SAMPLE_MARKDOWN } from "./sample";

type Theme = "auto" | "light" | "dark";

const THEME_KEY = "mdreader.theme";
const LAST_FILE_KEY = "mdreader.lastFile";
const LAST_ROOT_KEY = "mdreader.lastRoot";
const MARKDOWN_LINK = /\.(md|markdown|mdown|mkd|txt)(#.*)?$/i;

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const ui = {
  tree: byId<HTMLDivElement>("tree"),
  rootName: byId<HTMLDivElement>("root-name"),
  docTitle: byId<HTMLDivElement>("doc-title"),
  viewer: byId<HTMLElement>("viewer"),
  scroll: byId<HTMLDivElement>("viewer-scroll"),
  empty: byId<HTMLDivElement>("empty"),
  statusPath: byId<HTMLSpanElement>("status-path"),
  statusMeta: byId<HTMLSpanElement>("status-meta"),
  btnFile: byId<HTMLButtonElement>("btn-open-file"),
  btnFolder: byId<HTMLButtonElement>("btn-open-folder"),
  btnTheme: byId<HTMLButtonElement>("btn-theme"),
  toast: byId<HTMLDivElement>("toast"),
};

const state = {
  currentPath: null as string | null,
  currentMtime: 0,
  theme: (localStorage.getItem(THEME_KEY) as Theme | null) ?? "auto",
  timer: 0,
};

let toastTimer = 0;
function toast(message: string): void {
  ui.toast.textContent = message;
  ui.toast.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => ui.toast.classList.remove("show"), 2600);
}

const sidebar = new Sidebar(ui.tree, (path) => void openFile(path), toast);

function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s+/g, "-");
}

function paint(content: string, path: string): void {
  ui.empty.hidden = true;
  ui.viewer.hidden = false;
  ui.viewer.innerHTML = renderMarkdown(content);
  decorate(path);
  ui.scroll.scrollTop = 0;

  const { chars, minutes } = countText(content);
  ui.statusMeta.textContent = `${chars.toLocaleString("zh-CN")} 字 · 约 ${minutes} 分钟`;
}

function decorate(filePath: string): void {
  const folder = dirname(filePath);

  ui.viewer.querySelectorAll<HTMLImageElement>("img").forEach((image) => {
    const src = image.getAttribute("src") ?? "";
    if (!src || /^(https?:|data:|blob:)/i.test(src)) return;
    const url = resolveAssetUrl(joinPath(folder, decodeURI(src)));
    if (url) image.src = url;
    else image.classList.add("img-missing");
  });

  const used = new Set<string>();
  ui.viewer.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6").forEach((heading, index) => {
    let id = slugify(heading.textContent ?? "") || `heading-${index + 1}`;
    while (used.has(id)) id = `${id}-${index + 1}`;
    used.add(id);
    heading.id = id;
  });

  ui.viewer.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((anchor) => {
    anchor.addEventListener("click", (event) => {
      const href = anchor.getAttribute("href") ?? "";
      if (!href) return;
      event.preventDefault();

      if (href.startsWith("#")) {
        const raw = href.slice(1);
        const target = document.getElementById(raw) ?? document.getElementById(decodeURIComponent(raw));
        target?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      if (/^(https?:|mailto:)/i.test(href)) {
        void openExternal(href);
        return;
      }
      if (MARKDOWN_LINK.test(href)) {
        void openFile(joinPath(folder, decodeURI(href.split("#")[0])));
        return;
      }
      toast("暂不支持打开该链接：" + href);
    });
  });
}

async function openFile(path: string): Promise<void> {
  try {
    const payload = await readFile(path);
    state.currentPath = payload.path;
    state.currentMtime = payload.mtime;

    ui.docTitle.textContent = payload.name;
    ui.docTitle.title = payload.path;
    ui.statusPath.textContent = payload.path;
    document.title = `${payload.name} · MD Reader`;
    localStorage.setItem(LAST_FILE_KEY, payload.path);
    sidebar.setActive(payload.path);
    paint(payload.content, payload.path);
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error));
  }
}

async function openFolderPath(path: string): Promise<void> {
  localStorage.setItem(LAST_ROOT_KEY, path);
  ui.rootName.textContent = basename(path);
  ui.rootName.title = path;
  await sidebar.setRoot(path);
}

async function chooseFolder(): Promise<void> {
  try {
    const path = await openFolderDialog();
    if (path) await openFolderPath(path);
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error));
  }
}

async function chooseFile(): Promise<void> {
  try {
    const path = await openFileDialog();
    if (path) await openFile(path);
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error));
  }
}

function resolveTheme(): "light" | "dark" {
  if (state.theme === "auto") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return state.theme;
}

function applyTheme(): void {
  document.documentElement.dataset.theme = resolveTheme();
  ui.btnTheme.textContent = state.theme === "auto" ? "跟随系统" : state.theme === "light" ? "浅色" : "深色";
}

function cycleTheme(): void {
  state.theme = state.theme === "auto" ? "light" : state.theme === "light" ? "dark" : "auto";
  localStorage.setItem(THEME_KEY, state.theme);
  applyTheme();
}

function watchFile(): void {
  window.clearInterval(state.timer);
  state.timer = window.setInterval(async () => {
    if (!state.currentPath) return;
    try {
      const mtime = await fileMtime(state.currentPath);
      if (mtime && mtime !== state.currentMtime) {
        const payload = await readFile(state.currentPath);
        state.currentMtime = payload.mtime;
        paint(payload.content, payload.path);
      }
    } catch {
      /* 文件可能已被移动，保持当前内容 */
    }
  }, 900);
}

function bindEvents(): void {
  ui.btnFile.addEventListener("click", () => void chooseFile());
  ui.btnFolder.addEventListener("click", () => void chooseFolder());
  ui.btnTheme.addEventListener("click", cycleTheme);

  window.addEventListener("keydown", (event) => {
    if (!event.ctrlKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === "o") {
      event.preventDefault();
      void chooseFolder();
    } else if (key === "p") {
      event.preventDefault();
      void chooseFile();
    } else if (key === "j") {
      event.preventDefault();
      cycleTheme();
    }
  });

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (state.theme === "auto") applyTheme();
  });

  window.addEventListener("dragenter", () => markDropHint(true));
  window.addEventListener("dragleave", (event) => {
    if (event.clientX === 0 && event.clientY === 0) markDropHint(false);
  });
}

async function boot(): Promise<void> {
  applyTheme();
  bindEvents();
  watchFile();

  await registerDropHandler(async (paths) => {
    markDropHint(false);
    const target = paths.find((path) => MARKDOWN_LINK.test(path)) ?? paths[0];
    if (target) await openFile(target);
  });

  if (new URLSearchParams(location.search).has("demo")) {
    ui.docTitle.textContent = "阅读器演示";
    paint(SAMPLE_MARKDOWN, "@demo/示例文档.md");
    return;
  }

  if (!isTauri()) {
    ui.rootName.textContent = location.protocol === "file:" ? "免安装版 · 拖入文件" : "浏览器预览模式";
    return;
  }

  const lastRoot = localStorage.getItem(LAST_ROOT_KEY);
  if (lastRoot) {
    try {
      await openFolderPath(lastRoot);
    } catch {
      /* 目录可能已不存在 */
    }
  }

  // 双击 .md 文件再次启动时，同一实例内切换到新文档
  await listen<string>("open-file", (event) => {
    void openFile(event.payload);
  });

  const launched = await invoke<string | null>("take_pending_launch").catch(() => null);

  const lastFile = launched ?? localStorage.getItem(LAST_FILE_KEY);
  if (lastFile) {
    try {
      await openFile(lastFile);
    } catch {
      /* 文件可能已被删除 */
    }
  }
}

void boot();
