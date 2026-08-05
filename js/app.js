/* ============================================================
   CONFIG
   POOL: slots de plantão. Cada voluntário online ocupa um slot.
   A pessoa que pede ajuda chama todos ao mesmo tempo e conecta
   no primeiro que atender. Aumente NUM_SLOTS para mais voluntários.

   TRANSPORTE: toda a conexão está isolada nas funções
   criarPeer / chamarSlots / receberChamada. É AQUI que se troca
   PeerJS por LiveKit em produção, sem tocar na UI.
============================================================ */
const PREFIXO = "vejo-por-voce-2026-08";
const NUM_SLOTS = 5;
const SLOTS = Nucleo.construirSlots(PREFIXO, NUM_SLOTS);
const STUN = { iceServers:[{ urls:"stun:stun.l.google.com:19302" }] };
const TEMPO_ESPERA = 20000; // ms até desistir se ninguém atender
const TEMPO_RECUPERACAO = 8000; // ms tentando recuperar antes de encerrar e re-chamar

/* ============================================================
   UTILIDADES
============================================================ */
const $ = id => document.getElementById(id);
function mostrarTela(id){
  document.querySelectorAll(".tela").forEach(t=>t.classList.remove("ativa"));
  $(id).classList.add("ativa");
  $(id).focus({preventScroll:true});
}
let ultimaFala = "";
function falar(txt){
  if(!("speechSynthesis" in window)) return;
  if(txt === ultimaFala) return;
  ultimaFala = txt;
  try{
    const u = new SpeechSynthesisUtterance(txt);
    u.lang = "pt-BR"; u.rate = 1;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  }catch(e){}
}
function vibrar(p){ if(navigator.vibrate) try{ navigator.vibrate(p); }catch(e){} }
function status(elId, txt, sub){
  $(elId).innerHTML = txt + (sub ? `<small>${sub}</small>` : "");
  falar(sub ? `${txt} ${sub}` : txt);
}
// Hook de configuração (opcional): __VEJO_CONFIG__.peerServer permite apontar
// o PeerJS para um PeerServer próprio (host/port/path), usado nos testes de
// queda de rede. Sem ele, usa o PeerServer público padrão do PeerJS.
const PEER_SERVER = (window.__VEJO_CONFIG__ && window.__VEJO_CONFIG__.peerServer) || null;
function opcoesPeer(){
  const o = { config: STUN };
  if(PEER_SERVER){
    o.host = PEER_SERVER.host;
    o.port = PEER_SERVER.port;
    o.path = PEER_SERVER.path || "/";
    o.secure = false;
  }
  return o;
}
function criarPeer(id){ return id ? new Peer(id, opcoesPeer()) : new Peer(opcoesPeer()); }

/* ============================================================
   RECUPERAÇÃO DE CONEXÃO (troca de rede no meio da chamada)
   Fonte de verdade: eventos da RTCPeerConnection, acessada por dentro
   do MediaConnection do PeerJS (propriedade peerConnection). NÃO usamos
   navigator.connection (não existe no iOS Safari).

   Limite honesto do PeerJS 1.5.4: ele não expõe ICE restart de forma
   limpa. Internamente, oniceconnectionstatechange só loga "disconnected"
   e fecha a conexão em "failed" (sem renegotiation). A chamada best-effort
   a pc.restartIce() abaixo só funciona se o stack renegociar (negotiationneeded),
   o que o PeerJS não dispara de forma confiável para mídia. Por isso a
   recuperação REAL depende do fallback: encerrar limpo e re-chamar.
============================================================ */
let recuperando = false;
let timerRecuperacao = null;
let ultimaReconexao = 0;
let timerReconexao = null;

