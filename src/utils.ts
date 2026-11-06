export function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

export function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}

export function dirname(path: string): string {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index <= 0 ? path : path.slice(0, index);
}

/** 将相对路径解析为绝对路径（同时兼容 Windows 与 POSIX 分隔符） */
export function joinPath(base: string, relative: string): string {
  const separator = base.includes("\\") && !base.includes("/") ? "\\" : "/";
  const parts = base.split(/[\\/]/).filter(Boolean);
  for (const segment of relative.split(/[\\/]/)) {
    if (!segment || segment === ".") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return parts.join(separator);
}

export function countText(content: string): { chars: number; minutes: number } {
  const cjk = (content.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  const latin = (content.replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, " ").match(/[A-Za-z0-9][A-Za-z0-9_'-]*/g) || [])
    .length;
  const chars = cjk + latin;
  const minutes = Math.max(1, Math.round(cjk / 400 + latin / 220));
  return { chars, minutes };
}

export function debounce<T extends (...args: never[]) => void>(fn: T, delay: number): T {
  let timer: number | undefined;
  return ((...args: never[]) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), delay);
  }) as T;
}
