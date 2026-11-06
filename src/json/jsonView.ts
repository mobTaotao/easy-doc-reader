import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { json } from "@codemirror/lang-json";
import { syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

const jsonHighlight = HighlightStyle.define([
  { tag: t.propertyName, color: "var(--text-soft)" },
  { tag: t.string, color: "var(--accent)" },
  { tag: t.number, color: "var(--text)", fontWeight: "600" },
  { tag: [t.bool, t.null], color: "var(--text)", fontStyle: "italic" },
  { tag: [t.punctuation, t.separator], color: "var(--text-faint)" },
]);

export interface JsonFormatResult {
  ok: boolean;
  value?: string;
  /** 形如 "第 3 行第 5 列附近：Unexpected token" 的错误描述 */
  error?: string;
}

/** 解析并把错误位置转换为行列号 */
function parseWithErrorPosition(text: string): { ok: true; data: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const match = /position (\d+)/i.exec(message);
    if (match) {
      const pos = Math.min(Number(match[1]), Math.max(text.length - 1, 0));
      const before = text.slice(0, pos);
      const line = before.split("\n").length;
      const col = pos - before.lastIndexOf("\n");
      return { ok: false, error: `第 ${line} 行第 ${col} 列附近：${message}` };
    }
    return { ok: false, error: message };
  }
}

/** 美化 / 压缩 JSON 文本 */
export function formatJson(text: string, minify = false): JsonFormatResult {
  const trimmed = text.trim();
  if (!trimmed) return { ok: true, value: minify ? "" : "" };
  const parsed = parseWithErrorPosition(trimmed);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  return { ok: true, value: minify ? JSON.stringify(parsed.data) : JSON.stringify(parsed.data, null, 2) + "\n" };
}

let readonlyView: EditorView | null = null;

/** 在容器中挂载只读文本查看器（json 语法高亮 / plain 纯文本），重复调用会先销毁上一个 */
export function mountTextViewer(container: HTMLElement, text: string, lang: "json" | "plain"): void {
  destroyTextViewer();

  const host = document.createElement("div");
  host.className = "json-host";
  container.replaceChildren(host);

  readonlyView = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: text,
      extensions: [
        lang === "json" ? json() : [],
        syntaxHighlighting(jsonHighlight),
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        EditorView.lineWrapping,
        EditorView.theme({
          "&": { height: "auto", backgroundColor: "transparent", color: "var(--text)" },
          ".cm-scroller": {
            fontFamily: '"Cascadia Code", Consolas, "Microsoft YaHei UI", monospace',
            fontSize: "13.5px",
            lineHeight: "1.7",
          },
          "&.cm-focused": { outline: "none" },
        }),
      ],
    }),
  });
}

export function destroyTextViewer(): void {
  readonlyView?.destroy();
  readonlyView = null;
}
