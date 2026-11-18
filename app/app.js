import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const { SUPABASE_URL, SUPABASE_KEY } = window.REELS_CONFIG;
const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
const Native = window.ReelsAndroid || null; // APK-এর ভেতরে থাকলে অ্যাড/শেয়ার ব্রিজ
const $ = (s, el = document) => el.querySelector(s);
const screen = $("#screen");

const S = { me: null, settings: {}, ads: {}, gifts: null, muted: false, unread: 0, rtChannel: null };

// ---------------- helpers ----------------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const n = (x) => {
  x = Number(x ?? 0);
  if (x >= 1e6) return (x / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (x >= 1e4) return (x / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
  return x.toLocaleString("en-IN");
};
const tk = (paisa) => "৳" + (Number(paisa ?? 0) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dt = (s) => new Date(s).toLocaleString("en-GB", { timeZone: "Asia/Dhaka", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const ago = (s) => {
  const m = Math.floor((Date.now() - new Date(s)) / 60000);
  if (m < 1) return "এইমাত্র";
  if (m < 60) return m + " মিনিট আগে";
  if (m < 1440) return Math.floor(m / 60) + " ঘণ্টা আগে";
  return Math.floor(m / 1440) + " দিন আগে";
};
const cleanPhone = (p) => String(p).trim().replace(/[\s-]/g, "").replace(/^\+?88/, "");
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2));
const setting = (k, d = 0) => (S.settings[k] ?? d);
const METHOD = { bkash: "bKash", nagad: "Nagad", rocket: "Rocket" };
const STATUS = { pending: "পেন্ডিং", approved: "অ্যাপ্রুভড", paid: "পেমেন্ট সম্পন্ন", rejected: "রিজেক্টেড" };
const avatar = (p, cls = "av") => `<div class="${cls}">${p?.avatar_url ? `<img src="${esc(p.avatar_url)}" alt="">` : esc((p?.full_name || p?.username || "?").trim().charAt(0).toUpperCase())}</div>`;

const ERR = {
  "Invalid login credentials": "মোবাইল নম্বর বা পাসওয়ার্ড ভুল",
  INSUFFICIENT_COINS: "কয়েন যথেষ্ট নেই — আগে কয়েন কিনুন",
  INSUFFICIENT_BALANCE: "ব্যালেন্স যথেষ্ট নেই",
  INSUFFICIENT_POINTS: "পয়েন্ট যথেষ্ট নেই",
  BELOW_MIN: "সর্বনিম্ন পরিমাণের চেয়ে কম",
  OPEN_REQUEST_EXISTS: "আগের একটি উইথড্র রিকোয়েস্ট এখনো চলছে",
  ACCOUNT_TOO_NEW: "নতুন অ্যাকাউন্ট — কয়েক দিন পর উইথড্র করতে পারবেন",
  WALLET_FROZEN: "আপনার ওয়ালেট সাময়িক বন্ধ আছে — সাপোর্টে যোগাযোগ করুন",
  BAD_NUMBER: "সঠিক মোবাইল নম্বর দিন (01XXXXXXXXX)",
  BAD_PHONE: "দেশ বেছে নিয়ে সঠিক মোবাইল নম্বর দিন",
  BAD_EMAIL: "সঠিক ইমেইল দিন",
  EMAIL_TAKEN: "এই ইমেইলে আগেই অ্যাকাউন্ট আছে — লগইন করুন",
  NO_ACCOUNT: "এই নম্বর/ইমেইলে কোনো অ্যাকাউন্ট নেই — আগে রেজিস্টার করুন",
  SIGNUP_FAILED: "অ্যাকাউন্ট খোলা যায়নি, আবার চেষ্টা করুন",
  BAD_REF: "এই রেফার কোডে কোনো ইউজার নেই",
  BAD_DATE: "সঠিক জন্মতারিখ দিন",
  TRX_USED: "এই TrxID আগেই ব্যবহার হয়েছে",
  BAD_TRX: "সঠিক TrxID দিন",
  TOO_MANY_PENDING: "আগের রিকোয়েস্টগুলো যাচাই হওয়া পর্যন্ত অপেক্ষা করুন",
  RATE_LIMIT: "খুব দ্রুত করছেন — একটু পরে চেষ্টা করুন",
  COMMENTS_OFF: "এই ভিডিওতে কমেন্ট বন্ধ",
  GIFTS_OFF: "এই ভিডিওতে গিফট বন্ধ",
  SELF_GIFT: "নিজের ভিডিওতে গিফট দেওয়া যায় না",
  UPLOAD_LIMIT: "আজকের আপলোড সীমা শেষ",
  VIDEO_TOO_LONG: "ভিডিও অনেক লম্বা",
  USERNAME_TAKEN: "এই ইউজারনেম আগেই নেওয়া হয়েছে",
  BAD_USERNAME: "ইউজারনেম শুধু ইংরেজি ছোট হাতের অক্ষর, সংখ্যা, _ বা . (৩-৩০ অক্ষর)",
  PHONE_TAKEN: "এই নম্বরে আগেই অ্যাকাউন্ট আছে — লগইন করুন",
  BAD_PASSWORD: "পাসওয়ার্ড কমপক্ষে ৬ অক্ষর",
  BAD_NAME: "আপনার নাম লিখুন",
  TRY_LATER: "একটু পরে চেষ্টা করুন",
  ACCOUNT_BANNED: "আপনার অ্যাকাউন্ট ব্লক করা হয়েছে",
  JAILED: "আপনার অ্যাকাউন্ট জেলে আছে",
  UPLOAD_LIMIT: "আজকের আপলোড সীমা শেষ — কাল আবার দিন",
  VAULT_FULL: "লক ফোল্ডারে জায়গা নেই",
  "Failed to fetch": "ইন্টারনেট সংযোগ নেই",
  NETWORK: "ইন্টারনেট সংযোগ নেই",
  "maximum allowed size": "ফাইল অনেক বড় (সর্বোচ্চ 50MB)",
};
function errMsg(e) {
  const m = typeof e === "string" ? e : e?.message ?? String(e);
  if (m.includes("WITHDRAW_COOLDOWN")) return "৭ দিনে একবার উইথড্র করা যায়। পরবর্তী সময়: " + (m.split("COOLDOWN:")[1] ?? "");
  for (const k of Object.keys(ERR)) if (m.includes(k)) return ERR[k];
  return m;
}
function toast(msg, bad = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast show" + (bad ? " bad" : "");
  clearTimeout(t._h);
  t._h = setTimeout(() => (t.className = "toast"), 2800);
}
async function rpc(fn, args = {}) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) {
    if (String(error.message).includes("ACCOUNT_BANNED")) { await sb.auth.signOut(); showAuth(ERR.ACCOUNT_BANNED); }
    if (String(error.message).includes("JAILED") && S.me) { S.me.jailed = true; setTimeout(() => (location.hash = "#jail"), 50); }
    throw error;
  }
  return data;
}
document.addEventListener("click", (e) => {
  const c = e.target.closest("[data-copy]");
  if (c) { navigator.clipboard?.writeText(c.dataset.copy).catch(() => {}); toast("কপি হয়েছে: " + c.dataset.copy); }
});

// ---------------- sheet ----------------
function sheet(html) {
  $("#sheetBody").innerHTML = html;
  $("#sheet").classList.remove("hidden");
  return $("#sheetBody");
}
function closeSheet() { $("#sheet").classList.add("hidden"); $("#sheetBody").innerHTML = ""; }
$("#sheet").addEventListener("click", (e) => { if (e.target.id === "sheet") closeSheet(); });

// ---------------- auth ----------------
// দেশের কোড: বাংলাদেশ ছাড়াও প্রবাসীরা যেসব দেশে বেশি থাকেন
const COUNTRIES = [
  ["🇧🇩", "বাংলাদেশ", "+880"], ["🇸🇦", "সৌদি আরব", "+966"], ["🇦🇪", "দুবাই/আমিরাত", "+971"], ["🇶🇦", "কাতার", "+974"],
  ["🇰🇼", "কুয়েত", "+965"], ["🇴🇲", "ওমান", "+968"], ["🇧🇭", "বাহরাইন", "+973"], ["🇲🇾", "মালয়েশিয়া", "+60"],
  ["🇸🇬", "সিঙ্গাপুর", "+65"], ["🇲🇻", "মালদ্বীপ", "+960"], ["🇧🇳", "ব্রুনাই", "+673"], ["🇮🇳", "ভারত", "+91"],
  ["🇯🇴", "জর্ডান", "+962"], ["🇱🇧", "লেবানন", "+961"], ["🇮🇶", "ইরাক", "+964"], ["🇱🇾", "লিবিয়া", "+218"],
  ["🇮🇹", "ইতালি", "+39"], ["🇬🇧", "যুক্তরাজ্য", "+44"], ["🇫🇷", "ফ্রান্স", "+33"], ["🇪🇸", "স্পেন", "+34"],
  ["🇵🇹", "পর্তুগাল", "+351"], ["🇬🇷", "গ্রিস", "+30"], ["🇩🇪", "জার্মানি", "+49"], ["🇷🇴", "রোমানিয়া", "+40"],
  ["🇺🇸", "যুক্তরাষ্ট্র/কানাডা", "+1"], ["🇦🇺", "অস্ট্রেলিয়া", "+61"], ["🇯🇵", "জাপান", "+81"], ["🇰🇷", "দক্ষিণ কোরিয়া", "+82"],
  ["🇲🇺", "মরিশাস", "+230"], ["🇿🇦", "দক্ষিণ আফ্রিকা", "+27"],
];
for (const id of ["liCC", "rgCC"]) {
  $("#" + id).innerHTML = COUNTRIES.map(([f, nm, c]) => `<option value="${c}">${f} ${c} ${nm}</option>`).join("");
  try { const saved = localStorage.getItem("cc"); if (saved) $("#" + id).value = saved; } catch { /* */ }
}
// দেশের কোড + নম্বর → +8801712345678 (শুরুর 0 বাদ)
const fullPhone = (cc, num) => {
  let d = String(num).replace(/[^\d+]/g, "");
  if (d.startsWith("+")) return d;
  if (d.startsWith("00")) return "+" + d.slice(2);
  return cc + d.replace(/^0+/, "");
};
let loginMode = "phone";
document.querySelectorAll("#loginForm .seg button").forEach((b) => (b.onclick = () => {
  loginMode = b.dataset.m;
  document.querySelectorAll("#loginForm .seg button").forEach((x) => x.classList.toggle("on", x === b));
  $("#liPhoneRow").classList.toggle("hidden", loginMode !== "phone");
  $("#liEmail").classList.toggle("hidden", loginMode !== "email");
}));

async function fnCall(name, body) {
  const { data, error } = await sb.functions.invoke(name, { body });
  if (error || data?.error) {
    let code = data?.error;
    if (!code && error?.context?.json) code = (await error.context.json().catch(() => ({})))?.error;
    throw new Error(code || error?.message || "ERROR");
  }
  return data;
}
async function loginWith(identifier, password) {
  const { login } = await fnCall("resolve-login", { identifier }).catch((e) => {
    throw new Error(String(e.message).includes("NOT_FOUND") ? "NO_ACCOUNT" : e.message);
  });
  const { error } = await sb.auth.signInWithPassword({ email: login, password });
  if (error) throw error;
}

function showAuth(msg = "") {
  $("#main").classList.add("hidden");
  $("#auth").classList.remove("hidden");
  $("#authErr").textContent = msg;
}
$("#authLang").onclick = (e) => { e.preventDefault(); window.setLang?.(window.getLang?.() === "en" ? "bn" : "en"); };
$("#toReg").onclick = (e) => { e.preventDefault(); $("#loginForm").classList.add("hidden"); $("#regForm").classList.remove("hidden"); $("#authErr").textContent = ""; };
$("#toLogin").onclick = (e) => { e.preventDefault(); $("#regForm").classList.add("hidden"); $("#loginForm").classList.remove("hidden"); $("#authErr").textContent = ""; };

