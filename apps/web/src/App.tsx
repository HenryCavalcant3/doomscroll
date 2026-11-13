import { BottomNav } from "./components/BottomNav";
import { useRoute } from "./router";
import { AddVideo } from "./screens/AddVideo";
import { OwnerPanel } from "./screens/OwnerPanel";

export function App() {
  const route = useRoute();
  return (
    <div className="app">
      {route === "adicionar" && <AddVideo />}
      {route === "dono" && <OwnerPanel />}
      {route === "perfil" && (
        <main className="screen placeholder">
          <h1>Perfil</h1>
          <p>Apelido, PIN e vídeos curtidos chegam no passo 4.</p>
          <a className="btn" href="#/dono" style={{ display: "inline-flex", alignItems: "center" }}>
            Painel do dono
          </a>
        </main>
      )}
      <BottomNav route={route} />
    </div>
  );
}
