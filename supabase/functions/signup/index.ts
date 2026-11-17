// ফোন নম্বর + পাসওয়ার্ড দিয়ে রেজিস্ট্রেশন (SMS খরচ ছাড়া)
// ইমেইল হিসেবে ভেতরে p<phone>@phone.reelsenjoy.app ব্যবহার হয়; ইউজার শুধু ফোন নম্বর দেখে
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

export const phoneToEmail = (phone: string) => `p${phone}@phone.reelsenjoy.app`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "METHOD" }, 405);

  let b: Record<string, string>;
  try { b = await req.json(); } catch { return json({ error: "BAD_JSON" }, 400); }

  const phone = String(b.phone ?? "").trim().replace(/^\+?88/, "");
  const password = String(b.password ?? "");
  const fullName = String(b.full_name ?? "").trim().slice(0, 60);
  const username = String(b.username ?? "").trim().toLowerCase();

  if (!/^01[3-9][0-9]{8}$/.test(phone)) return json({ error: "BAD_PHONE" }, 400);
  if (password.length < 6 || password.length > 72) return json({ error: "BAD_PASSWORD" }, 400);
  if (!/^[a-z0-9_.]{3,30}$/.test(username)) return json({ error: "BAD_USERNAME" }, 400);
  if (fullName.length < 2) return json({ error: "BAD_NAME" }, 400);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  // হঠাৎ অনেক অ্যাকাউন্ট (বট) ঠেকাতে
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await admin.from("profiles").select("id", { count: "exact", head: true }).gte("created_at", since);
  if ((count ?? 0) > 30) return json({ error: "TRY_LATER" }, 429);

  const { data: free } = await admin.rpc("username_available", { p_username: username });
  if (free === false) return json({ error: "USERNAME_TAKEN" }, 409);

  const { data: existing } = await admin.from("user_private").select("user_id").eq("phone", phone).maybeSingle();
  if (existing) return json({ error: "PHONE_TAKEN" }, 409);

  const { error } = await admin.auth.admin.createUser({
    email: phoneToEmail(phone),
    password,
    email_confirm: true,
    user_metadata: { phone, full_name: fullName, username },
  });
  if (error) {
    const msg = error.message.toLowerCase();
    if (msg.includes("already")) return json({ error: "PHONE_TAKEN" }, 409);
    console.error(error);
    return json({ error: "SIGNUP_FAILED" }, 500);
  }
  return json({ ok: true, email: phoneToEmail(phone) });
});