// Reconnecta a sinalização com no máximo 1 tentativa/segundo, re-agendando
// sozinha enquanto o PeerServer estiver fora (senão o loop morre no throttle).
// A reconexão é ADIADA (setTimeout 0) porque o PeerJS, após o erro "network",
// chama disconnect() na mesma pilha e fecha o socket recém-criado — reconectar
// síncrono no handler de erro era desfeito logo em seguida.
function reconectarSePreciso(peer){
  if(!peer || !peer.disconnected || peer.destroyed) return;
  const faltam = 1000 - (Date.now() - ultimaReconexao);
  if(faltam > 0){
    clearTimeout(timerReconexao);
    timerReconexao = setTimeout(()=> reconectarSePreciso(peer), faltam);
    return;
  }
  ultimaReconexao = Date.now();
  clearTimeout(timerReconexao);
  setTimeout(()=>{
    if(peer && peer.disconnected && !peer.destroyed){
      try{ peer.reconnect(); }catch(e){}
    }
  }, 0);
}

// Vigia a RTCPeerConnection de uma chamada ativa e anuncia cada estado em PT-BR.
// perfil: "usuario" | "voluntario"
function vigiarConexao(chamada, perfil){
  const pc = chamada && chamada.peerConnection;
  if(!pc) return;
  let instavel = false;
  const elId = perfil === "usuario" ? "statusUsuario" : "statusVoluntario";

  function aoEstado(estado){
    if(estado === "connected"){
      if(instavel){
        instavel = false;
        clearTimeout(timerRecuperacao);
        clearTimeout(timerReconexao);
        recuperando = false;
        falar("Conectado de novo.");
      }
      return;
    }
    if(estado === "disconnected" || estado === "failed"){
      if(instavel) return; // já anunciado, deixando o timer decidir o fallback
      instavel = true;
      status(elId, Nucleo.mensagemEstadoConexao(estado).fala);
      tentarRecuperar(chamada, perfil);
    }
  }

  // Substitui o handler interno do PeerJS: em "failed" o PeerJS fecharia a
  // chamada sem chance de recuperação. Aqui o fallback é decidido por nós.
  try{ pc.oniceconnectionstatechange = () => aoEstado(pc.iceConnectionState); }catch(e){}
  try{ pc.onconnectionstatechange = () => aoEstado(pc.connectionState); }catch(e){}
}

function tentarRecuperar(chamada, perfil){
  if(recuperando) return;
  recuperando = true;
  const peer = perfil === "usuario" ? peerU : peerV;
  reconectarSePreciso(peer);
  const pc = chamada && chamada.peerConnection;
  if(pc && typeof pc.restartIce === "function" && pc.connectionState !== "closed"){
    try{ pc.restartIce(); }catch(e){} // best-effort; ver comentário no cabeçalho
  }
  clearTimeout(timerRecuperacao);
  timerRecuperacao = setTimeout(()=> desistirRecuperacao(perfil), TEMPO_RECUPERACAO);
}

