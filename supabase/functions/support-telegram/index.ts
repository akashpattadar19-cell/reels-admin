// লাইভ সাপোর্ট ⇄ টেলিগ্রাম
// - action "notify": ইউজার সাপোর্টে মেসেজ দিলে অ্যাডমিনের টেলিগ্রামে যায়
// - action "setup": অ্যাডমিন বট টোকেন সেভ করার পর webhook চালু করে
// - টেলিগ্রাম webhook: অ্যাডমিন বটের মেসেজে Reply দিলে উত্তর অ্যাপে ইউজারের কাছে যায়
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const URL_ = Deno.env.get("SUPABASE_URL")!;
const db = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

async function cfg(key: string): Promise<string | null> {
  const { data } = await db.from("private_config").select("value").eq("key", key).maybeSingle();
  return data?.value ?? null;
}
async function setCfg(key: string, value: string | null) {
  await db.from("private_config").upsert({ key, value, updated_at: new Date().toISOString() });
}
async function tg(token: string, method: string, body: unknown) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return await r.json().catch(() => ({ ok: false }));
}
async function caller(req: Request) {
  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  if (!token) return null;
  const { data } = await db.auth.getUser(token);
  return data?.user ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: true });

  // ---------- টেলিগ্রাম থেকে আসা webhook ----------
  const tgSecret = req.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (tgSecret !== null) {
    const want = await cfg("telegram_webhook_secret");
    if (!want || tgSecret !== want) return json({ ok: false }, 403);
    const token = await cfg("telegram_bot_token");
    const upd = await req.json().catch(() => ({}));
    const msg = upd.message;
    if (!token || !msg?.chat?.id) return json({ ok: true });
    const chatId = String(msg.chat.id);
    const text: string = String(msg.text ?? msg.caption ?? "").trim();

    // অ্যাডমিন বট যুক্ত করা: /start <code>
    if (text.startsWith("/start")) {
      const code = text.split(/\s+/)[1] ?? "";
      const want = await cfg("telegram_link_code");
      if (want && code === want) {
        await setCfg("telegram_chat_id", chatId);
        await tg(token, "sendMessage", { chat_id: chatId, text: "✅ Reels Enjoy সাপোর্ট এই টেলিগ্রামে যুক্ত হয়েছে। ইউজারের মেসেজ এখানে আসবে — উত্তর দিতে মেসেজটিতে Reply করুন।" });
      } else {
        await tg(token, "sendMessage", { chat_id: chatId, text: "এটি Reels Enjoy-এর সাপোর্ট বট। সাহায্যের জন্য অ্যাপের ভেতরে সেটিংস → লাইভ সাপোর্ট ব্যবহার করুন।" });
      }
      return json({ ok: true });
    }

    const adminChat = await cfg("telegram_chat_id");
    if (!adminChat || chatId !== adminChat) return json({ ok: true });

    const quoted: string = String(msg.reply_to_message?.text ?? "");
    const m = quoted.match(/#U(\d{6,})/);
    if (!m) {
      await tg(token, "sendMessage", { chat_id: chatId, text: "উত্তর দিতে ইউজারের মেসেজটিতে Reply করে লিখুন।" });
      return json({ ok: true });
    }
    if (!text) return json({ ok: true });
    const { error } = await db.rpc("support_reply_by_user_no", { p_user_no: Number(m[1]), p_body: text });
    await tg(token, "sendMessage", {
      chat_id: chatId, reply_to_message_id: msg.message_id,
      text: error ? "❌ পাঠানো যায়নি: " + error.message : `✅ ইউজার ${m[1]}-কে পাঠানো হয়েছে`,
    });
    return json({ ok: true });
  }

  // ---------- অ্যাপ/এডমিন থেকে ----------
  const user = await caller(req);
  if (!user) return json({ error: "NOT_LOGGED_IN" }, 401);
  const b = await req.json().catch(() => ({}));

  if (b.action === "notify") {
    const token = await cfg("telegram_bot_token");
    const chat = await cfg("telegram_chat_id");
    if (!token || !chat) return json({ ok: true, telegram: false });
    const { data: sm } = await db.from("support_messages").select("id,user_id,body,from_admin,created_at")
      .eq("id", Number(b.id)).maybeSingle();
    if (!sm || sm.user_id !== user.id || sm.from_admin) return json({ error: "NOT_FOUND" }, 404);
    const { data: p } = await db.from("profiles").select("user_no,username,full_name,account_type,country_code").eq("id", user.id).single();
    const head = p?.account_type === "host" ? "🎤 হোস্ট সাপোর্ট" : "🆘 ইউজার সাপোর্ট";
    const text = `${head}\n#U${p?.user_no} @${p?.username}${p?.full_name ? " (" + p.full_name + ")" : ""}${p?.country_code ? " · " + p.country_code : ""}\n\n${sm.body}\n\n↩️ উত্তর দিতে এই মেসেজে Reply করুন`;
    const r = await tg(token, "sendMessage", { chat_id: chat, text });
    return json({ ok: true, telegram: !!r?.ok });
  }

  // admin only below
  const { data: me } = await db.from("profiles").select("role,status").eq("id", user.id).single();
  if (me?.role !== "admin" || me?.status !== "active") return json({ error: "ADMIN_ONLY" }, 403);

  if (b.action === "setup") {
    const token = await cfg("telegram_bot_token");
    if (!token) return json({ error: "NO_TOKEN" }, 400);
    const meInfo = await tg(token, "getMe", {});
    if (!meInfo?.ok) return json({ error: "BAD_TOKEN" }, 400);
    const secret = crypto.randomUUID().replace(/-/g, "");
    const code = Math.random().toString(36).slice(2, 10);
    await setCfg("telegram_webhook_secret", secret);
    await setCfg("telegram_link_code", code);
    await setCfg("telegram_bot_username", meInfo.result.username);
    const wh = await tg(token, "setWebhook", {
      url: `${URL_}/functions/v1/support-telegram`, secret_token: secret, allowed_updates: ["message"], drop_pending_updates: true,
    });
    if (!wh?.ok) return json({ error: "WEBHOOK_FAILED", detail: wh?.description }, 400);
    return json({ ok: true, bot: meInfo.result.username, link: `https://t.me/${meInfo.result.username}?start=${code}` });
  }

  if (b.action === "test") {
    const token = await cfg("telegram_bot_token");
    const chat = await cfg("telegram_chat_id");
    if (!token || !chat) return json({ error: "NOT_LINKED" }, 400);
    const r = await tg(token, "sendMessage", { chat_id: chat, text: "✅ পরীক্ষা: Reels Enjoy সাপোর্ট টেলিগ্রাম কাজ করছে।" });
    return json({ ok: !!r?.ok });
  }

  return json({ error: "BAD_ACTION" }, 400);
});
