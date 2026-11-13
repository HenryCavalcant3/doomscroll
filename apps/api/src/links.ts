export type Platform = "youtube" | "tiktok";

const HOSTS: Record<string, Platform> = {
  "youtube.com": "youtube",
  "www.youtube.com": "youtube",
  "m.youtube.com": "youtube",
  "youtu.be": "youtube",
  "tiktok.com": "tiktok",
  "www.tiktok.com": "tiktok",
  "m.tiktok.com": "tiktok",
  "vm.tiktok.com": "tiktok",
  "vt.tiktok.com": "tiktok",
};

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

function youtubeId(url: URL): string | null {
  const parts = url.pathname.split("/").filter(Boolean);
  const candidate =
    url.hostname.toLowerCase() === "youtu.be"
      ? parts[0]
      : parts[0] === "watch"
        ? url.searchParams.get("v")
        : parts[0] === "shorts" || parts[0] === "live" || parts[0] === "embed"
          ? parts[1]
          : null;
  return candidate && YT_ID.test(candidate) ? candidate : null;
}

/** Valida um link de vídeo aceito (YouTube Shorts/vídeos e TikTok). Devolve null se não for aceito. */
export function parseVideoLink(input: string): { url: string; platform: Platform } | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  const platform = HOSTS[url.hostname.toLowerCase()];
  if (!platform) return null;

  // Um vídeo do YouTube tem vários formatos de link (youtu.be, watch, shorts); o ID vira a forma única.
  if (platform === "youtube") {
    const id = youtubeId(url);
    return id ? { url: `https://www.youtube.com/watch?v=${id}`, platform } : null;
  }
  url.protocol = "https:";
  url.hash = "";
  // Parâmetros de rastreamento não mudam o vídeo; tirar evita duplicatas.
  for (const key of [...url.searchParams.keys()]) {
    if (key === "si" || key === "feature" || key.startsWith("utm_") || key === "is_from_webapp" || key === "sender_device") {
      url.searchParams.delete(key);
    }
  }
  return { url: url.toString(), platform };
}
