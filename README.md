# Vejo por Você — MVP

Assistência visual ao vivo para pessoas cegas. Web, sem cadastro, sem backend.

## Estrutura
- `index.html` — estrutura das telas.
- `css/estilos.css` — estilos.
- `js/app.js` — lógica de chamadas (WebRTC via PeerJS).

## Rodar
1. Suba a pasta num host HTTPS (Netlify Drop ou Vercel).
2. Abra a URL no celular. "Sou voluntário" entra de plantão, "Preciso de ajuda" chama.
3. Precisa de HTTPS. A câmera não abre em http.

## Produção
Trocar PeerJS por LiveKit nas funções `criarPeer`, `chamarSlots` e `receberChamada` (em `js/app.js`). A UI não muda.
