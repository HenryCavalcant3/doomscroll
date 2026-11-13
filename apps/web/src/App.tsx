import { useCallback, useEffect, useState } from "react";
import { api, auth, ApiError, type User } from "./api";
import { RealtimeContext } from "./chat";
import { BottomNav } from "./components/BottomNav";
import { Realtime, wsUrl } from "./realtime";
import { useRoute } from "./router";
import { AddVideo } from "./screens/AddVideo";
import { ChatScreen } from "./screens/Chat";
import { Enter } from "./screens/Enter";
import { Feed } from "./screens/Feed";
import { Messages } from "./screens/Messages";
import { OwnerPanel } from "./screens/OwnerPanel";
import { ProfileScreen } from "./screens/Profile";

type Session = { state: "checking" } | { state: "offline" } | { state: "out" } | { state: "in"; user: User };

export function App() {
  const route = useRoute();
  const [session, setSession] = useState<Session>(() => (auth.hasToken() ? { state: "checking" } : { state: "out" }));
  const [unread, setUnread] = useState(0);
  // Sessão recusada no WebSocket: mesmo caminho de um 401 no REST.
  const [realtime] = useState(
    () =>
      new Realtime({
        url: wsUrl,
        onBadSession: () => {
          auth.setToken(null);
          setSession({ state: "out" });
        },
      }),
  );

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

  // Avisos em tempo real só com sessão aberta.
  const signedIn = session.state === "in";
  useEffect(() => {
    const token = auth.token();
    if (!signedIn || !token) return;
    realtime.start(token);
    const onVisible = () => !document.hidden && realtime.wake();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      realtime.stop();
    };
  }, [signedIn, realtime]);

  // Bolinha de não lidas: ao entrar, a cada tela, a cada aviso e depois de ler.
  const refreshUnread = useCallback(() => {
    api.conversations().then(
      (cs) => setUnread(cs.reduce((n, c) => n + c.unread, 0)),
      () => {},
    );
  }, []);
  useEffect(() => {
    if (signedIn) refreshUnread();
  }, [signedIn, route, refreshUnread]);
  useEffect(() => {
    if (!signedIn) return;
    const unsubscribe = realtime.subscribe(refreshUnread);
    const onVisible = () => !document.hidden && refreshUnread();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [signedIn, realtime, refreshUnread]);

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
    <RealtimeContext.Provider value={realtime}>
      <div className="app">
        {route.name === "feed" && <Feed />}
        {route.name === "adicionar" && <AddVideo />}
        {route.name === "mensagens" && <Messages me={me} />}
        {route.name === "chat" && <ChatScreen key={route.id} id={route.id} me={me} onRead={refreshUnread} />}
        {route.name === "dono" && <OwnerPanel me={me} />}
        {route.name === "perfil" && <ProfileScreen key={me.nickname} nickname={me.nickname} me={me} onLogout={logout} />}
        {route.name === "usuario" && (
          <ProfileScreen key={route.nickname} nickname={route.nickname} me={me} onLogout={logout} />
        )}
        {/* A conversa ocupa a tela toda, com o campo de mensagem no lugar da navegação. */}
        {route.name !== "chat" && <BottomNav route={route} unread={unread} />}
      </div>
    </RealtimeContext.Provider>
  );
}
