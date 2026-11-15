/**
 * SQL do Boletim do Bunker contra um Postgres de verdade (com as migrações aplicadas). Roda só com
 * TEST_DATABASE_URL; o CI não tem banco. Tudo numa transação desfeita no fim, num dia de 2020 que
 * não se mistura com o acervo.
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildFacts, dayWindow, type BulletinFacts } from "./bulletin.js";
import { collectDay, personaActivity, personas, type PersonaRef } from "./bulletinDb.js";
import { pickCuriousFact } from "./gossip.js";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("boletim no banco", () => {
  let pool: pg.Pool;
  let db: pg.PoolClient;
  const day = dayWindow(new Date(2020, 2, 11, 1)); // 10/03/2020
  const at = (h: number, dayOffset = 0) => new Date(2020, 2, 10 + dayOffset, h);
  const ids: Record<string, string> = {};
  let facts: BulletinFacts;
  let list: PersonaRef[];

  const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows;
  const user = async (nick: string, ai: boolean) => {
    const [r] = await q("INSERT INTO users (nickname, is_ai, avatar) VALUES ($1, $2, $3) RETURNING id", [nick, ai, ai ? "x.svg" : "padrao"]);
    ids[nick] = r.id;
    if (ai) await q("INSERT INTO personas (user_id, bio, tone, config) VALUES ($1, 'b', 't', $2)", [r.id, JSON.stringify({ nome: nick.toUpperCase() })]);
    return r.id as string;
  };
  const conversation = async (type: "direct" | "group", members: string[]) => {
    const key = type === "direct" ? [...members].sort().join(":") : null;
    const [c] = await q("INSERT INTO conversations (type, direct_key) VALUES ($1, $2) RETURNING id", [type, key]);
    for (const m of members) await q("INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1, $2)", [c.id, m]);
    return c.id as string;
  };
  const message = (conv: string, sender: string, when: Date, video?: string) =>
    q("INSERT INTO messages (conversation_id, sender_id, type, text, video_id, created_at) VALUES ($1, $2, $3, $4, $5, $6)", [
      conv,
      sender,
      video ? "video" : "text",
      video ? null : "oi",
      video ?? null,
      when,
    ]);

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    db = await pool.connect();
    await q("BEGIN");
    const pa = await user("zz_persona_a", true);
    const pb = await user("zz_persona_b", true);
    const ana = await user("zz_ana", false);
    const leo = await user("zz_leo", false);
    const [topic] = await q("INSERT INTO topics (name, slug) VALUES ('Zz Teste', 'zz-teste') RETURNING id");
    const [sens] = await q("INSERT INTO topics (name, slug, sensitive) VALUES ('Zz Sensível', 'zz-sensivel', true) RETURNING id");
    const video = async (by: string, approved: Date, topicId: number, duration = 60) => {
      const [v] = await q(
        `INSERT INTO videos (source_url, platform, status, file_path, duration, submitted_by, approved_at)
         VALUES ($1, 'x', 'aprovado', 'f.mp4', $2, $3, $4) RETURNING id`,
        [`https://zz/${Math.random()}`, duration, by, approved],
      );
      await q("INSERT INTO video_topics (video_id, topic_id, source) VALUES ($1, $2, 'ai')", [v.id, topicId]);
      return v.id as string;
    };
    const v1 = await video(ana, at(10), topic.id);
    const v2 = await video(ana, at(11), topic.id);
    const vs = await video(leo, at(9, -3), sens.id); // aprovado antes: não é "novo" no dia

    // Curtidas: v1 com 3 (ana, leo, persona a), v2 com 1; vs com 1 curtida e 5 comentários.
    for (const [u, v] of [[ana, v1], [leo, v1], [pa, v1], [ana, v2], [leo, vs]] as const) {
      await q("INSERT INTO likes (user_id, video_id, created_at) VALUES ($1, $2, $3)", [u, v, at(12)]);
    }
    for (let i = 0; i < 5; i++) await q("INSERT INTO comments (video_id, user_id, text, created_at) VALUES ($1, $2, 'c', $3)", [vs, pb, at(13)]);
    // Só assistiu: conta como morador ativo, nunca aparece pelo nome.
    const [watcher] = await q("INSERT INTO users (nickname) VALUES ('zz_so_assiste') RETURNING id");
    ids.zz_so_assiste = watcher.id;
    await q("INSERT INTO view_events (user_id, video_id, watched_ms, watch_pct, skipped, created_at) VALUES ($1, $2, 1000, 0.5, false, $3)", [watcher.id, v1, at(14)]);

    // Conversa entre personas (pública no stalker): conta. Conversa persona-morador: nunca conta.
    const pair = await conversation("direct", [pa, pb]);
    for (let i = 0; i < 8; i++) await message(pair, i % 2 ? pa : pb, at(15));
    // Histórico: três dias anteriores com o bunker ligado (uma curtida de persona por dia).
    for (const [v, d] of [[v1, -1], [v2, -2], [vs, -3]] as const) {
      await q("INSERT INTO likes (user_id, video_id, created_at) VALUES ($1, $2, $3)", [pb, v, at(12, d)]);
    }
    const priv = await conversation("direct", [pa, ana]);
    for (let i = 0; i < 30; i++) await message(priv, pa, at(16), v1);
    for (let i = 0; i < 30; i++) await message(priv, ana, at(16));

    list = (await personas(db)).filter((p) => p.nickname.startsWith("zz_"));
    facts = buildFacts(day.date, await collectDay(db, day));
  });

  afterAll(async () => {
    await db?.query("ROLLBACK");
    db?.release();
    await pool?.end();
  });

  it("estoque: novos, tópicos, quem abasteceu e tema inaugurado", () => {
    expect(facts.estoque.novos).toBe(2);
    expect(facts.estoque.topicos).toEqual([{ slug: "zz-teste", name: "Zz Teste", count: 2 }]);
    expect(facts.estoque.abastecedores).toEqual(["zz_ana"]);
    expect(facts.estoque.inaugurados).toEqual([{ slug: "zz-teste", name: "Zz Teste" }]);
  });

  it("movimento com a divisão entre gente e personas", () => {
    expect(facts.movimento.curtidas).toEqual({ total: 5, moradores: 4, personas: 1 });
    expect(facts.movimento.comentarios).toEqual({ total: 5, moradores: 0, personas: 5 });
    // ana, leo e quem só assistiu; mensagens não contam
    expect(facts.movimento.moradores).toBe(3);
    expect(facts.eventosReais).toBe(5);
  });

  it("assunto do dia sensível e o mais curtido pelo número de curtidas", () => {
    expect(facts.assunto).toEqual({ slug: "zz-sensivel", name: "Zz Sensível", sensitive: true });
    expect(facts.maisCurtido).not.toBeNull();
  });

  it("Regra fixa 5: quem só assistiu não aparece pelo nome", () => {
    expect(JSON.stringify(facts)).not.toContain("zz_so_assiste");
    expect(JSON.stringify(facts)).not.toContain("zz_leo");
  });

  it("Regra fixa 1: conversa de persona com morador não entra no fato curioso", async () => {
    const { personas: acts, pairs } = await personaActivity(db, day, list);
    const a = acts.find((p) => p.id === ids.zz_persona_a)!;
    expect(a.today.videoTargets).toBe(0);
    expect(a.today.groupMessages).toBe(0);
    expect(pairs).toEqual([{ a: expect.any(String), b: expect.any(String), today: 8, pastTotal: 0, pastDays: 3 }]);
    // Os 30 vídeos mandados ao morador não viram "mandou vídeo para meio bunker"; o fato é o papo entre as duas.
    const f = pickCuriousFact(acts, pairs, "ninguem");
    expect(f?.detector).toBe("papo_em_dupla");
    expect(new Set(f?.subjects)).toEqual(new Set([ids.zz_persona_a, ids.zz_persona_b]));
  });
});
