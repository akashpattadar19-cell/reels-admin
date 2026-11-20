import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const { SUPABASE_URL, SUPABASE_KEY } = window.REELS_CONFIG;
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const $ = (s, el = document) => el.querySelector(s);
const view = $("#view");
// থিম: ডার্ক / লাইট (ফোনে মনে থাকে)
const setTheme = (t) => { document.documentElement.dataset.theme = t; try { localStorage.setItem("adminTheme", t); } catch { /* */ }
  document.querySelectorAll("#themeTg button").forEach((b) => b.classList.toggle("on", b.dataset.th === t));
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t === "light" ? "#F4F2FB" : "#0A0918"); };
setTheme(document.documentElement.dataset.theme || "dark");
document.getElementById("themeTg")?.addEventListener("click", (e) => { const b = e.target.closest("[data-th]"); if (b) setTheme(b.dataset.th); });
let me = null;

// ---------- helpers ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (n) => Number(n ?? 0).toLocaleString("en-IN");
const taka = (p) => "৳" + (Number(p ?? 0) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const dt = (s) => (s ? new Date(s).toLocaleString("en-GB", { timeZone: "Asia/Dhaka", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "-");
const METHOD = { bkash: "bKash", nagad: "Nagad", rocket: "Rocket" };
const STATUS = { pending: "পেন্ডিং", approved: "অ্যাপ্রুভড", paid: "পরিশোধিত", rejected: "রিজেক্টেড", active: "সক্রিয়", banned: "ব্যান", published: "প্রকাশিত", deleted: "ডিলিট", open: "খোলা", resolved: "সমাধান", dismissed: "বাতিল" };
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
  $("#who").innerHTML = `<span class="who-chip"><span class="av0" translate="no">${esc((p.full_name || p.username || "A").charAt(0).toUpperCase())}</span><span><b translate="no">@${esc(p.username)}</b><br><span class="muted" style="font-size:11px">অ্যাডমিন</span></span></span>`;
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
$("#nav").addEventListener("click", (e) => {
  if (e.target.closest("a")) $("#nav").classList.remove("open");
  const h = e.target.closest(".ngh");
  if (h) {
    const g = h.parentElement; g.classList.toggle("closed");
    try { const c = JSON.parse(localStorage.getItem("navClosed") || "[]").filter((x) => x !== g.dataset.g); if (g.classList.contains("closed")) c.push(g.dataset.g); localStorage.setItem("navClosed", JSON.stringify(c)); } catch { /* */ }
  }
});
try { JSON.parse(localStorage.getItem("navClosed") || "[]").forEach((g) => document.querySelector(`.ng[data-g="${g}"]`)?.classList.add("closed")); } catch { /* */ }
// মেনুতে খোঁজা
$("#navQ").addEventListener("input", (e) => {
  const q = e.target.value.trim().toLowerCase();
  document.querySelectorAll("#nav .ng").forEach((g) => {
    let any = false;
    g.querySelectorAll("a").forEach((a) => { const ok = !q || a.textContent.toLowerCase().includes(q); a.style.display = ok ? "" : "none"; any = any || ok; });
    g.style.display = any ? "" : "none"; g.classList.toggle("searching", !!q);
  });
});
// যেকোনো তালিকায় দ্রুত খোঁজা/ফিল্টার (প্রতিটি পেজে নিজে থেকে)
const QF_DAYS = [["", "সব সময়"], ["1", "আজ"], ["7", "৭ দিন"], ["30", "৩০ দিন"]];
function quickFilter() {
  view.querySelector(".qf")?.remove();
  const box = [...view.querySelectorAll(".list, .table-wrap tbody")].sort((a, b) => b.children.length - a.children.length)[0];
  if (!box || box.children.length < 5) return;
  const rows = [...box.children].filter((r) => !r.classList.contains("empty"));
  const kinds = [...new Map(rows.filter((r) => r.dataset.k).map((r) => [r.dataset.k, r.dataset.kl || r.dataset.k])).entries()];
  const hasTs = rows.some((r) => r.dataset.ts), hasAmt = rows.some((r) => r.dataset.amt);
  const bar = document.createElement("div");
  bar.className = "qf";
  bar.innerHTML = `<input type="search" class="qf-q" placeholder="🔎 এই তালিকায় খুঁজুন (নাম, ID, নম্বর…)">
    ${kinds.length > 1 ? `<select class="qf-k"><option value="">সব ধরন</option>${kinds.map(([k, l]) => `<option value="${esc(k)}">${esc(l)}</option>`).join("")}</select>` : ""}
    ${hasTs ? `<select class="qf-d">${QF_DAYS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>` : ""}
    ${hasAmt ? `<select class="qf-s"><option value="">ক্রম: আগের মতো</option><option value="desc">টাকা: বেশি আগে</option><option value="asc">টাকা: কম আগে</option></select>` : ""}
    <span class="qf-n muted small"></span>`;
  (box.closest(".table-wrap") || box).before(bar);
  const orig = [...rows];
  const apply = () => {
    const q = bar.querySelector(".qf-q").value.trim().toLowerCase(), k = bar.querySelector(".qf-k")?.value || "",
      d = Number(bar.querySelector(".qf-d")?.value || 0), so = bar.querySelector(".qf-s")?.value || "";
    const since = d ? Date.now() - d * 864e5 : 0;
    let shown = 0;
    orig.forEach((r) => {
      const ok = (!q || r.textContent.toLowerCase().includes(q)) && (!k || r.dataset.k === k) && (!since || !r.dataset.ts || new Date(r.dataset.ts) >= since);
      r.style.display = ok ? "" : "none"; if (ok) shown++;
    });
    const order = so ? [...orig].sort((a, b) => (Number(a.dataset.amt || 0) - Number(b.dataset.amt || 0)) * (so === "asc" ? 1 : -1)) : orig;
    order.forEach((r) => box.appendChild(r));
    bar.querySelector(".qf-n").textContent = `${shown}/${orig.length}টি`;
  };
  bar.addEventListener("input", apply); bar.addEventListener("change", apply); apply();
}

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
  try { window.__leave?.(); } catch { /* */ } window.__leave = null;
  const act = document.querySelector(`#nav a[href="#${name}"], #nav a[href^="#${name}/"]`);
  act?.closest(".ng")?.classList.remove("closed");
  let run; try { run = (routes[name] ?? routes.dashboard)(arg); } catch (e) { run = Promise.reject(e); }
  Promise.resolve(run).then(() => setTimeout(quickFilter, 50)).catch((e) => {
    console.error("route " + name, e);
    if (!view.querySelector(".card, .list, table, form")) view.innerHTML = `<div class="card"><b>⚠️ পেজটি খোলা যায়নি</b><p class="muted">${esc(e?.message || String(e))}</p><button class="btn" onclick="location.reload()">🔄 আবার চেষ্টা</button></div>`;
  });
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", () => me && route());

document.addEventListener("submit", (e) => {
  if (e.target.id !== "dFind") return;
  e.preventDefault();
  const v = $("#dFindQ").value.replace(/\D/g, ""); if (v) location.hash = "#lookup/" + v;
});
// ---------- dashboard ----------
// ---------- চার্ট (SVG, থিমের রং মেনে) ----------
const CH = {
  short: (x) => { x = Number(x) || 0; const a = Math.abs(x); return a >= 1e7 ? (x / 1e7).toFixed(1) + "কো" : a >= 1e5 ? (x / 1e5).toFixed(1) + "লা" : a >= 1e3 ? (x / 1e3).toFixed(1) + "K" : String(Math.round(x)); },
  path(pts) { // মসৃণ লাইন (cardinal)
    if (pts.length < 2) return "";
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2, t = 0.18;
      d += ` C${p1[0] + (p2[0] - p0[0]) * t},${p1[1] + (p2[1] - p0[1]) * t} ${p2[0] - (p3[0] - p1[0]) * t},${p2[1] - (p3[1] - p1[1]) * t} ${p2[0]},${p2[1]}`;
    }
    return d;
  },
  line(series, labels, fmt = CH.short) { // series: [{v:[...], c:"#hex", fill:bool}]
    const W = innerWidth < 700 ? 380 : 640, H = 230, L = 42, R = 10, T = 14, B = 26, n = labels.length;
    const max = Math.max(1, ...series.flatMap((s) => s.v)) * 1.15;
    const X = (i) => L + (i * (W - L - R)) / Math.max(1, n - 1), Y = (v) => T + (H - T - B) * (1 - v / max);
    const ticks = [0, .25, .5, .75, 1].map((f) => max * f);
    const peak = series[0].v.indexOf(Math.max(...series[0].v));
    let g = `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs>${series.map((s, k) => `<linearGradient id="lg${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.c}" stop-opacity=".35"/><stop offset="1" stop-color="${s.c}" stop-opacity="0"/></linearGradient>`).join("")}</defs>`;
    g += ticks.map((v) => `<line class="grid-l" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L - 6}" y="${Y(v) + 3}" text-anchor="end">${fmt(v)}</text>`).join("");
    const step = Math.ceil(n / 8);
    g += labels.map((l, i) => (i % step === 0 || i === n - 1 ? `<text x="${X(i)}" y="${H - 6}" text-anchor="middle">${l}</text>` : "")).join("");
    if (peak >= 0 && series[0].v[peak] > 0) g += `<rect x="${X(peak) - 12}" y="${T}" width="24" height="${H - T - B}" rx="6" fill="${series[0].c}" opacity=".12"/>`;
    series.slice().reverse().forEach((s, kk) => {
      const k = series.length - 1 - kk, pts = s.v.map((v, i) => [X(i), Y(v)]), d = CH.path(pts);
      if (s.fill) g += `<path d="${d} L${X(n - 1)},${Y(0)} L${X(0)},${Y(0)} Z" fill="url(#lg${k})"/>`;
      g += `<path d="${d}" fill="none" stroke="${s.c}" stroke-width="${s.fill ? 2.6 : 1.8}" stroke-linecap="round" ${s.dash ? 'stroke-dasharray="5 5"' : ""}/>`;
    });
    if (peak >= 0 && series[0].v[peak] > 0) {
      const px = X(peak), py = Y(series[0].v[peak]), lab = fmt(series[0].v[peak]);
      g += `<circle cx="${px}" cy="${py}" r="6" fill="#fff" stroke="${series[0].c}" stroke-width="3"/><rect x="${px - 34}" y="${Math.max(0, py - 32)}" width="68" height="22" rx="7" fill="${series[0].c}"/><text x="${px}" y="${Math.max(0, py - 32) + 15}" text-anchor="middle" style="fill:#fff;font-weight:700;font-size:11px">${lab}</text>`;
    }
    return g + `</svg>`;
  },
  bars(vals, labels, color = "#8B5CF6") {
    const W = innerWidth < 700 ? 380 : 640, H = 200, L = 6, R = 6, T = 26, B = 24, n = vals.length, max = Math.max(1, ...vals);
    const bw = (W - L - R) / n, hi = vals.indexOf(max);
    let g = `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs><linearGradient id="bg1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="${color}" stop-opacity=".25"/></linearGradient></defs>`;
    vals.forEach((v, i) => {
      const h = Math.max(4, (H - T - B) * (v / max)), x = L + i * bw + bw * 0.18, w = bw * 0.64, y = H - B - h;
      g += `<rect x="${x}" y="${T}" width="${w}" height="${H - T - B}" rx="8" fill="currentColor" opacity=".05"/>`;
      g += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${i === hi && max > 0 ? "url(#bg1)" : color}" opacity="${i === hi ? 1 : .35}"/>`;
      if (i === hi && max > 0) g += `<rect x="${x + w / 2 - 20}" y="${y - 24}" width="40" height="19" rx="6" fill="${color}"/><text x="${x + w / 2}" y="${y - 10}" text-anchor="middle" style="fill:#fff;font-weight:700;font-size:11px">${CH.short(v)}</text>`;
      g += `<text x="${x + w / 2}" y="${H - 7}" text-anchor="middle">${labels[i]}</text>`;
    });
    return g + `</svg>`;
  },
  donut(parts, size = 180) { // [{v, c}]
    const tot = parts.reduce((a, p) => a + p.v, 0) || 1, r = 70, C = 2 * Math.PI * r; let off = 0;
    return `<svg viewBox="0 0 180 180" width="${size}" height="${size}" style="transform:rotate(-90deg)"><circle cx="90" cy="90" r="${r}" fill="none" stroke="currentColor" stroke-opacity=".08" stroke-width="22"/>${parts.map((p) => {
      const len = (p.v / tot) * C, el = `<circle cx="90" cy="90" r="${r}" fill="none" stroke="${p.c}" stroke-width="22" stroke-dasharray="${Math.max(0, len - 3)} ${C}" stroke-dashoffset="${-off}" stroke-linecap="round"/>`;
      off += len; return el; }).join("")}</svg>`;
  },
};
const ROCKET = `<svg class="deco" viewBox="0 0 200 160"><defs><linearGradient id="rk" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#C4B5FD"/></linearGradient></defs>
  <circle cx="150" cy="40" r="3" fill="#fff" opacity=".7"/><circle cx="60" cy="30" r="2" fill="#fff" opacity=".6"/><circle cx="185" cy="95" r="2" fill="#fff" opacity=".6"/>
  <g transform="rotate(40 120 80)"><path d="M120 20c22 18 26 52 14 86h-28c-12-34-8-68 14-86z" fill="url(#rk)"/><circle cx="120" cy="58" r="10" fill="#7C3AED" stroke="#fff" stroke-width="3"/>
  <path d="M106 96l-16 18 18-4zM134 96l16 18-18-4z" fill="#F472B6"/><path d="M110 108c2 18 8 28 10 34 2-6 8-16 10-34z" fill="#FBBF24" opacity=".9"/></g></svg>`;
routes.dashboard = async () => {
  loading();
  try {
    const today = new Date(), iso = (d) => d.toISOString().slice(0, 10), from = new Date(today.getTime() - 59 * 864e5);
    const [d, rep, types, an] = await Promise.all([rpc("admin_dashboard"), rpc("admin_income_report", { p_from: iso(from), p_to: iso(today) }).catch(() => []),
      rpc("admin_user_type_counts").catch(() => null), rpc("admin_analytics", { p_days: 30 }).catch(() => null)]);
    await refreshBadges().catch(() => {});
    const byDay = Object.fromEntries((rep ?? []).map((r) => [String(r.day).slice(0, 10), r]));
    const days = Array.from({ length: 60 }, (_, i) => iso(new Date(from.getTime() + i * 864e5)));
    const cur = days.slice(30), prev = days.slice(0, 30);
    const get = (arr, f) => arr.map((k) => Number(f(byDay[k] || {})) || 0);
    const METRICS = {
      income: ["আয় (ক্যাশ-ইন + গিফট কমিশন)", (r) => ((r.cash_in_paisa || 0) + (r.gift_fee_paisa || 0)) / 100, (v) => "৳" + CH.short(v)],
      users: ["নতুন ইউজার", (r) => r.new_users, CH.short],
      views: ["ভিউ", (r) => r.views, CH.short],
      paid: ["উইথড্র দেওয়া", (r) => (r.withdraw_paid_paisa || 0) / 100, (v) => "৳" + CH.short(v)],
    };
    const lbl = cur.map((k) => String(Number(k.slice(8))));
    const sum = (a) => a.reduce((x, y) => x + y, 0);
    const pct = (a, b) => (b ? Math.round(((a - b) / b) * 100) : a ? 100 : 0);
    const inc30 = sum(get(cur, METRICS.income[1])), incPrev = sum(get(prev, METRICS.income[1]));
    const new30 = sum(get(cur, METRICS.users[1])), newPrev = sum(get(prev, METRICS.users[1]));
    const badge = (id) => Number($(id)?.textContent || 0);
    const todo = [["#withdrawals", "💸", "উইথড্র", badge("#bWd")], ["#cashins", "💳", "ক্যাশ-ইন", badge("#bCi")], ["#videos/pending", "🎬", "ভিডিও", badge("#bPv")],
      ["#support/user", "🎧", "সাপোর্ট", badge("#bSu") + badge("#bSh")], ["#moderation", "🛡️", "রিপোর্ট", badge("#bRp")]];
    const todoN = todo.reduce((a, t) => a + t[3], 0);
    const trend = (p) => `<span class="tr ${p >= 0 ? "up" : "dn"}">${p >= 0 ? "▲" : "▼"} ${Math.abs(p)}%</span>`;
    const kpi = (ic, v, k, href, extra = "", hl = false) => `<a class="kpi ${hl ? "hl" : ""}" href="${href}"><div class="ic">${ic}</div>${extra}<div class="v">${v}</div><div class="k">${k}</div></a>`;
    const T = types || {}, ut = [{ v: Number(T.user || 0), c: "#8B5CF6", l: "👤 ইউজার" }, { v: Number(T.host || 0), c: "#F59E0B", l: "🎤 হোস্ট" }, { v: Number(T.seller || 0), c: "#22C55E", l: "💰 কয়েন সেলার" }];
    const totT = ut.reduce((a, x) => a + x.v, 0) || 1;
    const C = (an?.countries ?? []).slice(0, 5), cMax = Math.max(1, ...C.map((x) => Number(x.users) || 0)), CC = ["#8B5CF6", "#22C55E", "#F59E0B", "#94A3B8", "#EC4899"];
    const act = (an?.daily ?? []).slice(-14);
    view.innerHTML = `<h1>ড্যাশবোর্ড</h1><div class="page-sub">আজকের সারাংশ, আয় ও ইউজারের হিসাব</div>
      <div class="d-hero">${ROCKET}<h2>${todoN ? `${num(todoN)}টি কাজ আপনার অপেক্ষায়` : "সব কাজ শেষ 🎉"}</h2>
        <p>আজ ${num(d.users_today)} জন নতুন ইউজার · ${num(d.views_today)} ভিউ · ${num(d.videos_today)} নতুন ভিডিও</p>
        <div class="chips">${todo.map(([h, i, l, n2]) => `<a href="${h}" class="${n2 ? "" : "zero"}">${i} ${l} <b>${num(n2)}</b></a>`).join("")}</div></div>
      <form class="dash-find" id="dFind"><input id="dFindQ" inputmode="numeric" placeholder="🔎 ইউজারের ID লিখুন (যেমন 100001)"><button class="btn primary" style="width:auto;margin:0">খুঁজুন</button></form>
      <div class="kpis">
        ${kpi("👥", num(d.users_total), "মোট ইউজার", "#users", trend(pct(new30, newPrev)), true)}
        ${kpi("💳", taka(d.cashin_month_paisa), "এ মাসে ক্যাশ-ইন", "#cashins", trend(pct(inc30, incPrev)))}
        ${kpi("💰", taka(d.liability_paisa), "ইউজারদের ব্যালেন্স (দায়)", "#reports")}
        ${kpi("👁", num(d.views_today), "আজকের ভিউ", "#analytics")}
      </div>
      <div class="d-row">
        <div class="chart-card"><div class="hd"><b id="lcT">মাসিক হিসাব</b><select id="lcM" style="width:auto;margin:0;padding:6px 10px">${Object.entries(METRICS).map(([k, m]) => `<option value="${k}">${m[0]}</option>`).join("")}</select></div>
          <div class="legend"><span><i style="background:#8B5CF6"></i>শেষ ৩০ দিন</span><span><i style="background:#94A3B8"></i>আগের ৩০ দিন</span><span id="lcSum"></span></div><div id="lc"></div></div>
        <div class="chart-card"><div class="hd"><b>ইউজারের ধরন</b><a class="btn sm" href="#users">সব দেখুন ›</a></div>
          <div class="donut-wrap">${CH.donut(ut)}<div class="c"><b>${num(totT === 1 && !ut[0].v ? 0 : totT)}</b><span>মোট অ্যাকাউন্ট</span></div></div>
          <div class="bars-list">${ut.map((x) => `<div class="bl"><div class="t"><span>${x.l}</span><b style="color:${x.c}">${Math.round((x.v / totT) * 100)}%</b></div><div class="tr2"><i style="width:${(x.v / totT) * 100}%;background:${x.c}"></i></div></div>`).join("")}</div></div>
      </div>
      <div class="d-row">
        <div class="chart-card"><div class="hd"><b>সক্রিয় ইউজার (প্রতিদিন)</b><span>শেষ ১৪ দিন</span></div>${CH.bars(act.map((x) => Number(x.users) || 0), act.map((x) => String(Number(String(x.day).slice(8)))))}</div>
        <div class="chart-card"><div class="hd"><b>শীর্ষ দেশ</b><a class="btn sm" href="#analytics">বিস্তারিত ›</a></div>
          <div class="bars-list">${C.length ? C.map((x, i) => `<div class="bl"><div class="t"><span>${esc(x.country_code || "??")}</span><b style="color:${CC[i]}">${num(x.users)} জন</b></div><div class="tr2"><i style="width:${(Number(x.users) / cMax) * 100}%;background:${CC[i]}"></i></div></div>`).join("") : `<div class="empty">এখনো তথ্য নেই</div>`}</div></div>
      </div>
      <div class="d-row">
        <div class="chart-card"><div class="hd"><b>টাকার হিসাব</b><a class="btn sm" href="#reports">রিপোর্ট ›</a></div><div class="act-list">
          ${[["🎁", "আজ গিফট কমিশন", taka(d.gift_fee_today_paisa)], ["🎁", "এ মাসে গিফট কমিশন", taka(d.gift_fee_month_paisa)], ["💳", "এ মাসে ক্যাশ-ইন", taka(d.cashin_month_paisa)],
            ["💸", "এ মাসে উইথড্র দেওয়া", taka(d.paid_month_paisa)], ["⏳", "পেন্ডিং উইথড্র", `${num(d.withdraw_pending)} · ${taka(d.withdraw_pending_paisa)}`], ["🪙", "ইউজারদের কাছে কয়েন", num(d.coins_outstanding)]]
            .map(([i, k, v]) => `<div class="ai"><span class="dot2">${i}</span><div class="x">${k}</div><em>${v}</em></div>`).join("")}</div></div>
        <div class="chart-card"><div class="hd"><b>দ্রুত কাজ</b></div><div class="quick" style="grid-template-columns:repeat(3,1fr);margin:0">${[["#videos/pending", "🎬", "ভিডিও অনুমোদন"], ["#withdrawals", "💸", "উইথড্র"], ["#cashins", "💳", "ক্যাশ-ইন"], ["#agents", "🧑‍💼", "এজেন্ট"],
          ["#launch/pnew", "📢", "অফার দিন"], ["#broadcast", "🔔", "নোটিফিকেশন"], ["#coins", "🪙", "কয়েন"], ["#lookup", "🔎", "ইউজার খুঁজুন"], ["#monitor", "🛡️", "লাইভ মনিটর"]]
          .map(([h, i, l]) => `<a href="${h}"><span>${i}</span>${l}</a>`).join("")}</div></div>
      </div>
      <div id="hostReq"></div>
      <p class="muted small" style="margin-top:16px">অ্যাড রেভিনিউ দেখতে AdMob অ্যাপ/ওয়েবসাইট ব্যবহার করুন।</p>`;
    const draw = () => {
      const m = METRICS[$("#lcM").value], a = get(cur, m[1]), b = get(prev, m[1]);
      $("#lc").innerHTML = CH.line([{ v: a, c: "#8B5CF6", fill: true }, { v: b, c: "#94A3B8", dash: true }], lbl, m[2]);
      $("#lcSum").innerHTML = `<b style="color:var(--text)">${m[2](sum(a))}</b> ${trend(pct(sum(a), sum(b))).replace('class="tr', 'class="pill tr')}`;
    };
    $("#lcM").onchange = draw; draw();
    $("#dFind").onsubmit = (e) => { e.preventDefault(); const q = $("#dFindQ").value.replace(/\D/g, ""); if (q) location.hash = "#lookup/" + q; };
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
    <div class="item" data-k="${esc(w.method)}" data-kl="${esc(METHOD[w.method] ?? w.method)}" data-amt="${w.payable_paisa}" data-ts="${w.created_at}">
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
    <div class="item" data-k="${esc(c.method)}" data-kl="${esc(METHOD[c.method] ?? c.method)}" data-amt="${c.amount_paisa}" data-ts="${c.created_at}">
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
// ইউজার কার্ড: পরিচয়, ব্যাজ, ওয়ালেট আর সব সেবার বোতাম এক জায়গায়
const AVC = ["#8B5CF6", "#EC4899", "#F59E0B", "#22C55E", "#0EA5E9", "#EF4444"];
function userCard(u) {
  const ini = esc(String(u.full_name || u.username || "?").trim().charAt(0).toUpperCase() || "?");
  const col = AVC[Number(u.user_no || 0) % AVC.length];
  const host = u.account_type === "host";
  return `<div class="ucard ${host ? "is-host" : ""}">
    <div class="uc-top"><a class="uc-av" translate="no" href="#lookup/${u.user_no}" style="background:${col}">${ini}</a>
      <div class="uc-id"><a href="#lookup/${u.user_no}"><b translate="no">${esc(u.full_name || u.username)}</b></a><small translate="no">@${esc(u.username)} · ID ${u.user_no}</small>
        <div class="uc-tags">${host ? '<span class="pill host">🎤 হোস্ট</span>' : '<span class="pill">👤 ইউজার</span>'}${u.coin_seller ? '<span class="pill seller">💰 সেলার</span>' : ""}${u.role === "admin" ? '<span class="pill approved">🛡️ অ্যাডমিন</span>' : ""}${pill(u.status)}${u.is_frozen ? '<span class="pill rejected">ফ্রিজ</span>' : ""}</div></div></div>
    <div class="uc-w">
      <div><span>🪙 কয়েন</span><b>${num(u.coin_balance)}</b></div><div><span>💰 ব্যালেন্স</span><b>${taka(u.earning_paisa)}</b></div>
      <div><span>⏳ পেন্ডিং</span><b>${taka(u.pending_paisa)}</b></div><div><span>⭐ পয়েন্ট</span><b>${num(u.points)}</b></div></div>
    <div class="uc-s"><span>🎬 ${num(u.videos_count)} ভিডিও</span><span>👥 ${num(u.followers_count)} ফলোয়ার</span><span>📈 মোট আয় ${taka(u.total_earned_paisa)}</span><span>💸 তুলেছে ${taka(u.total_withdrawn_paisa)}</span></div>
    <div class="uc-m"><span translate="no">${esc(u.phone || u.email || "")}</span><span>যোগ দিয়েছে ${dt(u.created_at)}</span></div>
    <div class="uc-a"><a class="btn sm primary" href="#lookup/${u.user_no}">🔎 সব তথ্য</a><a class="btn sm" href="#coins/${u.user_no}">🪙 কয়েন দিন</a><a class="btn sm" href="#user/${u.id}">⚙️ ম্যানেজ</a></div>
  </div>`;
}
// ইউজার মনিটর (Keeta-র মতো): অবস্থা অনুযায়ী লাইভ তালিকা, নামে চাপলে সব কাজের পেজ
const USTATE = {
  all: ["সব", ""], active: ["অনলাইন — সব", "#22C55E"], live: ["অনলাইন — লাইভে", "#EF4444"], party: ["অনলাইন — পার্টিতে", "#EC4899"],
  call: ["অনলাইন — কলে", "#F59E0B"], online: ["অনলাইন — অবসর", "#22C55E"], offline: ["অফলাইন", "#94A3B8"], restricted: ["সীমাবদ্ধ (ব্যান/জেল)", "#DC2626"],
};
const USTATE_TAG = { live: "🔴 লাইভে", party: "🎉 পার্টিতে", call: "📞 কলে", online: "অবসর", offline: "অফলাইন", restricted: "সীমাবদ্ধ" };
const agoBn = (t) => { if (!t) return "কখনো না"; const m = Math.floor((Date.now() - new Date(t)) / 60000);
  return m < 1 ? "এইমাত্র" : m < 60 ? `${num(m)} মিনিট আগে` : m < 1440 ? `${num(Math.floor(m / 60))} ঘণ্টা আগে` : `${num(Math.floor(m / 1440))} দিন আগে`; };
const hrs = (sec) => (sec >= 3600 ? `${(sec / 3600).toFixed(1)} ঘণ্টা` : `${num(Math.round(sec / 60))} মিনিট`);
function monRow(u) {
  const nm = u.full_name || u.username, col = AVC[Number(u.user_no || 0) % AVC.length];
  const on = ["online", "live", "party", "call"].includes(u.state);
  return `<a class="mrow" href="#lookup/${u.user_no}">
    <span class="mr-av" translate="no" style="background:${col}">${u.avatar_url ? `<img src="${esc(u.avatar_url)}" alt="" loading="lazy">` : esc(String(nm).charAt(0).toUpperCase())}<i class="${on ? "on" : ""}"></i></span>
    <span class="mr-b">
      <span class="mr-t"><b translate="no">${esc(nm)}</b><em class="st-${u.state}">${USTATE_TAG[u.state] || u.state}</em></span>
      <span class="mr-l"><span translate="no">${esc(u.phone || "")}</span>${u.phone ? " · " : ""}আজ অনলাইন: ${hrs(u.today_seconds || 0)}</span>
      <span class="mr-l">ID ${u.user_no} · 🪙 ${num(u.coin_balance)} · ${taka(u.earning_paisa)} · ${num(u.videos_count)} ভিডিও · ${num(u.followers_count)} ফলোয়ার</span>
      <span class="mr-l mr-tags">${u.country_code ? `<span>${flag(u.country_code)} ${esc(COUNTRY_EN[u.country_code] ?? u.country_code)}${u.city ? `, <span translate="no">${esc(u.city)}</span>` : ""}</span>` : ""}
        ${u.account_type === "host" ? '<span class="pill host">🎤 হোস্ট</span>' : '<span class="pill">👤 ইউজার</span>'}${u.coin_seller ? '<span class="pill seller">💰 সেলার</span>' : ""}${u.agent ? '<span class="pill approved">🧑‍💼 এজেন্ট</span>' : ""}${u.vip ? '<span class="pill pending">💎 VIP</span>' : ""}${u.role === "admin" ? '<span class="pill approved">🛡️ অ্যাডমিন</span>' : ""}
        <span class="muted">শেষ দেখা ${on ? "এখন" : agoBn(u.last_seen)}</span></span>
    </span></a>`;
}
routes.users = async (type = "all") => {
  type = ["all", "user", "host", "seller", "agent"].includes(type) ? type : "all";
  const S = JSON.parse(sessionStorage.getItem("umon") || "{}");
  view.innerHTML = `<h1>👥 ইউজার</h1><div class="page-sub">কে এখন অনলাইন, লাইভে বা কলে — নামে চাপলে তার সব তথ্য ও সব কাজ</div>
    <div class="ctabs" id="uType">${[["all", "সব"], ["user", "👤 ইউজার"], ["host", "🎤 হোস্ট"], ["seller", "💰 সেলার"], ["agent", "🧑‍💼 এজেন্ট"]].map(([k, l]) => `<a href="#users/${k}" class="${k === type ? "on" : ""}" data-k="${k}">${l} <b id="tc_${k}"></b></a>`).join("")}</div>
    <div class="mon-bar">
      <label class="mb-st"><span>অবস্থা</span><select id="ust">${Object.entries(USTATE).map(([k, [l]]) => `<option value="${k}">${l}</option>`).join("")}</select></label>
      <label class="mb-st"><span>সাজানো</span><select id="usort"><option value="recent">অনলাইন আগে</option><option value="name">নাম অনুযায়ী</option><option value="time">আজ বেশি সময়</option><option value="coins">বেশি কয়েন</option><option value="seen">শেষ দেখা</option></select></label>
      <form id="uf" class="mb-q"><input id="q" placeholder="🔎 নাম, ID বা ফোন" value="${esc(S.q || "")}"></form>
      <button class="btn sm" id="uref" title="রিফ্রেশ">⟳</button>
      <div class="theme-tg" id="uMode"><button type="button" data-m="list">📋 তালিকা</button><button type="button" data-m="map">🗺 ম্যাপ</button></div>
    </div>
    <div class="mon-sum" id="usum"></div>
    <div class="umon" id="umon"><div class="um-l"><div id="list" class="mlist"></div><div class="row" style="margin-top:10px"><button class="btn sm" id="more">আরও</button><span id="cnt" class="muted small"></span></div></div>
      <div class="um-m"><div id="umap"></div><div class="um-leg">${["live", "party", "call", "online", "offline"].map((k) => `<span><i style="background:${USTATE[k][1]}"></i>${USTATE_TAG[k]}</span>`).join("")}<em id="umapN"></em></div></div></div>`;
  $("#ust").value = S.st || "all"; $("#usort").value = S.sort || "recent";
  let offset = 0, rows = [];
  const save = () => sessionStorage.setItem("umon", JSON.stringify({ q: $("#q").value, st: $("#ust").value, sort: $("#usort").value }));
  const counts = async () => {
    const c = await rpc("admin_user_state_counts", { p_type: type === "all" ? null : type }).catch(() => ({}));
    const act2 = ["online", "live", "party", "call"].reduce((a, k) => a + Number(c[k] || 0), 0);
    const n = (k) => (k === "active" ? act2 : Number(c[k] || 0));
    [...$("#ust").options].forEach((o) => (o.textContent = `${USTATE[o.value][0]} (${num(n(o.value))})`));
    $("#usum").innerHTML = ["active", "live", "party", "call", "offline", "restricted"].map((k) =>
      `<button type="button" data-s="${k}" class="${$("#ust").value === k ? "on" : ""}"><i style="background:${USTATE[k][1]}"></i>${k === "active" ? "অনলাইন" : USTATE[k][0].replace("অনলাইন — ", "")} <b>${num(n(k))}</b></button>`).join("");
  };
  const load = async (reset) => {
    if (reset) { offset = 0; rows = []; $("#list").innerHTML = `<div class="center"><div class="spinner"></div></div>`; }
    save();
    const data = await act(() => rpc("admin_user_monitor", { p_q: $("#q").value.trim(), p_state: $("#ust").value, p_type: type === "all" ? null : type, p_sort: $("#usort").value, p_limit: 50, p_offset: offset }));
    rows = rows.concat(data ?? []); offset += (data ?? []).length;
    $("#cnt").textContent = `${num(rows.length)} / ${num(data?.[0]?.total_count ?? rows.length)}`;
    $("#more").classList.toggle("hidden", (data ?? []).length < 50);
    $("#list").innerHTML = rows.length ? rows.map(monRow).join("") : `<div class="empty">কেউ নেই</div>`;
  };
  // ম্যাপ (Leaflet, প্রয়োজনে লোড)
  let MAP = null, LAYER = null, fitted = false;
  const mode = () => localStorage.getItem("umonMode") || "list";
  const wide = () => innerWidth >= 1100;
  const applyMode = () => {
    const m = mode(), box = $("#umon");
    box.classList.toggle("split", wide()); box.classList.toggle("only-map", !wide() && m === "map"); box.classList.toggle("only-list", !wide() && m !== "map");
    document.querySelectorAll("#uMode button").forEach((b) => b.classList.toggle("on", b.dataset.m === m));
    $("#uMode").classList.toggle("hidden", wide());
    if (wide() || m === "map") drawMap();
  };
  const loadLeaflet = () => window.L ? Promise.resolve() : new Promise((ok, no) => {
    const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"; document.head.appendChild(l);
    const sc = document.createElement("script"); sc.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"; sc.onload = ok; sc.onerror = no; document.head.appendChild(sc);
  });
  const drawMap = async () => {
    try { await loadLeaflet(); } catch { $("#umap").innerHTML = `<div class="empty">ম্যাপ লোড হয়নি — ইন্টারনেট দেখুন</div>`; return; }
    if (!$("#umap")) return;
    if (!MAP) {
      const dark = document.documentElement.dataset.theme !== "light";
      MAP = L.map("umap", { zoomControl: true, attributionControl: true }).setView([23.8, 60], 3);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(MAP);
      $("#umap").classList.toggle("dk", dark);
      LAYER = L.layerGroup().addTo(MAP);
    }
    setTimeout(() => MAP.invalidateSize(), 50);
    const pts = (await rpc("admin_user_map", { p_type: type === "all" ? null : type, p_state: $("#ust").value, p_limit: 3000 }).catch(() => [])) ?? [];
    LAYER.clearLayers();
    const ll = [];
    pts.forEach((u) => {
      const j = (Number(u.user_no) % 97) / 97 - 0.5, k = (Number(u.user_no) % 89) / 89 - 0.5; // একই জায়গার লোক যেন একদম না ঢাকে
      const lat = Number(u.lat) + j * 0.01, lon = Number(u.lon) + k * 0.01, nm = u.full_name || u.username, col = USTATE[u.state]?.[1] || "#94A3B8";
      const html = `<div class="um-pin" style="border-color:${col}">${u.avatar_url ? `<img src="${esc(u.avatar_url)}">` : `<b style="background:${AVC[Number(u.user_no) % AVC.length]}">${esc(String(nm).charAt(0).toUpperCase())}</b>`}</div>`;
      const mk = L.marker([lat, lon], { icon: L.divIcon({ html, className: "um-ic", iconSize: [40, 40], iconAnchor: [20, 20] }), zIndexOffset: u.state === "offline" ? 0 : 1000 });
      mk.bindPopup(`<div class="um-pop"><b translate="no">${esc(nm)}</b><br><span style="color:${col};font-weight:700">${USTATE_TAG[u.state] || u.state}</span> · ID ${u.user_no}<br>
        ${flag(u.country_code)} <span translate="no">${esc(u.city || "")}</span><br><small>শেষ দেখা ${["online", "live", "party", "call"].includes(u.state) ? "এখন" : agoBn(u.last_seen)}</small><br>
        <a href="#lookup/${u.user_no}">সব তথ্য ও কাজ ›</a></div>`);
      LAYER.addLayer(mk); ll.push([lat, lon]);
    });
    $("#umapN").textContent = `📍 ${num(pts.length)} জন`;
    if (ll.length && !fitted) { MAP.fitBounds(ll, { padding: [30, 30], maxZoom: 11 }); fitted = true; }
  };
  $("#uMode").onclick = (e) => { const b = e.target.closest("[data-m]"); if (!b) return; localStorage.setItem("umonMode", b.dataset.m); applyMode(); };
  addEventListener("resize", () => { if ($("#umon")) applyMode(); });
  const all = () => { counts(); load(true); if (MAP && (wide() || mode() === "map")) drawMap(); };
  $("#ust").onchange = all; $("#usort").onchange = () => load(true); $("#uref").onclick = all;
  $("#uf").onsubmit = (e) => { e.preventDefault(); load(true); };
  $("#more").onclick = () => load(false);
  $("#usum").onclick = (e) => { const b = e.target.closest("[data-s]"); if (!b) return; $("#ust").value = $("#ust").value === b.dataset.s ? "all" : b.dataset.s; all(); };
  all(); applyMode();
  rpc("admin_user_type_counts").then((c) => {
    const t = { user: c.user, host: c.host, seller: c.seller, all: Number(c.user || 0) + Number(c.host || 0) };
    Object.entries(t).forEach(([k, v]) => { const el = $("#tc_" + k); if (el) el.textContent = num(v); });
  }).catch(() => {});
  // প্রতি ৩০ সেকেন্ডে নিজে থেকে হালনাগাদ (এই পেজে থাকলে)
  const h = location.hash, timer = setInterval(() => { if (location.hash !== h) return clearInterval(timer); if (!document.hidden && offset <= 50) all(); }, 30000);
};


// 🔑 এককালীন পাসওয়ার্ড: সার্ভার বানায়, ইউজার লগইন করলেই নিজের নতুন পাসওয়ার্ড দিতে বাধ্য, ২৪ ঘণ্টা পর অচল
async function giveOtp(p, priv) {
  if (!confirm(`@${p.username} (ID ${p.user_no})-কে এককালীন পাসওয়ার্ড দেবেন? তার পুরনো পাসওয়ার্ড আর কাজ করবে না।`)) return;
  const { data, error } = await sb.functions.invoke("admin-tools", { body: { action: "one_time_password", user_id: p.id } });
  if (error || data?.error) return toast(errMsg(error ?? data.error), true);
  const phone = String(priv?.phone ?? "");
  const login = phone && !phone.startsWith("google:") ? phone : priv?.email || `ID ${p.user_no}`;
  const msg = `Reels Enjoy — আপনার এককালীন পাসওয়ার্ড: ${data.password}\nলগইন: ${login}\nলগইন করার পর নতুন পাসওয়ার্ড দিতে হবে। এটা ২৪ ঘণ্টা পর্যন্ত চলবে।`;
  const wa = phone && phone.startsWith("+") ? `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(msg)}` : "";
  const box = document.createElement("div");
  box.className = "otp-modal";
  box.innerHTML = `<div class="card otp-card"><h3 style="margin-top:0">🔑 এককালীন পাসওয়ার্ড</h3>
    <div class="otp-pw">${esc(data.password)}</div>
    <p class="small">ইউজার: <b>@${esc(p.username)}</b> · লগইন: <b>${esc(login)}</b><br>২৪ ঘণ্টা চলবে। লগইন করলেই ইউজারকে নতুন পাসওয়ার্ড দিতে বলা হবে।</p>
    ${phone.startsWith("google:") ? `<p class="small muted">⚠️ এই ইউজার Google দিয়ে খুলেছে — তার পাসওয়ার্ড লাগে না, Google দিয়েই লগইন করবে।</p>` : ""}
    <div class="toolbar"><button class="btn good" id="otpCopy">📋 বার্তা কপি</button>${wa ? `<a class="btn" href="${wa}" target="_blank">💬 WhatsApp-এ পাঠান</a>` : ""}<button class="btn" id="otpX">✕ বন্ধ</button></div></div>`;
  document.body.appendChild(box);
  box.querySelector("#otpCopy").onclick = async () => { try { await navigator.clipboard.writeText(msg); toast("কপি হয়েছে"); } catch { prompt("কপি করুন:", msg); } };
  box.querySelector("#otpX").onclick = () => box.remove();
}

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
      <button class="btn good" id="otp">🔑 এককালীন পাসওয়ার্ড</button>
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
  $("#otp").onclick = () => giveOtp(p, priv);
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
// রিজেক্টের কারণ দ্রুত বাছাই (ক্রিয়েটর নোটিফিকেশনে দেখবে)
const REJECT_REASONS = ["ভিডিওতে ওয়াটারমার্ক / অন্য অ্যাপ বা পেজের লোগো আছে", "TikTok / অন্য পেজের ভিডিও — নিজের তোলা আসল ভিডিও দিন",
  "অশ্লীল বা খারাপ কনটেন্ট", "ভিডিও অস্পষ্ট / ভাঙা", "কপিরাইট গান বা সিনেমার অংশ"];
function pickReason() {
  return new Promise((res) => {
    const d = document.createElement("div");
    d.className = "otp-modal";
    d.innerHTML = `<div class="card otp-card"><h3 style="margin-top:0">রিজেক্টের কারণ</h3>
      ${REJECT_REASONS.map((r, i) => `<button class="btn" data-r="${i}" style="display:block;width:100%;text-align:left;margin-bottom:8px">${r}</button>`).join("")}
      <textarea id="rrO" rows="2" placeholder="অন্য কারণ লিখুন…"></textarea>
      <div class="row" style="gap:8px;margin-top:8px"><button class="btn" data-x>বাতিল</button><button class="btn bad" data-o>এই কারণে রিজেক্ট</button></div></div>`;
    const done = (v) => { d.remove(); res(v); };
    d.onclick = (e) => {
      const b = e.target.closest("button"); if (!b) { if (e.target === d) done(null); return; }
      if (b.dataset.r != null) done(REJECT_REASONS[Number(b.dataset.r)]);
      else if (b.hasAttribute("data-o")) { const v = d.querySelector("#rrO").value.trim(); if (v) done(v); else toast("কারণ লিখুন", true); }
      else done(null);
    };
    document.body.appendChild(d);
  });
}
let rewardCoins = 0;
routes.videos = async (arg = "published") => {
  const userFilter = arg.startsWith("user:") ? arg.slice(5) : null;
  { const { data: rc } = await sb.from("settings").select("value").eq("key", "upload_reward_coins").maybeSingle(); rewardCoins = Number(rc?.value ?? 0); }
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
          ${v.status === "pending" ? `<div class="small" style="color:var(--warn)">⏳ পেন্ডিং · ${dt(v.created_at)}</div>
            <div class="small muted">দেখে নিন: ওয়াটারমার্ক, TikTok/পেজের লোগো বা নাম নেই, নিজের আসল ভিডিও।${Number(rewardCoins) > 0 && v.reward_coins == null ? ` অ্যাপ্রুভ করলে আপলোডার 🪙 ${rewardCoins} কয়েন পাবে।` : ""}</div>` : ""}
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
    if (a === "reject" || a === "delete") { reason = await pickReason(); if (!reason) return; }
    await act(() => rpc("admin_video_action", { p_id: id, p_action: a, p_reason: reason }), a === "approve" && Number(rewardCoins) > 0 ? `অ্যাপ্রুভ হয়েছে — আপলোডার 🪙 ${rewardCoins} কয়েন পেয়েছে` : "হয়েছে");
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
      <div class="row" style="flex-wrap:wrap;gap:8px;margin-bottom:12px"><button class="btn sm good" data-c="otp">🔑 এককালীন পাসওয়ার্ড দিন</button></div>
      <div class="row" style="flex-wrap:wrap;gap:8px;margin-bottom:12px">
        <span>অ্যাকাউন্ট: <b>${p.account_type === "host" ? "🎤 হোস্ট" : "👤 ইউজার"}</b></span>
        ${p.account_type === "host" ? `<button class="btn sm warn" data-c="unhost">ইউজার বানান</button>` : `<button class="btn sm good" data-c="host">হোস্ট বানান</button>`}
      </div>
      ${p.account_type === "host" ? `<div style="margin-bottom:12px"><b>📞 কল</b> <span class="muted small">হোস্টের নিজের রেট: ভিডিও 🪙${p.call_video_rate ?? "ডিফল্ট"} · অডিও 🪙${p.call_audio_rate ?? "ডিফল্ট"} /মিনিট · কল ${p.calls_on === false ? "❌ বন্ধ" : "✅ চালু"}</span>
        <div class="row" style="flex-wrap:nowrap;gap:6px;margin-top:6px"><input id="crc" type="number" min="0" max="100" placeholder="এই হোস্টের জন্য আপনার কমিশন % (খালি = সবার মতো)" value="${p.call_host_pct != null ? 100 - p.call_host_pct : ""}"><button class="btn sm good" data-c="crate">সেভ</button></div></div>` : ""}
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
      ${p.jailed ? `<div style="background:var(--pill-bad);color:var(--pill-bad-t);border-radius:10px;padding:10px"><b>🚫 জেলে আছে</b>
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
    else if (c === "otp") { const { data: pv } = await sb.from("user_private").select("phone,email").eq("user_id", p.id).maybeSingle(); return giveOtp(p, pv); }
    else if (c === "crate") { const v = $("#crc").value.trim(); await act(() => rpc("admin_set_call_commission", { p_user: p.id, p_commission: v === "" ? null : Number(v) }), "সেভ হয়েছে"); }
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

const L2 = (bn, en) => (window.getLang?.() === "en" ? en : bn);
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
    </div>
    <h2>🎬 ভিডিও অ্যাপ্রুভ গ্রুপ (টেলিগ্রাম)</h2>
    <div class="card">
      <p class="small">নতুন ভিডিও আপলোড হলে টেলিগ্রাম গ্রুপে ভিডিওসহ আসবে, নিচে ✅ Approve ও ❌ Reject বোতাম থাকবে। Reject চাপলে কারণ বেছে নিতে পারবেন।</p>
      <div class="kv"><div>অবস্থা</div><div>${st.mod_linked ? "<span>✅ যুক্ত:</span> <span translate=\"no\">" + esc(st.mod_title || "") + "</span>" : "❌ কোনো গ্রুপ যুক্ত নেই"}</div><div>অপেক্ষায়</div><div>${num(st.pending ?? 0)} টি ভিডিও</div></div>
      ${!st.bot ? `<p class="muted small">আগে উপরের বট চালু করুন।</p>` : `
      <ol class="small" style="margin:10px 0 6px;padding-left:18px">
        <li>টেলিগ্রামে নতুন গ্রুপ খুলুন (যেমন "Reels Enjoy ভিডিও চেক") — শুধু বিশ্বস্ত লোক রাখবেন, গ্রুপের যে কেউ বোতাম চাপতে পারবে।</li>
        <li translate="no">${L2("গ্রুপে বট @" + esc(st.bot) + " যোগ করুন।", "Add the bot @" + esc(st.bot) + " to the group.")}</li>
        <li>নিচের বোতাম চেপে কোড নিন, তারপর গ্রুপে কমান্ডটি পাঠান।</li></ol>
      ${st.mod_code ? `<p><span>গ্রুপে এটা লিখে পাঠান:</span> <code id="modCmd" style="font-size:16px">/mod ${esc(st.mod_code)}</code> <button class="btn sm" id="modCopy">কপি</button></p>` : ""}
      <div class="row" style="gap:8px">
        <button class="btn" id="modCode">${st.mod_code ? "নতুন কোড" : "গ্রুপ যুক্ত করার কোড নিন"}</button>
        ${st.mod_linked ? `<button class="btn sm" id="modTest">পরীক্ষা মেসেজ</button><button class="btn sm" id="modRun">এখনই পাঠান</button><button class="btn sm bad" id="modOff">গ্রুপ বাদ দিন</button>` : ""}
      </div>`}
    </div>`;
  const modDo = async (act) => { try { await rpc("admin_telegram_mod", { p_action: act }); telegramSetup(box); } catch (er) { toast(errMsg(er), true); } };
  $("#modCode") && ($("#modCode").onclick = () => modDo("code"));
  $("#modOff") && ($("#modOff").onclick = () => confirm("টেলিগ্রাম গ্রুপ বাদ দেবেন?") && modDo("unlink"));
  $("#modCopy") && ($("#modCopy").onclick = () => { navigator.clipboard?.writeText($("#modCmd").textContent); toast("কপি হয়েছে"); });
  const fnCall = async (action, okMsg) => { const { data, error } = await sb.functions.invoke("support-telegram", { body: { action } }); if (error || data?.ok === false) toast("কাজ হয়নি", true); else toast(okMsg); };
  $("#modTest") && ($("#modTest").onclick = () => fnCall("mod_test", "✅ গ্রুপে পরীক্ষা মেসেজ গেছে"));
  $("#modRun") && ($("#modRun").onclick = () => fnCall("mod_run", "✅ অপেক্ষার ভিডিও পাঠানো হয়েছে"));
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
// ---------- 🌐 ওয়েবসাইট: ডিজাইন ও লেখা ----------
const SITE_FIELDS = [
  ["notice", "📢 সবার উপরে ঘোষণার ফিতা (খালি = দেখাবে না)", "যেমন: 🎉 লঞ্চ অফার চলছে — নতুন ইউজাররা পাচ্ছেন ৳২০ বোনাস!"],
  ["hero_tag", "উপরের ছোট ট্যাগ", "🇧🇩 বাংলা ভাষার মানুষের জন্য"],
  ["hero_title", "বড় শিরোনাম", "ছোট ভিডিও, লাইভ আড্ডা, প্রতিযোগিতা — আর পুরস্কার"],
  ["hero_lead", "শিরোনামের নিচের লেখা", "Reels Enjoy একটি ফ্রি ছোট ভিডিও অ্যাপ…", true],
  ["offers_title", "অফার অংশের শিরোনাম", "🔥 এখনকার অফার"],
  ["features_title", "ফিচার অংশের শিরোনাম", "অ্যাপে যা যা করতে পারবেন"],
  ["earn_title", "আয় অংশের শিরোনাম", "পুরস্কার ও আয় — সোজা কথায়"],
  ["agent_title", "এজেন্ট অংশের শিরোনাম", "🧑‍💼 এজেন্ট হন"],
  ["faq_title", "প্রশ্ন-উত্তর অংশের শিরোনাম", "প্রশ্ন ও উত্তর"],
  ["faq", "বাড়তি প্রশ্ন-উত্তর (প্রতি লাইনে: প্রশ্ন || উত্তর)", "উইথড্র কত দিনে আসে? || সাধারণত ২৪ ঘণ্টার মধ্যে।", true],
  ["footer", "নিচের ছোট লেখা", "যেমন: ঢাকা, বাংলাদেশ"],
];
const SITE_SOCIAL = [["whatsapp", "💬 WhatsApp নম্বর", "+8801…"], ["facebook", "📘 Facebook পেজের লিংক", "https://facebook.com/…"], ["youtube", "▶️ YouTube লিংক", "https://youtube.com/…"],
  ["tiktok", "🎵 TikTok লিংক", "https://tiktok.com/@…"], ["instagram", "📸 Instagram লিংক", "https://instagram.com/…"]];
routes.website = async () => {
  loading();
  const { data } = await sb.from("settings").select("key,value").in("key", ["site_texts", "site_theme"]);
  const M = Object.fromEntries((data ?? []).map((x) => [x.key, x.value]));
  const T = M.site_texts || {}, th = M.site_theme || "a";
  const inp = (k, ph, area) => area ? `<textarea data-t="${k}" rows="3" placeholder="${esc(ph)}" style="width:100%">${esc(T[k] ?? "")}</textarea>` : `<input data-t="${k}" placeholder="${esc(ph)}" value="${esc(T[k] ?? "")}">`;
  view.innerHTML = `<h1>🌐 ওয়েবসাইট</h1>
    <div class="card small" style="margin-bottom:12px">অফার, প্রতিযোগিতা, বোনাস, উইথড্রর নিয়ম আর এজেন্টের নিয়ম ওয়েবসাইটে নিজে থেকেই অ্যাপ থেকে আসে। এখানে শুধু ডিজাইন আর স্থায়ী লেখা বদলাবেন।
      খালি রাখলে আগের লেখাই দেখাবে। <div style="margin-top:8px"><a class="btn sm" href="${SITE_URL}" target="_blank" rel="noopener">🌐 ওয়েবসাইট দেখুন</a></div></div>
    <h2>✍️ লেখা</h2>
    <div class="list">${SITE_FIELDS.map(([k, l, ph, area]) => `<div class="item"><b>${l}</b>
      <label class="small muted" style="display:block;margin-top:6px">বাংলা</label>${inp(k, ph, area)}
      <label class="small muted" style="display:block;margin-top:6px">English</label>${inp(k + "_en", "", area)}</div>`).join("")}</div>
    <h2>🔗 সোশ্যাল ও যোগাযোগ</h2>
    <div class="list">${SITE_SOCIAL.map(([k, l, ph]) => `<div class="item"><b>${l}</b>${inp(k, ph)}</div>`).join("")}</div>
    <button class="btn good" id="wsSave" style="margin:14px 0 30px;width:100%">💾 সব লেখা সেভ করুন</button>`;
  $("#wsSave").onclick = async () => {
    const nt = {};
    view.querySelectorAll("[data-t]").forEach((el) => { const v = el.value.trim(); if (v) nt[el.dataset.t] = v; });
    for (const k of ["facebook", "youtube", "tiktok", "instagram"]) if (nt[k] && !/^https:\/\//.test(nt[k])) return toast(`${k} লিংক https:// দিয়ে শুরু হবে`, true);
    await act(() => rpc("admin_set_setting", { p_key: "site_texts", p_value: nt }), "✅ সেভ হয়েছে — ওয়েবসাইটে এখনই দেখাবে");
  };
};

// ---------- 🚀 লঞ্চ অফার: ইনকাম লক + সিজন প্রতিযোগিতা ----------
const LOCK_ITEMS = [
  ["views", "👀 ভিউ থেকে ক্রিয়েটরের আয়", "প্রতি ১০০০ ভিউতে টাকা"],
  ["likes", "❤️ লাইক থেকে আয়", "প্রতি লাইকে ক্রিয়েটরের টাকা"],
  ["comments", "💬 কমেন্ট থেকে আয়", "প্রতি কমেন্টকারীতে ক্রিয়েটরের টাকা"],
  ["watch", "⭐ ভিডিও দেখে পয়েন্ট", "দর্শক পুরো ভিডিও দেখলে পয়েন্ট"],
  ["ads", "📺 অ্যাড দেখে পয়েন্ট", "রিওয়ার্ড অ্যাডের পয়েন্ট (দর্শক ও ক্রিয়েটর)"],
  ["posts", "🖼️ ফটো ও লেখা থেকে আয়", "পোস্টে লাইক/কমেন্ট/শেয়ারের টাকা"],
  ["convert", "🔁 পয়েন্ট → টাকা", "জমানো পয়েন্ট টাকায় নেওয়া"],
  ["upload", "🪙 ভিডিও আপলোডে কয়েন", "অনুমোদিত ভিডিওতে ফ্রি কয়েন"],
];
const SEASON_STATE = { draft: ["📝 খসড়া", ""], upcoming: ["⏳ শুরু হয়নি", "pending"], running: ["🔥 চলছে", "active"], ended: ["🏁 শেষ — পুরস্কার বাকি", "pending"], paid: ["✅ পুরস্কার দেওয়া হয়েছে", "paid"] };
const WHY_TXT = { videos: "ভিডিও কম", no_device: "APK লগইন নেই", blocked: "ব্লক/জেল", admin: "অ্যাডমিন", excluded: "বাদ দেওয়া" };
const prizeTotal = (a) => (a || []).reduce((x, y) => x + Number(y || 0), 0);
const partsTxt = (p) => [["watch", "👀"], ["like", "❤️"], ["comment", "💬"], ["share", "🔁"], ["video", "🎬"], ["referral", "🤝"]]
  .filter(([k]) => p?.[k]).map(([k, i]) => `${i} ${num(p[k])}`).join(" · ") || "—";

// 📢 অফার ও খবর: একবার লিখলে অ্যাপ আর ওয়েবসাইট দুই জায়গায় দেখাবে
const SITE_URL = "https://reelsenjoy.com/";
async function launchPosts(arg, tabs) {
  const list = await rpc("admin_site_posts");
  const now = Date.now();
  const live = (x) => x.active && (!x.starts_at || new Date(x.starts_at) <= now) && (!x.ends_at || new Date(x.ends_at) > now);
  if (arg === "posts") {
    view.innerHTML = `<h1>🚀 লঞ্চ অফার</h1>${tabs("posts")}
      <div class="card small" style="margin-bottom:12px">এখানে যে অফার বা খবর লিখবেন তা একসাথে <b>অ্যাপের হোম পেজে</b> আর <b>ওয়েবসাইটে</b> দেখাবে। শেষ সময় দিলে তারপর নিজে থেকে লুকিয়ে যাবে।
        চলমান সিজন প্রতিযোগিতা, রেফার অফার, স্বাগত বোনাস আর কয়েন অফার ওয়েবসাইটে নিজে থেকেই দেখায় — আলাদা লিখতে হবে না।
        <div style="margin-top:8px"><a class="btn sm" href="${SITE_URL}" target="_blank" rel="noopener">🌐 ওয়েবসাইট দেখুন</a> <span class="copy" data-copy="${SITE_URL}">${SITE_URL}</span></div></div>
      <a class="btn good" href="#launch/pnew" style="margin-bottom:12px">➕ নতুন অফার / খবর</a>
      <div class="list">${list.map((x) => `<a class="item" href="#launch/p${x.id}" style="display:block">
        <div class="top"><b>${x.pinned ? "📌 " : ""}${x.kind === "news" ? "📰" : "🎁"} ${esc(x.title)}</b><span class="pill ${live(x) ? "active" : ""}">${live(x) ? "✅ দেখাচ্ছে" : x.active ? "⏳ সময়ের বাইরে" : "⏸️ বন্ধ"}</span></div>
        <div class="meta">${x.show_app ? "📱 অ্যাপ " : ""}${x.show_site ? "🌐 ওয়েবসাইট " : ""}· ${new Date(x.created_at).toLocaleDateString("bn-BD")}${x.ends_at ? ` · শেষ ${new Date(x.ends_at).toLocaleString("bn-BD")}` : ""}</div></a>`).join("")
        || `<div class="empty">এখনো কিছু নেই — "➕ নতুন অফার / খবর" চাপুন</div>`}</div>`;
    return;
  }
  const isNew = arg === "pnew";
  const x = isNew ? { kind: "offer", title: "", show_app: true, show_site: true, pinned: false, active: true } : list.find((y) => "p" + y.id === arg);
  if (!x) { view.innerHTML = `<div class="empty">পাওয়া যায়নি</div>`; return; }
  let img = x.image_url || "";
  const loc = (iso) => iso ? toLocalInput(iso) : "";
  view.innerHTML = `<h1>🚀 লঞ্চ অফার</h1>${tabs("posts")}<p><a href="#launch/posts">← সব অফার ও খবর</a></p>
    <h2>${isNew ? "➕ নতুন অফার / খবর" : "✏️ এডিট"}</h2>
    <div class="card">
      <label class="small">ধরন</label><select id="pK"><option value="offer" ${x.kind === "offer" ? "selected" : ""}>🎁 অফার</option><option value="news" ${x.kind === "news" ? "selected" : ""}>📰 খবর / ঘোষণা</option></select>
      <label class="small">শিরোনাম</label><input id="pT" value="${esc(x.title)}" placeholder="যেমন: ঈদ অফার — কয়েনে ৩০% বেশি">
      <label class="small">শিরোনাম — English</label><input id="pTe" value="${esc(x.title_en ?? "")}">
      <label class="small">বিস্তারিত</label><textarea id="pB" rows="4">${esc(x.body ?? "")}</textarea>
      <label class="small">বিস্তারিত — English</label><textarea id="pBe" rows="4">${esc(x.body_en ?? "")}</textarea>
      <label class="small">ছবি (ঐচ্ছিক, চওড়া ছবি ভালো দেখায়)</label><input id="pF" type="file" accept="image/*">
      <div id="pPrev" style="margin:6px 0">${img ? `<img src="${esc(img)}" style="width:200px;border-radius:8px"> <button class="btn sm" id="pNoImg" type="button">ছবি সরান</button>` : ""}</div>
      <label class="small">লিংক (ঐচ্ছিক — যেমন অ্যাপের পেজ #season, #invite, #cashin বা কোনো ওয়েব লিংক)</label><input id="pL" value="${esc(x.link_url ?? "")}" placeholder="#season">
      <div class="row" style="gap:8px"><div style="flex:1"><label class="small">শুরু (খালি = এখনই)</label><input id="pS" type="datetime-local" value="${loc(x.starts_at)}"></div>
        <div style="flex:1"><label class="small">শেষ (খালি = যতদিন না বন্ধ করেন)</label><input id="pE" type="datetime-local" value="${loc(x.ends_at)}"></div></div>
      <div style="display:grid;gap:8px;margin:12px 0">
        <label><input type="checkbox" id="pA" ${x.show_app ? "checked" : ""}> 📱 অ্যাপে দেখাবে</label>
        <label><input type="checkbox" id="pW" ${x.show_site ? "checked" : ""}> 🌐 ওয়েবসাইটে দেখাবে</label>
        <label><input type="checkbox" id="pP" ${x.pinned ? "checked" : ""}> 📌 সবার উপরে রাখুন</label>
        <label><input type="checkbox" id="pOn" ${x.active ? "checked" : ""}> ✅ চালু</label>
        ${isNew ? `<label><input type="checkbox" id="pN"> 🔔 সব ইউজারকে নোটিফিকেশন পাঠান</label>` : ""}</div>
      <div class="row" style="gap:8px"><button class="btn good" id="pSave">💾 সেভ</button>${isNew ? "" : `<button class="btn bad" id="pDel">🗑️ মুছুন</button>`}</div>
    </div>`;
  $("#pNoImg")?.addEventListener("click", () => { img = ""; $("#pPrev").innerHTML = ""; });
  $("#pSave").onclick = async (e) => {
    const title = $("#pT").value.trim(); if (title.length < 2) return toast("শিরোনাম লিখুন", true);
    e.target.disabled = true;
    try {
      const f = $("#pF").files[0];
      if (f) {
        const path = `${S.me.id}/offer-${Date.now()}.${(f.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "")}`;
        const { error } = await sb.storage.from("photos").upload(path, f, { contentType: f.type || "image/jpeg" });
        if (error) throw error;
        img = sb.storage.from("photos").getPublicUrl(path).data.publicUrl;
      }
      const iso = (v) => v ? new Date(v).toISOString() : "";
      const p = { id: isNew ? null : x.id, kind: $("#pK").value, title, title_en: $("#pTe").value, body: $("#pB").value, body_en: $("#pBe").value,
        image_url: img, link_url: $("#pL").value.trim(), starts_at: iso($("#pS").value), ends_at: iso($("#pE").value),
        show_app: $("#pA").checked, show_site: $("#pW").checked, pinned: $("#pP").checked, active: $("#pOn").checked };
      const id = await rpc("admin_save_site_post", { p });
      if ($("#pN")?.checked) await rpc("admin_broadcast", { p_title: (p.kind === "news" ? "📢 " : "🎁 ") + title, p_body: (p.body || "").slice(0, 140) }).catch(() => {});
      toast("✅ সেভ হয়েছে");
      location.hash = "#launch/p" + id;
    } catch (er) { toast(errMsg(er), true); e.target.disabled = false; }
  };
  $("#pDel")?.addEventListener("click", async () => { if (!confirm("এটা মুছবেন?")) return; await act(() => rpc("admin_delete_site_post", { p_id: x.id }), "মুছে ফেলা হয়েছে"); location.hash = "#launch/posts"; });
}

// 📅 প্রতিদিন চেক-ইন ও নতুনদের কাজ (পুরস্কার কয়েন — উইথড্র হয় না)
async function launchGrow(tabs) {
  const [st, { data: rows }] = await Promise.all([rpc("admin_growth_stats"),
    sb.from("settings").select("key,value").in("key", ["checkin_enabled", "checkin_rewards", "bonus_need_device", "starter_enabled", "starter_days", "starter_follow_need", "starter_rewards", "wealth_enabled", "wealth_levels", "coin_price_paisa"])]);
  const S0 = Object.fromEntries((rows ?? []).map((r) => [r.key, r.value]));
  const cr = Array.isArray(S0.checkin_rewards) ? S0.checkin_rewards : [2, 3, 5, 5, 8, 10, 20];
  const sr = S0.starter_rewards || {};
  const sc = st.starter || {};
  const TASKS = [["avatar", "🖼️ প্রোফাইল ছবি"], ["video", "🎬 প্রথম ভিডিও (অনুমোদিত)"], ["follow", "👥 ফলো করা"], ["done", "🏆 সব শেষের বোনাস"]];
  view.innerHTML = `<h1>🚀 লঞ্চ অফার</h1>${tabs("grow")}
    <div class="card small" style="margin-bottom:12px">পুরস্কার শুধু <b>কয়েন</b> — উইথড্র হয় না, গিফট/VIP/বুস্ট/ফ্রেমে খরচ হয়। "এক মোবাইলে এক অ্যাকাউন্ট" চালু থাকলে
      পুরস্কার শুধু APK-তে আর একই মোবাইলের দ্বিতীয় অ্যাকাউন্ট একই পুরস্কার পাবে না।</div>
    <div class="grid">
      <div class="card stat"><div class="k">আজ চেক-ইন</div><div class="v">${num(st.today?.users)}</div><div class="muted small">🪙 ${num(st.today?.coins)}</div></div>
      <div class="card stat"><div class="k">টানা ৭ দিন পূর্ণ (আজ)</div><div class="v">${num(st.streak7)}</div></div>
      <div class="card stat"><div class="k">৭ দিনে নতুন ইউজার</div><div class="v">${num(st.new_users_7d)}</div><div class="muted small">ভিডিও দিয়েছে ${num(st.new_with_video_7d)}</div></div>
    </div>
    <h2>📅 প্রতিদিন চেক-ইন</h2>
    <div class="card">
      <label class="row" style="gap:8px"><input type="checkbox" id="gChk" ${S0.checkin_enabled !== false ? "checked" : ""} style="width:auto"> চেক-ইন চালু</label>
      <label class="small">৭ দিনের কয়েন (দিন ১ থেকে ৭)</label>
      <div class="row" style="gap:4px">${cr.map((c, i) => `<input type="number" min="0" class="gD" value="${Number(c)}" title="দিন ${i + 1}" style="flex:1;min-width:0;padding:8px 4px;text-align:center">`).join("")}</div>
      <div class="table-wrap" style="margin-top:10px"><table><tr><th>দিন</th><th>চেক-ইন</th><th>কয়েন</th></tr>${(st.days ?? []).map((d) => `<tr><td>${esc(d.day)}</td><td>${num(d.users)}</td><td>🪙 ${num(d.coins)}</td></tr>`).join("")}</table></div>
    </div>
    <h2>🎯 নতুনদের কাজ</h2>
    <div class="card">
      <label class="row" style="gap:8px"><input type="checkbox" id="gSt" ${S0.starter_enabled !== false ? "checked" : ""} style="width:auto"> নতুনদের চেকলিস্ট চালু</label>
      <div class="row" style="gap:8px"><div style="flex:1"><label class="small">অ্যাকাউন্ট খোলার কত দিন দেখাবে</label><input type="number" min="1" id="gDays" value="${Number(S0.starter_days ?? 7)}"></div>
        <div style="flex:1"><label class="small">কতজনকে ফলো</label><input type="number" min="1" id="gFol" value="${Number(S0.starter_follow_need ?? 3)}"></div></div>
      <div class="table-wrap"><table><tr><th>কাজ</th><th>কয়েন</th><th>নিয়েছে</th></tr>${TASKS.map(([k, t]) => `<tr><td>${t}</td><td><input type="number" min="0" class="gS" data-k="${k}" value="${Number(sr[k] ?? 0)}" style="width:80px;margin:0"></td><td>${num(sc[k]?.users ?? 0)} জন · 🪙 ${num(sc[k]?.coins ?? 0)}</td></tr>`).join("")}</table></div>
    </div>
    <h2>💎 ধনী লেভেল</h2>
    <div class="card">
      <label class="row" style="gap:8px"><input type="checkbox" id="gWe" ${S0.wealth_enabled !== false ? "checked" : ""} style="width:auto"> ব্যাজ দেখাবে (প্রোফাইল, চ্যাট, লাইভ)</label>
      <label class="small">Lv1 থেকে Lv10 — কত কয়েন কেনা বা খরচ (যেটা বেশি)। ১ কয়েন = ${taka(Number(S0.coin_price_paisa ?? 10))}</label>
      <div class="row" style="gap:4px;flex-wrap:wrap">${(Array.isArray(S0.wealth_levels) ? S0.wealth_levels : [1000, 3000, 10000, 30000, 100000, 300000, 1000000, 3000000, 10000000, 30000000]).map((c, i) => `<input type="number" min="1" class="gW" value="${Number(c)}" title="Lv${i + 1}" style="flex:1 1 30%;min-width:0;padding:8px 4px;text-align:center">`).join("")}</div>
    </div>
    <div class="card"><label class="row" style="gap:8px"><input type="checkbox" id="gDev" ${S0.bonus_need_device !== false ? "checked" : ""} style="width:auto"> এক মোবাইলে এক অ্যাকাউন্ট (শুধু APK-তে পুরস্কার) — প্রতারণা রোধে চালু রাখুন</label></div>
    <div class="toolbar"><button class="btn good" id="gSave">💾 সেভ করুন</button></div>`;
  $("#gSave").onclick = async () => {
    const days = [...view.querySelectorAll(".gD")].map((x) => Math.max(0, Math.round(Number(x.value) || 0)));
    const strw = Object.fromEntries([...view.querySelectorAll(".gS")].map((x) => [x.dataset.k, Math.max(0, Math.round(Number(x.value) || 0))]));
    const set = (k, v) => rpc("admin_set_setting", { p_key: k, p_value: v });
    await act(async () => {
      await set("checkin_enabled", $("#gChk").checked); await set("checkin_rewards", days);
      await set("starter_enabled", $("#gSt").checked); await set("starter_days", Math.max(1, Number($("#gDays").value) || 7));
      await set("starter_follow_need", Math.max(1, Number($("#gFol").value) || 3)); await set("starter_rewards", strw);
      await set("bonus_need_device", $("#gDev").checked);
      await set("wealth_enabled", $("#gWe").checked);
      const wl = [...view.querySelectorAll(".gW")].map((x) => Math.max(1, Math.round(Number(x.value) || 1)));
      for (let k = 1; k < wl.length; k++) if (wl[k] <= wl[k - 1]) throw new Error("ধনী লেভেলের সংখ্যা ছোট থেকে বড় ক্রমে দিন");
      await set("wealth_levels", wl);
    }, "✅ সেভ হয়েছে");
    launchGrow(tabs);
  };
}
routes.launch = async (arg = "locks") => {
  const tabs = (on) => `<div class="tabs"><a class="btn sm ${on === "locks" ? "on" : ""}" href="#launch/locks">🔒 ইনকাম লক</a><a class="btn sm ${on === "season" ? "on" : ""}" href="#launch/season">🏆 সিজন প্রতিযোগিতা</a><a class="btn sm ${on === "posts" ? "on" : ""}" href="#launch/posts">📢 অফার ও খবর</a><a class="btn sm ${on === "grow" ? "on" : ""}" href="#launch/grow">📅 চেক-ইন ও নতুনদের কাজ</a></div>`;
  loading();
  if (arg === "posts" || /^p(new|\d+)$/.test(arg)) return launchPosts(arg, tabs);
  if (arg === "grow") return launchGrow(tabs);
  if (arg === "locks") {
    const { data } = await sb.from("settings").select("value").eq("key", "income_locks").maybeSingle();
    const L = data?.value || {};
    const nLocked = LOCK_ITEMS.filter(([k]) => L[k] === true).length;
    view.innerHTML = `<h1>🚀 লঞ্চ অফার</h1>${tabs("locks")}
      <div class="card small" style="margin-bottom:12px">লক করা আয় অ্যাপে <b>🔒 শীঘ্রই আসছে</b> দেখাবে, আর সার্ভার সেই আয় দেবে না (লাইক, কমেন্ট, ভিউ সব স্বাভাবিক চলবে — শুধু টাকা/পয়েন্ট যোগ হবে না)।
        সবসময় চালু থাকবে: <b>🤝 রেফার বোনাস, 🏆 সিজন পুরস্কার, 🎁 গিফট</b>। নতুন ইউজার বোনাস আলাদা — <a href="#rules">ইনকাম রুলস</a> পেজে।</div>
      <div class="grid"><div class="card stat ${nLocked ? "alert" : ""}"><div class="k">লক করা</div><div class="v">${nLocked} / ${LOCK_ITEMS.length}</div></div></div>
      <div class="row" style="gap:8px;margin:8px 0 12px"><button class="btn sm" id="lkAll">🔒 সব লক করুন</button><button class="btn sm" id="lkNone">✅ সব খুলে দিন</button></div>
      <div class="list">${LOCK_ITEMS.map(([k, t, d]) => `<div class="item"><div class="top"><div><b>${t}</b><div class="muted small">${d}</div></div>
        <button class="btn sm ${L[k] ? "bad" : "good"}" data-lk="${k}" style="min-width:120px">${L[k] ? "🔒 লক (শীঘ্রই আসছে)" : "✅ চালু"}</button></div></div>`).join("")}</div>`;
    const save = async (nl, msg) => { await act(() => rpc("admin_set_setting", { p_key: "income_locks", p_value: nl }), msg); routes.launch("locks"); };
    view.querySelectorAll("[data-lk]").forEach((b) => (b.onclick = () => { const k = b.dataset.lk; save({ ...L, [k]: !L[k] }, L[k] ? "✅ চালু হয়েছে" : "🔒 লক হয়েছে"); }));
    $("#lkAll").onclick = () => save(Object.fromEntries(LOCK_ITEMS.map(([k]) => [k, true])), "🔒 সব লক হয়েছে");
    $("#lkNone").onclick = () => { if (confirm("সব আয় চালু করবেন? ইউজাররা আবার টাকা/পয়েন্ট পেতে শুরু করবে।")) save(Object.fromEntries(LOCK_ITEMS.map(([k]) => [k, false])), "✅ সব চালু হয়েছে"); };
    return;
  }
  const list = await rpc("admin_seasons");
  if (arg === "season") {
    view.innerHTML = `<h1>🚀 লঞ্চ অফার</h1>${tabs("season")}
      <div class="card small" style="margin-bottom:12px">নির্দিষ্ট সময়ের প্রতিযোগিতা। অ্যাপে লাইভ লিডারবোর্ড দেখাবে। সিজন শেষ হলে আপনি তালিকা যাচাই করে ভুয়া কাউকে বাদ দেবেন, তারপর <b>💰 পুরস্কার দিন</b> চাপলে
        বিজয়ীদের ব্যালেন্সে টাকা (উইথড্রযোগ্য), নোটিফিকেশন, ফ্রি 👑 ফ্রেম ও টপ ৩-এর ভিডিওতে ফ্রি বুস্ট চলে যাবে।</div>
      <a class="btn good" href="#launch/new" style="margin-bottom:12px">➕ নতুন সিজন</a>
      <div class="list">${list.map((s) => { const [t, c] = SEASON_STATE[s.state] || ["", ""]; return `<a class="item" href="#launch/s${s.id}" style="display:block">
        <div class="top"><b>${esc(s.title)}</b><span class="pill ${c}">${t}</span></div>
        <div class="meta">${new Date(s.starts_at).toLocaleString("bn-BD")} → ${new Date(s.ends_at).toLocaleString("bn-BD")}</div>
        <div class="small">🎬 ক্রিয়েটর পুরস্কার: ${s.creator_prizes.length ? `${s.creator_prizes.length} জন · ৳${num(prizeTotal(s.creator_prizes))}` : "বন্ধ"} &nbsp; 🤝 রেফার পুরস্কার: ${s.referral_prizes.length ? `${s.referral_prizes.length} জন · ৳${num(prizeTotal(s.referral_prizes))}` : "বন্ধ"}</div></a>`; }).join("") || `<div class="empty">এখনো কোনো সিজন নেই — "➕ নতুন সিজন" চাপুন</div>`}</div>`;
    return;
  }
  const isNew = arg === "new";
  const s = isNew ? { title: "🔥 লঞ্চ অফার — সিজন ১", title_en: "🔥 Launch offer — Season 1",
      notice: "নিজের বানানো আসল ভিডিও আপলোড করুন, বন্ধুদের রেফার করুন। ভুয়া অ্যাকাউন্ট, একই মোবাইলে একাধিক অ্যাকাউন্ট বা অন্যের ভিডিও দিলে পুরস্কার বাতিল।",
      notice_en: "Upload your own real videos and invite friends. Fake accounts, several accounts on one phone or other people's videos cancel the prize.",
      starts_at: new Date().toISOString(), ends_at: new Date(Date.now() + 30 * 864e5).toISOString(),
      creator_prizes: [3000, 2000, 1000, 400, 400, 400, 400, 400, 400, 400], referral_prizes: [],
      weights: { watch: 1, like: 2, comment: 3, share: 5, video: 20, referral: 50, actor_cap: 50 }, min_videos: 5, require_device: true, frame_days: 30, boost_days: 7, published: false, state: "draft" }
    : list.find((x) => "s" + x.id === arg);
  if (!s) { view.innerHTML = `<div class="empty">সিজন পাওয়া যায়নি</div>`; return; }
  const W = s.weights || {};
  const locked = s.state === "paid";
  const wIn = (k, l) => `<div><label class="small">${l}</label><input type="number" min="0" data-w="${k}" value="${esc(W[k] ?? 0)}" ${locked ? "disabled" : ""}></div>`;
  const [cb, rb] = isNew ? [[], []] : await Promise.all([rpc("admin_season_board", { p_id: s.id, p_board: "creator", p_limit: 100 }), rpc("admin_season_board", { p_id: s.id, p_board: "referral", p_limit: 100 })]);
  const board = (rows, prizes) => `<div class="list">${rows.map((r) => `<div class="item" style="${r.eligible ? "" : "opacity:.65"}">
      <div class="top"><b>${r.rank ? (r.rank <= 3 ? ["🥇", "🥈", "🥉"][r.rank - 1] : "#" + r.rank) : "—"} <a href="#lookup/${r.user_no}">${esc(r.full_name || r.username)}</a></b><span class="amt">${num(r.score)}</span></div>
      <div class="meta">@${esc(r.username)} · ID ${r.user_no}${r.country_code ? " · " + esc(r.country_code) : ""} · ${partsTxt(r.parts)}</div>
      <div class="row" style="gap:8px;align-items:center;flex-wrap:wrap">
        <span class="small">${r.eligible ? "✅ যোগ্য" : "⛔ " + (WHY_TXT[r.why] || r.why || "")}${r.why === "videos" ? ` (${num(r.parts?.video)}/${s.min_videos})` : ""}</span>
        ${r.rank && prizes[r.rank - 1] ? `<span class="pill paid">🎁 ৳${num(prizes[r.rank - 1])}</span>` : ""}
        ${r.shared_device ? `<span class="small" style="color:var(--warn)">⚠️ একই মোবাইলে অন্য অ্যাকাউন্ট</span>` : ""}
        ${r.reason ? `<span class="muted small">${esc(r.reason)}</span>` : ""}
        <span style="margin-left:auto">${locked ? "" : r.excluded ? `<button class="btn sm" data-ex="${r.user_id}" data-on="0">↩️ ফেরত</button>` : r.why === "admin" ? "" : `<button class="btn sm bad" data-ex="${r.user_id}" data-on="1">🚫 বাদ</button>`}</span></div></div>`).join("")
      || `<div class="empty">এখনো কেউ নেই</div>`}</div>`;
  const [stTxt, stCls] = SEASON_STATE[s.state] || ["", ""];
  view.innerHTML = `<h1>🚀 লঞ্চ অফার</h1>${tabs("season")}
    <p><a href="#launch/season">← সব সিজন</a> &nbsp; <span class="pill ${stCls}">${stTxt}</span></p>
    ${isNew ? "" : `<div class="grid">
      <div class="card stat"><div class="k">শেষ হবে</div><div class="v" style="font-size:16px">${new Date(s.ends_at).toLocaleString("bn-BD")}</div></div>
      <div class="card stat"><div class="k">মোট পুরস্কার</div><div class="v">৳${num(prizeTotal(s.creator_prizes) + prizeTotal(s.referral_prizes))}</div></div>
      <div class="card stat"><div class="k">প্রতিযোগী (যোগ্য)</div><div class="v">${num(cb.filter((r) => r.rank).length + rb.filter((r) => r.rank).length)}</div></div></div>
      ${s.state === "ended" ? `<div class="card" style="border-color:var(--good)"><b>🏁 সিজন শেষ।</b> নিচের তালিকা দেখে ভুয়া কাউকে "🚫 বাদ" দিন (⚠️ চিহ্ন খেয়াল করুন), তারপর:
        <button class="btn good" id="sPay" style="margin-top:8px;width:100%">💰 পুরস্কার দিন</button></div>` : ""}
      ${s.creator_prizes.length ? `<h2>🎬 সেরা ক্রিয়েটর</h2>${board(cb, s.creator_prizes)}` : ""}
      ${s.referral_prizes.length ? `<h2>🤝 সেরা রেফারকারী</h2>${board(rb, s.referral_prizes)}` : ""}`}
    <h2>${isNew ? "➕ নতুন সিজন" : "✏️ সিজনের নিয়ম"}</h2>
    <div class="card"><fieldset style="border:0;padding:0;margin:0" ${locked ? "disabled" : ""}>
      <label class="small">নাম</label><input id="sT" value="${esc(s.title)}">
      <label class="small">নাম — English</label><input id="sTe" value="${esc(s.title_en ?? "")}">
      <div class="row" style="gap:8px"><div style="flex:1"><label class="small">শুরু</label><input id="sS" type="datetime-local" value="${toLocalInput(s.starts_at)}"></div>
        <div style="flex:1"><label class="small">শেষ</label><input id="sE" type="datetime-local" value="${toLocalInput(s.ends_at)}"></div></div>
      <label class="small">🎬 সেরা ক্রিয়েটর পুরস্কার (টাকা, কমা দিয়ে — ১ম, ২য়, ৩য়…; খালি = এই তালিকা বন্ধ)</label><input id="sCp" value="${esc(s.creator_prizes.join(", "))}" placeholder="3000, 2000, 1000, 400, 400">
      <label class="small">🤝 সেরা রেফারকারী পুরস্কার (টাকা, কমা দিয়ে; খালি = বন্ধ)</label><input id="sRp" value="${esc(s.referral_prizes.join(", "))}" placeholder="যেমন 1000, 500, 300">
      <div class="muted small" id="sSum"></div>
      <b style="display:block;margin-top:12px">স্কোরের নিয়ম (প্রতিটার পয়েন্ট)</b>
      <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px">
        ${wIn("watch", "👀 পুরো ভিডিও দেখা")}${wIn("like", "❤️ লাইক")}${wIn("comment", "💬 কমেন্ট (ভিডিও প্রতি)")}${wIn("share", "🔁 শেয়ার")}${wIn("video", "🎬 অনুমোদিত ভিডিও")}${wIn("referral", "🤝 সফল রেফার")}${wIn("actor_cap", "একজন দর্শক সর্বোচ্চ দিতে পারবে (০ = সীমা নেই)")}</div>
      <div class="row" style="gap:8px;flex-wrap:wrap">
        <div style="flex:1;min-width:130px"><label class="small">ক্রিয়েটরের কমপক্ষে অনুমোদিত ভিডিও</label><input id="sMv" type="number" min="0" value="${s.min_videos}"></div>
        <div style="flex:1;min-width:130px"><label class="small">ফ্রি 👑 ফ্রেম (দিন, ০ = না)</label><input id="sFd" type="number" min="0" value="${s.frame_days}"></div>
        <div style="flex:1;min-width:130px"><label class="small">টপ ৩-এর ভিডিও ফ্রি বুস্ট (দিন)</label><input id="sBd" type="number" min="0" value="${s.boost_days}"></div></div>
      <label class="small">শুধু APK থেকে লগইন করা ইউজার গোনা হবে (ভুয়া ঠেকাতে)</label><select id="sRd"><option value="true" ${s.require_device ? "selected" : ""}>হ্যাঁ (পরামর্শ)</option><option value="false" ${s.require_device ? "" : "selected"}>না</option></select>
      <label class="small">নিয়মের নোটিশ (অ্যাপে দেখাবে)</label><textarea id="sN" rows="3">${esc(s.notice ?? "")}</textarea>
      <label class="small">নিয়মের নোটিশ — English</label><textarea id="sNe" rows="3">${esc(s.notice_en ?? "")}</textarea>
      <label class="small">অ্যাপে দেখাবে?</label><select id="sP"><option value="true" ${s.published ? "selected" : ""}>✅ হ্যাঁ, প্রকাশ করুন</option><option value="false" ${s.published ? "" : "selected"}>📝 না, খসড়া রাখুন</option></select>
      <div class="row" style="gap:8px;margin-top:12px"><button class="btn good" id="sSave">💾 সেভ</button>${isNew ? "" : `<button class="btn bad" id="sDel">🗑️ মুছুন</button>`}</div>
    </fieldset></div>`;
  const parse = (v) => v.split(/[,\s]+/).map((x) => parseInt(x.replace(/[^\d]/g, ""), 10)).filter((x) => x > 0);
  const sum = () => { const c = parse($("#sCp").value), r = parse($("#sRp").value); $("#sSum").textContent = `মোট খরচ: ৳${num(prizeTotal(c) + prizeTotal(r))} (ক্রিয়েটর ${c.length} জন · রেফার ${r.length} জন)`; };
  $("#sCp").oninput = $("#sRp").oninput = sum; sum();
  $("#sSave").onclick = async () => {
    const st = new Date($("#sS").value), en = new Date($("#sE").value);
    if (!(en > st)) return toast("শেষের সময় শুরুর পরে হতে হবে", true);
    const weights = {}; view.querySelectorAll("[data-w]").forEach((i) => (weights[i.dataset.w] = Math.max(0, Number(i.value) || 0)));
    const p = { id: isNew ? null : s.id, title: $("#sT").value, title_en: $("#sTe").value, notice: $("#sN").value, notice_en: $("#sNe").value,
      starts_at: st.toISOString(), ends_at: en.toISOString(), creator_prizes: parse($("#sCp").value), referral_prizes: parse($("#sRp").value), weights,
      min_videos: Number($("#sMv").value) || 0, require_device: $("#sRd").value === "true", frame_days: Number($("#sFd").value) || 0,
      boost_days: Number($("#sBd").value) || 0, published: $("#sP").value === "true" };
    const id = await act(() => rpc("admin_save_season", { p }), p.published ? "✅ সেভ ও প্রকাশ হয়েছে" : "💾 খসড়া সেভ হয়েছে");
    if (id) location.hash = "#launch/s" + id; else routes.launch(arg);
  };
  $("#sDel")?.addEventListener("click", async () => { if (!confirm("এই সিজন মুছবেন?")) return; await act(() => rpc("admin_delete_season", { p_id: s.id }), "মুছে ফেলা হয়েছে"); location.hash = "#launch/season"; });
  view.querySelectorAll("[data-ex]").forEach((b) => (b.onclick = async () => {
    const on = b.dataset.on === "1";
    const reason = on ? prompt("কেন বাদ দিচ্ছেন? (যেমন: ভুয়া লাইক, একই মোবাইলে অনেক অ্যাকাউন্ট)", "ভুয়া অ্যাকাউন্ট/লাইক") : null;
    if (on && reason === null) return;
    await act(() => rpc("admin_season_exclude", { p_id: s.id, p_user: b.dataset.ex, p_on: on, p_reason: reason }), on ? "🚫 বাদ দেওয়া হয়েছে" : "↩️ ফেরত আনা হয়েছে");
    routes.launch(arg);
  }));
  $("#sPay")?.addEventListener("click", async (e) => {
    const nW = Math.min(cb.filter((r) => r.rank).length, s.creator_prizes.length) + Math.min(rb.filter((r) => r.rank).length, s.referral_prizes.length);
    if (!confirm(`${nW} জন বিজয়ীকে পুরস্কার দেবেন? টাকা সাথে সাথে তাদের উইথড্রযোগ্য ব্যালেন্সে যাবে, এটা আর ফেরানো যাবে না।`)) return;
    e.target.disabled = true;
    const r = await act(() => rpc("admin_season_pay", { p_id: s.id })).catch(() => null);
    if (r) { toast(`🎉 ${r.winners} জনকে মোট ${taka(r.paisa)} দেওয়া হয়েছে`); routes.launch(arg); } else e.target.disabled = false;
  });
};

// ---------- ভিডিও স্টোরেজ (Cloudflare R2) ----------
const R2_ERR = (r) => {
  const e = String(r?.error || "");
  if (r?.error === "MISSING") return "সব ঘর পূরণ করুন: " + (r.missing || []).join(", ");
  if (r?.step === "upload") {
    if (/NoSuchBucket|_404/.test(e)) return "Bucket-এর নাম ভুল (Cloudflare-এ যে নাম দিয়েছেন হুবহু সেটা দিন)";
    if (/_403|SignatureDoesNotMatch|InvalidAccessKeyId|Unauthorized|_401/.test(e)) return "Access Key / Secret Key ভুল, অথবা token-এ Object Read & Write অনুমতি নেই";
    if (/fetch|dns|resolve|connect/i.test(e)) return "Account ID ভুল";
    return "R2-তে আপলোড হয়নি: " + e;
  }
  if (r?.step === "public") return "ফাইল R2-তে গেছে, কিন্তু পাবলিক লিংকে খুলছে না — Bucket → Settings → Public Development URL চালু করে সেই লিংকটা (https://pub-….r2.dev) দিন (" + e + ")";
  return e || "ব্যর্থ";
};
routes.storage = async () => {
  view.innerHTML = `<h1>☁️ ভিডিও স্টোরেজ</h1><div class="empty">লোড হচ্ছে…</div>`;
  const st = await rpc("admin_r2_status");
  const ready = st.account && st.bucket && st.public_url && st.has_key && st.has_secret;
  const pct = Math.min(100, Math.round((Number(st.supabase_mb) || 0) / 1024 * 100));
  view.innerHTML = `<h1>☁️ ভিডিও স্টোরেজ</h1>
    <div class="grid">
      <div class="card stat ${st.enabled ? "" : "alert"}"><div class="k">Cloudflare R2</div><div class="v" style="font-size:18px">${st.enabled ? "✅ চালু" : ready ? "⏸️ বন্ধ" : "❌ সেটআপ হয়নি"}</div></div>
      <div class="card stat"><div class="k">R2-তে ভিডিও</div><div class="v">${st.on_r2}</div></div>
      <div class="card stat"><div class="k">Supabase-এ ভিডিও</div><div class="v">${st.on_supabase}</div></div>
      <div class="card stat ${pct > 80 ? "alert" : ""}"><div class="k">Supabase জায়গা (১ GB)</div><div class="v" style="font-size:18px">${st.supabase_mb} MB · ${pct}%</div></div>
    </div>
    <div class="card">
      <p class="small">চালু থাকলে প্রতিটি নতুন ভিডিও আপলোডের ১–২ মিনিট পর নিজে থেকেই R2-তে চলে যায় আর Supabase থেকে মুছে যায়। পুরনো ভিডিওগুলোও একই ভাবে সরে যাবে। R2-তে ১০ GB জায়গা সারাজীবন ফ্রি, ভিডিও দেখা ও ডাউনলোডের কোনো খরচ নেই। অ্যাপ আপডেট লাগবে না।</p>
      ${st.failed ? `<p class="small" style="color:var(--bad)">⚠️ ${st.failed}টি ভিডিও ৫ বার চেষ্টা করেও সরানো যায়নি। <button class="btn sm" id="r2Retry">আবার চেষ্টা</button></p>` : ""}
      <div class="row" style="gap:8px;flex-wrap:wrap">
        ${st.enabled ? `<button class="btn bad" id="r2Off">⏸️ বন্ধ করুন</button>` : `<button class="btn good" id="r2On" ${ready ? "" : "disabled"}>▶️ চালু করুন</button>`}
        ${ready ? `<button class="btn" id="r2Run">🚚 এখনই সরান</button><button class="btn" id="r2Test">🧪 পরীক্ষা</button>` : ""}
      </div>
      <p class="small" id="r2Msg" style="margin-top:8px"></p>
    </div>
    <h2>🔑 Cloudflare R2 সেটআপ</h2>
    <div class="card">
      <ol class="small" style="padding-left:18px;margin:0 0 10px">
        <li>মোবাইলের Chrome-এ <b>dash.cloudflare.com</b> খুলে লগইন করুন → মেনু থেকে <b>R2 Object Storage</b>।</li>
        <li><b>Create bucket</b> → নাম দিন <code>reels-videos</code> → <b>Create bucket</b>।</li>
        <li>bucket খুলে <b>Settings</b> → <b>Public Development URL</b> → <b>Enable</b> → <code>allow</code> লিখে নিশ্চিত করুন → যে লিংক আসবে (<code>https://pub-….r2.dev</code>) সেটা কপি করে নিচে বসান।</li>
        <li>R2-এর মূল পেজে ফিরে <b>Account ID</b> কপি করুন (ডানে বা নিচে দেখা যায়)।</li>
        <li><b>Manage API tokens</b> (বা API Tokens) → <b>Create API token</b> → Permissions: <b>Object Read &amp; Write</b> → Specify bucket: <b>reels-videos</b> → <b>Create</b>।</li>
        <li>যে <b>Access Key ID</b> আর <b>Secret Access Key</b> দেখাবে, দুটোই কপি করে নিচে বসান। Secret একবারই দেখায় — এখনই বসান।</li>
        <li><b>সেভ ও পরীক্ষা</b> চাপুন। ✅ এলে উপরে <b>চালু করুন</b> চাপুন।</li>
      </ol>
      <label class="small">Account ID</label><input id="r2Acc" value="${esc(st.account ?? "")}" placeholder="32 অক্ষরের ID" autocomplete="off">
      <label class="small">Bucket-এর নাম</label><input id="r2Bk" value="${esc(st.bucket ?? "reels-videos")}" autocomplete="off">
      <label class="small">Public URL (r2.dev লিংক)</label><input id="r2Pub" value="${esc(st.public_url ?? "")}" placeholder="https://pub-xxxx.r2.dev" autocomplete="off">
      <label class="small">Access Key ID</label><input id="r2Key" type="password" placeholder="${st.has_key ? "✅ সেভ আছে (বদলাতে নতুনটা দিন)" : ""}" autocomplete="off">
      <label class="small">Secret Access Key</label><input id="r2Sec" type="password" placeholder="${st.has_secret ? "✅ সেভ আছে (বদলাতে নতুনটা দিন)" : ""}" autocomplete="off">
      <button class="btn good" id="r2Save" style="margin-top:10px">সেভ ও পরীক্ষা</button>
      <p class="muted small" style="margin-top:8px">Key-গুলো শুধু সার্ভারে থাকে, অ্যাডমিন প্যানেল বা অ্যাপ থেকে আর পড়া যায় না।</p>
    </div>`;
  const msg = (t, bad) => { const m = $("#r2Msg"); m.textContent = t; m.style.color = bad ? "var(--bad)" : ""; };
  const call = async (action) => {
    const { data, error } = await sb.functions.invoke("r2-move", { body: { action } });
    if (error && !data) throw new Error(error.message);
    return data;
  };
  const test = async () => {
    msg("🧪 পরীক্ষা হচ্ছে…");
    const r = await call("test");
    if (r?.ok) { msg("✅ সব ঠিক আছে — R2-তে আপলোড আর পাবলিক লিংক দুটোই কাজ করছে"); toast("✅ R2 ঠিক আছে"); return true; }
    msg("❌ " + R2_ERR(r), true); return false;
  };
  $("#r2Save").onclick = async (e) => {
    let acc = $("#r2Acc").value.trim();
    const m = acc.match(/([0-9a-f]{32})/i); if (m) acc = m[1].toLowerCase();
    const vals = { r2_account_id: acc, r2_bucket: $("#r2Bk").value.trim(), r2_public_url: $("#r2Pub").value.trim(), r2_access_key: $("#r2Key").value.trim(), r2_secret_key: $("#r2Sec").value.trim() };
    if (vals.r2_account_id && !/^[0-9a-f]{32}$/.test(vals.r2_account_id)) return toast("Account ID ঠিক নয় (৩২ অক্ষর)", true);
    if (vals.r2_public_url && !/^https:\/\//.test(vals.r2_public_url)) return toast("Public URL https:// দিয়ে শুরু হবে", true);
    e.target.disabled = true;
    try {
      for (const [k, v] of Object.entries(vals)) if (v) await rpc("admin_set_private_config", { p_key: k, p_value: v });
      toast("সেভ হয়েছে");
      const ok = await test();
      if (ok) setTimeout(() => routes.storage(), 1500);
    } catch (er) { toast(errMsg(er), true); }
    e.target.disabled = false;
  };
  $("#r2Test")?.addEventListener("click", () => test().catch((er) => msg("❌ " + errMsg(er), true)));
  $("#r2On")?.addEventListener("click", async () => {
    if (!(await test().catch(() => false))) return;
    await act(() => rpc("admin_set_setting", { p_key: "r2_enabled", p_value: true }), "✅ চালু হয়েছে — ভিডিওগুলো ১–২ মিনিটের মধ্যে সরে যাবে");
    routes.storage();
  });
  $("#r2Off")?.addEventListener("click", async () => { await act(() => rpc("admin_set_setting", { p_key: "r2_enabled", p_value: false }), "বন্ধ হয়েছে — নতুন ভিডিও Supabase-এ থাকবে"); routes.storage(); });
  $("#r2Run")?.addEventListener("click", async (e) => {
    e.target.disabled = true; msg("🚚 সরানো হচ্ছে… (১–২ মিনিট লাগতে পারে)");
    try {
      const r = await call("run");
      if (!r?.ok) throw new Error(R2_ERR(r));
      const mb = (r.moved || []).reduce((a, x) => a + (x.mb || 0), 0);
      msg(`✅ ${r.moved.length}টি সরানো হয়েছে (${mb.toFixed(1)} MB)` + (r.failed?.length ? ` · ❌ ${r.failed.length}টি ব্যর্থ: ${r.failed[0].error}` : "") + (r.moved.length ? "" : " — আপলোডের ১ মিনিট পরের ভিডিওই সরে"));
      setTimeout(() => routes.storage(), 2500);
    } catch (er) { msg("❌ " + errMsg(er), true); e.target.disabled = false; }
  });
  $("#r2Retry")?.addEventListener("click", async () => { const n = await act(() => rpc("admin_r2_retry"), "আবার চেষ্টা হবে"); if (n !== undefined) routes.storage(); });
};

routes.appupdate = async () => {
  view.innerHTML = `<h1>📲 অ্যাপ আপডেট</h1><div class="empty">লোড হচ্ছে…</div>`;
  const keys = ["latest_app_build", "min_app_build", "apk_url", "update_message", "update_message_en", "play_latest_build", "play_min_build"];
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
      <label class="small">ইউজারকে বার্তা — English</label><textarea id="umsE" rows="2">${esc(S2.update_message_en ?? "")}</textarea>
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
    const vals = { latest_app_build: Number($("#ul").value) || 0, min_app_build: Number($("#um").value) || 0, apk_url: $("#uu").value.trim(), update_message: $("#ums").value.trim(), update_message_en: $("#umsE").value.trim(), ...over };
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
    <h2>🎬 ভিডিও আপলোড পুরস্কার</h2><div class="list">
      ${row("upload_reward_coins", "এডমিন ভিডিও অ্যাপ্রুভ করলে আপলোডার কত কয়েন পাবে (০ = বন্ধ)", "num")}
      ${row("auto_approve_minutes", "অটো-অ্যাপ্রুভ (মিনিট, ০ = শুধু এডমিন দেখে অ্যাপ্রুভ)", "num")}
    </div>
    <h2>👀 দর্শক (ভিডিও পুরো দেখলে)</h2><div class="list">
      ${row("watch_points", "প্রতিটা ভিডিও পুরো দেখলে পয়েন্ট", "num")}
      ${row("watch_full_pct", "ভিডিওর কত % দেখলে পুরো দেখা ধরা হবে", "num")}
      ${row("viewer_daily_points_cap", "দিনে সর্বোচ্চ পয়েন্ট (ভিডিও দেখে)", "num")}
      ${row("point_value_paisa", "১ পয়েন্টের দাম", "taka")}
      ${row("points_convert_min", "কমপক্ষে কত পয়েন্ট হলে টাকায় নেওয়া যাবে", "num")}
      <div class="item"><b>অ্যাড দেখে পয়েন্ট</b><div class="muted small">দর্শক ${num(ads?.viewer_points)} · ক্রিয়েটর ${num(ads?.creator_points)} · দিনে ${num(ads?.daily_cap)} বার — <a href="#ads">অ্যাড পেজে</a> বদলান</div></div>
    </div>
    <h2>🤝 রেফার</h2><a class="card" href="#referrals" style="display:block;margin-bottom:12px"><b>🎁 রেফার পেজে যান →</b>
      <div class="muted small">রেফারের বোনাস, টাস্ক (ভিডিও দেখা, লাইক, পোস্ট…), সময়সীমা, অফার ও বোনাস ধাপ এখন আলাদা পেজে।</div></a>
    <h2>📤 আপলোড, জেল, হোস্ট ও প্রিমিয়াম</h2><div class="list">
      ${row("daily_upload_limit", "নতুন ইউজার দিনে কয়টি ভিডিও আপলোড করতে পারবে (কারো জন্য আলাদা করতে ইউজার খুঁজুন পেজে যান)", "num")}
      ${row("jail_release_coins", "জেল থেকে মুক্ত হতে ডিফল্ট কয়েন", "num")}
      ${row("host_auto_approve", "হোস্ট আবেদন অটো অনুমোদন", "bool")}
      ${row("premium_default_coins", "প্রিমিয়াম ভিডিও দেখার ডিফল্ট কয়েন", "num")}
      ${row("premium_creator_pct", "প্রিমিয়াম আনলকের কত % ক্রিয়েটর পাবে", "num")}
      ${row("premium_upload_hosts_only", "শুধু হোস্টরা প্রিমিয়াম ভিডিও দিতে পারবে", "bool")}
      ${row("premium_download_coins", "প্রিমিয়াম ভিডিও ডাউনলোড করতে কত কয়েন লাগবে (০ = প্রিমিয়াম ডাউনলোড বন্ধ; ক্রিয়েটর প্রিমিয়ামের % পাবে)", "num")}
      ${row("premium_notice", "প্রিমিয়াম আপলোডের নোটিশ (হোস্টরা আপলোডের সময় দেখবে)", "text")}
      ${row("premium_notice_en", "প্রিমিয়াম আপলোডের নোটিশ — English (English বেছে নেওয়া ইউজাররা দেখবে)", "text")}
      ${row("cashin_notice", "কয়েন কেনার পেজের নোটিশ (সব ইউজার নম্বরের নিচে দেখবে)", "text")}
      ${row("cashin_notice_en", "কয়েন কেনার পেজের নোটিশ — English (English বেছে নেওয়া ইউজাররা দেখবে)", "text")}
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
      ${row("text_notice_en", "টেক্সট আর্নিং নোটিশ — English", "text")}
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

// ---------- 💎 আয়ের ফিচার: রিওয়ার্ড পুল · VIP · দোকান · বুস্ট · স্পন্সর ----------
const MON_TABS = [["pool", "💰 রিওয়ার্ড পুল"], ["vip", "💎 VIP"], ["store", "🎨 দোকান"], ["boost", "🚀 বুস্ট"], ["sponsor", "📢 স্পন্সর"]];
const STYLE_OPTS = { frame: [["gold", "সোনালি"], ["rainbow", "রংধনু (চলমান)"], ["neon", "নিয়ন (জ্বলজ্বলে)"], ["flower", "ফুল 🌸"], ["fire", "আগুন 🔥"], ["crown", "মুকুট 👑"]],
  entry: [["stars", "তারা ✨"], ["fire", "আগুন 🔥"], ["royal", "রাজকীয় 👑"], ["rocket", "রকেট 🚀"]],
  bubble: [["pink", "গোলাপি"], ["ocean", "সাগর নীল"], ["gold", "সোনালি"], ["night", "রাতের বেগুনি"]] };
routes.monetize = async (tab = "pool") => {
  if (!MON_TABS.some((t) => t[0] === tab)) tab = "pool";
  loading();
  const [{ data: st }, stats] = await Promise.all([sb.from("settings").select("key,value"), rpc("admin_monetize_stats", { p_days: 30 }).catch(() => ({}))]);
  const S2 = Object.fromEntries((st ?? []).map((x) => [x.key, x.value]));
  const row = (key, label, kind) => {
    const v = S2[key];
    return `<div class="item" data-key="${key}" data-kind="${kind}"><div class="top"><b>${label}</b></div><div class="row" style="flex-wrap:nowrap">${kind === "bool"
      ? `<select name="v"><option value="true" ${v === true ? "selected" : ""}>চালু</option><option value="false" ${v === false ? "selected" : ""}>বন্ধ</option></select>`
      : `<input name="v" type="number" step="${kind === "taka" ? "0.01" : "1"}" min="0" value="${esc(kind === "taka" ? Number(v ?? 0) / 100 : v ?? 0)}">${kind === "taka" ? '<span class="muted">৳</span>' : ""}`}
      <button class="btn sm good" data-save>সেভ</button></div></div>`;
  };
  const tabsHtml = `<div class="tabs">${MON_TABS.map(([k, l]) => `<a class="btn sm ${k === tab ? "on" : ""}" href="#monetize/${k}">${l}</a>`).join("")}</div>`;
  const statHtml = `<div class="grid">
    <div class="card stat"><div class="k">এখন VIP</div><div class="v">${num(stats.vip_active)}</div></div>
    <div class="card stat"><div class="k">VIP থেকে কয়েন (৩০ দিন)</div><div class="v">🪙 ${num(stats.vip_coins)}</div></div>
    <div class="card stat"><div class="k">দোকান থেকে কয়েন</div><div class="v">🪙 ${num(stats.store_coins)}</div></div>
    <div class="card stat"><div class="k">বুস্ট থেকে কয়েন</div><div class="v">🪙 ${num(stats.boost_coins)}</div></div></div>`;
  let body = "";
  if (tab === "pool") {
    const today = new Date(Date.now() + 6 * 3600e3).toISOString().slice(0, 10);
    const tp = await rpc("pool_today").catch(() => null);
    body = `<div class="card small" style="margin-bottom:12px">প্রতিদিন যত টাকার কয়েন বিক্রি হয় (বিকাশ/নগদ অনুমোদিত + Google Play), তার <b>নির্দিষ্ট %</b> পুলে যায়।
      বাংলাদেশ সময় রাত ১২:১০-এ আগের দিনের পুল দর্শকদের মধ্যে তাদের পয়েন্ট অনুযায়ী ভাগ হয় (পেন্ডিং ব্যালেন্সে)। আয় যত, দেওয়াও তত — কখনো লোকসান হবে না।
      <br>⚠️ পুল চালু থাকলে "পয়েন্ট → টাকা" রূপান্তর বন্ধ থাকবে (দুবার পেমেন্ট এড়াতে)।</div>
      <div class="grid"><div class="card stat"><div class="k">আজ এখন পর্যন্ত পুল</div><div class="v">${taka(tp?.pool_paisa ?? 0)}</div></div>
        <div class="card stat"><div class="k">আজ মোট পয়েন্ট</div><div class="v">${num(tp?.total_points ?? 0)}</div></div></div>
      <div class="list">${row("pool_enabled", "রিওয়ার্ড পুল চালু", "bool")}${row("pool_pct", "কয়েন বিক্রির কত % পুলে যাবে", "num")}
        ${row("pool_user_cap_paisa", "একজন দিনে সর্বোচ্চ কত পাবে (০ = সীমা নেই)", "taka")}${row("pool_min_points", "ভাগ পেতে দিনে কমপক্ষে কত পয়েন্ট", "num")}
        ${row("play_net_pct", "Google Play কেনার কত % আপনার হাতে আসে", "num")}</div>
      <div class="card" style="max-width:520px;margin-top:12px"><b>➕ আজকের পুলে বাড়তি টাকা যোগ</b><div class="muted small">যেমন অ্যাড বা স্পন্সর থেকে আয়ের একটা অংশ দর্শকদের দিতে চাইলে।</div>
        <div class="row" style="gap:8px;margin-top:6px"><input type="number" id="pxAmt" min="0" step="1" placeholder="টাকা" style="flex:1"><button class="btn good" id="pxSave">আজকের পুলে যোগ</button></div></div>
      <h2>📜 আগের দিনের পুল</h2><div class="table-wrap"><table><tr><th>দিন</th><th class="num">আয়</th><th class="num">%</th><th class="num">বাড়তি</th><th class="num">পুল</th><th class="num">জন</th><th class="num">দেওয়া</th></tr>
        ${(stats.pools ?? []).map((r) => `<tr><td>${r.day}</td><td class="num">${taka(r.revenue_paisa)}</td><td class="num">${r.pct}</td><td class="num">${taka(r.extra_paisa)}</td><td class="num">${taka(r.pool_paisa)}</td><td class="num">${num(r.users)}</td><td class="num">${r.settled_at ? taka(r.paid_paisa) : "—"}</td></tr>`).join("") || `<tr><td colspan="7" class="muted">এখনো নেই</td></tr>`}</table></div>`;
    view.innerHTML = `<h1>💎 আয়ের ফিচার</h1>${tabsHtml}${body}`;
    $("#pxSave").onclick = async () => {
      const t = Number($("#pxAmt").value); if (!(t >= 0)) return toast("টাকা লিখুন", true);
      await act(() => rpc("admin_pool_extra", { p_day: today, p_paisa: Math.round(t * 100) }), "পুলে যোগ হয়েছে"); routes.monetize("pool");
    };
  } else if (tab === "vip") {
    const { data: plans } = await sb.from("vip_plans").select("*").order("sort");
    view.innerHTML = `<h1>💎 আয়ের ফিচার</h1>${tabsHtml}${statHtml}
      <div class="list">${row("vip_enabled", "VIP মেম্বারশিপ চালু", "bool")}</div>
      <p class="muted small">ইউজার কয়েন দিয়ে VIP কেনে। সুবিধা: ব্যাজ, প্রতিদিন ফ্রি কয়েন, ভিডিও দেখার পয়েন্টে বোনাস %, লাইভে VIP এন্ট্রি, শুধু-VIP ফ্রেম।
        ⚠️ প্রতিদিনের ফ্রি কয়েন × দিন যেন দামের অর্ধেকের কম থাকে, নইলে লোকসান।</p>
      <h2>প্ল্যান</h2><div class="table-wrap"><table id="vpT"><tr><th>নাম</th><th>ব্যাজ</th><th>রং</th><th class="num">দিন</th><th class="num">দাম 🪙</th><th class="num">দৈনিক 🪙</th><th class="num">পয়েন্ট বোনাস %</th><th>চালু</th><th></th></tr>
        ${[...(plans ?? []), { id: "new", name: "", badge: "💎", color: "gold", days: 30, price_coins: "", daily_coins: 0, points_bonus_pct: 0, active: true, sort: 9 }].map((p) => `<tr data-id="${p.id}">
          <td><input name="name" value="${esc(p.name)}" placeholder="যেমন VIP"></td><td><input name="badge" value="${esc(p.badge)}" style="width:50px"></td>
          <td><select name="color">${["gold", "purple", "pink", "blue"].map((c) => `<option ${c === p.color ? "selected" : ""}>${c}</option>`).join("")}</select></td>
          <td><input name="days" type="number" min="1" value="${p.days}" style="width:70px"></td><td><input name="price" type="number" min="1" value="${p.price_coins}" style="width:90px"></td>
          <td><input name="daily" type="number" min="0" value="${p.daily_coins}" style="width:70px"></td><td><input name="bonus" type="number" min="0" value="${p.points_bonus_pct}" style="width:70px"></td>
          <td><input name="active" type="checkbox" ${p.active ? "checked" : ""} style="width:auto"></td><td><button class="btn sm good" data-vs>${p.id === "new" ? "যোগ" : "সেভ"}</button></td></tr>`).join("")}</table></div>
      <h2>এখনকার VIP</h2><div class="table-wrap"><table><tr><th>ID</th><th>ইউজার</th><th>প্ল্যান</th><th>মেয়াদ</th></tr>
        ${(stats.vip_users ?? []).map((u) => `<tr><td><a href="#lookup/${u.user_no}">${u.user_no}</a></td><td>@${esc(u.username)}</td><td>${esc(u.plan ?? "")}</td><td>${dt(u.vip_until)}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">এখনো কেউ নেই</td></tr>`}</table></div>`;
    $("#vpT").onclick = async (e) => {
      const b = e.target.closest("[data-vs]"); if (!b) return;
      const tr = b.closest("tr"), g = (n2) => tr.querySelector(`[name=${n2}]`);
      await act(() => rpc("admin_save_vip_plan", { p_id: tr.dataset.id === "new" ? null : Number(tr.dataset.id), p_name: g("name").value.trim(), p_days: Number(g("days").value),
        p_price: Number(g("price").value), p_daily: Number(g("daily").value), p_bonus: Number(g("bonus").value), p_badge: g("badge").value.trim(), p_color: g("color").value,
        p_active: g("active").checked, p_sort: 0 }), "সেভ হয়েছে");
      if (tr.dataset.id === "new") routes.monetize("vip");
    };
  } else if (tab === "store") {
    const { data: items } = await sb.from("store_items").select("*").order("kind").order("sort");
    const kinds = { frame: "🖼️ ফ্রেম", entry: "✨ এন্ট্রি", bubble: "💬 চ্যাট বাবল" };
    view.innerHTML = `<h1>💎 আয়ের ফিচার</h1>${tabsHtml}${statHtml}
      <div class="list">${row("store_enabled", "দোকান চালু", "bool")}</div>
      <p class="muted small">ডিজাইন অ্যাপে আগে থেকে বানানো — এখানে নাম, দাম (কয়েন), কত দিন চলবে (০ = সারাজীবন) আর শুধু VIP কিনা ঠিক করবেন। নতুন ডিজাইন চাইলে আমাকে বলুন।</p>
      ${Object.entries(kinds).map(([k, l]) => `<h2>${l}</h2><div class="table-wrap"><table class="siT"><tr><th>ডিজাইন</th><th>নাম</th><th class="num">দাম 🪙</th><th class="num">দিন</th><th>শুধু VIP</th><th>চালু</th><th></th></tr>
        ${[...(items ?? []).filter((x) => x.kind === k), { id: "new", kind: k, style: STYLE_OPTS[k][0][0], name: "", price_coins: "", days: 30, vip_only: false, active: true }].map((it) => `<tr data-id="${it.id}" data-kind="${k}">
          <td><select name="style">${STYLE_OPTS[k].map(([v, lb]) => `<option value="${v}" ${v === it.style ? "selected" : ""}>${lb}</option>`).join("")}</select></td>
          <td><input name="name" value="${esc(it.name)}" placeholder="যেমন সোনালি ফ্রেম"></td><td><input name="price" type="number" min="0" value="${it.price_coins}" style="width:90px"></td>
          <td><input name="days" type="number" min="0" value="${it.days}" style="width:70px"></td><td><input name="vip" type="checkbox" ${it.vip_only ? "checked" : ""} style="width:auto"></td>
          <td><input name="active" type="checkbox" ${it.active ? "checked" : ""} style="width:auto"></td><td><button class="btn sm good" data-ss>${it.id === "new" ? "যোগ" : "সেভ"}</button></td></tr>`).join("")}</table></div>`).join("")}`;
    view.querySelectorAll(".siT").forEach((t) => (t.onclick = async (e) => {
      const b = e.target.closest("[data-ss]"); if (!b) return;
      const tr = b.closest("tr"), g = (n2) => tr.querySelector(`[name=${n2}]`);
      if (!g("name").value.trim()) return toast("নাম লিখুন", true);
      await act(() => rpc("admin_save_store_item", { p_id: tr.dataset.id === "new" ? null : Number(tr.dataset.id), p_kind: tr.dataset.kind, p_style: g("style").value,
        p_name: g("name").value.trim(), p_price: Number(g("price").value || 0), p_days: Number(g("days").value || 0), p_vip: g("vip").checked, p_active: g("active").checked, p_sort: 0 }), "সেভ হয়েছে");
      if (tr.dataset.id === "new") routes.monetize("store");
    }));
  } else if (tab === "boost") {
    view.innerHTML = `<h1>💎 আয়ের ফিচার</h1>${tabsHtml}${statHtml}
      <p class="muted small">ক্রিয়েটর নিজের অনুমোদিত ভিডিওতে 🚀 চাপলে কয়েন দিয়ে বুস্ট করতে পারে। বুস্ট করা ভিডিও সবার রিলে "🚀 প্রমোটেড" হিসেবে মাঝে মাঝে আসে।</p>
      <div class="list">${row("boost_enabled", "বুস্ট চালু", "bool")}${row("boost_coins_per_day", "প্রতি দিনের দাম (কয়েন)", "num")}
        ${row("boost_max_days", "একবারে সর্বোচ্চ কত দিন", "num")}${row("boost_every_n", "রিলে প্রতি কয়টি ভিডিওর পর ১টি বুস্ট", "num")}</div>
      <h2>সাম্প্রতিক বুস্ট</h2><div class="table-wrap"><table><tr><th>ভিডিও</th><th>ক্রিয়েটর</th><th>শেষ</th><th class="num">কয়েন</th><th class="num">ভিউ</th></tr>
        ${(stats.boosts ?? []).map((v) => `<tr><td class="small">#${v.id} ${esc((v.caption ?? "").slice(0, 40))}</td><td><a href="#lookup/${v.user_no}">${v.user_no}</a> @${esc(v.username)}</td><td>${dt(v.boost_until)}</td><td class="num">${num(v.boost_coins)}</td><td class="num">${num(v.views_count)}</td></tr>`).join("") || `<tr><td colspan="5" class="muted">এখনো নেই</td></tr>`}</table></div>`;
  } else {
    const { data: ads } = await sb.from("sponsor_ads").select("*").order("created_at", { ascending: false });
    view.innerHTML = `<h1>💎 আয়ের ফিচার</h1>${tabsHtml}
      <p class="muted small">দোকান, অনলাইন পেজ বা কোম্পানির কাছে সরাসরি বিজ্ঞাপন বিক্রি করুন। ছবি (৩:১ চওড়া ভালো দেখায়) আর লিংক দিন — হোমের উপরে ও রিলের মাঝে দেখাবে। কতজন দেখেছে/ক্লিক করেছে নিচে দেখা যাবে।</p>
      <div class="list">${row("sponsor_every_n", "রিলে প্রতি কয়টি ভিডিওর পর ১টি স্পন্সর", "num")}</div>
      <div class="card" style="max-width:520px;margin-top:12px" id="spForm"><input type="hidden" id="spId">
        <label>শিরোনাম<input id="spT" maxlength="80" placeholder="যেমন রহিম ফ্যাশন — ঈদ অফার ৩০% ছাড়"></label>
        <label>ছবি<input type="file" id="spF" accept="image/*"></label><div id="spPrev" class="small muted"></div>
        <label>লিংক (ঐচ্ছিক — Facebook পেজ, WhatsApp, ওয়েবসাইট)<input id="spL" placeholder="https://…"></label>
        <div class="row" style="gap:8px"><label style="flex:1">কোথায়<select id="spP"><option value="all">হোম + রিল</option><option value="home">শুধু হোম</option><option value="feed">শুধু রিল</option></select></label>
          <label style="flex:1">শেষ তারিখ<input type="date" id="spE"></label></div>
        <label>নোট (কত টাকায় বিক্রি, যোগাযোগ — শুধু আপনি দেখবেন)<input id="spN"></label>
        <label class="row" style="gap:6px;justify-content:flex-start"><input type="checkbox" id="spA" checked style="width:auto"> চালু</label>
        <div class="row" style="gap:8px"><button class="btn primary" id="spSave">স্পন্সর যোগ করুন</button><button class="btn hidden" id="spCancel">বাতিল</button></div></div>
      <h2>সব স্পন্সর</h2><div class="table-wrap"><table id="spT2"><tr><th>ছবি</th><th>শিরোনাম</th><th>কোথায়</th><th>শেষ</th><th class="num">দেখা</th><th class="num">ক্লিক</th><th>অবস্থা</th><th></th></tr>
        ${(ads ?? []).map((a) => `<tr data-id="${a.id}"><td><img src="${esc(a.image_url)}" style="width:90px;height:30px;object-fit:cover;border-radius:6px"></td><td>${esc(a.title)}<div class="small muted">${esc(a.price_note ?? "")}</div></td>
          <td>${{ all: "হোম + রিল", home: "হোম", feed: "রিল" }[a.placement]}</td><td>${a.ends_at ? dt(a.ends_at) : "—"}</td><td class="num">${num(a.impressions)}</td><td class="num">${num(a.clicks)}</td>
          <td>${a.active && (!a.ends_at || new Date(a.ends_at) > new Date()) ? '<span class="pill approved">চলছে</span>' : '<span class="pill rejected">বন্ধ</span>'}</td>
          <td style="white-space:nowrap"><button class="btn sm" data-se="${a.id}">এডিট</button> <button class="btn sm danger" data-sd="${a.id}">মুছুন</button></td></tr>`).join("") || `<tr><td colspan="8" class="muted">এখনো নেই</td></tr>`}</table></div>`;
    let img = null;
    const reset = () => { ["#spId", "#spT", "#spL", "#spE", "#spN"].forEach((q) => ($(q).value = "")); $("#spF").value = ""; $("#spA").checked = true; $("#spP").value = "all"; img = null; $("#spPrev").innerHTML = ""; $("#spSave").textContent = "স্পন্সর যোগ করুন"; $("#spCancel").classList.add("hidden"); };
    $("#spCancel").onclick = reset;
    $("#spT2").onclick = async (e) => {
      const ed = e.target.closest("[data-se]"), del = e.target.closest("[data-sd]");
      if (del) { if (!confirm("এই স্পন্সর মুছবেন?")) return; await act(() => rpc("admin_delete_sponsor", { p_id: Number(del.dataset.sd) }), "মুছে ফেলা হয়েছে"); return routes.monetize("sponsor"); }
      if (!ed) return;
      const a = ads.find((x) => x.id === Number(ed.dataset.se));
      $("#spId").value = a.id; $("#spT").value = a.title; $("#spL").value = a.link_url ?? ""; $("#spP").value = a.placement; $("#spE").value = a.ends_at ? a.ends_at.slice(0, 10) : "";
      $("#spN").value = a.price_note ?? ""; $("#spA").checked = a.active; img = a.image_url; $("#spPrev").innerHTML = `<img src="${esc(img)}" style="width:150px;border-radius:8px">`;
      $("#spSave").textContent = "পরিবর্তন সেভ করুন"; $("#spCancel").classList.remove("hidden"); $("#spForm").scrollIntoView({ behavior: "smooth", block: "center" });
    };
    $("#spSave").onclick = async () => {
      const title = $("#spT").value.trim(); if (title.length < 2) return toast("শিরোনাম লিখুন", true);
      const f = $("#spF").files[0];
      if (f) {
        const path = `${S.me.id}/sponsor-${Date.now()}.${(f.name.split(".").pop() || "jpg").toLowerCase()}`;
        const { error } = await sb.storage.from("photos").upload(path, f, { contentType: f.type || "image/jpeg" });
        if (error) return toast(errMsg(error), true);
        img = sb.storage.from("photos").getPublicUrl(path).data.publicUrl;
      }
      if (!img) return toast("ছবি দিন", true);
      const ends = $("#spE").value ? new Date($("#spE").value + "T23:59:00+06:00").toISOString() : null;
      await act(() => rpc("admin_save_sponsor", { p_id: $("#spId").value ? Number($("#spId").value) : null, p_title: title, p_image: img, p_link: $("#spL").value.trim(),
        p_place: $("#spP").value, p_starts: null, p_ends: ends, p_active: $("#spA").checked, p_note: $("#spN").value.trim(), p_sort: 0 }), "সেভ হয়েছে");
      routes.monetize("sponsor");
    };
  }
  view.querySelectorAll("[data-save]").forEach((b) => (b.onclick = async () => {
    const it = b.closest(".item"), raw = it.querySelector("[name=v]").value, kind = it.dataset.kind;
    const value = kind === "bool" ? raw === "true" : kind === "taka" ? Math.round(Number(raw) * 100) : Math.round(Number(raw));
    if (kind !== "bool" && (isNaN(value) || value < 0)) return toast("সঠিক সংখ্যা দিন", true);
    if (it.dataset.key === "pool_enabled" && value === true && !confirm("রিওয়ার্ড পুল চালু করলে পয়েন্ট → টাকা রূপান্তর বন্ধ হবে, পয়েন্ট দিয়ে প্রতিদিন পুলের ভাগ পাবে। চালু করবেন?")) return;
    await act(() => rpc("admin_set_setting", { p_key: it.dataset.key, p_value: value }), "সেভ হয়েছে");
  }));
};

// ---------- 🧑‍💼 এজেন্ট (আবেদন, অনুমোদন, নিয়ম) ----------
routes.agents = async (tab = "pending") => {
  if (!["pending", "approved", "rejected", "all", "rules"].includes(tab)) tab = "pending";
  loading();
  const [d, { data: st }, apps] = await Promise.all([rpc("admin_agents", { p_status: tab === "rules" ? "pending" : tab }), sb.from("settings").select("key,value").like("key", "agent_%"),
    tab === "pending" || tab === "rejected" ? rpc("admin_agent_applications", { p_status: tab }) : Promise.resolve([])]);
  const S2 = Object.fromEntries((st ?? []).map((x) => [x.key, x.value]));
  const c = d.counts || {};
  const tabs = `<div class="tabs">${[["pending", `⏳ আবেদন (${num(c.pending)})`], ["approved", `✅ এজেন্ট (${num(c.approved)})`], ["rejected", `❌ বাতিল (${num(c.rejected)})`], ["all", "সব"], ["rules", "⚙️ নিয়ম"]]
    .map(([k, l]) => `<a class="btn sm ${k === tab ? "on" : ""}" href="#agents/${k}">${l}</a>`).join("")}</div>`;
  const row = (key, label, kind) => {
    const v = S2[key];
    return `<div class="item" data-key="${key}" data-kind="${kind}"><div class="top"><b>${label}</b></div><div class="row" style="flex-wrap:nowrap">${kind === "bool"
      ? `<select name="v"><option value="true" ${v === true ? "selected" : ""}>চালু</option><option value="false" ${v === false ? "selected" : ""}>বন্ধ</option></select>`
      : kind === "text" ? `<textarea name="v" rows="3" style="width:100%">${esc(v ?? "")}</textarea>`
      : `<input name="v" type="number" step="${kind === "taka" ? "0.01" : "1"}" min="0" value="${esc(kind === "taka" ? Number(v ?? 0) / 100 : v ?? 0)}">${kind === "taka" ? '<span class="muted">৳</span>' : ""}`}
      <button class="btn sm good" data-save>সেভ</button></div></div>`;
  };
  let body;
  if (tab === "rules") {
    body = `<div class="card small" style="margin-bottom:12px">এজেন্ট অনুমোদন পাওয়ার পর তার কোড/লিংক দিয়ে যারা আসবে, তাদের এই কঠিন টাস্কগুলো শেষ করতে হবে (সাধারণ রেফারের নিয়ম আলাদা — <a href="#referrals">🎁 রেফার</a> পেজে)।
      "প্রতিদিন" টাস্ক মানে: অন্তত যত দিন লেখা আছে, প্রতিটি দিনে ওই সংখ্যক পোস্ট।</div>
      <h2>সাধারণ</h2><div class="list">${row("agent_enabled", "এজেন্ট আবেদন চালু", "bool")}
        ${row("agent_ref_bonus_paisa", "এজেন্ট প্রতি সফল রেফারে পাবে", "taka")}${row("agent_target_refs", "টার্গেট: কতজন সফল রেফার (০ = টার্গেট নেই)", "num")}
        ${row("agent_target_bonus_paisa", "প্রতিবার টার্গেট পূরণে বাড়তি বোনাস", "taka")}</div>
      <h2>এজেন্টের আনা ইউজারের টাস্ক</h2><div class="list">${row("agent_window_days", "কত দিনের মধ্যে সব শেষ করতে হবে", "num")}
        ${row("agent_req_active_days", "কত দিন অ্যাপ ব্যবহার", "num")}${row("agent_req_minutes_per_day", "প্রতিদিন কমপক্ষে কত মিনিট", "num")}
        ${row("agent_req_post_days", "কত দিন দৈনিক পোস্ট টাস্ক পূরণ করবে", "num")}${row("agent_req_photo_per_day", "প্রতিদিন ফটো পোস্ট (০ = নেই)", "num")}
        ${row("agent_req_text_per_day", "প্রতিদিন লেখা পোস্ট (০ = নেই)", "num")}${row("agent_req_video_per_day", "প্রতিদিন ভিডিও পোস্ট (০ = নেই)", "num")}
        ${row("agent_req_full_watch", "অন্যদের ভিডিও পুরো দেখা (মোট)", "num")}${row("agent_req_likes", "লাইক (মোট)", "num")}
        ${row("agent_req_comments", "কমেন্ট (মোট)", "num")}${row("agent_req_shares", "শেয়ার (মোট)", "num")}</div>
      <h2>নিয়মের নোটিশ</h2><div class="list">${row("agent_rules_text", "এজেন্ট পেজে দেখাবে", "text")}${row("agent_rules_text_en", "English", "text")}</div>`;
  } else if (tab === "pending" || tab === "rejected") {
    body = `<div class="card small" style="margin-bottom:12px">এজেন্ট আবেদন আসে শুধু <a href="https://reelsenjoy.com/#agent" target="_blank" rel="noopener">ওয়েবসাইট</a> থেকে।
      আবেদনের ID দিয়ে ইউজারকে দেখে নিন (🔎), দরকার হলে ফোনে কথা বলুন, তারপর অনুমোদন দিন। অনুমোদনের পর তার অ্যাপে এজেন্ট পেজ আর আয়ের নিয়ম খুলে যাবে।</div>
      <div class="list">${apps.map((a) => `<div class="item">
      <div class="top"><b>${esc(a.name)} <span class="muted small">ID <a href="#lookup/${a.user_no}">${a.user_no}</a>${a.username ? ` · @${esc(a.username)}` : ""}</span></b>
        <span class="pill ${a.status === "pending" ? "pending" : "rejected"}">${a.status === "pending" ? "⏳ নতুন" : "❌ বাতিল"}</span></div>
      <div class="meta">📞 <a href="tel:${esc(a.phone)}">${esc(a.phone)}</a> · <a href="https://wa.me/${esc(a.phone.replace(/[^0-9]/g, ""))}" target="_blank" rel="noopener">WhatsApp</a>${a.area ? ` · 📍 ${esc(a.area)}` : ""} · ${new Date(a.created_at).toLocaleString("bn-BD")}</div>
      ${a.plan ? `<div class="small" style="margin-bottom:6px">📝 ${esc(a.plan)}</div>` : ""}
      <div class="small">অ্যাপে নাম: <b>${esc(a.full_name || "—")}</b> · ফলোয়ার ${num(a.followers_count)} · ভিডিও ${num(a.videos_count)} · অ্যাকাউন্ট ${a.joined_at ? new Date(a.joined_at).toLocaleDateString("bn-BD") : "—"} · আগে রেফার ${num(a.referred)} (সফল ${num(a.referred_ok)})</div>
      ${a.shared_device ? `<div class="small" style="color:var(--warn)">⚠️ এই ইউজারের মোবাইলে অন্য অ্যাকাউন্টও আছে</div>` : ""}
      ${!a.has_device ? `<div class="small" style="color:var(--warn)">⚠️ এখনো অ্যাপ (APK) থেকে লগইন করেনি</div>` : ""}
      ${a.account_status && a.account_status !== "active" ? `<div class="small" style="color:var(--bad)">⛔ অ্যাকাউন্ট ${esc(a.account_status)}</div>` : ""}
      ${a.admin_note ? `<div class="muted small">নোট: ${esc(a.admin_note)}</div>` : ""}
      ${a.status === "pending" ? `<div class="actions"><button class="btn sm good" data-app="approve" data-id="${a.id}">✅ এজেন্ট বানান</button><button class="btn sm bad" data-app="reject" data-id="${a.id}">❌ বাতিল</button><a class="btn sm" href="#lookup/${a.user_no}">🔎 ID দেখুন</a></div>` : ""}</div>`).join("")
      || `<div class="empty">কোনো আবেদন নেই</div>`}</div>`;
  } else {
    body = `<div class="list">${(d.list || []).map((a) => `<div class="item">
      <div class="top"><b><a href="#lookup/${a.user_no}">${esc(a.full_name || a.username)}</a> <span class="muted small">@${esc(a.username)} · ${a.user_no}</span></b>
        <span class="pill ${a.status === "approved" ? "active" : a.status === "pending" ? "pending" : "rejected"}">${a.status === "approved" ? "✅ এজেন্ট" : a.status === "pending" ? "⏳ আবেদন" : "❌ বাতিল"}</span></div>
      <div class="meta">আবেদন ${a.applied_at ? new Date(a.applied_at).toLocaleString("bn-BD") : "—"} · ফলোয়ার ${num(a.followers_count)} · ভিডিও ${num(a.videos_count)} · অ্যাকাউন্ট ${new Date(a.created_at).toLocaleDateString("bn-BD")}</div>
      ${a.note ? `<div class="small" style="margin-bottom:6px">📝 ${esc(a.note)}</div>` : ""}
      ${a.status === "approved" ? `<div class="small">👥 আনা ${num(a.total)} · ⏳ চলছে ${num(a.running)} · ✅ সফল ${num(a.qualified)} · ❌ ব্যর্থ ${num(a.failed)}${a.same_device ? ` <span style="color:var(--warn)">(একই মোবাইল ${num(a.same_device)})</span>` : ""}</div>` : ""}
      ${a.shared_device ? `<div class="small" style="color:var(--warn)">⚠️ এই এজেন্টের মোবাইলে অন্য অ্যাকাউন্টও আছে</div>` : ""}
      <div class="actions">${a.status !== "approved" ? `<button class="btn sm good" data-ag="approve" data-u="${a.id}">✅ অনুমোদন</button>` : ""}
        ${a.status === "pending" ? `<button class="btn sm bad" data-ag="reject" data-u="${a.id}">❌ বাতিল</button>` : ""}
        ${a.status === "approved" ? `<button class="btn sm bad" data-ag="remove" data-u="${a.id}">🚫 এজেন্ট পদ সরান</button>` : ""}</div></div>`).join("")
      || `<div class="empty">কেউ নেই</div>`}</div>`;
  }
  view.innerHTML = `<h1>🧑‍💼 এজেন্ট</h1>${tabs}${body}`;
  view.querySelectorAll("[data-app]").forEach((b) => (b.onclick = async () => {
    const ap = b.dataset.app;
    let note = null;
    if (ap === "reject") { note = prompt("কারণ (ইউজার নোটিফিকেশনে দেখবে, খালি রাখা যায়)", ""); if (note === null) return; }
    else if (!confirm("এই ইউজারকে এজেন্ট বানাবেন? তার অ্যাপে এজেন্ট পেজ খুলে যাবে।")) return;
    await act(() => rpc("admin_agent_application_action", { p_id: Number(b.dataset.id), p_action: ap, p_note: note }), ap === "approve" ? "✅ এজেন্ট বানানো হয়েছে" : "বাতিল করা হয়েছে");
    routes.agents(tab);
  }));
  view.querySelectorAll("[data-ag]").forEach((b) => (b.onclick = async () => {
    const act2 = b.dataset.ag;
    let note = null;
    if (act2 === "reject") { note = prompt("কারণ (ইউজার দেখবে, খালি রাখা যায়)", ""); if (note === null) return; }
    if (act2 === "remove" && !confirm("এই ইউজারের এজেন্ট পদ সরাবেন? আগের রেফারগুলো এজেন্ট নিয়মেই চলবে।")) return;
    await act(() => rpc("admin_agent_action", { p_user: b.dataset.u, p_action: act2, p_note: note }), act2 === "approve" ? "✅ এজেন্ট করা হয়েছে" : act2 === "reject" ? "বাতিল করা হয়েছে" : "সরানো হয়েছে");
    routes.agents(tab);
  }));
  view.querySelectorAll("[data-save]").forEach((b) => (b.onclick = async () => {
    const it = b.closest(".item"), raw = it.querySelector("[name=v]").value, kind = it.dataset.kind;
    const value = kind === "bool" ? raw === "true" : kind === "text" ? raw.trim() : kind === "taka" ? Math.round(Number(raw) * 100) : Math.round(Number(raw));
    if (kind !== "bool" && kind !== "text" && (isNaN(value) || value < 0)) return toast("সঠিক সংখ্যা দিন", true);
    await act(() => rpc("admin_set_setting", { p_key: it.dataset.key, p_value: value }), "সেভ হয়েছে");
  }));
};

// ---------- 🎁 রেফার (নিয়ম, টাস্ক, অফার, বোনাস ধাপ, তালিকা) ----------
const REF_TASK = { full_watch: "🎬 ভিডিও পুরো দেখা", likes: "❤️ লাইক", comments: "💬 কমেন্ট", shares: "↗️ শেয়ার",
  active_days: "📱 অ্যাপ ব্যবহারের দিন", video_posts: "🎥 ভিডিও পোস্ট (অনুমোদিত)", text_posts: "✍️ টেক্সট পোস্ট",
  photo_days: "📷 দৈনিক ফটো (দিন)", text_days: "✍️ দৈনিক লেখা (দিন)", video_days: "🎥 দৈনিক ভিডিও (দিন)" };
routes.referrals = async (tab = "running") => {
  loading();
  const [{ data: st }, { data: tiers }, info] = await Promise.all([
    sb.from("settings").select("key,value"), sb.from("referral_tiers").select("*").order("referrals"),
    rpc("admin_referrals", { p_status: tab, p_limit: 150 }).catch(() => null)]);
  const S = Object.fromEntries((st ?? []).map((x) => [x.key, x.value]));
  const row = (key, label, kind) => {
    const v = S[key];
    if (kind === "text") return `<div class="item" data-key="${key}" data-kind="text"><div class="top"><b>${label}</b></div>
      <textarea name="v" rows="3" translate="no">${esc(v ?? "")}</textarea><button class="btn sm good" data-save>সেভ</button></div>`;
    return `<div class="item" data-key="${key}" data-kind="${kind}"><div class="top"><b>${label}</b></div>
      <div class="row" style="flex-wrap:nowrap">${kind === "bool"
        ? `<select name="v"><option value="true" ${v === true ? "selected" : ""}>চালু</option><option value="false" ${v === false ? "selected" : ""}>বন্ধ</option></select>`
        : `<input name="v" type="number" step="${kind === "taka" ? "0.01" : "1"}" min="0" value="${esc(kind === "taka" ? Number(v) / 100 : v)}">${kind === "taka" ? '<span class="muted">৳</span>' : ""}`}
        <button class="btn sm good" data-save>সেভ</button></div></div>`;
  };
  const c = info?.counts ?? {};
  const prog = (p) => p ? `<div class="small">${p.items.filter((x) => x.need > 0).map((x) => `<span class="pill ${x.have >= x.need ? "approved" : ""}" style="margin:2px">${REF_TASK[x.k]} ${num(x.have)}/${num(x.need)}</span>`).join("")}
      <div class="muted">শেষ সময়: ${dt(p.end)}</div></div>` : "";
  view.innerHTML = `<h1>🎁 রেফার</h1>
    <div class="grid">
      <div class="card stat"><div class="k">চলছে</div><div class="v">${num(c.running)}</div></div>
      <div class="card stat"><div class="k">সফল</div><div class="v">${num(c.done)}</div></div>
      <div class="card stat"><div class="k">বাতিল / সময় শেষ</div><div class="v">${num(c.failed)}</div></div>
      <div class="card stat"><div class="k">গত ২৪ ঘণ্টায় নতুন</div><div class="v">${num(c.today)}</div></div></div>
    <h2>💰 বোনাস</h2><div class="list">
      ${row("referral_enabled", "রেফার চালু", "bool")}
      ${row("referral_bonus_paisa", "প্রতি সফল রেফারে রেফারকারী (ইউজার) পাবে", "taka")}
      ${row("host_referral_bonus_paisa", "প্রতি সফল রেফারে রেফারকারী হোস্ট পাবে", "taka")}
      ${row("referral_welcome_points", "সব টাস্ক শেষ করলে নতুন ইউজার পাবে (পয়েন্ট)", "num")}
      ${row("ref_topup_pct", "রেফার করা বন্ধু কয়েন কিনলে রেফারকারী কত % কয়েন পাবে, সারাজীবন (০ = বন্ধ)", "num")}
    </div>
    <h2>✅ নতুন ইউজারের টাস্ক (০ = সেই টাস্ক বন্ধ)</h2>
    <p class="muted small">রেফার কোড দেওয়ার পর থেকে নিচের দিনের মধ্যে সব টাস্ক শেষ করলে রেফার সফল হবে। প্রতি ১০ মিনিটে নিজে থেকে যাচাই হয়। সময় শেষ হলে (ভিডিও অনুমোদনের জন্য বাড়তি ৩ দিন) রেফার বাতিল।</p>
    <div class="list">
      ${row("ref_window_days", "কত দিনের মধ্যে শেষ করতে হবে", "num")}
      ${row("ref_req_full_watch", "কয়টি ভিডিও পুরো দেখতে হবে", "num")}
      ${row("ref_req_likes", "কয়টি লাইক দিতে হবে", "num")}
      ${row("ref_req_comments", "কয়টি কমেন্ট করতে হবে", "num")}
      ${row("ref_req_shares", "কয়টি শেয়ার করতে হবে", "num")}
      ${row("ref_req_active_days", "কয় দিন অ্যাপ ব্যবহার করতে হবে", "num")}
      ${row("ref_req_minutes_per_day", "প্রতিদিন কমপক্ষে কত মিনিট ব্যবহার", "num")}
      ${row("ref_req_video_posts", "কয়টি ভিডিও পোস্ট (এডমিন অনুমোদিত)", "num")}
      ${row("ref_req_text_posts", "কয়টি টেক্সট পোস্ট", "num")}
    </div>
    <h2>📢 রেফার অফার (অ্যাপের রেফার পেজে উপরে দেখাবে)</h2><div class="list">
      ${row("ref_offer_text", "অফারের লেখা — বাংলা (খালি = দেখাবে না)", "text")}
      ${row("ref_offer_text_en", "অফারের লেখা — English", "text")}
    </div>
    <h2>🛡️ ভুয়া রেফার ঠেকানো</h2><div class="list">
      ${row("referral_block_same_device", "একই মোবাইলে আগে অন্য অ্যাকাউন্ট থাকলে রেফার বাতিল", "bool")}
      ${row("referral_require_device", "নতুন ইউজারকে অ্যাপ (APK) থেকে লগইন করতে হবে", "bool")}
      ${row("referral_add_days", "নতুন অ্যাকাউন্ট কত দিনের মধ্যে পরে রেফার কোড দিতে পারবে", "num")}
    </div>
    <h2>🏆 রেফার বোনাস ধাপ</h2>
    <p class="muted small">যেমন: ১০ জন সফল রেফার হলে একবার ৳৫০ বাড়তি বোনাস। প্রতিটা ধাপ একজন ইউজার একবারই পাবে।</p>
    <div class="table-wrap"><table id="tt"><tr><th class="num">কতজন রেফার</th><th class="num">বোনাস (৳)</th><th>চালু</th><th></th></tr>
      ${(tiers ?? []).map((t) => `<tr data-id="${t.id}"><td><input name="referrals" type="number" min="1" value="${t.referrals}"></td><td><input name="bonus" type="number" step="0.01" min="0" value="${t.bonus_paisa / 100}"></td>
        <td><input name="is_active" type="checkbox" ${t.is_active ? "checked" : ""} style="width:auto"></td><td><button class="btn sm good" data-ts>সেভ</button> <button class="btn sm bad" data-td>মুছুন</button></td></tr>`).join("")}
      <tr data-id="new"><td><input name="referrals" type="number" min="1" placeholder="যেমন 200"></td><td><input name="bonus" type="number" step="0.01" min="0" placeholder="যেমন 2000"></td>
        <td><input name="is_active" type="checkbox" checked style="width:auto"></td><td><button class="btn sm" data-ts>যোগ করুন</button></td></tr></table></div>

    <h2>🏅 সেরা রেফারকারী</h2><div class="table-wrap"><table><tr><th>ID</th><th>ইউজার</th><th class="num">মোট</th><th class="num">সফল</th></tr>
      ${(info?.top ?? []).map((x) => `<tr><td><a href="#lookup/${x.user_no}">${x.user_no}</a></td><td>@${esc(x.username)}</td><td class="num">${num(x.total)}</td><td class="num">${num(x.done)}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">এখনো নেই</td></tr>`}</table></div>
    <h2>📋 রেফার তালিকা</h2>
    <div class="tabs">${[["running", "চলছে"], ["done", "সফল"], ["failed", "বাতিল"], ["all", "সব"]].map(([k, l]) => `<a class="btn sm ${k === tab ? "on" : ""}" href="#referrals/${k}">${l}</a>`).join("")}</div>
    <div class="table-wrap"><table><tr><th>নতুন ইউজার</th><th>রেফার করেছে</th><th>কবে</th><th>অবস্থা / অগ্রগতি</th></tr>
      ${(info?.list ?? []).map((x) => `<tr><td><a href="#lookup/${x.user_no}">${x.user_no}</a> @${esc(x.username)}</td><td><a href="#lookup/${x.ref_no}">${x.ref_no}</a> @${esc(x.ref_username)}</td>
        <td class="small">${dt(x.at)}</td><td>${x.done_at ? `<span class="pill approved">✅ সফল</span> <span class="small muted">${dt(x.done_at)}</span>`
          : x.blocked ? `<span class="pill rejected">${x.blocked === "same_device" ? "❌ একই মোবাইল" : x.blocked === "expired" ? "⌛ সময় শেষ" : esc(x.blocked)}</span>` : prog(x.progress)}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">কিছু নেই</td></tr>`}</table></div>`;
  view.onclick = async (e) => {
    const b = e.target.closest("[data-save]");
    if (b) {
      const it = b.closest(".item"), raw = it.querySelector("[name=v]").value, kind = it.dataset.kind;
      const value = kind === "text" ? raw.trim() : kind === "bool" ? raw === "true" : kind === "taka" ? Math.round(Number(raw) * 100) : Math.round(Number(raw));
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
      return routes.referrals(tab);
    }
    if (e.target.closest("[data-ts]")) {
      const r = { referrals: Number(tr.querySelector("[name=referrals]").value), bonus_paisa: Math.round(Number(tr.querySelector("[name=bonus]").value) * 100),
        is_active: tr.querySelector("[name=is_active]").checked };
      if (!r.referrals || r.referrals < 1 || isNaN(r.bonus_paisa)) return toast("কতজন ও বোনাস দিন", true);
      const { error } = id === "new" ? await sb.from("referral_tiers").insert(r) : await sb.from("referral_tiers").update(r).eq("id", Number(id));
      if (error) return toast(String(error.message).includes("duplicate") ? "এই সংখ্যার ধাপ আগেই আছে" : errMsg(error), true);
      toast("সেভ হয়েছে");
      if (id === "new") routes.referrals(tab);
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

// ---------- 🛡️ লাইভ ও কল মনিটর (এডমিন দেখে, খারাপ কিছু হলে সাথে সাথে জেল) ----------
let AgoraRTC = null;
async function loadAgora() {
  if (AgoraRTC) return AgoraRTC;
  if (!window.AgoraRTC) await new Promise((res, rej) => { const sc = document.createElement("script"); sc.src = "https://cdn.jsdelivr.net/npm/agora-rtc-sdk-ng@4/AgoraRTC_N-production.js"; sc.onload = res; sc.onerror = () => rej(new Error("Agora লোড হয়নি")); document.head.appendChild(sc); });
  AgoraRTC = window.AgoraRTC; try { AgoraRTC.setLogLevel(3); AgoraRTC.disableLogUpload?.(); } catch { /* */ }
  return AgoraRTC;
}
async function agoraTok(channel) {
  const { data, error } = await sb.functions.invoke("agora-token", { body: { channel } });
  if (error || data?.error) throw new Error(data?.error || error?.message || "TOKEN");
  return data;
}
const ago = (t) => { const m = Math.max(0, Math.round((Date.now() - new Date(t)) / 60000)); return m < 60 ? `${m} মিনিট` : `${Math.floor(m / 60)} ঘণ্টা ${m % 60} মি.`; };
routes.monitor = async () => {
  view.innerHTML = `<h1>🛡️ লাইভ ও কল মনিটর</h1><div class="empty">লোড হচ্ছে…</div>`;
  let watch = null; // {client, box}
  const stopWatch = async () => { if (!watch) return; const w = watch; watch = null; try { await w.client.leave(); } catch { /* */ } w.box?.remove(); };
  const paint = async () => {
    let d; try { d = await rpc("admin_monitor"); } catch (e) { view.innerHTML = `<h1>🛡️ লাইভ ও কল মনিটর</h1><div class="empty err">${esc(errMsg(e))}</div>`; return; }
    const lv = d.lives, cl = d.calls;
    view.innerHTML = `<h1>🛡️ লাইভ ও কল মনিটর</h1>
      <p class="muted small">প্রতি ১৫ সেকেন্ডে নিজে থেকে আপডেট হয়। "👁 দেখুন" চাপলে আপনি চুপচাপ দর্শক হিসেবে দেখবেন — কেউ জানবে না। খারাপ কিছু দেখলে "🚫 জেল" চাপুন: সাথে সাথে আইডি জেলে যাবে আর লাইভ/কল বন্ধ হবে।</p>
      <div class="grid"><div class="card stat"><div class="k">🔴 লাইভ</div><div class="v">${lv.filter((x) => x.kind !== "party").length}</div></div>
        <div class="card stat"><div class="k">🎉 পার্টি</div><div class="v">${lv.filter((x) => x.kind === "party").length}</div></div>
        <div class="card stat"><div class="k">📞 চলমান কল</div><div class="v">${cl.filter((x) => x.status === "active").length}</div></div></div>
      <h2>🔴 লাইভ ও 🎉 পার্টি এখন</h2>
      ${lv.length ? `<div class="mon-grid">${lv.map((r) => `<div class="mon-card">
        <div class="mon-ph">${r.thumb_url || r.avatar_url ? `<img src="${esc(r.thumb_url || r.avatar_url)}" alt="">` : ""}<span class="mon-b ${r.kind}">${r.kind === "party" ? "🎉 পার্টি" : "🔴 LIVE"}</span><span class="mon-v">👁 ${num(r.viewers)}</span></div>
        <div class="mon-i"><a href="#lookup/${r.user_no}"><b>@${esc(r.username)}</b></a> <span class="muted small">ID ${r.user_no}</span>
          <div class="small muted">${esc(r.title ?? "")} · ${ago(r.started_at)}${r.guests ? ` · 🎤 ${r.guests} অতিথি` : ""} · 🪙 ${num(r.gift_coins)}</div></div>
        <div class="toolbar"><button class="btn sm good" data-w="live_${r.id}" data-k="${r.kind}" data-n="@${esc(r.username)}">👁 দেখুন</button>
          <button class="btn sm" data-endl="${r.id}">⏹ বন্ধ</button><button class="btn sm bad" data-jail="${r.host_id}" data-n="@${esc(r.username)}">🚫 জেল</button></div></div>`).join("")}</div>` : `<div class="empty">এখন কেউ লাইভে নেই</div>`}
      <h2>📞 কল এখন</h2>
      ${cl.length ? `<div class="table-wrap"><table><tr><th>কলার</th><th>হোস্ট</th><th>ধরন</th><th>সময়</th><th></th></tr>
        ${cl.map((c) => `<tr><td><a href="#lookup/${c.caller_no}">@${esc(c.caller)}</a></td><td><a href="#lookup/${c.host_no}">@${esc(c.host)}</a></td>
          <td>${c.kind === "video" ? "📹" : "📞"} ${c.status === "active" ? "🟢" : "🔔 বাজছে"}</td><td>${c.started_at ? ago(c.started_at) : "—"} · ${num(c.billed_minutes)} মি.</td>
          <td><div class="toolbar">${c.status === "active" ? `<button class="btn sm good" data-w="call_${c.id}" data-k="${c.kind}" data-n="@${esc(c.caller)} ↔ @${esc(c.host)}">👁 দেখুন</button>` : ""}
            <button class="btn sm" data-endc="${c.id}">⏹ কাটুন</button><button class="btn sm bad" data-jail="${c.host_id}" data-n="হোস্ট @${esc(c.host)}">🚫 হোস্ট জেল</button><button class="btn sm bad" data-jail="${c.caller_id}" data-n="কলার @${esc(c.caller)}">🚫 কলার জেল</button></div></td></tr>`).join("")}</table></div>` : `<div class="empty">এখন কোনো কল চলছে না</div>`}`;
  };
  const watchIt = async (channel, kind, name) => {
    await stopWatch();
    const box = document.createElement("div");
    box.className = "mon-watch";
    box.innerHTML = `<div class="mon-wh"><b>👁 ${esc(name)}</b><span class="muted small">${channel.startsWith("call") ? "কল" : kind === "party" ? "পার্টি" : "লাইভ"}</span>
      <button class="btn sm" id="mwSnd">🔇 শব্দ চালু</button><button class="btn sm" id="mwX">✕ বন্ধ</button></div><div class="mon-vids" id="mwV"><div class="empty">সংযোগ হচ্ছে…</div></div>`;
    document.body.appendChild(box);
    try {
      const A = await loadAgora();
      const tk = await agoraTok(channel);
      const client = A.createClient({ mode: channel.startsWith("call") ? "rtc" : "live", codec: "vp8" });
      watch = { client, box };
      if (!channel.startsWith("call")) await client.setClientRole("audience", { level: 1 });
      const audios = new Set(); let soundOn = false;
      client.on("user-published", async (user, type) => {
        await client.subscribe(user, type);
        if (type === "audio") { audios.add(user.audioTrack); if (soundOn) user.audioTrack.play(); }
        if (type === "video") { const v = box.querySelector("#mwV"); v.querySelector(".empty")?.remove(); let t = v.querySelector(`[data-u="${user.uid}"]`); if (!t) { t = document.createElement("div"); t.className = "mon-tile"; t.dataset.u = user.uid; v.appendChild(t); } user.videoTrack.play(t); }
      });
      client.on("user-unpublished", (user, type) => { if (type === "video") box.querySelector(`[data-u="${user.uid}"]`)?.remove(); });
      await client.join(tk.appId, channel, tk.token, tk.uid);
      setTimeout(() => { const v = box.querySelector("#mwV .empty"); if (v) v.textContent = kind === "party" || kind === "audio" ? "🎧 শুধু শব্দ — উপরে \"শব্দ চালু\" চাপুন" : "ভিডিও আসছে…"; }, 3000);
      box.querySelector("#mwSnd").onclick = (e) => { soundOn = !soundOn; audios.forEach((a) => (soundOn ? a.play() : a.stop())); e.target.textContent = soundOn ? "🔊 শব্দ বন্ধ" : "🔇 শব্দ চালু"; };
    } catch (e) { box.querySelector("#mwV").innerHTML = `<div class="empty err">${esc(errMsg(e))}</div>`; }
    box.querySelector("#mwX").onclick = stopWatch;
  };
  view.onclick = async (e) => {
    const w = e.target.closest("[data-w]"), el = e.target.closest("[data-endl]"), ec = e.target.closest("[data-endc]"), j = e.target.closest("[data-jail]");
    if (w) return watchIt(w.dataset.w, w.dataset.k, w.dataset.n);
    if (el) { if (!confirm("এই লাইভ/পার্টি বন্ধ করবেন?")) return; await act(() => rpc("live_end", { p_room: Number(el.dataset.endl), p_reason: "admin" }), "বন্ধ করা হয়েছে"); return paint(); }
    if (ec) { if (!confirm("এই কল কেটে দেবেন?")) return; await act(() => rpc("admin_end_call", { p_call: Number(ec.dataset.endc) }), "কল কাটা হয়েছে"); return paint(); }
    if (j) {
      const reason = prompt(`${j.dataset.n}-কে জেলে দেবেন? কারণ লিখুন (ইউজার দেখবে):`, "লাইভ/কলে অশ্লীল বা নিয়মবিরোধী আচরণ");
      if (reason === null) return;
      await act(() => rpc("admin_jail_now", { p_user: j.dataset.jail, p_reason: reason }), "🚫 জেলে দেওয়া হয়েছে, লাইভ/কল বন্ধ");
      await stopWatch(); return paint();
    }
  };
  await paint();
  const timer = setInterval(() => { if (!watch) paint(); }, 15000);
  window.__leave = () => { clearInterval(timer); stopWatch(); };
};

// ---------- 🔴 লাইভ ও 📞 কল ----------
routes.live = async () => {
  view.innerHTML = `<h1>🔴 লাইভ ও 📞 কল</h1><div class="empty">লোড হচ্ছে…</div>`;
  let d;
  try { d = await rpc("admin_live_overview"); } catch (e) { view.innerHTML = `<h1>🔴 লাইভ ও 📞 কল</h1><div class="empty err">${esc(errMsg(e))}</div>`; return; }
  const { data: st } = await sb.from("settings").select("key,value").in("key", ["live_enabled", "live_hosts_only", "live_max_cohosts", "calls_enabled", "call_video_coins_per_min", "call_audio_coins_per_min", "call_host_pct", "live_gift_host_pct", "coin_price_paisa", "pk_enabled", "pk_duration_sec", "pk_winner_bonus_pct", "pk_bonus_cap_paisa", "party_enabled", "party_hosts_only", "party_max_seats", "party_gift_pct", "live_rules_notice", "live_rules_notice_en"]);
  const pks = (await rpc("admin_pk_recent").catch(() => [])) ?? [];
  const S2 = Object.fromEntries((st ?? []).map((x) => [x.key, x.value]));
  const cp = Number(S2.coin_price_paisa || 100);
  const row = (key, label, kind) => `<div class="item" data-key="${key}" data-kind="${kind}"><div class="top"><b>${label}</b></div><div class="row" style="flex-wrap:nowrap">${kind === "bool"
    ? `<select name="v"><option value="true" ${S2[key] === true ? "selected" : ""}>চালু</option><option value="false" ${S2[key] === false ? "selected" : ""}>বন্ধ</option></select>`
    : kind === "comm" ? `<input name="v" type="number" min="0" max="100" value="${esc(100 - Number(S2[key] ?? 0))}"><span class="muted">%</span>`
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
    <p class="muted small">কলের রেট প্রতিটি হোস্ট নিজে ঠিক করে (অ্যাপ → আমি → "আমার কলের রেট"), লেভেল অনুযায়ী সর্বোচ্চ সীমার মধ্যে। আপনি শুধু কমিশন ঠিক করবেন। কোনো হোস্টের জন্য আলাদা কমিশন দিতে "ইউজার খুঁজুন" পেজে যান। ১ কয়েন = ৳${(cp / 100).toFixed(2)}।</p>
    <div class="list" id="lrules">
      ${row("live_rules_notice", "📢 লাইভ ও পার্টিতে সবার আগে দেখানো নিয়মের নোটিশ", "text")}
      ${row("live_rules_notice_en", "📢 নিয়মের নোটিশ — English", "text")}
      ${row("live_enabled", "লাইভ চালু", "bool")}
      ${row("live_hosts_only", "শুধু অনুমোদিত হোস্টরা লাইভ করতে পারবে", "bool")}
      ${row("live_max_cohosts", "লাইভে একসাথে কতজন অতিথি যোগ দিতে পারবে", "num")}
      ${row("live_gift_host_pct", "লাইভে গিফটের কত % হোস্ট পাবে (০ = গিফটের নিজস্ব %)", "pct")}
      ${row("calls_enabled", "হোস্টকে প্রাইভেট কল চালু", "bool")}
      ${row("call_host_pct", "📞 কল থেকে আপনার কমিশন % (বাকিটা হোস্ট পাবে)", "comm")}
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
    const value = kind === "bool" ? raw === "true" : kind === "text" ? raw.trim() : kind === "comm" ? 100 - Math.round(Number(raw)) : Math.round(Number(raw));
    if (kind !== "bool" && kind !== "text" && (isNaN(value) || value < 0 || ((kind === "pct" || kind === "comm") && value > 100))) return toast("সঠিক সংখ্যা দিন", true);
    await act(() => rpc("admin_set_setting", { p_key: it.dataset.key, p_value: value }), "সেভ হয়েছে");
  };
};

// ---------- 🎵 মিউজিক লাইব্রেরি ----------
routes.music = async () => {
  view.innerHTML = `<h1>🎵 মিউজিক</h1>
    <div class="card" style="border-color:#F59E0B;background:var(--pill-pending)"><b>⚠️ কপিরাইট সতর্কতা</b>
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
  view.innerHTML = `<h1>🪙 কয়েন</h1><div class="page-sub">কয়েন পাঠানো, দাম, অফার, Google Play প্যাকেজ ও হিসাব — সব এক পেজে</div>
    <div class="coin-hero"><div class="ch-main"><i-c class="coin ch-coin"></i-c><div><small>ইউজারদের কাছে মোট কয়েন</small><b id="chOut">…</b><span id="chPrice"></span></div></div>
      <div class="ch-stats"><a href="#cashins"><small>পেন্ডিং ক্যাশ-ইন</small><b id="chPend">…</b></a><a href="#cashins"><small>এ মাসে ক্যাশ-ইন</small><b id="chMonth">…</b></a>
        <a href="#coins" data-go="offer"><small>চালু অফার</small><b id="chOf">…</b></a><a href="#sellers"><small>কয়েন সেলার</small><b id="chSel">…</b></a></div></div>
    <div class="ctabs" id="cTabs">${[["send", "📤", "কয়েন পাঠান"], ["price", "💰", "দাম"], ["offer", "🔥", "অফার"], ["play", "▶️", "Google Play"], ["hist", "🧾", "হিসাব"]].map(([k, i, l]) => `<button type="button" data-t="${k}">${i} ${l}</button>`).join("")}<a href="#sellers">💰 সেলার ›</a><a href="#cashins">💳 ক্যাশ-ইন ›</a></div>
    <section class="cs" data-s="send"><div class="card cs-card">
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
    </section><section class="cs" data-s="price"><h2>💰 কয়েনের দাম</h2>
    <div class="card cs-card">
      <label>১ কয়েনের দাম (টাকা)<input id="cpr" type="number" inputmode="decimal" step="0.01" min="0.01" placeholder="যেমন 1"></label>
      <div id="cprInfo" class="muted small" style="margin-top:4px"></div>
      <label>সর্বনিম্ন কত টাকার কয়েন কেনা যাবে<input id="cmin" type="number" inputmode="numeric" min="1"></label>
      <button class="btn primary" id="cprSave">দাম সেভ করুন</button>
      <p class="muted small">⚠️ এই দামেই গিফট ও প্রিমিয়ামের টাকার হিসাব হয় (ক্রিয়েটর কত পাবে)। দাম কমালে ক্রিয়েটরের আয়ও কমবে।</p>
    </div>
    </section><section class="cs" data-s="offer"><h2>🔥 কয়েন অফার</h2>
    <p class="muted small">এখানে অফার যোগ করলে ইউজাররা অ্যাপে "কয়েন কিনুন" পেজে ও হোম পেজে অফার দেখবে। শেষ সময় পার হলে অফার নিজে থেকেই লুকিয়ে যাবে।</p>
    <div class="card cs-card" id="ofForm">
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
    </section><section class="cs" data-s="play"><h2>▶️ Google Play কয়েন প্যাকেজ</h2>
    <p class="muted small">Play Store থেকে নামানো অ্যাপে "Google" ট্যাবে এই প্যাকেজগুলো দেখাবে। দাম এখানে নয় — Play Console → Monetize → In-app products-এ একই <b>Product ID</b> দিয়ে প্যাকেজ বানিয়ে সেখানে দাম বসাবেন। এখানে শুধু কত কয়েন পাবে তা ঠিক করবেন।</p>
    <div class="card cs-card" id="ppForm">
      <input type="hidden" id="ppId">
      <label>Product ID (Play Console-এর মতো হুবহু)<input id="ppP" maxlength="100" placeholder="যেমন coins_1200" autocapitalize="none"></label>
      <div class="row" style="gap:8px"><label style="flex:1">কত কয়েন পাবে<input id="ppC" type="number" inputmode="numeric" min="1" placeholder="1200"></label>
        <label style="flex:1">কাটা দাগের সংখ্যা (ঐচ্ছিক)<input id="ppB" type="number" inputmode="numeric" min="0" placeholder="1000"></label></div>
      <div class="row" style="gap:8px"><label style="flex:1">ক্রম<input id="ppS" type="number" inputmode="numeric" value="0"></label>
        <label class="row" style="flex:1;gap:6px;justify-content:flex-start;margin-top:18px"><input type="checkbox" id="ppBest" style="width:auto"> 👍 সেরা প্যাকেজ</label></div>
      <label class="row" style="gap:6px;justify-content:flex-start"><input type="checkbox" id="ppA" checked style="width:auto"> চালু থাকবে</label>
      <div class="row" style="gap:8px"><button class="btn primary" id="ppSave">প্যাকেজ যোগ করুন</button><button class="btn hidden" id="ppCancel">বাতিল</button></div>
    </div>
    <div id="ppList" class="table-wrap"></div>
    <div class="card cs-card" style="margin-top:12px">
      <label class="row" style="gap:6px;justify-content:flex-start"><input type="checkbox" id="pbOn" style="width:auto"> Play অ্যাপে Google দিয়ে কয়েন কেনা চালু</label>
      <label class="row" style="gap:6px;justify-content:flex-start"><input type="checkbox" id="phOn" style="width:auto"> Play অ্যাপেও "রিকমেন্ড" (বিকাশ/নগদ) ও "টপ-আপ হেল্পার" ট্যাব দেখাবে</label>
      <p class="muted small" style="margin:4px 0 0">⚠️ Google-এর নিয়মে Play অ্যাপের ভেতরে অন্য পেমেন্টের পথ দেখানো নিষেধ। এটা চালু করলে অ্যাপ বাতিল বা ডেভেলপার অ্যাকাউন্ট বন্ধ হওয়ার ঝুঁকি আছে। ওয়েবসাইটের APK-তে সবসময় দেখায়।</p>
      <label>টপ-আপ হেল্পার পেজের নোটিশ (বাংলা)<textarea id="thN" rows="2"></textarea></label>
      <label>টপ-আপ হেল্পার পেজের নোটিশ (English)<textarea id="thNe" rows="2"></textarea></label>
      <button class="btn primary" id="pbSave">সেভ করুন</button>
    </div>
    <h3>সাম্প্রতিক Google Play কেনা</h3><div id="ppBuys" class="table-wrap"></div>
    </section><section class="cs" data-s="hist"><h2>পাঠানো কয়েনের হিসাব</h2><div id="ch" class="table-wrap"></div></section>`;
  { const tab = (t) => { document.querySelectorAll("#cTabs [data-t]").forEach((b) => b.classList.toggle("on", b.dataset.t === t)); document.querySelectorAll(".cs").forEach((x) => x.classList.toggle("hidden", x.dataset.s !== t)); try { sessionStorage.setItem("coinTab", t); } catch { /* */ } };
    tab(preNo ? "send" : (sessionStorage.getItem("coinTab") || "send"));
    $("#cTabs").onclick = (e) => { const b = e.target.closest("[data-t]"); if (b) tab(b.dataset.t); };
    view.querySelector('[data-go="offer"]').onclick = (e) => { e.preventDefault(); tab("offer"); };
    Promise.all([rpc("admin_dashboard"), rpc("admin_coin_offers").catch(() => []), rpc("admin_user_type_counts").catch(() => ({}))]).then(([d, of, ty]) => {
      $("#chOut").textContent = num(d.coins_outstanding); $("#chPend").textContent = `${num(d.cashin_pending)} · ${taka(d.cashin_pending_paisa)}`;
      $("#chMonth").textContent = taka(d.cashin_month_paisa); $("#chOf").textContent = num((of ?? []).filter((o) => o.active && (!o.ends_at || new Date(o.ends_at) > new Date())).length);
      $("#chSel").textContent = num(ty.seller ?? 0);
    }).catch(() => {}); }
  // ---- কয়েনের দাম ----
  const { data: st } = await sb.from("settings").select("key,value").in("key", ["coin_price_paisa", "min_cash_in_taka"]);
  const sv = Object.fromEntries((st ?? []).map((x) => [x.key, Number(x.value)]));
  let pricePaisa = sv.coin_price_paisa || 100;
  $("#cpr").value = (pricePaisa / 100).toString(); $("#cmin").value = sv.min_cash_in_taka ?? 20;
  const prInfo = () => { const p = Number($("#cpr").value); $("#cprInfo").textContent = p > 0 ? `৳১ = ${(1 / p).toFixed(2).replace(/\.00$/, "")} কয়েন · ৳১০০ = ${Math.floor(100 / p)} কয়েন` : ""; };
  $("#cpr").oninput = prInfo; prInfo();
  $("#chPrice").textContent = `১ কয়েন = ৳${(pricePaisa / 100).toFixed(2).replace(/\.00$/, "")} · ৳১০০ = ${num(Math.floor(10000 / pricePaisa))} কয়েন`;
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
  // ---- Google Play প্যাকেজ ----
  const resetPp = () => { ["#ppId", "#ppP", "#ppC", "#ppB"].forEach((q) => ($(q).value = "")); $("#ppS").value = 0; $("#ppA").checked = true; $("#ppBest").checked = false;
    $("#ppSave").textContent = "প্যাকেজ যোগ করুন"; $("#ppCancel").classList.add("hidden"); };
  $("#ppCancel").onclick = resetPp;
  let pps = [];
  const loadPp = async () => {
    const { data } = await sb.from("play_products").select("*").order("sort").order("coins");
    pps = data ?? [];
    $("#ppList").innerHTML = pps.length ? `<table><tr><th>Product ID</th><th class="num">কয়েন</th><th class="num">কাটা দাগ</th><th>অবস্থা</th><th></th></tr>
      ${pps.map((p) => `<tr><td><code>${esc(p.product_id)}</code>${p.badge ? " 👍" : ""}</td><td class="num">🪙 ${num(p.coins)}</td><td class="num">${p.base_coins ? num(p.base_coins) : "—"}</td>
        <td>${p.active ? '<span class="pill approved">চালু</span>' : '<span class="pill rejected">বন্ধ</span>'}</td>
        <td style="white-space:nowrap"><button class="btn sm" data-pe="${p.id}">এডিট</button> <button class="btn sm danger" data-pd="${p.id}">মুছুন</button></td></tr>`).join("")}</table>`
      : `<div class="empty">কোনো প্যাকেজ নেই</div>`;
    view.querySelectorAll("[data-pe]").forEach((b) => (b.onclick = () => {
      const p = pps.find((x) => x.id == b.dataset.pe);
      $("#ppId").value = p.id; $("#ppP").value = p.product_id; $("#ppC").value = p.coins; $("#ppB").value = p.base_coins ?? ""; $("#ppS").value = p.sort;
      $("#ppA").checked = p.active; $("#ppBest").checked = !!p.badge;
      $("#ppSave").textContent = "পরিবর্তন সেভ করুন"; $("#ppCancel").classList.remove("hidden");
      $("#ppForm").scrollIntoView({ behavior: "smooth", block: "center" });
    }));
    view.querySelectorAll("[data-pd]").forEach((b) => (b.onclick = async () => {
      if (!confirm("প্যাকেজটি মুছবেন? (কেনা হয়ে থাকলে শুধু বন্ধ হবে)")) return;
      await act(() => rpc("admin_delete_play_product", { p_id: Number(b.dataset.pd) }), "হয়েছে"); loadPp();
    }));
    const buys = (await rpc("admin_play_purchases", { p_limit: 30 }).catch(() => [])) ?? [];
    $("#ppBuys").innerHTML = buys.length ? `<table><tr><th>সময়</th><th>ইউজার</th><th>প্যাকেজ</th><th class="num">কয়েন</th><th>Order</th></tr>
      ${buys.map((x) => `<tr><td>${dt(x.created_at)}</td><td>${x.user_no} · @${esc(x.username)}</td><td><code>${esc(x.product_id)}</code></td><td class="num">${num(x.coins)}</td><td class="small">${esc(x.order_id ?? "")}</td></tr>`).join("")}</table>`
      : `<div class="empty">এখনো কোনো কেনা নেই</div>`;
  };
  $("#ppSave").onclick = async () => {
    const pid = $("#ppP").value.trim().toLowerCase(), coins = Math.floor(Number($("#ppC").value));
    if (!/^[a-z0-9][a-z0-9._]*$/.test(pid)) return toast("Product ID-তে শুধু ছোট হাতের ইংরেজি অক্ষর, সংখ্যা, _ ও . চলে", true);
    if (!(coins >= 1)) return toast("কয়েন দিন", true);
    try { await act(() => rpc("admin_save_play_product", { p_id: $("#ppId").value ? Number($("#ppId").value) : null, p_product_id: pid, p_coins: coins,
      p_base: Math.floor(Number($("#ppB").value) || 0), p_badge: $("#ppBest").checked ? "👍" : null, p_sort: Math.floor(Number($("#ppS").value) || 0), p_active: $("#ppA").checked }), "প্যাকেজ সেভ হয়েছে");
      resetPp(); loadPp(); } catch { /* toast shown */ }
  };
  loadPp();
  {
    const { data: ps } = await sb.from("settings").select("key,value").in("key", ["play_billing_enabled", "play_show_helpers", "topup_helper_notice", "topup_helper_notice_en"]);
    const pv = Object.fromEntries((ps ?? []).map((x) => [x.key, x.value]));
    $("#pbOn").checked = pv.play_billing_enabled !== false; $("#phOn").checked = pv.play_show_helpers === true;
    $("#thN").value = pv.topup_helper_notice ?? ""; $("#thNe").value = pv.topup_helper_notice_en ?? "";
    $("#pbSave").onclick = async () => {
      if ($("#phOn").checked && pv.play_show_helpers !== true && !confirm("Play অ্যাপে বিকাশ/হেল্পার দেখালে Google অ্যাপ বাতিল করতে পারে। তবুও চালু করবেন?")) return;
      await act(async () => {
        await rpc("admin_set_setting", { p_key: "play_billing_enabled", p_value: $("#pbOn").checked });
        await rpc("admin_set_setting", { p_key: "play_show_helpers", p_value: $("#phOn").checked });
        await rpc("admin_set_setting", { p_key: "topup_helper_notice", p_value: $("#thN").value.trim() });
        await rpc("admin_set_setting", { p_key: "topup_helper_notice_en", p_value: $("#thNe").value.trim() });
        pv.play_show_helpers = $("#phOn").checked;
      }, "সেভ হয়েছে");
    };
  }
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
      অ্যাড না দেখালে নিচে <b>"অ্যাড না আসার কারণ"</b> দেখুন (অ্যাপ v1.0.20 বা নতুন থেকে আসে)। কোড বোঝার জন্য সেখানে ব্যাখ্যা আছে।<br>
      কোড ঠিক আছে কিনা পরীক্ষা করতে Google-এর টেস্ট ID বসিয়ে দেখতে পারেন — Interstitial: ${copyable("ca-app-pub-3940256099942544/1033173712")}
      Rewarded: ${copyable("ca-app-pub-3940256099942544/5224354917")} (পরীক্ষা শেষে আসল ID ফেরত বসাবেন)।<br>
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
  const { data: errs } = await sb.from("ad_errors").select("*").order("id", { ascending: false }).limit(40);
  const MEAN = { 0: "Google-এর ভেতরের সমস্যা — পরে আবার চেষ্টা করবে", 1: "Ad Unit ID বা App ID ভুল / মেলে না", 2: "ফোনের ইন্টারনেট সমস্যা",
    3: "No fill — এখন দেখানোর মতো অ্যাড নেই। নতুন AdMob অ্যাকাউন্ট/অ্যাপ অনুমোদনের অপেক্ষায় থাকলে বা অ্যাপ Play Store-এ না থাকলে এমন হয়",
    8: "অ্যাপ AdMob-এ ঠিকমতো যুক্ত নয় (App ID)", 9: "মিডিয়েশন: কোনো অ্যাড নেই" };
  view.insertAdjacentHTML("beforeend", `<h2>⚠️ অ্যাড না আসার কারণ (শেষ ১৪ দিন)</h2>${(errs ?? []).length ? `<div class="table-wrap"><table>
    <tr><th>সময়</th><th>কোথায়</th><th>কোড</th><th>মানে</th><th>Google-এর বার্তা</th></tr>
    ${errs.map((x) => `<tr><td>${dt(x.created_at)}</td><td>${esc(x.placement ?? "")}</td><td>${x.code ?? ""}</td><td class="small">${MEAN[x.code] ?? ""}</td><td class="small">${esc(x.message ?? "")}</td></tr>`).join("")}</table></div>`
    : `<div class="empty">কোনো ত্রুটি আসেনি। অ্যাপ v1.0.20-এর আগের ভার্সনে কারণ পাঠানো হয় না।</div>`}`);
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
    ["দর্শক পয়েন্ট (পুরো ভিডিও দেখলে)", ["watch_points", "watch_full_pct", "viewer_daily_points_cap", "point_value_paisa", "points_convert_min"]],
    ["ভিডিও ও লক ফোল্ডার", ["upload_reward_coins", "auto_approve_minutes", "max_video_sec", "vault_quota_mb"]],
    ["অন্যান্য", ["app_notice", "app_notice_en"]],
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
