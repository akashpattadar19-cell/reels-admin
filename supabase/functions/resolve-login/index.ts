// ফোন নম্বর বা ইমেইল → ভেতরের লগইন আইডি। পাসওয়ার্ড ছাড়া এটা দিয়ে কিছু করা যায় না।
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
  let b: Record<string, string>;
  try { b = await req.json(); } catch { return json({ error: "BAD_JSON" }, 400); }
  const id = String(b.identifier ?? "").trim();
  if (!id) return json({ error: "NOT_FOUND" }, 404);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  let q = admin.from("user_private").select("login_email");
  if (id.includes("@")) q = q.ilike("email", id.toLowerCase());
  else {
    const phone = id.replace(/[\s-]/g, "");
    if (!/^\+[1-9][0-9]{7,14}$/.test(phone)) return json({ error: "NOT_FOUND" }, 404);
    q = q.eq("phone", phone);
  }
  const { data } = await q.maybeSingle();
  if (!data?.login_email) return json({ error: "NOT_FOUND" }, 404);
  return json({ login: data.login_email });
});
