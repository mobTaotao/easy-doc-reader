import "./styles/base.css";
import "./styles/markdown.css";
import "./styles/code.css";
import "./styles/editor.css";

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { Sidebar } from "./components/Sidebar";
import { Editor, type EditorLanguage } from "./editor/Editor";
import { renderMarkdown } from "./markdown/render";
import {
  createFile,
  deleteFile,
  fileMtime,
  isTauri,
  markDropHint,
  openExternal,
  openFileDialog,
  openFolderDialog,
  readFile,
  registerDropHandler,
  renameFile,
  resolveAssetUrl,
  saveFileDialog,
  writeFile,
} from "./api/backend";
import { destroyTextViewer, formatJson, mountTextViewer } from "./json/jsonView";
import { basename, countText, dirname, joinPath } from "./utils";
import { SAMPLE_MARKDOWN } from "./sample";

type Theme = "auto" | "light" | "dark";

const THEME_KEY = "mdreader.theme";
const LAST_FILE_KEY = "mdreader.lastFile";
const LAST_ROOT_KEY = "mdreader.lastRoot";
const AUTOSAVE_KEY = "mdreader.autosave";
const DRAFT_PREFIX = "mdreader.draft:";
const MARKDOWN_LINK = /\.(md|markdown|mdown|mkd|txt|json)(#.*)?$/i;
const DOC_EXT = /\.(md|markdown|mdown|mkd|txt|json)$/i;

const isJsonPath = (path: string | null): boolean => Boolean(path && /\.json$/i.test(path));

/** 根据扩展名决定渲染/编辑语言：markdown / json / plain */
const languageFor = (path: string | null): EditorLanguage => {
  if (isJsonPath(path)) return "json";
  if (path && /\.txt$/i.test(path)) return "plain";
  return "markdown";
};

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
  jsonBar: byId<HTMLDivElement>("json-bar"),
  jsonHint: byId<HTMLSpanElement>("json-hint"),
  btnJsonToggle: byId<HTMLButtonElement>("btn-json-toggle"),
  btnJsonCopy: byId<HTMLButtonElement>("btn-json-copy"),
  btnBeautify: byId<HTMLButtonElement>("btn-beautify"),
  btnMinify: byId<HTMLButtonElement>("btn-minify"),
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
  jsonShowRaw: false,
};

const editor = new Editor(ui.editorHost);

let toastTimer = 0;
function toast(message: string): void {
  ui.toast.textContent = message;
  ui.toast.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => ui.toast.classList.remove("show"), 2600);
}

const sidebar = new Sidebar(ui.tree, (path) => void openFile(path), toast, {
  rename: (path, newName) => void handleRename(path, newName),
  remove: (path) => void handleDelete(path),
  create: (dir, kind) => void newFile(dir, kind),
});

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
  ui.scroll.scrollTop = 0;
  state.currentContent = content;

  const lang = languageFor(path);
  if (lang === "json") {
    state.jsonShowRaw = false;
    renderJson(content);
  } else if (lang === "plain") {
    // .txt：纯文本视图，不做 Markdown 解析
    mountTextViewer(ui.viewer, content, "plain");
    ui.jsonBar.hidden = false;
    ui.btnJsonToggle.hidden = true;
    ui.jsonHint.textContent = `纯文本 · ${content ? content.split("\n").length : 0} 行`;
    ui.jsonHint.classList.remove("invalid");
  } else {
    ui.jsonBar.hidden = true;
    ui.btnJsonToggle.hidden = false;
    destroyTextViewer();
    ui.viewer.innerHTML = renderMarkdown(content);
    decorate(ui.viewer, path);
  }

  updateStatusMeta(content);
}

/** 阅读模式渲染 JSON：默认美化展示，可切回原文 */
function renderJson(raw: string): void {
  const result = formatJson(raw, false);
  const display = state.jsonShowRaw || !result.ok ? raw : (result.value ?? raw);

  mountTextViewer(ui.viewer, display, "json");
  ui.btnJsonToggle.hidden = false;
  ui.jsonBar.hidden = false;
  ui.jsonHint.textContent = result.ok ? "合法 JSON · 已格式化展示" : `解析失败：${result.error}`;
  ui.jsonHint.classList.toggle("invalid", !result.ok);
  ui.btnJsonToggle.textContent = state.jsonShowRaw ? "美化展示" : "查看原文";
  ui.btnJsonToggle.disabled = !result.ok;
}

function toggleJsonRaw(): void {
  if (!isJsonPath(state.currentPath)) return;
  state.jsonShowRaw = !state.jsonShowRaw;
  renderJson(state.currentContent);
}

async function copyJson(): Promise<void> {
  const result = formatJson(state.currentContent, false);
  const text = state.jsonShowRaw || !result.ok ? state.currentContent : (result.value ?? state.currentContent);
  try {
    await navigator.clipboard.writeText(text);
    toast("已复制当前 JSON");
  } catch {
    toast("复制失败，请手动选择复制");
  }
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
  if (isJsonPath(state.currentPath)) return;
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

  const lang = languageFor(path);
  editor.open(text, lang);
  editor.onChange(onEditorChange);
  editor.onSave(() => void saveEdit());
  editor.onExit(() => void setEditMode(false));

  // JSON / 纯文本不需要 Markdown 预览，保持单栏编辑
  ui.editToolbar.classList.toggle("json-mode", lang === "json");
  ui.editToolbar.classList.toggle("plain-mode", lang === "plain");
  ui.btnPreviewToggle.hidden = lang !== "markdown";
  ui.editSplit.classList.toggle("collapsed", lang !== "markdown" || state.previewCollapsed);

  if (lang === "markdown") renderPreview(text);
  updateStatusMeta(text);
  if (lang === "markdown") bindEditorScroll();
  editor.focus();
}

