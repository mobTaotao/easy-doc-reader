import MarkdownIt from "markdown-it";
import hljs from "highlight.js/lib/common";
import taskLists from "markdown-it-task-lists";

const md: MarkdownIt = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  breaks: false,
  highlight(code: string, language: string): string {
    if (language && hljs.getLanguage(language)) {
      try {
        const result = hljs.highlight(code, { language, ignoreIllegals: true });
        return `<pre class="hljs"><code class="language-${language}">${result.value}</code></pre>`;
      } catch {
        /* 忽略高亮失败，回退到纯文本 */
      }
    }
    return `<pre class="hljs"><code>${md.utils.escapeHtml(code)}</code></pre>`;
  },
});

md.use(taskLists, { enabled: false, label: true, labelAfter: true });

/** 去掉 YAML front matter（阅读器不展示元数据） */
export function stripFrontMatter(source: string): string {
  const text = source.replace(/^\uFEFF/, "");
  if (!/^---[ \t]*\r?\n/.test(text)) return text;
  const match = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/.exec(text);
  return match ? text.slice(match[0].length) : text;
}

export function renderMarkdown(source: string): string {
  return md.render(stripFrontMatter(source));
}
