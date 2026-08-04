/* ============================================================
   Reprodução da queda de rede (WiFi -> dados móveis) no meio da chamada.

   Por que este teste existe:
   - No aparelho real, trocar de rede derruba a sinalização (socket do PeerJS)
     e, sem ICE restart + TURN, mata a mídia. Neste sandbox não é possível
     trocar a interface de rede, então a parte de MÍDIA é simulada dirigindo
     os eventos da RTCPeerConnection pela fiação real do app (teste 2).
   - A parte de SINALIZAÇÃO é reproduzida de verdade: derruba-se o PeerServer
     no meio de uma chamada real entre duas páginas (teste 1).

   O que valida (o coração do bug):
   - Nenhum estado de conexão é silencioso: tudo é falado em PT-BR.
   - A sinalização reconecta sozinha (peer.reconnect) quando volta.
   - disconnected -> "Conexão instável, reconectando."
   - failed -> "A chamada caiu, tentando reconectar." e fallback limpo.
   - connected (após recuperação) -> "Conectado de novo."
   - Sem teardown prematuro, sem duplicar chamada, sem vazar mídia.

   Requer: npm i && npx playwright install chromium
=========================================================== */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const { ExpressPeerServer } = require("peer");
const { chromium } = require("playwright");

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

// Captura as falas (fala em PT-BR) substituindo o speechSynthesis.
const PATCH_FALA = `(() => {
  window.__fala = [];
  window.speechSynthesis.speak = (u) => { window.__fala.push(u.text); };
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
  }
  return {
    sig, app, browser, ctx, pV, pU,
    limpar: async () => {
      await browser.close();
      await app.close();
      await sig.close();
    }
  };
}

const probe = (p) => p.evaluate(() => {
  const dbg = window.__VEJO_DEBUG__;
  const u = dbg && dbg.usuario, v = dbg && dbg.voluntario;
  const c = (u && u.chamada) || (v && v.chamada);
  const peer = (u && u.peer) || (v && v.peer);
  const statusEl = document.querySelector(".tela.ativa .status");
  return {
    status: statusEl ? statusEl.innerText : null,
    pcIce: c && c.peerConnection ? c.peerConnection.iceConnectionState : null,
    peerDisconnected: peer ? peer.disconnected : null,
    peerDestroyed: peer ? peer.destroyed : null,
    fala: window.__fala || [],
  };
});

test("queda de sinalização no meio da chamada: fala 'reconectando', reconecta e volta a 'Conectado de novo.'", async () => {
  const cena = await montarCena(9010, 9011);
  try {
    const { pV, pU, sig } = cena;

    await pV.goto("http://127.0.0.1:9011/index.html");
    await pV.click("#btnVoluntario");
    await pV.waitForFunction(() => {
      const s = document.querySelector("#statusVoluntario");
      return s && s.innerText.includes("de plantão");
    }, null, { timeout: 20000 });

    await pU.goto("http://127.0.0.1:9011/index.html");
    await pU.click("#btnUsuario");
    await pU.waitForFunction(() => {
      const s = document.querySelector("#statusUsuario");
      return s && s.innerText.includes("Conectado");
    }, null, { timeout: 30000 });
    await pV.waitForFunction(() => {
      const v = document.querySelector("#videoRemoto");
      return v && !v.classList.contains("oculto");
    }, null, { timeout: 30000 });

    // Derruba a sinalização (equivalente ao socket caindo na troca de rede).
    await sig.close();
    await pU.waitForFunction(() =>
      (window.__fala || []).some(f => f.includes("reconectando")), null, { timeout: 5000 });
    await pV.waitForFunction(() =>
      (window.__fala || []).some(f => f.includes("reconectando")), null, { timeout: 5000 });

    const durante = { U: await probe(pU), V: await probe(pV) };
    assert.ok(!durante.U.peerDestroyed, "usuário não deve ser destruído durante a queda");
    assert.ok(!durante.V.peerDestroyed, "voluntário não deve ser destruído durante a queda");

    // Religar a sinalização: o app deve reconectar sozinho e anunciar.
    const sig2 = peerServerHTTP(9010);
    try {
      await pU.waitForFunction(() =>
        (window.__fala || []).some(f => f.includes("Conectado de novo")), null, { timeout: 15000 });
      await pV.waitForFunction(() =>
        (window.__fala || []).some(f => f.includes("Conectado de novo")), null, { timeout: 15000 });
      const depois = { U: await probe(pU), V: await probe(pV) };
      for (const lado of ["U", "V"]) {
        assert.ok(!depois[lado].peerDisconnected, `${lado}: peer deve reconectar`);
        assert.ok(!depois[lado].peerDestroyed, `${lado}: peer não deve ser destruído`);
        assert.equal(depois[lado].pcIce, "connected", `${lado}: mídia deve continuar conectada`);
        assert.ok(!depois[lado].fala.some(f => f.includes("A conexão caiu")),
          `${lado}: não deve anunciar queda irrecuperável`);
        assert.ok(depois[lado].fala.some(f => f.includes("reconectando")),
          `${lado}: deve ter falado 'reconectando' (nunca silêncio)`);
        assert.ok(depois[lado].fala.some(f => f.includes("Conectado de novo")),
          `${lado}: deve anunciar a recuperação`);
      }
    } finally {
      await sig2.close();
    }
  } finally {
    await cena.limpar();
  }
});

test("eventos da RTCPeerConnection falam em PT-BR e caem no fallback limpo", async () => {
  const cena = await montarCena(9012, 9013);
  try {
    const { pU } = cena;
    await pU.goto("http://127.0.0.1:9013/index.html");

    const rel = await pU.evaluate(async () => {
      const dbg = window.__VEJO_DEBUG__;
      const fakePC = {
        iceConnectionState: "new",
        connectionState: "new",
        signalingState: "stable",
        restartIce: () => { window.__restart = (window.__restart || 0) + 1; },
      };
      const fakeChamada = { peerConnection: fakePC };
      dbg.vigiarConexao(fakeChamada, "usuario");
      const out = { fases: [] };

      fakePC.iceConnectionState = "disconnected";
      fakePC.oniceconnectionstatechange();
      out.fases.push({ estado: "disconnected", fala: window.__fala.slice(), recuperando: dbg.recuperando, restart: window.__restart || 0 });

      fakePC.iceConnectionState = "connected";
      fakePC.oniceconnectionstatechange();
      out.fases.push({ estado: "connected", fala: window.__fala.slice(), recuperando: dbg.recuperando });

      fakePC.iceConnectionState = "failed";
      fakePC.oniceconnectionstatechange();
      out.fases.push({ estado: "failed", fala: window.__fala.slice(), recuperando: dbg.recuperando, restart: window.__restart || 0 });

      await new Promise(r => setTimeout(r, dbg.TEMPO_RECUPERACAO + 500));
      out.final = { recuperando: dbg.recuperando };
      return out;
    });

    const f = rel.fases;
    assert.ok(f[0].fala.some(x => x.includes("Conexão instável, reconectando.")), "disconnected falado");
    assert.ok(f[0].restart >= 1, "tentou ICE restart em disconnected");
    assert.ok(f[1].fala.some(x => x.includes("Conectado de novo.")), "recuperação falada");
    assert.equal(f[1].recuperando, false, "timer de recuperação limpo após connected");
    assert.ok(f[2].fala.some(x => x.includes("A chamada caiu, tentando reconectar.")), "failed falado");
    assert.ok(f[2].restart >= 2, "tentou ICE restart em failed");
    assert.equal(rel.final.recuperando, false, "fallback encerra limpo após o tempo de recuperação");
  } finally {
    await cena.limpar();
  }
});
