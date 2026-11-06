import { chromium } from "playwright-core";

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1320, height: 840 } });
const errors = [];
page.on("pageerror", (err) => errors.push(String(err)));

await page.goto("http://localhost:5173/?demo=1");
await page.waitForTimeout(800);

// 通过拖拽注入一个压缩过的 JSON 文件
await page.evaluate(() => {
  const data = { name: "测试配置", version: 1, tags: ["a", "b"], nested: { ok: true, none: null } };
  const file = new File([JSON.stringify(data)], "data.json", { type: "application/json" });
  const dt = new DataTransfer();
  dt.items.add(file);
  window.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
});

await page.waitForSelector(".json-host .cm-content", { timeout: 8000 });
await page.waitForTimeout(400);

const readState = await page.evaluate(() => ({
  title: document.getElementById("doc-title")?.textContent,
  barVisible: !document.getElementById("json-bar")?.hidden,
  hint: document.getElementById("json-hint")?.textContent,
  lineCount: document.querySelectorAll(".json-host .cm-line").length,
  toggleLabel: document.getElementById("btn-json-toggle")?.textContent,
}));
await page.screenshot({ path: ".preview/json-read.png" });

// 切换原文（压缩态应为单行）
await page.click("#btn-json-toggle");
await page.waitForTimeout(300);
const rawState = await page.evaluate(() => ({
  lineCount: document.querySelectorAll(".json-host .cm-line").length,
  toggleLabel: document.getElementById("btn-json-toggle")?.textContent,
}));

// 进入编辑模式（JSON 单栏）
await page.click("#btn-json-toggle"); // 回到美化
await page.click("#btn-edit");
await page.waitForSelector("#editor-host .cm-editor", { timeout: 8000 });
const editState = await page.evaluate(() => ({
  jsonToolbar: document.getElementById("edit-toolbar")?.classList.contains("json-mode"),
  mdButtonsHidden: getComputedStyle(document.querySelector('[data-cmd="bold"]')).display === "none",
  beautifyVisible: getComputedStyle(document.getElementById("btn-beautify")).display !== "none",
  previewCollapsed: document.getElementById("edit-split")?.classList.contains("collapsed"),
  editorText: document.querySelector("#editor-host .cm-content")?.textContent?.slice(0, 40),
}));

// 压缩 → 美化
await page.click("#btn-minify");
await page.waitForTimeout(200);
const minifiedLines = await page.evaluate(() => document.querySelectorAll("#editor-host .cm-line").length);
await page.click("#btn-beautify");
await page.waitForTimeout(200);
const beautifiedLines = await page.evaluate(() => document.querySelectorAll("#editor-host .cm-line").length);

await page.screenshot({ path: ".preview/json-edit.png" });
console.log(
  JSON.stringify(
    {
      readState,
      rawState,
      editState,
      minifiedLines,
      beautifiedLines,
      errors,
    },
    null,
    2,
  ),
);
await browser.close();
