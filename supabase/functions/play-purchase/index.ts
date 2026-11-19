// Google Play কয়েন কেনা যাচাই
// অ্যাপ নিজের লগইন টোকেন দিয়ে ডাকে: { productId, token }
// Google Play Developer API দিয়ে কেনাটা সত্যি কিনা দেখে → grant_play_purchase() → consume
// Service account JSON থাকে private_config.play_service_account (শুধু service role পড়তে পারে)
import { createClient } from "npm:@supabase/supabase-js@2";

const PACKAGE = "com.reelsenjoy.app";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const URL_ = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

const b64url = (u: Uint8Array | string) => {
  const bytes = typeof u === "string" ? new TextEncoder().encode(u) : u;
  let s = ""; for (const c of bytes) s += String.fromCharCode(c);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

let cached: { token: string; exp: number } | null = null;
async function googleToken(sa: { client_email: string; private_key: string }) {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/androidpublisher",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(head + "." + claim)));
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claim}.${b64url(sig)}` }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("GOOGLE_AUTH_FAILED");
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return cached.token;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer /, "");
    const { data: u } = await admin.auth.getUser(jwt);
    const user = u?.user;
    if (!user) return json({ error: "NOT_LOGGED_IN" }, 401);

    const { productId, token } = await req.json();
    if (typeof productId !== "string" || typeof token !== "string" || !/^[a-z0-9._]{1,100}$/.test(productId) || token.length > 600)
      return json({ error: "BAD_INPUT" }, 400);

    const { data: cfg } = await admin.from("private_config").select("value").eq("key", "play_service_account").maybeSingle();
    if (!cfg?.value) return json({ error: "PLAY_NOT_CONFIGURED" }, 503);
    const sa = typeof cfg.value === "string" ? JSON.parse(cfg.value) : cfg.value;

    const at = await googleToken(sa);
    const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(token)}`;
    const pr = await fetch(base, { headers: { Authorization: `Bearer ${at}` } });
    if (!pr.ok) return json({ error: "PURCHASE_NOT_FOUND" }, 400);
    const p = await pr.json();
    if (p.purchaseState !== 0) return json({ error: p.purchaseState === 2 ? "PURCHASE_PENDING" : "PURCHASE_CANCELLED" }, 400);
    // কেনার সময় অ্যাপ এই ইউজারের id দিয়েছিল — অন্যের টোকেন দিয়ে কয়েন নেওয়া যাবে না
    if (p.obfuscatedExternalAccountId !== user.id) return json({ error: "WRONG_ACCOUNT" }, 403);

    const { data: g, error } = await admin.rpc("grant_play_purchase", { p_user: user.id, p_product: productId, p_token: token, p_order: p.orderId ?? null });
    if (error) return json({ error: error.message }, 400);

    if (p.consumptionState !== 1) {
      await fetch(base + ":consume", { method: "POST", headers: { Authorization: `Bearer ${at}` } }).catch(() => {});
    }
    return json(g);
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