$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const b = e.submitter; b.disabled = true;
  try {
    const id = loginMode === "email" ? $("#liEmail").value.trim() : fullPhone($("#liCC").value, $("#liPhone").value);
    if (!id || id === $("#liCC").value) throw new Error(loginMode === "email" ? "BAD_EMAIL" : "BAD_PHONE");
    try { localStorage.setItem("cc", $("#liCC").value); } catch { /* */ }
    await loginWith(id, $("#liPass").value);
    start();
  } catch (er) { $("#authErr").textContent = errMsg(er); }
  b.disabled = false;
});
$("#regForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const b = e.submitter; b.disabled = true;
  const phone = fullPhone($("#rgCC").value, $("#rgPhone").value);
  const body = { phone, email: $("#rgEmail").value.trim(), password: $("#rgPass").value, ref_no: $("#rgRef").value.trim(),
    full_name: $("#rgName").value.trim(), username: $("#rgUser").value.trim().toLowerCase() };
  try {
    const r = await fnCall("signup", body);
    try { localStorage.setItem("cc", $("#rgCC").value); } catch { /* */ }
    const { error } = await sb.auth.signInWithPassword({ email: r.login, password: body.password });
    if (error) throw error;
    toast("স্বাগতম! 🎉");
    start();
  } catch (er) { $("#authErr").textContent = errMsg(er); }
  b.disabled = false;
});

async function start() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return showAuth();
  const [{ data: me }, { data: settings }, { data: ads }] = await Promise.all([
    sb.from("profiles").select("*").eq("id", session.user.id).single(),
    sb.from("settings").select("key,value"),
    sb.from("ad_placements").select("*").eq("is_active", true),
  ]);
  if (!me) { await sb.auth.signOut(); return showAuth("অ্যাকাউন্ট পাওয়া যায়নি"); }
  if (me.status === "banned") { await sb.auth.signOut(); return showAuth(ERR.ACCOUNT_BANNED + (me.ban_reason ? ": " + me.ban_reason : "")); }
  S.me = me;
  S.settings = Object.fromEntries((settings ?? []).map((s) => [s.key, s.value]));
  S.ads = Object.fromEntries((ads ?? []).map((a) => [a.key, a]));
  $("#auth").classList.add("hidden");
  $("#main").classList.remove("hidden");
  try { Native?.onLogin?.(me.id); } catch { /* old APK */ }
  realtime();
  refreshUnread();
  route();
  rpc("touch_last_seen").catch(() => {});
  requireLocation();
}

// ---------------- লোকেশন (APK-তে লোকেশন ছাড়া অ্যাপ চলবে না) ----------------
function requireLocation() {
  if (!Native?.requestLocation) return; // ব্রাউজার বা পুরনো APK
  let gate = $("#locGate");
  if (!gate) {
    document.body.insertAdjacentHTML("beforeend", `<div id="locGate" class="loc-gate hidden"><div>
      <div style="font-size:54px">📍</div><h2>লোকেশন চালু করুন</h2>
      <p class="muted">Reels Enjoy ব্যবহার করতে লোকেশন অনুমতি লাগবে। এটা দিয়ে শুধু আপনার দেশ ও শহর জানা হয় — প্রতারণা রোধ ও দেশভিত্তিক অফারের জন্য। আপনার সঠিক ঠিকানা কেউ দেখতে পায় না।</p>
      <button class="btn primary" id="locTry">অনুমতি দিন</button>
      <button class="btn" id="locSet" style="width:100%;margin-top:8px">সেটিংস খুলুন</button>
      <p class="tiny muted" id="locMsg"></p></div></div>`);
    gate = $("#locGate");
    $("#locTry").onclick = () => { $("#locMsg").textContent = "অপেক্ষা করুন…"; Native.requestLocation(); };
    $("#locSet").onclick = () => Native.openSettings?.(S.locState === "disabled" ? "location" : "app");
  }
  Native.requestLocation();
}
window.onAppResume = () => {
  const g = $("#locGate");
  if (g && !g.classList.contains("hidden")) Native?.requestLocation?.();
};
window.onNativeLocation = (r) => {
  const gate = $("#locGate");
  if (r && r.ok) {
    gate?.classList.add("hidden");
    rpc("update_location", { p_lat: r.lat, p_lon: r.lon, p_country: r.country || null, p_country_code: r.countryCode || null, p_city: r.city || null }).catch(() => {});
    return;
  }
  S.locState = r?.reason;
  gate?.classList.remove("hidden");
  const msg = $("#locMsg");
  if (msg) msg.textContent = r?.reason === "disabled" ? "ফোনের লোকেশন (GPS) বন্ধ আছে — সেটিংস থেকে চালু করুন" : r?.reason === "denied" ? "অনুমতি দেওয়া হয়নি — আবার চাপুন বা সেটিংস থেকে চালু করুন" : "লোকেশন পাওয়া যায়নি — আবার চেষ্টা করুন";
};

function realtime() {
  if (S.rtChannel) sb.removeChannel(S.rtChannel);
  S.rtChannel = sb.channel("me-" + S.me.id)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${S.me.id}` }, (p) => {
      S.unread++; $("#unread").textContent = S.unread > 99 ? "99+" : S.unread;
      if (["gift", "withdraw", "cash_in"].includes(p.new.type)) toast(p.new.title);
    })
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "wallets", filter: `user_id=eq.${S.me.id}` }, (p) => {
      document.dispatchEvent(new CustomEvent("wallet", { detail: p.new }));
    })
    .subscribe();
}
async function refreshUnread() {
  const { count } = await sb.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", S.me.id).eq("is_read", false);
  S.unread = count ?? 0;
  $("#unread").textContent = S.unread ? (S.unread > 99 ? "99+" : S.unread) : "";
}

// ---------------- router ----------------
const R = {};
let cleanup = null;
function route() {
  if (!S.me) return;
  if (cleanup) { try { cleanup(); } catch { /* */ } cleanup = null; }
  closeSheet();
  let [name, a, b] = (location.hash.slice(1) || "home").split("/");
  if (!R[name]) name = "home";
  if (S.me.jailed && !["jail", "cashin", "history"].includes(name)) name = "jail";
  const TABS = { feed: ["feed", "following", "watch", "play"], me: ["me", "invite", "rules", "settings", "vault", "edit", "level", "wallet", "history", "withdraw", "cashin"] };
  document.querySelectorAll(".tabbar a").forEach((x) => x.classList.toggle("on", x.dataset.t === name || (TABS[x.dataset.t] ?? []).includes(name)));
  screen.classList.remove("full");
  $(".tabbar").classList.toggle("dark", TABS.feed.includes(name));
  screen.scrollTop = 0;
  R[name](a, b);
}
window.addEventListener("hashchange", route);
const back = () => (history.length > 1 ? history.back() : (location.hash = "#home"));
const header = (title, showBack = true) => `<h1>${showBack ? `<button class="back" onclick="history.back()">←</button>` : ""}${title}</h1>`;
const notice = () => (setting("app_notice", "") ? `<div class="notice" translate="no">📢 ${esc(setting("app_notice", ""))}</div>` : "");

// ---------------- FEED ----------------
const CATS = [["", "সব"], ["natok", "🎭 নাটক"], ["movie", "🎬 মুভি"], ["funny", "😂 ফানি"], ["vlog", "📹 ব্লগ"], ["music", "🎵 গান"], ["other", "📦 অন্যান্য"]];
R.feed = (cat) => openFeed({ type: "foryou", category: cat || "" });
R.following = () => openFeed({ type: "following" });
R.watch = (userId, videoId) => openFeed({ type: "user", user: userId, startId: Number(videoId) });
R.play = (videoId) => openFeed({ type: "play", startId: Number(videoId) });
R.v = async (videoId) => {
  const { data } = await sb.from("videos").select("user_id").eq("id", videoId).maybeSingle();
  if (!data) { toast("ভিডিওটি আর নেই", true); location.replace("#feed"); return; }
  location.replace(`#watch/${data.user_id}/${videoId}`);
};

function openFeed({ type, user = null, startId = null, category = "" }) {
  screen.classList.add("full");
  screen.innerHTML = `
    <div class="feed-top">
      ${type === "user" || type === "play" ? `<a class="back-l" href="javascript:history.back()">←</a>` : `
      <a href="#following" class="${type === "following" ? "on" : ""}">ফলোয়িং</a>
      <a href="#feed" class="${type === "foryou" ? "on" : ""}">আপনার জন্য</a>`}
    </div>
    ${type === "foryou" ? `<div class="cat-row">${CATS.map(([k, l]) => `<a href="#feed${k ? "/" + k : ""}" class="${k === category ? "on" : ""}">${l}</a>`).join("")}</div>` : ""}
    <div class="feed" id="feed"></div>`;
  const feedEl = $("#feed");
  const st = { before: startId ? startId + 1 : null, loading: false, done: false, slides: [], active: null, swipes: 0, timer: null };
  const minWatch = Number(setting("min_watch_ms", 5000));
  const inter = S.ads.feed_interstitial;

  const obs = new IntersectionObserver((entries) => {
    for (const en of entries) if (en.isIntersecting && en.intersectionRatio >= 0.6) activate(en.target);
  }, { root: feedEl, threshold: [0.6] });

  async function more() {
    if (st.loading || st.done) return;
    st.loading = true;
    try {
      const rows = await rpc("feed", { p_type: type === "user" || type === "play" ? "foryou" : type, p_before: st.before, p_limit: 8, p_user: user, p_category: category || null });
      if (!rows.length) {
        st.done = true;
        if (!st.slides.length) {
          feedEl.innerHTML = `<div class="slide"><div class="center-msg">${type === "following"
            ? "আপনি যাদের ফলো করেন তাদের ভিডিও এখানে দেখা যাবে।<br><br><a class='btn small' href='#feed'>সব ভিডিও দেখুন</a>"
            : "এখনো কোনো ভিডিও নেই।<br><br><a class='btn small' href='#upload'>প্রথম ভিডিও আপলোড করুন</a>"}</div></div>`;
        }
      }
      for (const v of rows) {
        const el = slideEl(v, st.slides.length);
        st.slides.push(el);
        feedEl.appendChild(el);
        obs.observe(el);
      }
      if (rows.length) st.before = rows[rows.length - 1].id;
    } catch (e) { toast(errMsg(e), true); }
    st.loading = false;
  }

  function slideEl(v, idx) {
    const el = document.createElement("div");
    el.className = "slide";
    el.dataset.idx = idx;
    el._v = v;
    el._watched = 0;
    el.innerHTML = `
      <video playsinline webkit-playsinline loop preload="none" ${v.thumb_url ? `poster="${esc(v.thumb_url)}"` : ""}></video>
      <div class="shade"></div>
      <button class="mute">${S.muted ? "🔇" : "🔊"}</button>
      <div class="actions">
        <a href="#u/${v.user_id}">${avatar(v)}</a>
        <button class="act like ${v.liked_by_me ? "liked" : ""}"><span class="ic">${v.liked_by_me ? "❤️" : "🤍"}</span><span class="c">${n(v.likes_count)}</span></button>
        <button class="act cm"><span class="ic">💬</span><span class="c">${n(v.comments_count)}</span></button>
        ${v.allow_gifts && v.user_id !== S.me.id ? `<button class="act gf"><span class="ic">🎁</span><span>গিফট</span></button>` : ""}
        <button class="act sh"><span class="ic">↗️</span><span class="c">${n(v.shares_count)}</span></button>
        ${v.user_id !== S.me.id ? `<button class="act rp"><span class="ic" style="font-size:20px">⚑</span></button>` : ""}
      </div>
      <div class="info">
        <div class="uname"><a href="#u/${v.user_id}">@${esc(v.username)}</a>${v.is_verified ? " ✔️" : ""}${v.is_premium ? `<span class="premtag">👑 ${n(v.premium_coins)}</span>` : ""}
          ${v.user_id !== S.me.id ? `<button class="follow-btn ${v.following ? "on" : ""}">${v.following ? "ফলোয়িং" : "ফলো"}</button>` : ""}</div>
        <div class="cap" translate="no">${esc(v.caption ?? "").replace(/#([^\s#]+)/g, '<span class="tag">#$1</span>')}</div>
        <div class="tiny muted">👁 ${n(v.views_count)} · ${ago(v.created_at)}</div>
      </div>
      ${v.locked ? `<div class="lockov"><div><div class="crown">👑</div><h3 style="margin:6px 0">প্রিমিয়াম ভিডিও</h3>
        <div class="muted">🪙 ${n(v.premium_coins)} কয়েন · হোস্টদের জন্য ফ্রি</div>
        <button class="btn unl">🪙 ${n(v.premium_coins)} কয়েনে দেখুন</button></div></div>` : ""}`;
    el.querySelector(".unl")?.addEventListener("click", async (e) => {
      if (!confirm(`${v.premium_coins} কয়েন দিয়ে ভিডিওটি দেখবেন?`)) return;
      e.currentTarget.disabled = true;
      try {
        const r = await rpc("unlock_premium", { p_video: v.id });
        v.video_url = r.video_url; v.locked = false;
        el.querySelector(".lockov")?.remove();
        if (st.active === el) { setSrc(el, true); const vd = el.querySelector("video"); vd.muted = S.muted; vd.play().catch(() => {}); }
        if (r.charged) toast(`👑 আনলক হয়েছে (−${r.charged} কয়েন)`);
      } catch (er) {
        toast(errMsg(er), true); e.target.disabled = false;
        if (String(er.message).includes("INSUFFICIENT_COINS")) setTimeout(() => (location.hash = "#cashin"), 900);
      }
    });
    const video = el.querySelector("video");
    let tapT = null;
    video.addEventListener("click", (e) => {
      if (tapT) { clearTimeout(tapT); tapT = null; doLike(el, true, e); return; }
      tapT = setTimeout(() => {
        tapT = null;
        if (video.paused) { video.play().catch(() => {}); el.querySelector(".paused-ic")?.remove(); }
        else { video.pause(); el.insertAdjacentHTML("beforeend", `<div class="paused-ic">▶</div>`); }
      }, 260);
    });
    el.querySelector(".mute").onclick = () => {
      S.muted = !S.muted;
      document.querySelectorAll(".slide video").forEach((x) => (x.muted = S.muted));
      document.querySelectorAll(".mute").forEach((x) => (x.textContent = S.muted ? "🔇" : "🔊"));
    };
    el.querySelector(".like").onclick = () => doLike(el, false);
    el.querySelector(".cm").onclick = () => openComments(el);
    el.querySelector(".gf")?.addEventListener("click", () => openGifts(el));
    el.querySelector(".sh").onclick = () => doShare(el);
    el.querySelector(".rp")?.addEventListener("click", () => doReport(v));
    el.querySelector(".follow-btn")?.addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      try {
        const on = await rpc("toggle_follow", { p_target: v.user_id });
        document.querySelectorAll(".slide").forEach((s) => {
          if (s._v?.user_id !== v.user_id) return;
          s._v.following = on;
          const fb = s.querySelector(".follow-btn");
          if (fb) { fb.classList.toggle("on", on); fb.textContent = on ? "ফলোয়িং" : "ফলো"; }
        });
        if (!btn) return;
      } catch (err) { toast(errMsg(err), true); }
    });
    return el;
  }

  function setSrc(el, on) {
    if (!el) return;
    const video = el.querySelector("video");
    if (on && !video.getAttribute("src") && el._v.video_url) { video.src = el._v.video_url; video.preload = "auto"; }
    if (!on && video.getAttribute("src")) { video.pause(); video.removeAttribute("src"); video.load(); }
  }

  function activate(el) {
    if (st.active === el) return;
    if (st.active) { st.active.querySelector("video").pause(); st.active.querySelector(".paused-ic")?.remove(); }
    st.active = el;
    const idx = Number(el.dataset.idx);
    st.slides.forEach((s, i) => setSrc(s, Math.abs(i - idx) <= 1 || (i === idx + 2)));
    const video = el.querySelector("video");
    video.muted = S.muted;
    video.currentTime = 0;
    video.play().catch(() => {
      S.muted = true;
      document.querySelectorAll(".mute").forEach((x) => (x.textContent = "🔇"));
      video.muted = true;
      video.play().catch(() => {});
    });
    st.swipes++;
    if (inter && Native?.showInterstitial && inter.every_n_videos && st.swipes > 1 && st.swipes % inter.every_n_videos === 0) {
      video.pause();
      try { Native.showInterstitial(inter.unit_id_android); } catch { /* */ }
    }
    if (idx >= st.slides.length - 3) more();
  }

  // ওয়াচ টাইম: min_watch_ms পূর্ণ হলে একবার ভিউ পাঠানো হয়
  st.timer = setInterval(() => {
    const el = st.active;
    if (!el || document.hidden) return;
    const video = el.querySelector("video");
    if (video.paused || video.readyState < 3) return;
    el._watched += 500;
    if (!el._sent && el._watched >= minWatch && el._v.user_id !== S.me.id) {
      el._sent = true;
      rpc("record_view", { p_video_id: el._v.id, p_watch_ms: el._watched })
        .then((r) => { if (r?.points > 0) toast(`+${r.points} পয়েন্ট`); })
        .catch(() => { el._sent = false; });
    }
  }, 500);

  window.onAdClosed = () => { st.active?.querySelector("video")?.play().catch(() => {}); };
  const onVis = () => { if (document.hidden) st.active?.querySelector("video")?.pause(); };
  document.addEventListener("visibilitychange", onVis);
  cleanup = () => {
    clearInterval(st.timer);
    obs.disconnect();
    document.removeEventListener("visibilitychange", onVis);
    st.slides.forEach((s) => setSrc(s, false));
  };
  more();
}

