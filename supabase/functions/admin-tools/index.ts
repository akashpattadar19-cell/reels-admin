// অ্যাডমিন টুল: ইউজারের পাসওয়ার্ড রিসেট / এককালীন পাসওয়ার্ড
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  const { data: who } = await admin.auth.getUser(token);
  if (!who?.user) return json({ error: "NOT_LOGGED_IN" }, 401);
  const { data: me } = await admin.from("profiles").select("role,status").eq("id", who.user.id).single();
  if (me?.role !== "admin" || me?.status !== "active") return json({ error: "ADMIN_ONLY" }, 403);

  const b = await req.json().catch(() => ({}));
  // এককালীন পাসওয়ার্ড: সার্ভার নিজে বানায়, ইউজার লগইন করলেই নতুন পাসওয়ার্ড দিতে বাধ্য, ২৪ ঘণ্টা পর অচল
  if (b.action === "one_time_password") {
    const uid = String(b.user_id ?? "");
    const abc = "abcdefghjkmnpqrstuvwxyz23456789";
    const rnd = crypto.getRandomValues(new Uint8Array(8));
    const pw = Array.from(rnd, (x) => abc[x % abc.length]).join("");
    const { error } = await admin.auth.admin.updateUserById(uid, { password: pw });
    if (error) return json({ error: error.message }, 400);
    const expires = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    await admin.from("user_private").update({ must_change_pw: true, temp_pw_expires: expires }).eq("user_id", uid);
    await admin.from("audit_logs").insert({
      admin_id: who.user.id, action: "one_time_password", target_type: "user", target_id: uid,
    });
    return json({ ok: true, password: pw, expires });
  }
  if (b.action === "reset_password") {
    const pw = String(b.password ?? "");
    if (pw.length < 6) return json({ error: "BAD_PASSWORD" }, 400);
    const { error } = await admin.auth.admin.updateUserById(String(b.user_id), { password: pw });
    if (error) return json({ error: error.message }, 400);
    await admin.from("audit_logs").insert({
      admin_id: who.user.id, action: "reset_password", target_type: "user", target_id: String(b.user_id),
    });
    return json({ ok: true });
  }
  return json({ error: "BAD_ACTION" }, 400);
});
