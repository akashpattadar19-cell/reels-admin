// রেজিস্ট্রেশন: যেকোনো দেশের মোবাইল নম্বর (+দেশের কোড) + ঐচ্ছিক ইমেইল + পাসওয়ার্ড (SMS খরচ ছাড়া)
// ভেতরে লগইনের জন্য একটি র‍্যান্ডম ইমেইল (u<random>@id.reelsenjoy.app) ব্যবহার হয়; ফোন/ইমেইল থেকে সেটা
// খুঁজে দেয় resolve-login ফাংশন। ফলে ফোন বা ইমেইল যেকোনোটা দিয়েই লগইন করা যায়।
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "METHOD" }, 405);

  let b: Record<string, string>;
  try { b = await req.json(); } catch { return json({ error: "BAD_JSON" }, 400); }

  const phone = String(b.phone ?? "").replace(/[\s-]/g, "");
  const email = String(b.email ?? "").trim().toLowerCase();
  const password = String(b.password ?? "");
  const fullName = String(b.full_name ?? "").trim().slice(0, 60);
  const username = String(b.username ?? "").trim().toLowerCase();

  if (!/^\+[1-9][0-9]{7,14}$/.test(phone)) return json({ error: "BAD_PHONE" }, 400);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return json({ error: "BAD_EMAIL" }, 400);
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

  const { data: byPhone } = await admin.from("user_private").select("user_id").eq("phone", phone).maybeSingle();
  if (byPhone) return json({ error: "PHONE_TAKEN" }, 409);
  if (email) {
    const { data: byEmail } = await admin.from("user_private").select("user_id").ilike("email", email).maybeSingle();
    if (byEmail) return json({ error: "EMAIL_TAKEN" }, 409);
  }

  const login = `u${randomId()}@id.reelsenjoy.app`;
  const { error } = await admin.auth.admin.createUser({
    email: login,
    password,
    email_confirm: true,
    user_metadata: { phone, email: email || null, full_name: fullName, username },
  });
  if (error) {
    console.error(error);
    return json({ error: "SIGNUP_FAILED" }, 500);
  }
  return json({ ok: true, login });
});
