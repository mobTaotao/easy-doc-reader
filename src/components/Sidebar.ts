import { listDir, type Entry } from "../api/backend";
import { escapeHtml } from "../utils";

export class Sidebar {
  private cache = new Map<string, Entry[]>();
  private expanded = new Set<string>();
  private rootPath: string | null = null;
  private activePath: string | null = null;

  constructor(
    private readonly el: HTMLElement,
    private readonly onOpen: (path: string) => void,
    private readonly onError: (message: string) => void,
  ) {}

  async setRoot(path: string): Promise<void> {
    this.rootPath = path;
    this.cache.clear();
    this.expanded.clear();
    this.expanded.add(path);
    await this.load(path);
    this.render();
  }

  clear(): void {
    this.rootPath = null;
    this.cache.clear();
    this.expanded.clear();
    this.render();
  }

  setActive(path: string | null): void {
    this.activePath = path;
    this.render();
  }

  private async load(path: string): Promise<void> {
    try {
      this.cache.set(path, await listDir(path));
    } catch (error) {
      this.cache.set(path, []);
      this.onError(error instanceof Error ? error.message : String(error));
    }
  }

  private render(): void {
    this.el.replaceChildren();
    if (!this.rootPath) return;
    const level = this.buildLevel(this.rootPath, 0);
    if (level) this.el.append(level);
    this.el.querySelector<HTMLElement>(".tree-row.active")?.scrollIntoView({ block: "nearest" });
  }

  private buildLevel(parent: string, depth: number): HTMLElement | null {
    const entries = this.cache.get(parent);
    if (!entries || entries.length === 0) return null;

    const list = document.createElement("ul");
    list.className = "tree-level";

    for (const entry of entries) {
      const item = document.createElement("li");
      const row = document.createElement("div");
      const open = entry.isDir && this.expanded.has(entry.path);

      row.className = ["tree-row", entry.isDir ? "dir" : "file", entry.path === this.activePath ? "active" : ""]
        .filter(Boolean)
        .join(" ");
      row.style.paddingLeft = `${6 + depth * 12}px`;
      row.title = entry.path;
      row.innerHTML = `<span class="chev">${entry.isDir ? (open ? "▾" : "▸") : ""}</span><span class="label">${escapeHtml(
        entry.name,
      )}</span>`;

      row.addEventListener("click", () => {
        if (entry.isDir) void this.toggle(entry.path);
        else this.onOpen(entry.path);
      });

      item.append(row);
      if (open) {
        const children = this.buildLevel(entry.path, depth + 1);
        if (children) item.append(children);
      }
      list.append(item);
    }

    return list;
  }

  private async toggle(path: string): Promise<void> {
    if (this.expanded.has(path)) {
      this.expanded.delete(path);
      this.render();
      return;
    }

    this.expanded.add(path);
    this.render();
    if (!this.cache.has(path)) {
      await this.load(path);
      this.render();
    }
  }
}
