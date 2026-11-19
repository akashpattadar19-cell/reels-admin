// ভিডিও Supabase storage → Cloudflare R2
// cron (`r2_cron()`, header x-cron = private_config.r2_cron_secret) → { action: "run" }: অপেক্ষায় থাকা ভিডিও কপি করে
//   videos.video_url / stories.media_url R2 পাবলিক লিংকে বদলায়, তারপর Supabase থেকে মুছে দেয়।
// অ্যাডমিন (নিজের লগইন টোকেন) → { action: "test" } (key ঠিক আছে কিনা) বা { action: "run" } (এখনই সরাও)।
// R2 key: private_config r2_account_id, r2_access_key, r2_secret_key, r2_bucket, r2_public_url
import { createClient } from "npm:@supabase/supabase-js@2";
import { AwsClient } from "npm:aws4fetch@1.0.20";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const SB_MARK = "/storage/v1/object/public/videos/";
const BATCH = 6, BUDGET_MS = 100_000;

type Cfg = Record<string, string | null>;
async function loadCfg(): Promise<Cfg> {
  const { data } = await admin.from("private_config").select("key,value").like("key", "r2_%");
  const c: Cfg = {};
  for (const r of data ?? []) c[r.key] = r.value;
  return c;
}

const keyUrl = (base: string, path: string) => base + "/" + path.split("/").map(encodeURIComponent).join("/");
const typeOf = (path: string, t?: string) => {
  if (t && t !== "application/octet-stream") return t;
  const e = path.split(".").pop()?.toLowerCase();
  return e === "webm" ? "video/webm" : e === "mov" ? "video/quicktime" : e === "3gp" ? "video/3gpp" : e === "mkv" ? "video/x-matroska" : "video/mp4";
};

function client(c: Cfg) {
  const aws = new AwsClient({ accessKeyId: c.r2_access_key!, secretAccessKey: c.r2_secret_key!, service: "s3", region: "auto" });
  const endpoint = `https://${c.r2_account_id}.r2.cloudflarestorage.com/${c.r2_bucket}`;
  return { aws, endpoint, pub: c.r2_public_url!.replace(/\/+$/, "") };
}

async function putObject(cl: ReturnType<typeof client>, path: string, body: Uint8Array, type: string) {
  const r = await cl.aws.fetch(keyUrl(cl.endpoint, path), {
    method: "PUT", body,
    headers: { "Content-Type": type, "Cache-Control": "public, max-age=31536000, immutable" },
  });
  if (!r.ok) throw new Error(`R2_PUT_${r.status}: ${(await r.text()).slice(0, 200)}`);
}

async function publicOk(cl: ReturnType<typeof client>, path: string, size: number) {
  const r = await fetch(keyUrl(cl.pub, path), { headers: { Range: "bytes=0-0" } });
  await r.body?.cancel();
  if (r.status !== 206 && r.status !== 200) throw new Error(`PUBLIC_${r.status}`);
  if (r.status === 206) {
    const total = Number((r.headers.get("content-range") || "").split("/")[1]);
    if (total && size && total !== size) throw new Error("SIZE_MISMATCH");
  }
}

