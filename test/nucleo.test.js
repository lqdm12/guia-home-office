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

test("mensagemEstadoConexao anuncia instabilidade em disconnected", () => {
  assert.deepEqual(Nucleo.mensagemEstadoConexao("disconnected"), {
    texto: "Conexão instável, reconectando.", fala: "Conexão instável, reconectando."
  });
});

test("mensagemEstadoConexao anuncia queda com tentativa em failed", () => {
  assert.deepEqual(Nucleo.mensagemEstadoConexao("failed"), {
    texto: "A chamada caiu, tentando reconectar.", fala: "A chamada caiu, tentando reconectar."
  });
});

test("mensagemEstadoConexao cobre connected e closed", () => {
  assert.equal(Nucleo.mensagemEstadoConexao("connected").texto, "Conectado de novo.");
  assert.equal(Nucleo.mensagemEstadoConexao("closed").fala, "Chamada encerrada.");
});

test("mensagemEstadoConexao ignora estados desconhecidos", () => {
  assert.equal(Nucleo.mensagemEstadoConexao("weird"), null);
  assert.equal(Nucleo.mensagemEstadoConexao(undefined), null);
});

/* ---------------- Acesso remoto: compartilhamento de tela ---------------- */

test("fluxo feliz: parado -> aguardando -> iniciando -> ativo -> parado", () => {
  assert.equal(Nucleo.proximoEstadoCompartilhamento("parado", "pedir"), "aguardando");
  assert.equal(Nucleo.proximoEstadoCompartilhamento("aguardando", "aceitar"), "iniciando");
  assert.equal(Nucleo.proximoEstadoCompartilhamento("iniciando", "iniciado"), "ativo");
  assert.equal(Nucleo.proximoEstadoCompartilhamento("ativo", "parar"), "parado");
});

test("recusa e desistência voltam ao parado", () => {
  assert.equal(Nucleo.proximoEstadoCompartilhamento("aguardando", "recusar"), "parado");
  assert.equal(Nucleo.proximoEstadoCompartilhamento("aguardando", "parar"), "parado");
  assert.equal(Nucleo.proximoEstadoCompartilhamento("iniciando", "parar"), "parado");
});

test("erro e finalizado pelo sistema interrompem a captura", () => {
  assert.equal(Nucleo.proximoEstadoCompartilhamento("iniciando", "erro"), "parado");
  assert.equal(Nucleo.proximoEstadoCompartilhamento("ativo", "erro"), "parado");
  assert.equal(Nucleo.proximoEstadoCompartilhamento("ativo", "finalizado"), "parado");
});

test("transições inválidas retornam null", () => {
  assert.equal(Nucleo.proximoEstadoCompartilhamento("parado", "aceitar"), null);
  assert.equal(Nucleo.proximoEstadoCompartilhamento("ativo", "aceitar"), null);
  assert.equal(Nucleo.proximoEstadoCompartilhamento("aguardando", "iniciado"), null);
  assert.equal(Nucleo.proximoEstadoCompartilhamento("estado-louco", "pedir"), null);
});

test("pedir repetido enquanto aguarda é inofensivo", () => {
  assert.equal(Nucleo.proximoEstadoCompartilhamento("aguardando", "pedir"), "aguardando");
});

test("estados documentados são os esperados", () => {
  assert.deepEqual(Nucleo.ESTADOS_COMPARTILHAMENTO, ["parado","aguardando","iniciando","ativo"]);
});

test("anúncio falado do consentimento pede ação explícita", () => {
  const m = Nucleo.mensagensCompartilhamento("aguardando");
  assert.match(m.fala, /quer ver a sua tela/);
  assert.match(m.fala, /Nada é gravado/);
});

test("anúncio falado quando ativo é o aviso central", () => {
  const m = Nucleo.mensagensCompartilhamento("ativo");
  assert.match(m.fala, /tela está sendo compartilhada agora/);
  assert.match(m.fala, /parar/);
});

test("anúncio ao parar não soa como erro", () => {
  const m = Nucleo.mensagensCompartilhamento("parado", "ativo");
  assert.match(m.fala, /parou/);
  assert.equal(Nucleo.mensagensCompartilhamento("parado").fala, "Nada está sendo compartilhado.");
});

test("em ativo o usuário sempre tem o parar e o indicador", () => {
  const c = Nucleo.controlesCompartilhamento("ativo");
  assert.ok(c.usuario.includes("parar"));
  assert.ok(c.usuario.includes("indicador"));
  assert.ok(c.voluntario.includes("parar"));
});

test("só o voluntário pede, e só na escuta o usuário responde", () => {
  assert.ok(Nucleo.controlesCompartilhamento("parado").voluntario.includes("pedir"));
  assert.deepEqual(Nucleo.controlesCompartilhamento("parado").usuario, []);
  const c = Nucleo.controlesCompartilhamento("aguardando");
  assert.ok(c.usuario.includes("aceitar"));
  assert.ok(c.usuario.includes("recusar"));
  assert.deepEqual(c.voluntario, []);
});

test("viabilidade: web mobile não compartilha, nativo e desktop sim", () => {
  assert.equal(Nucleo.viabilidadeAcessoRemoto("web-ios").viavel, false);
  assert.equal(Nucleo.viabilidadeAcessoRemoto("web-android").viavel, false);
  assert.equal(Nucleo.viabilidadeAcessoRemoto("web-desktop").viavel, true);
  assert.equal(Nucleo.viabilidadeAcessoRemoto("nativo-ios").viavel, true);
  assert.equal(Nucleo.viabilidadeAcessoRemoto("nativo-android").viavel, true);
});

test("viabilidade: controle remoto em celular está fora para terceiros", () => {
  assert.equal(Nucleo.viabilidadeAcessoRemoto("controle-ios").viavel, false);
  assert.equal(Nucleo.viabilidadeAcessoRemoto("controle-android").viavel, false);
  assert.equal(Nucleo.viabilidadeAcessoRemoto("plataforma-x"), null);
});
