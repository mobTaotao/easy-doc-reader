import { chromium } from "playwright-core";

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1320, height: 840 } });
const errors = [];
page.on("pageerror", (err) => errors.push(String(err)));

await page.goto("http://localhost:5173/?demo=1");
await page.waitForSelector("#btn-edit:not([hidden])");
await page.click("#btn-edit");
await page.waitForSelector(".cm-editor", { timeout: 8000 });

await page.click(".cm-content");
await page.keyboard.press("Control+End");
await page.keyboard.type("\n## 编辑模式验证\n\n这里是新输入的内容，右侧应同步渲染。\n");
await page.waitForTimeout(500);

// 工具栏：加粗（无选区 → 插入占位并选中）
await page.click('button[data-cmd="bold"]');
await page.waitForTimeout(400);

const result = await page.evaluate(() => {
  const preview = document.getElementById("edit-viewer");
  const cm = document.querySelector(".cm-editor");
  return {
    editorVisible: Boolean(cm),
    previewHeading: preview?.querySelector("h2:last-of-type")?.textContent ?? null,
    hasBoldPlaceholder: Boolean(preview?.querySelector("strong")),
    previewTextLength: preview?.textContent?.length ?? 0,
    statusMeta: document.getElementById("status-meta")?.textContent ?? "",
  };
});

await page.screenshot({ path: ".preview/edit-mode.png" });

// 收起预览
await page.click("#btn-preview-toggle");
await page.waitForTimeout(300);
const collapsed = await page.evaluate(() => {
  const split = document.getElementById("edit-split");
  const preview = document.getElementById("edit-preview");
  return {
    collapsedClass: split?.classList.contains("collapsed"),
    previewDisplay: preview ? getComputedStyle(preview).display : "missing",
    toggleLabel: document.getElementById("btn-preview-toggle")?.textContent,
  };
});

console.log(JSON.stringify({ result, collapsed, errors }, null, 2));
await browser.close();
