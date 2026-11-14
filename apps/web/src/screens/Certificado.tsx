import type { ReactNode } from "react";
import { Barata } from "../components/Barata";

/** Raiz da CA local do bunker, entregue pelo proxy HTTPS. */
const CERT_URL = "/certificado/bunker.crt";
/** Porta HTTPS do proxy. */
const HTTPS_PORT = 8443;

const b = (s: string) => <strong>{s}</strong>;

const ANDROID: ReactNode[] = [
  <>Toque em {b("Baixar certificado")}, no começo desta página.</>,
  <>
    Abra {b("Configurações")} e busque por {b("certificado de CA")}. O caminho costuma ser Segurança e privacidade,
    depois Mais configurações de segurança.
  </>,
  <>Toque em {b("Instalar mesmo assim")} e confirme com o bloqueio de tela.</>,
  <>Escolha o arquivo baixado, na pasta {b("Downloads")}.</>,
];

const IPHONE: ReactNode[] = [
  <>
    Abra esta página no {b("Safari")}, toque em {b("Baixar certificado")} e depois em {b("Permitir")}.
  </>,
  <>
    Abra {b("Ajustes")} e toque em {b("Perfil Baixado")}, no topo. Toque em {b("Instalar")} e digite o código do
    aparelho.
  </>,
  <>
    Ainda em Ajustes, vá em {b("Geral")}, {b("Sobre")}, {b("Ajustes de Confiança de Certificados")} e ative o
    certificado do bunker.
    <br />
    <span className="cert-alerta">Este passo costuma ser esquecido</span>
  </>,
];

function Passos({ passos }: { passos: ReactNode[] }) {
  return (
    <ol className="cert-passos">
      {passos.map((p, i) => (
        <li key={i}>
          <span className="passo-num" aria-hidden="true">
            {i + 1}
          </span>
          <div>{p}</div>
        </li>
      ))}
    </ol>
  );
}

/** Passo a passo do certificado, aberto em HTTP antes de instalar (docs/acabamento/telas/certificado.html). */
export function Certificado() {
  const https = `https://${window.location.hostname}:${HTTPS_PORT}/`;
  return (
    <>
      <div className="faixa faixa-topo" aria-hidden="true" />
      <main className="cert">
        <div className="cert-topo">
          <div className="cert-icone">
            <Barata size={52} />
          </div>
          <div>
            <div className="cert-sobre">Uma vez por aparelho</div>
            <h1>Certificado do bunker</h1>
          </div>
        </div>
        <p className="cert-texto">
          O bunker funciona sem internet, então ele emite o próprio certificado de segurança. Com ele instalado, o
          endereço abre em HTTPS e o app pode ir para a sua tela inicial.
        </p>
        <a className="btn btn-primary btn-link cert-botao" href={CERT_URL} download="bunker.crt">
          Baixar certificado
        </a>
        <p className="cert-aviso">
          Instale só se você confia em quem cuida deste bunker. Dá para remover o certificado quando quiser, nos
          ajustes do aparelho.
        </p>
        <h2>Como instalar</h2>
        <details>
          <summary>Android</summary>
          <Passos passos={ANDROID} />
          <p className="cert-nota">Os nomes mudam um pouco conforme a marca do aparelho.</p>
        </details>
        <details>
          <summary>iPhone</summary>
          <Passos passos={IPHONE} />
        </details>
        <h2>Depois de instalar</h2>
        <p className="cert-texto cert-texto-junto">
          Abra o bunker pelo endereço seguro e adicione o app à tela inicial.
        </p>
        <a className="btn btn-link cert-botao cert-https" href={https}>
          Abrir o bunker em HTTPS
        </a>
      </main>
    </>
  );
}