function desistirRecuperacao(perfil){
  clearTimeout(timerRecuperacao);
  recuperando = false;
  if(perfil === "usuario"){
    const pc = chamadaU && chamadaU.peerConnection;
    const vivo = pc && (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed" || pc.connectionState === "connected");
    if(vivo){
      // Só a sinalização caiu, a mídia segue de pé: mantém a chamada e re-tenta.
      timerRecuperacao = setTimeout(()=> desistirRecuperacao(perfil), TEMPO_RECUPERACAO);
      return;
    }
    if(venceu) rechamar();
    else limparUsuario();
  }else{
    if(!ocupado) return; // o evento "close" já finalizou
    const pc = chamadaV && chamadaV.peerConnection;
    const vivo = pc && (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed" || pc.connectionState === "connected");
    if(vivo && peerV && !peerV.destroyed){
      timerRecuperacao = setTimeout(()=> desistirRecuperacao(perfil), TEMPO_RECUPERACAO);
      return;
    }
    encerrarChamadaVolCaiu();
  }
}

// Re-chama o plantão automaticamente, sempre falando. Nunca silêncio.
let rechamada = false;
function rechamar(){
  if(rechamada) return;
  rechamada = true;
  const c = chamadaU; chamadaU = null;
  if(c) try{ c.close(); }catch(e){}
  try{ if(peerU) peerU.destroy(); }catch(e){}
  chamadasU = [];
  venceu = false; caiu = false; recuperando = false;
  clearTimeout(timerRecuperacao);
  status("statusUsuario","A chamada caiu, chamando de novo.","Aguarde um instante.");
  montarPeerUsuario();
}

/* ============================================================
   FLUXO USUÁRIO (pessoa cega pede ajuda)
   Chama todos os slots em paralelo, primeiro a atender vence.
============================================================ */
let peerU=null, streamU=null, chamadaU=null, chamadasU=[], timerEspera=null, venceu=false, caiu=false;

$("btnUsuario").addEventListener("click", iniciarUsuario);

async function iniciarUsuario(){
  mostrarTela("usuario");
  venceu=false; caiu=false; rechamada=false; recuperando=false;
  status("statusUsuario","Preparando a câmera...");
  $("statusUsuario").classList.add("pulso");

  try{
    streamU = await navigator.mediaDevices.getUserMedia({
      video:{ facingMode:{ ideal:"environment" } }, audio:true
    });
  }catch(e){
    $("statusUsuario").classList.remove("pulso");
    return status("statusUsuario","Não consegui acessar a câmera.","Verifique a permissão e tente de novo.");
  }
  $("videoLocal").srcObject = streamU;
  status("statusUsuario","Procurando um voluntário...","Aguarde um instante.");

  montarPeerUsuario();
}

function montarPeerUsuario(){
  peerU = criarPeer();
  peerU.on("open", ()=>{
    clearTimeout(timerReconexao);
    if(recuperando && chamadaU && chamadaU.peerConnection){
      const pc = chamadaU.peerConnection;
      const vivo = pc && (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed" || pc.connectionState === "connected");
      if(vivo){
        // Sinalização voltou e a mídia continua viva: anuncia a recuperação.
        clearTimeout(timerRecuperacao);
        recuperando = false;
        status("statusUsuario", "Conectado de novo.");
      }
    }
    chamarSlots();
  });
  peerU.on("disconnected", ()=> reconectarSePreciso(peerU));
  peerU.on("error", err=>{
    if(err && err.type === "peer-unavailable") return; // slot vazio, normal
    if(err && err.type === "network" && venceu){
      // Sinalização caiu no meio da chamada: anuncia e tenta recuperar.
      status("statusUsuario", Nucleo.mensagemEstadoConexao("disconnected").fala);
      tentarRecuperar(chamadaU, "usuario");
      return;
    }
    if(venceu){ encerrarUsuario(true, true); return; }
    falharUsuario("Erro de conexão.","Verifique sua internet e tente de novo.");
  });
  clearTimeout(timerEspera);
  timerEspera = setTimeout(()=>{
    if(!venceu){
      const m = Nucleo.mensagemTimeOut(chamadasU.some(c=>c && c.open));
      falharUsuario(m.t, m.sub);
    }
  }, TEMPO_ESPERA);
}

function chamarSlots(){
  if(venceu) return; // reconexão de sinalização re-emite "open": não duplica chamadas
  const chamadas = SLOTS.map(slot => peerU.call(slot, streamU));
  chamadasU = chamadas;
  chamadas.forEach(c=>{
    if(!c) return;
    c.on("stream", remoto=>{
      if(venceu){ try{ c.close(); }catch(e){} return; }
      venceu = true;
      rechamada = false; recuperando = false;
      clearTimeout(timerEspera);
      chamadaU = c;
      chamadas.forEach(o=>{ if(o && o!==c) try{ o.close(); }catch(e){} });
      vigiarConexao(c, "usuario");
      abrirCanalControleUsuario();
      $("audioRemotoUsuario").srcObject = remoto;
      $("statusUsuario").classList.remove("pulso");
      status("statusUsuario","Conectado!","Mostre com a câmera o que você precisa. O voluntário está te ouvindo.");
      vibrar([120,60,120]);
    });
    c.on("error", ()=>{ if(venceu && c===chamadaU) caiu = true; });
    c.on("close", ()=>{ if(venceu && c===chamadaU) encerrarUsuario(true, caiu); });
  });
}

function falharUsuario(t, sub){
  clearTimeout(timerEspera);
  $("statusUsuario").classList.remove("pulso");
  status("statusUsuario", t, sub);
  vibrar(300);
  limparUsuario();
}

$("btnEncerrarUsuario").addEventListener("click", ()=> encerrarUsuario(false));

function encerrarUsuario(remoto, caiu=false){
  $("statusUsuario").classList.remove("pulso");
  status("statusUsuario", Nucleo.mensagemEncerrar(remoto, caiu));
  limparUsuario();
  setTimeout(()=> mostrarTela("home"), 1500);
}

function limparUsuario(){
  clearTimeout(timerEspera);
  clearTimeout(timerRecuperacao);
  clearTimeout(timerReconexao);
  recuperando = false; rechamada = false;
  const c = chamadaU; chamadaU = null;
  if(c) try{ c.close(); }catch(e){}
  try{ peerU && peerU.destroy(); }catch(e){}
  try{ dataU && dataU.close(); }catch(e){}
  dataU = null;
  if(streamU) streamU.getTracks().forEach(t=>t.stop());
  peerU = streamU = null; chamadasU = []; venceu = false; caiu = false;
  resetarTelaLocal();
}

/* ============================================================
   FLUXO VOLUNTÁRIO (ocupa o primeiro slot livre e atende)
============================================================ */
let peerV=null, streamV=null, chamadaV=null, ocupado=false, meuSlot=0, timerPlantao=null, timerReanuncio=null, caiuVol=false;

$("btnVoluntario").addEventListener("click", entrarPlantao);

function vigiarPlantao(){
  clearTimeout(timerPlantao);
  timerPlantao = setTimeout(()=>{
    if(!peerV && !ocupado)
      status("statusVoluntario","Erro ao conectar ao plantão.","Verifique sua internet e tente de novo.");
  }, TEMPO_ESPERA);
}

async function entrarPlantao(){
  mostrarTela("voluntario");
  status("statusVoluntario","Conectando ao plantão...");
  try{
    streamV = await navigator.mediaDevices.getUserMedia({ audio:true, video:false });
  }catch(e){
    return status("statusVoluntario","Preciso do microfone para atender.","Libere a permissão e tente de novo.");
  }
  vigiarPlantao();
  ocuparSlot(0);
}

function ocuparSlot(i){
  if(i >= SLOTS.length){
    clearTimeout(timerPlantao);
    status("statusVoluntario","Todos os plantões estão ocupados agora.","Tente novamente em alguns minutos.");
    $("btnSairPlantao").classList.remove("oculto");
    return;
  }
  const p = criarPeer(SLOTS[i]);
  p.on("open", ()=>{
    clearTimeout(timerPlantao);
    clearTimeout(timerReconexao);
    peerV = p; meuSlot = i+1;
    if(ocupado && chamadaV){
      // reconectou no meio de uma chamada
      if(recuperando && chamadaV.peerConnection){
        const pc = chamadaV.peerConnection;
        const vivo = pc && (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed" || pc.connectionState === "connected");
        if(vivo){
          clearTimeout(timerRecuperacao);
          recuperando = false;
          status("statusVoluntario", "Conectado de novo.");
        }
      }
      return;
    }
    status("statusVoluntario",`Você está de plantão (posto ${meuSlot}).`,"Aguardando alguém pedir ajuda.");
    $("btnSairPlantao").classList.remove("oculto");
  });
  p.on("disconnected", ()=> reconectarSePreciso(p));
  p.on("call", receberChamada);
  p.on("connection", c=>{
    dataV = c;
    c.on("data", receberMensagemTelaV);
    c.on("error", ()=>{});
  });
  p.on("error", err=>{
    if(err && err.type === "unavailable-id"){
      try{ p.destroy(); }catch(e){}
      vigiarPlantao(); // posto ocupado, tenta o próximo
      ocuparSlot(i+1);
    }else if(err && err.type === "network" && ocupado && chamadaV){
      // Sinalização caiu no meio da chamada: anuncia e tenta recuperar.
      clearTimeout(timerPlantao);
      status("statusVoluntario", Nucleo.mensagemEstadoConexao("disconnected").fala);
      tentarRecuperar(chamadaV, "voluntario");
    }else if(ocupado && chamadaV){
      clearTimeout(timerPlantao);
      caiuVol = true;
      try{ p.destroy(); }catch(e){}
      encerrarChamadaVolCaiu();
    }else{
      clearTimeout(timerPlantao);
      status("statusVoluntario","Erro ao entrar de plantão.","Verifique sua internet.");
      $("btnSairPlantao").classList.remove("oculto");
    }
  });
}

function receberChamada(chamada){
  if(ocupado){ try{ chamada.close(); }catch(e){} return; } // já atendendo outra pessoa
  ocupado = true;
  caiuVol = false;
  chamadaV = chamada;
  chamada.answer(streamV);
  vigiarConexao(chamada, "voluntario");
  status("statusVoluntario","Chamada recebida!","Descreva o que a pessoa está mostrando.");
  vibrar([120,60,120]);
  chamada.on("stream", remoto=>{
    const v = $("videoRemoto");
    v.srcObject = remoto; v.classList.remove("oculto");
    $("audioRemotoVol").srcObject = remoto;
    $("btnMutar").classList.remove("oculto");
    $("btnEncerrarVoluntario").classList.remove("oculto");
    $("btnSairPlantao").classList.add("oculto");
    $("btnPedirTela").classList.remove("oculto");
  });
  chamada.on("close", ()=>{
    clearTimeout(timerRecuperacao);
    recuperando = false;
    fimChamadaVol(caiuVol ? "A conexão caiu." : "A pessoa encerrou.");
  });
  chamada.on("error", ()=>{
    clearTimeout(timerRecuperacao);
    recuperando = false;
    fimChamadaVol(caiuVol ? "A conexão caiu." : "A chamada caiu.");
  });
}

$("btnMutar").addEventListener("click", ()=>{
  if(!streamV) return;
  const t = streamV.getAudioTracks()[0];
  t.enabled = !t.enabled;
  const d = Nucleo.decisaoMudo(t.enabled);
  $("btnMutar").textContent = d.texto;
  $("btnMutar").setAttribute("aria-label", d.texto);
  $("btnMutar").setAttribute("aria-pressed", String(!t.enabled));
  falar(d.fala);
});

$("btnEncerrarVoluntario").addEventListener("click", ()=>{
  try{ chamadaV && chamadaV.close(); }catch(e){}
  fimChamadaVol("Chamada encerrada.");
});

function limparChamadaVolUI(){
  clearTimeout(timerReanuncio);
  ocupado = false; chamadaV=null;
  const v = $("videoRemoto"); v.classList.add("oculto"); v.srcObject=null;
  $("audioRemotoVol").srcObject = null;
  $("btnMutar").classList.add("oculto");
  $("btnEncerrarVoluntario").classList.add("oculto");
  $("btnSairPlantao").classList.remove("oculto");
  $("btnPedirTela").classList.add("oculto");
  $("btnPararVerTela").classList.add("oculto");
  try{ dataV && dataV.close(); }catch(e){}
  dataV = null;
}

function fimChamadaVol(msg, continua=true){
  limparChamadaVolUI();
  status("statusVoluntario", msg, continua ? "Você continua de plantão." : "Toque em Sair do plantão e entre de novo.");
  timerReanuncio = setTimeout(()=>{
    if(continua && peerV && !peerV.destroyed)
      status("statusVoluntario",`Você está de plantão (posto ${meuSlot}).`,"Aguardando alguém pedir ajuda.");
  }, 1800);
}

// Fallback honesto do voluntário: se não recuperar, encerra limpo e re-ocupa
// o plantão (criando um peer novo se o anterior morreu na troca de rede).
function encerrarChamadaVolCaiu(){
  clearTimeout(timerRecuperacao);
  clearTimeout(timerReconexao);
  recuperando = false;
  const peerMorto = peerV && peerV.destroyed;
  try{ chamadaV && chamadaV.close(); }catch(e){}
  limparChamadaVolUI();
  status("statusVoluntario","A chamada caiu, reconectando ao plantão.","Aguarde um instante.");
  if(peerMorto){
    setTimeout(()=> ocuparSlot(0), 400);
  }else{
    timerReanuncio = setTimeout(()=>{
      if(peerV && !peerV.destroyed)
        status("statusVoluntario",`Você está de plantão (posto ${meuSlot}).`,"Aguardando alguém pedir ajuda.");
    }, 1800);
  }
}

$("btnSairPlantao").addEventListener("click", ()=>{
  clearTimeout(timerPlantao);
  clearTimeout(timerReanuncio);
  clearTimeout(timerRecuperacao);
  clearTimeout(timerReconexao);
  recuperando = false;
  try{ chamadaV && chamadaV.close(); }catch(e){}
  try{ peerV && peerV.destroy(); }catch(e){}
  try{ dataV && dataV.close(); }catch(e){}
  dataV = null;
  if(streamV) streamV.getTracks().forEach(t=>t.stop());
  chamadaV=peerV=streamV=null; ocupado=false;
  mostrarTela("home");
});

/* ============================================================
   ACESSO REMOTO: COMPARTILHAMENTO DE TELA (piloto desktop)
   O atendente PEDE para ver a tela; a pessoa OUVE a pergunta em
   PT-BR, aceita ou recusa; ativo = anúncio falado + indicador
   contínuo; parar é um toque sempre acessível, revogável a
   qualquer instante. Nada é gravado.

   Transporte do piloto (PeerJS): a track de vídeo da câmera é
   trocada pela da tela via replaceTrack, porque o PeerJS 1.5.4
   não renegocia uma segunda track no meio da chamada. Em produção
   (LiveKit) vira uma segunda track real: Track.Source.ScreenShare
   na mesma Room, reusando o token server. O pedido/aviso viaja na
   DataConnection (controle, não mídia); no LiveKit isso vira
   mensagem de data na mesma sessão.
   Fonte de verdade: máquina de estados do Nucleo (nucleo.js).
============================================================ */
let telaU = null, estadoTela = "parado", dataU = null, dataV = null;
let senderVideo = null, trilhaOriginal = null, iniciandoTela = false, timerIndicador = null;

function suportaCompartilharTela(){
  return !!(navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === "function");
}

function anunciarTela(elId, txt){
  const el = $(elId);
  el.classList.remove("oculto");
  el.textContent = txt;
  falar(txt);
}

function enviarTela(msg, de){
  const d = de === "usuario" ? dataU : dataV;
  try{ if(d && d.open) d.send(msg); }catch(e){}
}

// Mostra/esconde os controles do usuário conforme o estado (Nucleo).
const BTNS_TELA = ["btnPedirTela","btnAceitarTela","btnRecusarTela","btnPararTela","btnPararVerTela"];
function mostrarControlesTela(controles){
  BTNS_TELA.forEach(id=>{ const el = $(id); if(el) el.classList.add("oculto"); });
  $("indicadorTela").classList.add("oculto");
  const mapa = { aceitar:"btnAceitarTela", recusar:"btnRecusarTela", parar:"btnPararTela" };
  controles.forEach(c=>{
    if(mapa[c]) $(mapa[c]).classList.remove("oculto");
    if(c === "indicador") $("indicadorTela").classList.remove("oculto");
  });
}

function resetarTelaLocal(){
  clearInterval(timerIndicador); timerIndicador = null;
  iniciandoTela = false;
  if(telaU){ telaU.getTracks().forEach(t=>t.stop()); telaU = null; }
  senderVideo = null; trilhaOriginal = null;
  estadoTela = "parado";
  mostrarControlesTela([]);
}

function trilhaVideoSender(){
  if(!chamadaU || !chamadaU.peerConnection) return null;
  return chamadaU.peerConnection.getSenders().find(s=>s.track && s.track.kind === "video") || null;
}
function trocarTrilhaVideo(stream){
  const s = trilhaVideoSender();
  if(!s) return false;
  try{
    s.replaceTrack(stream ? stream.getVideoTracks()[0] : trilhaOriginal);
    return true;
  }catch(e){ return false; }
}

/* ---- Lado usuário: recebe pedido, consente, monitora, para ---- */
function abrirCanalControleUsuario(){
  if(dataU || !chamadaU) return;
  try{
    dataU = peerU.connect(chamadaU.peer);
    dataU.on("data", receberMensagemTela);
    dataU.on("error", ()=>{});
  }catch(e){ dataU = null; }
}

function receberMensagemTela(msg){
  if(msg === "pedir-tela") receberPedidoTela();
  else if(msg === "parar-tela") pararCompartilhamentoTela(false);
}

function receberPedidoTela(){
  if(estadoTela !== "parado") return;
  if(!suportaCompartilharTela()){
    anunciarTela("statusTela", Nucleo.SEM_SUPORTE_COMPARTILHAMENTO.fala);
    enviarTela("tela-indisponivel", "usuario");
    return;
  }
  estadoTela = "aguardando";
  anunciarTela("statusTela", Nucleo.mensagensCompartilhamento("aguardando").fala);
  mostrarControlesTela(Nucleo.controlesCompartilhamento("aguardando").usuario);
}

$("btnAceitarTela").addEventListener("click", aceitarCompartilhamentoTela);
async function aceitarCompartilhamentoTela(){
  if(estadoTela !== "aguardando") return;
  estadoTela = "iniciando"; iniciandoTela = true;
  anunciarTela("statusTela", Nucleo.mensagensCompartilhamento("iniciando").fala);
  mostrarControlesTela(Nucleo.controlesCompartilhamento("iniciando").usuario);

  let stream;
  try{
    stream = await navigator.mediaDevices.getDisplayMedia({ video:true });
  }catch(e){
    iniciandoTela = false;
    estadoTela = "parado";
    anunciarTela("statusTela", "Você cancelou a confirmação do sistema. Tela não compartilhada.");
    enviarTela("tela-recusada", "usuario");
    mostrarControlesTela([]);
    return;
  }
  if(!iniciandoTela){ stream.getTracks().forEach(t=>t.stop()); return; } // pararam com o picker aberto
  iniciandoTela = false;

  senderVideo = trilhaVideoSender();
  trilhaOriginal = senderVideo ? senderVideo.track : null;
  if(!trocarTrilhaVideo(stream)){
    stream.getTracks().forEach(t=>t.stop());
    telaU = null; estadoTela = "parado"; senderVideo = null; trilhaOriginal = null;
    anunciarTela("statusTela", "Não consegui trocar para a tela.");
    enviarTela("tela-parada", "usuario");
    mostrarControlesTela([]);
    return;
  }

  telaU = stream;
  estadoTela = "ativo";
  stream.getVideoTracks()[0].addEventListener("ended", ()=> pararCompartilhamentoTela(true));
  anunciarTela("statusTela", Nucleo.mensagensCompartilhamento("ativo").fala);
  mostrarControlesTela(Nucleo.controlesCompartilhamento("ativo").usuario);
  enviarTela("tela-ativa", "usuario");
  clearInterval(timerIndicador);
  timerIndicador = setInterval(()=>{
    if(estadoTela === "ativo" && telaU) falar(Nucleo.LEMBRETE_COMPARTILHAMENTO.fala);
  }, 30000);
}

$("btnRecusarTela").addEventListener("click", ()=>{
  if(estadoTela !== "aguardando") return;
  const origem = estadoTela;
  estadoTela = "parado";
  anunciarTela("statusTela", Nucleo.mensagensCompartilhamento("parado", origem).fala);
  mostrarControlesTela([]);
  enviarTela("tela-recusada", "usuario");
});

$("btnPararTela").addEventListener("click", ()=> pararCompartilhamentoTela(true));

function pararCompartilhamentoTela(avisa){
  clearInterval(timerIndicador); timerIndicador = null;
  if(iniciandoTela) iniciandoTela = false;
  const origem = estadoTela;
  if(estadoTela === "ativo") trocarTrilhaVideo(null);
  if(telaU){ telaU.getTracks().forEach(t=>t.stop()); telaU = null; }
  if(estadoTela !== "parado"){
    estadoTela = "parado";
    anunciarTela("statusTela", Nucleo.mensagensCompartilhamento("parado", origem).fala);
    mostrarControlesTela([]);
    if(avisa) enviarTela("tela-parada", "usuario");
  }else{
    mostrarControlesTela([]);
  }
}

/* ---- Lado voluntário: pede, acompanha, para ---- */
function receberMensagemTelaV(msg){
  if(msg === "tela-ativa"){
    atualizarTelaVoluntarioUI(true);
    anunciarTela("statusTelaVol", "A pessoa está mostrando a tela.");
  }else if(msg === "tela-parada"){
    atualizarTelaVoluntarioUI(false);
    anunciarTela("statusTelaVol", "A pessoa parou de mostrar a tela.");
  }else if(msg === "tela-recusada"){
    atualizarTelaVoluntarioUI(false);
    anunciarTela("statusTelaVol", "A pessoa não quis mostrar a tela.");
  }else if(msg === "tela-indisponivel"){
    atualizarTelaVoluntarioUI(false);
    anunciarTela("statusTelaVol", "O aparelho da pessoa não permite compartilhar a tela.");
  }
}

function atualizarTelaVoluntarioUI(mostrando){
  $("btnPedirTela").classList.toggle("oculto", mostrando);
  $("btnPararVerTela").classList.toggle("oculto", !mostrando);
}

$("btnPedirTela").addEventListener("click", ()=>{
  enviarTela("pedir-tela", "voluntario");
  anunciarTela("statusTelaVol", "Pedido enviado. A pessoa vai ouvir a pergunta.");
  $("btnPedirTela").classList.add("oculto");
});

$("btnPararVerTela").addEventListener("click", ()=>{
  enviarTela("parar-tela", "voluntario");
  atualizarTelaVoluntarioUI(false);
  anunciarTela("statusTelaVol", "Você pediu para parar de ver a tela.");
});

/* ============================================================
   DEPURAÇÃO (testes). Expõe o estado interno para o Playwright.
   Não usado em produção.
============================================================ */
window.__VEJO_DEBUG__ = {
  get usuario(){ return { peer: peerU, chamada: chamadaU, stream: streamU, caiu: caiu }; },
  get voluntario(){ return { peer: peerV, chamada: chamadaV, stream: streamV, ocupado: ocupado }; },
  get recuperando(){ return recuperando; },
  get tela(){ return { estado: estadoTela, stream: telaU, dataU, dataV }; },
  vigiarConexao,
  TEMPO_RECUPERACAO
};