async function doLike(el, fromDoubleTap, ev) {
  const v = el._v;
  if (fromDoubleTap) {
    const r = el.getBoundingClientRect();
    const h = document.createElement("div");
    h.className = "heart-pop"; h.textContent = "❤️";
    h.style.left = (ev ? ev.clientX - r.left - 45 : r.width / 2 - 45) + "px";
    h.style.top = (ev ? ev.clientY - r.top - 60 : r.height / 2 - 60) + "px";
    el.appendChild(h); setTimeout(() => h.remove(), 800);
    if (v.liked_by_me) return;
  }
  const btn = el.querySelector(".like");
  v.liked_by_me = !v.liked_by_me;
  v.likes_count += v.liked_by_me ? 1 : -1;
  const paint = () => { btn.classList.toggle("liked", v.liked_by_me); btn.querySelector(".ic").textContent = v.liked_by_me ? "❤️" : "🤍"; btn.querySelector(".c").textContent = n(v.likes_count); };
  paint();
  try {
    const r = await rpc("toggle_like", { p_video_id: v.id });
    v.liked_by_me = r.liked; v.likes_count = r.likes_count; paint();
  } catch (e) { v.liked_by_me = !v.liked_by_me; v.likes_count += v.liked_by_me ? 1 : -1; paint(); toast(errMsg(e), true); }
}

async function openComments(el) {
  const v = el._v;
  const body = sheet(`<h3>কমেন্ট</h3><div class="comments" id="cl"><div class="spinner"></div></div>
    ${v.allow_comments ? `<form class="cmt-box" id="cf"><input id="ci" placeholder="কমেন্ট লিখুন…" maxlength="1000" autocomplete="off"><button class="btn small">পাঠান</button></form>` : `<p class="muted tiny">কমেন্ট বন্ধ</p>`}`);
  const load = async () => {
    const { data } = await sb.from("comments").select("id,body,created_at,user_id,profiles!comments_user_id_fkey(username,full_name,avatar_url)")
      .eq("video_id", v.id).eq("status", "visible").order("id", { ascending: false }).limit(100);
    $("#cl", body).innerHTML = data?.length ? data.map((c) => `<div class="cmt">${avatar(c.profiles)}<div><div class="u">@${esc(c.profiles?.username)} · ${ago(c.created_at)}</div><span translate="no">${esc(c.body)}</span></div>
      ${c.user_id === S.me.id || v.user_id === S.me.id ? `<button class="del" data-id="${c.id}">মুছুন</button>` : ""}</div>`).join("")
      : `<div class="empty">প্রথম কমেন্ট আপনিই করুন</div>`;
  };
  load();
  $("#cl", body).onclick = async (e) => {
    const d = e.target.closest(".del");
    if (!d || !confirm("কমেন্ট মুছবেন?")) return;
    try { await rpc("delete_comment", { p_id: Number(d.dataset.id) }); v.comments_count--; el.querySelector(".cm .c").textContent = n(v.comments_count); load(); }
    catch (er) { toast(errMsg(er), true); }
  };
  $("#cf", body)?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const t = $("#ci", body).value.trim();
    if (!t) return;
    $("#ci", body).value = "";
    try { await rpc("add_comment", { p_video_id: v.id, p_body: t }); v.comments_count++; el.querySelector(".cm .c").textContent = n(v.comments_count); load(); }
    catch (er) { toast(errMsg(er), true); }
  });
}

async function openGifts(el) {
  const v = el._v;
  if (!S.gifts) {
    const { data } = await sb.from("gifts").select("*").eq("is_active", true).order("sort_order");
    S.gifts = data ?? [];
  }
  const { data: w } = await sb.from("wallets").select("coin_balance").eq("user_id", S.me.id).single();
  let sel = S.gifts[0], qty = 1, coins = w?.coin_balance ?? 0;
  const body = sheet(`<h3>@${esc(v.username)}-কে গিফট পাঠান</h3>
    <div class="coinbar"><span>আপনার কয়েন: <b id="gc">🪙 ${n(coins)}</b></span><a class="btn small" href="#cashin">কয়েন কিনুন</a></div>
    <div class="gifts">${S.gifts.map((g, i) => `<div class="gift ${i === 0 ? "sel" : ""}" data-i="${i}"><div class="e">${esc(g.icon)}</div><div class="n">${esc(g.name)}</div><div class="c">🪙 ${n(g.coin_price)}</div></div>`).join("")}</div>
    <div class="qty">${[1, 5, 10, 50].map((q) => `<button data-q="${q}" class="${q === 1 ? "sel" : ""}">x${q}</button>`).join("")}</div>
    <button class="btn primary" id="gs">পাঠান · 🪙 <span id="gt">${n(sel?.coin_price ?? 0)}</span></button>`);
  const total = () => (sel?.coin_price ?? 0) * qty;
  const paint = () => { $("#gt", body).textContent = n(total()); };
  $(".gifts", body).onclick = (e) => {
    const g = e.target.closest(".gift"); if (!g) return;
    body.querySelectorAll(".gift").forEach((x) => x.classList.remove("sel")); g.classList.add("sel");
    sel = S.gifts[Number(g.dataset.i)]; paint();
  };
  $(".qty", body).onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    body.querySelectorAll(".qty button").forEach((x) => x.classList.remove("sel")); b.classList.add("sel");
    qty = Number(b.dataset.q); paint();
  };
  $("#gs", body).onclick = async (e) => {
    if (!sel) return;
    if (total() > coins) { toast(ERR.INSUFFICIENT_COINS, true); return; }
    e.currentTarget.disabled = true;
    try {
      const r = await rpc("send_gift", { p_video_id: v.id, p_gift_id: sel.id, p_qty: qty, p_idem: uuid() });
      closeSheet();
      const f = document.createElement("div"); f.className = "gift-fly"; f.textContent = sel.icon; document.body.appendChild(f); setTimeout(() => f.remove(), 1700);
      toast(`${sel.icon} x${qty} পাঠানো হয়েছে! বাকি কয়েন ${n(r.coin_balance)}`);
    } catch (er) { toast(errMsg(er), true); e.currentTarget.disabled = false; }
  };
}

async function doShare(el) {
  const v = el._v;
  const text = `${v.caption ? v.caption + "\n\n" : ""}🎬 @${v.username}-এর ভিডিও দেখুন Reels Enjoy অ্যাপে — দেখুন আর আয় করুন!`;
  try {
    if (Native?.share) Native.share(text);
    else if (navigator.share) await navigator.share({ text });
    else { await navigator.clipboard.writeText(text); toast("লিংক কপি হয়েছে"); }
    await rpc("share_video", { p_video_id: v.id });
    v.shares_count++; el.querySelector(".sh .c").textContent = n(v.shares_count);
  } catch { /* cancelled */ }
}

function doReport(v) {
  const reasons = ["অশ্লীল কনটেন্ট", "সহিংসতা", "স্প্যাম/প্রতারণা", "কপিরাইট", "অন্যান্য"];
  const body = sheet(`<h3>ভিডিও রিপোর্ট</h3>${reasons.map((r) => `<button class="btn" style="width:100%;margin-bottom:8px" data-r="${r}">${r}</button>`).join("")}`);
  body.onclick = async (e) => {
    const b = e.target.closest("[data-r]"); if (!b) return;
    try { await rpc("report_content", { p_type: "video", p_target: String(v.id), p_reason: b.dataset.r }); toast("ধন্যবাদ, রিপোর্ট পাঠানো হয়েছে"); }
    catch (er) { toast(errMsg(er), true); }
    closeSheet();
  };
}

