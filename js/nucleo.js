/* ============================================================
   Vejo por Você — Núcleo
   Funções puras de estado e de texto. Sem DOM, sem PeerJS:
   testáveis em Node (node:test) e usadas pelo app.js no browser.
   Formato duplo: window.Nucleo no navegador, module.exports no Node.
============================================================ */
(function(){
  "use strict";

  function construirSlots(prefixo, numSlots){
    return Array.from({length:numSlots}, (_,i)=> `${prefixo}-slot-${i+1}`);
  }

  // conectou = true significa que algum voluntário atendeu a sinalização
  // mas o stream de vídeo não chegou (NAT simétrico / sem TURN).
  function mensagemTimeOut(conectou){
    return conectou
      ? { t:"A conexão de vídeo falhou.", sub:"Tente novamente." }
      : { t:"Nenhum voluntário disponível agora.", sub:"Tente novamente em alguns minutos." };
  }

  function decisaoMudo(habilitado){
    return habilitado
      ? { texto:"Mutar microfone", fala:"Microfone ativado." }
      : { texto:"Ativar microfone", fala:"Microfone mutado." };
  }

  function mensagemEncerrar(remoto, caiu){
    if(caiu) return "A conexão caiu.";
    return remoto ? "O voluntário encerrou." : "Chamada encerrada.";
  }

  // Mapeia o estado da RTCPeerConnection (WebRTC) para texto e fala em PT-BR.
  // Fonte de verdade: os eventos oniceconnectionstatechange / onconnectionstatechange,
  // NÃO navigator.connection (ausente no iOS Safari).
  // connected -> "Conectado de novo." só é anunciado após uma recuperação (app decide).
  function mensagemEstadoConexao(estado){
    switch(estado){
      case "connected":    return { texto:"Conectado de novo.", fala:"Conectado de novo." };
      case "disconnected": return { texto:"Conexão instável, reconectando.", fala:"Conexão instável, reconectando." };
      case "failed":       return { texto:"A chamada caiu, tentando reconectar.", fala:"A chamada caiu, tentando reconectar." };
      case "closed":       return { texto:"Chamada encerrada.", fala:"Chamada encerrada." };
      default:             return null;
    }
  }

  // ============================================================
  // Acesso remoto: compartilhamento de tela.
  // Só o "vejo a sua tela" (A). "Operar o aparelho" (B) não existe
  // para app de terceiro em celular: iOS por sandbox, Android por
  // política de loja. Máquina de estados pura, sem DOM: mesma base
  // para o app nativo (iOS ReplayKit / Android MediaProjection) e
  // para o web no desktop (getDisplayMedia). O consentimento é o
  // coração: falado em PT-BR, revogável a qualquer instante.
  // ============================================================

  const ESTADOS_COMPARTILHAMENTO = Object.freeze(["parado","aguardando","iniciando","ativo"]);

  // Transições válidas. Eventos: pedir (voluntário), aceitar/recusar
  // (usuário), iniciado (captura começou de verdade), parar (local,
  // remoto ou sistema), erro (captura falhou), finalizado (sistema
  // derrubou, ex.: parou pelo Control Center / notificação).
  const TRANSICOES_COMPARTILHAMENTO = {
    parado:     { pedir:"aguardando", parar:"parado" },
    aguardando: { pedir:"aguardando", aceitar:"iniciando", recusar:"parado", parar:"parado" },
    iniciando:  { iniciado:"ativo", parar:"parado", erro:"parado", finalizado:"parado" },
    ativo:      { parar:"parado", finalizado:"parado", erro:"parado" }
  };

  function proximoEstadoCompartilhamento(estado, evento){
    const t = TRANSICOES_COMPARTILHAMENTO[estado];
    return t ? (t[evento] || null) : null;
  }

  // Anúncio por estado, em PT-BR. origem (estado anterior) evita
  // anunciar "nada está sendo compartilhado" como se fosse erro quando
  // acabou de parar. Usado no texto visível (leitor de tela) e na fala.
  function mensagensCompartilhamento(estado, origem){
    switch(estado){
      case "parado":
        if(origem === "ativo") return { texto:"Compartilhamento de tela parado.", fala:"O compartilhamento de tela parou." };
        if(origem === "aguardando" || origem === "iniciando") return { texto:"Compartilhamento cancelado.", fala:"Você não mostrou a tela. Compartilhamento cancelado." };
        return { texto:"Nada está sendo compartilhado.", fala:"Nada está sendo compartilhado." };
      case "aguardando":
        return { texto:"O voluntário quer ver a sua tela.", fala:"O voluntário quer ver a sua tela. Toque em mostrar para aceitar, ou em não agora para recusar. Nada é gravado." };
      case "iniciando":
        return { texto:"Preparando o compartilhamento de tela...", fala:"Preparando o compartilhamento de tela. Pode aparecer uma confirmação do sistema. Aceite para continuar." };
      case "ativo":
        return { texto:"Sua tela está sendo compartilhada agora.", fala:"Sua tela está sendo compartilhada agora. Nada é gravado. Para parar, toque no botão parar de compartilhar." };
      default:
        return null;
    }
  }

  // Controles disponíveis por estado e perfil. "indicador" é o aviso
  // contínuo (badge + re-anúncio) enquanto estiver ativo. Regra de
  // acessibilidade: em "ativo" o usuário SEMPRE tem o parar à mão.
  function controlesCompartilhamento(estado){
    switch(estado){
      case "parado":     return { usuario:[], voluntario:["pedir"] };
      case "aguardando": return { usuario:["aceitar","recusar","parar"], voluntario:[] };
      case "iniciando":  return { usuario:["parar"], voluntario:[] };
      case "ativo":      return { usuario:["parar","indicador"], voluntario:["parar"] };
      default:           return { usuario:[], voluntario:[] };
    }
  }

  // Tabela honesta de viabilidade por plataforma (confirmada em 2026).
  // Controle remoto em celular: iOS impossível (sandbox), Android
  // exigiria accessibility service com risco alto de política de loja.
  // Compartilhamento em web mobile: sem getDisplayMedia.
  const VIABILIDADE_ACESSO_REMOTO = Object.freeze({
    "web-ios":        { viavel:false, recurso:"compartilhar tela", exige:"app nativo (ReplayKit); o Safari iOS não tem getDisplayMedia." },
    "web-android":    { viavel:false, recurso:"compartilhar tela", exige:"app nativo (MediaProjection); o Chrome Android não tem getDisplayMedia." },
    "web-desktop":    { viavel:true,  recurso:"compartilhar tela", exige:"getDisplayMedia no desktop." },
    "nativo-ios":     { viavel:true,  recurso:"compartilhar tela", exige:"ReplayKit broadcast extension + App Group; track de tela na mesma sessão." },
    "nativo-android": { viavel:true,  recurso:"compartilhar tela", exige:"MediaProjection + foreground service mediaProjection; track de tela na mesma sessão." },
    "controle-ios":   { viavel:false, recurso:"controlar aparelho", exige:"impossível: sandbox não permite app de terceiro operar o device." },
    "controle-android":{ viavel:false, recurso:"controlar aparelho", exige:"accessibility service com restrição e risco de política de loja." }
  });

  function viabilidadeAcessoRemoto(plataforma){
    return VIABILIDADE_ACESSO_REMOTO[plataforma] || null;
  }

  const Nucleo = {
    construirSlots, mensagemTimeOut, decisaoMudo, mensagemEncerrar, mensagemEstadoConexao,
    ESTADOS_COMPARTILHAMENTO, proximoEstadoCompartilhamento, mensagensCompartilhamento,
    controlesCompartilhamento, VIABILIDADE_ACESSO_REMOTO, viabilidadeAcessoRemoto
  };

  if(typeof window !== "undefined") window.Nucleo = Nucleo;
  if(typeof module !== "undefined") module.exports = Nucleo;
})();
