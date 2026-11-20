// Push নোটিফিকেশন (Firebase Cloud Messaging HTTP v1)
// - DB ট্রিগার (`_push()` → pg_net, header x-push = private_config.push_secret): { user, kind: notif|msg|call, ref }
// - অ্যাডমিন (লগইন টোকেন): { action: "test" } → নিজের ফোনে পরীক্ষা নোটিফিকেশন
// service account JSON: private_config.fcm_service_account (অ্যাডমিন প্যানেল থেকে বসানো)
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

async function cfg(key: string): Promise<string | null> {
  const { data } = await db.from("private_config").select("value").eq("key", key).maybeSingle();
  return data?.value ?? null;
}

// ---- Google OAuth token (service account JWT) ----
let cached: { token: string; exp: number; project: string } | null = null;
const b64u = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf as ArrayBuffer))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64uStr = (s: string) => b64u(new TextEncoder().encode(s));
async function accessToken(): Promise<{ token: string; project: string } | null> {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.exp - 120 > now) return cached;
  const raw = await cfg("fcm_service_account");
  if (!raw) return null;
  const sa = JSON.parse(raw);
  const pem = String(sa.private_key).replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const head = b64uStr(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64uStr(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${body}`));
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${body}.${b64u(sig)}` }),
  });
  const t = await r.json();
  if (!t.access_token) throw new Error("OAUTH " + JSON.stringify(t));
  cached = { token: t.access_token, exp: now + (t.expires_in ?? 3600), project: sa.project_id };
  return cached;
}

// ---- বার্তা বানানো (ইউজারের ভাষায়, মিশ্র নয়) ----
const EN_TYPE: Record<string, string> = {
  like: "❤️ Someone liked your post", comment: "💬 New comment", follow: "👤 You have a new follower",
  gift: "🎁 You received a gift", cash_in: "🪙 Coins update", mention: "📣 You were mentioned", system: "🔔 Reels Enjoy",
};
type Msg = { title: string; body: string; route: string; kind: string; tag: string };

async function build(user: string, kind: string, ref: string, lang: string): Promise<Msg | null> {
  const en = lang === "en" || lang === "English";
  if (kind === "notif") {
    const { data: n } = await db.from("notifications").select("type,title,body,data").eq("id", Number(ref)).maybeSingle();
    if (!n) return null;
    const title = en ? (EN_TYPE[n.type] ?? "🔔 Reels Enjoy") : (n.title ?? "Reels Enjoy");
    const body = en ? (n.type === "system" ? "Open the app to see it" : "") : (n.body ?? "");
    return { title, body, route: "#notifs", kind: "notif", tag: "n" + ref };
  }
  if (kind === "msg") {
    const { data: m } = await db.from("messages").select("sender_id,body").eq("id", Number(ref)).maybeSingle();
    if (!m) return null;
    const { data: p } = await db.from("profiles").select("username,full_name").eq("id", m.sender_id).maybeSingle();
    const body = String(m.body ?? "");
    return {
      title: `💬 ${p?.full_name || p?.username || "Reels Enjoy"}`,
      body: body.startsWith("http") || body.length === 0 ? (en ? "Sent you a message" : "আপনাকে মেসেজ পাঠিয়েছে") : body.slice(0, 300),
      route: `#chat/${m.sender_id}`, kind: "msg", tag: "c" + m.sender_id,
    };
  }
  if (kind === "call") {
    const { data: c } = await db.from("calls").select("caller_id,kind,status").eq("id", Number(ref)).maybeSingle();
    if (!c || c.status !== "ringing") return null;
    const { data: p } = await db.from("profiles").select("username,full_name").eq("id", c.caller_id).maybeSingle();
    const video = c.kind === "video";
    return {
      title: en ? (video ? "📹 Incoming video call" : "📞 Incoming call") : (video ? "📹 ভিডিও কল আসছে" : "📞 কল আসছে"),
      body: `${p?.full_name || p?.username || ""}`, route: "", kind: "call", tag: "call" + ref,
    };
  }
  if (kind === "test") {
    return { title: en ? "✅ Notifications are working" : "✅ নোটিফিকেশন কাজ করছে", body: en ? "Test from the admin panel" : "অ্যাডমিন প্যানেল থেকে পরীক্ষা", route: "#notifs", kind: "notif", tag: "test" };
  }
  return null;
}

async function sendToUser(user: string, kind: string, ref: string) {
  const at = await accessToken();
  if (!at) return { sent: 0, reason: "NO_KEY" };
  const { data: toks } = await db.from("push_tokens").select("token,lang").eq("user_id", user);
  if (!toks?.length) return { sent: 0, reason: "NO_TOKEN" };
  const { data: prof } = await db.from("profiles").select("language").eq("id", user).maybeSingle();
  let sent = 0;
  const errors: string[] = [];
  for (const t of toks) {
    const m = await build(user, kind, ref, t.lang || prof?.language || "bn");
    if (!m) return { sent: 0, reason: "NOTHING" };
    const r = await fetch(`https://fcm.googleapis.com/v1/projects/${at.project}/messages:send`, {
      method: "POST", headers: { Authorization: `Bearer ${at.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message: { token: t.token, data: m, android: { priority: "high", ttl: kind === "call" ? "45s" : "86400s" } } }),
    });
    if (r.ok) { sent++; continue; }
    const e = await r.json().catch(() => ({}));
    const status = e?.error?.status ?? "";
    errors.push(status || String(r.status));
    if (status === "NOT_FOUND" || status === "UNREGISTERED" || (status === "INVALID_ARGUMENT" && JSON.stringify(e).includes("token"))) {
      await db.from("push_tokens").delete().eq("token", t.token);
    }
  }
  return { sent, errors };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const b = await req.json().catch(() => ({}));
    const xp = req.headers.get("x-push");
    if (xp !== null) {
      const want = await cfg("push_secret");
      if (!want || xp !== want) return json({ error: "FORBIDDEN" }, 403);
      return json({ ok: true, ...(await sendToUser(String(b.user), String(b.kind), String(b.ref ?? ""))) });
    }
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: { user } } = await db.auth.getUser(jwt);
    if (!user) return json({ error: "NOT_LOGGED_IN" }, 401);
    const { data: me } = await db.from("profiles").select("role").eq("id", user.id).single();
    if (me?.role !== "admin") return json({ error: "ADMIN_ONLY" }, 403);
    if (b.action === "test") {
      const target = b.user_no ? (await db.from("profiles").select("id").eq("user_no", Number(b.user_no)).maybeSingle()).data?.id : user.id;
      if (!target) return json({ ok: false, error: "NO_USER" });
      return json({ ok: true, ...(await sendToUser(target, "test", "")) });
    }
    return json({ error: "BAD_ACTION" }, 400);
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: String((e as Error).message ?? e) }, 500);
  }
});