// ---------------- UPLOAD ----------------
R.upload = () => {
  const maxSec = Number(setting("max_video_sec", 90));
  screen.innerHTML = `<div class="page">${header("ভিডিও আপলোড", false)}
    <label class="pick" id="pickL"><input type="file" id="vf" accept="video/*" class="hidden"><div class="ic">🎬</div>
      <b>ভিডিও বেছে নিন</b><div class="muted tiny">সর্বোচ্চ ${maxSec} সেকেন্ড · খাড়া (9:16) ভিডিও সবচেয়ে ভালো দেখায়</div></label>
    <video id="pv" class="preview hidden" controls playsinline></video>
    <label class="lbl">ক্যাটাগরি</label>
    <select id="cat">${CATS.filter(([k]) => k).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select>
    <div class="card" style="margin-top:12px">
      <label class="toggle"><span><b>👑 প্রিমিয়াম ভিডিও</b><div class="tiny muted">দর্শক কয়েন দিয়ে দেখবে, আপনি পাবেন ${n(setting("premium_creator_pct", 60))}%। হোস্টরা ফ্রি দেখবে। অ্যাডমিন দেখে অনুমোদন দেবেন।</div></span><input type="checkbox" id="prem"></label>
      <div id="premBox" class="hidden"><span class="lbl">কত কয়েন লাগবে</span><input id="premC" type="number" min="1" max="100000" value="${n(setting("premium_default_coins", 10))}"></div></div>
    <label class="lbl">ক্যাপশন (#হ্যাশট্যাগ দিন)</label>
    <textarea id="cap" maxlength="2200" placeholder="ভিডিও সম্পর্কে লিখুন… #funny #bangla"></textarea>
    <button class="btn primary" id="up" disabled>আপলোড করুন</button>
    <div class="progress hidden" id="pg"><div></div></div>
    <p id="msg" class="muted tiny"></p>
    <p class="muted tiny" id="quota"></p>
    <p class="muted tiny">আপলোডের পর ভিডিও অল্প সময় পর্যালোচনায় থাকবে, তারপর সবাই দেখতে পাবে।</p>
    <p class="muted tiny">অশ্লীল, সহিংস বা অন্যের কপিরাইট করা ভিডিও আপলোড করলে অ্যাকাউন্ট ব্লক ও ইনকাম বাতিল হবে।</p></div>`;
  const vf = $("#vf"), pv = $("#pv");
  let file = null, duration = 0;
  $("#prem").onchange = (e) => $("#premBox").classList.toggle("hidden", !e.target.checked);
  rpc("my_upload_quota").then((q) => {
    const left = Math.max(0, q.limit - q.used);
    $("#quota").textContent = `আজকের আপলোড বাকি: ${left} / ${q.limit}`;
    if (!left && S.me.role !== "admin") { $("#pickL").style.opacity = .5; vf.disabled = true; toast(ERR.UPLOAD_LIMIT, true); }
  }).catch(() => {});
  vf.onchange = () => {
    file = vf.files[0];
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) { toast(`ফাইল ${(file.size / 1048576).toFixed(0)}MB — সর্বোচ্চ 50MB`, true); file = null; return; }
    pv.src = URL.createObjectURL(file);
    pv.classList.remove("hidden");
    pv.onloadedmetadata = () => {
      duration = Math.round(pv.duration || 0);
      if (duration > maxSec + 1) { toast(`ভিডিও ${duration} সেকেন্ড — সর্বোচ্চ ${maxSec} সেকেন্ড`, true); file = null; $("#up").disabled = true; return; }
      $("#up").disabled = false;
      $("#msg").textContent = `${duration} সেকেন্ড · ${(file.size / 1048576).toFixed(1)}MB`;
    };
  };
  $("#up").onclick = async () => {
    if (!file) return;
    const btn = $("#up"); btn.disabled = true;
    const pg = $("#pg"); pg.classList.remove("hidden");
    const setP = (x, m) => { pg.firstElementChild.style.width = Math.round(x) + "%"; $("#msg").textContent = m; };
    try {
      setP(2, "থাম্বনেইল তৈরি হচ্ছে…");
      const thumb = await makeThumb(pv);
      const stamp = Date.now();
      const ext = ((file.name || "").split(".").pop() || "mp4").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp4";
      const vPath = `${S.me.id}/${stamp}.${ext}`, tPath = `${S.me.id}/${stamp}.jpg`;
      await xhrUpload("videos", vPath, file, file.type || "video/mp4", (p) => setP(5 + p * 85, `আপলোড হচ্ছে… ${Math.round(p * 100)}%`));
      setP(92, "শেষ করা হচ্ছে…");
      let tUrl = null;
      if (thumb) { await xhrUpload("thumbs", tPath, thumb, "image/jpeg", () => {}); tUrl = sb.storage.from("thumbs").getPublicUrl(tPath).data.publicUrl; }
      const vUrl = sb.storage.from("videos").getPublicUrl(vPath).data.publicUrl;
      const id = await rpc("create_video", { p_video_path: vPath, p_video_url: vUrl, p_thumb_url: tUrl, p_caption: $("#cap").value, p_duration: duration });
      await rpc("set_video_category", { p_id: id, p_category: $("#cat").value }).catch(() => {});
      const prem = $("#prem").checked;
      if (prem) await rpc("set_video_premium", { p_video: id, p_premium: true, p_coins: Number($("#premC").value) || null });
      setP(100, "✅ আপলোড সম্পন্ন!");
      const mins = Number(setting("auto_approve_minutes", 2));
      toast(prem ? "আপলোড হয়েছে ✅ প্রিমিয়াম ভিডিও অ্যাডমিন অনুমোদনের পর প্রকাশিত হবে" : mins > 0 ? `আপলোড হয়েছে ✅ ${mins} মিনিটের মধ্যে প্রকাশিত হবে` : "আপলোড হয়েছে ✅ অ্যাডমিন অ্যাপ্রুভ করলে প্রকাশিত হবে");
      void id;
      setTimeout(() => (location.hash = "#u/" + S.me.id), 900);
    } catch (e) { toast(errMsg(e), true); $("#msg").textContent = "ব্যর্থ: " + errMsg(e); btn.disabled = false; }
  };
};

async function makeThumb(video) {
  try {
    await new Promise((r) => (video.readyState >= 1 ? r() : (video.onloadedmetadata = r)));
    video.currentTime = Math.min(1, (video.duration || 2) / 2);
    await new Promise((r, j) => { video.onseeked = r; setTimeout(r, 3000); });
    const w = video.videoWidth || 540, h = video.videoHeight || 960;
    const scale = Math.min(1, 540 / w);
    const c = document.createElement("canvas");
    c.width = Math.round(w * scale); c.height = Math.round(h * scale);
    c.getContext("2d").drawImage(video, 0, 0, c.width, c.height);
    return await new Promise((r) => c.toBlob(r, "image/jpeg", 0.8));
  } catch { return null; }
}

async function xhrUpload(bucket, path, blob, type, onProg) {
  const { data: { session } } = await sb.auth.getSession();
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("POST", `${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`);
    x.setRequestHeader("Authorization", "Bearer " + session.access_token);
    x.setRequestHeader("apikey", SUPABASE_KEY);
    x.setRequestHeader("Content-Type", type);
    x.setRequestHeader("x-upsert", "false");
    x.upload.onprogress = (e) => e.lengthComputable && onProg(e.loaded / e.total);
    x.onload = () => {
      if (x.status < 300) return resolve();
      let m = x.responseText;
      try { m = JSON.parse(x.responseText).message ?? m; } catch { /* */ }
      reject(new Error(m));
    };
    x.onerror = () => reject(new Error("NETWORK"));
    x.send(blob);
  });
}

// ---------------- WALLET ----------------
const TX = {
  view_earning: "ভিউ থেকে আয়", like_earning: "লাইক থেকে আয়", comment_earning: "কমেন্ট থেকে আয়", gift_received: "গিফট পেয়েছেন",
  gift_sent: "গিফট পাঠিয়েছেন", watch_reward: "ভিডিও দেখে পয়েন্ট", ad_reward_viewer: "অ্যাড দেখে পয়েন্ট", ad_reward_creator: "আপনার ভিডিওতে অ্যাড",
  points_convert: "পয়েন্ট → টাকা", pending_release: "পেন্ডিং থেকে ব্যালেন্সে", cash_in: "ক্যাশ-ইন (কয়েন)", withdraw_hold: "উইথড্র রিকোয়েস্ট",
  withdraw_refund: "উইথড্র ফেরত", admin_adjust: "অ্যাডমিন অ্যাডজাস্টমেন্ট", premium_unlock: "প্রিমিয়াম ভিডিও আনলক", jail_release: "জেল থেকে মুক্তি",
};
R.wallet = async () => {
  screen.innerHTML = `<div class="page">${header("ওয়ালেট")}<div class="spinner"></div></div>`;
  const { data: w } = await sb.from("wallets").select("*").eq("user_id", S.me.id).single();
  const rew = S.ads.rewarded_points;
  const paint = (w) => {
    screen.innerHTML = `<div class="page">${header("ওয়ালেট")}${notice()}
      <div class="card hero"><div class="k">উইথড্রযোগ্য ব্যালেন্স</div><div class="v" id="wb">${tk(w.earning_paisa)}</div>
        <div class="stats"><div><b>${tk(w.pending_paisa)}</b><span>পেন্ডিং</span></div><div><b>🪙 ${n(w.coin_balance)}</b><span>কয়েন</span></div><div><b>⭐ ${n(w.points)}</b><span>পয়েন্ট</span></div></div>
      </div>
      <div class="menu">
        <a href="#withdraw"><span class="ic">💸</span>উইথড্র<small>bKash / Nagad / Rocket</small></a>
        <a href="#cashin"><span class="ic">🪙</span>কয়েন কিনুন<small>গিফট পাঠাতে</small></a>
        <button id="conv"><span class="ic">🔁</span>পয়েন্ট → টাকা<small>${n(setting("points_convert_min", 1000))} পয়েন্ট থেকে</small></button>
        ${rew && Native?.showRewarded ? `<button id="rw"><span class="ic">📺</span>অ্যাড দেখে পয়েন্ট<small>+${rew.viewer_points} পয়েন্ট</small></button>` : `<a href="#history"><span class="ic">📜</span>লেনদেন<small>সব হিসাব</small></a>`}
      </div>
      ${rew && Native?.showRewarded ? `<a class="btn" style="width:100%;margin-bottom:12px" href="#history">📜 লেনদেনের হিসাব</a>` : ""}
      <div class="card"><b>কীভাবে আয় করবেন</b>
        <div class="list tiny">
          <div class="li"><span>আপনার ভিডিওর প্রতি ১০০০ ভিউ</span><b>${tk(setting("view_rate_paisa_per_1000"))}</b></div>
          <div class="li"><span>প্রতি লাইক / প্রতি কমেন্টকারী</span><b>${tk(setting("like_rate_paisa"))} / ${tk(setting("comment_rate_paisa"))}</b></div>
          <div class="li"><span>গিফট পেলে</span><b>গিফটের দামের বড় অংশ</b></div>
          <div class="li"><span>ভিডিও দেখে (প্রতি ভিডিও, দিনে সর্বোচ্চ ${n(setting("viewer_daily_points_cap"))})</span><b>+${n(setting("watch_points"))} পয়েন্ট</b></div>
          <div class="li"><span>${n(setting("points_convert_min"))} পয়েন্ট</span><b>${tk(setting("points_convert_min") * setting("point_value_paisa"))}</b></div>
          <div class="li"><span>আয় ব্যালেন্সে আসে</span><b>${n(setting("pending_hold_hours"))} ঘণ্টা পরে</b></div>
          <div class="li"><span>সর্বনিম্ন উইথড্র</span><b>${tk(setting("withdraw_min_paisa"))} · ${n(setting("withdraw_cooldown_days"))} দিনে একবার</b></div>
        </div></div></div>`;
    $("#conv").onclick = async () => {
      const min = Number(setting("points_convert_min", 1000));
      if (w.points < min) return toast(`কমপক্ষে ${n(min)} পয়েন্ট লাগবে`, true);
      if (!confirm(`${n(w.points)} পয়েন্ট → ${tk(w.points * setting("point_value_paisa", 1))} ব্যালেন্সে যোগ করবেন?`)) return;
      try { const r = await rpc("convert_points", { p_points: w.points }); toast(`${tk(r.paisa)} যোগ হয়েছে`); R.wallet(); }
      catch (e) { toast(errMsg(e), true); }
    };
    $("#rw")?.addEventListener("click", () => {
      toast("অ্যাড লোড হচ্ছে…");
      try { Native.showRewarded(rew.unit_id_android, S.me.id, ""); } catch { toast("অ্যাড চালানো যায়নি", true); }
    });
  };
  paint(w);
  const onW = (e) => paint(e.detail);
  document.addEventListener("wallet", onW);
  cleanup = () => document.removeEventListener("wallet", onW);
};
// APK অ্যাড শেষ হলে এটা কল করে
window.onRewardedResult = (status) => {
  if (status === "earned") { toast("🎉 পয়েন্ট যোগ হচ্ছে…"); setTimeout(() => location.hash === "#wallet" && R.wallet(), 4000); }
  else if (status === "failed") toast("এখন কোনো অ্যাড নেই, একটু পরে চেষ্টা করুন", true);
};