type Row = { id: string; url: string; path: string | null; r2_tries: number };
async function moveOne(cl: ReturnType<typeof client>, table: "videos" | "stories", row: Row) {
  await admin.from(table).update({ r2_tries: row.r2_tries + 1 }).eq("id", row.id);
  const path = row.path || decodeURIComponent(row.url.split(SB_MARK)[1] || "");
  if (!path) throw new Error("NO_PATH");
  const { data: blob, error } = await admin.storage.from("videos").download(path);
  if (error || !blob) throw new Error("DOWNLOAD: " + (error?.message ?? "empty"));
  const buf = new Uint8Array(await blob.arrayBuffer());
  await putObject(cl, path, buf, typeOf(path, blob.type));
  await publicOk(cl, path, buf.byteLength);
  const newUrl = keyUrl(cl.pub, path);
  const col = table === "videos" ? "video_url" : "media_url";
  const { error: ue } = await admin.from(table).update({ [col]: newUrl }).eq("id", row.id).eq(col, row.url);
  if (ue) throw new Error("UPDATE: " + ue.message);
  // অন্য কোথাও একই ফাইল ব্যবহার হচ্ছে না নিশ্চিত হয়ে তবেই মুছি
  const { count } = await admin.from(table === "videos" ? "stories" : "videos").select("id", { count: "exact", head: true })
    .eq(table === "videos" ? "media_url" : "video_url", row.url);
  if (!count) await admin.storage.from("videos").remove([path]);
  return { id: row.id, mb: +(buf.byteLength / 1048576).toFixed(1) };
}

async function run(cl: ReturnType<typeof client>) {
  const t0 = Date.now(), cutoff = new Date(Date.now() - 60_000).toISOString();
  const moved: unknown[] = [], failed: unknown[] = [];
  const { data: vids } = await admin.from("videos").select("id, video_url, video_path, r2_tries")
    .like("video_url", `%${SB_MARK}%`).lt("r2_tries", 5).lt("created_at", cutoff).order("created_at").limit(BATCH);
  const { data: sts } = await admin.from("stories").select("id, media_url, media_path, r2_tries")
    .eq("kind", "video").like("media_url", `%${SB_MARK}%`).lt("r2_tries", 5).lt("created_at", cutoff).order("created_at").limit(BATCH);
  type Job = { table: "videos" | "stories"; row: Row };
  const jobs: Job[] = [
    ...(vids ?? []).map((v): Job => ({ table: "videos", row: { id: v.id, url: v.video_url, path: v.video_path, r2_tries: v.r2_tries } })),
    ...(sts ?? []).map((s): Job => ({ table: "stories", row: { id: s.id, url: s.media_url, path: s.media_path, r2_tries: s.r2_tries } })),
  ];
  for (const { table, row } of jobs) {
    if (Date.now() - t0 > BUDGET_MS) break;
    try { moved.push(await moveOne(cl, table, row)); }
    catch (e) { failed.push({ table, id: row.id, error: String((e as Error).message ?? e) }); console.error("r2-move", table, row.id, e); }
  }
  return { moved, failed };
}

async function test(cl: ReturnType<typeof client>) {
  const path = `_test/${Date.now()}.txt`;
  const body = new TextEncoder().encode("reels-enjoy r2 test");
  try { await putObject(cl, path, body, "text/plain"); }
  catch (e) { return { ok: false, step: "upload", error: String((e as Error).message) }; }
  try { await publicOk(cl, path, body.byteLength); }
  catch (e) { return { ok: false, step: "public", error: String((e as Error).message), url: keyUrl(cl.pub, path) }; }
  await cl.aws.fetch(keyUrl(cl.endpoint, path), { method: "DELETE" }).catch(() => {});
  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const c = await loadCfg();
    const body = await req.json().catch(() => ({}));
    const cron = req.headers.get("x-cron");
    let ok = !!cron && cron === c.r2_cron_secret;
    if (!ok) {
      const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
      const { data: { user } } = await admin.auth.getUser(jwt);
      if (user) {
        const { data: p } = await admin.from("profiles").select("role").eq("id", user.id).single();
        ok = p?.role === "admin";
      }
    }
    if (!ok) return json({ ok: false, error: "FORBIDDEN" }, 403);
    const missing = ["r2_account_id", "r2_access_key", "r2_secret_key", "r2_bucket", "r2_public_url"].filter((k) => !c[k]);
    if (missing.length) return json({ ok: false, error: "MISSING", missing });
    const cl = client(c);
    if (body.action === "test") return json(await test(cl));
    return json({ ok: true, ...(await run(cl)) });
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: String((e as Error).message ?? e) }, 500);
  }
});
