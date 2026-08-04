const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const ok = await page.evaluate(async () => {
    try {
      const r = await fetch("https://cdnjs.cloudflare.com/ajax/libs/peerjs/1.5.4/peerjs.min.js", { method: "HEAD", signal: AbortSignal.timeout(5000) });
      return r.status;
    } catch (e) { return "ERR " + e.message; }
  });
  console.log("CDN:", ok);
  await browser.close();
})();
