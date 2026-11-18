// Agora RTC টোকেন (AccessToken2, "007…")
// অ্যাপ নিজের লগইন টোকেন দিয়ে ডাকে: { channel: "live_12" | "call_34" }
// অনুমতি ঠিক করে DB-র agora_grant() (ইউজারের নিজের JWT দিয়ে) — host/co-host/কলে থাকা দুজন = publisher, দর্শক = subscriber
// App Certificate থাকে private_config-এ (শুধু service role পড়তে পারে), কখনো অ্যাপে যায় না
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const URL_ = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

// ---- AccessToken2 ----
class Buf {
  parts: Uint8Array[] = [];
  u16(v: number) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v, true); this.parts.push(b); return this; }
  u32(v: number) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, true); this.parts.push(b); return this; }
  bytes(b: Uint8Array) { this.u16(b.length); this.parts.push(b); return this; }
  str(s: string) { return this.bytes(new TextEncoder().encode(s)); }
  raw(b: Uint8Array) { this.parts.push(b); return this; }
  pack() { const n = this.parts.reduce((a, p) => a + p.length, 0); const o = new Uint8Array(n); let i = 0; for (const p of this.parts) { o.set(p, i); i += p.length; } return o; }
}
async function hmac(key: Uint8Array, msg: Uint8Array) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, msg));
}
async function deflate(data: Uint8Array) {
  const cs = new CompressionStream("deflate"); // zlib format
  const w = cs.writable.getWriter(); w.write(data); w.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}
const b64 = (u: Uint8Array) => { let s = ""; for (const c of u) s += String.fromCharCode(c); return btoa(s); };

async function rtcToken(appId: string, cert: string, channel: string, uid: number, publisher: boolean, expireSec: number) {
  const issueTs = Math.floor(Date.now() / 1000);
  const salt = 1 + Math.floor(Math.random() * 99999998);
  // privileges: 1 join, 2 publish audio, 3 publish video, 4 publish data (relative seconds)
  const privs: [number, number][] = publisher ? [[1, expireSec], [2, expireSec], [3, expireSec], [4, expireSec]] : [[1, expireSec]];
  const svc = new Buf().u16(1).u16(privs.length);
  for (const [k, v] of privs) svc.u16(k).u32(v);
  svc.str(channel).str(uid === 0 ? "" : String(uid));
  const info = new Buf().str(appId).u32(issueTs).u32(expireSec).u32(salt).u16(1).raw(svc.pack()).pack();
  let signing = await hmac(new Buf().u32(issueTs).pack(), new TextEncoder().encode(cert));
  signing = await hmac(new Buf().u32(salt).pack(), signing);
  const signature = await hmac(signing, info);
  const content = new Buf().bytes(signature).raw(info).pack();
  return "007" + b64(await deflate(content));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return json({ error: "NOT_LOGGED_IN" }, 401);
    const { channel } = await req.json();
    if (typeof channel !== "string" || !/^(live|call)_[0-9]+$/.test(channel)) return json({ error: "BAD_INPUT" }, 400);
    const user = createClient(URL_, Deno.env.get("SUPABASE_ANON_KEY")!, { auth: { persistSession: false }, global: { headers: { Authorization: auth } } });
    const { data: grant, error } = await user.rpc("agora_grant", { p_channel: channel });
    if (error || !grant?.role) return json({ error: "NOT_ALLOWED" }, 403);
    const [{ data: c }, { data: s }] = await Promise.all([
      admin.from("private_config").select("value").eq("key", "agora_app_certificate").maybeSingle(),
      admin.from("settings").select("value").eq("key", "agora_app_id").maybeSingle(),
    ]);
    const appId = String(s?.value ?? ""), cert = String(c?.value ?? "");
    if (!appId || !cert) return json({ error: "NOT_CONFIGURED" }, 500);
    const publisher = grant.role === "publisher";
    const token = await rtcToken(appId, cert, channel, Number(grant.uid), publisher, 3 * 3600);
    return json({ token, appId, uid: Number(grant.uid), role: grant.role, channel });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