R.history = async () => {
  screen.innerHTML = `<div class="page">${header("লেনদেনের হিসাব")}<div class="card list" id="tl"><div class="spinner"></div></div></div>`;
  const { data } = await sb.from("transactions").select("*").eq("user_id", S.me.id).order("id", { ascending: false }).limit(150);
  const unit = (t) => (t.bucket === "coin" ? "🪙 " + n(Math.abs(t.amount)) : t.bucket === "points" ? "⭐ " + n(Math.abs(t.amount)) : tk(Math.abs(t.amount)));
  const where = { coin: "কয়েন", earning: "ব্যালেন্স", pending: "পেন্ডিং", points: "পয়েন্ট" };
  $("#tl").innerHTML = data?.length ? data.filter((t) => !(t.type === "pending_release" && t.bucket === "pending")).map((t) => `<div class="li">
    <div><b>${TX[t.type] ?? t.type}</b><div class="tiny muted">${dt(t.created_at)} · ${where[t.bucket]}${t.note ? " · " + esc(t.note) : ""}</div></div>
    <span class="${t.amount >= 0 ? "plus-amt" : "minus-amt"}">${t.amount >= 0 ? "+" : "−"}${unit(t)}</span></div>`).join("") : `<div class="empty">এখনো কোনো লেনদেন নেই</div>`;
};

R.cashin = async () => {
  const nums = ["bkash", "nagad", "rocket"].filter((m) => setting(m + "_number", ""));
  const coinPrice = Number(setting("coin_price_paisa", 100));
  screen.innerHTML = `<div class="page">${header("কয়েন কিনুন")}
    ${nums.length ? `<div class="card"><b>ধাপ ১:</b> <span>নিচের নম্বরে Send Money করুন</span>
      ${nums.map((m) => `<div class="row" style="margin-top:8px"><span>${METHOD[m]}</span><span class="copy" data-copy="${esc(setting(m + "_number"))}">${esc(setting(m + "_number"))}</span></div>`).join("")}
      <p class="tiny muted" style="margin:10px 0 0">৳১ = 🪙 ${n(100 / coinPrice)} কয়েন · সর্বনিম্ন ৳${n(setting("min_cash_in_taka", 20))}</p></div>
    <form class="card" id="cf"><b>ধাপ ২:</b> পেমেন্টের তথ্য দিন
      <div class="methods">${nums.map((m, i) => `<label><input type="radio" name="m" value="${m}" ${i === 0 ? "checked" : ""}>${METHOD[m]}</label>`).join("")}</div>
      <input id="am" type="number" inputmode="numeric" min="1" placeholder="কত টাকা পাঠিয়েছেন" required>
      <div class="tiny muted" id="cv"></div>
      <input id="sn" inputmode="numeric" placeholder="যে নম্বর থেকে পাঠিয়েছেন (01XXXXXXXXX)" required>
      <input id="tx" placeholder="TrxID (যেমন 9AB7C6D5E4)" autocapitalize="characters" required>
      <button class="btn primary">রিকোয়েস্ট পাঠান</button>
      <p class="tiny muted">অ্যাডমিন যাচাই করার পর কয়েন যোগ হবে। ভুল/ভুয়া TrxID দিলে অ্যাকাউন্ট ব্লক হবে।</p></form>`
    : `<div class="card">ক্যাশ-ইন এখন বন্ধ আছে। পরে চেষ্টা করুন।</div>`}
    <h3>আপনার রিকোয়েস্ট</h3><div class="card list" id="cl"><div class="spinner"></div></div></div>`;
  $("#am")?.addEventListener("input", (e) => ($("#cv").textContent = e.target.value ? `আপনি পাবেন 🪙 ${n(Math.floor(e.target.value * 100 / coinPrice))} কয়েন` : ""));
  $("#cf")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const b = e.submitter; b.disabled = true;
    try {
      await rpc("request_cash_in", { p_method: $("input[name=m]:checked").value, p_amount_taka: Math.floor(Number($("#am").value)),
        p_sender: cleanPhone($("#sn").value), p_trx: $("#tx").value.trim() });
      toast("রিকোয়েস্ট পাঠানো হয়েছে — যাচাইয়ের পর কয়েন যোগ হবে");
      R.cashin();
    } catch (er) { toast(errMsg(er), true); b.disabled = false; }
  });
  const { data } = await sb.from("cash_in_requests").select("*").eq("user_id", S.me.id).order("id", { ascending: false }).limit(20);
  $("#cl").innerHTML = data?.length ? data.map((c) => `<div class="li"><div><b>${tk(c.amount_paisa)}</b> · ${METHOD[c.method]} · 🪙 ${n(c.coins)}
    <div class="tiny muted">${dt(c.created_at)} · TrxID ${esc(c.trx_id)}${c.reject_reason ? " · " + esc(c.reject_reason) : ""}</div></div><span class="pill ${c.status}">${STATUS[c.status]}</span></div>`).join("")
    : `<div class="empty">কোনো রিকোয়েস্ট নেই</div>`;
};

R.withdraw = async () => {
  screen.innerHTML = `<div class="page">${header("উইথড্র")}<div class="spinner"></div></div>`;
  const [el, { data: hist }] = await Promise.all([
    rpc("withdraw_eligibility").catch((e) => ({ error: e })),
    sb.from("withdraw_requests").select("*").eq("user_id", S.me.id).order("id", { ascending: false }).limit(20),
  ]);
  if (el.error) { screen.innerHTML = `<div class="page">${header("উইথড্র")}<div class="empty">${esc(errMsg(el.error))}</div></div>`; return; }
  let block = "";
  if (el.frozen) block = ERR.WALLET_FROZEN;
  else if (el.has_open_request) block = "আপনার আগের রিকোয়েস্ট প্রসেস হচ্ছে। শেষ হলে আবার করতে পারবেন।";
  else if (!el.account_age_ok) block = ERR.ACCOUNT_TOO_NEW;
  else if (el.next_available_at && new Date(el.next_available_at) > new Date()) block = "cooldown";
  else if (el.balance_paisa < el.min_paisa) block = `সর্বনিম্ন ${tk(el.min_paisa)} হলে উইথড্র করা যাবে। এখন আছে ${tk(el.balance_paisa)}।`;
  screen.innerHTML = `<div class="page">${header("উইথড্র")}
    <div class="card hero"><div class="k">উইথড্রযোগ্য ব্যালেন্স</div><div class="v">${tk(el.balance_paisa)}</div>
      <div class="tiny" style="color:#d5cbee">সর্বনিম্ন ${tk(el.min_paisa)} · ${n(setting("withdraw_cooldown_days", 7))} দিনে একবার${el.fee_pct ? ` · চার্জ ${el.fee_pct}%` : ""}</div></div>
    ${block === "cooldown" ? `<div class="card" style="text-align:center"><div class="muted">পরবর্তী উইথড্র করা যাবে</div><div style="font-size:24px;font-weight:700" id="cd"></div><div class="tiny muted">${dt(el.next_available_at)}</div></div>`
      : block ? `<div class="notice">${esc(block)}</div>`
      : `<form class="card" id="wf">
        <span class="lbl">কোথায় নেবেন</span>
        <div class="methods">${["bkash", "nagad", "rocket"].map((m, i) => `<label><input type="radio" name="m" value="${m}" ${i === 0 ? "checked" : ""}>${METHOD[m]}</label>`).join("")}</div>
        <input id="ac" inputmode="numeric" placeholder="অ্যাকাউন্ট নম্বর (01XXXXXXXXX)" required>
        <input id="an" placeholder="অ্যাকাউন্টের নাম (ঐচ্ছিক)">
        <input id="am" type="number" inputmode="decimal" step="0.01" placeholder="কত টাকা" value="${(el.balance_paisa / 100).toFixed(2)}" required>
        <button class="btn primary">উইথড্র রিকোয়েস্ট</button>
        <p class="tiny muted">রিকোয়েস্টের পর টাকা ব্যালেন্স থেকে আটকে রাখা হবে। অ্যাডমিন পেমেন্ট পাঠালে নোটিফিকেশন পাবেন; রিজেক্ট হলে টাকা ফেরত আসবে।</p></form>`}
    <h3>উইথড্র হিস্ট্রি</h3><div class="card list">${hist?.length ? hist.map((w) => `<div class="li"><div><b>${tk(w.payable_paisa)}</b> · ${METHOD[w.method]} ${esc(w.account_number)}
      <div class="tiny muted">${dt(w.created_at)}${w.payout_trx_id ? " · TrxID " + esc(w.payout_trx_id) : ""}${w.reject_reason ? " · কারণ: " + esc(w.reject_reason) : ""}</div></div>
      <span class="pill ${w.status}">${STATUS[w.status]}</span></div>`).join("") : `<div class="empty">এখনো উইথড্র করেননি</div>`}</div></div>`;
  if (block === "cooldown") {
    const tick = () => {
      const ms = new Date(el.next_available_at) - Date.now();
      if (ms <= 0) { R.withdraw(); return; }
      const d = Math.floor(ms / 864e5), h = Math.floor((ms % 864e5) / 36e5), m = Math.floor((ms % 36e5) / 6e4);
      const c = $("#cd"); if (c) c.textContent = `${d} দিন ${h} ঘণ্টা ${m} মিনিট`;
    };
    tick();
    const t = setInterval(tick, 30000);
    cleanup = () => clearInterval(t);
  }
  $("#wf")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const amount = Math.round(Number($("#am").value) * 100);
    const m = $("input[name=m]:checked").value, acc = cleanPhone($("#ac").value);
    if (!confirm(`${tk(amount)} ${METHOD[m]} ${acc} নম্বরে উইথড্র করবেন?`)) return;
    const b = e.submitter; b.disabled = true;
    try {
      await rpc("request_withdraw", { p_amount_paisa: amount, p_method: m, p_account: acc, p_name: $("#an").value });
      toast("রিকোয়েস্ট পাঠানো হয়েছে ✅");
      R.withdraw();
    } catch (er) { toast(errMsg(er), true); b.disabled = false; }
  });
};

// ---------------- INBOX ----------------
R.inbox = async () => {
  screen.innerHTML = `<div class="page">${header("নোটিফিকেশন", false)}<div class="card list" id="nl"><div class="spinner"></div></div></div>`;
  const { data } = await sb.from("notifications").select("*").eq("user_id", S.me.id).order("id", { ascending: false }).limit(60);
  const icon = { like: "❤️", comment: "💬", gift: "🎁", follow: "👤", withdraw: "💸", cash_in: "🪙", system: "📢" };
  $("#nl").innerHTML = data?.length ? data.map((x) => `<a class="li" ${x.data?.video_id ? `href="#v/${x.data.video_id}"` : x.data?.user_id ? `href="#u/${x.data.user_id}"` : x.type === "withdraw" ? 'href="#withdraw"' : x.type === "cash_in" ? 'href="#cashin"' : ""}
      style="${x.is_read ? "" : "background:rgba(124,77,255,.08);margin:0 -14px;padding:12px 14px"}">
      <div style="display:flex;gap:10px"><span style="font-size:22px">${icon[x.type] ?? "🔔"}</span><div><b>${esc(x.title)}</b>${x.body ? `<div class="tiny muted">${esc(x.body)}</div>` : ""}<div class="tiny muted">${ago(x.created_at)}</div></div></div></a>`).join("")
    : `<div class="empty">কোনো নোটিফিকেশন নেই</div>`;
  if (S.unread) { await rpc("mark_notifications_read").catch(() => {}); S.unread = 0; $("#unread").textContent = ""; }
};

