import "./styles/base.css";
import "./styles/markdown.css";
import "./styles/code.css";
import "./styles/editor.css";

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { Sidebar } from "./components/Sidebar";
import { Editor } from "./editor/Editor";
import { renderMarkdown } from "./markdown/render";
import {
  createFile,
  fileMtime,
  isTauri,
  markDropHint,
  openExternal,
  openFileDialog,
  openFolderDialog,
  readFile,
  registerDropHandler,
  resolveAssetUrl,
  saveFileDialog,
  writeFile,
} from "./api/backend";
import { basename, countText, dirname, joinPath } from "./utils";
import { SAMPLE_MARKDOWN } from "./sample";

type Theme = "auto" | "light" | "dark";

const THEME_KEY = "mdreader.theme";
const LAST_FILE_KEY = "mdreader.lastFile";
const LAST_ROOT_KEY = "mdreader.lastRoot";
const AUTOSAVE_KEY = "mdreader.autosave";
const DRAFT_PREFIX = "mdreader.draft:";
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
  btnEdit: byId<HTMLButtonElement>("btn-edit"),
  editPane: byId<HTMLDivElement>("edit-pane"),
  editToolbar: byId<HTMLDivElement>("edit-toolbar"),
  editSplit: byId<HTMLDivElement>("edit-split"),
  editorHost: byId<HTMLDivElement>("editor-host"),
  editPreview: byId<HTMLDivElement>("edit-preview"),
  editViewer: byId<HTMLElement>("edit-viewer"),
  btnSave: byId<HTMLButtonElement>("btn-save"),
  btnNew: byId<HTMLButtonElement>("btn-new"),
  btnAutosave: byId<HTMLButtonElement>("btn-autosave"),
  btnPreviewToggle: byId<HTMLButtonElement>("btn-preview-toggle"),
  toast: byId<HTMLDivElement>("toast"),
};

const state = {
  currentPath: null as string | null,
  currentMtime: 0,
  theme: (localStorage.getItem(THEME_KEY) as Theme | null) ?? "auto",
  timer: 0,
  mode: "read" as "read" | "edit",
  currentContent: "",
  savedText: "",
  editorDirty: false,
  autosave: localStorage.getItem(AUTOSAVE_KEY) === "1",
  previewCollapsed: false,
  renderTimer: 0,
  autosaveTimer: 0,
  draftTimer: 0,
  previewScrollStamp: 0,
};

const editor = new Editor(ui.editorHost);

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

function updateStatusMeta(text: string): void {
  const { chars, minutes } = countText(text);
  const suffix = state.mode === "edit" && state.editorDirty ? " · 未保存" : "";
  ui.statusMeta.textContent = `${chars.toLocaleString("zh-CN")} 字 · 约 ${minutes} 分钟${suffix}`;
}

function paint(content: string, path: string): void {
  ui.empty.hidden = true;
  ui.viewer.hidden = false;
  ui.btnEdit.hidden = false;
  ui.viewer.innerHTML = renderMarkdown(content);
  decorate(ui.viewer, path);
  ui.scroll.scrollTop = 0;
  state.currentContent = content;
  updateStatusMeta(content);
}

function decorate(container: HTMLElement, filePath: string): void {
  const folder = dirname(filePath);

  container.querySelectorAll<HTMLImageElement>("img").forEach((image) => {
    const src = image.getAttribute("src") ?? "";
    if (!src || /^(https?:|data:|blob:)/i.test(src)) return;
    const url = resolveAssetUrl(joinPath(folder, decodeURI(src)));
    if (url) image.src = url;
    else image.classList.add("img-missing");
  });

  const used = new Set<string>();
  container.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6").forEach((heading, index) => {
    let id = slugify(heading.textContent ?? "") || `heading-${index + 1}`;
    while (used.has(id)) id = `${id}-${index + 1}`;
    used.add(id);
    heading.id = id;
  });

  container.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((anchor) => {
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

    if (state.mode === "edit") loadIntoEditor(payload.path, payload.content, payload.mtime);
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error));
  }
}

/* ---------------- 编辑模式 ---------------- */

function draftKey(path: string): string {
  return DRAFT_PREFIX + path;
}

function renderPreview(text: string): void {
  ui.editViewer.innerHTML = renderMarkdown(text);
  if (state.currentPath) decorate(ui.editViewer, state.currentPath);
}

function schedulePreview(text: string): void {
  window.clearTimeout(state.renderTimer);
  state.renderTimer = window.setTimeout(() => renderPreview(text), 200);
}

function scheduleDraft(text: string): void {
  window.clearTimeout(state.draftTimer);
  const path = state.currentPath;
  if (!path) return;
  state.draftTimer = window.setTimeout(() => {
    if (!state.editorDirty) {
      localStorage.removeItem(draftKey(path));
      return;
    }
    try {
      localStorage.setItem(draftKey(path), text);
    } catch {
      /* 配额不足时忽略草稿 */
    }
  }, 2500);
}

