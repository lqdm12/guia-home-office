# guia-home-office
assistente para deficiente visual
# Vejo por Você — MVP

Assistência visual ao vivo para pessoas cegas. Web, sem cadastro, sem backend.

## Rodar
1. Suba o `vejo-por-voce.html` num host HTTPS (Netlify Drop ou Vercel).
2. Abra a URL no celular. "Sou voluntário" entra de plantão, "Preciso de ajuda" chama.
3. Precisa de HTTPS. A câmera não abre em http.

## Produção
Trocar PeerJS por LiveKit nas funções `criarPeer`, `chamarSlots` e `receberChamada`. A UI não muda.
