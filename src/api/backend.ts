import { convertFileSrc, invoke } from "@tauri-apps/api/core";

export interface Entry {
  name: string;
  path: string;
  isDir: boolean;
}

export interface MdFile {
  path: string;
  name: string;
  content: string;
  mtime: number;
}

export const isTauri = (): boolean => typeof (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ !== "undefined";

/** 浏览器调试模式下的轻量句柄仓库（使前端可在浏览器中预览） */
const browserState = {
  dirs: new Map<string, any>(),
  files: new Map<string, any>(),
};

const MD_PATTERN = /\.(md|markdown|mdown|mkd|txt)$/i;

/** 不支持 File System Access API 时（如直接双击打开的本地 HTML）回退到 input[type=file] */
function pickWithInput(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".md,.markdown,.mdown,.mkd,.txt,text/markdown";
    input.style.display = "none";
    document.body.append(input);

    input.addEventListener("change", () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) {
        resolve(null);
        return;
      }
      const path = `file/${file.name}`;
      browserState.files.set(path, file);
      resolve(path);
    });

    window.addEventListener(
      "focus",
      () => {
        window.setTimeout(() => {
          if (!input.isConnected) return;
          if (!input.files?.length) {
            input.remove();
            resolve(null);
          }
        }, 900);
      },
      { once: true },
    );

    input.click();
  });
}

export async function openFileDialog(): Promise<string | null> {
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Markdown", extensions: ["md", "markdown", "mdown", "mkd", "txt"] }],
    });
    return typeof selected === "string" ? selected : null;
  }

  const picker = (window as any).showOpenFilePicker;
  if (!picker) return pickWithInput();
  const [handle] = await picker({
    multiple: false,
    types: [{ description: "Markdown", accept: { "text/markdown": [".md", ".markdown", ".txt"] } }],
  });
  const path = `file/${handle.name}`;
  browserState.files.set(path, handle);
  return path;
}

export async function openFolderDialog(): Promise<string | null> {
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({ multiple: false, directory: true });
    return typeof selected === "string" ? selected : null;
  }

  const picker = (window as any).showDirectoryPicker;
  if (!picker) throw new Error("免安装版不支持选择文件夹，请把 .md 文件拖入窗口");
  const handle = await picker({ mode: "read" });
  browserState.dirs.set(handle.name, handle);
  return handle.name as string;
}

export async function listDir(path: string): Promise<Entry[]> {
  if (isTauri()) return invoke<Entry[]>("list_dir", { path });

  const handle = browserState.dirs.get(path);
  if (!handle) return [];
  const entries: Entry[] = [];
  for await (const [name, child] of handle.entries()) {
    if (name.startsWith(".")) continue;
    const childPath = `${path}/${name}`;
    if (child.kind === "directory") {
      browserState.dirs.set(childPath, child);
      entries.push({ name, path: childPath, isDir: true });
    } else if (MD_PATTERN.test(name)) {
      browserState.files.set(childPath, child);
      entries.push({ name, path: childPath, isDir: false });
    }
  }
  entries.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name, "zh"));
  return entries;
}

export async function readFile(path: string): Promise<MdFile> {
  if (isTauri()) return invoke<MdFile>("read_markdown", { path });

  const handle = browserState.files.get(path);
  if (!handle) throw new Error("无法读取文件：" + path);
  const file: File = handle.getFile ? await handle.getFile() : handle;
  const content = await file.text();
  return { path, name: file.name, content, mtime: file.lastModified };
}

export async function fileMtime(path: string): Promise<number> {
  if (isTauri()) return invoke<number>("file_mtime", { path });

  const handle = browserState.files.get(path);
  if (!handle) return 0;
  const file: File = handle.getFile ? await handle.getFile() : handle;
  return file.lastModified;
}

/** 保存文件。桌面端走原子写入；浏览器端尝试写回句柄，失败则触发下载。返回新的 mtime。 */
export async function writeFile(path: string, content: string, expectedMtime: number | null): Promise<number> {
  if (isTauri()) return invoke<number>("write_markdown", { path, content, expectedMtime });

  const handle = browserState.files.get(path);
  if (handle?.createWritable) {
    try {
      const writer = await handle.createWritable();
      await writer.write(content);
      await writer.close();
      const file: File = await handle.getFile();
      return file.lastModified;
    } catch {
      /* 无写权限时回退到下载 */
    }
  }

  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = path.split("/").pop() ?? "document.md";
  anchor.click();
  URL.revokeObjectURL(anchor.href);
  return Date.now();
}

/** 在目录下新建"未命名.md"，返回完整路径（仅桌面端）。 */
export async function createFile(dir: string): Promise<string> {
  if (isTauri()) return invoke<string>("create_markdown", { dir });
  throw new Error("免安装版不支持新建文件，请使用桌面版");
}

/** "另存为"对话框（仅桌面端），返回所选路径。 */
export async function saveFileDialog(defaultName: string): Promise<string | null> {
  if (isTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const selected = await save({
      defaultPath: defaultName,
      filters: [{ name: "Markdown", extensions: ["md", "markdown", "mdown", "mkd", "txt"] }],
    });
    return typeof selected === "string" ? selected : null;
  }
  return null;
}

export function resolveAssetUrl(absolutePath: string): string {
  if (!isTauri()) return "";
  try {
    return convertFileSrc(absolutePath);
  } catch {
    return "";
  }
}

export async function openExternal(url: string): Promise<void> {
  if (isTauri()) {
    await invoke("open_external", { url });
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export async function registerDropHandler(onPaths: (paths: string[]) => void): Promise<void> {
  if (isTauri()) {
    const { getCurrentWebview } = await import("@tauri-apps/api/webview");
    await getCurrentWebview().onDragDropEvent((event: any) => {
      const payload = event.payload;
      if (payload?.type === "over" || payload?.type === "enter") return;
      if (payload?.type === "drop" && Array.isArray(payload.paths)) onPaths(payload.paths);
    });
    return;
  }

  window.addEventListener("dragover", (event) => event.preventDefault());
  window.addEventListener("drop", (event) => {
    event.preventDefault();
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (!files.length) return;
    const paths: string[] = [];
    const stamp = Date.now();
    files.forEach((file, index) => {
      const path = `drop/${stamp}-${index}/${file.name}`;
      browserState.files.set(path, file);
      paths.push(path);
    });
    onPaths(paths);
  });
}

export function markDropHint(show: boolean): void {
  const hint = document.getElementById("drop-hint");
  if (hint) hint.classList.toggle("show", show);
}