// ---------------- PROFILE ----------------
const COUNTRY_NAMES = { BD: "বাংলাদেশ", SA: "সৌদি আরব", AE: "দুবাই/আমিরাত", QA: "কাতার", KW: "কুয়েত", OM: "ওমান", BH: "বাহরাইন", MY: "মালয়েশিয়া",
  SG: "সিঙ্গাপুর", MV: "মালদ্বীপ", IN: "ভারত", IT: "ইতালি", GB: "যুক্তরাজ্য", US: "যুক্তরাষ্ট্র", JO: "জর্ডান", LB: "লেবানন", IQ: "ইরাক", LY: "লিবিয়া",
  FR: "ফ্রান্স", ES: "স্পেন", PT: "পর্তুগাল", GR: "গ্রিস", DE: "জার্মানি", RO: "রোমানিয়া", CA: "কানাডা", AU: "অস্ট্রেলিয়া", JP: "জাপান", KR: "দক্ষিণ কোরিয়া" };
const flagOf = (cc) => (cc && cc.length === 2 ? String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 127397 + c.charCodeAt(0))) : "🌐");


// ---------------- HOME (Discover grid) ----------------
const LANGS = [["Bengali", "বাংলা"], ["English", "English"], ["Hindi", "हिन्दी"], ["Urdu", "اردو"], ["Arabic", "العربية"], ["Nepali", "नेपाली"]];
const langName = (l) => (LANGS.find(([k]) => k === l)?.[1] ?? l ?? "");
const LEVELS = [0, 10, 50, 200, 1000, 5000, 20000];
const levelOf = (f) => { let l = 0; LEVELS.forEach((t, i) => { if (Number(f) >= t) l = i; }); return l; };
const fmtDur = (sec) => { sec = Number(sec || 0); return sec ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}` : ""; };
S.disc = { lang: "", country: "" };
try { Object.assign(S.disc, JSON.parse(localStorage.getItem("disc") || "{}")); } catch { /* */ }

R.home = (tab = "discover") => {
  if (!["nearby", "discover", "friends"].includes(tab)) tab = "discover";
  const f = S.disc;
  const countries = Object.keys(COUNTRY_NAMES);
  screen.innerHTML = `<div class="disc">
    <div class="disc-top">
      <div class="disc-tabs">
        <a href="#home/nearby" class="${tab === "nearby" ? "on" : ""}">কাছাকাছি</a>
        <a href="#home" class="${tab === "discover" ? "on" : ""}">ডিসকভার</a>
        <a href="#home/friends" class="${tab === "friends" ? "on" : ""}">ফ্রেন্ডস</a>
        <a href="#top" class="rank" aria-label="র‍্যাংকিং"><svg viewBox="0 0 32 32"><path d="M4 27h24M7 27V17h5v10M13.5 27V7h5v20M20 27V12h5v15" /></svg></a>
      </div>
      <div class="disc-filters">
        <label>🅰️ <span id="flL">${f.lang ? langName(f.lang) : "সব"}</span><select id="fLang"><option value="">সব ভাষা</option>${LANGS.map(([k, l]) => `<option value="${k}" ${k === f.lang ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <label>📍 <span id="flC">${f.country ? flagOf(f.country) + " " + (COUNTRY_NAMES[f.country] ?? f.country) : "সব"}</span><select id="fCountry" ${tab === "nearby" ? "disabled" : ""}><option value="">সব দেশ</option>${countries.map((c) => `<option value="${c}" ${c === f.country ? "selected" : ""}>${flagOf(c)} ${COUNTRY_NAMES[c]}</option>`).join("")}</select></label>
      </div>
    </div>
    ${notice() ? `<div style="padding:0 10px">${notice()}</div>` : ""}
    <div class="disc-grid"><div class="disc-col" id="c0"></div><div class="disc-col" id="c1"></div></div>
    <div id="dmore" style="padding:10px"></div></div>`;
  const save = () => { try { localStorage.setItem("disc", JSON.stringify(S.disc)); } catch { /* */ } };
  $("#fLang").onchange = (e) => { S.disc.lang = e.target.value; save(); R.home(tab); };
  $("#fCountry").onchange = (e) => { S.disc.country = e.target.value; save(); R.home(tab); };
  const st = { before: null, loading: false, done: false, count: 0 };
  const card = (v, i) => {
    const cc = v.country_code;
    return `<a class="dcard ${i % 4 === 1 || i % 4 === 2 ? "tall" : ""}" href="#play/${v.id}">
      <div class="ph ${v.locked ? "lock" : ""}">${v.thumb_url ? `<img src="${esc(v.thumb_url)}" loading="lazy" alt="">` : `<div class="noimg">▶</div>`}
        ${v.is_premium ? `<span class="prem">👑 ${n(v.premium_coins)}</span>` : ""}
        <div class="tags">${cc ? `<span>${flagOf(cc)} ${esc(cc)}</span>` : ""}<span>${esc(langName(v.language))}</span><span class="lv">✦Lv${v.level ?? 0}</span></div></div>
      ${v.caption ? `<div class="cap" translate="no">${esc(v.caption)}</div>` : ""}
      <div class="who">${avatar(v)}<span translate="no">${esc(v.full_name || v.username)}</span></div></a>`;
  };
  async function more() {
    if (st.loading || st.done) return;
    st.loading = true;
    $("#dmore").innerHTML = `<div class="spinner"></div>`;
    try {
      if (tab === "nearby" && !S.me.country_code) {
        st.done = true;
        $("#dmore").innerHTML = `<div class="empty">📍 লোকেশন চালু হলে আপনার দেশের ভিডিও এখানে দেখা যাবে</div>`;
        return;
      }
      const rows = await rpc("feed", { p_type: tab === "nearby" ? "nearby" : tab === "friends" ? "following" : "foryou", p_before: st.before, p_limit: 20,
        p_user: null, p_category: null, p_lang: S.disc.lang || null, p_country: tab === "nearby" ? null : S.disc.country || null });
      for (const v of rows) {
        const c0 = $("#c0"), c1 = $("#c1");
        if (!c0) return;
        (c0.offsetHeight <= c1.offsetHeight ? c0 : c1).insertAdjacentHTML("beforeend", card(v, st.count++));
      }
      if (rows.length) st.before = rows[rows.length - 1].id;
      if (rows.length < 20) st.done = true;
      $("#dmore").innerHTML = st.done && !st.count ? `<div class="empty">${tab === "friends" ? "আপনি যাদের ফলো করেন তাদের ভিডিও এখানে দেখা যাবে" : "এখনো কোনো ভিডিও নেই"}</div>` : "";
    } catch (e) { $("#dmore").innerHTML = `<div class="empty">${esc(errMsg(e))}</div>`; }
    finally { st.loading = false; }
  }
  const onScroll = () => { if (screen.scrollTop + screen.clientHeight > screen.scrollHeight - 600) more(); };
  screen.addEventListener("scroll", onScroll);
  cleanup = () => screen.removeEventListener("scroll", onScroll);
  more();
};

R.top = async () => {
  screen.innerHTML = `<div class="page">${header("🏆 টপ ক্রিয়েটর")}<div class="spinner"></div></div>`;
  const { data } = await sb.from("profiles").select("id,username,full_name,avatar_url,followers_count,videos_count,country_code").eq("status", "active").order("followers_count", { ascending: false }).limit(50);
  screen.innerHTML = `<div class="page">${header("🏆 টপ ক্রিয়েটর")}<div class="card">${(data ?? []).map((p, i) => `<a class="top-row" href="#u/${p.id}">
    <span class="rk">${i < 3 ? ["🥇", "🥈", "🥉"][i] : i + 1}</span>${avatar(p)}
    <span style="flex:1;min-width:0"><b translate="no">${esc(p.full_name || p.username)}</b><div class="tiny muted">${flagOf(p.country_code)} Lv${levelOf(p.followers_count)} · ${n(p.videos_count)} ভিডিও</div></span>
    <b>${n(p.followers_count)}<div class="tiny muted" style="font-weight:400">ফলোয়ার</div></b></a>`).join("") || `<div class="empty">কেউ নেই</div>`}</div></div>`;
};

R.level = async () => {
  const { data: p } = await sb.from("profiles").select("followers_count").eq("id", S.me.id).single();
  const f = p?.followers_count ?? 0, lv = levelOf(f), next = LEVELS[lv + 1];
  screen.innerHTML = `<div class="page">${header("👑 আমার লেভেল")}
    <div class="lvbig"><div>আপনার লেভেল</div><b>Lv${lv}</b><div>${n(f)} জন ফলোয়ার</div>
      ${next ? `<div class="progress"><div style="width:${Math.min(100, Math.round(((f - LEVELS[lv]) / (next - LEVELS[lv])) * 100))}%"></div></div><div class="tiny" style="margin-top:6px">Lv${lv + 1} হতে আরও ${n(next - f)} জন ফলোয়ার লাগবে</div>` : `<div class="tiny">সর্বোচ্চ লেভেল 🎉</div>`}</div>
    <div class="card"><b>লেভেল কীভাবে বাড়ে</b><div class="list tiny">${LEVELS.map((t, i) => `<div class="li"><span>${i === lv ? "👉 " : ""}Lv${i}</span><b>${n(t)}+ ফলোয়ার</b></div>`).join("")}</div>
    <p class="tiny muted">ভালো ভিডিও দিন, নিয়মিত পোস্ট করুন — ফলোয়ার বাড়লে লেভেল বাড়বে এবং আপনার ভিডিও বেশি মানুষ দেখবে।</p></div></div>`;
};

R.jail = async () => {
  const [{ data: p }, { data: w }] = await Promise.all([
    sb.from("profiles").select("jailed,jail_reason,jail_fee_coins,jailed_at").eq("id", S.me.id).single(),
    sb.from("wallets").select("coin_balance").eq("user_id", S.me.id).maybeSingle(),
  ]);
  if (!p?.jailed) { S.me.jailed = false; location.replace("#home"); return; }
  const fee = Number(p.jail_fee_coins ?? 0), bal = Number(w?.coin_balance ?? 0);
  screen.innerHTML = `<div class="page jail"><div class="ic">🚫</div><h2>আপনার অ্যাকাউন্ট জেলে আছে</h2>
    <div class="card" style="text-align:left"><div class="list">
      <div class="li"><span>কারণ</span><b translate="no">${esc(p.jail_reason || "নিয়ম ভঙ্গ")}</b></div>
      <div class="li"><span>তারিখ</span><span>${p.jailed_at ? dt(p.jailed_at) : "-"}</span></div>
      <div class="li"><span>মুক্তির জন্য লাগবে</span><b>🪙 ${n(fee)} কয়েন</b></div>
      <div class="li"><span>আপনার কয়েন</span><b>🪙 ${n(bal)}</b></div></div></div>
    <p class="muted tiny">জেলে থাকা অবস্থায় ভিডিও আপলোড, লাইক, কমেন্ট, গিফট ও আয় বন্ধ থাকবে।</p>
    ${bal >= fee ? `<button class="btn primary" id="pay">🔓 ${n(fee)} কয়েন দিয়ে মুক্ত হোন</button>` : `<a class="btn primary" href="#cashin">🪙 কয়েন কিনুন</a>`}
    <button class="btn" id="lo" style="width:100%;margin-top:10px">🚪 লগআউট</button></div>`;
  $("#pay")?.addEventListener("click", async (e) => {
    if (!confirm(`${fee} কয়েন দিয়ে জেল থেকে মুক্ত হবেন?`)) return;
    e.target.disabled = true;
    try { await rpc("pay_jail_release"); S.me.jailed = false; toast("🔓 আপনি এখন মুক্ত"); location.hash = "#home"; }
    catch (er) { toast(errMsg(er), true); e.target.disabled = false; }
  });
  $("#lo").onclick = async () => { await sb.auth.signOut(); S.me = null; location.hash = ""; showAuth(); };
};

R.me = async () => {
  screen.innerHTML = `<div class="page"><div class="spinner"></div></div>`;
  const [{ data: p }, { data: w }, refs] = await Promise.all([
    sb.from("profiles").select("*").eq("id", S.me.id).single(),
    sb.from("wallets").select("*").eq("user_id", S.me.id).single(),
    rpc("my_referrals").catch(() => null),
  ]);
  S.me = p;
  const cc = p.country_code;
  const host = p.account_type === "host";
  screen.innerHTML = `<div class="me">
    <div class="me-head">
      <div class="me-av">${avatar(p)}</div>
      <h2 translate="no">${esc(p.full_name || p.username)} ${p.is_verified ? "✔️" : ""}</h2>
      <div class="me-sub">@${esc(p.username)} · <span data-copy="${p.user_no}">ID ${p.user_no} ⧉</span>${host ? ` · 🎤 হোস্ট` : ""}</div>
      <div class="chips"><span>${flagOf(cc)} ${cc ? (COUNTRY_NAMES[cc] ?? cc) : "দেশ জানা নেই"}</span><span>🅰️ ${esc(langName(p.language))}</span></div>
      <div class="me-counts"><a href="#u/${p.id}"><b>${n(p.videos_count)}</b><span>ভিডিও</span></a><div><b>${n(p.following_count)}</b><span>ফলোয়িং</span></div><div><b>${n(p.followers_count)}</b><span>ফলোয়ার</span></div></div>
    </div>
    <div class="me-cards">
      <a href="#cashin" class="mc coins"><span>আমার কয়েন</span><b>${n(w?.coin_balance)}</b><i class="deco">💎</i></a>
      <a href="#wallet" class="mc money"><span>আমার ব্যালেন্স</span><b>${tk(w?.earning_paisa)}</b><i class="deco">💰</i></a>
    </div>
    <a href="#invite" class="me-banner"><span>রেফার করে আয় করুন</span><b>${tk(refs?.earned_paisa ?? 0)} ›</b></a>
    <div class="me-menu">
      <a href="#inbox"><i class="mi" style="background:#ffe1e4">💬</i>মেসেজ<em>${S.unread ? `<b class="red"></b>` : ""}›</em></a>
      <a href="#level"><i class="mi" style="background:#fff3d6">👑</i>আমার লেভেল<em>Lv${levelOf(p.followers_count)} ›</em></a>
      <a href="#invite"><i class="mi" style="background:#ece6ff">🎁</i>আমার রেফার<em>পুরস্কার নিন <b class="red"></b> ›</em></a>
      <a href="#rules"><i class="mi" style="background:#e4ecff">📋</i>আমার টাস্ক<em>›</em></a>
      <a href="#u/${p.id}"><i class="mi" style="background:#efe7ff">📁</i>আমার প্রোফাইল<em>›</em></a>
      <a href="#settings"><i class="mi" style="background:#e9e6ff">⚙️</i>সেটিংস<em>›</em></a>
    </div></div>`;
};

R.settings = async () => {
  const en = window.getLang?.() === "en";
  const { data: p } = await sb.from("profiles").select("*").eq("id", S.me.id).single();
  if (p) S.me = p;
  const me = S.me, host = me.account_type === "host", pending = !host && me.host_requested_at;
  screen.innerHTML = `<div class="page">${header("সেটিংস")}
    <div class="card"><b>অ্যাকাউন্টের ধরন</b>
      <div class="acct">
        <button data-t="user" class="${host ? "" : "on"}"><b>👤 ইউজার</b><small>প্রিমিয়াম ভিডিও কয়েন দিয়ে দেখবেন</small></button>
        <button data-t="host" class="${host ? "on" : ""}"><b>🎤 হোস্ট</b><small>${pending ? "⏳ আবেদন অপেক্ষায়" : "সব প্রিমিয়াম ফ্রি"}</small></button>
      </div>
      <p class="tiny muted" style="margin:8px 0 0">হোস্ট হতে আবেদন করলে অ্যাডমিন যাচাই করে অনুমোদন দেবেন। হোস্টরা সব প্রিমিয়াম ভিডিও ফ্রিতে দেখতে পারেন।</p></div>
    <div class="card list">
      <a class="li" href="#wallet"><span>💰 ওয়ালেট ও উইথড্র</span><span>›</span></a>
      <a class="li" href="#vault"><span>🔒 লক ফোল্ডার</span><span>›</span></a>
      <a class="li" href="#edit"><span>✏️ প্রোফাইল এডিট</span><span>›</span></a>
      <div class="li"><span>🌐 অ্যাপের ভাষা / Language</span><button class="btn small" id="lang" translate="no">${en ? "বাংলা" : "English"}</button></div>
      <div class="li"><span>🆔 আমার ID</span><b data-copy="${me.user_no}">${me.user_no} ⧉</b></div>
      <div class="li"><span>📱 অ্যাপ ভার্সন</span><span class="muted">${esc(Native?.appVersion?.() ?? "web")}</span></div>
    </div>
    <button class="btn" id="lo" style="width:100%;color:#e5484d">🚪 লগআউট</button></div>`;
  $("#lang").onclick = () => window.setLang?.(en ? "bn" : "en");
  $("#lo").onclick = async () => { if (!confirm("লগআউট করবেন?")) return; await sb.auth.signOut(); S.me = null; location.hash = ""; showAuth(); };
  document.querySelectorAll(".acct button").forEach((b) => (b.onclick = async () => {
    const t = b.dataset.t;
    if ((t === "host" && (host || pending)) || (t === "user" && !host && !pending)) return;
    if (t === "user" && !confirm(host ? "হোস্ট থেকে ইউজারে ফিরবেন? আবার হোস্ট হতে অনুমোদন লাগবে।" : "হোস্ট আবেদন বাতিল করবেন?")) return;
    try {
      const r = await rpc("set_account_type", { p_type: t });
      toast(r === "pending" ? "✅ হোস্ট আবেদন পাঠানো হয়েছে" : r === "host" ? "🎤 আপনি এখন হোস্ট" : "👤 ইউজার অ্যাকাউন্ট");
      R.settings();
    } catch (e) { toast(errMsg(e), true); }
  }));
};

R.invite = async () => {
  screen.innerHTML = `<div class="page">${header("🎁 আমার রেফার")}<div class="spinner"></div></div>`;
  const r = await rpc("my_referrals").catch((e) => ({ error: e }));
  if (r.error) { screen.innerHTML = `<div class="page">${header("🎁 আমার রেফার")}<div class="empty">${esc(errMsg(r.error))}</div></div>`; return; }
  const shareText = `Reels Enjoy অ্যাপে ভিডিও দেখে ও বানিয়ে আয় করুন! রেজিস্টার করার সময় আমার রেফার কোড দিন: ${r.code}`;
  screen.innerHTML = `<div class="page">${header("🎁 আমার রেফার")}
    <div class="card hero" style="text-align:center"><div class="k">আপনার রেফার কোড</div>
      <div class="v" data-copy="${r.code}" style="letter-spacing:2px">${r.code} ⧉</div>
      <button class="btn" id="shr" style="background:#fff;color:#4b1c7a;border:0">📤 বন্ধুদের পাঠান</button></div>
    <div class="stats" style="margin-bottom:12px"><div><b>${n(r.total)}</b><span>মোট রেফার</span></div><div><b>${n(r.qualified)}</b><span>সফল</span></div><div><b>${tk(r.earned_paisa)}</b><span>রেফার আয়</span></div></div>
    <div class="card"><b>কীভাবে কাজ করে</b><div class="list tiny">
      <div class="li"><span>১. বন্ধু রেজিস্টারের সময় আপনার কোড দেবে</span></div>
      <div class="li"><span>২. বন্ধু ${n(r.min_views)}টি ভিডিও দেখলে রেফার সফল</span></div>
      <div class="li"><span>৩. প্রতি সফল রেফারে আপনি পাবেন</span><b>${tk(setting("referral_bonus_paisa"))}</b></div>
      <div class="li"><span>বন্ধু পাবে স্বাগত পয়েন্ট</span><b>⭐ ${n(setting("referral_welcome_points"))}</b></div></div></div>
    ${r.tiers.length ? `<div class="card"><b>🏆 বাড়তি বোনাস</b><div class="list">${r.tiers.map((t) => `<div class="li"><span>${n(t.referrals)} জন সফল রেফার</span>
      <span>${t.awarded ? "✅ " : ""}<b>${tk(t.bonus_paisa)}</b></span></div>
      ${t.awarded ? "" : `<div class="progress" style="margin:0 0 6px"><div style="width:${Math.min(100, Math.round((r.qualified / t.referrals) * 100))}%"></div></div>`}`).join("")}</div></div>` : ""}
    <h3>আপনার রেফার করা বন্ধু</h3><div class="card list">${r.list.length ? r.list.map((x) => `<div class="li"><span>@${esc(x.username)}<div class="tiny muted">${dt(x.created_at)} · ${n(x.views)}/${n(r.min_views)} ভিডিও দেখেছে</div></span>
      <span class="pill ${x.qualified ? "paid" : "pending"}">${x.qualified ? "সফল" : "চলছে"}</span></div>`).join("") : `<div class="empty">এখনো কেউ নেই — কোড শেয়ার করুন</div>`}</div></div>`;
  $("#shr").onclick = async () => {
    try {
      if (Native?.share) Native.share(shareText);
      else if (navigator.share) await navigator.share({ text: shareText });
      else { await navigator.clipboard.writeText(shareText); toast("কপি হয়েছে"); }
    } catch { /* */ }
  };
};

R.rules = async () => {
  const { data: tiers } = await sb.from("referral_tiers").select("*").eq("is_active", true).order("referrals");
  const rew = S.ads.rewarded_points;
  screen.innerHTML = `<div class="page">${header("📋 আমার টাস্ক ও আয়ের নিয়ম")}
    ${S.ads.rewarded_points && Native?.showRewarded ? `<div class="card hero"><b>🎬 অ্যাড দেখে পয়েন্ট নিন</b><div class="tiny" style="margin:4px 0 10px">প্রতি অ্যাডে ⭐ ${n(S.ads.rewarded_points.viewer_points)} · দিনে ${n(S.ads.rewarded_points.daily_cap)} বার</div><a class="btn" href="#wallet" style="background:#fff;color:#5b2bd0;border:0">ওয়ালেটে গিয়ে অ্যাড দেখুন</a></div>` : ""}
    <div class="card"><b>✅ প্রতিদিনের টাস্ক</b><div class="list tiny">
      <div class="li"><span>ভিডিও দেখুন (প্রতিটি ${Math.round(setting("min_watch_ms", 5000) / 1000)} সেকেন্ড)</span><b>⭐ ${n(setting("watch_points"))} / ভিডিও</b></div>
      <div class="li"><span>ভিডিও আপলোড করুন</span><a href="#upload" class="btn small">আপলোড</a></div>
      <div class="li"><span>বন্ধুকে রেফার করুন</span><a href="#invite" class="btn small">রেফার</a></div></div></div>
    <div class="card"><b>🎬 ভিডিও বানিয়ে (ক্রিয়েটর)</b><div class="list tiny">
      <div class="li"><span>প্রতি ১০০০ ভিউ</span><b>${tk(setting("view_rate_paisa_per_1000"))}</b></div>
      <div class="li"><span>প্রতি লাইক</span><b>${tk(setting("like_rate_paisa"))}</b></div>
      <div class="li"><span>প্রতি কমেন্টকারী</span><b>${tk(setting("comment_rate_paisa"))}</b></div>
      <div class="li"><span>গিফট পেলে</span><b>গিফটের দামের বড় অংশ</b></div>
      ${rew ? `<div class="li"><span>আপনার ভিডিওতে কেউ অ্যাড দেখলে</span><b>⭐ ${n(rew.creator_points)}</b></div>` : ""}</div></div>
    <div class="card"><b>👀 ভিডিও দেখে (দর্শক)</b><div class="list tiny">
      <div class="li"><span>প্রতি ভিডিও</span><b>⭐ ${n(setting("watch_points"))}</b></div>
      <div class="li"><span>দিনে সর্বোচ্চ</span><b>⭐ ${n(setting("viewer_daily_points_cap"))}</b></div>
      ${rew ? `<div class="li"><span>অ্যাড দেখে (দিনে সর্বোচ্চ ${n(rew.daily_cap)} বার)</span><b>⭐ ${n(rew.viewer_points)}</b></div>` : ""}
      <div class="li"><span>${n(setting("points_convert_min"))} পয়েন্ট</span><b>${tk(setting("points_convert_min") * setting("point_value_paisa"))}</b></div></div></div>
    <div class="card"><b>🤝 রেফার</b><div class="list tiny">
      <div class="li"><span>প্রতি সফল রেফার</span><b>${tk(setting("referral_bonus_paisa"))}</b></div>
      ${(tiers ?? []).map((t) => `<div class="li"><span>${n(t.referrals)} জন সফল রেফার হলে বাড়তি</span><b>${tk(t.bonus_paisa)}</b></div>`).join("")}</div></div>
    <div class="card"><b>💸 উইথড্র</b><div class="list tiny">
      <div class="li"><span>সর্বনিম্ন উইথড্র</span><b>${tk(setting("withdraw_min_paisa"))}</b></div>
      <div class="li"><span>কত দিন পরপর</span><b>${n(setting("withdraw_cooldown_days"))} দিন</b></div>
      <div class="li"><span>আয় ব্যালেন্সে আসে</span><b>${n(setting("pending_hold_hours"))} ঘণ্টা পরে</b></div></div></div></div>`;
};
R.u = async (id) => {
  const mine = id === S.me.id;
  screen.innerHTML = `<div class="page"><div class="spinner"></div></div>`;
  const [{ data: p }, vids, fl] = await Promise.all([
    sb.from("profiles").select("*").eq("id", id).maybeSingle(),
    rpc("feed", { p_type: "foryou", p_before: null, p_limit: 30, p_user: id }).catch(() => []),
    mine ? Promise.resolve({ data: null }) : sb.from("follows").select("follower_id").eq("follower_id", S.me.id).eq("following_id", id).maybeSingle(),
  ]);
  if (!p) { screen.innerHTML = `<div class="page"><div class="empty">ইউজার পাওয়া যায়নি</div></div>`; return; }
  if (mine) S.me = p;
  let following = !!fl.data;
  const grid = (list) => list.map((v) => `<a href="#watch/${id}/${v.id}">${v.thumb_url ? `<img src="${esc(v.thumb_url)}" loading="lazy" alt="">` : ""}<span class="vc">▶ ${n(v.views_count)}</span></a>`).join("");
  screen.innerHTML = `<div class="page">
    <button class="back" onclick="history.back()">←</button>
    <div class="prof">${avatar(p)}<h2 translate="no">${esc(p.full_name ?? "")} ${p.is_verified ? "✔️" : ""}</h2><div class="muted">@${esc(p.username)}</div>
      <div class="idtag" data-copy="${p.user_no}">ID: ${p.user_no} ⧉</div>
      <div class="counts"><div><b>${n(p.videos_count)}</b><span>ভিডিও</span></div><div><b id="fc">${n(p.followers_count)}</b><span>ফলোয়ার</span></div><div><b>${n(p.following_count)}</b><span>ফলোয়িং</span></div></div>
      ${p.bio ? `<p translate="no">${esc(p.bio)}</p>` : ""}
      ${mine ? `<div class="row" style="justify-content:center;gap:8px;flex-wrap:wrap"><a class="btn small" href="#edit">✏️ প্রোফাইল এডিট</a><a class="btn small" href="#me">⬅ আমার পেজ</a></div>`
        : `<button class="btn" id="fb" style="min-width:140px;${following ? "" : "background:var(--accent);border:0"}">${following ? "ফলোয়িং" : "ফলো করুন"}</button>`}
    </div>
    <div id="pend"></div>
    <div class="grid3" id="g">${vids.length ? grid(vids) : ""}</div>
    ${vids.length ? "" : `<div class="empty">${mine ? "এখনো কোনো ভিডিও নেই — ＋ চেপে প্রথম ভিডিও দিন" : "কোনো ভিডিও নেই"}</div>`}
    ${vids.length === 30 ? `<button class="btn" id="mr" style="width:100%;margin-top:10px">আরও</button>` : ""}</div>`;
  if (mine) {
    const { data: pv } = await sb.from("videos").select("id,thumb_url,status,created_at,reject_reason").eq("user_id", id).in("status", ["pending", "rejected"]).order("id", { ascending: false }).limit(12);
    if (pv?.length) $("#pend").innerHTML = `<div class="card" style="margin-top:14px"><b>পর্যালোচনায় থাকা ভিডিও</b><div class="list">${pv.map((v) => `<div class="li"><span class="tiny">${dt(v.created_at)}${v.reject_reason ? ` · <span translate="no">${esc(v.reject_reason)}</span>` : ""}</span>
      <span class="pill ${v.status === "pending" ? "pending" : "rejected"}">${v.status === "pending" ? "⏳ পেন্ডিং" : "রিজেক্টেড"}</span></div>`).join("")}</div></div>`;
  }
  $("#lang")?.addEventListener("click", () => window.setLang?.(window.getLang?.() === "en" ? "bn" : "en"));
  $("#lo")?.addEventListener("click", async () => { if (!confirm("লগআউট করবেন?")) return; await sb.auth.signOut(); S.me = null; location.hash = ""; showAuth(); });
  $("#fb")?.addEventListener("click", async (e) => {
    try {
      following = await rpc("toggle_follow", { p_target: id });
      e.target.textContent = following ? "ফলোয়িং" : "ফলো করুন";
      e.target.style.background = following ? "" : "var(--accent)"; e.target.style.border = following ? "" : "0";
      p.followers_count += following ? 1 : -1; $("#fc").textContent = n(p.followers_count);
    } catch (er) { toast(errMsg(er), true); }
  });
  let last = vids[vids.length - 1]?.id;
  $("#mr")?.addEventListener("click", async (e) => {
    const more = await rpc("feed", { p_type: "foryou", p_before: last, p_limit: 30, p_user: id });
    $("#g").insertAdjacentHTML("beforeend", grid(more));
    last = more[more.length - 1]?.id ?? last;
    if (more.length < 30) e.target.remove();
  });
};

R.edit = () => {
  const p = S.me;
  screen.innerHTML = `<div class="page">${header("প্রোফাইল এডিট")}
    <div class="prof"><label style="cursor:pointer">${avatar(p)}<input type="file" id="af" accept="image/*" class="hidden"><div class="tiny muted">ছবি বদলাতে চাপুন</div></label></div>
    <span class="lbl">নাম</span><input id="fn" value="${esc(p.full_name ?? "")}" maxlength="60">
    <span class="lbl">ইউজারনেম</span><input id="un" value="${esc(p.username)}" autocapitalize="off" maxlength="30">
    <span class="lbl">বায়ো</span><textarea id="bio" maxlength="300">${esc(p.bio ?? "")}</textarea>
    <span class="lbl">জন্মতারিখ</span><input id="bd" type="date">
    <span class="lbl">আপনার ভাষা</span><select id="lg">${LANGS.map(([k, l]) => `<option value="${k}" ${k === p.language ? "selected" : ""}>${l}</option>`).join("")}</select>
    <button class="btn primary" id="sv">সেভ করুন</button></div>`;
  sb.from("user_private").select("birth_date").eq("user_id", S.me.id).maybeSingle().then(({ data }) => { if (data?.birth_date) $("#bd").value = data.birth_date; });
  let avatarBlob = null;
  $("#af").onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const img = new Image();
    img.src = URL.createObjectURL(f);
    await img.decode().catch(() => {});
    const s = Math.min(1, 400 / Math.max(img.width, img.height));
    const c = document.createElement("canvas"); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    avatarBlob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.85));
    document.querySelector(".prof .av").innerHTML = `<img src="${URL.createObjectURL(avatarBlob)}">`;
  };
  $("#sv").onclick = async (e) => {
    e.target.disabled = true;
    try {
      let url = null;
      if (avatarBlob) {
        const path = `${S.me.id}/${Date.now()}.jpg`;
        await xhrUpload("avatars", path, avatarBlob, "image/jpeg", () => {});
        url = sb.storage.from("avatars").getPublicUrl(path).data.publicUrl;
      }
      await rpc("update_profile", { p_full_name: $("#fn").value, p_username: $("#un").value.trim().toLowerCase(), p_bio: $("#bio").value, p_avatar_url: url });
      if ($("#bd").value) await rpc("set_birth_date", { p_date: $("#bd").value });
      if ($("#lg").value !== p.language) await rpc("set_language", { p_lang: $("#lg").value });
      toast("সেভ হয়েছে");
      location.hash = "#me";
    } catch (er) { toast(errMsg(er), true); e.target.disabled = false; }
  };
};


