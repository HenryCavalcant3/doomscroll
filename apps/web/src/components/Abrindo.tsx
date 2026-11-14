import { Barata } from "./Barata";

/** Carregamento de tela cheia (docs/acabamento/telas/carregando.html). */
export function Abrindo() {
  return (
    <main className="estado abrindo" role="status">
      <Barata size={128} className="balanca" />
      <div className="abrindo-titulo">Abrindo o bunker…</div>
      <p className="estado-sub">Destrancando a escotilha</p>
      <div className="abrindo-barra" aria-hidden="true">
        <div className="faixa anda" />
      </div>
    </main>
  );
}
