import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const { SUPABASE_URL, SUPABASE_KEY } = window.REELS_CONFIG;
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const $ = (s, el = document) => el.querySelector(s);
const view = $("#view");
let me = null;

// ---------- helpers ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (n) => Number(n ?? 0).toLocaleString("en-IN");
const taka = (p) => "৳" + (Number(p ?? 0) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const dt = (s) => (s ? new Date(s).toLocaleString("en-GB", { timeZone: "Asia/Dhaka", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "-");
const METHOD = { bkash: "bKash", nagad: "Nagad", rocket: "Rocket" };
const STATUS = { pending: "পেন্ডিং", approved: "অ্যাপ্রুভড", paid: "Paid", rejected: "রিজেক্টেড", active: "সক্রিয়", banned: "ব্যান", published: "প্রকাশিত", deleted: "ডিলিট", open: "খোলা", resolved: "সমাধান", dismissed: "বাতিল" };
const CATS = [["natok", "🎭 নাটক"], ["movie", "🎬 মুভি"], ["funny", "😂 ফানি"], ["vlog", "📹 ব্লগ"], ["music", "🎵 গান"], ["other", "📦 অন্যান্য"]];
const CAT_NAME = Object.fromEntries(CATS);
const PHONE_CC = [["+880", "বাংলাদেশ"], ["+966", "সৌদি আরব"], ["+971", "দুবাই/আমিরাত"], ["+974", "কাতার"], ["+965", "কুয়েত"], ["+968", "ওমান"],
  ["+973", "বাহরাইন"], ["+60", "মালয়েশিয়া"], ["+65", "সিঙ্গাপুর"], ["+960", "মালদ্বীপ"], ["+673", "ব্রুনাই"], ["+91", "ভারত"], ["+962", "জর্ডান"],
  ["+961", "লেবানন"], ["+964", "ইরাক"], ["+218", "লিবিয়া"], ["+39", "ইতালি"], ["+44", "যুক্তরাজ্য"], ["+33", "ফ্রান্স"], ["+34", "স্পেন"],
  ["+351", "পর্তুগাল"], ["+30", "গ্রিস"], ["+49", "জার্মানি"], ["+40", "রোমানিয়া"], ["+1", "যুক্তরাষ্ট্র/কানাডা"], ["+61", "অস্ট্রেলিয়া"],
  ["+81", "জাপান"], ["+82", "দক্ষিণ কোরিয়া"], ["+230", "মরিশাস"], ["+27", "দক্ষিণ আফ্রিকা"]];
const phoneCountry = (ph) => (PHONE_CC.filter(([c]) => String(ph ?? "").startsWith(c)).sort((a, b) => b[0].length - a[0].length)[0]?.[1] ?? "-");
const flag = (cc) => (cc && cc.length === 2 ? String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 127397 + c.charCodeAt(0))) : "");
const age = (d) => (d ? Math.floor((Date.now() - new Date(d)) / (365.25 * 864e5)) : null);
const pill = (s) => `<span class="pill ${esc(s)}">${esc(STATUS[s] ?? s)}</span>`;

const ERR = {
  ADMIN_ONLY: "শুধু অ্যাডমিন এটা করতে পারবে", NOT_PENDING: "এটা আর পেন্ডিং নেই", ALREADY_DONE: "আগেই নিষ্পত্তি হয়েছে",
  TRX_REQUIRED: "TrxID দিতে হবে", REASON_REQUIRED: "কারণ লিখতে হবে", NOTE_REQUIRED: "নোট লিখতে হবে",
  BALANCE_WOULD_BE_NEGATIVE: "ব্যালেন্স মাইনাস হয়ে যাবে", SELF: "নিজের উপর এটা করা যাবে না",
  "Invalid login credentials": "নম্বর বা পাসওয়ার্ড ভুল",
};
const errMsg = (e) => {
  const m = e?.message ?? String(e);
  for (const k of Object.keys(ERR)) if (m.includes(k)) return ERR[k];
  return m;
};
function toast(msg, bad = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast show" + (bad ? " bad" : "");
  clearTimeout(t._h);
  t._h = setTimeout(() => (t.className = "toast"), 3000);
}
async function rpc(fn, args = {}) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw error;
  return data;
}
async function act(fn, okMsg) {
  try { const r = await fn(); if (okMsg) toast(okMsg); return r; }
  catch (e) { toast(errMsg(e), true); throw e; }
}
function copyable(text) { return `<span class="copy" data-copy="${esc(text)}">${esc(text)}</span>`; }
document.addEventListener("click", (e) => {
  const c = e.target.closest("[data-copy]");
  if (c) { navigator.clipboard?.writeText(c.dataset.copy); toast("কপি হয়েছে: " + c.dataset.copy); }
});
const loading = () => (view.innerHTML = `<div class="empty">লোড হচ্ছে…</div>`);

// ---------- auth ----------
async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return showLogin();
  const { data: p } = await sb.from("profiles").select("id,username,full_name,role,status").eq("id", session.user.id).single();
  if (!p || p.role !== "admin" || p.status !== "active") {
    await sb.auth.signOut();
    return showLogin("এই অ্যাকাউন্টের অ্যাডমিন অনুমতি নেই");
  }
  me = p;
  $("#login").classList.add("hidden");
  $("#app").classList.remove("hidden");
  $("#who").textContent = "@" + p.username;
  route();
  refreshBadges();
  setInterval(refreshBadges, 60000);
}
function showLogin(msg = "") {
  $("#app").classList.add("hidden");
  $("#login").classList.remove("hidden");
  $("#lErr").textContent = msg;
}
$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  let id = $("#lPhone").value.trim();
  if (!id.includes("@")) {
    id = id.replace(/[^\d+]/g, "");
    if (id.startsWith("00")) id = "+" + id.slice(2);
    else if (id.startsWith("01")) id = "+880" + id.slice(1); // বাংলাদেশি নম্বর
    else if (!id.startsWith("+")) id = "+" + id;
  }
  const { data: r } = await sb.functions.invoke("resolve-login", { body: { identifier: id } });
  // অ্যাডমিন অ্যাকাউন্ট সরাসরি ইমেইল দিয়েও থাকতে পারে
  const login = r?.login ?? (id.includes("@") ? id.toLowerCase() : null);
  if (!login) return ($("#lErr").textContent = "এই নম্বর/ইমেইলে কোনো অ্যাকাউন্ট নেই");
  const { error } = await sb.auth.signInWithPassword({ email: login, password: $("#lPass").value });
  if (error) return ($("#lErr").textContent = errMsg(error));
  boot();
});
$("#logoutBtn").addEventListener("click", async (e) => { e.preventDefault(); await sb.auth.signOut(); location.hash = ""; showLogin(); });
const toggleLang = (e) => { e?.preventDefault(); window.setLang?.(window.getLang?.() === "en" ? "bn" : "en"); };
$("#langBtn").addEventListener("click", toggleLang);
$("#lLang").addEventListener("click", toggleLang);
$("#menuBtn").addEventListener("click", () => $("#nav").classList.toggle("open"));
$("#nav").addEventListener("click", (e) => { if (e.target.closest("a")) $("#nav").classList.remove("open"); });

async function refreshBadges() {
  try {
    const d = await rpc("admin_dashboard");
    $("#bWd").textContent = d.withdraw_pending || "";
    $("#bCi").textContent = d.cashin_pending || "";
    $("#bRp").textContent = d.reports_open || "";
    const { count } = await sb.from("videos").select("id", { count: "exact", head: true }).eq("status", "pending");
    $("#bPv").textContent = count || "";
    const sc = await rpc("admin_support_counts").catch(() => null);
    if (sc) { $("#bSu").textContent = sc.user || ""; $("#bSh").textContent = sc.host || ""; $("#bDl").textContent = sc.deletions || ""; }
    const ds = await rpc("admin_device_stats").catch(() => null);
    if (ds) $("#bDv").textContent = ds.shared || "";
  } catch { /* ignore */ }
}

// ---------- router ----------
const routes = {};
function route() {
  const [name, arg] = (location.hash.slice(1) || "dashboard").split("/");
  document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("active", a.getAttribute("href") === "#" + name));
  view.onclick = null;
  (routes[name] ?? routes.dashboard)(arg);
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", () => me && route());

// ---------- dashboard ----------
routes.dashboard = async () => {
  loading();
  try {
    const d = await rpc("admin_dashboard");
    const s = (k, v, href, alert) => `<a class="card stat ${alert ? "alert" : ""}" ${href ? `href="#${href}"` : ""} style="text-decoration:none"><div class="k">${k}</div><div class="v">${v}</div></a>`;
    view.innerHTML = `<h1>ড্যাশবোর্ড</h1>
      <div class="grid">
        ${s("পেন্ডিং উইথড্র", `${num(d.withdraw_pending)} · ${taka(d.withdraw_pending_paisa)}`, "withdrawals", d.withdraw_pending > 0)}
        ${s("পেন্ডিং ক্যাশ-ইন", `${num(d.cashin_pending)} · ${taka(d.cashin_pending_paisa)}`, "cashins", d.cashin_pending > 0)}
        ${s("খোলা রিপোর্ট", num(d.reports_open), "moderation", d.reports_open > 0)}
        ${s("মোট ইউজার", num(d.users_total), "users")}
        ${s("আজ নতুন ইউজার", num(d.users_today), "users")}
        ${s("প্রকাশিত ভিডিও", num(d.videos_total), "videos")}
        ${s("আজ আপলোড", num(d.videos_today), "videos")}
        ${s("আজ ভিউ", num(d.views_today))}
      </div>
      <h2>টাকার হিসাব</h2>
      <div class="grid">
        ${s("আজ গিফট কমিশন", taka(d.gift_fee_today_paisa), "reports")}
        ${s("এ মাসে গিফট কমিশন", taka(d.gift_fee_month_paisa), "reports")}
        ${s("এ মাসে ক্যাশ-ইন", taka(d.cashin_month_paisa), "reports")}
        ${s("এ মাসে পেমেন্ট দেওয়া", taka(d.paid_month_paisa), "reports")}
        ${s("ইউজারদের মোট ব্যালেন্স (দায়)", taka(d.liability_paisa))}
        ${s("ইউজারদের কাছে কয়েন", num(d.coins_outstanding))}
        ${s("ব্যান ইউজার", num(d.users_banned), "users")}
      </div>
      <div id="hostReq"></div>
      <p class="muted small" style="margin-top:16px">অ্যাড রেভিনিউ দেখতে AdMob অ্যাপ/ওয়েবসাইট ব্যবহার করুন।</p>`;
    const hr = await rpc("admin_host_requests").catch(() => []);
    if (hr.length) {
      $("#hostReq").innerHTML = `<h2>🎤 হোস্ট আবেদন (${num(hr.length)})</h2><div class="list">${hr.map((r) => `<div class="item" data-id="${r.id}">
        <div class="top"><b><a href="#lookup/${r.user_no}">${r.user_no}</a> @${esc(r.username)}</b><span class="muted small">${dt(r.requested_at)}</span></div>
        <div class="muted small">${num(r.followers)} ফলোয়ার · ${num(r.videos)} ভিডিও</div>
        <div class="actions"><button class="btn sm good" data-h="1">অনুমোদন ✅</button><button class="btn sm bad" data-h="0">বাতিল</button></div></div>`).join("")}</div>`;
      $("#hostReq").onclick = async (e) => {
        const b = e.target.closest("[data-h]"); if (!b) return;
        const it = b.closest(".item");
        await act(() => rpc("admin_set_host", { p_user: it.dataset.id, p_host: b.dataset.h === "1" }), "হয়েছে");
        it.remove();
      };
    }
  } catch (e) { view.innerHTML = `<div class="empty err">${esc(errMsg(e))}</div>`; }
};