// ---------------- লক ফোল্ডার ----------------
R.vault = async () => {
  screen.innerHTML = `<div class="page">${header("🔒 লক ফোল্ডার")}<div class="spinner"></div></div>`;
  const [{ data: files }, used] = await Promise.all([
    sb.from("vault_files").select("*").eq("user_id", S.me.id).order("id", { ascending: false }).limit(200),
    rpc("vault_used", { p_user: S.me.id }).catch(() => 0),
  ]);
  const quota = Number(setting("vault_quota_mb", 100)) * 1048576;
  const pct = Math.min(100, Math.round((Number(used) / quota) * 100));
  const mb = (b) => (Number(b) / 1048576).toFixed(1) + " MB";
  const { data: urls } = files?.length ? await sb.storage.from("vault").createSignedUrls(files.map((f) => f.path), 3600) : { data: [] };
  const map = Object.fromEntries((urls ?? []).map((u) => [u.path, u.signedUrl]));
  screen.innerHTML = `<div class="page">${header("🔒 লক ফোল্ডার")}
    <div class="card"><div class="row"><b>${mb(used)} / ${mb(quota)}</b><span class="tiny muted">${pct}%</span></div>
      <div class="progress"><div style="width:${pct}%"></div></div>
      <p class="tiny muted" style="margin:8px 0 0">এখানের ছবি ও ভিডিও শুধু আপনি দেখতে পারবেন, অন্য ইউজাররা নয়। নিয়ম যাচাইয়ের জন্য অ্যাডমিন দেখতে পারেন।</p></div>
    <div class="menu">
      <label style="cursor:pointer"><input type="file" id="vimg" accept="image/*" class="hidden"><span class="ic">🖼️</span>ছবি রাখুন</label>
      <label style="cursor:pointer"><input type="file" id="vvid" accept="video/*" class="hidden"><span class="ic">🎞️</span>ভিডিও রাখুন</label>
    </div>
    <div class="progress hidden" id="vpg"><div></div></div><p id="vmsg" class="tiny muted"></p>
    <div class="grid3" id="vg">${files?.length ? files.map((f) => `<a data-id="${f.id}" data-path="${esc(f.path)}" data-kind="${f.kind}">
      ${f.kind === "video" ? `<video src="${esc(map[f.path] ?? "")}#t=0.5" preload="metadata" muted playsinline style="width:100%;height:100%;object-fit:cover"></video><span class="vc">▶</span>` : `<img src="${esc(map[f.path] ?? "")}" loading="lazy" alt="">`}</a>`).join("") : ""}</div>
    ${files?.length ? "" : `<div class="empty">লক ফোল্ডার খালি</div>`}</div>`;

  const upload = async (file) => {
    if (!file) return;
    if (Number(used) + file.size > quota) return toast(`জায়গা নেই — বাকি আছে ${mb(quota - used)}`, true);
    const pg = $("#vpg"); pg.classList.remove("hidden");
    const ext = ((file.name || "").split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
    const path = `${S.me.id}/${Date.now()}.${ext}`;
    try {
      await xhrUpload("vault", path, file, file.type || "application/octet-stream", (p) => {
        pg.firstElementChild.style.width = Math.round(p * 100) + "%"; $("#vmsg").textContent = `রাখা হচ্ছে… ${Math.round(p * 100)}%`;
      });
      try { await rpc("vault_add", { p_path: path, p_size: file.size, p_mime: file.type || "", p_name: file.name || "" }); }
      catch (er) { await sb.storage.from("vault").remove([path]); throw er; }
      toast("লক ফোল্ডারে রাখা হয়েছে 🔒");
      R.vault();
    } catch (er) { toast(errMsg(er), true); pg.classList.add("hidden"); $("#vmsg").textContent = ""; }
  };
  $("#vimg").onchange = (e) => upload(e.target.files[0]);
  $("#vvid").onchange = (e) => upload(e.target.files[0]);
  $("#vg").onclick = (e) => {
    const a = e.target.closest("a[data-id]"); if (!a) return;
    const url = map[a.dataset.path] ?? "";
    const body = sheet(`${a.dataset.kind === "video" ? `<video src="${esc(url)}" controls autoplay playsinline style="width:100%;max-height:65vh;background:#000;border-radius:12px"></video>`
      : `<img src="${esc(url)}" style="width:100%;max-height:65vh;object-fit:contain;border-radius:12px" alt="">`}
      <button class="btn" id="vdel" style="width:100%;margin-top:10px;color:#ff8a8a">🗑️ মুছে ফেলুন</button>`);
    $("#vdel", body).onclick = async () => {
      if (!confirm("ফাইলটি স্থায়ীভাবে মুছবেন?")) return;
      try {
        await sb.storage.from("vault").remove([a.dataset.path]);
        await rpc("vault_remove", { p_id: Number(a.dataset.id) });
        closeSheet(); toast("মুছে ফেলা হয়েছে"); R.vault();
      } catch (er) { toast(errMsg(er), true); }
    };
  };
};

// ---------------- boot ----------------
sb.auth.onAuthStateChange((ev) => { if (ev === "SIGNED_OUT") { S.me = null; showAuth(); } });
start();
