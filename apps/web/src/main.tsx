import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/700.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

// App instalável e com tela "Sem sinal" offline: o service worker só funciona em HTTPS (ou localhost).
if (import.meta.env.PROD && "serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

// Toque longo em imagem, vídeo, botão ou link não abre o menu do navegador (no iPhone é o
// -webkit-touch-callout do CSS). Só em tela de toque; campos e mensagens do chat continuam com o menu.
if (window.matchMedia("(pointer: coarse)").matches) {
  document.addEventListener("contextmenu", (e) => {
    const el = e.target instanceof Element ? e.target : null;
    if (el?.closest("input, textarea, .bubble")) return;
    if (el?.closest("img, video, svg, button, a, .feed-item, .bottom-nav")) e.preventDefault();
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
