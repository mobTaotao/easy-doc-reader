import { listDir, type Entry } from "../api/backend";

export interface SidebarHandlers {
  rename: (path: string, newName: string) => void;
  remove: (path: string) => void;
  create: (dir: string) => void;
}

function parentOf(path: string): string {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index > 0 ? path.slice(0, index) : path;
}

export class Sidebar {
  private cache = new Map<string, Entry[]>();
  private expanded = new Set<string>();
  private rootPath: string | null = null;
  private activePath: string | null = null;
  private readonly menu: HTMLDivElement;
  private renamingPath: string | null = null;

  constructor(
    private readonly el: HTMLElement,
    private readonly onOpen: (path: string) => void,
    private readonly onError: (message: string) => void,
    private readonly handlers: SidebarHandlers,
  ) {
    this.menu = document.createElement("div");
    this.menu.className = "ctx-menu";
    this.menu.hidden = true;
    document.body.append(this.menu);

    document.addEventListener("click", () => this.hideMenu());
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") this.hideMenu();
    });
    window.addEventListener("blur", () => this.hideMenu());

    this.el.addEventListener("contextmenu", (event) => {
      if (event.target !== this.el) return;
      event.preventDefault();
      this.showMenu(null, event.clientX, event.clientY);
    });
  }

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

  /** 重新读取已展开目录，保持展开状态与滚动位置 */
  async refresh(): Promise<void> {
    if (!this.rootPath) return;
    this.cache.clear();
    const targets = [this.rootPath, ...this.expanded];
    await Promise.all(targets.map((path) => this.load(path)));
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

  private hideMenu(): void {
    this.menu.hidden = true;
  }

  private showMenu(entry: Entry | null, x: number, y: number): void {
    const items: { label: string; run: () => void }[] = [];

    if (entry && !entry.isDir) {
      items.push({ label: "重命名", run: () => this.startRename(entry.path) });
      items.push({ label: "删除", run: () => this.handlers.remove(entry.path) });
    }

    const dir = entry ? (entry.isDir ? entry.path : parentOf(entry.path)) : this.rootPath;
    if (dir) items.push({ label: "新建 Markdown", run: () => this.handlers.create(dir) });

    this.menu.replaceChildren(
      ...items.map((item) => {
        const button = document.createElement("button");
        button.className = "ctx-item";
        button.textContent = item.label;
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          this.hideMenu();
          item.run();
        });
        return button;
      }),
    );

    this.menu.style.left = `${Math.min(x, window.innerWidth - 170)}px`;
    this.menu.style.top = `${Math.min(y, window.innerHeight - 120)}px`;
    this.menu.hidden = false;
  }

  private startRename(path: string): void {
    this.renamingPath = path;
    this.render();
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

      const chev = document.createElement("span");
      chev.className = "chev";
      chev.textContent = entry.isDir ? (open ? "▾" : "▸") : "";

      const label = document.createElement("span");
      label.className = "label";
      if (this.renamingPath === entry.path) {
        const input = document.createElement("input");
        input.className = "rename-input";
        input.value = entry.name;
        input.addEventListener("click", (event) => event.stopPropagation());
        input.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            const value = input.value.trim();
            this.renamingPath = null;
            if (value && value !== entry.name) this.handlers.rename(entry.path, value);
            else this.render();
          } else if (event.key === "Escape") {
            event.stopPropagation();
            this.renamingPath = null;
            this.render();
          }
        });
        input.addEventListener("blur", () => {
          if (this.renamingPath === entry.path) {
            this.renamingPath = null;
            this.render();
          }
        });
        label.append(input);
        queueMicrotask(() => {
          input.focus();
          input.select();
        });
      } else {
        label.textContent = entry.name;
      }

      row.append(chev, label);

      row.addEventListener("click", () => {
        if (entry.isDir) void this.toggle(entry.path);
        else this.onOpen(entry.path);
      });
      row.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.showMenu(entry, event.clientX, event.clientY);
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