function scheduleAutosave(): void {
  window.clearTimeout(state.autosaveTimer);
  if (!state.autosave) return;
  state.autosaveTimer = window.setTimeout(() => void saveEdit(), 1500);
}

function onEditorChange(text: string): void {
  state.editorDirty = text !== state.savedText;
  updateStatusMeta(text);
  schedulePreview(text);
  scheduleDraft(text);
  if (state.autosave && state.editorDirty) scheduleAutosave();
  else window.clearTimeout(state.autosaveTimer);
}

function bindEditorScroll(): void {
  const scroller = editor.scrollElement();
  if (!scroller) return;
  scroller.addEventListener("scroll", () => {
    if (state.previewCollapsed) return;
    if (Date.now() - state.previewScrollStamp < 800) return;
    const max = scroller.scrollHeight - scroller.clientHeight;
    if (max <= 0) return;
    const ratio = scroller.scrollTop / max;
    const target = ui.editPreview.scrollHeight - ui.editPreview.clientHeight;
    if (target > 0) ui.editPreview.scrollTop = ratio * target;
  });
}

function loadIntoEditor(path: string, content: string, mtime: number): void {
  let text = content;
  const stored = localStorage.getItem(draftKey(path));
  if (stored !== null && stored !== content) {
    if (window.confirm("检测到该文件上次未保存的草稿，是否恢复？")) text = stored;
    else localStorage.removeItem(draftKey(path));
  }

  state.currentPath = path;
  state.currentMtime = mtime;
  state.savedText = content;
  state.editorDirty = text !== content;

  editor.open(text);
  editor.onChange(onEditorChange);
  editor.onSave(() => void saveEdit());
  editor.onExit(() => void setEditMode(false));

  renderPreview(text);
  updateStatusMeta(text);
  bindEditorScroll();
  editor.focus();
}

async function saveEdit(force = false): Promise<boolean> {
  const path = state.currentPath;
  if (!path || state.mode !== "edit") return false;

  const text = editor.getText();

  try {
    const mtime = await writeFile(path, text, force ? null : state.currentMtime);
    state.currentMtime = mtime;
    state.savedText = text;
    state.editorDirty = false;
    state.currentContent = text;
    localStorage.removeItem(draftKey(path));
    ui.viewer.innerHTML = renderMarkdown(text);
    decorate(ui.viewer, path);
    updateStatusMeta(text);
    toast(isTauri() ? "已保存" : "已导出下载");
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("CONFLICT")) {
      const overwrite = window.confirm("该文件已被其他程序修改。\n仍要覆盖保存吗？（取消＝保留磁盘上的版本）");
      if (overwrite) return saveEdit(true);
      state.currentMtime = Number(message.split(":")[1] ?? 0) || state.currentMtime;
      return false;
    }
    toast(message);
    return false;
  }
}

async function saveEditAs(): Promise<void> {
  const path = state.currentPath;
  if (!path) return;
  if (!isTauri()) {
    toast("免安装版不支持另存为");
    return;
  }

  const target = await saveFileDialog(basename(path));
  if (!target) return;

  const text = editor.getText();
  try {
    const mtime = await writeFile(target, text, null);
    state.currentPath = target;
    state.currentMtime = mtime;
    state.savedText = text;
    state.editorDirty = false;
    state.currentContent = text;

    localStorage.setItem(LAST_FILE_KEY, target);
    ui.docTitle.textContent = basename(target);
    ui.docTitle.title = target;
    ui.statusPath.textContent = target;
    document.title = `${basename(target)} · MD Reader`;
    sidebar.setActive(target);
    paint(text, target);
    toast("已另存为 " + basename(target));
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error));
  }
}

async function setEditMode(on: boolean): Promise<void> {
  if (on) {
    if (!state.currentPath) {
      toast("先打开一个文件再编辑");
      return;
    }
    state.mode = "edit";
    ui.scroll.hidden = true;
    ui.editPane.hidden = false;
    ui.btnEdit.textContent = "完成";
    loadIntoEditor(state.currentPath, state.currentContent, state.currentMtime);
    return;
  }

  if (state.editorDirty) {
    const save = window.confirm("有未保存的修改，保存后退出编辑吗？（取消＝放弃修改）");
    if (save && !(await saveEdit())) return;
    if (!save && state.currentPath) localStorage.removeItem(draftKey(state.currentPath));
  }

  editor.destroy();
  state.mode = "read";
  state.editorDirty = false;
  ui.editPane.hidden = true;
  ui.scroll.hidden = false;
  ui.btnEdit.textContent = "编辑";

  const path = state.currentPath;
  if (path) {
    try {
      const payload = await readFile(path);
      state.currentMtime = payload.mtime;
      paint(payload.content, path);
    } catch {
      /* 文件被移动时保留当前内容 */
    }
  }
}

