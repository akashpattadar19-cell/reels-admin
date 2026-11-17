// AdMob Rewarded অ্যাডের Server-Side Verification কলব্যাক
// AdMob কনসোলে এই URL বসাতে হবে: https://<project>.supabase.co/functions/v1/admob-ssv
import { createClient } from "npm:@supabase/supabase-js@2";

const KEYS_URL = "https://www.gstatic.com/admob/reward/verifier-keys.json";
let keyCache: { at: number; keys: Map<string, CryptoKey> } | null = null;

function b64ToBytes(s: string): Uint8Array {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function getKey(id: string): Promise<CryptoKey | undefined> {
  if (!keyCache || Date.now() - keyCache.at > 24 * 3600_000 || !keyCache.keys.has(id)) {
    const res = await fetch(KEYS_URL);
    const body = await res.json() as { keys: { keyId: number; base64: string }[] };
    const keys = new Map<string, CryptoKey>();
    for (const k of body.keys) {
      keys.set(String(k.keyId), await crypto.subtle.importKey(
        "spki", b64ToBytes(k.base64), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]));
    }
    keyCache = { at: Date.now(), keys };
  }
  return keyCache.keys.get(id);
}

// DER (SEQUENCE{INTEGER r, INTEGER s}) → WebCrypto-এর raw r||s (৬৪ বাইট)
function derToRaw(der: Uint8Array): Uint8Array {
  let i = 2;
  if (der[1] & 0x80) i = 2 + (der[1] & 0x7f);
  const read = () => {
    i++; // 0x02
    const len = der[i++];
    let v = der.slice(i, i + len);
    i += len;
    while (v.length > 32 && v[0] === 0) v = v.slice(1);
    const out = new Uint8Array(32);
    out.set(v, 32 - v.length);
    return out;
  };
  const r = read();
  const s = read();
  const raw = new Uint8Array(64);
  raw.set(r, 0);
  raw.set(s, 32);
  return raw;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const query = url.search.slice(1);
  const sigAt = query.indexOf("&signature=");
  // AdMob কনসোলের "Verify URL" টেস্টে প্যারামিটার ছাড়া কল আসতে পারে
  if (sigAt < 0) return new Response("ok");

  const p = url.searchParams;
  const keyId = p.get("key_id") ?? "";
  const signature = p.get("signature") ?? "";
  const key = await getKey(keyId);
  if (!key) return new Response("unknown key", { status: 400 });

  const valid = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" }, key, derToRaw(b64ToBytes(signature)),
    new TextEncoder().encode(query.slice(0, sigAt)));
  if (!valid) return new Response("bad signature", { status: 403 });

  const txId = p.get("transaction_id");
  const userId = p.get("user_id");
  if (!txId || !userId || !/^[0-9a-f-]{36}$/i.test(userId)) return new Response("ok"); // টেস্ট কল
  const custom = new URLSearchParams(p.get("custom_data") ?? "");
  const videoId = Number(custom.get("video_id")) || null;

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const { data, error } = await admin.rpc("grant_ad_reward", {
    p_ssv_tx: txId, p_viewer: userId, p_video_id: videoId, p_placement: "rewarded_points",
  });
  if (error) {
    console.error(error);
    return new Response("error", { status: 500 });
  }
  return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
});
