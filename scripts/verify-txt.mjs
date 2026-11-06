import { chromium } from "playwright-core";

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1320, height: 840 } });
const errors = [];
page.on("pageerror", (err) => errors.push(String(err)));

await page.goto("http://localhost:5173/?demo=1");
await page.waitForTimeout(800);

// 注入一个含"伪 Markdown 语法"的 txt 文件
await page.evaluate(() => {
  const text = "# 这不是标题\n- 这不是列表\n\n行尾空格与\t制表符应原样保留";
  const dt = new DataTransfer();
  dt.items.add(new File([text], "notes.txt", { type: "text/plain" }));
  window.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
});

await page.waitForSelector(".json-host .cm-content", { timeout: 8000 });
await page.waitForTimeout(400);

const readState = await page.evaluate(() => ({
  title: document.getElementById("doc-title")?.textContent,
  hint: document.getElementById("json-hint")?.textContent,
  toggleHidden: document.getElementById("btn-json-toggle")?.hidden,
  copyVisible: !document.getElementById("btn-json-copy")?.hidden,
  text: document.querySelector(".json-host .cm-content")?.textContent ?? "",
  hasHeadingTag: Boolean(document.querySelector(".json-host h1")),
  lineCount: document.querySelectorAll(".json-host .cm-line").length,
}));
await page.screenshot({ path: ".preview/txt-read.png" });

await page.click("#btn-edit");
await page.waitForSelector("#editor-host .cm-editor", { timeout: 8000 });
const editState = await page.evaluate(() => ({
  plainToolbar: document.getElementById("edit-toolbar")?.classList.contains("plain-mode"),
  mdHidden: getComputedStyle(document.querySelector('[data-cmd="bold"]')).display === "none",
  beautifyHidden: getComputedStyle(document.getElementById("btn-beautify")).display === "none",
  saveVisible: getComputedStyle(document.getElementById("btn-save")).display !== "none",
  previewCollapsed: document.getElementById("edit-split")?.classList.contains("collapsed"),
  text: document.querySelector("#editor-host .cm-content")?.textContent?.slice(0, 20),
}));

console.log(JSON.stringify({ readState, editState, errors }, null, 2));
await browser.close();