async function saveEdit(force = false): Promise<boolean> {
  const path = state.currentPath;
  if (!path || state.mode !== "edit") return false;

  const text = editor.getText();

  if (isJsonPath(path) && !force) {
    const check = formatJson(text, false);
    if (!check.ok) {
      const proceed = window.confirm(`JSON 格式错误：\n${check.error}\n\n仍要保存吗？`);
      if (!proceed) return false;
    }
  }

  try {
    const mtime = await writeFile(path, text, force ? null : state.currentMtime);
    state.currentMtime = mtime;
    state.savedText = text;
    state.editorDirty = false;
    localStorage.removeItem(draftKey(path));
    paint(text, path);
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
    // 扩展名可能在保存时变化（md ↔ json），重建编辑器以匹配语法与工具栏
    loadIntoEditor(target, text, mtime);
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
  ui.editToolbar.classList.remove("json-mode", "plain-mode");
  ui.btnPreviewToggle.hidden = false;

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

async function newFile(targetDir?: string, kind: "md" | "txt" | "json" = "md"): Promise<void> {
  if (!isTauri()) {
    toast("免安装版不支持新建文件，请使用桌面版");
    return;
  }
  const dir = targetDir ?? (state.currentPath ? dirname(state.currentPath) : localStorage.getItem(LAST_ROOT_KEY));
  if (!dir) {
    toast("请先打开一个文件夹");
    return;
  }
  if (state.mode === "edit" && state.editorDirty && !window.confirm("当前修改尚未保存，继续将放弃这些修改，是否继续？")) {
    return;
  }

  try {
    const path = await createFile(dir, kind);
    const root = localStorage.getItem(LAST_ROOT_KEY);
    if (root && root === dir) await sidebar.refresh();
    else await openFolderPath(dir);

    state.mode = "edit";
    ui.scroll.hidden = true;
    ui.editPane.hidden = false;
    ui.btnEdit.textContent = "完成";
    await openFile(path);
    editor.focus();
    sidebar.startRename(path);
    toast("已新建 " + basename(path) + "，输入新文件名后回车");
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error));
  }
}

/* ---------------- 文件重命名与删除 ---------------- */

async function handleRename(path: string, newName: string): Promise<void> {
  if (!DOC_EXT.test(newName)) {
    toast("扩展名必须是 md / txt / json");
    return;
  }

  const isCurrent = state.currentPath === path;
  if (isCurrent && state.mode === "edit" && state.editorDirty) {
    toast("请先保存或放弃未保存的修改，再重命名");
    return;
  }

  try {
    const newPath = await renameFile(path, newName);

    const draft = localStorage.getItem(draftKey(path));
    if (draft !== null) {
      localStorage.removeItem(draftKey(path));
      localStorage.setItem(draftKey(newPath), draft);
    }

    if (isCurrent) {
      state.currentPath = newPath;
      ui.docTitle.textContent = basename(newPath);
      ui.docTitle.title = newPath;
      ui.statusPath.textContent = newPath;
      document.title = `${basename(newPath)} · MD Reader`;
      localStorage.setItem(LAST_FILE_KEY, newPath);
      sidebar.setActive(newPath);
      paint(state.currentContent, newPath);
    }

    await sidebar.refresh();
    toast("已重命名为 " + newName);
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error));
  }
}

async function handleDelete(path: string): Promise<void> {
  if (!window.confirm(`确定删除「${basename(path)}」吗？此操作不可撤销。`)) return;

  const isCurrent = state.currentPath === path;
  if (isCurrent && state.mode === "edit" && state.editorDirty) {
    toast("请先保存或放弃未保存的修改，再删除");
    return;
  }

  try {
    await deleteFile(path);
    localStorage.removeItem(draftKey(path));

    if (isCurrent) {
      editor.destroy();
      state.mode = "read";
      state.editorDirty = false;
      state.currentPath = null;
      state.currentContent = "";
      ui.editPane.hidden = true;
      ui.editToolbar.classList.remove("json-mode", "plain-mode");
      ui.scroll.hidden = false;
      ui.btnEdit.hidden = true;
      ui.btnEdit.textContent = "编辑";
      ui.jsonBar.hidden = true;
      destroyTextViewer();
      ui.viewer.hidden = true;
      ui.viewer.replaceChildren();
      ui.empty.hidden = false;
      ui.docTitle.textContent = "开始阅读";
      ui.statusPath.textContent = "";
      ui.statusMeta.textContent = "";
      document.title = "MD Reader";
      localStorage.removeItem(LAST_FILE_KEY);
      sidebar.setActive(null);
    }

    await sidebar.refresh();
    toast("已删除");
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error));
  }
}

/** 编辑模式 JSON 美化 / 压缩 */
function formatEditorJson(minify: boolean): void {
  if (!isJsonPath(state.currentPath)) return;
  const result = formatJson(editor.getText(), minify);
  if (!result.ok) {
    toast(`JSON 解析失败：${result.error}`);
    return;
  }
  editor.setText(result.value ?? "");
  toast(`${minify ? "已压缩" : "已美化"}，Ctrl+S 保存`);
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

  ui.btnJsonToggle.addEventListener("click", toggleJsonRaw);
  ui.btnJsonCopy.addEventListener("click", () => void copyJson());
  ui.btnBeautify.addEventListener("click", () => formatEditorJson(false));
  ui.btnMinify.addEventListener("click", () => formatEditorJson(true));

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
