// অ্যাডমিন টুল: ইউজারের পাসওয়ার্ড রিসেট (SMS OTP চালুর আগ পর্যন্ত)
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
