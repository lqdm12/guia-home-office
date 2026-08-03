/* ============================================================
   Teste de acessibilidade estática (axe-core) em browser headless.
   Não substitui teste com leitor de tela real: axe não cobre
   fala dobrada, timing de anúncio, autoplay ou foco dinâmico.
   Requer: npm i && npx playwright install chromium
============================================================ */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };

function servidor() {
  return http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p === "/") p = "/index.html";
    const arquivo = path.join(ROOT, p);
    if (!fs.existsSync(arquivo) || fs.statSync(arquivo).isDirectory()) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(arquivo)] || "application/octet-stream" });
    fs.createReadStream(arquivo).pipe(res);
  });
}

test("index.html sem violações axe serious/critical (WCAG A e AA)", async () => {
  const { chromium } = require("playwright");
  const AxeBuilder = require("@axe-core/playwright").default;

  const server = servidor();
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const porta = server.address().port;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${porta}/index.html`);
    const resultado = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const graves = resultado.violations.filter(v => v.impact === "critical" || v.impact === "serious");
    assert.equal(graves.length, 0,
      "Violações graves/sérias: " + JSON.stringify(
        graves.map(v => ({ id: v.id, nodes: v.nodes.length })), null, 2));
  } finally {
    await browser.close();
    await new Promise(r => server.close(r));
  }
});
