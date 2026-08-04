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
  // connected -> silencioso é decidido no app (evita ruído); aqui retorna o texto.
  function mensagemEstadoConexao(estado){
    switch(estado){
      case "connected":    return { texto:"Conectado.", fala:"Conectado de novo." };
      case "disconnected": return { texto:"Conexão instável.", fala:"Conexão instável, reconectando." };
      case "failed":       return { texto:"A chamada caiu.", fala:"A chamada caiu, chamando de novo." };
      case "closed":       return { texto:"Chamada encerrada.", fala:"Chamada encerrada." };
      default:             return null;
    }
  }

  const Nucleo = { construirSlots, mensagemTimeOut, decisaoMudo, mensagemEncerrar, mensagemEstadoConexao };

  if(typeof window !== "undefined") window.Nucleo = Nucleo;
  if(typeof module !== "undefined") module.exports = Nucleo;
})();
