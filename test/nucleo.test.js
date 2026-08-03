const { test } = require("node:test");
const assert = require("node:assert/strict");
const Nucleo = require("../js/nucleo.js");

test("construirSlots gera ids previsíveis na ordem", () => {
  assert.deepEqual(Nucleo.construirSlots("pre", 3), ["pre-slot-1", "pre-slot-2", "pre-slot-3"]);
});

test("construirSlots com 0 slots retorna lista vazia", () => {
  assert.deepEqual(Nucleo.construirSlots("pre", 0), []);
});

test("mensagemTimeOut sem conexão = nenhum voluntário", () => {
  assert.equal(Nucleo.mensagemTimeOut(false).t, "Nenhum voluntário disponível agora.");
});

test("mensagemTimeOut com sinalização aceita mas sem stream = falha de conexão", () => {
  assert.equal(Nucleo.mensagemTimeOut(true).t, "A conexão de vídeo falhou.");
});

test("decisaoMudo mapeia microfone habilitado", () => {
  assert.deepEqual(Nucleo.decisaoMudo(true), { texto: "Mutar microfone", fala: "Microfone ativado." });
});

test("decisaoMudo mapeia microfone mutado", () => {
  assert.deepEqual(Nucleo.decisaoMudo(false), { texto: "Ativar microfone", fala: "Microfone mutado." });
});

test("mensagemEncerrar por ação do usuário", () => {
  assert.equal(Nucleo.mensagemEncerrar(false, false), "Chamada encerrada.");
});

test("mensagemEncerrar por encerramento remoto", () => {
  assert.equal(Nucleo.mensagemEncerrar(true, false), "O voluntário encerrou.");
});

test("mensagemEncerrar prioriza queda de conexão", () => {
  assert.equal(Nucleo.mensagemEncerrar(true, true), "A conexão caiu.");
  assert.equal(Nucleo.mensagemEncerrar(false, true), "A conexão caiu.");
});
