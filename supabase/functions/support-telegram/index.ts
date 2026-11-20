// লাইভ সাপোর্ট ⇄ টেলিগ্রাম + ভিডিও অ্যাপ্রুভ গ্রুপ
// - action "notify": ইউজার সাপোর্টে মেসেজ দিলে অ্যাডমিনের টেলিগ্রামে যায়
// - action "setup": অ্যাডমিন বট টোকেন সেভ করার পর webhook চালু করে
// - টেলিগ্রাম webhook: অ্যাডমিন বটের মেসেজে Reply দিলে উত্তর অ্যাপে ইউজারের কাছে যায়
// - cron (x-cron): পেন্ডিং ভিডিও মডারেশন গ্রুপে, Approve / Reject বোতাম
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
const REASONS = ["ভিডিওতে ওয়াটারমার্ক / অন্য অ্যাপ বা পেজের লোগো আছে", "TikTok / অন্য পেজের ভিডিও — নিজের তোলা আসল ভিডিও দিন",
  "অশ্লীল বা খারাপ কনটেন্ট", "ভিডিও অস্পষ্ট / ভাঙা", "কপিরাইট গান বা সিনেমার অংশ"];
const CAT: Record<string, string> = { natok: "নাটক", movie: "মুভি", funny: "ফানি", vlog: "ভ্লগ", music: "মিউজিক", other: "অন্যান্য" };
const modKb = (id: number) => ({ inline_keyboard: [[{ text: "✅ Approve", callback_data: `a:${id}` }, { text: "❌ Reject", callback_data: `r:${id}` }]] });
const reasonKb = (id: number) => ({ inline_keyboard: [
  ...REASONS.map((r, i) => [{ text: "❌ " + r, callback_data: `x:${id}:${i}` }]),
  [{ text: "↩️ ফিরে যান", callback_data: `b:${id}` }]] });

// পেন্ডিং ভিডিওগুলো মডারেশন গ্রুপে পাঠানো
async function modRun() {
  const token = await cfg("telegram_bot_token"), chat = await cfg("telegram_mod_chat");
  if (!token || !chat) return { sent: 0 };
  const { data: vids } = await db.from("videos")
    .select("id,user_id,caption,video_url,thumb_url,duration_sec,category,is_premium,premium_coins,created_at")
    .eq("status", "pending").is("tg_sent_at", null).lt("created_at", new Date(Date.now() - 20000).toISOString())
    .order("created_at").limit(8);
  let sent = 0;
  for (const v of vids ?? []) {
    await db.from("videos").update({ tg_sent_at: new Date().toISOString() }).eq("id", v.id).is("tg_sent_at", null);
    const { data: p } = await db.from("profiles").select("user_no,username,full_name,account_type,videos_count").eq("id", v.user_id).single();
    const cap = String(v.caption ?? "").slice(0, 400);
    const text = `🎬 নতুন ভিডিও #V${v.id}\n👤 ${p?.full_name ?? ""} @${p?.username ?? ""} · ID ${p?.user_no ?? ""}${p?.account_type === "host" ? " · 👑 হোস্ট" : ""}\n` +
      `📂 ${CAT[v.category] ?? v.category ?? "—"}${v.duration_sec ? ` · ⏱ ${v.duration_sec} সেকেন্ড` : ""}${v.is_premium ? ` · 💎 প্রিমিয়াম 🪙${v.premium_coins}` : ""}\n` +
      (cap ? `📝 ${cap}\n` : "") + `\nদেখে সিদ্ধান্ত দিন 👇`;
    let r = await tg(token, "sendVideo", { chat_id: chat, video: v.video_url, caption: text, supports_streaming: true, reply_markup: modKb(v.id) });
    if (!r?.ok) {
      const kb = { inline_keyboard: [[{ text: "▶️ ভিডিও দেখুন", url: v.video_url }], ...modKb(v.id).inline_keyboard] };
      r = v.thumb_url ? await tg(token, "sendPhoto", { chat_id: chat, photo: v.thumb_url, caption: text, reply_markup: kb }) : { ok: false };
      if (!r?.ok) r = await tg(token, "sendMessage", { chat_id: chat, text, reply_markup: kb });
    }
    if (r?.ok) sent++;
  }
  return { sent };
}

