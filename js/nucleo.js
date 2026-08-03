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

  const Nucleo = { construirSlots, mensagemTimeOut, decisaoMudo, mensagemEncerrar };

  if(typeof window !== "undefined") window.Nucleo = Nucleo;
  if(typeof module !== "undefined") module.exports = Nucleo;
})();
