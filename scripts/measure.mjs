import { chromium } from "playwright-core";

const url = process.argv[2];
const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1120, height: 740 } });
await page.goto(url);
await page.waitForTimeout(1200);

const metrics = await page.evaluate(() => {
  const scroll = document.getElementById("viewer-scroll");
  const viewer = document.getElementById("viewer");
  const app = document.getElementById("app");
  const cs = scroll ? getComputedStyle(scroll) : null;
  return {
    window: window.innerHeight,
    bodyScrollHeight: document.body.scrollHeight,
    appHeight: app?.getBoundingClientRect().height,
    appScrollHeight: app?.scrollHeight,
    scrollClientHeight: scroll?.clientHeight,
    scrollScrollHeight: scroll?.scrollHeight,
    viewerHeight: viewer?.getBoundingClientRect().height,
    overflowY: cs?.overflowY,
    bodyOverflow: getComputedStyle(document.body).overflow,
  };
});

console.log(JSON.stringify(metrics, null, 2));

await page.screenshot({ path: ".preview/measure-top.png" });
await page.evaluate(() => {
  const el = document.getElementById("viewer-scroll");
  if (el) el.scrollTop = el.scrollHeight;
});
await page.waitForTimeout(300);
await page.screenshot({ path: ".preview/measure-bottom.png" });

await browser.close();