async function editDone(token: string, msg: any, line: string) {
  const isMedia = !!(msg.video || msg.photo);
  const old = String(isMedia ? msg.caption ?? "" : msg.text ?? "").replace(/\n\nদেখে সিদ্ধান্ত দিন 👇$/, "");
  const body = { chat_id: msg.chat.id, message_id: msg.message_id, reply_markup: { inline_keyboard: [] } };
  if (isMedia) await tg(token, "editMessageCaption", { ...body, caption: `${old}\n\n${line}` });
  else await tg(token, "editMessageText", { ...body, text: `${old}\n\n${line}` });
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

    // ---- মডারেশন গ্রুপের বোতাম ----
    const cq = upd.callback_query;
    if (cq && token) {
      const modChat = await cfg("telegram_mod_chat");
      const m = cq.message;
      const ans = (t: string, alert = false) => tg(token, "answerCallbackQuery", { callback_query_id: cq.id, text: t, show_alert: alert });
      if (!m || String(m.chat.id) !== modChat) { await ans("এই গ্রুপ যুক্ত নয়", true); return json({ ok: true }); }
      const [k, idS, ri] = String(cq.data ?? "").split(":");
      const id = Number(idS);
      const who = [cq.from?.first_name, cq.from?.last_name].filter(Boolean).join(" ") || cq.from?.username || "admin";
      if (k === "r") { await tg(token, "editMessageReplyMarkup", { chat_id: m.chat.id, message_id: m.message_id, reply_markup: reasonKb(id) }); await ans("কারণ বেছে নিন"); return json({ ok: true }); }
      if (k === "b") { await tg(token, "editMessageReplyMarkup", { chat_id: m.chat.id, message_id: m.message_id, reply_markup: modKb(id) }); await ans(""); return json({ ok: true }); }
      if (k === "a" || k === "x") {
        let admin = await cfg("telegram_admin_uid");
        if (!admin) { const { data: a } = await db.from("profiles").select("id").eq("role", "admin").eq("status", "active").limit(1).single(); admin = a?.id ?? null; }
        const reason = k === "x" ? REASONS[Number(ri)] ?? REASONS[0] : null;
        const { data: res, error } = await db.rpc("_tg_video_action", { p_admin: admin, p_id: id, p_action: k === "a" ? "approve" : "reject", p_reason: reason });
        if (error) { await ans("❌ " + error.message, true); return json({ ok: true }); }
        if (res === "done") {
          await editDone(token, m, k === "a" ? `✅ অ্যাপ্রুভ হয়েছে — ${who}` : `❌ রিজেক্ট — ${who}\nকারণ: ${reason}`);
          await ans(k === "a" ? "✅ অ্যাপ্রুভ হয়েছে" : "❌ রিজেক্ট হয়েছে");
        } else {
          const st: Record<string, string> = { published: "আগেই প্রকাশিত", rejected: "আগেই রিজেক্ট", deleted: "ডিলিট করা", missing: "ভিডিও পাওয়া যায়নি" };
          await editDone(token, m, `ℹ️ ${st[res] ?? res}`);
          await ans("ℹ️ " + (st[res] ?? res), true);
        }
      }
      return json({ ok: true });
    }

    const msg = upd.message;
    if (!token || !msg?.chat?.id) return json({ ok: true });
    const chatId = String(msg.chat.id);
    // গ্রুপ সুপারগ্রুপ হলে নতুন আইডি
    if (msg.migrate_to_chat_id && chatId === (await cfg("telegram_mod_chat"))) { await setCfg("telegram_mod_chat", String(msg.migrate_to_chat_id)); return json({ ok: true }); }
    const text: string = String(msg.text ?? msg.caption ?? "").trim();

    // মডারেশন গ্রুপ যুক্ত করা: গ্রুপে /mod <code>
    if (/^\/mod(@\w+)?(\s|$)/.test(text)) {
      const code = text.split(/\s+/)[1] ?? "";
      const want = await cfg("telegram_mod_code");
      if (want && code === want) {
        await setCfg("telegram_mod_chat", chatId);
        await setCfg("telegram_mod_title", String(msg.chat.title ?? msg.chat.first_name ?? chatId));
        await setCfg("telegram_mod_code", null);
        await tg(token, "sendMessage", { chat_id: chatId, text: "✅ এই গ্রুপ Reels Enjoy ভিডিও অ্যাপ্রুভের জন্য যুক্ত হয়েছে। নতুন ভিডিও আপলোড হলে এখানে আসবে — দেখে ✅ Approve বা ❌ Reject চাপুন।" });
      } else {
        await tg(token, "sendMessage", { chat_id: chatId, text: "❌ কোড ভুল বা পুরনো। অ্যাডমিন প্যানেল থেকে নতুন কোড নিন।" });
      }
      return json({ ok: true });
    }

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

  // ---------- cron (pg_net) ----------
  const xc = req.headers.get("x-cron");
  if (xc !== null) {
    const want = await cfg("tg_cron_secret");
    if (!want || xc !== want) return json({ error: "FORBIDDEN" }, 403);
    return json({ ok: true, ...(await modRun()) });
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
    await setCfg("telegram_admin_uid", user.id);
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
      url: `${URL_}/functions/v1/support-telegram`, secret_token: secret, allowed_updates: ["message", "callback_query"], drop_pending_updates: true,
    });
    if (!wh?.ok) return json({ error: "WEBHOOK_FAILED", detail: wh?.description }, 400);
    return json({ ok: true, bot: meInfo.result.username, link: `https://t.me/${meInfo.result.username}?start=${code}` });
  }

  if (b.action === "mod_run") return json({ ok: true, ...(await modRun()) });

  if (b.action === "mod_test") {
    const token = await cfg("telegram_bot_token"), chat = await cfg("telegram_mod_chat");
    if (!token || !chat) return json({ error: "NOT_LINKED" }, 400);
    const r = await tg(token, "sendMessage", { chat_id: chat, text: "✅ পরীক্ষা: ভিডিও অ্যাপ্রুভ গ্রুপ কাজ করছে।" });
    return json({ ok: !!r?.ok });
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
