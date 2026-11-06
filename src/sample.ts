export const SAMPLE_MARKDOWN = `---
title: 阅读器演示文档
---

# 本地 Markdown 阅读器

一个安静、干净、完全离线的 Markdown 阅读工具。打开文件夹，选择左侧任意文档，剩下的交给排版。

## 排版细节

正文使用 16px / 1.8 行高与 748px 阅读栏宽，长文阅读不累眼。支持 **粗体**、*斜体*、~~删除线~~、\`行内代码\` 与 [外部链接](https://commonmark.org)。

> 好的阅读器应该像一张干净的纸：内容在纸上，而不是工具在眼前。

### 列表与任务

1. 打开一个包含 Markdown 的文件夹
2. 点击左侧文件即可渲染
3. 文件被外部编辑保存后，阅读视图自动刷新

- [x] 文件夹树导航
- [x] 标题、表格、代码块渲染
- [x] 亮色 / 暗色主题
- [ ] 文档大纲（后续版本）

### 代码高亮

\`\`\`ts
interface ReaderOptions {
  root: string;
  theme: "light" | "dark";
}

export function open(path: string, options: ReaderOptions) {
  const content = readFileSync(path, "utf-8");
  return render(content, options.theme);
}
\`\`\`

\`\`\`rust
#[tauri::command]
fn read_markdown(path: String) -> Result<MdFile, String> {
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    Ok(MdFile { path, content })
}
\`\`\`

### 表格

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 文件树 | 已完成 | 懒加载子目录 |
| 自动刷新 | 已完成 | 监听文件修改时间 |
| 导出 PDF | 未计划 | 一期专注阅读 |

---

快捷操作：\`Ctrl + O\` 打开文件夹，\`Ctrl + P\` 打开文件。
`;
