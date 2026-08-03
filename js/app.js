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
const SLOTS = Array.from({length:NUM_SLOTS}, (_,i)=> `${PREFIXO}-slot-${i+1}`);
const STUN = { iceServers:[{ urls:"stun:stun.l.google.com:19302" }] };
const TEMPO_ESPERA = 20000; // ms até desistir se ninguém atender

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
function criarPeer(id){ return id ? new Peer(id, {config:STUN}) : new Peer({config:STUN}); }

/* ============================================================
   FLUXO USUÁRIO (pessoa cega pede ajuda)
   Chama todos os slots em paralelo, primeiro a atender vence.
============================================================ */
let peerU=null, streamU=null, chamadaU=null, timerEspera=null, venceu=false, caiu=false;

$("btnUsuario").addEventListener("click", iniciarUsuario);

async function iniciarUsuario(){
  mostrarTela("usuario");
  venceu=false; caiu=false;
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

  peerU = criarPeer();
  peerU.on("open", chamarSlots);
  peerU.on("error", err=>{
    if(err && err.type === "peer-unavailable") return; // slot vazio, normal
    if(venceu){ encerrarUsuario(true, "A conexão caiu."); return; }
    falharUsuario("Erro de conexão.","Verifique sua internet e tente de novo.");
  });
  timerEspera = setTimeout(()=>{
    if(!venceu) falharUsuario("Nenhum voluntário disponível agora.","Tente novamente em alguns minutos.");
  }, TEMPO_ESPERA);
}

function chamarSlots(){
  const chamadas = SLOTS.map(slot => peerU.call(slot, streamU));
  chamadas.forEach(c=>{
    if(!c) return;
    c.on("stream", remoto=>{
      if(venceu){ try{ c.close(); }catch(e){} return; }
      venceu = true;
      clearTimeout(timerEspera);
      chamadaU = c;
      chamadas.forEach(o=>{ if(o && o!==c) try{ o.close(); }catch(e){} });
      $("audioRemotoUsuario").srcObject = remoto;
      $("statusUsuario").classList.remove("pulso");
      status("statusUsuario","Conectado!","Mostre com a câmera o que você precisa. O voluntário está te ouvindo.");
      vibrar([120,60,120]);
    });
    c.on("error", ()=>{ if(venceu && c===chamadaU) caiu = true; });
    c.on("close", ()=>{ if(venceu && c===chamadaU) encerrarUsuario(true, caiu ? "A conexão caiu." : "O voluntário encerrou."); });
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

function encerrarUsuario(remoto, msg){
  $("statusUsuario").classList.remove("pulso");
  status("statusUsuario", msg || (remoto ? "O voluntário encerrou." : "Chamada encerrada."));
  limparUsuario();
  setTimeout(()=> mostrarTela("home"), 1500);
}

function limparUsuario(){
  clearTimeout(timerEspera);
  const c = chamadaU; chamadaU = null;
  if(c) try{ c.close(); }catch(e){}
  try{ peerU && peerU.destroy(); }catch(e){}
  if(streamU) streamU.getTracks().forEach(t=>t.stop());
  peerU = streamU = null; venceu = false; caiu = false;
}

/* ============================================================
   FLUXO VOLUNTÁRIO (ocupa o primeiro slot livre e atende)
============================================================ */
let peerV=null, streamV=null, chamadaV=null, ocupado=false, meuSlot=0, timerPlantao=null, caiuVol=false;

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
    peerV = p; meuSlot = i+1;
    status("statusVoluntario",`Você está de plantão (posto ${meuSlot}).`,"Aguardando alguém pedir ajuda.");
    $("btnSairPlantao").classList.remove("oculto");
    p.on("call", receberChamada);
  });
  p.on("error", err=>{
    if(err && err.type === "unavailable-id"){
      try{ p.destroy(); }catch(e){}
      vigiarPlantao(); // posto ocupado, tenta o próximo
      ocuparSlot(i+1);
    }else if(ocupado && chamadaV){
      clearTimeout(timerPlantao);
      caiuVol = true;
      fimChamadaVol("A conexão caiu.", false);
      try{ p.destroy(); }catch(e){}
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
  status("statusVoluntario","Chamada recebida!","Descreva o que a pessoa está mostrando.");
  vibrar([120,60,120]);
  chamada.on("stream", remoto=>{
    const v = $("videoRemoto");
    v.srcObject = remoto; v.classList.remove("oculto");
    $("audioRemotoVol").srcObject = remoto;
    $("btnMutar").classList.remove("oculto");
    $("btnEncerrarVoluntario").classList.remove("oculto");
    $("btnSairPlantao").classList.add("oculto");
  });
  chamada.on("close", ()=> fimChamadaVol(caiuVol ? "A conexão caiu." : "A pessoa encerrou."));
  chamada.on("error", ()=> fimChamadaVol(caiuVol ? "A conexão caiu." : "A chamada caiu."));
}

$("btnMutar").addEventListener("click", ()=>{
  if(!streamV) return;
  const t = streamV.getAudioTracks()[0];
  t.enabled = !t.enabled;
  const rotulo = t.enabled ? "Mutar microfone" : "Ativar microfone";
  $("btnMutar").textContent = rotulo;
  $("btnMutar").setAttribute("aria-label", rotulo);
  $("btnMutar").setAttribute("aria-pressed", String(!t.enabled));
  falar(t.enabled ? "Microfone ativado." : "Microfone mutado.");
});

$("btnEncerrarVoluntario").addEventListener("click", ()=>{
  try{ chamadaV && chamadaV.close(); }catch(e){}
  fimChamadaVol("Chamada encerrada.");
});

function fimChamadaVol(msg, continua=true){
  ocupado = false; chamadaV=null;
  const v = $("videoRemoto"); v.classList.add("oculto"); v.srcObject=null;
  $("audioRemotoVol").srcObject = null;
  $("btnMutar").classList.add("oculto");
  $("btnEncerrarVoluntario").classList.add("oculto");
  $("btnSairPlantao").classList.remove("oculto");
  status("statusVoluntario", msg, continua ? "Você continua de plantão." : "Toque em Sair do plantão e entre de novo.");
  setTimeout(()=>{
    if(continua && peerV && !peerV.destroyed)
      status("statusVoluntario",`Você está de plantão (posto ${meuSlot}).`,"Aguardando alguém pedir ajuda.");
  }, 1800);
}

$("btnSairPlantao").addEventListener("click", ()=>{
  clearTimeout(timerPlantao);
  try{ chamadaV && chamadaV.close(); }catch(e){}
  try{ peerV && peerV.destroy(); }catch(e){}
  if(streamV) streamV.getTracks().forEach(t=>t.stop());
  chamadaV=peerV=streamV=null; ocupado=false;
  mostrarTela("home");
});