// ---------- withdrawals ----------
routes.withdrawals = async (tab = "pending") => {
  const tabs = ["pending", "approved", "paid", "rejected"];
  view.innerHTML = `<h1>উইথড্র রিকোয়েস্ট</h1>
    <div class="tabs">${tabs.map((t) => `<a class="btn sm ${t === tab ? "on" : ""}" href="#withdrawals/${t}">${STATUS[t]}</a>`).join("")}
    <button class="btn sm" id="csv">CSV ডাউনলোড</button></div>
    <div id="list" class="list"><div class="empty">লোড হচ্ছে…</div></div>`;
  const { data, error } = await sb.from("withdraw_requests")
    .select("*, profiles!withdraw_requests_user_id_fkey(username, full_name, user_private(phone))")
    .eq("status", tab).order("id", { ascending: tab === "pending" || tab === "approved" }).limit(200);
  if (error) return toast(errMsg(error), true);
  const list = $("#list");
  if (!data.length) list.innerHTML = `<div class="empty">কিছু নেই</div>`;
  else list.innerHTML = data.map((w) => `
    <div class="item">
      <div class="top"><span class="amt">${taka(w.payable_paisa)}</span>${pill(w.status)}</div>
      <div class="meta">
        <b>${METHOD[w.method]}</b> → ${copyable(w.account_number)} ${w.account_name ? "· " + esc(w.account_name) : ""}<br>
        <a href="#user/${w.user_id}">@${esc(w.profiles?.username)}</a> · ${esc(w.profiles?.user_private?.phone ?? "")}
        · অনুরোধ ${dt(w.created_at)} ${w.fee_paisa > 0 ? `· চার্জ ${taka(w.fee_paisa)} (মোট ${taka(w.amount_paisa)})` : ""}
        ${w.payout_trx_id ? `<br>TrxID: ${copyable(w.payout_trx_id)} · ${dt(w.paid_at)}` : ""}
        ${w.reject_reason ? `<br>কারণ: ${esc(w.reject_reason)}` : ""}
      </div>
      ${["pending", "approved"].includes(w.status) ? `<div class="actions">
        ${w.status === "pending" ? `<button class="btn sm" data-a="approve" data-id="${w.id}">অ্যাপ্রুভ</button>` : ""}
        <button class="btn sm good" data-a="paid" data-id="${w.id}">পেমেন্ট দিয়েছি (Paid)</button>
        <button class="btn sm bad" data-a="reject" data-id="${w.id}">রিজেক্ট</button>
      </div>` : ""}
    </div>`).join("");
  list.onclick = async (e) => {
    const b = e.target.closest("button[data-a]");
    if (!b) return;
    const id = Number(b.dataset.id), a = b.dataset.a;
    let text = null;
    if (a === "paid") { text = prompt("bKash/Nagad পেমেন্টের TrxID লিখুন:"); if (!text) return; }
    if (a === "reject") { text = prompt("রিজেক্টের কারণ (ইউজার দেখবে):"); if (!text) return; }
    b.disabled = true;
    try { await act(() => rpc("admin_withdraw_action", { p_id: id, p_action: a, p_text: text }), "সম্পন্ন হয়েছে"); routes.withdrawals(tab); refreshBadges(); }
    catch { b.disabled = false; }
  };
  $("#csv").onclick = () => {
    const rows = [["id", "user", "phone", "method", "account", "name", "payable_taka", "status", "requested"]]
      .concat(data.map((w) => [w.id, w.profiles?.username, w.profiles?.user_private?.phone, w.method, w.account_number, w.account_name ?? "", (w.payable_paisa / 100).toFixed(2), w.status, w.created_at]));
    const csv = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
    a.download = `withdraw-${tab}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };
};

// ---------- cash-ins ----------
routes.cashins = async (tab = "pending") => {
  const tabs = ["pending", "approved", "rejected"];
  view.innerHTML = `<h1>ক্যাশ-ইন রিকোয়েস্ট</h1>
    <p class="muted small">আপনার bKash/Nagad অ্যাপে TrxID ও টাকার পরিমাণ মিলিয়ে তবেই অ্যাপ্রুভ করুন।</p>
    <div class="tabs">${tabs.map((t) => `<a class="btn sm ${t === tab ? "on" : ""}" href="#cashins/${t}">${STATUS[t]}</a>`).join("")}</div>
    <div id="list" class="list"><div class="empty">লোড হচ্ছে…</div></div>`;
  const { data, error } = await sb.from("cash_in_requests")
    .select("*, profiles!cash_in_requests_user_id_fkey(username)")
    .eq("status", tab).order("id", { ascending: tab === "pending" }).limit(200);
  if (error) return toast(errMsg(error), true);
  const list = $("#list");
  if (!data.length) list.innerHTML = `<div class="empty">কিছু নেই</div>`;
  else list.innerHTML = data.map((c) => `
    <div class="item">
      <div class="top"><span class="amt">${taka(c.amount_paisa)}</span>${pill(c.status)}</div>
      <div class="meta">
        <b>${METHOD[c.method]}</b> · পাঠিয়েছে ${copyable(c.sender_number)} · TrxID ${copyable(c.trx_id)}<br>
        <a href="#user/${c.user_id}">@${esc(c.profiles?.username)}</a> পাবে <b>${num(c.coins)} কয়েন</b> · ${dt(c.created_at)}
        ${c.reject_reason ? `<br>কারণ: ${esc(c.reject_reason)}` : ""}
        ${c.proof_path ? `<br><button class="btn sm" data-proof="${esc(c.proof_path)}">📎 পেমেন্টের স্ক্রিনশট দেখুন</button><div class="proof"></div>` : `<br><span class="muted small">স্ক্রিনশট দেয়নি</span>`}
      </div>
      ${c.status === "pending" ? `<div class="actions">
        <button class="btn sm good" data-ok="1" data-id="${c.id}">টাকা পেয়েছি — অ্যাপ্রুভ</button>
        <button class="btn sm bad" data-ok="0" data-id="${c.id}">রিজেক্ট</button></div>` : ""}
    </div>`).join("");
  list.onclick = async (e) => {
    const pf = e.target.closest("button[data-proof]");
    if (pf) {
      const { data: su, error: er } = await sb.storage.from("proofs").createSignedUrl(pf.dataset.proof, 600);
      if (er) return toast(errMsg(er), true);
      pf.nextElementSibling.innerHTML = `<a href="${su.signedUrl}" target="_blank" rel="noopener"><img src="${su.signedUrl}" style="max-width:100%;max-height:420px;border-radius:10px;margin-top:8px"></a>`;
      pf.remove();
      return;
    }
    const b = e.target.closest("button[data-ok]");
    if (!b) return;
    const ok = b.dataset.ok === "1";
    let reason = null;
    if (!ok) { reason = prompt("রিজেক্টের কারণ:"); if (!reason) return; }
    else if (!confirm("নিশ্চিত? এই TrxID-তে টাকা আপনার অ্যাকাউন্টে এসেছে?")) return;
    b.disabled = true;
    try { await act(() => rpc("admin_cash_in_decide", { p_id: Number(b.dataset.id), p_approve: ok, p_reason: reason }), "সম্পন্ন"); routes.cashins(tab); refreshBadges(); }
    catch { b.disabled = false; }
  };
};

// ---------- users ----------
routes.users = async (type = "user") => {
  type = ["user", "host", "seller"].includes(type) ? type : "user";
  view.innerHTML = `<h1>👥 ইউজার</h1>
    <div class="tcards">
      <a class="tcard u ${type === "user" ? "on" : ""}" href="#users/user"><span>👤</span><div><b>ইউজার (নরমাল)</b><em id="tcU">…</em><small id="tcU2"></small></div></a>
      <a class="tcard h ${type === "host" ? "on" : ""}" href="#users/host"><span>🎤</span><div><b>হোস্ট</b><em id="tcH">…</em><small id="tcH2"></small></div></a>
    </div>
    <a class="tcard-mini ${type === "seller" ? "on" : ""}" href="#users/seller">💰 কয়েন সেলার হোস্ট: <b id="tcS">…</b> ›</a>
    <h2 style="margin-top:14px">${type === "host" ? "🎤 হোস্ট তালিকা" : type === "seller" ? "💰 কয়েন সেলার তালিকা" : "👤 ইউজার তালিকা"}</h2>
    <div class="toolbar"><input id="q" placeholder="নাম, ইউজারনেম বা ফোন">
      <select id="st"><option value="">সব</option><option value="active">সক্রিয়</option><option value="banned">ব্যান</option></select>
      <button class="btn" id="go">খুঁজুন</button></div>
    <div id="list" class="table-wrap"></div><div class="row" style="margin-top:10px"><button class="btn sm" id="more">আরও</button><span id="cnt" class="muted small"></span></div>`;
  let offset = 0, rows = [];
  const load = async (reset) => {
    if (reset) { offset = 0; rows = []; }
    const data = await act(() => rpc("admin_users", { p_q: $("#q").value.trim(), p_status: $("#st").value, p_limit: 50, p_offset: offset, p_type: type }));
    rows = rows.concat(data); offset += data.length;
    $("#cnt").textContent = `${rows.length} / ${data[0]?.total_count ?? rows.length}`;
    $("#more").classList.toggle("hidden", data.length < 50);
    $("#list").innerHTML = rows.length ? `<table><tr><th>ID</th><th>ইউজার</th><th>ফোন</th><th>স্ট্যাটাস</th><th class="num">ভিডিও</th><th class="num">কয়েন</th><th class="num">ব্যালেন্স</th><th class="num">পেন্ডিং</th><th class="num">পয়েন্ট</th><th>যোগদান</th></tr>
      ${rows.map((u) => `<tr><td><a href="#lookup/${u.user_no}"><b>${u.user_no}</b></a></td><td><a href="#user/${u.id}">@${esc(u.username)}</a>${u.account_type === "host" ? ' <span class="pill host">🎤</span>' : ""}${u.coin_seller ? ' <span class="pill seller">💰</span>' : ""}<br><span class="muted small">${esc(u.full_name ?? "")}${u.role === "admin" ? " · অ্যাডমিন" : ""}</span></td>
        <td>${esc(u.phone ?? "")}</td><td>${pill(u.status)}${u.is_frozen ? ' <span class="pill rejected">ফ্রিজ</span>' : ""}</td>
        <td class="num">${num(u.videos_count)}</td><td class="num">${num(u.coin_balance)}</td><td class="num">${taka(u.earning_paisa)}</td>
        <td class="num">${taka(u.pending_paisa)}</td><td class="num">${num(u.points)}</td><td>${dt(u.created_at)}</td></tr>`).join("")}</table>`
      : `<div class="empty">কেউ নেই</div>`;
  };
  $("#go").onclick = () => load(true);
  $("#q").onkeydown = (e) => e.key === "Enter" && load(true);
  $("#more").onclick = () => load(false);
  load(true);
  rpc("admin_user_type_counts").then((c) => {
    $("#tcU").textContent = num(c.user); $("#tcH").textContent = num(c.host); $("#tcS").textContent = num(c.seller);
    $("#tcU2").textContent = `৭ দিনে নতুন ${num(c.user_new_7d)}`;
    $("#tcH2").textContent = c.host_requests ? `⏳ ${num(c.host_requests)} জন আবেদন করেছে` : `৭ দিনে নতুন ${num(c.host_new_7d)}`;
  }).catch(() => {});
};

routes.user = async (id) => {
  loading();
  const [{ data: p }, { data: priv }, { data: w }, { data: tx }, { data: wd }] = await Promise.all([
    sb.from("profiles").select("*").eq("id", id).single(),
    sb.from("user_private").select("phone,email").eq("user_id", id).maybeSingle(),
    sb.from("wallets").select("*").eq("user_id", id).single(),
    sb.from("transactions").select("*").eq("user_id", id).order("id", { ascending: false }).limit(60),
    sb.from("withdraw_requests").select("*").eq("user_id", id).order("id", { ascending: false }).limit(20),
  ]);
  if (!p) return (view.innerHTML = `<div class="empty">ইউজার পাওয়া যায়নি</div>`);
  const bucketName = { coin: "কয়েন", earning: "ব্যালেন্স", pending: "পেন্ডিং", points: "পয়েন্ট" };
  const amt = (t) => (t.bucket === "coin" || t.bucket === "points" ? num(t.amount) : taka(t.amount));
  view.innerHTML = `<h1>@${esc(p.username)} ${p.is_verified ? "✔️" : ""}</h1>
    <div class="card"><div class="kv">
      <div>ID নম্বর</div><div><b>${copyable(String(p.user_no))}</b></div>
      <div>নাম</div><div translate="no">${esc(p.full_name ?? "-")}</div>
      <div>ফোন</div><div>${copyable(priv?.phone ?? "-")}</div>
      <div>ইমেইল</div><div>${priv?.email ? copyable(priv.email) : "-"}</div>
      <div>স্ট্যাটাস</div><div>${pill(p.status)} ${p.ban_reason ? esc(p.ban_reason) : ""} ${p.role === "admin" ? '<span class="pill approved">অ্যাডমিন</span>' : ""}</div>
      <div>ভিডিও / ফলোয়ার</div><div>${num(p.videos_count)} / ${num(p.followers_count)}</div>
      <div>যোগদান</div><div>${dt(p.created_at)}</div>
    </div></div>
    <h2>ওয়ালেট ${w?.is_frozen ? '<span class="pill rejected">ফ্রিজ</span>' : ""}</h2>
    <div class="grid">
      <div class="card stat"><div class="k">উইথড্রযোগ্য ব্যালেন্স</div><div class="v">${taka(w?.earning_paisa)}</div></div>
      <div class="card stat"><div class="k">পেন্ডিং</div><div class="v">${taka(w?.pending_paisa)}</div></div>
      <div class="card stat"><div class="k">কয়েন</div><div class="v">${num(w?.coin_balance)}</div></div>
      <div class="card stat"><div class="k">পয়েন্ট</div><div class="v">${num(w?.points)}</div></div>
      <div class="card stat"><div class="k">মোট আয়</div><div class="v">${taka(w?.total_earned_paisa)}</div></div>
      <div class="card stat"><div class="k">মোট উইথড্র</div><div class="v">${taka(w?.total_withdrawn_paisa)}</div></div>
    </div>
    <div class="toolbar" style="margin-top:12px">
      <button class="btn" id="ban">${p.status === "banned" ? "আনব্যান" : "ব্যান"}</button>
      <button class="btn" id="frz">${w?.is_frozen ? "ওয়ালেট আনফ্রিজ" : "ওয়ালেট ফ্রিজ"}</button>
      <button class="btn" id="adj">ব্যালেন্স অ্যাডজাস্ট</button>
      <button class="btn" id="pw">পাসওয়ার্ড রিসেট</button>
      <button class="btn" id="ver">${p.is_verified ? "ভেরিফাইড বাদ" : "ভেরিফাইড ব্যাজ"}</button>
      <button class="btn" id="role">${p.role === "admin" ? "অ্যাডমিন বাদ" : "অ্যাডমিন বানান"}</button>
      <a class="btn" href="#videos/user:${p.id}">ভিডিও দেখুন</a>
      <a class="btn" href="#lookup/${p.user_no}">🔎 সম্পূর্ণ প্রোফাইল</a>
      <a class="btn" href="#coins/${p.user_no}">🪙 কয়েন পাঠান</a>
      <a class="btn" href="#vault/${p.user_no}">🔒 লক ফোল্ডার</a>
      <a class="btn" href="#devices/${p.user_no}">📱 ডিভাইস</a>
    </div>
    <h2>উইথড্র</h2>
    <div class="table-wrap">${wd?.length ? `<table><tr><th>তারিখ</th><th class="num">টাকা</th><th>মাধ্যম</th><th>স্ট্যাটাস</th><th>TrxID / কারণ</th></tr>
      ${wd.map((r) => `<tr><td>${dt(r.created_at)}</td><td class="num">${taka(r.payable_paisa)}</td><td>${METHOD[r.method]} ${esc(r.account_number)}</td><td>${pill(r.status)}</td><td>${esc(r.payout_trx_id ?? r.reject_reason ?? "")}</td></tr>`).join("")}</table>` : `<div class="empty">নেই</div>`}</div>
    <h2>লেনদেন (সর্বশেষ ৬০)</h2>
    <div class="table-wrap">${tx?.length ? `<table><tr><th>তারিখ</th><th>ধরন</th><th>কোথায়</th><th class="num">পরিমাণ</th><th class="num">পরে</th><th>নোট</th></tr>
      ${tx.map((t) => `<tr><td>${dt(t.created_at)}</td><td>${esc(t.type)}</td><td>${bucketName[t.bucket]}</td><td class="num">${amt(t)}</td><td class="num">${t.bucket === "coin" || t.bucket === "points" ? num(t.balance_after) : taka(t.balance_after)}</td><td>${esc(t.note ?? "")}</td></tr>`).join("")}</table>` : `<div class="empty">নেই</div>`}</div>`;

  $("#ban").onclick = async () => {
    const banned = p.status === "banned";
    const reason = banned ? "" : prompt("ব্যানের কারণ:");
    if (!banned && !reason) return;
    await act(() => rpc("admin_set_user_status", { p_user: id, p_status: banned ? "active" : "banned", p_reason: reason }), "হয়েছে");
    routes.user(id);
  };
  $("#frz").onclick = async () => {
    const reason = prompt(w?.is_frozen ? "আনফ্রিজের কারণ:" : "ফ্রিজের কারণ (ফ্রিজ থাকলে উইথড্র ও ইনকাম রিলিজ বন্ধ):");
    if (reason === null) return;
    await act(() => rpc("admin_freeze_wallet", { p_user: id, p_frozen: !w?.is_frozen, p_reason: reason }), "হয়েছে");
    routes.user(id);
  };
  $("#adj").onclick = async () => {
    const bucket = prompt("কোথায়? লিখুন: earning (ব্যালেন্স), pending, coin, points", "earning");
    if (!["earning", "pending", "coin", "points"].includes(bucket ?? "")) return;
    const isMoney = bucket === "earning" || bucket === "pending";
    const v = prompt(isMoney ? "টাকার পরিমাণ (কমাতে মাইনাস দিন, যেমন -50):" : "সংখ্যা (কমাতে মাইনাস দিন):");
    if (!v || isNaN(Number(v))) return;
    const note = prompt("কারণ/নোট (ইউজার দেখবে):");
    if (!note) return;
    const amount = isMoney ? Math.round(Number(v) * 100) : Math.round(Number(v));
    await act(() => rpc("admin_adjust_wallet", { p_user: id, p_bucket: bucket, p_amount: amount, p_note: note }), "অ্যাডজাস্ট হয়েছে");
    routes.user(id);
  };
  $("#pw").onclick = async () => {
    const pw = prompt("নতুন পাসওয়ার্ড (কমপক্ষে ৬ অক্ষর):");
    if (!pw) return;
    const { data, error } = await sb.functions.invoke("admin-tools", { body: { action: "reset_password", user_id: id, password: pw } });
    if (error || data?.error) return toast(errMsg(error ?? data.error), true);
    toast("পাসওয়ার্ড বদলানো হয়েছে — ইউজারকে জানিয়ে দিন");
  };
  $("#ver").onclick = async () => { await act(() => rpc("admin_set_verified", { p_user: id, p_verified: !p.is_verified }), "হয়েছে"); routes.user(id); };
  $("#role").onclick = async () => {
    if (!confirm(p.role === "admin" ? "অ্যাডমিন অনুমতি সরাবেন?" : "এই ইউজারকে অ্যাডমিন বানাবেন? সে সব টাকার কাজ করতে পারবে।")) return;
    await act(() => rpc("admin_set_role", { p_user: id, p_role: p.role === "admin" ? "user" : "admin" }), "হয়েছে");
    routes.user(id);
  };
};

// ---------- videos ----------
routes.videos = async (arg = "published") => {
  const userFilter = arg.startsWith("user:") ? arg.slice(5) : null;
  const status = userFilter ? null : arg;
  const tabs = [["pending", "পেন্ডিং"], ["published", "প্রকাশিত"], ["featured", "ফিচার্ড"], ["rejected", "রিজেক্টেড"], ["deleted", "ডিলিট"]];
  view.innerHTML = `<h1>ভিডিও</h1>
    <div class="tabs">${tabs.map(([k, l]) => `<a class="btn sm ${k === status ? "on" : ""}" href="#videos/${k}">${l}</a>`).join("")}
      <a class="btn sm" href="#upload">+ আপলোড</a></div>
    <div id="list" class="videos"></div><div style="margin-top:12px"><button class="btn sm" id="more">আরও</button></div>`;
  let before = null;
  const load = async () => {
    let q = sb.from("videos").select("*, profiles!videos_user_id_fkey(username)").order("id", { ascending: false }).limit(24);
    if (userFilter) q = q.eq("user_id", userFilter);
    else if (status === "featured") q = q.eq("is_featured", true).eq("status", "published");
    else q = q.eq("status", status);
    if (before) q = q.lt("id", before);
    const { data, error } = await q;
    if (error) return toast(errMsg(error), true);
    if (data.length) before = data[data.length - 1].id;
    $("#more").classList.toggle("hidden", data.length < 24);
    const html = data.map((v) => `
      <div class="vcard" data-id="${v.id}">
        <video src="${esc(v.video_url)}" ${v.thumb_url ? `poster="${esc(v.thumb_url)}"` : ""} preload="none" controls playsinline></video>
        <div class="body">
          <div><a href="#user/${v.user_id}">@${esc(v.profiles?.username)}</a> <span class="pill">${CAT_NAME[v.category] ?? ""}</span> ${v.is_featured ? "⭐" : ""} ${v.uploaded_by_admin ? '<span class="pill">অ্যাডমিন</span>' : ""} ${v.is_premium ? `<span class="pill pending">👑 প্রিমিয়াম ${num(v.premium_coins)} কয়েন</span>` : ""}</div>
          ${v.is_premium && v.status === "pending" ? `<div class="small" style="color:var(--warn)">প্রিমিয়াম ভিডিও অটো-অ্যাপ্রুভ হয় না — দেখে অ্যাপ্রুভ করুন। অশ্লীল কিছু থাকলে রিজেক্ট করুন।</div>` : ""}
          ${v.status === "pending" ? `<div class="small" style="color:var(--warn)">⏳ পেন্ডিং · ${dt(v.created_at)}</div>` : ""}
          <div class="cap" translate="no">${esc(v.caption ?? "")}</div>
          <div class="muted small">👁 ${num(v.views_count)} ❤️ ${num(v.likes_count)} 💬 ${num(v.comments_count)} 🎁 ${num(v.gifts_coins_total)} · ${dt(v.created_at)}</div>
          ${v.reject_reason ? `<div class="small err">${esc(v.reject_reason)}</div>` : ""}
          <div class="actions">
            ${v.status === "pending" ? `<button class="btn sm good" data-a="approve">অ্যাপ্রুভ ✅</button><button class="btn sm warn" data-a="reject">রিজেক্ট</button>`
            : v.status === "published" ? `<button class="btn sm" data-a="${v.is_featured ? "unfeature" : "feature"}">${v.is_featured ? "আনফিচার" : "ফিচার ⭐"}</button>
              <button class="btn sm warn" data-a="reject">রিজেক্ট</button><button class="btn sm bad" data-a="delete">ডিলিট</button>`
              : `<button class="btn sm good" data-a="restore">ফেরত আনুন</button>`}
          </div>
        </div>
      </div>`).join("");
    $("#list").insertAdjacentHTML("beforeend", html || (before ? "" : `<div class="empty">কোনো ভিডিও নেই</div>`));
  };
  $("#list").onclick = async (e) => {
    const b = e.target.closest("button[data-a]");
    if (!b) return;
    const id = Number(b.closest(".vcard").dataset.id), a = b.dataset.a;
    let reason = null;
    if (a === "reject" || a === "delete") { reason = prompt("কারণ (ক্রিয়েটর দেখবে):"); if (!reason) return; }
    await act(() => rpc("admin_video_action", { p_id: id, p_action: a, p_reason: reason }), "হয়েছে");
    b.closest(".vcard").remove();
    refreshBadges();
  };
  $("#more").onclick = load;
  load();
};

// ---------- upload (admin) ----------
routes.upload = () => {
  view.innerHTML = `<h1>ভিডিও আপলোড (অ্যাডমিন)</h1>
    <div class="card" style="max-width:520px">
      <label>ভিডিও ফাইল (MP4, সর্বোচ্চ 50MB)<input type="file" id="vf" accept="video/mp4,video/quicktime,video/webm"></label>
      <video id="pv" class="hidden" style="width:100%;max-height:360px;margin-top:10px;background:#000" controls playsinline muted></video>
      <label>ক্যাটাগরি<select id="cat">${CATS.map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></label>
      <label>ক্যাপশন (#হ্যাশট্যাগ সহ)<textarea id="cap" maxlength="2200"></textarea></label>
      <button class="btn primary" id="up">আপলোড করুন</button>
      <div class="progress hidden" id="pg"><div></div></div>
      <p id="msg" class="muted small"></p>
    </div>`;
  const vf = $("#vf"), pv = $("#pv");
  vf.onchange = () => { if (vf.files[0]) { pv.src = URL.createObjectURL(vf.files[0]); pv.classList.remove("hidden"); } };
  $("#up").onclick = async () => {
    const f = vf.files[0];
    if (!f) return toast("ভিডিও বেছে নিন", true);
    if (f.size > 50 * 1024 * 1024) return toast("ফাইল 50MB-এর বেশি", true);
    const btn = $("#up"); btn.disabled = true;
    const pg = $("#pg"); pg.classList.remove("hidden");
    const setP = (x, m) => { pg.firstElementChild.style.width = x + "%"; $("#msg").textContent = m; };
    try {
      setP(5, "থাম্বনেইল তৈরি হচ্ছে…");
      await new Promise((r) => (pv.readyState >= 1 ? r() : (pv.onloadedmetadata = r)));
      const duration = Math.round(pv.duration || 0);
      pv.currentTime = Math.min(1, (pv.duration || 2) / 2);
      await new Promise((r) => (pv.onseeked = r));
      const c = document.createElement("canvas");
      const scale = Math.min(1, 540 / (pv.videoWidth || 540));
      c.width = Math.round((pv.videoWidth || 540) * scale); c.height = Math.round((pv.videoHeight || 960) * scale);
      c.getContext("2d").drawImage(pv, 0, 0, c.width, c.height);
      const thumb = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.8));

      const stamp = Date.now();
      const ext = (f.name.split(".").pop() || "mp4").toLowerCase();
      const vPath = `${me.id}/${stamp}.${ext}`, tPath = `${me.id}/${stamp}.jpg`;
      setP(15, "ভিডিও আপলোড হচ্ছে… (বড় ফাইলে সময় লাগবে)");
      const up1 = await sb.storage.from("videos").upload(vPath, f, { contentType: f.type || "video/mp4", upsert: false });
      if (up1.error) throw up1.error;
      setP(85, "থাম্বনেইল আপলোড…");
      const up2 = await sb.storage.from("thumbs").upload(tPath, thumb, { contentType: "image/jpeg" });
      if (up2.error) throw up2.error;
      const vUrl = sb.storage.from("videos").getPublicUrl(vPath).data.publicUrl;
      const tUrl = sb.storage.from("thumbs").getPublicUrl(tPath).data.publicUrl;
      setP(95, "সেভ হচ্ছে…");
      const vid = await rpc("create_video", { p_video_path: vPath, p_video_url: vUrl, p_thumb_url: tUrl, p_caption: $("#cap").value, p_duration: duration });
      await rpc("set_video_category", { p_id: vid, p_category: $("#cat").value });
      setP(100, "✅ আপলোড সম্পন্ন — ফিডে দেখা যাবে");
      toast("আপলোড সম্পন্ন");
      vf.value = ""; $("#cap").value = "";
    } catch (e) { toast(errMsg(e), true); $("#msg").textContent = "ব্যর্থ: " + errMsg(e); }
    btn.disabled = false;
  };
};



// ---------- ইউজার খুঁজুন (ID নম্বর দিয়ে) ----------
routes.lookup = async (no) => {
  view.innerHTML = `<h1>🔎 ইউজার খুঁজুন</h1>
    <div class="toolbar"><input id="lq" type="number" inputmode="numeric" placeholder="ইউজারের ID নম্বর (যেমন 100001)" value="${esc(no ?? "")}"><button class="btn" id="lgo">খুঁজুন</button></div>
    <div id="lr"></div>`;
  $("#lgo").onclick = () => { const v = $("#lq").value.trim(); if (v) location.hash = "#lookup/" + v; };
  $("#lq").onkeydown = (e) => e.key === "Enter" && $("#lgo").click();
  if (!no) return;
  $("#lr").innerHTML = `<div class="empty">লোড হচ্ছে…</div>`;
  let d;
  try { d = await rpc("admin_user_detail", { p_user_no: Number(no) }); }
  catch (e) { $("#lr").innerHTML = `<div class="empty err">${esc(errMsg(e))}</div>`; return; }
  const p = d.profile, pv = d.private ?? {}, w = d.wallet ?? {};
  const mapLink = pv.lat != null ? `https://maps.google.com/?q=${pv.lat},${pv.lon}` : null;
  const a = age(pv.birth_date);
  $("#lr").innerHTML = `
    <div class="card" style="display:flex;gap:14px;align-items:center">
      <div style="width:64px;height:64px;border-radius:50%;overflow:hidden;background:var(--panel2);display:grid;place-items:center;font-size:26px;flex:none">
        ${p.avatar_url ? `<img src="${esc(p.avatar_url)}" style="width:100%;height:100%;object-fit:cover">` : "👤"}</div>
      <div><div style="font-size:18px;font-weight:700" translate="no">${esc(p.full_name ?? "")} ${p.is_verified ? "✔️" : ""}</div>
        <div class="muted">@${esc(p.username)} · ID <b>${p.user_no}</b> ${flag(pv.country_code)}</div>
        <div style="margin-top:4px">${pill(p.status)} ${p.role === "admin" ? '<span class="pill approved">অ্যাডমিন</span>' : ""} ${w.is_frozen ? '<span class="pill rejected">ফ্রিজ</span>' : ""}</div></div>
    </div>
    <div class="card"><div class="kv">
      <div>ফোন</div><div>${copyable(pv.phone ?? "-")}</div>
      <div>নম্বরের দেশ</div><div>${phoneCountry(pv.phone)}</div>
      <div>ইমেইল</div><div>${pv.email ? copyable(pv.email) : "-"}</div>
      <div>জন্মতারিখ</div><div>${pv.birth_date ? `${esc(pv.birth_date)} (${a} বছর)` : "-"}</div>
      <div>যোগদান</div><div>${dt(p.created_at)}</div>
      <div>শেষ সক্রিয়</div><div>${pv.last_seen ? dt(pv.last_seen) : "-"}</div>
      <div>বর্তমান লোকেশন</div><div>${pv.country ? `${flag(pv.country_code)} ${esc(pv.country)}${pv.city ? ", " + esc(pv.city) : ""} <span class="muted small">(${dt(pv.location_at)})</span>` : "-"}
        ${mapLink ? ` · <a href="${mapLink}" target="_blank" rel="noopener">ম্যাপে দেখুন</a>` : ""}</div>
      <div>রেফার করেছে</div><div>${d.referred_by ? `<a href="#lookup/${d.referred_by.user_no}">${d.referred_by.user_no} @${esc(d.referred_by.username)}</a>` : "-"}</div>
      <div>রেফার এনেছে</div><div>${num(d.referrals_total)} জন (সফল ${num(d.referrals_qualified)})</div>
      <div>ভিডিও দেখেছে</div><div>${num(d.views_given)}</div>
      <div>গিফট পাঠিয়েছে</div><div>🪙 ${num(d.gifts_sent_coins)}</div>
      <div>গিফট থেকে আয়</div><div>${taka(d.gifts_received_paisa)}</div>
      <div>লক ফোল্ডার</div><div>${num(d.vault_files)} ফাইল · ${(Number(d.vault_bytes) / 1048576).toFixed(1)} MB</div>
      <div>অ্যাকাউন্টের ধরন</div><div>${p.account_type === "host" ? "🎤 হোস্ট" : "👤 ইউজার"}${p.host_requested_at && p.account_type !== "host" ? ' <span class="pill pending">হোস্ট আবেদন</span>' : ""}</div>
      <div>ভাষা</div><div>${esc(p.language ?? "-")}</div>
      <div>অ্যাপে সময়</div><div id="usage">…</div>
    </div></div>
    <div class="card" id="ctl">
      <h3 style="margin:0 0 10px">⚙️ নিয়ন্ত্রণ</h3>
      <div class="row" style="flex-wrap:wrap;gap:8px;margin-bottom:12px">
        <span>অ্যাকাউন্ট: <b>${p.account_type === "host" ? "🎤 হোস্ট" : "👤 ইউজার"}</b></span>
        ${p.account_type === "host" ? `<button class="btn sm warn" data-c="unhost">ইউজার বানান</button>` : `<button class="btn sm good" data-c="host">হোস্ট বানান</button>`}
      </div>
      ${p.account_type === "host" ? `<div style="margin-bottom:12px"><b>📞 এই হোস্টের কলের রেট</b> <span class="muted small">(খালি = সবার জন্য নির্ধারিত) · কল ${p.calls_on === false ? "❌ বন্ধ রেখেছে" : "✅ চালু"}</span>
        <div class="row" style="flex-wrap:nowrap;gap:6px"><input id="crv" type="number" min="1" placeholder="ভিডিও 🪙/মিনিট" value="${p.call_video_rate ?? ""}"><input id="cra" type="number" min="1" placeholder="অডিও 🪙/মিনিট" value="${p.call_audio_rate ?? ""}">
        <input id="crp" type="number" min="0" max="100" placeholder="হোস্ট %" value="${p.call_host_pct ?? ""}"><button class="btn sm good" data-c="crate">সেভ</button></div></div>` : ""}
      <div class="row" style="flex-wrap:wrap;gap:8px;margin-bottom:12px">
        <span>💰 কয়েন সেলার: <b>${p.coin_seller ? `✅ হ্যাঁ${p.seller_commission_pct != null ? ` (কমিশন ${p.seller_commission_pct}%)` : ""}` : "❌ না"}</b></span>
        ${p.coin_seller ? `<button class="btn sm warn" data-c="sell_off">বাদ দিন</button>` : `<button class="btn sm good" data-c="sell_on" ${p.account_type === "host" ? "" : "disabled title='আগে হোস্ট বানান'"}>সেলার বানান</button>`}
      </div>
      <div class="row" style="flex-wrap:wrap;gap:8px;margin-bottom:12px">
        <span>👑 প্রিমিয়াম ফ্রি দেখা: <b>${p.premium_access ? "✅ চালু" : "❌ বন্ধ"}</b></span>
        ${p.premium_access ? `<button class="btn sm warn" data-c="pa_off">বন্ধ করুন</button>` : `<button class="btn sm good" data-c="pa_on" ${p.account_type === "host" ? "" : "disabled title='আগে হোস্ট বানান'"}>অনুমতি দিন</button>`}
      </div>
      <div style="margin-bottom:12px"><b>দিনে আপলোড সীমা</b> <span class="muted small">(খালি রাখলে সবার জন্য নির্ধারিত সীমা)</span>
        <div class="row" style="flex-wrap:nowrap;gap:8px"><input id="ul" type="number" min="0" value="${p.daily_upload_limit ?? ""}" placeholder="ডিফল্ট"><button class="btn sm good" data-c="limit">সেভ</button></div></div>
      ${p.jailed ? `<div style="background:#3a0f12;border-radius:10px;padding:10px"><b>🚫 জেলে আছে</b>
          <div class="small">কারণ: <span translate="no">${esc(p.jail_reason ?? "-")}</span> · মুক্তির ফি: 🪙 ${num(p.jail_fee_coins)} · ${p.jailed_at ? dt(p.jailed_at) : ""}</div>
          <button class="btn sm good" data-c="unjail" style="margin-top:8px">জেল থেকে মুক্ত করুন</button></div>`
        : `<div><b>🚫 জেলে দিন</b> <span class="muted small">(ইউজার আপলোড/লাইক/কমেন্ট/গিফট/আয় করতে পারবে না; কয়েন দিয়ে মুক্ত হতে পারবে)</span>
          <input id="jr" placeholder="কারণ (ইউজার দেখবে)">
          <div class="row" style="flex-wrap:nowrap;gap:8px"><input id="jf" type="number" min="0" placeholder="মুক্তির জন্য কত কয়েন"><button class="btn sm bad" data-c="jail">জেলে দিন</button></div></div>`}
    </div>
    <div class="grid">
      <div class="card stat"><div class="k">উইথড্রযোগ্য ব্যালেন্স</div><div class="v">${taka(w.earning_paisa)}</div></div>
      <div class="card stat"><div class="k">পেন্ডিং</div><div class="v">${taka(w.pending_paisa)}</div></div>
      <div class="card stat"><div class="k">কয়েন</div><div class="v">${num(w.coin_balance)}</div></div>
      <div class="card stat"><div class="k">পয়েন্ট</div><div class="v">${num(w.points)}</div></div>
      <div class="card stat"><div class="k">মোট আয়</div><div class="v">${taka(w.total_earned_paisa)}</div></div>
      <div class="card stat"><div class="k">মোট উইথড্র</div><div class="v">${taka(w.total_withdrawn_paisa)}</div></div>
    </div>
    <div class="toolbar" style="margin-top:12px">
      <a class="btn" href="#user/${p.id}">⚙️ ম্যানেজ (ব্যান, ব্যালেন্স, পাসওয়ার্ড)</a>
      <a class="btn" href="#coins/${p.user_no}">🪙 কয়েন পাঠান</a>
      <a class="btn" href="#vault/${p.user_no}">🔒 লক ফোল্ডার</a>
      <a class="btn" href="#devices/${p.user_no}">📱 ডিভাইস</a>
    </div>
    <h2>#️⃣ এই ইউজারের ট্যাগ</h2><div id="utags" class="muted small">লোড হচ্ছে…</div>
    <h2>পোস্ট (${num(d.videos.length)})</h2>
    <div class="videos">${d.videos.length ? d.videos.map((v) => `<div class="vcard">
      <video src="${esc(v.video_url)}" ${v.thumb_url ? `poster="${esc(v.thumb_url)}"` : ""} preload="none" controls playsinline></video>
      <div class="body"><div>${pill(v.status)} <span class="pill">${CAT_NAME[v.category] ?? ""}</span></div>
        <div class="cap" translate="no">${esc(v.caption ?? "")}</div>
        <div class="muted small">👁 ${num(v.views)} ❤️ ${num(v.likes)} · ${dt(v.created_at)}</div></div></div>`).join("") : `<div class="empty">কোনো পোস্ট নেই</div>`}</div>`;
  sb.from("app_usage").select("day,seconds").eq("user_id", p.id).order("day", { ascending: false }).limit(30).then(({ data }) => {
    const all = (data ?? []).reduce((a, x) => a + x.seconds, 0), today = (data ?? []).find((x) => x.day === new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" }))?.seconds ?? 0;
    if ($("#usage")) $("#usage").textContent = `আজ ${hms(today)} · ৩০ দিনে ${hms(all)}`;
  });
  rpc("admin_user_tags", { p_user_no: p.user_no }).then((t) => { if ($("#utags")) $("#utags").innerHTML = t.length ? t.map((x) => `<span class="pill" translate="no">#${esc(x.tag)} ×${x.uses}</span>`).join(" ") : "কোনো ট্যাগ ব্যবহার করেনি"; }).catch(() => {});
  sb.from("settings").select("value").eq("key", "jail_release_coins").maybeSingle().then(({ data }) => { if ($("#jf") && data) $("#jf").value = data.value; });
  $("#ctl").onclick = async (e) => {
    const b = e.target.closest("[data-c]"); if (!b) return;
    const c = b.dataset.c;
    if (c === "host" || c === "unhost") await act(() => rpc("admin_set_host", { p_user: p.id, p_host: c === "host" }), "হয়েছে");
    else if (c === "crate") { const nv = (q) => { const v = $(q).value.trim(); return v === "" ? null : Number(v); }; await act(() => rpc("admin_set_call_rates", { p_user: p.id, p_video: nv("#crv"), p_audio: nv("#cra"), p_pct: nv("#crp") }), "সেভ হয়েছে"); }
    else if (c === "sell_on" || c === "sell_off") await act(() => rpc("admin_set_coin_seller", { p_user: p.id, p_on: c === "sell_on", p_pct: c === "sell_on" ? p.seller_commission_pct ?? null : null }), "হয়েছে");
    else if (c === "pa_on" || c === "pa_off") await act(() => rpc("admin_set_premium_access", { p_user: p.id, p_on: c === "pa_on" }), "হয়েছে");
    else if (c === "limit") { const v = $("#ul").value.trim(); await act(() => rpc("admin_set_upload_limit", { p_user: p.id, p_limit: v === "" ? null : Number(v) }), "সেভ হয়েছে"); }
    else if (c === "unjail") { if (!confirm("জেল থেকে মুক্ত করবেন?")) return; await act(() => rpc("admin_jail_user", { p_user: p.id, p_jail: false, p_reason: null, p_fee: null }), "মুক্ত করা হয়েছে"); }
    else if (c === "jail") {
      const reason = $("#jr").value.trim(); if (!reason) return toast("কারণ লিখুন", true);
      const fee = Number($("#jf").value); if (isNaN(fee) || fee < 0) return toast("কয়েনের সংখ্যা দিন", true);
      if (!confirm(`${p.username}-কে জেলে দেবেন? মুক্তির ফি ${fee} কয়েন`)) return;
      await act(() => rpc("admin_jail_user", { p_user: p.id, p_jail: true, p_reason: reason, p_fee: fee }), "জেলে দেওয়া হয়েছে");
    }
    routes.lookup(no);
  };
};


// ---------- অ্যানালিটিক্স ----------
const TXT_CAT = { shayari: "💌 শায়েরি", golpo: "📖 গল্প", joke: "😂 মজার কথা", kobita: "🖋️ কবিতা", romantic: "❤️ রোমান্টিক", "-": "-" };
const hms = (sec) => { sec = Number(sec || 0); const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60); return h ? `${h} ঘণ্টা ${m} মিনিট` : `${m} মিনিট`; };
const bar = (v, max, color = "#9b5cff") => `<div style="background:var(--panel2);border-radius:6px;height:8px;overflow:hidden;min-width:60px"><div style="height:100%;width:${max ? Math.round((v / max) * 100) : 0}%;background:${color}"></div></div>`;
routes.analytics = async (days = "7") => {
  loading();
  let d;
  try { d = await rpc("admin_analytics", { p_days: Number(days) }); } catch (e) { view.innerHTML = `<div class="empty err">${esc(errMsg(e))}</div>`; return; }
  const u = d.usage, maxDay = Math.max(1, ...d.daily.map((x) => x.seconds));
  const maxCat = Math.max(1, ...d.categories.map((x) => x.views_period)), maxC = Math.max(1, ...d.countries.map((x) => x.users));
  const totUsers = d.countries.reduce((a, x) => a + x.users, 0);
  view.innerHTML = `<h1>📉 অ্যানালিটিক্স</h1>
    <div class="tabs">${[["1", "আজ"], ["7", "৭ দিন"], ["30", "৩০ দিন"], ["90", "৯০ দিন"]].map(([k, l]) => `<a class="btn sm ${k === String(days) ? "on" : ""}" href="#analytics/${k}">${l}</a>`).join("")}</div>
    <h2>⏱️ অ্যাপে কত সময় কাটাচ্ছে</h2>
    <div class="grid">
      <div class="card stat"><div class="k">আজ মোট সময়</div><div class="v">${hms(u.today_seconds)}</div></div>
      <div class="card stat"><div class="k">আজ সক্রিয় ইউজার</div><div class="v">${num(u.today_users)}</div></div>
      <div class="card stat"><div class="k">এই সময়ে মোট</div><div class="v">${hms(u.seconds)}</div></div>
      <div class="card stat"><div class="k">প্রতি ইউজার গড় (প্রতিদিন)</div><div class="v">${hms(u.users ? u.seconds / u.users / d.days : 0)}</div></div>
    </div>
    <div class="table-wrap" style="margin-top:10px"><table><tr><th>দিন</th><th class="num">সময়</th><th class="num">ইউজার</th><th></th></tr>
      ${d.daily.map((x) => `<tr><td>${esc(x.day)}</td><td class="num">${hms(x.seconds)}</td><td class="num">${num(x.users)}</td><td>${bar(x.seconds, maxDay)}</td></tr>`).join("")}</table></div>
    <h2>👑 সবচেয়ে বেশি সময় দেওয়া ইউজার</h2>
    <div class="table-wrap"><table><tr><th>ID</th><th>ইউজার</th><th class="num">সময়</th></tr>
      ${d.top_users.map((x) => `<tr><td><a href="#lookup/${x.user_no}">${x.user_no}</a></td><td>${flag(x.country_code)} @${esc(x.username)}</td><td class="num">${hms(x.seconds)}</td></tr>`).join("") || `<tr><td colspan="3" class="muted">এখনো ডেটা নেই — নতুন অ্যাপ ব্যবহার শুরু হলে দেখা যাবে</td></tr>`}</table></div>
    <h2>🎬 কোন ধরনের ভিডিও বেশি দেখছে</h2>
    <div class="table-wrap"><table><tr><th>ক্যাটাগরি</th><th class="num">এই সময়ে ভিউ</th><th></th><th class="num">মোট ভিউ</th><th class="num">ভিডিও</th><th class="num">গড় ভিউ</th><th class="num">লাইক</th><th class="num">কমেন্ট</th><th class="num">গিফট 🪙</th><th class="num">প্রিমিয়াম</th></tr>
      ${d.categories.map((x) => `<tr><td>${CAT_NAME[x.category] ?? esc(x.category)}</td><td class="num"><b>${num(x.views_period)}</b></td><td>${bar(x.views_period, maxCat, "#e34cf0")}</td><td class="num">${num(x.views)}</td><td class="num">${num(x.videos)}</td>
        <td class="num">${num(Math.round(x.views / Math.max(1, x.videos)))}</td><td class="num">${num(x.likes)}</td><td class="num">${num(x.comments)}</td><td class="num">${num(x.gift_coins)}</td><td class="num">${num(x.premium)}</td></tr>`).join("") || `<tr><td colspan="10" class="muted">ডেটা নেই</td></tr>`}</table></div>
    <h2>🖼️ ফটো ও লেখা</h2>
    <div class="table-wrap"><table><tr><th>ধরন</th><th class="num">পোস্ট</th><th class="num">লাইক</th><th class="num">কমেন্ট</th><th class="num">শেয়ার</th></tr>
      ${d.posts.map((x) => `<tr><td>${x.kind === "photo" ? "🖼️ ফটো" : "✍️ " + (TXT_CAT[x.category] ?? esc(x.category))}</td><td class="num">${num(x.posts)}</td><td class="num">${num(x.likes)}</td><td class="num">${num(x.comments)}</td><td class="num">${num(x.shares)}</td></tr>`).join("") || `<tr><td colspan="5" class="muted">ডেটা নেই</td></tr>`}</table></div>
    <h2>🌍 কোন দেশে কত ইউজার</h2>
    <div class="table-wrap"><table><tr><th>দেশ</th><th class="num">ইউজার</th><th></th><th class="num">%</th><th class="num">এই সময়ে সক্রিয়</th><th class="num">হোস্ট</th></tr>
      ${d.countries.map((x) => `<tr><td>${x.country_code === "??" ? "❓ জানা নেই" : `${flag(x.country_code)} ${esc(COUNTRY_EN[x.country_code] ?? x.country_code)}`}</td><td class="num"><b>${num(x.users)}</b></td><td>${bar(x.users, maxC, "#22c55e")}</td>
        <td class="num">${totUsers ? Math.round((x.users / totUsers) * 100) : 0}%</td><td class="num">${num(x.active)}</td><td class="num">${num(x.hosts)}</td></tr>`).join("")}</table></div>
    <p class="muted small">"জানা নেই" = যারা এখনো নতুন APK দিয়ে লোকেশন দেয়নি। সময়ের হিসাব আজ থেকে শুরু হয়েছে।</p>`;
};
const COUNTRY_EN = { BD: "বাংলাদেশ", SA: "সৌদি আরব", AE: "আমিরাত", QA: "কাতার", KW: "কুয়েত", OM: "ওমান", BH: "বাহরাইন", MY: "মালয়েশিয়া", SG: "সিঙ্গাপুর", MV: "মালদ্বীপ",
  IN: "ভারত", IT: "ইতালি", GB: "যুক্তরাজ্য", US: "যুক্তরাষ্ট্র", JO: "জর্ডান", LB: "লেবানন", IQ: "ইরাক", LY: "লিবিয়া", FR: "ফ্রান্স", ES: "স্পেন", PT: "পর্তুগাল",
  GR: "গ্রিস", DE: "জার্মানি", RO: "রোমানিয়া", CA: "কানাডা", AU: "অস্ট্রেলিয়া", JP: "জাপান", KR: "দক্ষিণ কোরিয়া", PK: "পাকিস্তান", NP: "নেপাল" };

// ---------- ফটো ও লেখা (মডারেশন) ----------
routes.posts = async (arg = "photo:published") => {
  const [kind, status] = arg.split(":");
  const kinds = [["photo", "🖼️ ফটো"], ["text", "✍️ লেখা"]], sts = [["pending", "পেন্ডিং"], ["published", "প্রকাশিত"], ["rejected", "রিজেক্টেড"], ["deleted", "ডিলিট"]];
  view.innerHTML = `<h1>🖼️ ফটো ও লেখা</h1>
    <div class="tabs">${kinds.map(([k, l]) => `<a class="btn sm ${k === kind ? "on" : ""}" href="#posts/${k}:${status}">${l}</a>`).join("")}</div>
    <div class="tabs">${sts.map(([k, l]) => `<a class="btn sm ${k === status ? "on" : ""}" href="#posts/${kind}:${k}">${l}</a>`).join("")}</div>
    <div id="list" class="videos"></div><div style="margin-top:12px"><button class="btn sm" id="more">আরও</button></div>`;
  let before = null;
  const load = async () => {
    let q = sb.from("posts").select("*, profiles!posts_user_id_fkey(username,user_no)").eq("kind", kind).eq("status", status).order("id", { ascending: false }).limit(24);
    if (before) q = q.lt("id", before);
    const { data, error } = await q;
    if (error) return toast(errMsg(error), true);
    if (data.length) before = data[data.length - 1].id;
    $("#more").classList.toggle("hidden", data.length < 24);
    $("#list").insertAdjacentHTML("beforeend", data.map((p) => `<div class="vcard" data-id="${p.id}">
      ${p.kind === "photo" ? `<img src="${esc(p.image_url)}" loading="lazy" style="aspect-ratio:3/4" alt="">` : `<div style="padding:16px;min-height:120px;white-space:pre-line;font-weight:600;background:linear-gradient(135deg,#5b2bd0,#c04cfd);color:#fff" translate="no">${esc(p.body)}</div>`}
      <div class="body"><div><a href="#lookup/${p.profiles?.user_no}">@${esc(p.profiles?.username)}</a> ${p.kind === "text" ? `<span class="pill">${TXT_CAT[p.category] ?? ""}</span>` : ""} ${p.contest_id ? `<span class="pill approved">🏆 #${p.contest_id}</span>` : ""}</div>
        ${p.kind === "photo" && p.body ? `<div class="cap" translate="no">${esc(p.body)}</div>` : ""}
        <div class="muted small">❤️ ${num(p.likes_count)} 💬 ${num(p.comments_count)} ↗️ ${num(p.shares_count)} 🎁 ${num(p.gifts_coins_total)} · ${dt(p.created_at)}</div>
        ${p.reject_reason ? `<div class="small err">${esc(p.reject_reason)}</div>` : ""}
        <div class="actions">${p.status === "pending" ? `<button class="btn sm good" data-a="approve">অ্যাপ্রুভ ✅</button><button class="btn sm warn" data-a="reject">রিজেক্ট</button>`
          : p.status === "published" ? `<button class="btn sm warn" data-a="reject">রিজেক্ট</button><button class="btn sm bad" data-a="delete">ডিলিট</button>`
          : `<button class="btn sm good" data-a="restore">ফেরত আনুন</button>`}</div></div></div>`).join("") || (before ? "" : `<div class="empty">কিছু নেই</div>`));
  };
  $("#list").onclick = async (e) => {
    const b = e.target.closest("button[data-a]"); if (!b) return;
    const id = Number(b.closest(".vcard").dataset.id), a = b.dataset.a;
    let reason = null;
    if (a === "reject" || a === "delete") { reason = prompt("কারণ (ইউজার দেখবে):"); if (!reason) return; }
    await act(() => rpc("admin_post_action", { p_id: id, p_action: a, p_reason: reason }), "হয়েছে");
    b.closest(".vcard").remove();
  };
  $("#more").onclick = load;
  load();
};

// ---------- কম্পিটিশন ----------
const toLocalInput = (d) => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 16); };
routes.contests = async (id) => {
  loading();
  const { data: list } = await sb.from("contests").select("*").order("id", { ascending: false }).limit(50);
  if (id) {
    const c = id === "new" ? null : list.find((x) => x.id === Number(id));
    const { data: entries } = c ? await sb.from("posts").select("id,image_url,likes_count,comments_count,user_id,profiles!posts_user_id_fkey(username,user_no)").eq("contest_id", c.id).eq("status", "published").order("likes_count", { ascending: false }).limit(60) : { data: [] };
    view.innerHTML = `<h1><a href="#contests">←</a> ${c ? "কম্পিটিশন এডিট" : "নতুন কম্পিটিশন"}</h1>
      <div class="card" style="max-width:560px">
        <label class="small muted">নাম</label><input id="ct" value="${esc(c?.title ?? "")}" placeholder="যেমন: সেরা বিকেলের ছবি">
        <label class="small muted">বিবরণ / নিয়ম</label><textarea id="cd" rows="3">${esc(c?.description ?? "")}</textarea>
        <label class="small muted">পুরস্কার (৳) — বিজয়ী ঘোষণা করলে তার ব্যালেন্সে যোগ হবে</label><input id="cp" type="number" min="0" step="1" value="${c ? c.prize_paisa / 100 : 0}">
        <label class="small muted">শুরু</label><input id="cs" type="datetime-local" value="${toLocalInput(c?.starts_at ?? new Date())}">
        <label class="small muted">শেষ</label><input id="ce" type="datetime-local" value="${toLocalInput(c?.ends_at ?? Date.now() + 7 * 864e5)}">
        <label class="small muted">কভার ছবি</label><input id="cf" type="file" accept="image/*">${c?.cover_url ? `<img src="${esc(c.cover_url)}" style="width:100%;max-height:160px;object-fit:cover;border-radius:10px;margin-top:6px">` : ""}
        <label style="display:flex;gap:8px;align-items:center;margin-top:8px"><input id="ca" type="checkbox" style="width:auto" ${c?.is_active ?? true ? "checked" : ""}> চালু</label>
        <button class="btn good" id="csave" style="margin-top:10px">সেভ করুন</button></div>
      ${c ? `<h2>অংশগ্রহণকারী (${num(entries.length)}) — বেশি লাইক উপরে</h2>
        ${c.finished_at ? `<p class="muted">✅ শেষ হয়েছে ${dt(c.finished_at)}${c.winner_post_id ? " · বিজয়ী পোস্ট #" + c.winner_post_id : ""}</p>` : `<p class="muted small">বিজয়ী বেছে "বিজয়ী ঘোষণা" চাপুন — পুরস্কার সাথে সাথে তার ব্যালেন্সে যাবে এবং কম্পিটিশন বন্ধ হবে।</p>
          <button class="btn sm warn" data-win="">বিজয়ী ছাড়া শেষ করুন</button>`}
        <div class="videos" style="margin-top:10px">${entries.map((p, i) => `<div class="vcard"><img src="${esc(p.image_url)}" style="aspect-ratio:3/4" alt="">
          <div class="body"><b>#${i + 1}</b> <a href="#lookup/${p.profiles?.user_no}">@${esc(p.profiles?.username)}</a> ${c.winner_post_id === p.id ? "👑" : ""}
            <div class="muted small">❤️ ${num(p.likes_count)} 💬 ${num(p.comments_count)}</div>
            ${c.finished_at ? "" : `<div class="actions"><button class="btn sm good" data-win="${p.id}">👑 বিজয়ী ঘোষণা</button></div>`}</div></div>`).join("") || `<div class="empty">এখনো কেউ নেই</div>`}</div>` : ""}`;
    $("#csave").onclick = async () => {
      const title = $("#ct").value.trim(); if (title.length < 2) return toast("নাম লিখুন", true);
      let cover = c?.cover_url ?? null;
      const f = $("#cf").files[0];
      if (f) {
        const path = `${S.me.id}/contest-${Date.now()}.${(f.name.split(".").pop() || "jpg").toLowerCase()}`;
        const { error } = await sb.storage.from("photos").upload(path, f, { contentType: f.type || "image/jpeg" });
        if (error) return toast(errMsg(error), true);
        cover = sb.storage.from("photos").getPublicUrl(path).data.publicUrl;
      }
      try {
        const nid = await rpc("admin_save_contest", { p_id: c?.id ?? null, p_title: title, p_description: $("#cd").value, p_prize_paisa: Math.round(Number($("#cp").value || 0) * 100),
          p_starts: new Date($("#cs").value).toISOString(), p_ends: new Date($("#ce").value).toISOString(), p_active: $("#ca").checked, p_cover_url: cover });
        toast("সেভ হয়েছে"); location.hash = "#contests/" + nid;
      } catch (e) { toast(String(e.message).includes("BAD_DATES") ? "শেষের সময় শুরুর পরে হতে হবে" : errMsg(e), true); }
    };
    view.onclick = async (e) => {
      const b = e.target.closest("[data-win]"); if (!b) return;
      const pid = b.dataset.win ? Number(b.dataset.win) : null;
      if (!confirm(pid ? `পোস্ট #${pid}-কে বিজয়ী ঘোষণা করবেন? পুরস্কার ${tk(c.prize_paisa)} তার ব্যালেন্সে যাবে।` : "বিজয়ী ছাড়া কম্পিটিশন শেষ করবেন?")) return;
      await act(() => rpc("admin_finish_contest", { p_contest: c.id, p_post: pid }), "সম্পন্ন");
      routes.contests(String(c.id));
    };
    return;
  }
  view.innerHTML = `<h1>🏆 কম্পিটিশন</h1><div class="tabs"><a class="btn good" href="#contests/new">+ নতুন কম্পিটিশন</a></div>
    <div class="list">${(list ?? []).map((c) => {
      const open = c.is_active && !c.finished_at && new Date(c.starts_at) <= new Date() && new Date(c.ends_at) > new Date();
      return `<a class="item" href="#contests/${c.id}" style="display:block;text-decoration:none"><div class="top"><b>${esc(c.title)}</b>
        <span class="pill ${open ? "paid" : c.finished_at ? "" : "pending"}">${open ? "চলছে" : c.finished_at ? "শেষ" : c.is_active ? "শুরু হয়নি/সময় শেষ" : "বন্ধ"}</span></div>
        <div class="muted small">পুরস্কার ${tk(c.prize_paisa)} · ${dt(c.starts_at)} → ${dt(c.ends_at)}</div></a>`;
    }).join("") || `<div class="empty">কোনো কম্পিটিশন নেই — "+ নতুন কম্পিটিশন" চাপুন</div>`}</div>`;
};

// ---------- লাইভ সাপোর্ট (ইউজার ও হোস্ট আলাদা) ----------
routes.support = async (arg = "user") => {
  const [kind, uid] = String(arg).split(":");
  const title = kind === "host" ? "🎤 হোস্ট সাপোর্ট" : "🎧 ইউজার সাপোর্ট";
  if (uid) return supportThread(kind, uid, title);
  const status = sessionStorage.getItem("supStatus") || "open";
  view.innerHTML = `<h1>${title}</h1>
    <div class="tabs"><a class="btn sm ${status === "open" ? "on" : ""}" data-s="open">খোলা</a><a class="btn sm ${status === "closed" ? "on" : ""}" data-s="closed">সমাধান হয়েছে</a>
      <a class="btn sm" href="#support/${kind === "host" ? "user" : "host"}">${kind === "host" ? "🎧 ইউজার সাপোর্টে যান" : "🎤 হোস্ট সাপোর্টে যান"}</a></div>
    <div id="list" class="list"><div class="empty">লোড হচ্ছে…</div></div>
    <div id="tgBox" style="margin-top:18px"></div>`;
  view.querySelectorAll("[data-s]").forEach((b) => (b.onclick = () => { sessionStorage.setItem("supStatus", b.dataset.s); routes.support(kind); }));
  try {
    const rows = await rpc("admin_support_threads", { p_kind: kind, p_status: status });
    $("#list").innerHTML = rows.length ? rows.map((t) => `<a class="item" href="#support/${kind}:${t.user_id}" style="text-decoration:none;color:inherit">
      <div class="top"><b>${flag(t.country_code)} ${t.user_no} @${esc(t.username)}</b>${t.unread_admin ? `<span class="pill rejected">${t.unread_admin} নতুন</span>` : `<span class="muted small">${dt(t.last_at)}</span>`}</div>
      <div class="muted small" translate="no">${esc(t.last_body ?? "")}</div></a>`).join("")
      : `<div class="empty">${status === "open" ? "কোনো খোলা মেসেজ নেই 🎉" : "কিছু নেই"}</div>`;
  } catch (e) { $("#list").innerHTML = `<div class="empty err">${esc(errMsg(e))}</div>`; }
  telegramSetup($("#tgBox"));
};

async function supportThread(kind, uid, title) {
  view.innerHTML = `<h1><a href="#support/${kind}" style="text-decoration:none">←</a> ${title}</h1><div id="thr"><div class="empty">লোড হচ্ছে…</div></div>`;
  const [{ data: p }, msgs, { data: t }] = await Promise.all([
    sb.from("profiles").select("id,user_no,username,full_name,country_code,account_type,status").eq("id", uid).maybeSingle(),
    rpc("admin_support_open", { p_user: uid }).catch(() => []),
    sb.from("support_threads").select("status").eq("user_id", uid).maybeSingle(),
  ]);
  refreshBadges();
  const closed = t?.status === "closed";
  $("#thr").innerHTML = `<div class="card" style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
      <div><b translate="no">${esc(p?.full_name ?? "")}</b> @${esc(p?.username ?? "")} · ID <a href="#lookup/${p?.user_no}">${p?.user_no}</a> ${flag(p?.country_code)} ${p?.account_type === "host" ? '<span class="pill approved">হোস্ট</span>' : ""}</div>
      <button class="btn sm ${closed ? "" : "good"}" id="stBtn">${closed ? "↩️ আবার খুলুন" : "✅ সমাধান হয়েছে"}</button></div>
    <div class="sup-list" id="sl">${msgs.slice().reverse().map((m) => `<div class="sup ${m.from_admin ? "adm" : ""}"><div translate="no">${esc(m.body)}</div>
      <span>${m.from_admin ? (m.via === "telegram" ? "✈️ টেলিগ্রাম থেকে" : "🛡️ অ্যাডমিন") : "👤 ইউজার"} · ${dt(m.created_at)}</span></div>`).join("") || `<div class="empty">কোনো মেসেজ নেই</div>`}</div>
    <form id="rf" class="card" style="display:flex;gap:8px;align-items:flex-end"><textarea id="rb" rows="2" placeholder="উত্তর লিখুন…" style="flex:1;min-height:44px"></textarea><button class="btn good">পাঠান</button></form>
    <div class="toolbar"><a class="btn sm" href="#lookup/${p?.user_no}">🔎 ইউজারের সব তথ্য</a><a class="btn sm" href="#coins/${p?.user_no}">🪙 কয়েন পাঠান</a></div>`;
  const sl = $("#sl"); sl.scrollTop = sl.scrollHeight;
  $("#stBtn").onclick = async () => { await act(() => rpc("admin_support_status", { p_user: uid, p_status: closed ? "open" : "closed" }), "হয়েছে"); supportThread(kind, uid, title); };
  $("#rf").onsubmit = async (e) => {
    e.preventDefault();
    const body = $("#rb").value.trim(); if (!body) return;
    const b = e.submitter; b.disabled = true;
    try { await rpc("admin_support_reply", { p_user: uid, p_body: body }); supportThread(kind, uid, title); }
    catch (er) { toast(errMsg(er), true); b.disabled = false; }
  };
}

async function telegramSetup(box) {
  const st = await rpc("admin_telegram_status").catch(() => null);
  if (!st) return;
  box.innerHTML = `<h2>✈️ টেলিগ্রাম দিয়ে উত্তর</h2>
    <div class="card">
      <p class="small">চালু করলে ইউজার ও হোস্টের সাপোর্ট মেসেজ আপনার টেলিগ্রামে আসবে। টেলিগ্রামে মেসেজটিতে <b>Reply</b> করে লিখলেই উত্তর অ্যাপে ইউজারের কাছে চলে যাবে।</p>
      <div class="kv"><div>বট</div><div>${st.bot ? "@" + esc(st.bot) : "—"}</div><div>অবস্থা</div><div>${st.linked ? "✅ চালু (আপনার টেলিগ্রাম যুক্ত)" : st.has_token ? "⏳ বট আছে, এখনো যুক্ত হয়নি" : "❌ বন্ধ"}</div></div>
      <ol class="small" style="margin:10px 0 6px;padding-left:18px">
        <li>টেলিগ্রামে <b>@BotFather</b> খুলে <code>/newbot</code> লিখুন, একটি নাম ও ইউজারনেম দিন (যেমন ReelsEnjoySupportBot)।</li>
        <li>BotFather যে <b>token</b> দেবে (123456:ABC... এরকম) সেটা নিচে বসিয়ে "সেভ ও চালু করুন" চাপুন।</li>
        <li>এরপর যে লিংক আসবে সেটা খুলে টেলিগ্রামে <b>Start</b> চাপুন — আপনার টেলিগ্রাম যুক্ত হয়ে যাবে।</li></ol>
      <div class="row" style="flex-wrap:nowrap;gap:8px"><input id="tgTok" placeholder="Bot token" autocomplete="off"><button class="btn good" id="tgSave" style="flex:none">সেভ ও চালু করুন</button></div>
      ${st.bot && st.link_code && !st.linked ? `<p><a class="btn" href="https://t.me/${esc(st.bot)}?start=${esc(st.link_code)}" target="_blank" rel="noopener">👉 টেলিগ্রামে Start চাপুন</a></p>` : ""}
      ${st.linked ? `<button class="btn sm" id="tgTest">পরীক্ষা মেসেজ পাঠান</button>` : ""}
      <p class="muted small" style="margin-top:10px">ইউজারদের জন্য সাপোর্ট টেলিগ্রাম ইউজারনেম ও উত্তরের সময় <a href="#rules">ইনকাম রুলস</a> পেজের "লাইভ সাপোর্ট" অংশে বসান।</p>
    </div>`;
  $("#tgSave").onclick = async (e) => {
    const tok = $("#tgTok").value.trim();
    if (!/^\d+:[\w-]{20,}$/.test(tok)) return toast("সঠিক Bot token দিন", true);
    e.target.disabled = true;
    try {
      await rpc("admin_set_private_config", { p_key: "telegram_bot_token", p_value: tok });
      const { data, error } = await sb.functions.invoke("support-telegram", { body: { action: "setup" } });
      if (error || !data?.ok) throw new Error(data?.error ?? error?.message ?? "FAILED");
      toast("✅ বট চালু হয়েছে — এখন টেলিগ্রামে Start চাপুন");
      window.open(data.link, "_blank");
      telegramSetup(box);
    } catch (er) { toast(String(er.message).includes("BAD_TOKEN") ? "Token ভুল — BotFather থেকে আবার কপি করুন" : errMsg(er), true); e.target.disabled = false; }
  };
  $("#tgTest")?.addEventListener("click", async () => {
    const { data } = await sb.functions.invoke("support-telegram", { body: { action: "test" } });
    toast(data?.ok ? "✅ টেলিগ্রামে পরীক্ষা মেসেজ গেছে" : "পাঠানো যায়নি", !data?.ok);
  });
}

// ---------- ডিভাইস (কোন মোবাইল, একই মোবাইলে কয়টি অ্যাকাউন্ট) ----------
routes.devices = async (arg = "") => {
  const shared = arg === "shared", userNo = /^\d+$/.test(arg) ? Number(arg) : null;
  view.innerHTML = `<h1>📱 ডিভাইস</h1>
    <p class="muted small">ইউজার নতুন অ্যাপ (APK) খুললে তার মোবাইলের ব্র্যান্ড, মডেল ও Android ভার্সন এখানে আসে। একই মোবাইলে একাধিক অ্যাকাউন্ট খোলা হলে লাল দেখাবে — আর সেই নতুন অ্যাকাউন্টের রেফার বোনাস অটোমেটিক বাতিল হয়।</p>
    <div id="dst" class="grid"></div>
    <div class="toolbar"><input id="dq" type="number" inputmode="numeric" placeholder="ইউজার ID দিয়ে খুঁজুন" value="${userNo ?? ""}"><button class="btn" id="dgo">খুঁজুন</button></div>
    <div class="tabs"><a class="btn sm ${!shared && !userNo ? "on" : ""}" href="#devices">সব ডিভাইস</a><a class="btn sm ${shared ? "on" : ""}" href="#devices/shared">⚠️ একই মোবাইলে একাধিক অ্যাকাউন্ট</a></div>
    <div id="list" class="list"><div class="empty">লোড হচ্ছে…</div></div>`;
  $("#dgo").onclick = () => { const v = $("#dq").value.trim(); location.hash = v ? "#devices/" + v : "#devices"; };
  $("#dq").onkeydown = (e) => e.key === "Enter" && $("#dgo").click();
  rpc("admin_device_stats").then((st) => {
    $("#dst").innerHTML = `<div class="card stat"><div class="k">মোট মোবাইল</div><div class="v">${num(st.devices)}</div></div>
      <div class="card stat ${st.shared ? "alert" : ""}"><div class="k">একাধিক অ্যাকাউন্টের মোবাইল</div><div class="v">${num(st.shared)}</div></div>
      <div class="card stat"><div class="k">বাতিল রেফার</div><div class="v">${num(st.blocked_refs)}</div></div>
      <div class="card"><div class="k muted small">জনপ্রিয় মডেল</div><div class="small">${(st.models || []).map((m) => `${esc(m.name)} <b>${num(m.devices)}</b>`).join(" · ") || "—"}</div></div>`;
  }).catch(() => {});
  try {
    const rows = await rpc("admin_devices", { p_only_shared: shared, p_user_no: userNo });
    $("#list").innerHTML = rows.length ? rows.map((d) => `<div class="item" style="${d.accounts > 1 ? "border-color:#7a2530" : ""}">
      <div class="top"><b>📱 ${esc(d.brand ?? "")} ${esc(d.model ?? "")}</b>${d.accounts > 1 ? `<span class="pill rejected">${num(d.accounts)}টি অ্যাকাউন্ট</span>` : `<span class="pill">১টি অ্যাকাউন্ট</span>`}</div>
      <div class="muted small">${esc(d.os ?? "")} · অ্যাপ v${esc(d.app_version ?? "?")} · শেষ ব্যবহার ${dt(d.last_seen)} · ডিভাইস কোড ${esc(String(d.device_hash).slice(0, 8))}</div>
      <div class="table-wrap" style="margin-top:6px"><table><tr><th>ID</th><th>ইউজার</th><th>প্রথম খুলেছে</th><th>রেফার</th></tr>
        ${(d.users || []).map((u) => `<tr><td><a href="#lookup/${u.user_no}">${u.user_no}</a></td><td>@${esc(u.username)}${u.status !== "active" ? ' <span class="pill rejected">ব্লক</span>' : ""}</td>
          <td class="small">${dt(u.first_seen)}</td>
          <td class="small">${u.referred_by ? `${u.referred_by}-এর রেফার · ${u.ref_ok ? "✅ সফল" : u.ref_blocked ? "❌ বাতিল" : "⏳"}` : "—"}</td></tr>`).join("")}</table></div></div>`).join("")
      : `<div class="empty">${userNo ? "এই ইউজার এখনো নতুন অ্যাপ থেকে লগইন করেনি" : "এখনো কোনো ডিভাইস নেই — ইউজাররা নতুন APK খুললে দেখা যাবে"}</div>`;
  } catch (e) { $("#list").innerHTML = `<div class="empty err">${esc(errMsg(e))}</div>`; }
};

// ---------- অ্যাপ আপডেট (বাধ্যতামূলক / ঐচ্ছিক) ----------
routes.appupdate = async () => {
  view.innerHTML = `<h1>📲 অ্যাপ আপডেট</h1><div class="empty">লোড হচ্ছে…</div>`;
  const keys = ["latest_app_build", "min_app_build", "apk_url", "update_message", "play_latest_build", "play_min_build"];
  const [{ data }, vers] = await Promise.all([sb.from("settings").select("key,value").in("key", keys), rpc("admin_app_versions").catch(() => [])]);
  const S2 = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
  const latest = Number(S2.latest_app_build || 0), min = Number(S2.min_app_build || 0);
  const forced = latest && min >= latest;
  view.innerHTML = `<h1>📲 অ্যাপ আপডেট</h1>
    <div class="grid"><div class="card stat"><div class="k">সর্বশেষ ভার্সন</div><div class="v">1.0.${latest}</div></div>
      <div class="card stat ${forced ? "alert" : ""}"><div class="k">আপডেট</div><div class="v" style="font-size:18px">${forced ? "🔒 বাধ্যতামূলক" : min ? "1.0." + min + "-এর নিচে বাধ্যতামূলক" : "ঐচ্ছিক"}</div></div></div>
    <div class="card">
      <p class="small">নতুন APK বের হলে ইউজার অ্যাপ খুললেই আপডেটের স্ক্রিন দেখবে। "বাধ্যতামূলক" হলে আপডেট না করে অ্যাপ খুলতে পারবে না। "আপডেট করুন" চাপলে অ্যাপের ভেতরেই নতুন APK ডাউনলোড হয়ে ইনস্টল স্ক্রিন খোলে।</p>
      <label class="small">সর্বশেষ বিল্ড নম্বর (1.0.X-এর X)</label><input id="ul" type="number" value="${latest}">
      <label class="small">এর নিচের ভার্সন খুলবে না (বাধ্যতামূলক)</label><input id="um" type="number" value="${min}">
      <label class="small">APK লিংক</label><input id="uu" value="${esc(S2.apk_url ?? "")}">
      <label class="small">ইউজারকে বার্তা</label><textarea id="ums" rows="2">${esc(S2.update_message ?? "")}</textarea>
      <div class="toolbar"><button class="btn good" id="usave">সেভ</button><button class="btn warn" id="uforce">🔒 সবার জন্য বাধ্যতামূলক করুন</button><button class="btn" id="usoft">ঐচ্ছিক করুন</button></div>
    </div>
    <h2>▶️ Google Play ভার্সন</h2>
    <div class="card">
      <p class="small">Play Store থেকে ইনস্টল করা অ্যাপের জন্য আলাদা নম্বর। Play Console-এ নতুন AAB দিয়ে Google রিভিউ শেষ হওয়ার <b>পরে</b> এখানে নম্বর বাড়াবেন। আগে বাড়ালে ইউজার Play Store-এ গিয়ে আপডেট পাবে না। "আপডেট করুন" চাপলে Play Store খোলে।</p>
      <label class="small">Play-এ সর্বশেষ বিল্ড নম্বর (০ = আপডেট স্ক্রিন বন্ধ)</label><input id="pl" type="number" value="${Number(S2.play_latest_build || 0)}">
      <label class="small">এর নিচের Play ভার্সন খুলবে না (০ = বাধ্যতামূলক নয়)</label><input id="pm" type="number" value="${Number(S2.play_min_build || 0)}">
      <div class="toolbar"><button class="btn good" id="psave">Play নম্বর সেভ</button></div>
    </div>
    <h2>কে কোন ভার্সন ব্যবহার করছে</h2>
    <div class="table-wrap"><table><tr><th>ভার্সন</th><th>ইউজার</th></tr>${vers.map((v) => `<tr><td>${esc(v.app_version)}${Number(String(v.app_version).split(".")[2]) < latest ? ' <span class="pill pending">পুরনো</span>' : ""}</td><td>${num(v.users)}</td></tr>`).join("") || `<tr><td colspan="2" class="muted">ডেটা নেই (v1.0.6+ থেকে গণনা হয়)</td></tr>`}</table></div>`;
  const save = async (over = {}) => {
    const vals = { latest_app_build: Number($("#ul").value) || 0, min_app_build: Number($("#um").value) || 0, apk_url: $("#uu").value.trim(), update_message: $("#ums").value.trim(), ...over };
    for (const [k, v] of Object.entries(vals)) await rpc("admin_set_setting", { p_key: k, p_value: v });
  };
  $("#usave").onclick = () => act(() => save(), "সেভ হয়েছে").then(() => routes.appupdate());
  $("#uforce").onclick = () => { if (confirm("পুরনো ভার্সনের সবাইকে আপডেট করতে বাধ্য করবেন?")) act(() => save({ min_app_build: Number($("#ul").value) || 0 }), "বাধ্যতামূলক করা হয়েছে").then(() => routes.appupdate()); };
  $("#psave").onclick = () => act(async () => { await rpc("admin_set_setting", { p_key: "play_latest_build", p_value: Number($("#pl").value) || 0 });
    await rpc("admin_set_setting", { p_key: "play_min_build", p_value: Number($("#pm").value) || 0 }); }, "সেভ হয়েছে").then(() => routes.appupdate());
  $("#usoft").onclick = () => act(() => save({ min_app_build: 0 }), "ঐচ্ছিক করা হয়েছে").then(() => routes.appupdate());
};

// ---------- অ্যাকাউন্ট ডিলিট রিকোয়েস্ট ----------
routes.deletions = async () => {
  view.innerHTML = `<h1>🗑️ অ্যাকাউন্ট ডিলিট রিকোয়েস্ট</h1>
    <p class="muted small">ইউজার অ্যাপ থেকে ডিলিটের অনুরোধ করলে এখানে দেখাবে। ৭ দিন পর অটোমেটিক ডিলিট হয় (তার মধ্যে ইউজার বাতিল করতে পারে)। চাইলে এখনই ডিলিট করতে পারেন। ডিলিটে প্রোফাইল, কনটেন্ট, মেসেজ, ফোন ও ইমেইল মুছে যায়; শুধু টাকার লেনদেনের হিসাব থাকে।</p>
    <div id="list" class="list"><div class="empty">লোড হচ্ছে…</div></div>`;
  try {
    const rows = await rpc("admin_deletion_requests");
    $("#list").innerHTML = rows.length ? rows.map((r) => `<div class="item" data-id="${r.id}">
      <div class="top"><b><a href="#lookup/${r.user_no}">${r.user_no}</a> @${esc(r.username)}</b><span class="muted small">অনুরোধ: ${dt(r.requested_at)}</span></div>
      <div class="small">ব্যালেন্স ${taka(r.earning_paisa)} · পেন্ডিং ${taka(r.pending_paisa)} · কয়েন ${num(r.coin_balance)}</div>
      <div class="actions"><button class="btn sm bad" data-del>এখনই ডিলিট করুন</button></div></div>`).join("") : `<div class="empty">কোনো অনুরোধ নেই</div>`;
    $("#list").onclick = async (e) => {
      const b = e.target.closest("[data-del]"); if (!b) return;
      const it = b.closest(".item");
      if (!confirm("এই অ্যাকাউন্ট স্থায়ীভাবে ডিলিট করবেন? এটা আর ফেরানো যাবে না।")) return;
      await act(() => rpc("admin_delete_account", { p_user: it.dataset.id }), "ডিলিট হয়েছে");
      it.remove(); refreshBadges();
    };
  } catch (e) { $("#list").innerHTML = `<div class="empty err">${esc(errMsg(e))}</div>`; }
};

// ---------- ইনকাম রুলস ----------
routes.rules = async (kind = "user") => {
  if (kind === "host") return routes.hostRules();
  loading();
  const [{ data: st }, { data: tiers }, { data: ads }] = await Promise.all([
    sb.from("settings").select("*"), sb.from("referral_tiers").select("*").order("referrals"), sb.from("ad_placements").select("*").eq("key", "rewarded_points").maybeSingle(),
  ]);
  const S = Object.fromEntries((st ?? []).map((x) => [x.key, x.value]));
  const row = (key, label, kind) => {
    const v = S[key];
    const shown = kind === "taka" ? Number(v) / 100 : v;
    if (kind === "text") return `<div class="item" data-key="${key}" data-kind="text"><div class="top"><b>${label}</b></div>
      <textarea name="v" rows="4" translate="no">${esc(v ?? "")}</textarea><button class="btn sm good" data-save>সেভ</button></div>`;
    return `<div class="item" data-key="${key}" data-kind="${kind}"><div class="top"><b>${label}</b></div>
      <div class="row" style="flex-wrap:nowrap">${kind === "bool"
        ? `<select name="v"><option value="true" ${v === true ? "selected" : ""}>চালু</option><option value="false" ${v === false ? "selected" : ""}>বন্ধ</option></select>`
        : `<input name="v" type="number" step="${kind === "taka" ? "0.01" : "1"}" min="0" value="${esc(shown)}">${kind === "taka" ? '<span class="muted">৳</span>' : ""}`}
        <button class="btn sm good" data-save>সেভ</button></div></div>`;
  };
  view.innerHTML = `<h1>💰 ইনকাম রুলস</h1>${rulesTabs("user")}
    <p class="muted small">👤 সাধারণ ইউজারদের (এবং সবার জন্য সাধারণ) নিয়ম। হোস্টদের আয়ের রেট আলাদা — "হোস্ট ইনকাম রুলস" কার্ডে চাপুন। এখানে বদলালে সাথে সাথে অ্যাপের "কীভাবে আয় করবেন" অংশেও বদলে যাবে। টাকার ঘরগুলো সরাসরি টাকায় লিখুন।</p>
    <h2>🎬 ক্রিয়েটর (ভিডিও বানালে)</h2><div class="list">
      ${row("view_rate_paisa_per_1000", "প্রতি ১০০০ ভিউতে", "taka")}
      ${row("like_rate_paisa", "প্রতি লাইকে", "taka")}
      ${row("comment_rate_paisa", "প্রতি কমেন্টকারীতে", "taka")}
      ${row("creator_daily_view_cap_paisa", "ভিউ থেকে দিনে সর্বোচ্চ আয়", "taka")}
      <div class="item"><b>গিফট থেকে</b><div class="muted small">প্রতিটা গিফটের ক্রিয়েটর % <a href="#gifts">গিফট পেজে</a> সেট করুন</div></div>
    </div>
    <h2>👀 দর্শক (ভিডিও দেখলে)</h2><div class="list">
      ${row("watch_points", "প্রতি ভিডিও দেখায় পয়েন্ট", "num")}
      ${row("viewer_daily_points_cap", "দিনে সর্বোচ্চ পয়েন্ট (ভিডিও দেখে)", "num")}
      ${row("point_value_paisa", "১ পয়েন্টের দাম", "taka")}
      ${row("points_convert_min", "কমপক্ষে কত পয়েন্ট হলে টাকায় নেওয়া যাবে", "num")}
      <div class="item"><b>অ্যাড দেখে পয়েন্ট</b><div class="muted small">দর্শক ${num(ads?.viewer_points)} · ক্রিয়েটর ${num(ads?.creator_points)} · দিনে ${num(ads?.daily_cap)} বার — <a href="#ads">অ্যাড পেজে</a> বদলান</div></div>
    </div>
    <h2>🤝 রেফার</h2><div class="list">
      ${row("referral_enabled", "রেফার ইনকাম", "bool")}
      ${row("referral_bonus_paisa", "প্রতি সফল রেফারে রেফারকারী পাবে", "taka")}
      ${row("referral_welcome_points", "নতুন ইউজার স্বাগত পয়েন্ট পাবে", "num")}
      ${row("referral_min_views", "রেফার সফল হতে নতুন ইউজারকে কতটি ভিডিও দেখতে হবে", "num")}
      ${row("referral_block_same_device", "একই মোবাইলে আগে অন্য অ্যাকাউন্ট থাকলে রেফার বাতিল", "bool")}
      ${row("referral_require_device", "রেফার সফল হতে নতুন ইউজারকে অ্যাপ (APK) থেকে লগইন করতে হবে", "bool")}
    </div>
    <h2>🏆 রেফার বোনাস ধাপ</h2>
    <p class="muted small">যেমন: ১০ জন সফল রেফার হলে একবার ৳৫০ বাড়তি বোনাস। প্রতিটা ধাপ একজন ইউজার একবারই পাবে।</p>
    <div class="table-wrap"><table id="tt"><tr><th class="num">কতজন রেফার</th><th class="num">বোনাস (৳)</th><th>চালু</th><th></th></tr>
      ${(tiers ?? []).map((t) => `<tr data-id="${t.id}"><td><input name="referrals" type="number" min="1" value="${t.referrals}"></td><td><input name="bonus" type="number" step="0.01" min="0" value="${t.bonus_paisa / 100}"></td>
        <td><input name="is_active" type="checkbox" ${t.is_active ? "checked" : ""} style="width:auto"></td><td><button class="btn sm good" data-ts>সেভ</button> <button class="btn sm bad" data-td>মুছুন</button></td></tr>`).join("")}
      <tr data-id="new"><td><input name="referrals" type="number" min="1" placeholder="যেমন 200"></td><td><input name="bonus" type="number" step="0.01" min="0" placeholder="যেমন 2000"></td>
        <td><input name="is_active" type="checkbox" checked style="width:auto"></td><td><button class="btn sm" data-ts>যোগ করুন</button></td></tr></table></div>
    <h2>📤 আপলোড, জেল, হোস্ট ও প্রিমিয়াম</h2><div class="list">
      ${row("daily_upload_limit", "নতুন ইউজার দিনে কয়টি ভিডিও আপলোড করতে পারবে (কারো জন্য আলাদা করতে ইউজার খুঁজুন পেজে যান)", "num")}
      ${row("jail_release_coins", "জেল থেকে মুক্ত হতে ডিফল্ট কয়েন", "num")}
      ${row("host_auto_approve", "হোস্ট আবেদন অটো অনুমোদন", "bool")}
      ${row("premium_default_coins", "প্রিমিয়াম ভিডিও দেখার ডিফল্ট কয়েন", "num")}
      ${row("premium_creator_pct", "প্রিমিয়াম আনলকের কত % ক্রিয়েটর পাবে", "num")}
      ${row("premium_upload_hosts_only", "শুধু হোস্টরা প্রিমিয়াম ভিডিও দিতে পারবে", "bool")}
      ${row("premium_download_coins", "প্রিমিয়াম ভিডিও ডাউনলোড করতে কত কয়েন লাগবে (০ = প্রিমিয়াম ডাউনলোড বন্ধ; ক্রিয়েটর প্রিমিয়ামের % পাবে)", "num")}
      ${row("premium_notice", "প্রিমিয়াম আপলোডের নোটিশ (হোস্টরা আপলোডের সময় দেখবে)", "text")}
      ${row("cashin_notice", "কয়েন কেনার পেজের নোটিশ (সব ইউজার নম্বরের নিচে দেখবে)", "text")}
    </div>
    <h2>🎁 নতুন ইউজার বোনাস ও শেয়ার</h2><div class="list">
      ${row("welcome_bonus_enabled", "নতুন ইউজার প্রথমবার অ্যাপ খুললে বোনাস পাবে (একটি মোবাইলে একবারই)", "bool")}
      ${row("welcome_bonus_paisa", "নতুন ইউজারের বোনাস", "taka")}
      ${row("share_link", "শেয়ারের সাথে যাওয়া অ্যাপ ডাউনলোড লিংক", "text")}
    </div>
    <h2>⬇️ ভিডিও ডাউনলোড</h2><div class="list">
      ${row("downloads_enabled", "ইউজাররা ভিডিও ডাউনলোড করতে পারবে (লোগো + @username ওয়াটারমার্কসহ, প্রিমিয়াম ছাড়া)", "bool")}
      ${row("watermark_text", "ওয়াটারমার্কের লেখা (যেমন Reels Enjoy)", "text")}
    </div>
    <h2>🎧 লাইভ সাপোর্ট</h2><div class="list">
      ${row("support_enabled", "লাইভ সাপোর্ট চালু", "bool")}
      ${row("support_telegram", "ইউজারদের জন্য সাপোর্ট টেলিগ্রাম ইউজারনেম (যেমন @ReelsEnjoySupport, খালি রাখলে দেখাবে না)", "text")}
      ${row("support_hours", "উত্তরের সময়ের লেখা (সাপোর্ট পেজে দেখাবে)", "text")}
      ${row("support_email", "সাপোর্ট ইমেইল", "text")}
    </div>
    <h2>🖼️ ফটো, ✍️ টেক্সট আর্নিং ও কম্পিটিশন</h2><div class="list">
      ${row("post_like_rate_paisa", "প্রতি লাইকে পোস্টের মালিক পাবে", "taka")}
      ${row("post_comment_rate_paisa", "প্রতি কমেন্টকারীতে পাবে", "taka")}
      ${row("post_share_rate_paisa", "প্রতি শেয়ারে পাবে", "taka")}
      ${row("post_daily_cap_paisa", "ফটো/লেখা থেকে দিনে সর্বোচ্চ আয়", "taka")}
      ${row("post_daily_limit", "দিনে কয়টি ফটো/লেখা পোস্ট করা যাবে", "num")}
      ${row("post_auto_approve", "ফটো/লেখা সাথে সাথে প্রকাশ (বন্ধ করলে আপনি অ্যাপ্রুভ করবেন)", "bool")}
      ${row("text_max_lines", "লেখায় সর্বোচ্চ লাইন", "num")}
      ${row("text_max_chars", "লেখায় সর্বোচ্চ অক্ষর", "num")}
      ${row("text_notice", "টেক্সট আর্নিং নোটিশ", "text")}
    </div>
    <h2>📖 স্টোরি</h2><div class="list">
      ${row("stories_enabled", "স্টোরি চালু", "bool")}
      ${row("story_daily_limit", "একজন দিনে কয়টি স্টোরি দিতে পারবে", "num")}
      ${row("story_max_sec", "ভিডিও স্টোরির সর্বোচ্চ সেকেন্ড", "num")}
    </div>
    <h2>💬 মেসেজ</h2><div class="list">
      ${row("dm_enabled", "ইউজাররা একে অপরকে মেসেজ দিতে পারবে", "bool")}
    </div>
    <h2>💸 উইথড্র</h2><div class="list">
      ${row("withdraw_min_paisa", "সর্বনিম্ন উইথড্র", "taka")}
      ${row("withdraw_cooldown_days", "কত দিন পরপর উইথড্র", "num")}
      ${row("pending_hold_hours", "আয় কত ঘণ্টা পর উইথড্রযোগ্য হবে", "num")}
    </div>`;
  view.onclick = async (e) => {
    const b = e.target.closest("[data-save]");
    if (b) {
      const it = b.closest(".item"), raw = it.querySelector("[name=v]").value, kind = it.dataset.kind;
      const value = kind === "text" ? raw : kind === "bool" ? raw === "true" : kind === "taka" ? Math.round(Number(raw) * 100) : Math.round(Number(raw));
      if (kind !== "bool" && kind !== "text" && (isNaN(value) || value < 0)) return toast("সঠিক সংখ্যা দিন", true);
      await act(() => rpc("admin_set_setting", { p_key: it.dataset.key, p_value: value }), "সেভ হয়েছে");
      return;
    }
    const tr = e.target.closest("tr[data-id]");
    if (!tr) return;
    const id = tr.dataset.id;
    if (e.target.closest("[data-td]")) {
      if (!confirm("এই ধাপ মুছবেন?")) return;
      const { error } = await sb.from("referral_tiers").delete().eq("id", Number(id));
      if (error) return toast(errMsg(error), true);
      return routes.rules();
    }
    if (e.target.closest("[data-ts]")) {
      const r = { referrals: Number(tr.querySelector("[name=referrals]").value), bonus_paisa: Math.round(Number(tr.querySelector("[name=bonus]").value) * 100),
        is_active: tr.querySelector("[name=is_active]").checked };
      if (!r.referrals || r.referrals < 1 || isNaN(r.bonus_paisa)) return toast("কতজন ও বোনাস দিন", true);
      const { error } = id === "new" ? await sb.from("referral_tiers").insert(r) : await sb.from("referral_tiers").update(r).eq("id", Number(id));
      if (error) return toast(String(error.message).includes("duplicate") ? "এই সংখ্যার ধাপ আগেই আছে" : errMsg(error), true);
      toast("সেভ হয়েছে");
      if (id === "new") routes.rules();
    }
  };
};

const rulesTabs = (on) => `<div class="tcards">
  <a class="tcard u ${on === "user" ? "on" : ""}" href="#rules/user"><span>👤</span><div><b>ইউজার ইনকাম রুলস</b><small>সাধারণ ইউজার, দর্শক, রেফার, উইথড্র</small></div></a>
  <a class="tcard h ${on === "host" ? "on" : ""}" href="#rules/host"><span>🎤</span><div><b>হোস্ট ইনকাম রুলস</b><small>হোস্টের আলাদা রেট ও কয়েন সেলার</small></div></a></div>`;

// ---------- হোস্ট ইনকাম রুলস (settings: host_<key>) ----------
routes.hostRules = async () => {
  loading();
  const { data: st } = await sb.from("settings").select("key,value");
  const S = Object.fromEntries((st ?? []).map((x) => [x.key, x.value]));
  const row = (key, label, kind, userKey) => {
    const v = S[key], shown = kind === "taka" ? Number(v ?? 0) / 100 : v;
    const uv = userKey ? S[userKey] : undefined;
    const hint = uv === undefined ? "" : `<span class="muted small">ইউজারের রেট: ${kind === "taka" ? taka(uv) : esc(uv)}${kind === "pct" ? "%" : ""}</span>`;
    return `<div class="item" data-key="${key}" data-kind="${kind}"><div class="top"><b>${label}</b>${hint}</div>
      <div class="row" style="flex-wrap:nowrap">${kind === "bool"
        ? `<select name="v"><option value="true" ${v === true ? "selected" : ""}>চালু</option><option value="false" ${v === false ? "selected" : ""}>বন্ধ</option></select>`
        : `<input name="v" type="number" step="${kind === "taka" ? "0.01" : "1"}" min="0" value="${esc(shown ?? 0)}">${kind === "taka" ? '<span class="muted">৳</span>' : kind === "pct" ? '<span class="muted">%</span>' : ""}`}
        <button class="btn sm good" data-save>সেভ</button></div></div>`;
  };
  view.innerHTML = `<h1>💰 ইনকাম রুলস</h1>${rulesTabs("host")}
    <p class="muted small">🎤 শুধু হোস্টদের জন্য রেট। হোস্ট ভিডিও/ফটো দিলে এই রেটে আয় হবে, সাধারণ ইউজার পাবে ইউজার রেটে। শুরুতে দুটো একই ছিল — এখানে বদলালে শুধু হোস্টদের বদলাবে।</p>
    <h2>🎬 ভিডিও থেকে আয়</h2><div class="list">
      ${row("host_view_rate_paisa_per_1000", "প্রতি ১০০০ ভিউতে", "taka", "view_rate_paisa_per_1000")}
      ${row("host_like_rate_paisa", "প্রতি লাইকে", "taka", "like_rate_paisa")}
      ${row("host_comment_rate_paisa", "প্রতি কমেন্টকারীতে", "taka", "comment_rate_paisa")}
      ${row("host_creator_daily_view_cap_paisa", "ভিউ থেকে দিনে সর্বোচ্চ আয়", "taka", "creator_daily_view_cap_paisa")}
    </div>
    <h2>🎁 গিফট ও 👑 প্রিমিয়াম</h2><div class="list">
      ${row("host_gift_creator_pct", "গিফটের কত % হোস্ট পাবে (০ = প্রতিটি গিফটের নিজের % — গিফট পেজে)", "pct")}
      ${row("host_premium_creator_pct", "প্রিমিয়াম আনলকের কত % হোস্ট পাবে", "pct", "premium_creator_pct")}
    </div>
    <h2>🖼️ ফটো ও ✍️ লেখা থেকে আয়</h2><div class="list">
      ${row("host_post_like_rate_paisa", "প্রতি লাইকে", "taka", "post_like_rate_paisa")}
      ${row("host_post_comment_rate_paisa", "প্রতি কমেন্টকারীতে", "taka", "post_comment_rate_paisa")}
      ${row("host_post_share_rate_paisa", "প্রতি শেয়ারে", "taka", "post_share_rate_paisa")}
      ${row("host_post_daily_cap_paisa", "ফটো/লেখা থেকে দিনে সর্বোচ্চ আয়", "taka", "post_daily_cap_paisa")}
    </div>
    <h2>🤝 রেফার</h2><div class="list">
      ${row("host_referral_bonus_paisa", "হোস্ট প্রতি সফল রেফারে পাবে", "taka", "referral_bonus_paisa")}
    </div>
    <h2>💰 কয়েন সেলার (হোস্ট + এডমিন)</h2>
    <p class="muted small">যে হোস্টকে আপনি সেলার বানাবেন, সে নিজের কয়েন থেকে ইউজারদের কাছে টাকার বিনিময়ে কয়েন বিক্রি করতে পারবে। প্রতি বিক্রিতে কমিশন হিসেবে বাড়তি কয়েন তার স্টক থেকে কাটা যাবে (যেমন ৫% হলে ১০০০ বিক্রিতে ১০৫০ কাটা)। সেলার বানাতে <a href="#sellers">কয়েন সেলার পেজে</a> যান।</p>
    <div class="list">
      ${row("coin_seller_enabled", "কয়েন সেলার চালু", "bool")}
      ${row("seller_commission_pct", "প্রতিটি বিক্রিতে এডমিন কমিশন (সবার জন্য, আলাদা সেলারের জন্য সেলার পেজে)", "pct")}
    </div>`;
  view.onclick = async (e) => {
    const b = e.target.closest("[data-save]"); if (!b) return;
    const it = b.closest(".item"), raw = it.querySelector("[name=v]").value, kind = it.dataset.kind;
    const value = kind === "bool" ? raw === "true" : kind === "taka" ? Math.round(Number(raw) * 100) : Math.round(Number(raw));
    if (kind !== "bool" && (isNaN(value) || value < 0 || (kind === "pct" && value > 100))) return toast("সঠিক সংখ্যা দিন", true);
    await act(() => rpc("admin_set_setting", { p_key: it.dataset.key, p_value: value }), "সেভ হয়েছে");
  };
};

// ---------- 🔴 লাইভ ও 📞 কল ----------
routes.live = async () => {
  view.innerHTML = `<h1>🔴 লাইভ ও 📞 কল</h1><div class="empty">লোড হচ্ছে…</div>`;
  let d;
  try { d = await rpc("admin_live_overview"); } catch (e) { view.innerHTML = `<h1>🔴 লাইভ ও 📞 কল</h1><div class="empty err">${esc(errMsg(e))}</div>`; return; }
  const { data: st } = await sb.from("settings").select("key,value").in("key", ["live_enabled", "live_hosts_only", "live_max_cohosts", "calls_enabled", "call_video_coins_per_min", "call_audio_coins_per_min", "call_host_pct", "live_gift_host_pct", "coin_price_paisa", "pk_enabled", "pk_duration_sec", "pk_winner_bonus_pct", "pk_bonus_cap_paisa", "party_enabled", "party_hosts_only", "party_max_seats", "party_gift_pct", "live_rules_notice"]);
  const pks = (await rpc("admin_pk_recent").catch(() => [])) ?? [];
  const S2 = Object.fromEntries((st ?? []).map((x) => [x.key, x.value]));
  const cp = Number(S2.coin_price_paisa || 100);
  const row = (key, label, kind) => `<div class="item" data-key="${key}" data-kind="${kind}"><div class="top"><b>${label}</b></div><div class="row" style="flex-wrap:nowrap">${kind === "bool"
    ? `<select name="v"><option value="true" ${S2[key] === true ? "selected" : ""}>চালু</option><option value="false" ${S2[key] === false ? "selected" : ""}>বন্ধ</option></select>`
    : kind === "text" ? `<textarea name="v" rows="3" style="flex:1">${esc(S2[key] ?? "")}</textarea>`
    : `<input name="v" type="number" min="0" value="${esc(S2[key] ?? 0)}">${kind === "pct" ? '<span class="muted">%</span>' : kind === "coin" ? '<span class="muted">🪙</span>' : ""}`}<button class="btn sm good" data-save>সেভ</button></div></div>`;
  const t = d.today;
  view.innerHTML = `<h1>🔴 লাইভ ও 📞 কল</h1>
    <div class="grid"><div class="card stat"><div class="k">২৪ ঘণ্টায় লাইভ</div><div class="v">${num(t.lives)}</div></div>
      <div class="card stat"><div class="k">লাইভে গিফট</div><div class="v">🪙 ${num(t.live_gift_coins)}</div></div>
      <div class="card stat"><div class="k">কলের মিনিট</div><div class="v">${num(t.call_minutes)}</div></div>
      <div class="card stat"><div class="k">কল থেকে কয়েন</div><div class="v">🪙 ${num(t.call_coins)}</div></div></div>
    <h2>🔴 এখন লাইভে (${d.live.length})</h2>
    <div class="table-wrap">${d.live.length ? `<table><tr><th>হোস্ট</th><th>শিরোনাম</th><th class="num">দর্শক</th><th class="num">সর্বোচ্চ</th><th class="num">গিফট</th><th>শুরু</th><th></th></tr>
      ${d.live.map((r) => `<tr><td><a href="#lookup/${r.user_no}">@${esc(r.username)}</a></td><td translate="no">${esc(r.title ?? "")}</td><td class="num">${num(r.viewers)}</td><td class="num">${num(r.peak_viewers)}</td>
        <td class="num">🪙 ${num(r.gift_coins)}</td><td>${dt(r.started_at)}</td><td><button class="btn sm bad" data-end="${r.id}">⏹ বন্ধ করুন</button></td></tr>`).join("")}</table>` : `<div class="empty">এখন কেউ লাইভে নেই</div>`}</div>
    <h2>⚙️ নিয়ম</h2>
    <p class="muted small">১ কয়েন = ৳${(cp / 100).toFixed(2)}। যেমন ভিডিও কল ${num(S2.call_video_coins_per_min)} 🪙/মিনিট = ৳${((S2.call_video_coins_per_min * cp) / 100).toFixed(2)}/মিনিট, যার ${num(S2.call_host_pct)}% হোস্ট পাবে, বাকিটা আপনার। কোনো হোস্টের জন্য আলাদা রেট দিতে "ইউজার খুঁজুন" পেজে যান।</p>
    <div class="list" id="lrules">
      ${row("live_rules_notice", "📢 লাইভ ও পার্টিতে সবার আগে দেখানো নিয়মের নোটিশ", "text")}
      ${row("live_enabled", "লাইভ চালু", "bool")}
      ${row("live_hosts_only", "শুধু অনুমোদিত হোস্টরা লাইভ করতে পারবে", "bool")}
      ${row("live_max_cohosts", "লাইভে একসাথে কতজন অতিথি যোগ দিতে পারবে", "num")}
      ${row("live_gift_host_pct", "লাইভে গিফটের কত % হোস্ট পাবে (০ = গিফটের নিজস্ব %)", "pct")}
      ${row("calls_enabled", "হোস্টকে প্রাইভেট কল চালু", "bool")}
      ${row("call_video_coins_per_min", "ভিডিও কলে প্রতি মিনিটে কয়েন", "coin")}
      ${row("call_audio_coins_per_min", "অডিও কলে প্রতি মিনিটে কয়েন", "coin")}
      ${row("call_host_pct", "কল থেকে হোস্ট কত % পাবে", "pct")}
      ${row("pk_enabled", "⚔️ PK ব্যাটল চালু", "bool")}
      ${row("pk_duration_sec", "⚔️ PK কত সেকেন্ড চলবে (৩০০ = ৫ মিনিট)", "num")}
      ${row("pk_winner_bonus_pct", "⚔️ বিজয়ী বোনাস: PK-তে পাওয়া গিফটের মূল্যের কত %", "pct")}
      ${row("pk_bonus_cap_paisa", "⚔️ সর্বোচ্চ বোনাস (পয়সা, ১০০ = ৳১)", "num")}
      ${row("party_enabled", "🎉 পার্টি (ভয়েস রুম) চালু", "bool")}
      ${row("party_hosts_only", "🎉 শুধু অনুমোদিত হোস্টরা পার্টি খুলতে পারবে", "bool")}
      ${row("party_max_seats", "🎉 পার্টিতে সর্বোচ্চ কতটি অতিথি সিট", "num")}
      ${row("party_gift_pct", "🎉 পার্টিতে গিফটের কত % যে গিফট পাবে সে পাবে (০ = লাইভের নিয়ম)", "pct")}
    </div>
    <h2>⚔️ সর্বশেষ PK</h2>
    <div class="table-wrap">${pks.length ? `<table><tr><th>শুরু</th><th>হোস্ট ১</th><th class="num">স্কোর</th><th>হোস্ট ২</th><th>বিজয়ী</th><th class="num">বোনাস</th></tr>
      ${pks.map((b) => `<tr><td>${dt(b.started_at)}</td><td><a href="#lookup/${b.a_no}">@${esc(b.a)}</a></td><td class="num">🪙 ${num(b.score_a)} : ${num(b.score_b)}</td><td><a href="#lookup/${b.b_no}">@${esc(b.b)}</a></td>
        <td>${b.status === "active" ? "🟢 চলছে" : b.winner ? "🏆 @" + esc(b.winner) : "🤝 ড্র"}</td><td class="num">${taka(b.bonus_paisa)}</td></tr>`).join("")}</table>` : `<div class="empty">এখনো কোনো PK হয়নি</div>`}</div>
    <h2>📞 সর্বশেষ কল</h2>
    <div class="table-wrap">${d.calls.length ? `<table><tr><th>সময়</th><th>কলার</th><th>হোস্ট</th><th>ধরন</th><th>অবস্থা</th><th class="num">মিনিট</th><th class="num">কয়েন</th><th class="num">হোস্ট পেল</th></tr>
      ${d.calls.map((c) => `<tr><td>${dt(c.created_at)}</td><td><a href="#lookup/${c.caller_no}">@${esc(c.caller)}</a></td><td><a href="#lookup/${c.host_no}">@${esc(c.host)}</a></td><td>${c.kind === "video" ? "📹" : "📞"}</td>
        <td>${{ ringing: "🔔 বাজছে", active: "🟢 চলছে", ended: "শেষ", missed: "ধরেনি", rejected: "কেটেছে", cancelled: "বাতিল" }[c.status] ?? c.status}${c.end_reason === "no_coins" ? " (কয়েন শেষ)" : ""}</td>
        <td class="num">${num(c.billed_minutes)}</td><td class="num">🪙 ${num(c.coins_charged)}</td><td class="num">${taka(c.host_paisa)}</td></tr>`).join("")}</table>` : `<div class="empty">এখনো কোনো কল হয়নি</div>`}</div>
    <h2>🔴 সর্বশেষ লাইভ</h2>
    <div class="table-wrap">${d.recent.length ? `<table><tr><th>হোস্ট</th><th>শুরু</th><th>সময়</th><th class="num">সর্বোচ্চ দর্শক</th><th class="num">মোট দর্শক</th><th class="num">গিফট</th><th class="num">হোস্ট পেল</th><th>বন্ধ</th></tr>
      ${d.recent.map((r) => `<tr><td><a href="#lookup/${r.user_no}">@${esc(r.username)}</a></td><td>${dt(r.started_at)}</td><td>${r.ended_at ? Math.round((new Date(r.ended_at) - new Date(r.started_at)) / 60000) + " মিনিট" : ""}</td>
        <td class="num">${num(r.peak_viewers)}</td><td class="num">${num(r.total_viewers)}</td><td class="num">🪙 ${num(r.gift_coins)}</td><td class="num">${taka(r.host_earned_paisa)}</td>
        <td>${{ host: "হোস্ট", admin: "অ্যাডমিন", timeout: "সংযোগ বিচ্ছিন্ন", restart: "আবার শুরু" }[r.ended_reason] ?? esc(r.ended_reason ?? "")}</td></tr>`).join("")}</table>` : `<div class="empty">এখনো কোনো লাইভ হয়নি</div>`}</div>`;
  view.onclick = async (e) => {
    const eb = e.target.closest("[data-end]");
    if (eb) { if (!confirm("এই লাইভ বন্ধ করবেন?")) return; try { await act(() => rpc("live_end", { p_room: Number(eb.dataset.end), p_reason: "admin" }), "লাইভ বন্ধ করা হয়েছে"); routes.live(); } catch { /* */ } return; }
    const b = e.target.closest("[data-save]"); if (!b) return;
    const it = b.closest(".item"), raw = it.querySelector("[name=v]").value, kind = it.dataset.kind;
    const value = kind === "bool" ? raw === "true" : kind === "text" ? raw.trim() : Math.round(Number(raw));
    if (kind !== "bool" && kind !== "text" && (isNaN(value) || value < 0 || (kind === "pct" && value > 100))) return toast("সঠিক সংখ্যা দিন", true);
    await act(() => rpc("admin_set_setting", { p_key: it.dataset.key, p_value: value }), "সেভ হয়েছে");
  };
};

// ---------- 🎵 মিউজিক লাইব্রেরি ----------
routes.music = async () => {
  view.innerHTML = `<h1>🎵 মিউজিক</h1>
    <div class="card" style="border-color:#7c2d12;background:#2a1408"><b>⚠️ কপিরাইট সতর্কতা</b>
      <p class="small" style="margin:6px 0 0">শুধু সেই গান দিন যেগুলোর অনুমতি আপনার আছে: নিজের বানানো, কিনে নেওয়া লাইসেন্স, বা রয়্যালটি-ফ্রি (যেমন Pixabay Music, YouTube Audio Library-র "No attribution" গান)। জনপ্রিয় সিনেমা/শিল্পীর গান অনুমতি ছাড়া দিলে Google Play অ্যাপ সরিয়ে দিতে পারে এবং কপিরাইট মামলা হতে পারে।</p></div>
    <div class="card" style="max-width:560px"><b>➕ নতুন গান যোগ করুন</b>
      <label>গানের ফাইল (MP3/M4A, সর্বোচ্চ 15MB)<input type="file" id="mf" accept="audio/*"></label>
      <audio id="ma" controls class="hidden" style="width:100%;margin-top:6px"></audio>
      <label>গানের নাম<input id="mt" maxlength="80" placeholder="যেমন: সুন্দর সকাল"></label>
      <label>শিল্পী (ঐচ্ছিক)<input id="mar" maxlength="60"></label>
      <label>ক্যাটাগরি (ঐচ্ছিক)<input id="mc" maxlength="30" list="mcats" placeholder="যেমন: রোমান্টিক, মজার, দুঃখের, ইসলামিক"><datalist id="mcats"></datalist></label>
      <button class="btn primary" id="mup">আপলোড করুন</button><div id="mpg" class="muted small"></div></div>
    <h2>গানের তালিকা</h2><div id="mlst" class="table-wrap"><div class="empty">লোড হচ্ছে…</div></div>`;
  let dur = null;
  $("#mf").onchange = () => {
    const f = $("#mf").files[0]; if (!f) return;
    const a = $("#ma"); a.src = URL.createObjectURL(f); a.classList.remove("hidden");
    a.onloadedmetadata = () => (dur = Math.round(a.duration || 0));
    if (!$("#mt").value) $("#mt").value = f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").slice(0, 80);
  };
  $("#mup").onclick = async (e) => {
    const f = $("#mf").files[0]; if (!f) return toast("গানের ফাইল বাছুন", true);
    if (f.size > 15 * 1048576) return toast("ফাইল 15MB-এর বেশি", true);
    if (!$("#mt").value.trim()) return toast("গানের নাম দিন", true);
    e.target.disabled = true; $("#mpg").textContent = "আপলোড হচ্ছে…";
    try {
      const ext = (f.name.split(".").pop() || "mp3").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp3";
      const path = `${Date.now()}.${ext}`;
      const { error } = await sb.storage.from("music").upload(path, f, { contentType: f.type || "audio/mpeg", upsert: false });
      if (error) throw error;
      const url = sb.storage.from("music").getPublicUrl(path).data.publicUrl;
      await rpc("admin_save_music", { p_id: null, p_title: $("#mt").value, p_artist: $("#mar").value, p_category: $("#mc").value, p_url: url, p_path: path, p_duration: dur, p_active: true, p_sort: 0 });
      toast("✅ গান যোগ হয়েছে"); routes.music();
    } catch (er) { toast(errMsg(er), true); e.target.disabled = false; $("#mpg").textContent = ""; }
  };
  const { data } = await sb.from("music").select("*").order("sort").order("id", { ascending: false });
  const rows = data ?? [];
  $("#mcats").innerHTML = [...new Set(rows.map((r) => r.category).filter(Boolean))].map((c) => `<option value="${esc(c)}">`).join("");
  $("#mlst").innerHTML = rows.length ? `<table><tr><th>গান</th><th>ক্যাটাগরি</th><th class="num">সময়</th><th class="num">ব্যবহার</th><th>অবস্থা</th><th></th></tr>
    ${rows.map((m) => `<tr><td><b translate="no">${esc(m.title)}</b><br><span class="muted small" translate="no">${esc(m.artist ?? "")}</span><audio src="${esc(m.url)}" controls preload="none" style="width:200px;height:32px;display:block;margin-top:4px"></audio></td>
      <td translate="no">${esc(m.category ?? "—")}</td><td class="num">${m.duration_sec ? `${Math.floor(m.duration_sec / 60)}:${String(m.duration_sec % 60).padStart(2, "0")}` : "—"}</td><td class="num">${num(m.uses_count)}</td>
      <td>${m.active ? '<span class="pill approved">চালু</span>' : '<span class="pill rejected">বন্ধ</span>'}</td>
      <td style="white-space:nowrap"><button class="btn sm" data-t="${m.id}">${m.active ? "বন্ধ" : "চালু"}</button> <button class="btn sm bad" data-d="${m.id}">মুছুন</button></td></tr>`).join("")}</table>`
    : `<div class="empty">এখনো কোনো গান নেই — উপর থেকে যোগ করুন</div>`;
  $("#mlst").onclick = async (e) => {
    const t = e.target.closest("[data-t]"), d = e.target.closest("[data-d]");
    if (t) { const m = rows.find((x) => x.id == t.dataset.t); try { await act(() => rpc("admin_save_music", { p_id: m.id, p_title: m.title, p_artist: m.artist, p_category: m.category, p_url: null, p_path: null, p_duration: null, p_active: !m.active, p_sort: m.sort }), "হয়েছে"); routes.music(); } catch { /* */ } }
    if (d) {
      if (!confirm("গানটি মুছবেন?")) return;
      const m = rows.find((x) => x.id == d.dataset.d);
      try { const r = await rpc("admin_delete_music", { p_id: m.id });
        if (r === "deleted" && m.path) await sb.storage.from("music").remove([m.path]).catch(() => {});
        toast(r === "deleted" ? "মুছে ফেলা হয়েছে" : "এই গান ব্যবহার হয়েছে, তাই শুধু বন্ধ করা হলো"); routes.music(); } catch (er) { toast(errMsg(er), true); }
    }
  };
};

// ---------- 📖 স্টোরি ----------
routes.stories = async () => {
  view.innerHTML = `<h1>📖 স্টোরি</h1><p class="muted small">গত ৩ দিনের স্টোরি। স্টোরি ২৪ ঘণ্টা পর নিজে থেকে লুকিয়ে যায়। নিয়ম ভাঙলে মুছে দিন।</p>
    <div id="sl" class="videos"><div class="empty">লোড হচ্ছে…</div></div>`;
  const rows = await rpc("admin_stories", { p_limit: 200 }).catch(() => []);
  const BG = { g1: "linear-gradient(135deg,#8b5cf6,#ec4899)", g2: "linear-gradient(135deg,#0ea5e9,#6366f1)", g3: "linear-gradient(135deg,#f59e0b,#ef4444)" };
  $("#sl").innerHTML = rows.length ? rows.map((x) => `<div class="vcard" data-id="${x.id}">
      ${x.kind === "photo" ? `<img src="${esc(x.media_url)}" style="width:100%;aspect-ratio:9/16;object-fit:cover" loading="lazy">`
        : x.kind === "video" ? `<video src="${esc(x.media_url)}" ${x.thumb_url ? `poster="${esc(x.thumb_url)}"` : ""} preload="none" controls playsinline style="width:100%;aspect-ratio:9/16"></video>`
        : `<div style="aspect-ratio:9/16;display:grid;place-items:center;padding:12px;text-align:center;color:#fff;font-weight:700;background:${BG[x.bg] ?? BG.g1}" translate="no">${esc(x.body ?? "")}</div>`}
      <div class="body"><div><a href="#lookup/${x.user_no}">@${esc(x.username)}</a> ${x.status === "removed" ? '<span class="pill rejected">মুছে ফেলা</span>' : new Date(x.expires_at) < Date.now() ? '<span class="pill">মেয়াদ শেষ</span>' : '<span class="pill approved">চলছে</span>'}</div>
        ${x.body && x.kind !== "text" ? `<div class="cap" translate="no">${esc(x.body)}</div>` : ""}
        <div class="muted small">👁 ${num(x.views)} · ${dt(x.created_at)}${x.music ? ` · 🎵 <span translate="no">${esc(x.music)}</span>` : ""}</div>
        ${x.status !== "removed" ? `<button class="btn sm bad" data-del="${x.id}">মুছুন</button>` : ""}</div></div>`).join("") : `<div class="empty">কোনো স্টোরি নেই</div>`;
  $("#sl").onclick = async (e) => {
    const b = e.target.closest("[data-del]"); if (!b || !confirm("স্টোরিটি মুছবেন?")) return;
    try { await act(() => rpc("delete_story", { p_id: Number(b.dataset.del) }), "মুছে ফেলা হয়েছে"); routes.stories(); } catch { /* */ }
  };
};

// ---------- #হ্যাশট্যাগ ----------
routes.hashtags = async (days = "7") => {
  days = ["1", "7", "30", "365"].includes(days) ? days : "7";
  view.innerHTML = `<h1>#️⃣ হ্যাশট্যাগ</h1>
    <p class="muted small">কোন #ট্যাগ ভাইরাল, কতজন ব্যবহার করছে। ট্যাগে চাপলে নিচে দেখাবে কে কে সেই ট্যাগ ব্যবহার করেছে। স্কোর = পোস্ট, ব্যবহারকারী, ভিউ ও লাইক মিলিয়ে।</p>
    <div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:10px">${[["1", "আজ"], ["7", "৭ দিন"], ["30", "৩০ দিন"], ["365", "১ বছর"]].map(([k, l]) => `<a class="btn sm ${k === days ? "primary" : ""}" href="#hashtags/${k}">${l}</a>`).join("")}</div>
    <div id="ht" class="table-wrap"><div class="empty">লোড হচ্ছে…</div></div>
    <h2 id="tuh" class="hidden"></h2><div id="tu" class="table-wrap"></div>`;
  const rows = await rpc("trending_tags", { p_days: Number(days), p_limit: 100 }).catch(() => []);
  $("#ht").innerHTML = rows.length ? `<table><tr><th>#</th><th>ট্যাগ</th><th class="num">পোস্ট</th><th class="num">ব্যবহারকারী</th><th class="num">ভিউ</th><th class="num">লাইক</th><th class="num">স্কোর</th></tr>
    ${rows.map((r, i) => `<tr data-tag="${esc(r.tag)}" style="cursor:pointer"><td>${i + 1}${i < 3 ? " 🔥" : ""}</td><td><b translate="no">#${esc(r.tag)}</b></td><td class="num">${num(r.posts)}</td><td class="num">${num(r.users)}</td>
      <td class="num">${num(r.views)}</td><td class="num">${num(r.likes)}</td><td class="num">${num(r.score)}</td></tr>`).join("")}</table>`
    : `<div class="empty">এই সময়ে কোনো ট্যাগ ব্যবহার হয়নি</div>`;
  $("#ht").onclick = async (e) => {
    const tr = e.target.closest("tr[data-tag]"); if (!tr) return;
    const tag = tr.dataset.tag;
    $("#tuh").classList.remove("hidden"); $("#tuh").innerHTML = `👥 <span translate="no">#${esc(tag)}</span> কে কে ব্যবহার করেছে`;
    $("#tu").innerHTML = `<div class="empty">লোড হচ্ছে…</div>`;
    const us = await rpc("admin_tag_users", { p_tag: tag }).catch(() => []);
    $("#tu").innerHTML = us.length ? `<table><tr><th>ID</th><th>ইউজার</th><th class="num">কতবার</th><th class="num">ভিউ</th><th>শেষ</th></tr>
      ${us.map((u) => `<tr><td><a href="#lookup/${u.user_no}">${u.user_no}</a></td><td>@${esc(u.username)}${u.account_type === "host" ? ' <span class="pill host">🎤</span>' : ""}</td><td class="num">${num(u.uses)}</td><td class="num">${num(u.views)}</td><td>${dt(u.last)}</td></tr>`).join("")}</table>`
      : `<div class="empty">কেউ নেই</div>`;
    $("#tuh").scrollIntoView({ behavior: "smooth" });
  };
};

// ---------- কয়েন সেলার (হোস্ট) ----------
routes.sellers = async () => {
  view.innerHTML = `<h1>💰 কয়েন সেলার</h1>
    <p class="muted small">সেলার হোস্টরা নিজের কয়েন থেকে ইউজারদের কাছে কয়েন বিক্রি করে, টাকা সরাসরি তারা নেয়। প্রতি বিক্রিতে কমিশন কয়েন তাদের স্টক থেকে কাটা যায় — অর্থাৎ সেলার আপনার কাছ থেকে কয়েন কিনে (Coin Sent / ক্যাশ-ইন) বিক্রি করবে, আপনাকে আলাদা করে টাকা দিতে হবে না।</p>
    <div class="card" style="max-width:520px"><b>➕ নতুন সেলার বানান</b>
      <label>হোস্টের ID নম্বর<input id="sn" type="number" inputmode="numeric" placeholder="যেমন 100005"></label>
      <div id="sw" class="muted small" style="min-height:1.3em"></div>
      <label>কমিশন % (খালি = সবার জন্য নির্ধারিত)<input id="sp" type="number" min="0" max="100" placeholder="ডিফল্ট"></label>
      <button class="btn primary" id="sadd">সেলার বানান</button></div>
    <h2>সেলার তালিকা</h2><div id="sl" class="table-wrap"><div class="empty">লোড হচ্ছে…</div></div>
    <h2>সর্বশেষ বিক্রি</h2><div id="ss" class="table-wrap"></div>`;
  let target = null, tm;
  $("#sn").oninput = () => { clearTimeout(tm); tm = setTimeout(async () => {
    target = null; const no = Number($("#sn").value); if (!no) return ($("#sw").textContent = "");
    const { data } = await sb.from("profiles").select("id,username,full_name,account_type,coin_seller").eq("user_no", no).maybeSingle();
    if (!data) return ($("#sw").innerHTML = `<span class="err">এই ID-তে কেউ নেই</span>`);
    if (data.account_type !== "host") return ($("#sw").innerHTML = `<span class="err">@${esc(data.username)} হোস্ট নয় — আগে <a href="#lookup/${no}">হোস্ট বানান</a></span>`);
    target = data; $("#sw").innerHTML = `✅ <b translate="no">${esc(data.full_name ?? "")}</b> @${esc(data.username)}${data.coin_seller ? " · আগে থেকেই সেলার" : ""}`;
  }, 350); };
  $("#sadd").onclick = async () => {
    if (!target) return toast("সঠিক হোস্ট ID দিন", true);
    const pv = $("#sp").value.trim();
    try { await act(() => rpc("admin_set_coin_seller", { p_user: target.id, p_on: true, p_pct: pv === "" ? null : Number(pv) }), "সেলার বানানো হয়েছে"); routes.sellers(); } catch { /* */ }
  };
  const [sellers, sales] = await Promise.all([rpc("admin_coin_sellers").catch(() => []), rpc("admin_coin_sales", { p_seller: null, p_limit: 100 }).catch(() => [])]);
  const { data: dp } = await sb.from("settings").select("value").eq("key", "seller_commission_pct").maybeSingle();
  $("#sl").innerHTML = (sellers ?? []).length ? `<table><tr><th>ID</th><th>সেলার</th><th class="num">স্টক</th><th class="num">কমিশন</th><th class="num">মোট বিক্রি</th><th class="num">৩০ দিনে</th><th class="num">আপনার কমিশন</th><th>শেষ বিক্রি</th><th></th></tr>
    ${sellers.map((x) => `<tr><td><a href="#lookup/${x.user_no}">${x.user_no}</a></td><td>@${esc(x.username)}<br><span class="muted small" translate="no">${esc(x.full_name ?? "")}</span></td>
      <td class="num">🪙 ${num(x.stock)}</td><td class="num">${x.pct ?? dp?.value ?? 5}%${x.pct == null ? ' <span class="muted small">(ডিফল্ট)</span>' : ""}</td>
      <td class="num">🪙 ${num(x.coins)}<br><span class="muted small">${num(x.sales)} বার</span></td><td class="num">🪙 ${num(x.coins_30d)}</td><td class="num"><b>🪙 ${num(x.commission)}</b></td>
      <td>${x.last_sale ? dt(x.last_sale) : "—"}</td>
      <td style="white-space:nowrap"><button class="btn sm" data-pct="${x.id}" data-cur="${x.pct ?? ""}">কমিশন</button> <a class="btn sm" href="#coins/${x.user_no}">🪙 স্টক দিন</a> <button class="btn sm bad" data-off="${x.id}">বাদ দিন</button></td></tr>`).join("")}</table>`
    : `<div class="empty">এখনো কোনো সেলার নেই</div>`;
  const tot = (sales ?? []).reduce((a, r) => [a[0] + Number(r.coins), a[1] + Number(r.commission)], [0, 0]);
  $("#ss").innerHTML = (sales ?? []).length ? `<table><tr><th>সময়</th><th>সেলার</th><th>ক্রেতা</th><th class="num">কয়েন</th><th class="num">কমিশন</th><th class="num">টাকা</th><th>নোট</th></tr>
    ${sales.map((r) => `<tr><td>${dt(r.created_at)}</td><td>@${esc(r.seller)}</td><td><a href="#lookup/${r.buyer_no}">@${esc(r.buyer)}</a></td><td class="num">🪙 ${num(r.coins)}</td>
      <td class="num">🪙 ${num(r.commission)}</td><td class="num">${r.taka_paisa ? taka(r.taka_paisa) : "—"}</td><td translate="no">${esc(r.note ?? "")}</td></tr>`).join("")}
    <tr><td colspan="3"><b>মোট (সর্বশেষ ১০০)</b></td><td class="num"><b>🪙 ${num(tot[0])}</b></td><td class="num"><b>🪙 ${num(tot[1])}</b></td><td colspan="2"></td></tr></table>` : `<div class="empty">এখনো কোনো বিক্রি নেই</div>`;
  $("#sl").onclick = async (e) => {
    const pb = e.target.closest("[data-pct]"), ob = e.target.closest("[data-off]");
    if (pb) {
      const v = prompt("এই সেলারের কমিশন % (খালি = ডিফল্ট)", pb.dataset.cur); if (v === null) return;
      const pct = v.trim() === "" ? null : Number(v);
      if (pct !== null && (isNaN(pct) || pct < 0 || pct > 100)) return toast("০–১০০ এর মধ্যে দিন", true);
      try { await act(() => rpc("admin_set_coin_seller", { p_user: pb.dataset.pct, p_on: true, p_pct: pct }), "সেভ হয়েছে"); routes.sellers(); } catch { /* */ }
    } else if (ob) {
      if (!confirm("এই হোস্টকে সেলার থেকে বাদ দেবেন? তার কয়েন তার কাছেই থাকবে।")) return;
      try { await act(() => rpc("admin_set_coin_seller", { p_user: ob.dataset.off, p_on: false, p_pct: null }), "বাদ দেওয়া হয়েছে"); routes.sellers(); } catch { /* */ }
    }
  };
};

// ---------- Coin Sent ----------
routes.coins = async (preNo) => {
  view.innerHTML = `<h1>🪙 Coin Sent</h1>
    <div class="card" style="max-width:520px">
      <label>ইউজারের ID নম্বর<input id="cn" type="number" inputmode="numeric" placeholder="যেমন 100001" value="${esc(preNo ?? "")}"></label>
      <div id="who2" class="muted small" style="min-height:1.4em;margin-top:6px"></div>
      <label>কত টাকার কয়েন<input id="ctk" type="number" inputmode="decimal" min="0" step="0.01" placeholder="যেমন 100"></label>
      <div class="row" style="margin-top:8px">${[50, 100, 500, 1000, 5000].map((x) => `<button class="btn sm" data-q="${x}">৳${num(x)}</button>`).join("")}</div>
      <label>কত কয়েন যাবে (রেট অনুযায়ী নিজে বসবে, চাইলে বদলাতে পারেন)<input id="cc" type="number" inputmode="numeric" min="1" placeholder="যেমন 1000"></label>
      <div id="crate" class="muted small"></div>
      <label>নোট (ইউজার দেখবে, ঐচ্ছিক)<input id="cnote" maxlength="120" placeholder="যেমন: বোনাস কয়েন"></label>
      <button class="btn primary" id="csend">কয়েন পাঠান</button>
      <p class="muted small">মনে রাখবেন: এই কয়েন দিয়ে ইউজার গিফট পাঠালে ক্রিয়েটর আসল টাকা আয় করবে, যা উইথড্র করা যায়।</p>
    </div>
    <h2>💰 কয়েনের দাম</h2>
    <div class="card" style="max-width:520px">
      <label>১ কয়েনের দাম (টাকা)<input id="cpr" type="number" inputmode="decimal" step="0.01" min="0.01" placeholder="যেমন 1"></label>
      <div id="cprInfo" class="muted small" style="margin-top:4px"></div>
      <label>সর্বনিম্ন কত টাকার কয়েন কেনা যাবে<input id="cmin" type="number" inputmode="numeric" min="1"></label>
      <button class="btn primary" id="cprSave">দাম সেভ করুন</button>
      <p class="muted small">⚠️ এই দামেই গিফট ও প্রিমিয়ামের টাকার হিসাব হয় (ক্রিয়েটর কত পাবে)। দাম কমালে ক্রিয়েটরের আয়ও কমবে।</p>
    </div>
    <h2>🔥 কয়েন অফার</h2>
    <p class="muted small">এখানে অফার যোগ করলে ইউজাররা অ্যাপে "কয়েন কিনুন" পেজে ও হোম পেজে অফার দেখবে। শেষ সময় পার হলে অফার নিজে থেকেই লুকিয়ে যাবে।</p>
    <div class="card" style="max-width:520px" id="ofForm">
      <input type="hidden" id="ofId">
      <label>অফারের নাম<input id="ofT" maxlength="60" placeholder="যেমন: ঈদ অফার"></label>
      <div class="row" style="gap:8px"><label style="flex:1">দাম (টাকা)<input id="ofP" type="number" inputmode="numeric" min="1" placeholder="100"></label>
        <label style="flex:1">কত কয়েন পাবে<input id="ofC" type="number" inputmode="numeric" min="1" placeholder="150"></label></div>
      <div id="ofInfo" class="muted small"></div>
      <label>ব্যাজ লেখা (ঐচ্ছিক)<input id="ofB" maxlength="24" placeholder="যেমন: +50% বোনাস"></label>
      <div class="row" style="gap:8px"><label style="flex:2">শেষ সময় (ঐচ্ছিক)<input id="ofE" type="datetime-local"></label>
        <label style="flex:1">ক্রম<input id="ofS" type="number" inputmode="numeric" value="0"></label></div>
      <label class="row" style="gap:6px;justify-content:flex-start"><input type="checkbox" id="ofA" checked style="width:auto"> চালু থাকবে</label>
      <div class="row" style="gap:8px"><button class="btn primary" id="ofSave">অফার যোগ করুন</button><button class="btn hidden" id="ofCancel">বাতিল</button></div>
    </div>
    <div id="ofList" class="table-wrap"></div>
    <h2>পাঠানো কয়েনের হিসাব</h2><div id="ch" class="table-wrap"></div>`;
  // ---- কয়েনের দাম ----
  const { data: st } = await sb.from("settings").select("key,value").in("key", ["coin_price_paisa", "min_cash_in_taka"]);
  const sv = Object.fromEntries((st ?? []).map((x) => [x.key, Number(x.value)]));
  let pricePaisa = sv.coin_price_paisa || 100;
  $("#cpr").value = (pricePaisa / 100).toString(); $("#cmin").value = sv.min_cash_in_taka ?? 20;
  const prInfo = () => { const p = Number($("#cpr").value); $("#cprInfo").textContent = p > 0 ? `৳১ = ${(1 / p).toFixed(2).replace(/\.00$/, "")} কয়েন · ৳১০০ = ${Math.floor(100 / p)} কয়েন` : ""; };
  $("#cpr").oninput = prInfo; prInfo();
  $("#cprSave").onclick = async () => {
    const pp = Math.round(Number($("#cpr").value) * 100), mn = Math.floor(Number($("#cmin").value));
    if (!(pp >= 1)) return toast("সঠিক দাম দিন (কমপক্ষে ৳0.01)", true);
    if (!(mn >= 1)) return toast("সর্বনিম্ন টাকা দিন", true);
    if (pp !== pricePaisa && !confirm(`১ কয়েনের দাম ৳${(pp / 100).toFixed(2)} করবেন? গিফট ও প্রিমিয়ামের আয়ের হিসাবও এই দামে হবে।`)) return;
    await act(async () => { await rpc("admin_set_setting", { p_key: "coin_price_paisa", p_value: pp }); await rpc("admin_set_setting", { p_key: "min_cash_in_taka", p_value: mn }); pricePaisa = pp; ofInfo(); rateLine(); fromTaka(); }, "সেভ হয়েছে");
  };
  // ---- অফার ----
  const ofInfo = () => {
    const p = Number($("#ofP").value), c = Number($("#ofC").value);
    if (!p || !c) { $("#ofInfo").textContent = ""; return; }
    const normal = Math.floor(p * 100 / pricePaisa), extra = c - normal;
    $("#ofInfo").innerHTML = `সাধারণ দামে ৳${p} = ${num(normal)} কয়েন · এই অফারে ${num(c)} কয়েন ${extra > 0 ? `<b style="color:#16a34a">(+${num(extra)} বেশি, ${Math.round(extra * 100 / Math.max(normal, 1))}% বোনাস)</b>` : extra < 0 ? `<b class="err">(সাধারণ দামের চেয়ে কম!)</b>` : ""}`;
  };
  ["#ofP", "#ofC"].forEach((q) => ($(q).oninput = ofInfo));
  const resetOf = () => { ["#ofId", "#ofT", "#ofP", "#ofC", "#ofB", "#ofE"].forEach((q) => ($(q).value = "")); $("#ofS").value = 0; $("#ofA").checked = true;
    $("#ofSave").textContent = "অফার যোগ করুন"; $("#ofCancel").classList.add("hidden"); ofInfo(); };
  $("#ofCancel").onclick = resetOf;
  const localDT = (iso) => { const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  let offers = [];
  const loadOf = async () => {
    offers = (await rpc("admin_coin_offers").catch(() => [])) ?? [];
    const now = Date.now();
    $("#ofList").innerHTML = offers.length ? `<table><tr><th>অফার</th><th class="num">দাম</th><th class="num">কয়েন</th><th>শেষ</th><th>অবস্থা</th><th class="num">বিক্রি</th><th></th></tr>
      ${offers.map((o) => { const ended = o.ends_at && new Date(o.ends_at) < now;
        return `<tr><td><b>${esc(o.title)}</b>${o.badge ? ` <span class="pill">${esc(o.badge)}</span>` : ""}</td><td class="num">৳${num(o.price_taka)}</td><td class="num">🪙 ${num(o.coins)}</td>
        <td>${o.ends_at ? dt(o.ends_at) : "—"}</td><td>${!o.active ? '<span class="pill rejected">বন্ধ</span>' : ended ? '<span class="pill">মেয়াদ শেষ</span>' : '<span class="pill approved">চালু</span>'}</td>
        <td class="num">${num(o.sold)}${o.pending ? ` <span class="muted small">(+${o.pending} পেন্ডিং)</span>` : ""}</td>
        <td style="white-space:nowrap"><button class="btn sm" data-oe="${o.id}">এডিট</button> <button class="btn sm" data-ot="${o.id}">${o.active ? "বন্ধ" : "চালু"}</button> <button class="btn sm danger" data-od="${o.id}">মুছুন</button></td></tr>`; }).join("")}</table>`
      : `<div class="empty">এখনো কোনো অফার নেই</div>`;
    view.querySelectorAll("[data-oe]").forEach((b) => (b.onclick = () => {
      const o = offers.find((x) => x.id == b.dataset.oe);
      $("#ofId").value = o.id; $("#ofT").value = o.title; $("#ofP").value = o.price_taka; $("#ofC").value = o.coins; $("#ofB").value = o.badge ?? "";
      $("#ofE").value = o.ends_at ? localDT(o.ends_at) : ""; $("#ofS").value = o.sort; $("#ofA").checked = o.active;
      $("#ofSave").textContent = "পরিবর্তন সেভ করুন"; $("#ofCancel").classList.remove("hidden"); ofInfo();
      $("#ofForm").scrollIntoView({ behavior: "smooth", block: "center" });
    }));
    view.querySelectorAll("[data-ot]").forEach((b) => (b.onclick = async () => {
      const o = offers.find((x) => x.id == b.dataset.ot);
      await act(() => rpc("admin_save_coin_offer", { p_id: o.id, p_title: o.title, p_coins: o.coins, p_price_taka: o.price_taka, p_badge: o.badge, p_active: !o.active, p_ends_at: o.ends_at, p_sort: o.sort }), o.active ? "অফার বন্ধ হয়েছে" : "অফার চালু হয়েছে");
      loadOf();
    }));
    view.querySelectorAll("[data-od]").forEach((b) => (b.onclick = async () => {
      if (!confirm("অফারটি মুছবেন?")) return;
      try { const r = await rpc("admin_delete_coin_offer", { p_id: Number(b.dataset.od) });
        toast(r === "disabled" ? "এই অফারে কেনা হয়েছে, তাই হিসাবের জন্য রেখে শুধু বন্ধ করা হলো" : "মুছে ফেলা হয়েছে"); } catch (er) { toast(errMsg(er), true); }
      loadOf();
    }));
  };
  $("#ofSave").onclick = async () => {
    const title = $("#ofT").value.trim(), price = Math.floor(Number($("#ofP").value)), coins = Math.floor(Number($("#ofC").value));
    if (!title) return toast("অফারের নাম দিন", true);
    if (!(price >= 1) || !(coins >= 1)) return toast("দাম ও কয়েন দিন", true);
    const ends = $("#ofE").value ? new Date($("#ofE").value).toISOString() : null;
    if (ends && new Date(ends) < Date.now()) return toast("শেষ সময় ভবিষ্যতের হতে হবে", true);
    try { await act(() => rpc("admin_save_coin_offer", { p_id: $("#ofId").value ? Number($("#ofId").value) : null, p_title: title, p_coins: coins, p_price_taka: price,
      p_badge: $("#ofB").value, p_active: $("#ofA").checked, p_ends_at: ends, p_sort: Math.floor(Number($("#ofS").value) || 0) }), "অফার সেভ হয়েছে");
      resetOf(); loadOf(); } catch { /* toast shown */ }
  };
  loadOf();
  let target = null;
  const look = async () => {
    target = null;
    const no = Number($("#cn").value);
    if (!no) { $("#who2").textContent = ""; return; }
    const { data } = await sb.from("profiles").select("id,username,full_name,status").eq("user_no", no).maybeSingle();
    if (!data) { $("#who2").innerHTML = `<span class="err">এই ID-তে কোনো ইউজার নেই</span>`; return; }
    const { data: w } = await sb.from("wallets").select("coin_balance").eq("user_id", data.id).maybeSingle();
    target = data;
    $("#who2").innerHTML = `✅ <b translate="no">${esc(data.full_name ?? "")}</b> @${esc(data.username)} · এখন আছে 🪙 ${num(w?.coin_balance)} ${data.status === "banned" ? '<span class="pill banned">ব্যান</span>' : ""}`;
  };
  let tm; $("#cn").oninput = () => { clearTimeout(tm); tm = setTimeout(look, 350); };
  if (preNo) look();
  const rateLine = () => { $("#crate").textContent = `বর্তমান রেট: ১ কয়েন = ৳${(pricePaisa / 100).toFixed(2)} · ৳১০০ = ${num(Math.floor(10000 / pricePaisa))} কয়েন`; };
  const fromTaka = () => { const t = Number($("#ctk").value); $("#cc").value = t > 0 ? Math.floor(Math.round(t * 100) / pricePaisa) : ""; rateLine(); };
  const fromCoins = () => { const c = Number($("#cc").value); $("#ctk").value = c > 0 ? +(c * pricePaisa / 100).toFixed(2) : ""; };
  $("#ctk").oninput = fromTaka; $("#cc").oninput = fromCoins; rateLine();
  view.querySelectorAll("[data-q]").forEach((b) => (b.onclick = () => { $("#ctk").value = b.dataset.q; fromTaka(); }));
  const loadHist = async () => {
    const { data } = await sb.from("transactions").select("amount,note,created_at,balance_after,profiles!transactions_user_id_fkey(username,user_no)")
      .eq("type", "admin_coin_grant").order("id", { ascending: false }).limit(100);
    const total = (data ?? []).reduce((a, r) => a + Number(r.amount), 0);
    $("#ch").innerHTML = data?.length ? `<table><tr><th>সময়</th><th>ID</th><th>ইউজার</th><th class="num">কয়েন</th><th>নোট</th></tr>
      ${data.map((r) => `<tr><td>${dt(r.created_at)}</td><td>${r.profiles?.user_no ?? ""}</td><td>@${esc(r.profiles?.username)}</td><td class="num">🪙 ${num(r.amount)}</td><td>${esc(r.note ?? "")}</td></tr>`).join("")}
      <tr><td colspan="3"><b>মোট (সর্বশেষ ১০০)</b></td><td class="num"><b>🪙 ${num(total)}</b></td><td></td></tr></table>` : `<div class="empty">এখনো কোনো কয়েন পাঠানো হয়নি</div>`;
  };
  loadHist();
  $("#csend").onclick = async (e) => {
    if (!target) return toast("সঠিক ID নম্বর দিন", true);
    const coins = Math.floor(Number($("#cc").value));
    if (!coins || coins < 1) return toast("কয়েনের সংখ্যা দিন", true);
    if (!confirm(`@${target.username}-কে 🪙 ${num(coins)} কয়েন (৳${(coins * pricePaisa / 100).toFixed(2)}) পাঠাবেন?`)) return;
    e.target.disabled = true;
    try {
      const r = await rpc("admin_send_coins", { p_user_no: Number($("#cn").value), p_coins: coins, p_note: $("#cnote").value });
      toast(`পাঠানো হয়েছে ✅ এখন আছে 🪙 ${num(r.coin_balance)}`);
      $("#cc").value = ""; $("#ctk").value = ""; $("#cnote").value = "";
      look(); loadHist();
    } catch (er) { toast(errMsg(er), true); }
    e.target.disabled = false;
  };
};

// ---------- লক ফোল্ডার ----------
routes.vault = async (userNo) => {
  view.innerHTML = `<h1>🔒 লক ফোল্ডার</h1>
    <p class="muted small">ইউজারদের লক ফোল্ডারে রাখা ছবি ও ভিডিও। নিয়ম ভঙ্গকারী ফাইল মুছে দিতে পারেন।</p>
    <div class="toolbar"><input id="vu" type="number" inputmode="numeric" placeholder="ইউজার ID দিয়ে খুঁজুন (খালি = সবার)" value="${esc(userNo ?? "")}"><button class="btn" id="vgo">দেখুন</button></div>
    <div id="vs" class="muted small" style="margin-bottom:10px"></div>
    <div id="vl" class="videos"></div><div style="margin-top:12px"><button class="btn sm hidden" id="vmore">আরও</button></div>`;
  let before = null, uid = null;
  const load = async (reset) => {
    if (reset) {
      before = null; uid = null; $("#vl").innerHTML = ""; $("#vs").textContent = "";
      const no = Number($("#vu").value);
      if (no) {
        const { data } = await sb.from("profiles").select("id,username").eq("user_no", no).maybeSingle();
        if (!data) { $("#vl").innerHTML = `<div class="empty">এই ID-তে কোনো ইউজার নেই</div>`; return; }
        uid = data.id;
        const { data: used } = await sb.rpc("vault_used", { p_user: uid });
        $("#vs").textContent = `@${data.username} · ব্যবহার ${(Number(used) / 1048576).toFixed(1)} MB`;
      }
    }
    let q = sb.from("vault_files").select("*, profiles!vault_files_user_id_fkey(username,user_no)").order("id", { ascending: false }).limit(24);
    if (uid) q = q.eq("user_id", uid);
    if (before) q = q.lt("id", before);
    const { data, error } = await q;
    if (error) return toast(errMsg(error), true);
    if (!data.length && !before) { $("#vl").innerHTML = `<div class="empty">কোনো ফাইল নেই</div>`; return; }
    before = data[data.length - 1]?.id ?? before;
    $("#vmore").classList.toggle("hidden", data.length < 24);
    const { data: urls } = await sb.storage.from("vault").createSignedUrls(data.map((f) => f.path), 3600);
    const map = Object.fromEntries((urls ?? []).map((u) => [u.path, u.signedUrl]));
    $("#vl").insertAdjacentHTML("beforeend", data.map((f) => `<div class="vcard" data-id="${f.id}" data-path="${esc(f.path)}">
      ${f.kind === "video" ? `<video src="${esc(map[f.path] ?? "")}" preload="metadata" controls playsinline></video>` : `<img src="${esc(map[f.path] ?? "")}" loading="lazy" alt="">`}
      <div class="body"><div>${f.profiles?.user_no ?? ""} · @${esc(f.profiles?.username)}</div>
        <div class="muted small" translate="no">${esc(f.name ?? "")}</div>
        <div class="muted small">${(f.size_bytes / 1048576).toFixed(1)} MB · ${dt(f.created_at)}</div>
        <div class="actions"><button class="btn sm bad" data-del>মুছুন</button></div></div></div>`).join(""));
  };
  $("#vl").onclick = async (e) => {
    const b = e.target.closest("[data-del]"); if (!b) return;
    const card = b.closest(".vcard");
    if (!confirm("ফাইলটি স্থায়ীভাবে মুছবেন?")) return;
    try {
      await sb.storage.from("vault").remove([card.dataset.path]);
      await rpc("vault_remove", { p_id: Number(card.dataset.id) });
      card.remove(); toast("মুছে ফেলা হয়েছে");
    } catch (er) { toast(errMsg(er), true); }
  };
  $("#vgo").onclick = () => load(true);
  $("#vmore").onclick = () => load(false);
  load(true);
};

// ---------- moderation ----------
routes.moderation = async () => {
  view.innerHTML = `<h1>কনটেন্ট রিপোর্ট</h1><div id="rep" class="list"></div><h2>অ্যাডমিন অ্যাকশন লগ</h2><div id="log" class="table-wrap"></div>`;
  const [{ data: reps }, { data: logs }] = await Promise.all([
    sb.from("content_reports").select("*, profiles!content_reports_reporter_id_fkey(username)").eq("status", "open").order("id").limit(100),
    sb.from("audit_logs").select("*, profiles!audit_logs_admin_id_fkey(username)").order("id", { ascending: false }).limit(100),
  ]);
  $("#rep").innerHTML = reps?.length ? reps.map((r) => `<div class="item">
      <div class="top"><b>${esc(r.target_type)} #${esc(r.target_id)}</b><span class="muted small">${dt(r.created_at)}</span></div>
      <div class="meta">কারণ: ${esc(r.reason)} · রিপোর্ট করেছে @${esc(r.profiles?.username)}</div>
      <div class="actions">
        ${r.target_type === "video" ? `<button class="btn sm bad" data-v="${esc(r.target_id)}" data-id="${r.id}">ভিডিও ডিলিট</button>` : ""}
        ${r.target_type === "user" ? `<a class="btn sm" href="#user/${esc(r.target_id)}">ইউজার দেখুন</a>` : ""}
        <button class="btn sm good" data-r="resolved" data-id="${r.id}">সমাধান হয়েছে</button>
        <button class="btn sm" data-r="dismissed" data-id="${r.id}">বাতিল</button>
      </div></div>`).join("") : `<div class="empty">কোনো খোলা রিপোর্ট নেই</div>`;
  $("#rep").onclick = async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const id = Number(b.dataset.id);
    if (b.dataset.v) {
      const reason = prompt("ডিলিটের কারণ:", "কমিউনিটি নিয়ম ভঙ্গ");
      if (!reason) return;
      await act(() => rpc("admin_video_action", { p_id: Number(b.dataset.v), p_action: "delete", p_reason: reason }));
      await act(() => rpc("admin_report_resolve", { p_id: id, p_status: "resolved" }), "ভিডিও ডিলিট ও রিপোর্ট সমাধান");
    } else {
      await act(() => rpc("admin_report_resolve", { p_id: id, p_status: b.dataset.r }), "হয়েছে");
    }
    routes.moderation(); refreshBadges();
  };
  $("#log").innerHTML = logs?.length ? `<table><tr><th>সময়</th><th>অ্যাডমিন</th><th>কাজ</th><th>টার্গেট</th><th>কারণ</th></tr>
    ${logs.map((l) => `<tr><td>${dt(l.created_at)}</td><td>@${esc(l.profiles?.username)}</td><td>${esc(l.action)}</td><td>${esc(l.target_type ?? "")} ${esc(l.target_id ?? "")}</td><td>${esc(l.reason ?? "")}</td></tr>`).join("")}</table>`
    : `<div class="empty">লগ নেই</div>`;
};

// ---------- gifts ----------
routes.gifts = async () => {
  loading();
  const [{ data: cats }, { data: gifts }] = await Promise.all([
    sb.from("gift_categories").select("*").order("sort_order"),
    sb.from("gifts").select("*").order("sort_order"),
  ]);
  const catOpts = (sel) => cats.map((c) => `<option value="${c.id}" ${c.id === sel ? "selected" : ""}>${esc(c.name)}</option>`).join("");
  view.innerHTML = `<h1>গিফট ম্যানেজমেন্ট</h1>
    <p class="muted small">১ কয়েন = সেটিংসের coin_price_paisa। ক্রিয়েটর % বাদে বাকিটা প্ল্যাটফর্ম কমিশন।</p>
    <div class="table-wrap"><table id="gt"><tr><th>আইকন</th><th>নাম</th><th>ক্যাটাগরি</th><th class="num">কয়েন</th><th class="num">ক্রিয়েটর %</th><th class="num">ক্রম</th><th>চালু</th><th></th></tr>
    ${gifts.map((g) => `<tr data-id="${g.id}"><td><input name="icon" value="${esc(g.icon)}" style="width:60px"></td><td><input name="name" value="${esc(g.name)}"></td>
      <td><select name="category_id">${catOpts(g.category_id)}</select></td><td><input name="coin_price" type="number" min="1" value="${g.coin_price}"></td>
      <td><input name="creator_share_pct" type="number" min="0" max="100" value="${g.creator_share_pct}"></td><td><input name="sort_order" type="number" value="${g.sort_order}"></td>
      <td><input name="is_active" type="checkbox" ${g.is_active ? "checked" : ""} style="width:auto"></td><td><button class="btn sm good" data-save>সেভ</button></td></tr>`).join("")}
    <tr data-id="new"><td><input name="icon" placeholder="🎈" style="width:60px"></td><td><input name="name" placeholder="নতুন গিফট"></td>
      <td><select name="category_id">${catOpts(cats[0]?.id)}</select></td><td><input name="coin_price" type="number" min="1" value="10"></td>
      <td><input name="creator_share_pct" type="number" value="70"></td><td><input name="sort_order" type="number" value="99"></td>
      <td><input name="is_active" type="checkbox" checked style="width:auto"></td><td><button class="btn sm" data-save>যোগ করুন</button></td></tr>
    </table></div>
    <h2>ক্যাটাগরি</h2>
    <div class="toolbar">${cats.map((c) => `<span class="pill">${esc(c.name)}</span>`).join(" ")}
      <input id="newCat" placeholder="নতুন ক্যাটাগরির নাম"><button class="btn" id="addCat">যোগ করুন</button></div>`;
  $("#gt").onclick = async (e) => {
    const b = e.target.closest("[data-save]");
    if (!b) return;
    const tr = b.closest("tr");
    const v = (n) => tr.querySelector(`[name=${n}]`);
    const row = { icon: v("icon").value.trim(), name: v("name").value.trim(), category_id: Number(v("category_id").value),
      coin_price: Number(v("coin_price").value), creator_share_pct: Number(v("creator_share_pct").value),
      sort_order: Number(v("sort_order").value), is_active: v("is_active").checked };
    if (!row.icon || !row.name || row.coin_price < 1) return toast("আইকন, নাম ও দাম দিন", true);
    const q = tr.dataset.id === "new" ? sb.from("gifts").insert(row) : sb.from("gifts").update(row).eq("id", Number(tr.dataset.id));
    const { error } = await q;
    if (error) return toast(errMsg(error), true);
    toast("সেভ হয়েছে");
    if (tr.dataset.id === "new") routes.gifts();
  };
  $("#addCat").onclick = async () => {
    const name = $("#newCat").value.trim();
    if (!name) return;
    const { error } = await sb.from("gift_categories").insert({ name, sort_order: cats.length + 1 });
    if (error) return toast(errMsg(error), true);
    routes.gifts();
  };
};

// ---------- ads ----------
routes.ads = async () => {
  loading();
  const { data } = await sb.from("ad_placements").select("*").order("key");
  const label = { feed_interstitial: "রিলের মাঝে ফুল-স্ক্রিন অ্যাড", rewarded_points: "অ্যাড দেখে পয়েন্ট (Rewarded)", profile_banner: "প্রোফাইল/ওয়ালেট ব্যানার" };
  view.innerHTML = `<h1>অ্যাড কনফিগারেশন</h1>
    <div class="card small muted" style="margin-bottom:12px">
      এখন Google-এর <b>টেস্ট অ্যাড</b> চলছে। AdMob অ্যাকাউন্ট খুলে আসল Ad Unit ID নিচে বসান।<br>
      Rewarded অ্যাডের SSV কলব্যাক URL (AdMob-এ বসাবেন): ${copyable(SUPABASE_URL + "/functions/v1/admob-ssv")}<br>
      AdMob <b>App ID</b> বদলাতে APK নতুন করে বিল্ড করতে হবে — আমাকে App ID দিলে আমি করে দেব।
    </div>
    <div class="list">${data.map((p) => `<div class="item" data-key="${esc(p.key)}">
      <div class="top"><b>${esc(label[p.key] ?? p.key)}</b><span class="pill">${esc(p.ad_type)}</span></div>
      <label>Android Ad Unit ID<input name="unit_id_android" value="${esc(p.unit_id_android ?? "")}"></label>
      <div class="row">
        ${p.ad_type === "interstitial" ? `<label style="flex:1">প্রতি কয়টি রিলে ১টি অ্যাড<input name="every_n_videos" type="number" min="2" value="${p.every_n_videos ?? 6}"></label>` : ""}
        ${p.ad_type === "rewarded" ? `<label style="flex:1">দর্শকের পয়েন্ট<input name="viewer_points" type="number" min="0" value="${p.viewer_points}"></label>
          <label style="flex:1">ক্রিয়েটরের পয়েন্ট<input name="creator_points" type="number" min="0" value="${p.creator_points}"></label>
          <label style="flex:1">দিনে সর্বোচ্চ<input name="daily_cap" type="number" min="1" value="${p.daily_cap ?? 10}"></label>` : ""}
      </div>
      <label style="display:flex;gap:8px;align-items:center"><input name="is_active" type="checkbox" ${p.is_active ? "checked" : ""} style="width:auto;margin:0"> চালু</label>
      <div class="actions"><button class="btn sm good" data-save>সেভ</button></div>
    </div>`).join("")}</div>`;
  view.querySelector(".list").onclick = async (e) => {
    const b = e.target.closest("[data-save]");
    if (!b) return;
    const it = b.closest(".item");
    const row = {};
    it.querySelectorAll("[name]").forEach((i) => (row[i.name] = i.type === "checkbox" ? i.checked : i.type === "number" ? Number(i.value) : i.value.trim()));
    const { error } = await sb.from("ad_placements").update(row).eq("key", it.dataset.key);
    if (error) return toast(errMsg(error), true);
    toast("সেভ হয়েছে — অ্যাপ পরের বার খুললে কার্যকর");
  };
};

// ---------- income reports ----------
routes.reports = async () => {
  const today = new Date(Date.now() + 6 * 3600e3).toISOString().slice(0, 10);
  const from = new Date(Date.now() - 29 * 86400e3).toISOString().slice(0, 10);
  view.innerHTML = `<h1>ইনকাম রিপোর্ট</h1>
    <div class="toolbar"><input type="date" id="f" value="${from}"><input type="date" id="t" value="${today}">
      <button class="btn" id="go">দেখুন</button></div>
    <div id="tot" class="grid"></div><h2>দৈনিক</h2><div id="tbl" class="table-wrap"></div>
    <h2>টপ ক্রিয়েটর (৩০ দিন)</h2><div id="top" class="table-wrap"></div>`;
  const load = async () => {
    const rows = await act(() => rpc("admin_income_report", { p_from: $("#f").value, p_to: $("#t").value }));
    const sum = (k) => rows.reduce((a, r) => a + Number(r[k] ?? 0), 0);
    const c = (k, v) => `<div class="card stat"><div class="k">${k}</div><div class="v">${v}</div></div>`;
    $("#tot").innerHTML = c("গিফট কমিশন (আপনার আয়)", taka(sum("gift_fee_paisa"))) + c("ক্যাশ-ইন", taka(sum("cash_in_paisa")))
      + c("পেমেন্ট দেওয়া", taka(sum("withdraw_paid_paisa"))) + c("ক্রিয়েটরের গিফট আয়", taka(sum("creator_gift_paisa")))
      + c("নতুন ইউজার", num(sum("new_users"))) + c("ভিউ", num(sum("views")));
    $("#tbl").innerHTML = `<table><tr><th>তারিখ</th><th class="num">নতুন ইউজার</th><th class="num">ভিউ</th><th class="num">গিফট কয়েন</th><th class="num">কমিশন</th><th class="num">ক্যাশ-ইন</th><th class="num">পেমেন্ট</th><th class="num">Rewarded অ্যাড</th></tr>
      ${rows.map((r) => `<tr><td>${esc(r.day)}</td><td class="num">${num(r.new_users)}</td><td class="num">${num(r.views)}</td><td class="num">${num(r.gift_coins)}</td>
        <td class="num">${taka(r.gift_fee_paisa)}</td><td class="num">${taka(r.cash_in_paisa)}</td><td class="num">${taka(r.withdraw_paid_paisa)}</td><td class="num">${num(r.ad_rewards)}</td></tr>`).join("")}</table>`;
  };
  $("#go").onclick = load;
  load();
  const top = await act(() => rpc("admin_top_creators", { p_days: 30 }));
  $("#top").innerHTML = top.length ? `<table><tr><th>#</th><th>ক্রিয়েটর</th><th class="num">ভিউ</th><th class="num">লাইক</th><th class="num">গিফট আয়</th><th class="num">ভিউ আয়</th><th class="num">মোট</th></tr>
    ${top.map((t, i) => `<tr><td>${i + 1}</td><td><a href="#user/${t.user_id}">@${esc(t.username)}</a></td><td class="num">${num(t.views)}</td><td class="num">${num(t.likes)}</td>
      <td class="num">${taka(t.gift_paisa)}</td><td class="num">${taka(t.view_paisa)}</td><td class="num"><b>${taka(t.total_paisa)}</b></td></tr>`).join("")}</table>` : `<div class="empty">এখনো ডাটা নেই</div>`;
};

// ---------- broadcast ----------
routes.broadcast = () => {
  view.innerHTML = `<h1>সবাইকে নোটিফিকেশন</h1>
    <div class="card" style="max-width:520px">
      <label>শিরোনাম<input id="bt" maxlength="100"></label>
      <label>বার্তা<textarea id="bb" maxlength="500"></textarea></label>
      <button class="btn primary" id="send">পাঠান</button>
    </div>`;
  $("#send").onclick = async () => {
    const t = $("#bt").value.trim();
    if (!t) return toast("শিরোনাম দিন", true);
    if (!confirm("সব ইউজারকে পাঠাবেন?")) return;
    const n = await act(() => rpc("admin_broadcast", { p_title: t, p_body: $("#bb").value.trim() }));
    toast(`${num(n)} জনকে পাঠানো হয়েছে`);
    $("#bt").value = ""; $("#bb").value = "";
  };
};

// ---------- settings ----------
routes.settings = async () => {
  loading();
  const { data } = await sb.from("settings").select("*").order("key");
  const groups = [
    ["উইথড্র", ["withdraw_min_paisa", "withdraw_cooldown_days", "withdraw_fee_pct", "min_account_age_days"]],
    ["ক্যাশ-ইন (ইউজার এই নম্বরে টাকা পাঠাবে)", ["bkash_number", "nagad_number", "rocket_number", "min_cash_in_taka", "coin_price_paisa"]],
    ["ক্রিয়েটর ইনকাম", ["earnings_enabled", "view_rate_paisa_per_1000", "like_rate_paisa", "comment_rate_paisa", "creator_daily_view_cap_paisa", "pending_hold_hours", "min_watch_ms"]],
    ["দর্শক পয়েন্ট", ["watch_points", "viewer_daily_points_cap", "point_value_paisa", "points_convert_min"]],
    ["ভিডিও ও লক ফোল্ডার", ["auto_approve_minutes", "max_video_sec", "vault_quota_mb"]],
    ["অন্যান্য", ["app_notice"]],
  ];
  const byKey = Object.fromEntries(data.map((s) => [s.key, s]));
  const hint = (k, v) => (k.endsWith("_paisa") ? ` = ${taka(v)}` : "");
  const field = (s) => {
    const v = s.value;
    const input = typeof v === "boolean"
      ? `<select name="v"><option value="true" ${v ? "selected" : ""}>চালু</option><option value="false" ${!v ? "selected" : ""}>বন্ধ</option></select>`
      : `<input name="v" ${typeof v === "number" ? 'type="number"' : ""} value="${esc(v)}">`;
    return `<div class="item" data-key="${esc(s.key)}" data-type="${typeof v}">
      <div class="top"><b>${esc(s.description ?? s.key)}</b><span class="muted small">${esc(s.key)}<span class="h">${hint(s.key, v)}</span></span></div>
      <div class="row" style="flex-wrap:nowrap">${input}<button class="btn sm good" data-save style="margin-top:4px">সেভ</button></div></div>`;
  };
  view.innerHTML = `<h1>সেটিংস</h1>
    <div class="card" style="margin-bottom:14px"><b>আমার পাসওয়ার্ড বদলান</b>
      <div class="row" style="flex-wrap:nowrap;margin-top:6px"><input id="npw" type="password" placeholder="নতুন পাসওয়ার্ড (কমপক্ষে ৮ অক্ষর)" style="flex:1;width:auto;min-width:0"><button class="btn sm good" id="cpw" style="margin-top:4px">বদলান</button></div></div>
    <p class="muted small">টাকার ঘরগুলো <b>পয়সায়</b> (১ টাকা = ১০০ পয়সা)। যেমন উইথড্র মিনিমাম ৫০০ টাকা = 50000।</p>
    ${groups.map(([g, keys]) => `<h2>${g}</h2><div class="list">${keys.filter((k) => byKey[k]).map((k) => field(byKey[k])).join("")}</div>`).join("")}`;
  $("#cpw").onclick = async () => {
    const pw = $("#npw").value;
    if (pw.length < 8) return toast("কমপক্ষে ৮ অক্ষর দিন", true);
    const { error } = await sb.auth.updateUser({ password: pw });
    if (error) return toast(errMsg(error), true);
    $("#npw").value = "";
    toast("পাসওয়ার্ড বদলানো হয়েছে ✅");
  };
  view.onclick = async (e) => {
    const b = e.target.closest("[data-save]");
    if (!b) return;
    const it = b.closest(".item");
    const raw = it.querySelector("[name=v]").value;
    const type = it.dataset.type;
    const value = type === "number" ? Number(raw) : type === "boolean" ? raw === "true" : raw.trim();
    if (type === "number" && (isNaN(value) || value < 0)) return toast("সঠিক সংখ্যা দিন", true);
    await act(() => rpc("admin_set_setting", { p_key: it.dataset.key, p_value: value }), "সেভ হয়েছে");
    const h = it.querySelector(".h");
    if (h) h.textContent = hint(it.dataset.key, value);
  };
};

sb.auth.onAuthStateChange((ev) => { if (ev === "SIGNED_OUT") showLogin(); });
boot();
