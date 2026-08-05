/* ============================================================
   Acesso remoto: fluxo de consentimento do compartilhamento de
   tela no cenário real (duas páginas, PeerServer de verdade).
   O getDisplayMedia é substituído por uma tela fake (canvas),
   porque o picker do navegador não é automatizável. O teste valida
   o que o app promete para uma pessoa cega:
   - pedir -> a pessoa OUVE a pergunta em PT-BR
   - aceitar -> anúncio "está sendo compartilhada agora" + indicador
   - parar -> anúncio + câmera restaurada no sender
   - nunca silêncio, nunca tela compartilhada por acidente.
   Requer: npm i && npx playwright install chromium
============================================================ */
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const { ExpressPeerServer } = require("peer");
const { chromium } = require("playwright");

// O ExpressPeerServer mantém timers próprios (expiração/alive-check) que
// seguram o event loop depois que o HTTP server fecha. Sem a saída forçada
// o processo não termina mesmo com os testes verdes.
after(() => { process.exit(process.exitCode || 0); });

const ROOT = path.join(__dirname, "..");
const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };

function servidorEstatico(porta) {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p === "/") p = "/index.html";
    const arquivo = path.join(ROOT, p);
    if (!fs.existsSync(arquivo) || fs.statSync(arquivo).isDirectory()) {
      res.writeHead(404); res.end("not found"); return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(arquivo)] || "application/octet-stream" });
    fs.createReadStream(arquivo).pipe(res);
  });
  const sockets = new Set();
  server.on("connection", s => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
  return {
    server,
    listen: porta => new Promise(r => server.listen(porta, "127.0.0.1", r)),
    close: () => new Promise(r => {
      server.close(() => r());
      for (const s of sockets) s.destroy();
    })
  };
}

