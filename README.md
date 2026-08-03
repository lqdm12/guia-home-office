# Vejo por Você — MVP

Assistência visual ao vivo para pessoas cegas. Web, sem cadastro, sem backend.

## Estrutura
- `index.html` — estrutura das telas.
- `css/estilos.css` — estilos.
- `js/nucleo.js` — funções puras de estado/texto (sem DOM, testáveis em Node).
- `js/app.js` — lógica de chamadas (WebRTC via PeerJS).

## Rodar
1. Suba a pasta num host HTTPS (Netlify Drop ou Vercel).
2. Abra a URL no celular. "Sou voluntário" entra de plantão, "Preciso de ajuda" chama.
3. Precisa de HTTPS. A câmera não abre em http.

## Testes
```
npm i
npx playwright install chromium   # só para o teste de acessibilidade
npm test            # testes unitários do núcleo (node:test)
npm run test:a11y   # axe-core headless (violações WCAG A/AA graves e sérias)
npm run test:all    # os dois
```
O teste axe cobre só erros estáticos (HTML, contraste, ARIA). Não substitui o teste real com leitor de tela (VoiceOver/TalkBack): fala dobrada, timing de anúncio, autoplay e foco dinâmico só se validam em dispositivo.

## Produção
Trocar PeerJS por LiveKit nas funções `criarPeer`, `chamarSlots` e `receberChamada` (em `js/app.js`). A UI não muda.
