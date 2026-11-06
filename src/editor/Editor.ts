import { EditorState } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  highlightSpecialChars,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, indentUnit, syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { markdown, markdownLanguage, markdownKeymap } from "@codemirror/lang-markdown";
import { tags as t } from "@lezer/highlight";

/** 与阅读主题共用 CSS 变量的高亮配色 */
const highlight = HighlightStyle.define([
  { tag: t.heading, color: "var(--text)", fontWeight: "600" },
  { tag: t.heading1, fontSize: "1.35em" },
  { tag: t.heading2, fontSize: "1.2em" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.link, color: "var(--accent)" },
  { tag: t.url, color: "var(--accent)" },
  { tag: t.monospace, color: "var(--accent)" },
  { tag: t.quote, color: "var(--text-soft)" },
  { tag: t.list, color: "var(--accent)" },
  { tag: t.processingInstruction, color: "var(--text-faint)" },
]);

export type ChangeHandler = (text: string) => void;

/** CodeMirror 6 封装：负责编辑器生命周期与文本操作，模式切换由 main.ts 控制 */
export class Editor {
  private host: HTMLElement;
  private view: EditorView | null = null;

  private changeHandler: ChangeHandler | null = null;
  private saveHandler: (() => void) | null = null;
  private exitHandler: (() => void) | null = null;

  constructor(host: HTMLElement) {
    this.host = host;
  }

  open(initialText: string): void {
    this.destroy();
    const self = this;

    this.view = new EditorView({
      parent: this.host,
      state: EditorState.create({
        doc: initialText,
        extensions: [
          lineNumbers(),
          highlightSpecialChars(),
          history(),
          drawSelection(),
          dropCursor(),
          rectangularSelection(),
          crosshairCursor(),
          highlightActiveLine(),
          bracketMatching(),
          indentUnit.of("    "),
          EditorState.tabSize.of(4),
          markdown({ base: markdownLanguage }),
          syntaxHighlighting(highlight),
          keymap.of([
            {
              key: "Mod-s",
              run: () => {
                self.saveHandler?.();
                return true;
              },
            },
            {
              key: "Mod-e",
              run: () => {
                self.exitHandler?.();
                return true;
              },
            },
            ...markdownKeymap,
            ...historyKeymap,
            indentWithTab,
            ...defaultKeymap,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) self.changeHandler?.(self.getText());
          }),
          EditorView.theme({
            "&": { height: "100%", backgroundColor: "var(--bg)", color: "var(--text)" },
            ".cm-scroller": {
              fontFamily: '"Cascadia Code", Consolas, "Microsoft YaHei UI", monospace',
              fontSize: "14px",
              lineHeight: "1.75",
              padding: "14px 4px",
            },
            ".cm-content": { caretColor: "var(--accent)", paddingBottom: "40vh" },
            ".cm-gutters": {
              backgroundColor: "var(--bg-panel)",
              color: "var(--text-faint)",
              border: "none",
              borderRight: "1px solid var(--border)",
            },
            ".cm-activeLine": { backgroundColor: "var(--bg-hover)" },
            ".cm-activeLineGutter": { backgroundColor: "var(--bg-hover)", color: "var(--text-soft)" },
            "&.cm-focused": { outline: "none" },
            ".cm-selectionBackground, ::selection": { backgroundColor: "var(--accent-soft) !important" },
            ".cm-cursor": { borderLeftColor: "var(--accent)" },
          }),
        ],
      }),
    });
  }

  getText(): string {
    return this.view ? this.view.state.doc.toString() : "";
  }

  focus(): void {
    this.view?.focus();
  }

  /** 编辑器滚动容器，用于与预览同步滚动 */
  scrollElement(): HTMLElement | null {
    return this.view?.scrollDOM ?? null;
  }

  destroy(): void {
    this.view?.destroy();
    this.view = null;
  }

  onChange(handler: ChangeHandler): void {
    this.changeHandler = handler;
  }

  onSave(handler: () => void): void {
    this.saveHandler = handler;
  }

  onExit(handler: () => void): void {
    this.exitHandler = handler;
  }

  /** 用文本替换整个文档（切换文件 / 恢复草稿），不触发额外历史 */
  setText(text: string): void {
    if (!this.view) return;
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: text },
      selection: { anchor: 0 },
    });
  }

  /** 包裹选区，无选区时插入占位符并选中 */
  wrapSelection(before: string, after: string = before, placeholder = "文本"): void {
    const view = this.view;
    if (!view) return;
    for (const range of view.state.selection.ranges) {
      const selected = view.state.sliceDoc(range.from, range.to) || placeholder;
      view.dispatch({
        changes: { from: range.from, to: range.to, insert: before + selected + after },
        selection: { anchor: range.from + before.length, head: range.from + before.length + selected.length },
      });
    }
    view.focus();
  }

  /** 为选区所在行添加/移除行前缀（标题、引用、列表、任务） */
  toggleLinePrefix(prefix: string): void {
    const view = this.view;
    if (!view) return;
    const changes: { from: number; to?: number; insert?: string }[] = [];
    const seen = new Set<number>();

    for (const range of view.state.selection.ranges) {
      const first = view.state.doc.lineAt(range.from).number;
      const last = view.state.doc.lineAt(range.to).number;
      for (let no = first; no <= last; no += 1) {
        if (seen.has(no)) continue;
        seen.add(no);
        const line = view.state.doc.line(no);
        if (line.text.startsWith(prefix)) {
          changes.push({ from: line.from, to: line.from + prefix.length, insert: "" });
        } else {
          changes.push({ from: line.from, insert: prefix });
        }
      }
    }
    if (changes.length) view.dispatch({ changes });
    view.focus();
  }

  /** 在光标处插入文本 */
  insertText(text: string, cursorOffset?: number): void {
    const view = this.view;
    if (!view) return;
    const pos = view.state.selection.main.head;
    view.dispatch({
      changes: { from: pos, insert: text },
      selection: { anchor: pos + (cursorOffset ?? text.length) },
    });
    view.focus();
  }

  /** 用代码围栏包裹选区 */
  wrapCodeBlock(): void {
    const view = this.view;
    if (!view) return;
    const range = view.state.selection.main;
    const selected = view.state.sliceDoc(range.from, range.to);
    if (selected) {
      const insert = "```\n" + selected + "\n```\n";
      view.dispatch({ changes: { from: range.from, to: range.to, insert } });
    } else {
      const insert = "```\n\n```";
      view.dispatch({ changes: { from: range.from, insert }, selection: { anchor: range.from + 4 } });
    }
    view.focus();
  }
}
