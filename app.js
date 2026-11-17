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
  const { data: r, error: e1 } = await sb.functions.invoke("resolve-login", { body: { identifier: id } });
  if (e1 || !r?.login) return ($("#lErr").textContent = "এই নম্বর/ইমেইলে কোনো অ্যাকাউন্ট নেই");
  const { error } = await sb.auth.signInWithPassword({ email: r.login, password: $("#lPass").value });
  if (error) return ($("#lErr").textContent = errMsg(error));
  boot();
});
$("#logoutBtn").addEventListener("click", async (e) => { e.preventDefault(); await sb.auth.signOut(); location.hash = ""; showLogin(); });
$("#menuBtn").addEventListener("click", () => $("#nav").classList.toggle("open"));
$("#nav").addEventListener("click", (e) => { if (e.target.closest("a")) $("#nav").classList.remove("open"); });

async function refreshBadges() {
  try {
    const d = await rpc("admin_dashboard");
    $("#bWd").textContent = d.withdraw_pending || "";
    $("#bCi").textContent = d.cashin_pending || "";
    $("#bRp").textContent = d.reports_open || "";
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
      <p class="muted small" style="margin-top:16px">অ্যাড রেভিনিউ দেখতে AdMob অ্যাপ/ওয়েবসাইট ব্যবহার করুন।</p>`;
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
      </div>
      ${c.status === "pending" ? `<div class="actions">
        <button class="btn sm good" data-ok="1" data-id="${c.id}">টাকা পেয়েছি — অ্যাপ্রুভ</button>
        <button class="btn sm bad" data-ok="0" data-id="${c.id}">রিজেক্ট</button></div>` : ""}
    </div>`).join("");
  list.onclick = async (e) => {
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
routes.users = async () => {
  view.innerHTML = `<h1>ইউজার</h1>
    <div class="toolbar"><input id="q" placeholder="নাম, ইউজারনেম বা ফোন">
      <select id="st"><option value="">সব</option><option value="active">সক্রিয়</option><option value="banned">ব্যান</option></select>
      <button class="btn" id="go">খুঁজুন</button></div>
    <div id="list" class="table-wrap"></div><div class="row" style="margin-top:10px"><button class="btn sm" id="more">আরও</button><span id="cnt" class="muted small"></span></div>`;
  let offset = 0, rows = [];
  const load = async (reset) => {
    if (reset) { offset = 0; rows = []; }
    const data = await act(() => rpc("admin_users", { p_q: $("#q").value.trim(), p_status: $("#st").value, p_limit: 50, p_offset: offset }));
    rows = rows.concat(data); offset += data.length;
    $("#cnt").textContent = `${rows.length} / ${data[0]?.total_count ?? rows.length}`;
    $("#more").classList.toggle("hidden", data.length < 50);
    $("#list").innerHTML = rows.length ? `<table><tr><th>ইউজার</th><th>ফোন</th><th>স্ট্যাটাস</th><th class="num">ভিডিও</th><th class="num">কয়েন</th><th class="num">ব্যালেন্স</th><th class="num">পেন্ডিং</th><th class="num">পয়েন্ট</th><th>যোগদান</th></tr>
      ${rows.map((u) => `<tr><td><a href="#user/${u.id}">@${esc(u.username)}</a><br><span class="muted small">${esc(u.full_name ?? "")}${u.role === "admin" ? " · অ্যাডমিন" : ""}</span></td>
        <td>${esc(u.phone ?? "")}</td><td>${pill(u.status)}${u.is_frozen ? ' <span class="pill rejected">ফ্রিজ</span>' : ""}</td>
        <td class="num">${num(u.videos_count)}</td><td class="num">${num(u.coin_balance)}</td><td class="num">${taka(u.earning_paisa)}</td>
        <td class="num">${taka(u.pending_paisa)}</td><td class="num">${num(u.points)}</td><td>${dt(u.created_at)}</td></tr>`).join("")}</table>`
      : `<div class="empty">কেউ নেই</div>`;
  };
  $("#go").onclick = () => load(true);
  $("#q").onkeydown = (e) => e.key === "Enter" && load(true);
  $("#more").onclick = () => load(false);
  load(true);
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
      <div>নাম</div><div>${esc(p.full_name ?? "-")}</div>
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
  const tabs = [["published", "প্রকাশিত"], ["featured", "ফিচার্ড"], ["rejected", "রিজেক্টেড"], ["deleted", "ডিলিট"]];
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
          <div><a href="#user/${v.user_id}">@${esc(v.profiles?.username)}</a> ${v.is_featured ? "⭐" : ""} ${v.uploaded_by_admin ? '<span class="pill">অ্যাডমিন</span>' : ""}</div>
          <div class="cap">${esc(v.caption ?? "")}</div>
          <div class="muted small">👁 ${num(v.views_count)} ❤️ ${num(v.likes_count)} 💬 ${num(v.comments_count)} 🎁 ${num(v.gifts_coins_total)} · ${dt(v.created_at)}</div>
          ${v.reject_reason ? `<div class="small err">${esc(v.reject_reason)}</div>` : ""}
          <div class="actions">
            ${v.status === "published" ? `<button class="btn sm" data-a="${v.is_featured ? "unfeature" : "feature"}">${v.is_featured ? "আনফিচার" : "ফিচার ⭐"}</button>
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
      await rpc("create_video", { p_video_path: vPath, p_video_url: vUrl, p_thumb_url: tUrl, p_caption: $("#cap").value, p_duration: duration });
      setP(100, "✅ আপলোড সম্পন্ন — ফিডে দেখা যাবে");
      toast("আপলোড সম্পন্ন");
      vf.value = ""; $("#cap").value = "";
    } catch (e) { toast(errMsg(e), true); $("#msg").textContent = "ব্যর্থ: " + errMsg(e); }
    btn.disabled = false;
  };
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
    ["অন্যান্য", ["max_video_sec", "app_notice"]],
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
  view.innerHTML = `<h1>সেটিংস</h1><p class="muted small">টাকার ঘরগুলো <b>পয়সায়</b> (১ টাকা = ১০০ পয়সা)। যেমন উইথড্র মিনিমাম ৫০০ টাকা = 50000।</p>
    ${groups.map(([g, keys]) => `<h2>${g}</h2><div class="list">${keys.filter((k) => byKey[k]).map((k) => field(byKey[k])).join("")}</div>`).join("")}`;
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