async function newFile(): Promise<void> {
  if (!isTauri()) {
    toast("免安装版不支持新建文件，请使用桌面版");
    return;
  }
  const dir = state.currentPath ? dirname(state.currentPath) : localStorage.getItem(LAST_ROOT_KEY);
  if (!dir) {
    toast("请先打开一个文件夹");
    return;
  }
  if (state.mode === "edit" && state.editorDirty && !window.confirm("当前修改尚未保存，继续将放弃这些修改，是否继续？")) {
    return;
  }

  try {
    const path = await createFile(dir);
    await openFolderPath(dir);
    state.mode = "edit";
    ui.scroll.hidden = true;
    ui.editPane.hidden = false;
    ui.btnEdit.textContent = "完成";
    await openFile(path);
    editor.focus();
    toast("已新建 " + basename(path));
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error));
  }
}

function toggleAutosave(): void {
  state.autosave = !state.autosave;
  localStorage.setItem(AUTOSAVE_KEY, state.autosave ? "1" : "0");
  ui.btnAutosave.textContent = `自动保存：${state.autosave ? "开" : "关"}`;
  if (state.autosave && state.editorDirty) scheduleAutosave();
}

function togglePreview(): void {
  state.previewCollapsed = !state.previewCollapsed;
  ui.editSplit.classList.toggle("collapsed", state.previewCollapsed);
  ui.btnPreviewToggle.textContent = state.previewCollapsed ? "展开预览" : "收起预览";
}

function runToolbarCommand(cmd: string | null): void {
  switch (cmd) {
    case "bold":
      editor.wrapSelection("**", "**", "加粗文字");
      break;
    case "italic":
      editor.wrapSelection("*", "*", "斜体文字");
      break;
    case "heading":
      editor.toggleLinePrefix("## ");
      break;
    case "quote":
      editor.toggleLinePrefix("> ");
      break;
    case "list":
      editor.toggleLinePrefix("- ");
      break;
    case "task":
      editor.toggleLinePrefix("- [ ] ");
      break;
    case "code":
      editor.wrapCodeBlock();
      break;
    case "link":
      editor.wrapSelection("[", "](https://)", "链接文字");
      break;
    case "image":
      editor.insertText("![图片描述](图片路径)", 2);
      break;
    default:
      break;
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
        if (state.mode === "edit") {
          if (state.editorDirty) {
            toast("文件已被外部修改，保存时会提示冲突");
            return;
          }
          const payload = await readFile(state.currentPath);
          state.currentMtime = payload.mtime;
          state.savedText = payload.content;
          state.currentContent = payload.content;
          editor.setText(payload.content);
          renderPreview(payload.content);
          updateStatusMeta(payload.content);
          return;
        }

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

  ui.btnEdit.addEventListener("click", () => void setEditMode(state.mode === "read"));
  ui.btnSave.addEventListener("click", () => void saveEdit());
  ui.btnNew.addEventListener("click", () => void newFile());
  ui.btnAutosave.addEventListener("click", toggleAutosave);
  ui.btnPreviewToggle.addEventListener("click", togglePreview);

  ui.editToolbar.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-cmd]");
    if (button) runToolbarCommand(button.dataset.cmd ?? null);
  });

  ui.editPreview.addEventListener("scroll", () => {
    state.previewScrollStamp = Date.now();
  });

  window.addEventListener("keydown", (event) => {
    if (!event.ctrlKey || event.altKey || event.defaultPrevented) return;
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
    } else if (key === "e") {
      event.preventDefault();
      void setEditMode(state.mode === "read");
    } else if (key === "s") {
      event.preventDefault();
      if (state.mode === "edit") void (event.shiftKey ? saveEditAs() : saveEdit());
      else toast("当前处于阅读模式，按 Ctrl+E 进入编辑");
    } else if (key === "n") {
      event.preventDefault();
      void newFile();
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
  ui.btnAutosave.textContent = `自动保存：${state.autosave ? "开" : "关"}`;

  if (isTauri()) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const appWindow = getCurrentWindow();
    void appWindow.onCloseRequested(async (event) => {
      if (state.mode !== "edit" || !state.editorDirty) return;
      event.preventDefault();
      const save = window.confirm("有未保存的修改，保存并关闭吗？（取消＝放弃修改并关闭）");
      if (save) await saveEdit();
      await appWindow.destroy();
    });
  }

  await registerDropHandler(async (paths) => {
    markDropHint(false);
    const target = paths.find((path) => MARKDOWN_LINK.test(path)) ?? paths[0];
    if (target) await openFile(target);
  });

  if (new URLSearchParams(location.search).has("demo")) {
    ui.docTitle.textContent = "阅读器演示";
    state.currentPath = "@demo/示例文档.md";
    state.currentMtime = Date.now();
    ui.statusPath.textContent = state.currentPath;
    paint(SAMPLE_MARKDOWN, state.currentPath);
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
