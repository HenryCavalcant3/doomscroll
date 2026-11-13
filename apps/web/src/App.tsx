import { useCallback, useEffect, useState } from "react";
import { api, auth, ApiError, type User } from "./api";
import { BottomNav } from "./components/BottomNav";
import { useRoute } from "./router";
import { AddVideo } from "./screens/AddVideo";
import { Enter } from "./screens/Enter";
import { Feed } from "./screens/Feed";
import { OwnerPanel } from "./screens/OwnerPanel";
import { ProfileScreen } from "./screens/Profile";

type Session = { state: "checking" } | { state: "offline" } | { state: "out" } | { state: "in"; user: User };

export function App() {
  const route = useRoute();
  const [session, setSession] = useState<Session>(() => (auth.hasToken() ? { state: "checking" } : { state: "out" }));

  // Sessão recusada pela api em qualquer tela: volta para a entrada.
  useEffect(() => auth.onUnauthorized(() => setSession({ state: "out" })), []);

  // Confere o token guardado. Sem resposta da api, oferece tentar de novo em vez de pedir o PIN.
  const load = useCallback(
    () =>
      api.me().then(
        (user) => setSession({ state: "in", user }),
        (err) => setSession(err instanceof ApiError && err.status === 401 ? { state: "out" } : { state: "offline" }),
      ),
    [],
  );
  const check = () => {
    setSession({ state: "checking" });
    load();
  };

  useEffect(() => {
    if (auth.hasToken()) load();
  }, [load]);

  const logout = useCallback(async () => {
    await api.logout().catch(() => {});
    auth.setToken(null);
    setSession({ state: "out" });
  }, []);

  if (session.state === "checking") {
    return (
      <div className="app">
        <main className="screen placeholder">
          <p>Abrindo o bunker…</p>
        </main>
      </div>
    );
  }
  if (session.state === "offline") {
    return (
      <div className="app">
        <main className="screen placeholder">
          <h1>Sem sinal do bunker</h1>
          <p>Confira se você está na mesma rede do computador que roda o Doomscroll.</p>
          <button className="btn" onClick={check}>
            Tentar de novo
          </button>
        </main>
      </div>
    );
  }
  if (session.state === "out") {
    return (
      <div className="app">
        <Enter onEnter={(user) => setSession({ state: "in", user })} />
      </div>
    );
  }

  const me = session.user;
  return (
    <div className="app">
      {route.name === "feed" && <Feed />}
      {route.name === "adicionar" && <AddVideo />}
      {route.name === "dono" && <OwnerPanel me={me} />}
      {route.name === "perfil" && <ProfileScreen key={me.nickname} nickname={me.nickname} me={me} onLogout={logout} />}
      {route.name === "usuario" && (
        <ProfileScreen key={route.nickname} nickname={route.nickname} me={me} onLogout={logout} />
      )}
      <BottomNav route={route} />
    </div>
  );
}