function peerServerHTTP(porta) {
  const app = express();
  const server = app.listen(porta, "127.0.0.1");
  app.use("/", ExpressPeerServer(server, { path: "/" }));
  const sockets = new Set();
  server.on("connection", s => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
  return {
    server,
    close: () => new Promise(r => {
      server.close(() => r());
      for (const s of sockets) s.destroy();
    })
  };
}

const PATCH_FALA = `(() => {
  window.__fala = [];
  window.speechSynthesis.speak = (u) => { window.__fala.push(u.text); };
})();`;

// Tela fake: canvas stream substituindo o picker do navegador.
const PATCH_TELA = `(() => {
  const c = document.createElement("canvas");
  c.width = 640; c.height = 360;
  const st = c.captureStream(1);
  navigator.mediaDevices.getDisplayMedia = () => Promise.resolve(st);
})();`;

const UA = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--no-sandbox"];

async function montarCena(sigPorta, appPorta) {
  const sig = peerServerHTTP(sigPorta);
  const app = servidorEstatico(appPorta);
  await app.listen(appPorta);
  const browser = await chromium.launch({ args: UA });
  const ctx = await browser.newContext({ permissions: ["camera", "microphone"] });
  const configInj = `window.__VEJO_CONFIG__ = { peerServer: { host: "127.0.0.1", port: ${sigPorta}, path: "/" } };`;
  const pV = await ctx.newPage();
  const pU = await ctx.newPage();
  for (const p of [pV, pU]) {
    await p.addInitScript(configInj);
    await p.addInitScript(PATCH_FALA);
    await p.addInitScript(PATCH_TELA);
  }
  return {
    sig, app, browser, pV, pU,
    limpar: async () => {
      await browser.close();
      await app.close();
      await sig.close();
    }
  };
}

test("pedido, aceite e parada do compartilhamento de tela com anúncios falados", async () => {
  const cena = await montarCena(9020, 9021);
  try {
    const { pV, pU } = cena;

    await pV.goto("http://127.0.0.1:9021/index.html");
    await pV.click("#btnVoluntario");
    await pV.waitForFunction(() => {
      const s = document.querySelector("#statusVoluntario");
      return s && s.innerText.includes("de plantão");
    }, null, { timeout: 20000 });

    await pU.goto("http://127.0.0.1:9021/index.html");
    await pU.click("#btnUsuario");
    await pU.waitForFunction(() => {
      const s = document.querySelector("#statusUsuario");
      return s && s.innerText.includes("Conectado");
    }, null, { timeout: 30000 });
    await pV.waitForFunction(() => {
      const v = document.querySelector("#videoRemoto");
      return v && !v.classList.contains("oculto");
    }, null, { timeout: 30000 });

    // Voluntário pede. Nada de tela antes do pedido.
    await pV.click("#btnPedirTela");

    // A pessoa OUVE a pergunta e vê o botão de aceitar.
    await pU.waitForFunction(() =>
      (window.__fala || []).some(f => f.includes("quer ver a sua tela")), null, { timeout: 20000 });
    const aguardando = await pU.evaluate(() => ({
      estado: window.__VEJO_DEBUG__.tela.estado,
      aceitarVisivel: !document.querySelector("#btnAceitarTela").classList.contains("oculto"),
      telaJaEnviada: !!window.__VEJO_DEBUG__.tela.stream
    }));
    assert.equal(aguardando.estado, "aguardando");
    assert.ok(aguardando.aceitarVisivel, "botão 'Mostrar a tela' visível na pergunta");
    assert.ok(!aguardando.telaJaEnviada, "nada é capturado antes do consentimento");

    // Aceita: anúncio central, indicador, voluntário sabe que está ativo.
    await pU.click("#btnAceitarTela");
    await pU.waitForFunction(() => window.__VEJO_DEBUG__.tela.estado === "ativo", null, { timeout: 20000 });
    await pU.waitForFunction(() =>
      (window.__fala || []).some(f => f.includes("está sendo compartilhada agora")), null, { timeout: 15000 });
    const ativo = await pU.evaluate(() => ({
      indicador: !document.querySelector("#indicadorTela").classList.contains("oculto"),
      pararVisivel: !document.querySelector("#btnPararTela").classList.contains("oculto"),
      senderId: (() => {
        const pc = window.__VEJO_DEBUG__.usuario.chamada.peerConnection;
        const s = pc.getSenders().find(x => x.track && x.track.kind === "video");
        return s ? s.track.id : null;
      })(),
      telaId: window.__VEJO_DEBUG__.tela.stream.getVideoTracks()[0].id
    }));
    assert.ok(ativo.indicador, "indicador contínuo visível");
    assert.ok(ativo.pararVisivel, "parar sempre acessível em um toque");
    assert.equal(ativo.senderId, ativo.telaId, "sender agora transmite a tela");
    await pV.waitForFunction(() =>
      !document.querySelector("#btnPararVerTela").classList.contains("oculto"), null, { timeout: 20000 });

    // Parar: anúncio, indicador some e a câmera volta ao sender.
    await pU.click("#btnPararTela");
    await pU.waitForFunction(() => window.__VEJO_DEBUG__.tela.estado === "parado", null, { timeout: 15000 });
    await pU.waitForFunction(() =>
      (window.__fala || []).some(f => f.includes("parou")), null, { timeout: 15000 });
    const parado = await pU.evaluate(() => ({
      indicador: !document.querySelector("#indicadorTela").classList.contains("oculto"),
      pararVisivel: !document.querySelector("#btnPararTela").classList.contains("oculto"),
      senderId: (() => {
        const pc = window.__VEJO_DEBUG__.usuario.chamada.peerConnection;
        const s = pc.getSenders().find(x => x.track && x.track.kind === "video");
        return s && s.track ? s.track.id : null;
      })(),
      telaId: null
    }));
    assert.ok(!parado.indicador, "indicador some ao parar");
    assert.ok(!parado.pararVisivel, "parar esconde ao parar");
    assert.ok(parado.senderId, "câmera restaurada no sender");
    assert.notEqual(parado.senderId, ativo.senderId, "não é mais a tela sendo enviada");

    // Voluntário volta a poder pedir (ciclo se repete sem recriar a chamada).
    await pV.waitForFunction(() =>
      !document.querySelector("#btnPedirTela").classList.contains("oculto"), null, { timeout: 20000 });
    const estadoFinal = await pV.evaluate(() => {
      const dbg = window.__VEJO_DEBUG__;
      return { ocupado: dbg.voluntario.ocupado, tela: dbg.tela.estado };
    });
    assert.ok(estadoFinal.ocupado, "chamada segue viva após parar a tela");
    assert.equal(estadoFinal.tela, "parado");
  } finally {
    await cena.limpar();
  }
});
