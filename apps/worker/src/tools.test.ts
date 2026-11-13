import { describe, expect, it } from "vitest";
import { audioArgs, convertArgs, parseProbe } from "./ffmpeg.js";
import { modelUrl, whisperArgs } from "./whisper.js";
import { parseInfo, ytDlpArgs } from "./ytdlp.js";

describe("yt-dlp", () => {
  it("passa o link depois de -- para nunca ser lido como opção", () => {
    const args = ytDlpArgs("--exec=ruim", "/m/1");
    expect(args.slice(-2)).toEqual(["--", "--exec=ruim"]);
    expect(args).toContain("--no-playlist");
  });

  it("junta tags e hashtags do título e da descrição e guarda o texto da descrição", () => {
    const stdout = `${JSON.stringify({ title: "Gato #Fofo", description: "Meu gato no sofá #gato #fofo", tags: ["Animais"] })}\n`;
    expect(parseInfo(stdout)).toEqual({
      title: "Gato #Fofo",
      hashtags: ["animais", "fofo", "gato"],
      sourceDescription: "Meu gato no sofá",
    });
  });
});

describe("ffmpeg", () => {
  it("gera MP4 H.264/AAC com faststart", () => {
    const args = convertArgs("in.mkv", "out.mp4");
    expect(args).toEqual(expect.arrayContaining(["libx264", "aac", "+faststart"]));
    expect(args.at(-1)).toBe("out.mp4");
  });

  it("extrai áudio 16 kHz mono para o Whisper", () => {
    expect(audioArgs("v.mp4", "a.wav")).toEqual(expect.arrayContaining(["-ar", "16000", "-ac", "1", "pcm_s16le"]));
  });

  it("lê duração e presença de áudio do ffprobe", () => {
    const out = JSON.stringify({ format: { duration: "12.5" }, streams: [{ codec_type: "video" }, { codec_type: "audio" }] });
    expect(parseProbe(out)).toEqual({ duration: 12.5, hasAudio: true });
    expect(parseProbe(JSON.stringify({ streams: [{ codec_type: "video" }] }))).toEqual({ duration: 0, hasAudio: false });
  });
});

describe("whisper", () => {
  it("detecta o idioma e grava texto puro", () => {
    expect(whisperArgs("m.bin", "a.wav", "/t/out")).toEqual(expect.arrayContaining(["-l", "auto", "-otxt", "-of", "/t/out"]));
    expect(modelUrl("base")).toMatch(/ggml-base\.bin$/);
  });
});
