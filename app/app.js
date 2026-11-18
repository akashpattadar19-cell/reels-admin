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
const notifOn = () => { try { return localStorage.getItem("notif") !== "off"; } catch { return true; } };
const METHOD = { bkash: "bKash", nagad: "Nagad", rocket: "Rocket" };
const STATUS = { pending: "পেন্ডিং", approved: "অ্যাপ্রুভড", paid: "পেমেন্ট সম্পন্ন", rejected: "রিজেক্টেড" };
// ---------------- 🎵 ব্যাকগ্রাউন্ড গান ও 🎨 ফিল্টার ----------------
const FX_PRESETS = [["none", "আসল", ""], ["warm", "উষ্ণ", "sepia(.25) saturate(1.25) hue-rotate(-8deg)"], ["cool", "ঠান্ডা", "saturate(1.1) hue-rotate(14deg) brightness(1.03)"],
  ["vivid", "ঝলমলে", "saturate(1.6) contrast(1.1)"], ["bw", "সাদা-কালো", "grayscale(1) contrast(1.1)"], ["vintage", "ভিনটেজ", "sepia(.5) contrast(.9) brightness(1.05)"],
  ["fade", "ফেড", "contrast(.85) brightness(1.1) saturate(.8)"], ["drama", "ড্রামা", "contrast(1.35) saturate(1.2) brightness(.95)"], ["rose", "গোলাপি", "sepia(.2) saturate(1.3) hue-rotate(-20deg) brightness(1.05)"]];
const fxCss = (fx) => {
  if (!fx) return "";
  const pre = FX_PRESETS.find((x) => x[0] === fx.f)?.[2] ?? "";
  const adj = [["brightness", fx.b], ["contrast", fx.c], ["saturate", fx.s]].filter(([, v]) => v && Number(v) !== 100).map(([k, v]) => `${k}(${v}%)`).join(" ");
  return `${pre} ${adj}`.trim();
};
const fxEmpty = (fx) => !fx || ((!fx.f || fx.f === "none") && [fx.b, fx.c, fx.s].every((v) => !v || Number(v) === 100));
const BGM = new Audio();
BGM.preload = "auto";
BGM.addEventListener("ended", () => { try { BGM.currentTime = BGM._start || 0; } catch { /* */ } BGM.play().catch(() => {}); });
function bgmPlay(url, start = 0) {
  if (!url) return bgmStop();
  if (BGM._url !== url || BGM._start !== start) {
    BGM._url = url; BGM._start = start; BGM.src = url;
    BGM.addEventListener("loadedmetadata", () => { try { BGM.currentTime = start; } catch { /* */ } }, { once: true });
  }
  BGM.muted = !!S.muted;
  BGM.play().catch(() => {});
}
function bgmStop() { BGM.pause(); if (BGM._url) { BGM._url = null; BGM.removeAttribute("src"); BGM.load(); } }
const mmss = (sec) => `${Math.floor((sec || 0) / 60)}:${String(Math.floor((sec || 0) % 60)).padStart(2, "0")}`;

// গানের তালিকা থেকে বাছাই (Promise → {music} বা null বা "remove")
function pickMusic(cur) {
  return new Promise(async (resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; bgmStop(); closeSheet(); resolve(v); };
    const body = sheet(`<h3>🎵 গান বেছে নিন</h3><input id="mq" placeholder="গান বা শিল্পীর নাম খুঁজুন…"><div class="chiprow" id="mcat"></div>
      <div id="ml" class="mlist"><div class="spinner"></div></div>${cur ? `<button class="btn" id="mrm" style="margin-top:8px">🚫 গান বাদ দিন</button>` : ""}`);
    const { data } = await sb.from("music").select("id,title,artist,category,url,duration_sec,uses_count").eq("active", true).order("sort").order("uses_count", { ascending: false }).limit(300);
    const all = data ?? [];
    const cats = [...new Set(all.map((m) => m.category).filter(Boolean))];
    let cat = "", playing = null;
    $("#mcat", body).innerHTML = cats.length ? [["", "সব"], ...cats.map((c) => [c, c])].map(([k, l]) => `<a href="javascript:void 0" data-c="${esc(k)}" class="${k === cat ? "on" : ""}" translate="no">${esc(l)}</a>`).join("") : "";
    const draw = () => {
      const q = ($("#mq", body)?.value || "").trim().toLowerCase();
      const list = all.filter((m) => (!cat || m.category === cat) && (!q || `${m.title} ${m.artist ?? ""}`.toLowerCase().includes(q)));
      $("#ml", body).innerHTML = list.length ? list.map((m) => `<div class="mrow ${cur?.id === m.id ? "on" : ""}" data-id="${m.id}">
          <button class="mplay" data-p="${m.id}">${playing === m.id ? "⏸" : "▶"}</button>
          <span class="mt-t"><b translate="no">${esc(m.title)}</b><small translate="no">${esc(m.artist ?? "")}${m.duration_sec ? " · " + mmss(m.duration_sec) : ""}${m.uses_count ? ` · ${n(m.uses_count)} বার ব্যবহার` : ""}</small></span>
          <button class="btn small primary" data-s="${m.id}">বাছুন</button></div>`).join("")
        : `<div class="empty">${all.length ? "কিছু পাওয়া যায়নি" : "এখনো কোনো গান যোগ করা হয়নি"}</div>`;
    };
    draw();
    $("#mq", body).oninput = draw;
    $("#mcat", body).onclick = (e) => { const a = e.target.closest("[data-c]"); if (!a) return; cat = a.dataset.c; $("#mcat", body).querySelectorAll("a").forEach((x) => x.classList.toggle("on", x === a)); draw(); };
    $("#ml", body).onclick = (e) => {
      const pb = e.target.closest("[data-p]"), sb2 = e.target.closest("[data-s]");
      if (pb) { const m = all.find((x) => x.id === Number(pb.dataset.p)); if (playing === m.id) { playing = null; bgmStop(); } else { playing = m.id; S.muted = false; bgmPlay(m.url, 0); } draw(); }
      else if (sb2) finish({ music: all.find((x) => x.id === Number(sb2.dataset.s)) });
    };
    $("#mrm", body)?.addEventListener("click", () => finish("remove"));
    const obs = new MutationObserver(() => { if ($("#sheet").classList.contains("hidden")) { obs.disconnect(); finish(null); } });
    obs.observe($("#sheet"), { attributes: true, attributeFilter: ["class"] });
  });
}

// আপলোড পেজের গান + ফিল্টার + এডিট টুল। st = {music, start, mute, fx}
function mediaTools(box, preview, { kind = "video", st = {} } = {}) {
  Object.assign(st, { music: st.music ?? null, start: st.start ?? 0, mute: st.mute ?? false, fx: st.fx ?? { f: "none", b: 100, c: 100, s: 100 } });
  box.innerHTML = `<div class="mtools">
    <button type="button" class="mt-music" id="mtM"><span class="ic">🎵</span><span class="t">গান যোগ করুন</span><em>›</em></button>
    <div id="mtMO" class="mt-opt hidden">
      <label class="tiny muted">গান শুরু হবে: <b id="mtSt">0:00</b></label><input type="range" id="mtS" min="0" max="60" step="1" value="0">
      ${kind === "video" ? `<label class="agree"><input type="checkbox" id="mtMute"> <span>ভিডিওর আসল সাউন্ড বন্ধ রাখুন (শুধু গান শোনা যাবে)</span></label>` : ""}
    </div>
    <span class="lbl">🎨 ফিল্টার</span>
    <div class="fxrow" id="mtF">${FX_PRESETS.map(([k, l, c]) => `<button type="button" data-f="${k}" class="${st.fx.f === k ? "on" : ""}"><i style="filter:${c}"></i><span>${l}</span></button>`).join("")}</div>
    <details class="fx-adj"><summary>✏️ এডিট — উজ্জ্বলতা, কনট্রাস্ট, রং</summary>
      ${[["b", "☀️ উজ্জ্বলতা"], ["c", "◐ কনট্রাস্ট"], ["s", "🌈 রং"]].map(([k, l]) => `<label class="tiny">${l} <b id="mtv${k}">${st.fx[k]}%</b></label><input type="range" min="50" max="150" value="${st.fx[k]}" data-k="${k}">`).join("")}
      <button type="button" class="btn small" id="mtR">↺ রিসেট</button></details></div>`;
  const apply = () => { preview.style.filter = fxCss(st.fx); };
  const syncMusic = () => {
    $("#mtM", box).querySelector(".t").innerHTML = st.music ? `<b translate="no">${esc(st.music.title)}</b><small translate="no">${esc(st.music.artist ?? "")}</small>` : "গান যোগ করুন";
    $("#mtM", box).classList.toggle("on", !!st.music);
    $("#mtMO", box).classList.toggle("hidden", !st.music);
    if (st.music) { const r = $("#mtS", box); r.max = Math.max(0, (st.music.duration_sec || 60) - 5); r.value = st.start; $("#mtSt", box).textContent = mmss(st.start); }
  };
  const preview2 = () => { if (!st.music) return bgmStop(); S.muted = false; bgmPlay(st.music.url, st.start); if (preview.tagName === "VIDEO") { preview.muted = st.mute; if (preview.paused) preview.play().catch(() => {}); } };
  $("#mtM", box).onclick = async () => {
    const r = await pickMusic(st.music);
    if (r === "remove") { st.music = null; st.start = 0; bgmStop(); }
    else if (r?.music) { st.music = r.music; st.start = 0; preview2(); }
    syncMusic();
  };
  $("#mtS", box).oninput = (e) => { st.start = Number(e.target.value); $("#mtSt", box).textContent = mmss(st.start); };
  $("#mtS", box).onchange = preview2;
  $("#mtMute", box)?.addEventListener("change", (e) => { st.mute = e.target.checked; if (preview.tagName === "VIDEO") preview.muted = st.mute; });
  $("#mtF", box).onclick = (e) => { const b = e.target.closest("[data-f]"); if (!b) return; st.fx.f = b.dataset.f; $("#mtF", box).querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); apply(); };
  box.querySelectorAll(".fx-adj input[type=range]").forEach((r) => (r.oninput = () => { st.fx[r.dataset.k] = Number(r.value); $("#mtv" + r.dataset.k, box).textContent = r.value + "%"; apply(); }));
  $("#mtR", box).onclick = () => { Object.assign(st.fx, { b: 100, c: 100, s: 100 }); box.querySelectorAll(".fx-adj input[type=range]").forEach((r) => { r.value = 100; $("#mtv" + r.dataset.k, box).textContent = "100%"; }); apply(); };
  if (preview.tagName === "VIDEO") {
    preview.addEventListener("play", () => { if (st.music) bgmPlay(st.music.url, st.start); });
    preview.addEventListener("pause", () => BGM.pause());
  }
  syncMusic(); apply();
  return st;
}

// #হ্যাশট্যাগ ও @মেনশন লিংক (esc করার পরে)
const TAG_RE = /(^|[^&\w\u0980-\u09FF])#([A-Za-z0-9_\u0980-\u09FF\u0900-\u097F\u0600-\u06FF]{1,60})/g;
const AT_RE = /(^|[^A-Za-z0-9_.&])@([A-Za-z0-9_.]{1,29}[A-Za-z0-9_])/g;
const rich = (t) => esc(t ?? "")
  .replace(TAG_RE, (m, pre, tag) => `${pre}<a class="tag" href="#tag/${encodeURIComponent(tag.toLowerCase())}" onclick="event.stopPropagation()">#${tag}</a>`)
  .replace(AT_RE, (m, pre, u) => `${pre}<a class="mention" href="#at/${u.toLowerCase()}" onclick="event.stopPropagation()">@${u}</a>`);
const richPlain = (t) => esc(t ?? "").replace(TAG_RE, '$1<span class="tag">#$2</span>').replace(AT_RE, '$1<span class="mention">@$2</span>');

// টাইপ করার সময় @ইউজার / #ট্যাগ সাজেশন
function attachSuggest(el) {
  if (!el || el._sugg) return;
  el._sugg = true;
  const form = el.closest("form.cmt-box");
  const box = document.createElement("div");
  box.className = "sugg hidden";
  (form ?? el).insertAdjacentElement(form ? "beforebegin" : "afterend", box);
  let tm, seq = 0;
  const token = () => {
    const pos = el.selectionStart ?? el.value.length, before = el.value.slice(0, pos);
    const m = before.match(/(^|\s)([@#])([^\s@#]{0,30})$/);
    return m ? { kind: m[2], q: m[3], start: pos - m[3].length - 1, end: pos } : null;
  };
  const close = () => { box.classList.add("hidden"); box.innerHTML = ""; };
  el.addEventListener("input", () => {
    clearTimeout(tm);
    const tk0 = token(); if (!tk0) return close();
    tm = setTimeout(async () => {
      const my = ++seq, tkn = token(); if (!tkn) return close();
      let items = [];
      if (tkn.kind === "@") {
        const q = tkn.q.toLowerCase().replace(/[^a-z0-9_.]/g, "");
        const { data } = await sb.from("profiles").select("id,username,full_name,avatar_url").ilike("username", `${q}%`).eq("status", "active").neq("id", S.me.id).limit(6);
        items = (data ?? []).map((u) => ({ ins: "@" + u.username, html: `${avatar(u)}<span><b translate="no">${esc(u.full_name || u.username)}</b><small>@${esc(u.username)}</small></span>` }));
      } else {
        if (!tkn.q) { const tr = await rpc("trending_tags", { p_days: 7, p_limit: 6 }).catch(() => []); items = tr.map((t) => ({ ins: "#" + t.tag, html: `<span class="hash">#</span><span><b translate="no">${esc(t.tag)}</b><small>🔥 ট্রেন্ডিং · ${n(t.posts)} পোস্ট</small></span>` })); }
        else { const tr = await rpc("search_tags", { p_q: tkn.q, p_limit: 6 }).catch(() => []); items = tr.map((t) => ({ ins: "#" + t.tag, html: `<span class="hash">#</span><span><b translate="no">${esc(t.tag)}</b><small>${n(t.use_count)} বার ব্যবহার</small></span>` })); }
      }
      if (my !== seq) return;
      if (!items.length) return close();
      box.innerHTML = items.map((it, i) => `<button type="button" data-i="${i}">${it.html}</button>`).join("");
      box.classList.remove("hidden");
      box.querySelectorAll("button").forEach((b) => b.addEventListener("mousedown", (e) => e.preventDefault()));
      box.querySelectorAll("button").forEach((b) => (b.onclick = () => {
        const t = token(); if (!t) return close();
        const ins = items[Number(b.dataset.i)].ins + " ";
        el.value = el.value.slice(0, t.start) + ins + el.value.slice(t.end);
        const c = t.start + ins.length; el.setSelectionRange(c, c); el.focus(); close();
        el.dispatchEvent(new Event("input"));
      }));
    }, 220);
  });
  el.addEventListener("blur", () => setTimeout(close, 200));
}

const avatar = (p, cls = "av") => `<div class="${cls}">${p?.avatar_url ? `<img src="${esc(p.avatar_url)}" alt="">` : esc((p?.full_name || p?.username || "?").trim().charAt(0).toUpperCase())}</div>`;

const ERR = {
  "Invalid login credentials": "মোবাইল নম্বর বা পাসওয়ার্ড ভুল",
  INSUFFICIENT_COINS: "কয়েন যথেষ্ট নেই — আগে কয়েন কিনুন",
  NOT_SELLER: "আপনি কয়েন সেলার নন",
  SELLER_OFF: "কয়েন বিক্রি এখন বন্ধ আছে",
  SELF_SALE: "নিজের কাছে বিক্রি করা যায় না",
  USER_NOT_FOUND: "এই ID-তে কোনো ইউজার নেই",
  USER_BANNED: "এই ইউজার ব্যান করা",
  BAD_AMOUNT: "সঠিক পরিমাণ দিন",
  TOO_MANY: "সর্বোচ্চ ৫টি নম্বর সেভ করা যায়",
  STORIES_OFF: "স্টোরি এখন বন্ধ আছে",
  DOWNLOADS_OFF: "ডাউনলোড এখন বন্ধ আছে",
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
  OFFER_ENDED: "এই অফার শেষ হয়ে গেছে",
  OFFER_PRICE_MISMATCH: "অফারের দাম যতো, ঠিক ততো টাকাই পাঠাতে হবে",
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
  SUPPORT_OFF: "সাপোর্ট এখন বন্ধ আছে",
  RATE_LIMIT: "একটু ধীরে — কিছুক্ষণ পর আবার চেষ্টা করুন",
  ADMIN_ACCOUNT: "অ্যাডমিন অ্যাকাউন্ট এখান থেকে ডিলিট করা যায় না",
  UPLOAD_LIMIT: "আজকের আপলোড সীমা শেষ — কাল আবার দিন",
  TOO_MANY_LINES: "লাইন বেশি হয়ে গেছে",
  TEXT_TOO_LONG: "লেখা অনেক লম্বা",
  EMPTY_TEXT: "কিছু লিখুন",
  CONTEST_CLOSED: "কম্পিটিশন বন্ধ হয়ে গেছে",
  ALREADY_JOINED: "আপনি আগেই এই কম্পিটিশনে অংশ নিয়েছেন",
  HOST_ONLY: "প্রিমিয়াম ভিডিও শুধু হোস্টরা দিতে পারবে",
  DM_OFF: "মেসেজ এখন বন্ধ আছে",
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
  restoreRegDraft();
  $("#authErr").textContent = msg;
}
$("#authLang").onclick = (e) => { e.preventDefault(); window.setLang?.(window.getLang?.() === "en" ? "bn" : "en"); };
$("#toReg").onclick = (e) => { e.preventDefault(); $("#loginForm").classList.add("hidden"); $("#regForm").classList.remove("hidden"); $("#authErr").textContent = ""; };
// সাইন-আপ: ভাষা বাছাই করলে সাথে সাথে পুরো স্ক্রিন সেই ভাষায় (ফর্মের লেখা থেকে যায়)
const REG_FIELDS = ["rgName", "rgUser", "rgPhone", "rgEmail", "rgRef"];
document.querySelectorAll("input[name=rgL]").forEach((r) => {
  r.checked = r.value === (window.getLang?.() === "en" ? "en" : "bn");
  r.onchange = () => {
    if (r.value === (window.getLang?.() === "en" ? "en" : "bn")) return;
    try {
      const d = Object.fromEntries(REG_FIELDS.map((k) => [k, $("#" + k).value]));
      d.rgCC = $("#rgCC").value; d.g = $("input[name=rgG]:checked")?.value ?? "";
      sessionStorage.setItem("regDraft", JSON.stringify(d));
    } catch { /* */ }
    window.setLang?.(r.value);
  };
});
function restoreRegDraft() {
  let d; try { d = JSON.parse(sessionStorage.getItem("regDraft") || "null"); sessionStorage.removeItem("regDraft"); } catch { d = null; }
  if (!d) return;
  $("#loginForm").classList.add("hidden"); $("#regForm").classList.remove("hidden");
  REG_FIELDS.forEach((k) => { if (d[k]) $("#" + k).value = d[k]; });
  if (d.rgCC) setTimeout(() => ($("#rgCC").value = d.rgCC), 0);
  if (d.g) { const g = document.querySelector(`input[name=rgG][value=${d.g}]`); if (g) g.checked = true; }
}
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
    const g = $("input[name=rgG]:checked")?.value, lg = $("input[name=rgL]:checked")?.value ?? "bn";
    await Promise.all([g && rpc("set_gender", { p_gender: g }).catch(() => {}),
      rpc("set_language", { p_lang: lg === "en" ? "English" : "Bengali" }).catch(() => {})]);
    try { localStorage.setItem("lang", lg); } catch { /* */ }
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
  rpc("mark_delivered").catch(() => {});
  try {
    const di = JSON.parse(Native?.deviceInfo?.() || "{}");
    if (di.id) rpc("register_device", { p_device_id: di.id, p_brand: di.brand, p_model: di.model, p_os: di.os, p_app: di.app })
      .then((r) => { if (r?.welcome_paisa > 0) showWelcome(r.welcome_paisa); }).catch(() => {});
  } catch { /* old APK */ }
  if (!checkUpdate()) { requireLocation(); setTimeout(offerPopup, 2500); }
}

function showWelcome(paisa) {
  const d = document.createElement("div");
  d.className = "upd-gate soft";
  d.innerHTML = `<div class="upd-card"><div class="upd-ic">🎁</div><h2>স্বাগতম Reels Enjoy-তে!</h2>
    <p>আপনি পেয়েছেন <b style="color:#6d3df0;font-size:22px">${tk(paisa)}</b> বোনাস</p>
    <p class="tiny muted">টাকাটি আপনার ব্যালেন্সে যোগ হয়েছে। ভিডিও দেখে, বানিয়ে ও বন্ধুদের রেফার করে আরও আয় করুন।</p>
    <button class="btn primary">দারুণ! শুরু করি 🚀</button></div>`;
  d.querySelector("button").onclick = () => d.remove();
  document.body.appendChild(d);
}

// কিবোর্ড খুললে যে ঘরে লিখছেন সেটি দেখা যাবে
window.onKeyboard = (open) => {
  if (!open) return;
  setTimeout(() => {
    const el = document.activeElement;
    if (el && /INPUT|TEXTAREA/.test(el.tagName)) el.scrollIntoView({ block: "nearest" });
  }, 120);
};
document.addEventListener("focusin", (e) => {
  if (/INPUT|TEXTAREA/.test(e.target.tagName)) setTimeout(() => e.target.scrollIntoView({ block: "nearest" }), 350);
});

// ---------------- অ্যাপ আপডেট (পুরনো APK হলে অ্যাপ খুলবে না) ----------------
function appBuild() {
  const v = String(Native?.appVersion?.() ?? "");
  const m = v.match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? Number(m[3]) : 0;
}
function checkUpdate() {
  if (!Native?.appVersion) return false;               // ব্রাউজারে চেক নেই
  // Play Store থেকে ইনস্টল করা অ্যাপের জন্য আলাদা নম্বর (Play-এ রিভিউ শেষ হওয়ার পরেই এডমিন বাড়াবেন)
  const play = (() => { try { return Native.store?.() === "play"; } catch { return false; } })();
  const b = appBuild(), min = Number(setting(play ? "play_min_build" : "min_app_build", 0)), latest = Number(setting(play ? "play_latest_build" : "latest_app_build", 0));
  const url = play ? "play" : String(setting("apk_url", "") || "");
  if (!url || !latest || b >= latest) return false;
  const forced = b < min;
  if (!forced && sessionStorage.getItem("updSkip") === String(latest)) return false;
  let g = $("#updGate");
  if (!g) { g = document.createElement("div"); g.id = "updGate"; document.body.appendChild(g); }
  g.className = "upd-gate" + (forced ? "" : " soft");
  g.innerHTML = `<div class="upd-card">
      <div class="upd-ic">🚀</div>
      <h2>নতুন আপডেট এসেছে</h2>
      <p class="muted" translate="no">${esc(setting("update_message", ""))}</p>
      <div class="tiny muted">আপনার ভার্সন 1.0.${b} → নতুন ভার্সন 1.0.${latest}</div>
      <div class="progress hidden" id="updPg"><div></div></div>
      <div class="tiny" id="updMsg"></div>
      <button class="btn primary" id="updGo">⬇️ এখনই আপডেট করুন</button>
      ${forced ? `<p class="tiny muted" style="margin-top:10px">আপডেট না করলে অ্যাপ ব্যবহার করা যাবে না।</p>` : `<button class="btn" id="updLater" style="width:100%;margin-top:8px">পরে করব</button>`}
    </div>`;
  window.onUpdateState = (st) => {
    const pg = $("#updPg"), msg = $("#updMsg");
    if (st.state === "downloading") { pg.classList.remove("hidden"); pg.firstElementChild.style.width = st.p + "%"; msg.textContent = `ডাউনলোড হচ্ছে… ${st.p}%`; $("#updGo").disabled = true; }
    else if (st.state === "permission") { msg.textContent = "\"এই উৎস থেকে অনুমতি দিন\" চালু করে ফিরে আসুন — ইনস্টল নিজে থেকে শুরু হবে"; $("#updGo").disabled = false; $("#updGo").textContent = "📲 ইনস্টল করুন"; }
    else if (st.state === "installing") { msg.textContent = "ইনস্টল স্ক্রিনে \"Update/ইনস্টল\" চাপুন"; $("#updGo").disabled = false; $("#updGo").textContent = "📲 আবার ইনস্টল স্ক্রিন খুলুন"; }
    else if (st.state === "error") { msg.textContent = "ডাউনলোড হয়নি — ইন্টারনেট দেখে আবার চাপুন"; $("#updGo").disabled = false; }
  };
  $("#updGo").onclick = () => {
    if (Native?.installUpdate) Native.installUpdate(url);
    else location.href = url;                              // পুরনো APK: ব্রাউজারে ডাউনলোড
  };
  $("#updLater")?.addEventListener("click", () => { sessionStorage.setItem("updSkip", String(latest)); g.remove(); requireLocation(); });
  return forced;
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
      S.unread++; paintUnread();
      if (["gift", "withdraw", "cash_in"].includes(p.new.type)) toast(p.new.title);
      if (document.hidden && notifOn()) { try { Native?.notify?.(p.new.title, p.new.body || ""); } catch { /* */ } }
    })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `receiver_id=eq.${S.me.id}` }, (p) => {
      if (S.chatWith === p.new.sender_id) { document.dispatchEvent(new CustomEvent("chatmsg", { detail: p.new })); return; }
      rpc("mark_delivered").catch(() => {});
      S.msgUnread = (S.msgUnread || 0) + 1; paintUnread();
      if (document.hidden && notifOn()) { try { Native?.notify?.("💬 নতুন মেসেজ", p.new.body); } catch { /* */ } }
      else toast("💬 নতুন মেসেজ");
    })
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter: `sender_id=eq.${S.me.id}` }, (p) => {
      document.dispatchEvent(new CustomEvent("msgupd", { detail: p.new }));
    })
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter: `receiver_id=eq.${S.me.id}` }, (p) => {
      document.dispatchEvent(new CustomEvent("msgupd", { detail: p.new }));
    })
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "wallets", filter: `user_id=eq.${S.me.id}` }, (p) => {
      document.dispatchEvent(new CustomEvent("wallet", { detail: p.new }));
    })
    .subscribe();
}
async function refreshUnread() {
  const [{ count }, m] = await Promise.all([
    sb.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", S.me.id).eq("is_read", false),
    rpc("msg_unread").catch(() => 0),
  ]);
  S.unread = count ?? 0; S.msgUnread = Number(m) || 0;
  paintUnread();
}
function paintUnread() {
  const t = (S.unread || 0) + (S.msgUnread || 0);
  $("#unread").textContent = t ? (t > 99 ? "99+" : t) : "";
}
// অ্যাপে কত সময় কাটছে (অ্যাডমিন অ্যানালিটিক্সের জন্য)
setInterval(() => { if (S.me && !document.hidden) rpc("track_time", { p_sec: 60 }).catch(() => {}); }, 60000);

// ---------------- router ----------------
const R = {};
let cleanup = null;
function route() {
  if (!S.me) return;
  if (cleanup) { try { cleanup(); } catch { /* */ } cleanup = null; }
  closeSheet();
  bgmStop();
  let [name, a, b, c] = (location.hash.slice(1) || "home").split("/");
  if (!R[name]) name = "home";
  if (S.me.jailed && !["jail", "cashin", "history"].includes(name)) name = "jail";
  const TABS = { home: ["home", "post", "contest", "newphoto", "top", "tag", "tags", "at", "story", "newstory"], feed: ["feed", "following", "watch", "play"],
    me: ["me", "seller", "creator", "support", "policy", "delacct", "invite", "rules", "settings", "vault", "edit", "level", "wallet", "history", "withdraw", "cashin", "inbox", "chat"] };
  document.querySelectorAll(".tabbar a").forEach((x) => x.classList.toggle("on", x.dataset.t === name || (TABS[x.dataset.t] ?? []).includes(name)));
  screen.classList.remove("full");
  $(".tabbar").classList.toggle("dark", TABS.feed.includes(name));
  try { Native?.setDarkBars?.(TABS.feed.includes(name)); } catch { /* old APK */ }
  screen.scrollTop = 0;
  R[name](a, b, c);
}
window.addEventListener("hashchange", route);
const back = () => (history.length > 1 ? history.back() : (location.hash = "#home"));
const header = (title, showBack = true) => `<h1>${showBack ? `<button class="back" onclick="history.back()">←</button>` : ""}${title}</h1>`;
const notice = () => (setting("app_notice", "") ? `<div class="notice" translate="no">📢 ${esc(setting("app_notice", ""))}</div>` : "");

// ---------------- FEED ----------------
const CATS = [["", "সব"], ["premium", "👑 প্রিমিয়াম"], ["natok", "🎭 নাটক"], ["movie", "🎬 মুভি"], ["funny", "😂 ফানি"], ["vlog", "📹 ব্লগ"], ["music", "🎵 গান"], ["other", "📦 অন্যান্য"]];
R.feed = (cat) => openFeed({ type: "foryou", category: cat || "" });
R.following = () => openFeed({ type: "following" });
// #ট্যাগ পেজ
R.tag = async (raw = "", tab = "v", sort = "top") => {
  const tag = decodeURIComponent(raw).replace(/^#/, "").toLowerCase();
  if (!tag) return R.tags();
  const enc = encodeURIComponent(tag);
  screen.innerHTML = `<div class="page">${header("#" + tag)}<div class="spinner"></div></div>`;
  const info = await rpc("tag_info", { p_tag: tag }).catch(() => null);
  screen.innerHTML = `<div class="page tagpage">${header("")}
    <div class="tag-hero"><div class="tag-ic">#</div><div><h2 translate="no">#${esc(tag)}</h2>
      <div class="tiny">${info ? `${n(info.videos)} ভিডিও · ${n(info.posts)} ফটো/লেখা · 👁 ${n(info.views)} · ${n(info.users)} জন ব্যবহার করেছে` : "এখনো কেউ এই ট্যাগ ব্যবহার করেনি"}</div></div></div>
    <a class="btn primary" href="#upload" style="margin:10px 0" onclick="S.tagDraft='#${esc(tag)} '">＋ এই ট্যাগে ভিডিও দিন</a>
    <div class="seg"><button class="${tab === "v" ? "on" : ""}" data-t="v">🎬 ভিডিও</button><button class="${tab === "p" ? "on" : ""}" data-t="p">🖼️ ফটো ও লেখা</button></div>
    ${tab === "v" ? `<div class="chipsel"><button class="${sort === "top" ? "on" : ""}" data-s="top">🔥 জনপ্রিয়</button><button class="${sort === "new" ? "on" : ""}" data-s="new">🆕 নতুন</button></div>` : ""}
    <div id="tg"><div class="spinner"></div></div></div>`;
  document.querySelectorAll(".tagpage [data-t]").forEach((b) => (b.onclick = () => location.replace(`#tag/${enc}/${b.dataset.t}/${sort}`)));
  document.querySelectorAll(".tagpage [data-s]").forEach((b) => (b.onclick = () => location.replace(`#tag/${enc}/${tab}/${b.dataset.s}`)));
  if (tab === "v") {
    const rows = await rpc("tag_videos", { p_tag: tag, p_limit: 90, p_sort: sort }).catch(() => []);
    $("#tg").innerHTML = rows.length ? `<div class="grid3">${rows.map((v) => `<a href="#v/${v.id}">${v.thumb_url ? `<img src="${esc(v.thumb_url)}" loading="lazy" alt="">` : ""}<span class="vc">▶ ${n(v.views_count)}</span>${v.is_premium ? '<span class="prem">👑</span>' : ""}</a>`).join("")}</div>`
      : `<div class="empty">এই ট্যাগে এখনো কোনো ভিডিও নেই</div>`;
  } else {
    const rows = await rpc("tag_posts", { p_tag: tag, p_limit: 90 }).catch(() => []);
    $("#tg").innerHTML = rows.length ? `<div class="grid3">${rows.map((v) => v.kind === "photo"
      ? `<a href="#post/${v.id}"><img src="${esc(v.image_url)}" loading="lazy" alt=""><span class="vc">❤️ ${n(v.likes_count)}</span></a>`
      : `<a href="#post/${v.id}" class="tmini3" style="background:${BGS[v.bg] ?? BGS.g1}" translate="no">${esc(v.body).slice(0, 80)}</a>`).join("")}</div>` : `<div class="empty">এই ট্যাগে এখনো কোনো ফটো বা লেখা নেই</div>`;
  }
};
// ট্রেন্ডিং ট্যাগ তালিকা
R.tags = async (days = "7") => {
  days = ["1", "7", "30"].includes(days) ? days : "7";
  screen.innerHTML = `<div class="page">${header("🔥 ট্রেন্ডিং #ট্যাগ")}
    <div class="seg" style="margin-top:0">${[["1", "আজ"], ["7", "৭ দিন"], ["30", "৩০ দিন"]].map(([k, l]) => `<button class="${k === days ? "on" : ""}" onclick="location.replace('#tags/${k}')">${l}</button>`).join("")}</div>
    <div class="search-tag"><input id="tq" placeholder="ট্যাগ খুঁজুন… (যেমন funny)"><div id="tqr"></div></div>
    <div id="tl"><div class="spinner"></div></div></div>`;
  const rows = await rpc("trending_tags", { p_days: Number(days), p_limit: 50 }).catch(() => []);
  const max = Math.max(1, ...rows.map((r) => Number(r.score)));
  $("#tl").innerHTML = rows.length ? `<div class="card list">${rows.map((r, i) => `<a class="li trow" href="#tag/${encodeURIComponent(r.tag)}">
      <span class="trank ${i < 3 ? "top" : ""}">${i + 1}</span><span style="flex:1;min-width:0"><b translate="no">#${esc(r.tag)}</b>${i < 3 ? " 🔥" : ""}
      <div class="tiny muted">${n(r.posts)} পোস্ট · ${n(r.users)} জন · 👁 ${n(r.views)} · ❤️ ${n(r.likes)}</div><div class="tbar"><i style="width:${Math.max(4, Math.round((r.score / max) * 100))}%"></i></div></span><em>›</em></a>`).join("")}</div>`
    : `<div class="empty">এই সময়ে কোনো ট্যাগ ব্যবহার হয়নি।<br>ভিডিও বা ছবির ক্যাপশনে #ট্যাগ লিখুন, যেমন #funny</div>`;
  let tm;
  $("#tq").oninput = (e) => { clearTimeout(tm); tm = setTimeout(async () => {
    const q = e.target.value.trim().replace(/^#/, ""); if (!q) { $("#tqr").innerHTML = ""; return; }
    const r = await rpc("search_tags", { p_q: q, p_limit: 8 }).catch(() => []);
    $("#tqr").innerHTML = r.length ? r.map((t) => `<a href="#tag/${encodeURIComponent(t.tag)}">#${esc(t.tag)} <small>${n(t.use_count)}</small></a>`).join("") : `<span class="tiny muted">কিছু পাওয়া যায়নি</span>`;
  }, 250); };
};
// @username → প্রোফাইল
R.at = async (u = "") => {
  const { data } = await sb.from("profiles").select("id").eq("username", decodeURIComponent(u).toLowerCase()).maybeSingle();
  if (data) location.replace(`#u/${data.id}`); else { toast("এই ইউজার পাওয়া যায়নি", true); history.back(); }
};

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
      const newEls = [];
      for (const v of rows) {
        const el = slideEl(v, st.slides.length);
        st.slides.push(el); newEls.push(el);
        feedEl.appendChild(el);
        obs.observe(el);
      }
      if (rows.length) sb.from("videos").select("id,music_id,music_start,fx,orig_muted,music:music_id(url,title,artist)").in("id", rows.map((r) => r.id)).then(({ data }) => {
        for (const x of data ?? []) {
          const el = newEls.find((e) => e._v.id === x.id); if (!el) continue;
          el._x = x;
          const vd = el.querySelector("video");
          if (x.fx) vd.style.filter = fxCss(x.fx);
          if (x.music?.url) {
            el.querySelector(".info .tiny")?.insertAdjacentHTML("beforebegin", `<div class="mtag"><span class="disc">🎵</span><span class="mq" translate="no">${esc(x.music.title)}${x.music.artist ? " · " + esc(x.music.artist) : ""}</span></div>`);
            if (st.active === el) slideMusic(el);
          }
          if (x.orig_muted) vd.muted = true;
        }
      });
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
        <button class="act like ${v.liked_by_me ? "liked" : ""}"><span class="ic svg"><svg viewBox="0 0 24 24"><path d="M12 20.5s-7.5-4.6-9.2-9.3C1.6 7.8 3.8 4.5 7.2 4.5c2 0 3.6 1.1 4.8 2.8 1.2-1.7 2.8-2.8 4.8-2.8 3.4 0 5.6 3.3 4.4 6.7-1.7 4.7-9.2 9.3-9.2 9.3z"/></svg></span><span class="c">${n(v.likes_count)}</span></button>
        <button class="act cm"><span class="ic svg"><svg viewBox="0 0 24 24"><path d="M12 3.5c5 0 9 3.4 9 7.7s-4 7.7-9 7.7c-1 0-2-.1-2.9-.4L4.5 20.5l1.2-3.9C4 15.2 3 13.3 3 11.2 3 6.9 7 3.5 12 3.5z"/></svg></span><span class="c">${n(v.comments_count)}</span></button>
        ${v.allow_gifts && v.user_id !== S.me.id ? `<button class="act gf"><span class="ic svg gft"><svg viewBox="0 0 24 24"><rect x="3.5" y="9" width="17" height="4" rx="1"/><path d="M5 13v7.5h14V13M12 9v11.5M12 9S10.5 4.3 8 4.9C6 5.4 7 9 12 9zM12 9s1.5-4.7 4-4.1c2 .5 1 4.1-4 4.1z"/></svg></span><span>গিফট</span></button>` : ""}
        <button class="act sh"><span class="ic svg"><svg viewBox="0 0 24 24"><path d="M13.5 4.5 21 11.5l-7.5 7v-4c-5 0-8.3 1.4-10.5 5 .8-5.5 3.6-10 10.5-10.8z"/></svg></span><span class="c">${n(v.shares_count)}</span></button>
        ${setting("downloads_enabled", true) !== false && (!v.is_premium || v.user_id === S.me.id || Number(setting("premium_download_coins", 0)) > 0) ? `<button class="act dl ${v.is_premium ? "pdl" : ""}"><span class="ic svg dlic"><svg viewBox="0 0 24 24"><path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14"/></svg></span><span>${v.is_premium && v.user_id !== S.me.id ? `🪙${n(setting("premium_download_coins", 0))}` : "সেভ"}</span></button>` : ""}
        ${v.user_id !== S.me.id ? `<button class="act rp"><span class="ic svg sm"><svg viewBox="0 0 24 24"><path d="M5 21V4M5 4.5h12l-2.5 4 2.5 4H5"/></svg></span></button>` : ""}
      </div>
      <div class="info">
        <div class="uname"><a href="#u/${v.user_id}">@${esc(v.username)}</a>${v.is_verified ? " ✔️" : ""}${v.is_premium ? `<span class="premtag">👑 ${n(v.premium_coins)}</span>` : ""}
          ${v.user_id !== S.me.id ? `<button class="follow-btn ${v.following ? "on" : ""}">${v.following ? "ফলোয়িং" : "ফলো"}</button>` : ""}</div>
        <div class="cap" translate="no">${rich(v.caption)}</div>
        <div class="tiny muted">👁 ${n(v.views_count)} · ${ago(v.created_at)}</div>
      </div>
      ${v.locked ? `<div class="lockov"><div><div class="crown">👑</div><h3 style="margin:6px 0">প্রিমিয়াম ভিডিও</h3>
        <div class="muted">🪙 ${n(v.premium_coins)} কয়েন দিয়ে দেখুন</div>
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
    const vfr = FRAMES.find((f) => f[0] === v.frame && f[0] !== "9:16");
    if (vfr) { el.classList.add("framed"); video.style.aspectRatio = String(vfr[2]); }
    else video.addEventListener("loadedmetadata", () => { if (video.videoWidth && video.videoHeight < video.videoWidth * 1.2) el.classList.add("wide"); });
    let tapT = null;
    video.addEventListener("click", (e) => {
      if (tapT) { clearTimeout(tapT); tapT = null; doLike(el, true, e); return; }
      tapT = setTimeout(() => {
        tapT = null;
        if (video.paused) { video.play().catch(() => {}); el.querySelector(".paused-ic")?.remove(); if (el._x?.music?.url) bgmPlay(el._x.music.url, el._x.music_start || 0); }
        else { video.pause(); BGM.pause(); el.insertAdjacentHTML("beforeend", `<div class="paused-ic">▶</div>`); }
      }, 260);
    });
    el.querySelector(".mute").onclick = () => {
      S.muted = !S.muted;
      document.querySelectorAll(".slide").forEach((x) => { const vd = x.querySelector("video"); if (vd) vd.muted = S.muted || !!x._x?.orig_muted; });
      BGM.muted = S.muted;
      document.querySelectorAll(".mute").forEach((x) => (x.textContent = S.muted ? "🔇" : "🔊"));
    };
    el.querySelector(".like").onclick = () => doLike(el, false);
    el.querySelector(".cm").onclick = () => openComments(el);
    el.querySelector(".gf")?.addEventListener("click", () => openGifts(el));
    el.querySelector(".sh").onclick = () => doShare(el);
    el.querySelector(".dl")?.addEventListener("click", () => downloadVideo(v));
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

  function slideMusic(el) {
    const x = el?._x;
    if (!x?.music?.url || el._v.locked) return bgmStop();
    const vd = el.querySelector("video");
    if (x.orig_muted) vd.muted = true;
    if (!vd.paused || vd.readyState < 2) bgmPlay(x.music.url, x.music_start || 0);
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
    video.muted = S.muted || !!el._x?.orig_muted;
    video.currentTime = 0;
    video.play().catch(() => {
      S.muted = true;
      document.querySelectorAll(".mute").forEach((x) => (x.textContent = "🔇"));
      video.muted = true;
      video.play().catch(() => {});
    });
    bgmStop(); slideMusic(el);
    st.swipes++;
    if (inter && Native?.showInterstitial && inter.every_n_videos && st.swipes > 1 && st.swipes % inter.every_n_videos === 0) {
      video.pause(); BGM.pause();
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

  window.onAdClosed = () => { st.active?.querySelector("video")?.play().catch(() => {}); slideMusic(st.active); };
  const onVis = () => { if (document.hidden) { st.active?.querySelector("video")?.pause(); BGM.pause(); } };
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
  const paint = () => { btn.classList.toggle("liked", v.liked_by_me); /* svg heart: colour comes from .liked */ btn.querySelector(".c").textContent = n(v.likes_count); };
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
    $("#cl", body).innerHTML = data?.length ? data.map((c) => `<div class="cmt">${avatar(c.profiles)}<div><div class="u">@${esc(c.profiles?.username)} · ${ago(c.created_at)}</div><span translate="no">${rich(c.body)}</span></div>
      ${c.user_id === S.me.id || v.user_id === S.me.id ? `<button class="del" data-id="${c.id}">মুছুন</button>` : ""}</div>`).join("")
      : `<div class="empty">প্রথম কমেন্ট আপনিই করুন</div>`;
  };
  load();
  attachSuggest($("#ci", body));
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

async function openGifts(el, isPost = false) {
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
      const r = isPost ? await rpc("send_post_gift", { p_post: v.id, p_gift_id: sel.id, p_qty: qty, p_idem: uuid() })
        : await rpc("send_gift", { p_video_id: v.id, p_gift_id: sel.id, p_qty: qty, p_idem: uuid() });
      closeSheet();
      const f = document.createElement("div"); f.className = "gift-fly"; f.textContent = sel.icon; document.body.appendChild(f); setTimeout(() => f.remove(), 1700);
      toast(`${sel.icon} x${qty} পাঠানো হয়েছে! বাকি কয়েন ${n(r.coin_balance)}`);
    } catch (er) { toast(errMsg(er), true); e.currentTarget.disabled = false; }
  };
}

// শেয়ার লিংক: অ্যাপ ডাউনলোড পেজ + আমার রেফার কোড
function shareLink() {
  const base = String(setting("share_link", "") || "https://akashpattadar19-cell.github.io/reels-admin/get/");
  return `${base}?ref=${S.me?.user_no ?? ""}`;
}
async function doShare(el) {
  const v = el._v;
  const text = `${v.caption ? v.caption + "\n\n" : ""}🎬 @${v.username}-এর ভিডিও দেখুন Reels Enjoy অ্যাপে — দেখুন আর আয় করুন!\n\n📲 অ্যাপ ডাউনলোড করুন: ${shareLink()}`;
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
  screen.innerHTML = `<div class="page">${header("আপলোড", false)}
    <div class="seg" style="margin-top:0"><button class="on">🎬 ভিডিও</button><button onclick="location.hash='#newphoto'">📷 ফটো</button><button onclick="location.hash='#newstory'">📖 স্টোরি</button><button onclick="location.hash='#texts';setTimeout(()=>document.getElementById('newT')?.click(),300)">✍️ লেখা</button></div>
    <label class="pick" id="pickL"><input type="file" id="vf" accept="video/*" class="hidden"><div class="ic">🎬</div>
      <b>ভিডিও বেছে নিন</b><div class="muted tiny">সর্বোচ্চ ${maxSec} সেকেন্ড · খাড়া (9:16) ভিডিও সবচেয়ে ভালো দেখায়</div></label>
    <video id="pv" class="preview hidden" controls playsinline></video>
    <div id="vframe"></div>
    <div id="mtools" class="hidden"></div>
    <label class="lbl">ক্যাটাগরি</label>
    <select id="cat">${CATS.filter(([k]) => k && k !== "premium").map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select>
    ${S.me.account_type !== "host" && S.me.role !== "admin" && String(setting("premium_upload_hosts_only", true)) === "true"
      ? `<p class="tiny muted" style="margin-top:12px">👑 প্রিমিয়াম ভিডিও শুধু হোস্টরা দিতে পারবে — সেটিংস থেকে হোস্ট হতে আবেদন করুন।</p><input type="checkbox" id="prem" class="hidden"><div id="premBox" class="hidden"><input id="premC"></div>` : `
    <div class="card" style="margin-top:12px">
      <label class="toggle"><span><b>👑 প্রিমিয়াম ভিডিও</b><div class="tiny muted">দর্শক কয়েন দিয়ে দেখবে, আপনি পাবেন ${n(setting("premium_creator_pct", 60))}%। অনুমোদিত হোস্টরা ফ্রি দেখবে। অ্যাডমিন দেখে অনুমোদন দেবেন।</div></span><input type="checkbox" id="prem"></label>
      <div id="premBox" class="hidden"><span class="lbl">কত কয়েন লাগবে</span><input id="premC" type="number" min="1" max="100000" value="${Number(setting("premium_default_coins", 10))}">
        <p class="notice tiny" translate="no">⚠️ ${esc(setting("premium_notice", ""))}</p></div></div>`}
    <label class="lbl">ক্যাপশন (#হ্যাশট্যাগ দিন)</label>
    <textarea id="cap" maxlength="2200" placeholder="ভিডিও সম্পর্কে লিখুন… #funny #bangla"></textarea>
    <button class="btn primary" id="up" disabled>আপলোড করুন</button>
    <div class="progress hidden" id="pg"><div></div></div>
    <p id="msg" class="muted tiny"></p>
    <p class="muted tiny" id="quota"></p>
    <p class="muted tiny">আপলোডের পর ভিডিও অল্প সময় পর্যালোচনায় থাকবে, তারপর সবাই দেখতে পাবে।</p>
    <p class="muted tiny">অশ্লীল, সহিংস বা অন্যের কপিরাইট করা ভিডিও আপলোড করলে অ্যাকাউন্ট ব্লক ও ইনকাম বাতিল হবে।</p></div>`;
  attachSuggest($("#cap"));
  if (S.tagDraft) { $("#cap").value = S.tagDraft; S.tagDraft = null; }
  const vf = $("#vf"), pv = $("#pv");
  let file = null, duration = 0, vFrame = "orig", mt = null;
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
      if (!mt) { $("#mtools").classList.remove("hidden"); mt = mediaTools($("#mtools"), pv, { kind: "video" }); }
      const vw = pv.videoWidth, vh = pv.videoHeight;
      $("#msg").textContent = `${duration} সেকেন্ড · ${(file.size / 1048576).toFixed(1)}MB`;
      const fr = nearestFrame(vw, vh);
      vFrame = FRAMES.some((f) => f[0] === fr) ? fr : "orig";
      $("#vframe").innerHTML = vw ? `<div class="tiny muted" style="margin-top:8px">📐 ভিডিওর আসল ফ্রেম: <b>${fr}</b> · ${vw}×${vh}</div>
        ${frameChips("vfr", vFrame)}
        <div class="tiny muted" id="vfrHint"></div>` : "";
      const applyFrame = () => {
        const f = FRAMES.find((x) => x[0] === vFrame);
        pv.style.aspectRatio = vFrame === "orig" ? "" : String(f[2]);
        pv.style.objectFit = vFrame === "orig" ? "" : "cover";
        pv.style.width = vFrame === "orig" ? "" : `min(100%, ${(50 * f[2]).toFixed(2)}vh)`;
        $("#vfrHint").textContent = vFrame === "orig" ? "মূল সাইজে পুরো ভিডিও দেখাবে" : vFrame === "9:16" ? "পুরো স্ক্রিন জুড়ে দেখাবে (দরকার হলে পাশ কেটে)" : `${f[1]} ফ্রেমে দেখাবে — ফ্রেমের বাইরের অংশ কাটা পড়বে`;
      };
      $("#vfr").onclick = (ev) => {
        const b = ev.target.closest("button[data-f]"); if (!b) return;
        vFrame = b.dataset.f;
        $("#vfr").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
        applyFrame();
      };
      applyFrame();
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
      if (vFrame !== "orig") await rpc("set_video_frame", { p_video: id, p_frame: vFrame }).catch(() => {});
      if (mt && (mt.music || !fxEmpty(mt.fx))) await rpc("set_media_extras", { p_kind: "video", p_id: id, p_music: mt.music?.id ?? null, p_start: mt.start, p_fx: fxEmpty(mt.fx) ? null : mt.fx, p_mute: !!mt.mute }).catch(() => {});
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
  withdraw_refund: "উইথড্র ফেরত", admin_adjust: "অ্যাডমিন অ্যাডজাস্টমেন্ট", premium_unlock: "প্রিমিয়াম ভিডিও আনলক", welcome_bonus: "নতুন ইউজার বোনাস", jail_release: "জেল থেকে মুক্তি",
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

async function loadOffers() {
  const { data } = await sb.from("coin_offers").select("*").order("sort").order("price_taka");
  return data ?? [];
}
function offerLeft(o) {
  if (!o.ends_at) return "";
  const ms = new Date(o.ends_at) - Date.now(); if (ms <= 0) return "শেষ";
  const h = Math.floor(ms / 3600e3), d = Math.floor(h / 24);
  return d >= 1 ? `${d} দিন বাকি` : h >= 1 ? `${h} ঘণ্টা বাকি` : `${Math.ceil(ms / 60e3)} মিনিট বাকি`;
}
const offerCard = (o, price) => {
  const normal = Math.floor(o.price_taka * 100 / price), extra = o.coins - normal;
  return `<button type="button" class="offer" data-of="${o.id}">${o.badge ? `<em translate="no">${esc(o.badge)}</em>` : extra > 0 ? `<em>+${Math.round(extra * 100 / Math.max(normal, 1))}%</em>` : ""}
    <div class="of-c">🪙 ${n(o.coins)}</div>${extra > 0 ? `<s class="tiny">🪙 ${n(normal)}</s>` : ""}<div class="of-t" translate="no">${esc(o.title)}</div>
    <div class="of-p">৳${n(o.price_taka)}</div>${o.ends_at ? `<div class="of-l">⏰ ${offerLeft(o)}</div>` : ""}</button>`;
};
// অ্যাপ খুললে দিনে একবার নতুন অফার পপআপ
async function offerPopup() {
  try {
    if (location.hash.startsWith("#cashin")) return;
    const offers = await loadOffers(); if (!offers.length) return;
    const key = "ofseen_" + new Date().toDateString() + "_" + offers.map((o) => o.id).join(".");
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, "1");
    const price = Number(setting("coin_price_paisa", 100));
    const d = document.createElement("div");
    d.className = "upd-gate soft";
    d.innerHTML = `<div class="upd-card ofpop"><div class="upd-ic">🔥</div><h2>কয়েন অফার চলছে!</h2>
      <div class="offers">${offers.slice(0, 4).map((o) => offerCard(o, price)).join("")}</div>
      <button class="btn primary" id="ofGo">এখনই কিনুন</button><button class="btn" id="ofX" style="margin-top:8px">পরে</button></div>`;
    document.body.appendChild(d);
    const go = (id) => { d.remove(); S.pickOffer = id ?? null; location.hash = "#cashin"; };
    d.querySelectorAll("[data-of]").forEach((b) => (b.onclick = () => go(Number(b.dataset.of))));
    d.querySelector("#ofGo").onclick = () => go();
    d.querySelector("#ofX").onclick = () => d.remove();
  } catch { /* ignore */ }
}

R.cashin = async () => {
  const nums = ["bkash", "nagad", "rocket"].filter((m) => setting(m + "_number", ""));
  const coinPrice = Number(setting("coin_price_paisa", 100));
  const offers = nums.length ? await loadOffers() : [];
  const { data: sellers } = setting("coin_seller_enabled", true) === false ? { data: [] }
    : await sb.from("profiles").select("id,username,full_name,avatar_url,user_no,country_code").eq("coin_seller", true).eq("account_type", "host").eq("status", "active").limit(20);
  screen.innerHTML = `<div class="page">${header("কয়েন কিনুন")}
    ${nums.length ? `<div class="card"><b>ধাপ ১:</b> <span>নিচের নম্বরে Send Money করুন</span>
      ${nums.map((m) => `<div class="row" style="margin-top:8px"><span>${METHOD[m]}</span><span class="copy" data-copy="${esc(setting(m + "_number"))}">${esc(setting(m + "_number"))}</span></div>`).join("")}
      <p class="tiny muted" style="margin:10px 0 0">১ কয়েন = ৳${(coinPrice / 100).toFixed(2).replace(/\.00$/, "")} · ৳১০০ = 🪙 ${n(Math.floor(10000 / coinPrice))} কয়েন · সর্বনিম্ন ৳${n(setting("min_cash_in_taka", 20))}</p></div>
    ${offers.length ? `<div class="card"><b>🔥 বিশেষ অফার</b> <span class="tiny muted">— একটি বেছে নিন, ঠিক ততো টাকা পাঠান</span>
      <div class="offers" id="offers">${offers.map((o) => offerCard(o, coinPrice)).join("")}</div>
      <div class="tiny muted" id="ofSel" style="margin-top:6px"></div></div>` : ""}
    ${setting("cashin_notice", "") ? `<div class="card rules-note"><b>📌 নিয়ম ও নোটিশ</b><div class="tiny" translate="no" style="white-space:pre-line;margin-top:6px">${esc(setting("cashin_notice", ""))}</div></div>` : ""}
    <form class="card" id="cf"><b>ধাপ ২:</b> পেমেন্টের তথ্য দিন
      <div class="methods">${nums.map((m, i) => `<label><input type="radio" name="m" value="${m}" ${i === 0 ? "checked" : ""}>${METHOD[m]}</label>`).join("")}</div>
      <input id="am" type="number" inputmode="numeric" min="1" placeholder="কত টাকা পাঠিয়েছেন" required>
      <div class="tiny muted" id="cv"></div>
      <input id="sn" inputmode="numeric" placeholder="যে নম্বর থেকে পাঠিয়েছেন (01XXXXXXXXX)" required>
      <input id="tx" placeholder="TrxID (যেমন 9AB7C6D5E4)" autocapitalize="characters" required>
      <label class="proofpick"><input type="file" id="pf" accept="image/*" class="hidden"><span id="pfl">📎 পেমেন্টের স্ক্রিনশট দিন (ঐচ্ছিক)</span></label>
      <button class="btn primary">রিকোয়েস্ট পাঠান</button>
      <p class="tiny muted">অ্যাডমিন যাচাই করার পর কয়েন যোগ হবে। ভুল/ভুয়া TrxID দিলে অ্যাকাউন্ট ব্লক হবে।</p></form>`
    : `<div class="card">ক্যাশ-ইন এখন বন্ধ আছে। পরে চেষ্টা করুন।</div>`}
    ${sellers?.length ? `<div class="card"><b>💰 হোস্ট সেলারের কাছ থেকে কিনুন</b> <span class="tiny muted">— মেসেজ দিয়ে দাম জেনে নিন</span>
      <div class="sellers">${sellers.filter((x) => x.id !== S.me.id).map((x) => `<a class="sl-item" href="#u/${x.id}">${avatar(x)}<span><b translate="no">${esc(x.full_name || x.username)}</b><small>${flagOf(x.country_code)} ID ${x.user_no}</small></span><em onclick="event.preventDefault();location.hash='#chat/${x.id}'">💬</em></a>`).join("")}</div></div>` : ""}
    <h3>আপনার রিকোয়েস্ট</h3><div class="card list" id="cl"><div class="spinner"></div></div></div>`;
  let offerId = null;
  const pick = (id) => {
    offerId = offerId === id ? null : id;
    const o = offers.find((x) => x.id === offerId);
    document.querySelectorAll("#offers [data-of]").forEach((b) => b.classList.toggle("on", Number(b.dataset.of) === offerId));
    $("#am").readOnly = !!o;
    if (o) { $("#am").value = o.price_taka; $("#cv").textContent = `অফার: ঠিক ৳${n(o.price_taka)} পাঠান → পাবেন 🪙 ${n(o.coins)} কয়েন`; }
    else { $("#cv").textContent = ""; }
    $("#ofSel").textContent = o ? `✅ "${o.title}" বাছাই করা হয়েছে (আবার চাপলে বাতিল)` : "";
  };
  document.querySelectorAll("#offers [data-of]").forEach((b) => (b.onclick = () => { pick(Number(b.dataset.of)); $("#cf").scrollIntoView({ behavior: "smooth", block: "start" }); }));
  if (S.pickOffer && offers.some((o) => o.id === S.pickOffer)) pick(S.pickOffer);
  S.pickOffer = null;
  $("#am")?.addEventListener("input", (e) => ($("#cv").textContent = e.target.value ? `আপনি পাবেন 🪙 ${n(Math.floor(e.target.value * 100 / coinPrice))} কয়েন` : ""));
  let proof = null;
  $("#pf")?.addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const img = new Image(); img.src = URL.createObjectURL(f); await img.decode();
      const sc = Math.min(1, 1280 / Math.max(img.width, img.height));
      const c = document.createElement("canvas"); c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      proof = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.85));
      $("#pfl").innerHTML = `<img src="${URL.createObjectURL(proof)}" alt=""> ✅ স্ক্রিনশট যুক্ত হয়েছে (বদলাতে চাপুন)`;
    } catch { proof = null; toast("ছবিটি খোলা যায়নি", true); }
  });
  $("#cf")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const b = e.submitter; b.disabled = true;
    try {
      const id = await rpc("request_cash_in", { p_method: $("input[name=m]:checked").value, p_amount_taka: Math.floor(Number($("#am").value)),
        p_sender: cleanPhone($("#sn").value), p_trx: $("#tx").value.trim(), p_offer_id: offerId });
      if (proof && id) {
        try {
          const path = `${S.me.id}/${id}-${Date.now()}.jpg`;
          await xhrUpload("proofs", path, proof, "image/jpeg", () => {});
          await rpc("set_cash_in_proof", { p_id: id, p_path: path });
        } catch { toast("স্ক্রিনশট যায়নি, তবে রিকোয়েস্ট পাঠানো হয়েছে", true); }
      }
      toast("রিকোয়েস্ট পাঠানো হয়েছে — যাচাইয়ের পর কয়েন যোগ হবে");
      R.cashin();
    } catch (er) { toast(errMsg(er), true); b.disabled = false; }
  });
  const { data } = await sb.from("cash_in_requests").select("*").eq("user_id", S.me.id).order("id", { ascending: false }).limit(20);
  $("#cl").innerHTML = data?.length ? data.map((c) => `<div class="li"><div><b>${tk(c.amount_paisa)}</b> · ${METHOD[c.method]} · 🪙 ${n(c.coins)}
    <div class="tiny muted">${dt(c.created_at)} · TrxID ${esc(c.trx_id)}${c.proof_path ? " · 📎" : ""}${c.reject_reason ? " · " + esc(c.reject_reason) : ""}</div></div><span class="pill ${c.status}">${STATUS[c.status]}</span></div>`).join("")
    : `<div class="empty">কোনো রিকোয়েস্ট নেই</div>`;
};

R.withdraw = async () => {
  screen.innerHTML = `<div class="page">${header("উইথড্র")}<div class="spinner"></div></div>`;
  const [el, { data: hist }, { data: accs }] = await Promise.all([
    rpc("withdraw_eligibility").catch((e) => ({ error: e })),
    sb.from("withdraw_requests").select("*").eq("user_id", S.me.id).order("id", { ascending: false }).limit(20),
    sb.from("payout_accounts").select("*").eq("user_id", S.me.id).order("id"),
  ]);
  const saved = accs ?? [];
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
    <div class="card"><div class="row"><b>📱 আমার উইথড্র নম্বর</b><button class="btn small" id="addAcc" type="button">＋ নম্বর যোগ</button></div>
      <div id="accList" class="acc-list">${saved.length ? saved.map((a, i) => `<label class="acc"><input type="radio" name="acc" value="${a.id}" ${i === 0 ? "checked" : ""}>
        <span class="acc-ic ${a.method}">${METHOD[a.method]}</span><span style="flex:1"><b>${esc(a.account)}</b>${a.name ? `<div class="tiny muted" translate="no">${esc(a.name)}</div>` : ""}</span>
        <button type="button" class="acc-del" data-del="${a.id}" aria-label="মুছুন">🗑️</button></label>`).join("") : `<div class="tiny muted" style="padding:6px 0">কোনো নম্বর সেভ করা নেই। "＋ নম্বর যোগ" চেপে বিকাশ/নগদ/রকেট নম্বর যোগ করুন।</div>`}</div>
      <form id="accForm" class="hidden" style="margin-top:8px">
        <div class="methods">${["bkash", "nagad", "rocket"].map((m, i) => `<label><input type="radio" name="am2" value="${m}" ${i === 0 ? "checked" : ""}>${METHOD[m]}</label>`).join("")}</div>
        <input id="aNo" inputmode="numeric" placeholder="নম্বর (01XXXXXXXXX)" required><input id="aNm" placeholder="অ্যাকাউন্টের নাম (ঐচ্ছিক)">
        <button class="btn primary">নম্বর সেভ করুন</button></form></div>
    ${block === "cooldown" ? `<div class="card" style="text-align:center"><div class="muted">পরবর্তী উইথড্র করা যাবে</div><div style="font-size:24px;font-weight:700" id="cd"></div><div class="tiny muted">${dt(el.next_available_at)}</div></div>`
      : block ? `<div class="notice">${esc(block)}</div>`
      : `<form class="card" id="wf">
        ${saved.length ? `<div class="tiny muted">উপরের বাছাই করা নম্বরে টাকা যাবে</div>` : `<span class="lbl">কোথায় নেবেন</span>
        <div class="methods">${["bkash", "nagad", "rocket"].map((m, i) => `<label><input type="radio" name="m" value="${m}" ${i === 0 ? "checked" : ""}>${METHOD[m]}</label>`).join("")}</div>
        <input id="ac" inputmode="numeric" placeholder="অ্যাকাউন্ট নম্বর (01XXXXXXXXX)" required>
        <input id="an" placeholder="অ্যাকাউন্টের নাম (ঐচ্ছিক)">
        <label class="agree"><input type="checkbox" id="sv" checked> <span>এই নম্বর পরের বারের জন্য সেভ রাখুন</span></label>`}
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
  $("#addAcc").onclick = () => { $("#accForm").classList.toggle("hidden"); $("#aNo").focus(); };
  $("#accForm").addEventListener("submit", async (e) => {
    e.preventDefault(); const b = e.submitter; b.disabled = true;
    try { await rpc("add_payout_account", { p_method: $("input[name=am2]:checked").value, p_account: cleanPhone($("#aNo").value), p_name: $("#aNm").value }); toast("নম্বর সেভ হয়েছে ✅"); R.withdraw(); }
    catch (er) { toast(errMsg(er), true); b.disabled = false; }
  });
  $("#accList").addEventListener("click", async (e) => {
    const d = e.target.closest("[data-del]"); if (!d) return;
    e.preventDefault();
    if (!confirm("এই নম্বর মুছবেন?")) return;
    try { await rpc("delete_payout_account", { p_id: Number(d.dataset.del) }); R.withdraw(); } catch (er) { toast(errMsg(er), true); }
  });
  $("#wf")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const amount = Math.round(Number($("#am").value) * 100);
    const sel = saved.find((a) => a.id === Number($("input[name=acc]:checked")?.value));
    const m = sel ? sel.method : $("input[name=m]:checked").value, acc = sel ? sel.account : cleanPhone($("#ac").value), nm = sel ? sel.name ?? "" : $("#an").value;
    if (!acc) return toast("নম্বর দিন", true);
    if (!confirm(`${tk(amount)} ${METHOD[m]} ${acc} নম্বরে উইথড্র করবেন?`)) return;
    const b = e.submitter; b.disabled = true;
    try {
      if (!sel && $("#sv")?.checked) await rpc("add_payout_account", { p_method: m, p_account: acc, p_name: nm }).catch(() => {});
      await rpc("request_withdraw", { p_amount_paisa: amount, p_method: m, p_account: acc, p_name: nm });
      toast("রিকোয়েস্ট পাঠানো হয়েছে ✅");
      R.withdraw();
    } catch (er) { toast(errMsg(er), true); b.disabled = false; }
  });
};

// ---------------- কয়েন সেলার প্যানেল (হোস্ট + এডমিন অনুমতি) ----------------
R.seller = async () => {
  screen.innerHTML = `<div class="page">${header("💰 কয়েন সেলার")}<div class="spinner"></div></div>`;
  let d;
  try { d = await rpc("seller_summary"); } catch (e) { screen.innerHTML = `<div class="page">${header("💰 কয়েন সেলার")}<div class="empty">${esc(errMsg(e))}</div></div>`; return; }
  const price = Number(setting("coin_price_paisa", 100)), pct = Number(d.pct);
  const com = (c) => Math.ceil((c * pct) / 100);
  screen.innerHTML = `<div class="page seller-page">${header("💰 কয়েন সেলার")}
    <div class="sl-hero"><div class="sl-badge">👑 HOST · 💰 OFFICIAL COIN SELLER</div>
      <div class="tiny">আপনার কয়েন স্টক</div><b id="stk">🪙 ${n(d.stock)}</b>
      <div class="sl-row"><span>আজ বিক্রি<br><b>🪙 ${n(d.today.coins)}</b></span><span>মোট বিক্রি<br><b>🪙 ${n(d.total.coins)}</b></span><span>ক্রেতা<br><b>${n(d.total.buyers)}</b></span></div>
      <div class="tiny" style="opacity:.85;margin-top:8px">প্রতি বিক্রিতে এডমিন কমিশন ${pct}% (আপনার স্টক থেকে বাড়তি কাটা হবে)</div>
      <a class="btn sl-buy" href="#cashin">＋ স্টক বাড়ান (এডমিন থেকে কয়েন কিনুন)</a></div>
    <form class="card" id="sf"><b>🪙 কয়েন বিক্রি করুন</b>
      <input id="bno" type="number" inputmode="numeric" placeholder="ক্রেতার ID নম্বর (যেমন 100001)" required>
      <div id="bwho" class="bwho"></div>
      <input id="bc" type="number" inputmode="numeric" min="1" placeholder="কত কয়েন দেবেন" required>
      <div class="row-btns">${[100, 500, 1000, 5000, 10000].map((x) => `<button type="button" class="btn small" data-q="${x}">${n(x)}</button>`).join("")}</div>
      <input id="bt" type="number" inputmode="decimal" step="0.01" min="0" placeholder="কত টাকা পেয়েছেন (ঐচ্ছিক, শুধু আপনার হিসাবের জন্য)">
      <input id="bn" maxlength="80" placeholder="নোট (ঐচ্ছিক, যেমন: বিকাশ TrxID)">
      <div id="bcalc" class="bcalc"></div>
      <button class="btn primary">কয়েন পাঠান</button>
      <p class="tiny muted">ক্রেতার কাছ থেকে টাকা নিশ্চিত হওয়ার পরেই কয়েন পাঠান। একবার পাঠালে ফেরত নেওয়া যায় না।</p></form>
    <h3>বিক্রির হিসাব</h3><div class="card list">${d.recent.length ? d.recent.map((r) => `<div class="li"><div><b>@${esc(r.username)}</b> <span class="tiny muted">ID ${r.user_no}</span>
        <div class="tiny muted">${dt(r.created_at)}${r.taka_paisa ? ` · ${tk(r.taka_paisa)}` : ""}${r.note ? ` · <span translate="no">${esc(r.note)}</span>` : ""}</div></div>
        <span style="text-align:right"><b class="minus-amt">−🪙 ${n(r.coins)}</b>${Number(r.commission_coins) ? `<div class="tiny muted">কমিশন ${n(r.commission_coins)}</div>` : ""}</span></div>`).join("") : `<div class="empty">এখনো কোনো বিক্রি নেই</div>`}</div></div>`;
  let buyer = null, tm;
  const calc = () => {
    const c = Math.floor(Number($("#bc").value)); if (!c) { $("#bcalc").innerHTML = ""; return; }
    const tot = c + com(c), ok = tot <= Number(d.stock);
    $("#bcalc").innerHTML = `ক্রেতা পাবে <b>🪙 ${n(c)}</b> · কমিশন 🪙 ${n(com(c))}<br>আপনার স্টক থেকে কাটবে <b class="${ok ? "" : "minus-amt"}">🪙 ${n(tot)}</b>${ok ? "" : " — স্টক যথেষ্ট নেই"}
      <div class="tiny muted">অ্যাপের দামে এই কয়েনের মূল্য প্রায় ${tk(c * price)}</div>`;
  };
  $("#bc").oninput = calc;
  document.querySelectorAll("#sf [data-q]").forEach((b) => (b.onclick = () => { $("#bc").value = b.dataset.q; calc(); }));
  $("#bno").oninput = () => { clearTimeout(tm); tm = setTimeout(async () => {
    buyer = null; const no = Number($("#bno").value); if (!no) { $("#bwho").innerHTML = ""; return; }
    const { data } = await sb.from("profiles").select("id,username,full_name,avatar_url,status").eq("user_no", no).maybeSingle();
    if (!data) { $("#bwho").innerHTML = `<span class="minus-amt tiny">এই ID-তে কেউ নেই</span>`; return; }
    if (data.id === S.me.id) { $("#bwho").innerHTML = `<span class="minus-amt tiny">এটা আপনার নিজের ID</span>`; return; }
    buyer = data; $("#bwho").innerHTML = `${avatar(data)}<span><b translate="no">${esc(data.full_name || data.username)}</b><div class="tiny muted">@${esc(data.username)}</div></span>✅`;
  }, 350); };
  $("#sf").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!buyer) return toast("সঠিক ক্রেতার ID দিন", true);
    const c = Math.floor(Number($("#bc").value)); if (!c || c < 1) return toast(ERR.BAD_AMOUNT, true);
    if (!confirm(`@${buyer.username}-কে 🪙 ${n(c)} কয়েন পাঠাবেন?\nআপনার স্টক থেকে কাটবে 🪙 ${n(c + com(c))} (কমিশনসহ)`)) return;
    const b = e.submitter; b.disabled = true;
    try {
      const r = await rpc("seller_sell_coins", { p_user_no: Number($("#bno").value), p_coins: c, p_taka: $("#bt").value ? Number($("#bt").value) : null, p_note: $("#bn").value });
      toast(`✅ @${r.buyer}-কে 🪙 ${n(c)} পাঠানো হয়েছে`);
      R.seller();
    } catch (er) { toast(errMsg(er), true); b.disabled = false; }
  });
};

// ---------------- INBOX ----------------
R.inbox = async (tab = "chat") => {
  screen.innerHTML = `<div class="page">${header("মেসেজ")}
    <div class="seg" style="margin-top:0"><button data-t="chat" class="${tab === "chat" ? "on" : ""}">💬 চ্যাট${S.msgUnread ? ` (${S.msgUnread})` : ""}</button><button data-t="notif" class="${tab === "notif" ? "on" : ""}">🔔 নোটিফিকেশন${S.unread ? ` (${S.unread})` : ""}</button></div>
    <div class="card list" id="nl"><div class="spinner"></div></div></div>`;
  document.querySelectorAll(".seg button").forEach((b) => (b.onclick = () => location.replace("#inbox/" + b.dataset.t)));
  if (tab === "chat") {
    const rows = await rpc("my_chats").catch(() => []);
    $("#nl").innerHTML = rows.length ? rows.map((c) => `<a class="li chat-li" href="#chat/${c.other_id}">${avatar(c)}
        <span style="flex:1;min-width:0"><b translate="no">${esc(c.full_name || c.username)}</b><div class="tiny muted ell" translate="no">${c.last_from_me ? (c.last_status === "seen" ? '<b class="tk seen">✓✓</b> ' : c.last_status === "delivered" ? '<b class="tk">✓✓</b> ' : '<b class="tk">✓</b> ') + "আপনি: " : ""}${esc(c.last_body)}</div></span>
        <span class="tiny muted" style="text-align:right">${ago(c.last_at)}${c.unread ? `<div><b class="ubadge">${c.unread}</b></div>` : ""}</span></a>`).join("")
      : `<div class="empty">এখনো কোনো চ্যাট নেই।<br>কারো প্রোফাইলে গিয়ে "💬 মেসেজ" চাপুন।</div>`;
    return;
  }
  const { data } = await sb.from("notifications").select("*").eq("user_id", S.me.id).order("id", { ascending: false }).limit(60);
  const icon = { like: "❤️", comment: "💬", gift: "🎁", follow: "👤", withdraw: "💸", cash_in: "🪙", system: "📢", mention: "📣" };
  const href = (x) => x.data?.video_id ? `#v/${x.data.video_id}` : x.data?.post_id ? `#post/${x.data.post_id}` : x.data?.contest_id ? `#contest/${x.data.contest_id}`
    : x.data?.user_id ? `#u/${x.data.user_id}` : x.type === "withdraw" ? "#withdraw" : x.type === "cash_in" ? "#cashin" : "";
  $("#nl").innerHTML = data?.length ? data.map((x) => `<a class="li" ${href(x) ? `href="${href(x)}"` : ""}
      style="${x.is_read ? "" : "background:rgba(155,92,255,.08);margin:0 -14px;padding:12px 14px"}">
      <div style="display:flex;gap:10px"><span style="font-size:22px">${icon[x.type] ?? "🔔"}</span><div><b>${esc(x.title)}</b>${x.body ? `<div class="tiny muted">${esc(x.body)}</div>` : ""}<div class="tiny muted">${ago(x.created_at)}</div></div></div></a>`).join("")
    : `<div class="empty">কোনো নোটিফিকেশন নেই</div>`;
  if (S.unread) { await rpc("mark_notifications_read").catch(() => {}); S.unread = 0; paintUnread(); }
};

const TICK = (m) => m.read_at ? `<b class="tk seen">✓✓</b>` : m.delivered_at ? `<b class="tk">✓✓</b>` : `<b class="tk">✓</b>`;
R.chat = async (uid) => {
  const { data: o } = await sb.from("profiles").select("id,username,full_name,avatar_url").eq("id", uid).maybeSingle();
  if (!o) { screen.innerHTML = `<div class="page"><div class="empty">ইউজার পাওয়া যায়নি</div></div>`; return; }
  screen.classList.add("chatmode");
  screen.innerHTML = `<div class="chat">
    <div class="chat-top"><button class="back" onclick="history.back()">←</button><a href="#u/${o.id}" style="display:flex;align-items:center;gap:10px">${avatar(o)}<b translate="no">${esc(o.full_name || o.username)}</b></a></div>
    <div class="chat-list" id="cl"><div class="spinner"></div></div>
    <div class="reply-bar hidden" id="rbar"><div><b id="rbT"></b><div class="tiny ell" id="rbB" translate="no"></div></div><button type="button" id="rbX">✕</button></div>
    <form class="chat-box" id="cf"><input id="ci" placeholder="মেসেজ লিখুন…" maxlength="1000" autocomplete="off"><button class="btn small primary" style="width:auto;margin:0">পাঠান</button></form></div>`;
  S.chatWith = uid;
  const list = $("#cl"), msgs = new Map();
  let replyTo = null, editing = null;
  const hm = (d) => new Date(d).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const quote = (m) => {
    if (!m.reply_to) return "";
    const q = msgs.get(m.reply_to);
    return `<div class="bq" data-goto="${m.reply_to}"><b>${q ? (q.sender_id === S.me.id ? "আপনি" : esc(o.full_name || o.username)) : "↩️"}</b><span translate="no">${q ? esc(q.body.slice(0, 80)) : "পুরনো মেসেজ"}</span></div>`;
  };
  const bubble = (m) => `<div class="bub ${m.sender_id === S.me.id ? "mine" : ""}" data-id="${m.id}">${quote(m)}<span class="bt" translate="no">${esc(m.body)}</span>
    <i>${m.edited_at ? "এডিট করা · " : ""}${hm(m.created_at)} ${m.sender_id === S.me.id ? TICK(m) : ""}</i></div>`;
  const put = (m) => { msgs.set(m.id, m); list.querySelector(".empty")?.remove(); list.insertAdjacentHTML("beforeend", bubble(m)); list.scrollTop = list.scrollHeight; };
  const repaint = (m) => { msgs.set(m.id, { ...msgs.get(m.id), ...m }); const el = list.querySelector(`.bub[data-id="${m.id}"]`); if (el) el.outerHTML = bubble(msgs.get(m.id)); };
  const rows = await rpc("chat_messages", { p_with: uid, p_before: null }).catch((e) => { toast(errMsg(e), true); return []; });
  rows.forEach((m) => msgs.set(m.id, m));
  list.innerHTML = rows.length ? rows.map(bubble).join("") : `<div class="empty">👋 প্রথম মেসেজ পাঠান</div>`;
  list.scrollTop = list.scrollHeight;
  refreshUnread();

  const setBar = (mode, m) => {
    replyTo = mode === "reply" ? m.id : null; editing = mode === "edit" ? m.id : null;
    if (!mode) { $("#rbar").classList.add("hidden"); return; }
    $("#rbar").classList.remove("hidden");
    $("#rbT").textContent = mode === "edit" ? "✏️ মেসেজ এডিট করছেন" : `↩️ ${m.sender_id === S.me.id ? "আপনাকে" : (o.full_name || o.username)} উত্তর দিচ্ছেন`;
    $("#rbB").textContent = m.body.slice(0, 90);
    if (mode === "edit") $("#ci").value = m.body;
    $("#ci").focus();
  };
  $("#rbX").onclick = () => { if (editing) $("#ci").value = ""; setBar(null); };

  // সোয়াইপ করে রিপ্লাই, লং-প্রেস করে মেনু
  let sw = null, lp = null;
  list.addEventListener("touchstart", (e) => {
    const b = e.target.closest(".bub"); if (!b) return;
    sw = { b, x: e.touches[0].clientX, y: e.touches[0].clientY, dx: 0 };
    lp = setTimeout(() => { sw = null; msgMenu(msgs.get(Number(b.dataset.id))); }, 520);
  }, { passive: true });
  list.addEventListener("touchmove", (e) => {
    if (!sw) return;
    const dx = e.touches[0].clientX - sw.x, dy = e.touches[0].clientY - sw.y;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) clearTimeout(lp);
    if (Math.abs(dy) > Math.abs(dx)) return;
    sw.dx = Math.max(0, Math.min(80, dx));
    sw.b.style.transform = `translateX(${sw.dx}px)`; sw.b.classList.toggle("swipe-ok", sw.dx > 55);
  }, { passive: true });
  list.addEventListener("touchend", () => {
    clearTimeout(lp);
    if (!sw) return;
    const { b, dx } = sw; sw = null;
    b.style.transform = ""; b.classList.remove("swipe-ok");
    if (dx > 55) setBar("reply", msgs.get(Number(b.dataset.id)));
  });
  list.addEventListener("contextmenu", (e) => { const b = e.target.closest(".bub"); if (!b) return; e.preventDefault(); msgMenu(msgs.get(Number(b.dataset.id))); });
  list.addEventListener("click", (e) => {
    const q = e.target.closest("[data-goto]"); if (!q) return;
    const t = list.querySelector(`.bub[data-id="${q.dataset.goto}"]`);
    if (t) { t.scrollIntoView({ block: "center", behavior: "smooth" }); t.classList.add("flash"); setTimeout(() => t.classList.remove("flash"), 1200); }
  });
  function msgMenu(m) {
    if (!m || !m.id) return;
    const mine = m.sender_id === S.me.id, canEdit = mine && Date.now() - new Date(m.created_at).getTime() < 864e5;
    const body = sheet(`<div class="msgmenu"><div class="tiny muted ell" translate="no" style="margin-bottom:8px">${esc(m.body.slice(0, 100))}</div>
      <button class="btn" data-a="reply">↩️ উত্তর দিন</button><button class="btn" data-a="copy">📋 কপি</button>
      ${canEdit ? `<button class="btn" data-a="edit">✏️ এডিট</button>` : ""}${mine ? `<button class="btn" data-a="del" style="color:#e5484d">🗑️ মুছে ফেলুন</button>` : ""}
      ${mine ? `<div class="tiny muted" style="margin-top:6px">${m.read_at ? `✓✓ দেখেছে ${dt(m.read_at)}` : m.delivered_at ? `✓✓ পৌঁছেছে ${dt(m.delivered_at)} · এখনো দেখেনি` : "✓ পাঠানো হয়েছে · এখনো পৌঁছায়নি"}</div>` : ""}</div>`);
    body.onclick = async (e) => {
      const a = e.target.closest("[data-a]")?.dataset.a; if (!a) return;
      closeSheet();
      if (a === "reply") setBar("reply", m);
      else if (a === "edit") setBar("edit", m);
      else if (a === "copy") { try { await navigator.clipboard.writeText(m.body); toast("কপি হয়েছে"); } catch { /* */ } }
      else if (a === "del" && confirm("মেসেজটি মুছবেন?")) {
        try { await rpc("delete_message", { p_id: m.id }); msgs.delete(m.id); list.querySelector(`.bub[data-id="${m.id}"]`)?.remove(); } catch (er) { toast(errMsg(er), true); }
      }
    };
  }

  const onMsg = (e) => { put(e.detail); rpc("mark_read", { p_with: uid }).catch(() => {}); };
  const onUpd = (e) => { const m = e.detail; if (msgs.has(m.id)) repaint(m); };
  document.addEventListener("chatmsg", onMsg);
  document.addEventListener("msgupd", onUpd);
  cleanup = () => { document.removeEventListener("chatmsg", onMsg); document.removeEventListener("msgupd", onUpd); S.chatWith = null; screen.classList.remove("chatmode"); };
  $("#cf").onsubmit = async (e) => {
    e.preventDefault();
    const t = $("#ci").value.trim(); if (!t) return;
    $("#ci").value = "";
    try {
      if (editing) {
        const id = editing; setBar(null);
        await rpc("edit_message", { p_id: id, p_body: t });
        repaint({ id, body: t, edited_at: new Date().toISOString() });
      } else {
        const rt = replyTo; setBar(null);
        const id = await rpc("send_message", { p_to: uid, p_body: t, p_reply_to: rt });
        put({ id, sender_id: S.me.id, body: t, reply_to: rt, created_at: new Date().toISOString() });
      }
    } catch (er) { toast(errMsg(er), true); $("#ci").value = t; }
  };
};

// ---------------- ছবি সংকোচন ----------------
async function compressImage(file, max = 1280, q = 0.85) {
  const img = new Image();
  img.src = URL.createObjectURL(file);
  await img.decode();
  const s = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement("canvas"); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return await new Promise((r) => c.toBlob(r, "image/jpeg", q));
}

// ---------------- POSTS (ফটো / টেক্সট) ----------------
const TEXT_CATS = [["", "সব"], ["shayari", "💌 শায়েরি"], ["golpo", "📖 গল্প"], ["joke", "😂 মজার কথা"], ["kobita", "🖋️ কবিতা"], ["romantic", "❤️ রোমান্টিক"]];
const BGS = { g1: "linear-gradient(135deg,#8b5cf6,#ec4899)", g2: "linear-gradient(135deg,#0ea5e9,#6366f1)", g3: "linear-gradient(135deg,#f59e0b,#ef4444)",
  g4: "linear-gradient(135deg,#10b981,#0e7490)", g5: "linear-gradient(135deg,#1f2937,#4b5563)", g6: "linear-gradient(135deg,#f472b6,#fb7185)" };
const postCard = (v, i) => `<a class="dcard ${i % 4 === 1 || i % 4 === 2 ? "tall" : ""}" href="#post/${v.id}">
  <div class="ph"><img src="${esc(v.image_url)}" loading="lazy" alt="">
    <div class="tags">${v.country_code ? `<span>${flagOf(v.country_code)} ${esc(v.country_code)}</span>` : ""}<span>❤️ ${n(v.likes_count)}</span><span class="lv">✦Lv${v.level ?? 0}</span></div></div>
  ${v.body ? `<div class="cap" translate="no">${v.kind === "photo" ? richPlain(v.body) : esc(v.body)}</div>` : ""}
  <div class="who">${avatar(v)}<span translate="no">${esc(v.full_name || v.username)}</span></div></a>`;

function postActions(v, el) {
  return `<div class="pacts">
    <button class="pa like ${v.liked_by_me ? "on" : ""}">${v.liked_by_me ? "❤️" : "🤍"} <span>${n(v.likes_count)}</span></button>
    <button class="pa cm">💬 <span>${n(v.comments_count)}</span></button>
    <button class="pa sh">↗️ <span>${n(v.shares_count)}</span></button>
    ${v.user_id !== S.me.id ? `<button class="pa gf">🎁 গিফট</button>` : `<button class="pa del">🗑️</button>`}</div>`;
}
function bindPost(el, v) {
  el._v = v;
  el.querySelector(".like").onclick = async (e) => {
    const b = e.currentTarget;
    try { const r = await rpc("toggle_post_like", { p_post: v.id }); v.liked_by_me = r.liked; v.likes_count = r.likes_count;
      b.classList.toggle("on", r.liked); b.innerHTML = `${r.liked ? "❤️" : "🤍"} <span>${n(r.likes_count)}</span>`; }
    catch (er) { toast(errMsg(er), true); }
  };
  el.querySelector(".cm").onclick = () => openPostComments(el);
  el.querySelector(".sh").onclick = async () => {
    const first = (v.body || "").split("\n")[0].slice(0, 60);
    const text = `${first ? first + "…\n\n" : ""}✨ @${v.username}-এর ${v.kind === "text" ? "লেখা" : "ছবি"} দেখুন Reels Enjoy অ্যাপে!\n\n📲 অ্যাপ ডাউনলোড করুন: ${shareLink()}`;
    try {
      if (Native?.share) Native.share(text); else if (navigator.share) await navigator.share({ text }); else { await navigator.clipboard.writeText(text); toast("কপি হয়েছে"); }
      await rpc("record_post_share", { p_post: v.id }); v.shares_count++; el.querySelector(".sh span").textContent = n(v.shares_count);
    } catch { /* */ }
  };
  el.querySelector(".gf")?.addEventListener("click", () => openGifts(el, true));
  el.querySelector(".del")?.addEventListener("click", async () => {
    if (!confirm("পোস্টটি মুছবেন?")) return;
    try { await rpc("delete_post", { p_post: v.id }); el.remove(); toast("মুছে ফেলা হয়েছে"); if (location.hash.startsWith("#post/")) history.back(); }
    catch (er) { toast(errMsg(er), true); }
  });
}
async function openPostComments(el) {
  const v = el._v;
  const body = sheet(`<h3>কমেন্ট</h3><div class="comments" id="cl"><div class="spinner"></div></div>
    <form class="cmt-box" id="cf"><input id="ci" placeholder="কমেন্ট লিখুন…" maxlength="500" autocomplete="off"><button class="btn small">পাঠান</button></form>`);
  const load = async () => {
    const data = await rpc("post_comments_list", { p_post: v.id }).catch(() => []);
    $("#cl", body).innerHTML = data.length ? data.map((c) => `<div class="cmt">${avatar(c)}<div><div class="u">@${esc(c.username)} · ${ago(c.created_at)}</div><span translate="no">${rich(c.body)}</span></div>
      ${c.user_id === S.me.id || v.user_id === S.me.id ? `<button class="del" data-id="${c.id}">মুছুন</button>` : ""}</div>`).join("") : `<div class="empty">প্রথম কমেন্ট আপনিই করুন</div>`;
  };
  load();
  attachSuggest($("#ci", body));
  const setC = () => { const x = el.querySelector(".cm span"); if (x) x.textContent = n(v.comments_count); };
  $("#cl", body).onclick = async (e) => {
    const d = e.target.closest(".del"); if (!d || !confirm("কমেন্ট মুছবেন?")) return;
    try { await rpc("delete_post_comment", { p_id: Number(d.dataset.id) }); v.comments_count--; setC(); load(); } catch (er) { toast(errMsg(er), true); }
  };
  $("#cf", body).onsubmit = async (e) => {
    e.preventDefault();
    const t = $("#ci", body).value.trim(); if (!t) return;
    $("#ci", body).value = "";
    try { await rpc("add_post_comment", { p_post: v.id, p_body: t }); v.comments_count++; setC(); load(); } catch (er) { toast(errMsg(er), true); }
  };
}

R.post = async (id) => {
  screen.innerHTML = `<div class="page"><div class="spinner"></div></div>`;
  const { data: p } = await sb.from("posts").select("user_id,kind").eq("id", id).maybeSingle();
  const rows = p ? await rpc("feed_posts", { p_kind: p.kind, p_before: Number(id) + 1, p_limit: 1, p_category: null, p_contest: null, p_user: p.user_id, p_sort: "new" }).catch(() => []) : [];
  const v = rows.find((x) => x.id === Number(id));
  if (!v) { screen.innerHTML = `<div class="page">${header("পোস্ট")}<div class="empty">পোস্টটি আর নেই</div></div>`; return; }
  screen.innerHTML = `<div class="page post-page ${v.kind === "text" ? "nocopy" : ""}">${header(v.kind === "text" ? "✍️ লেখা" : "🖼️ ছবি")}
    <div class="pcard" id="pc">
      <a class="pwho" href="#u/${v.user_id}">${avatar(v)}<span><b translate="no">${esc(v.full_name || v.username)}</b><div class="tiny muted">${flagOf(v.country_code)} Lv${v.level} · ${ago(v.created_at)}</div></span></a>
      ${v.kind === "photo" ? `<img class="pimg" src="${esc(v.image_url)}" alt="">${v.body ? `<p translate="no">${rich(v.body)}</p>` : ""}`
        : `<div class="tbody" style="background:${BGS[v.bg] ?? BGS.g1}" translate="no">${rich(v.body)}</div>`}
      ${postActions(v)}</div></div>`;
  bindPost($("#pc"), v);
  if (v.kind === "text") secureOn();
  const { data: px } = await sb.from("posts").select("music_start,music:music_id(url,title,artist)").eq("id", v.id).maybeSingle();
  if (px?.music?.url) {
    $("#pc .pimg")?.insertAdjacentHTML("afterend", `<button class="mtag light" id="pmus"><span class="disc">🎵</span><span class="mq" translate="no">${esc(px.music.title)}${px.music.artist ? " · " + esc(px.music.artist) : ""}</span><b>⏸</b></button>`);
    S.muted = false; bgmPlay(px.music.url, px.music_start || 0);
    $("#pmus").onclick = () => { if (BGM.paused) { bgmPlay(px.music.url, px.music_start || 0); $("#pmus b").textContent = "⏸"; } else { BGM.pause(); $("#pmus b").textContent = "▶"; } };
  }
};

// কপি/স্ক্রিনশট বন্ধ (টেক্সট আর্নিং)
function secureOn() {
  try { Native?.setSecure?.(true); } catch { /* */ }
  const block = (e) => { if (e.target.closest?.(".nocopy")) e.preventDefault(); };
  document.addEventListener("copy", block); document.addEventListener("contextmenu", block);
  const prev = cleanup;
  cleanup = () => { try { Native?.setSecure?.(false); } catch { /* */ } document.removeEventListener("copy", block); document.removeEventListener("contextmenu", block); prev?.(); };
}

R.texts = (cat = "") => {
  screen.innerHTML = `<div class="page texts nocopy">
    <h1>✍️ টেক্সট আর্নিং</h1>
    <div class="chiprow">${TEXT_CATS.map(([k, l]) => `<a href="#texts${k ? "/" + k : ""}" class="${k === cat ? "on" : ""}">${l}</a>`).join("")}</div>
    <div id="tl"></div><div id="tm"></div>
    <button class="fab" id="newT">✍️ লিখুন</button></div>`;
  secureOn();
  const st = { before: null, loading: false, done: false };
  async function more() {
    if (st.loading || st.done) return;
    st.loading = true; $("#tm").innerHTML = `<div class="spinner"></div>`;
    try {
      const rows = await rpc("feed_posts", { p_kind: "text", p_before: st.before, p_limit: 15, p_category: cat || null, p_contest: null, p_user: null, p_sort: "new" });
      for (const v of rows) {
        const d = document.createElement("div"); d.className = "pcard";
        d.innerHTML = `<a class="pwho" href="#u/${v.user_id}">${avatar(v)}<span><b translate="no">${esc(v.full_name || v.username)}</b><div class="tiny muted">${esc((TEXT_CATS.find(([k]) => k === v.category) ?? ["", ""])[1])} · ${ago(v.created_at)}</div></span></a>
          <div class="tbody" style="background:${BGS[v.bg] ?? BGS.g1}" translate="no">${esc(v.body)}</div>${postActions(v)}`;
        $("#tl").appendChild(d); bindPost(d, v);
      }
      if (rows.length) st.before = rows[rows.length - 1].id;
      if (rows.length < 15) st.done = true;
      $("#tm").innerHTML = st.done && !$("#tl").children.length ? `<div class="empty">এখনো কোনো লেখা নেই — প্রথম লেখাটি আপনিই দিন ✍️</div>` : "";
    } catch (e) { $("#tm").innerHTML = `<div class="empty">${esc(errMsg(e))}</div>`; }
    st.loading = false;
  }
  const onScroll = () => { if (screen.scrollTop + screen.clientHeight > screen.scrollHeight - 500) more(); };
  screen.addEventListener("scroll", onScroll);
  const prev = cleanup; cleanup = () => { screen.removeEventListener("scroll", onScroll); prev?.(); };
  more();
  $("#newT").onclick = () => composeText(cat);
};

function composeText(cat) {
  const maxL = Number(setting("text_max_lines", 6)), maxC = Number(setting("text_max_chars", 600));
  let bg = "g1";
  const body = sheet(`<h3>✍️ নতুন লেখা</h3>
    <select id="tc">${TEXT_CATS.filter(([k]) => k).map(([k, l]) => `<option value="${k}" ${k === cat ? "selected" : ""}>${l}</option>`).join("")}</select>
    <div class="tprev" id="tp" style="background:${BGS.g1}"><textarea id="tt" maxlength="${maxC}" placeholder="এখানে লিখুন… (সর্বোচ্চ ${maxL} লাইন)"></textarea></div>
    <div class="bgs">${Object.entries(BGS).map(([k, v]) => `<button data-bg="${k}" style="background:${v}" class="${k === "g1" ? "on" : ""}"></button>`).join("")}</div>
    <div class="row tiny muted"><span id="lc">0/${maxL} লাইন</span><span id="cc">0/${maxC}</span></div>
    <p class="notice tiny" translate="no">${esc(setting("text_notice", ""))}</p>
    <button class="btn primary" id="tsend">পোস্ট করুন</button>`);
  const ta = $("#tt", body);
  attachSuggest(ta);
  const count = () => { const l = ta.value.split("\n").length; $("#lc", body).textContent = `${l}/${maxL} লাইন`; $("#lc", body).style.color = l > maxL ? "#e5484d" : ""; $("#cc", body).textContent = `${ta.value.length}/${maxC}`; };
  ta.oninput = count;
  $(".bgs", body).onclick = (e) => { const b = e.target.closest("[data-bg]"); if (!b) return; bg = b.dataset.bg; $("#tp", body).style.background = BGS[bg];
    body.querySelectorAll(".bgs button").forEach((x) => x.classList.toggle("on", x === b)); };
  $("#tsend", body).onclick = async (e) => {
    const t = ta.value.trim();
    if (!t) return toast(ERR.EMPTY_TEXT, true);
    if (t.split("\n").length > maxL) return toast(`সর্বোচ্চ ${maxL} লাইন লেখা যাবে`, true);
    e.target.disabled = true;
    try { await rpc("create_post", { p_kind: "text", p_body: t, p_image_path: null, p_image_url: null, p_category: $("#tc", body).value, p_bg: bg, p_contest: null });
      closeSheet(); toast("✅ পোস্ট হয়েছে"); R.texts(cat); }
    catch (er) { toast(errMsg(er), true); e.target.disabled = false; }
  };
}

// ---------- ফ্রেম সাইজ (Original / 1:1 / 9:16 / 16:9 / 3:4 / 4:3) ----------
const FRAMES = [["orig", "মূল সাইজ", 0], ["1:1", "1:1", 1], ["9:16", "9:16", 9 / 16], ["16:9", "16:9", 16 / 9], ["3:4", "3:4", 3 / 4], ["4:3", "4:3", 4 / 3]];
const FRAME_ICON = (r) => `<i class="fr-ic" style="aspect-ratio:${r || 0.8}"></i>`;
function nearestFrame(w, h) {
  if (!w || !h) return "";
  const r = w / h;
  let best = FRAMES[1];
  for (const f of FRAMES.slice(1)) if (Math.abs(Math.log(f[2] / r)) < Math.abs(Math.log(best[2] / r))) best = f;
  return Math.abs(Math.log(best[2] / r)) < 0.06 ? best[1] : `${(r >= 1 ? r : 1 / r).toFixed(2)}:1`;
}
function frameChips(id, sel) {
  return `<div class="frames" id="${id}">${FRAMES.map(([k, l, r]) => `<button type="button" data-f="${k}" class="${k === sel ? "on" : ""}">${FRAME_ICON(r)}${l}</button>`).join("")}</div>`;
}
// ছবি ক্রপ: ফ্রেম বেছে নিন, ছবি টেনে সরান; আউটপুট JPEG blob
function photoFramer(box, img, fixedRatio = 0) {
  const st = { ratio: fixedRatio, x: 0.5, y: 0.5 };
  const nat = img.naturalWidth / img.naturalHeight;
  const view = box.querySelector(".crop-view"), pic = view.querySelector("img");
  const layout = () => {
    const r = st.ratio || nat;
    const W = Math.min(box.clientWidth, window.innerHeight * 0.55 * r), H = W / r;
    view.style.width = W + "px"; view.style.height = H + "px";
    const s = Math.max(W / img.naturalWidth, H / img.naturalHeight);
    const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
    pic.style.width = dw + "px"; pic.style.height = dh + "px";
    pic.style.left = -(dw - W) * st.x + "px"; pic.style.top = -(dh - H) * st.y + "px";
    const info = box.querySelector(".crop-info"), fr = FRAMES.find((f) => f[2] === st.ratio);
    if (info) info.textContent = `📐 ${st.ratio ? (fr ? fr[1] : "") : "মূল সাইজ " + nearestFrame(img.naturalWidth, img.naturalHeight)} · ${img.naturalWidth}×${img.naturalHeight}${st.ratio ? " · টেনে জায়গা ঠিক করুন" : ""}`;
    view.classList.toggle("movable", !!st.ratio);
  };
  const frEl = box.querySelector(".frames");
  if (frEl) frEl.onclick = (e) => {
    const b = e.target.closest("button[data-f]"); if (!b) return;
    box.querySelectorAll(".frames button").forEach((x) => x.classList.toggle("on", x === b));
    st.ratio = FRAMES.find((f) => f[0] === b.dataset.f)[2]; st.x = st.y = 0.5; layout();
  };
  let drag = null;
  view.onpointerdown = (e) => { if (!st.ratio) return; drag = { x: e.clientX, y: e.clientY, sx: st.x, sy: st.y }; view.setPointerCapture(e.pointerId); };
  view.onpointermove = (e) => {
    if (!drag) return;
    const ex = pic.offsetWidth - view.clientWidth, ey = pic.offsetHeight - view.clientHeight;
    st.x = ex > 0 ? Math.min(1, Math.max(0, drag.sx - (e.clientX - drag.x) / ex)) : 0.5;
    st.y = ey > 0 ? Math.min(1, Math.max(0, drag.sy - (e.clientY - drag.y) / ey)) : 0.5;
    layout();
  };
  view.onpointerup = view.onpointercancel = () => (drag = null);
  layout();
  window.addEventListener("resize", layout, { once: true });
  return async (maxSide = 1440, filterCss = "") => {
    const r = st.ratio || nat;
    let sw = img.naturalWidth, sh = img.naturalHeight;
    if (st.ratio) { if (sw / sh > r) sw = sh * r; else sh = sw / r; }
    const sx = (img.naturalWidth - sw) * st.x, sy = (img.naturalHeight - sh) * st.y;
    const k = Math.min(1, maxSide / Math.max(sw, sh));
    const c = document.createElement("canvas"); c.width = Math.round(sw * k); c.height = Math.round(sh * k);
    const cx = c.getContext("2d");
    if (filterCss) cx.filter = filterCss;
    cx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return await new Promise((res) => c.toBlob(res, "image/jpeg", 0.86));
  };
}

R.newphoto = (contestId) => {
  screen.innerHTML = `<div class="page">${header(contestId ? "🏆 কম্পিটিশনে ছবি দিন" : "🖼️ ফটো আপলোড")}
    <label class="pick"><input type="file" id="pf" accept="image/*" class="hidden"><div class="ic">📷</div><b>ক্যামেরা বা গ্যালারি থেকে ছবি বেছে নিন</b></label>
    <div id="crop" class="crop hidden"><div class="crop-view"><img alt=""></div><div class="crop-info tiny muted"></div>${frameChips("frs", "orig")}</div>
    <div id="mtools" class="hidden"></div>
    <label class="lbl">ক্যাপশন</label><textarea id="pcap" maxlength="500" placeholder="ছবি সম্পর্কে লিখুন…"></textarea>
    <button class="btn primary" id="pup" disabled>আপলোড করুন</button>
    <div class="progress hidden" id="pg"><div></div></div>
    <p class="muted tiny">লাইক, কমেন্ট, শেয়ার ও গিফট থেকে আয় হবে। অশ্লীল বা অন্যের ছবি দিলে পোস্ট মুছে যাবে এবং অ্যাকাউন্ট জেলে যেতে পারে।</p></div>`;
  attachSuggest($("#pcap"));
  let render = null, mt = null;
  $("#pf").onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const img = new Image(); img.src = URL.createObjectURL(f);
    try { await img.decode(); } catch { return toast("ছবিটি খোলা যায়নি", true); }
    $("#crop").classList.remove("hidden");
    const pk = $("#pf").closest(".pick"); pk.classList.add("pick-sm"); pk.querySelector("b").textContent = "📷 অন্য ছবি বেছে নিন";
    $("#crop .crop-view img").src = img.src;
    render = photoFramer($("#crop"), img);
    $("#mtools").classList.remove("hidden");
    mt = mediaTools($("#mtools"), $("#crop .crop-view img"), { kind: "photo", st: mt ?? {} });
    $("#pup").disabled = false;
  };
  $("#pup").onclick = async (e) => {
    if (!render) return;
    e.target.disabled = true; $("#pg").classList.remove("hidden");
    try {
      const blob = await render(1440, mt ? fxCss(mt.fx) : "");
      const path = `${S.me.id}/${Date.now()}.jpg`;
      await xhrUpload("photos", path, blob, "image/jpeg", (x) => ($("#pg").firstElementChild.style.width = Math.round(x * 100) + "%"));
      const url = sb.storage.from("photos").getPublicUrl(path).data.publicUrl;
      const id = await rpc("create_post", { p_kind: "photo", p_body: $("#pcap").value, p_image_path: path, p_image_url: url, p_category: null, p_bg: null, p_contest: contestId ? Number(contestId) : null });
      if (mt?.music) await rpc("set_media_extras", { p_kind: "post", p_id: id, p_music: mt.music.id, p_start: mt.start, p_fx: null, p_mute: false }).catch(() => {});
      toast("✅ ছবি পোস্ট হয়েছে");
      location.replace(contestId ? "#contest/" + contestId : "#post/" + id);
    } catch (er) { toast(errMsg(er), true); e.target.disabled = false; }
  };
};

R.contest = async (id) => {
  screen.innerHTML = `<div class="page"><div class="spinner"></div></div>`;
  const list = await rpc("contests_list").catch(() => []);
  const c = list.find((x) => x.id === Number(id));
  if (!c) { screen.innerHTML = `<div class="page">${header("কম্পিটিশন")}<div class="empty">কম্পিটিশন পাওয়া যায়নি</div></div>`; return; }
  const rows = await rpc("feed_posts", { p_kind: "photo", p_before: null, p_limit: 50, p_category: null, p_contest: c.id, p_user: null, p_sort: "top" }).catch(() => []);
  screen.innerHTML = `<div class="page">${header("🏆 কম্পিটিশন")}
    <div class="contest-hero">${c.cover_url ? `<img src="${esc(c.cover_url)}" alt="">` : ""}<div>
      <h2 translate="no">${esc(c.title)}</h2>
      ${c.prize_paisa > 0 ? `<div class="prize">🎁 পুরস্কার ${tk(c.prize_paisa)}</div>` : ""}
      <div class="tiny">${c.is_open ? `⏳ শেষ হবে ${dt(c.ends_at)}` : "✅ শেষ হয়েছে"} · ${n(c.entries)} জন অংশ নিয়েছে</div>
      ${c.description ? `<p class="tiny" translate="no">${esc(c.description)}</p>` : ""}
      ${c.is_open && !c.joined ? `<a class="btn" href="#newphoto/${c.id}" style="background:#fff;color:#5b2bd0;border:0;margin-top:6px">📷 অংশ নিন</a>` : c.joined ? `<div class="tiny">✅ আপনি অংশ নিয়েছেন — বেশি লাইক পেলে জিতবেন</div>` : ""}</div></div>
    <p class="tiny muted">সবচেয়ে বেশি লাইক পাওয়া ছবি উপরে দেখাচ্ছে। লাইক, কমেন্ট, শেয়ার ও গিফটেও আয় হবে।</p>
    <div class="disc-grid" style="padding:0"><div class="disc-col" id="c0"></div><div class="disc-col" id="c1"></div></div>
    ${rows.length ? "" : `<div class="empty">এখনো কেউ অংশ নেয়নি</div>`}</div>`;
  rows.forEach((v, i) => {
    const col = $("#c0").offsetHeight <= $("#c1").offsetHeight ? $("#c0") : $("#c1");
    col.insertAdjacentHTML("beforeend", postCard(v, i).replace('<div class="ph">', `<div class="ph"><span class="rankb">${c.winner_post_id === v.id ? "👑 বিজয়ী" : "#" + (i + 1)}</span>`));
  });
};

// ---------------- PROFILE ----------------
const COUNTRY_NAMES = { BD: "বাংলাদেশ", SA: "সৌদি আরব", AE: "দুবাই/আমিরাত", QA: "কাতার", KW: "কুয়েত", OM: "ওমান", BH: "বাহরাইন", MY: "মালয়েশিয়া",
  SG: "সিঙ্গাপুর", MV: "মালদ্বীপ", IN: "ভারত", IT: "ইতালি", GB: "যুক্তরাজ্য", US: "যুক্তরাষ্ট্র", JO: "জর্ডান", LB: "লেবানন", IQ: "ইরাক", LY: "লিবিয়া",
  FR: "ফ্রান্স", ES: "স্পেন", PT: "পর্তুগাল", GR: "গ্রিস", DE: "জার্মানি", RO: "রোমানিয়া", CA: "কানাডা", AU: "অস্ট্রেলিয়া", JP: "জাপান", KR: "দক্ষিণ কোরিয়া" };
const flagOf = (cc) => (cc && cc.length === 2 ? String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 127397 + c.charCodeAt(0))) : "🌐");


// ---------------- ক্রিয়েটর ড্যাশবোর্ড ----------------
R.creator = async (days = "30") => {
  days = ["7", "30", "90"].includes(days) ? days : "30";
  screen.innerHTML = `<div class="page">${header("📊 ক্রিয়েটর ড্যাশবোর্ড")}<div class="spinner"></div></div>`;
  let d;
  try { d = await rpc("creator_stats", { p_days: Number(days) }); }
  catch (e) { screen.innerHTML = `<div class="page">${header("📊 ক্রিয়েটর ড্যাশবোর্ড")}<div class="empty">${esc(errMsg(e))}</div></div>`; return; }
  const t = d.totals, e = d.earned;
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const gTot = d.gender.reduce((a, g) => a + Number(g.views), 0);
  const G = { male: ["👨 ছেলে", "#60a5fa"], female: ["👩 মেয়ে", "#f472b6"], other: ["অন্যান্য", "#a78bfa"], unknown: ["জানা নেই", "#cbd5e1"] };
  const maxDay = Math.max(1, ...d.daily.map((x) => Number(x.views)));
  const eRows = [["🎬 ভিউ", e.views], ["❤️ লাইক", e.likes], ["💬 কমেন্ট", e.comments], ["🎁 গিফট ও প্রিমিয়াম", e.gifts], ["🖼️ ফটো/লেখা", e.posts], ["👥 রেফার", e.referral]];
  const eMax = Math.max(1, ...eRows.map((r) => Number(r[1])));
  const tile = (ic, label, val) => `<div class="kp"><span>${ic}</span><b>${val}</b><small>${label}</small></div>`;
  screen.innerHTML = `<div class="page cdash">${header("📊 ক্রিয়েটর ড্যাশবোর্ড")}
    <div class="seg" style="margin-top:0">${["7", "30", "90"].map((x) => `<button class="${x === days ? "on" : ""}" onclick="location.hash='#creator/${x}'">${x} দিন</button>`).join("")}</div>
    <div class="card earn-card"><div class="tiny">এই ${days} দিনে আপনার আয়</div><b>${tk(e.total)}</b>
      ${eRows.filter((r) => Number(r[1]) > 0).map(([l, v]) => `<div class="ebar"><span>${l}</span><div><i style="width:${pct(v, eMax)}%"></i></div><em>${tk(v)}</em></div>`).join("") || `<div class="tiny" style="opacity:.85">এখনো আয় নেই — ভিডিও দিন, ভিউ বাড়লে আয় শুরু হবে</div>`}</div>
    <div class="kpis">
      ${tile("👁", "মোট ভিউ", n(t.views))}${tile("📈", `${days} দিনে ভিউ`, n(d.period_views))}${tile("❤️", "লাইক", n(t.likes))}${tile("💬", "কমেন্ট", n(t.comments))}
      ${tile("↗️", "শেয়ার", n(t.shares))}${tile("⬇️", "ডাউনলোড", n(t.downloads))}${tile("👥", "ফলোয়ার", n(d.followers))}${tile("🎁", "গিফট কয়েন", n(t.gift_coins))}
    </div>
    <div class="card"><b>📅 প্রতিদিনের ভিউ</b>
      <div class="dbars">${d.daily.map((x) => `<div title="${x.views}"><i style="height:${Math.max(3, pct(x.views, maxDay))}%"></i><span>${new Date(x.day).getDate()}</span></div>`).join("")}</div></div>
    <div class="card"><b>🧑‍🤝‍🧑 কারা বেশি দেখছে</b>
      ${gTot ? `<div class="gbar">${d.gender.map((g) => `<i style="width:${pct(g.views, gTot)}%;background:${(G[g.gender] ?? G.unknown)[1]}"></i>`).join("")}</div>
        <div class="glegend">${d.gender.map((g) => `<span><i style="background:${(G[g.gender] ?? G.unknown)[1]}"></i>${(G[g.gender] ?? G.unknown)[0]} ${pct(g.views, gTot)}%</span>`).join("")}</div>
        <p class="tiny muted" style="margin:6px 0 0">ইউজাররা প্রোফাইলে লিঙ্গ দিলে এই হিসাব আরও সঠিক হবে।</p>` : `<div class="tiny muted">এখনো ডেটা নেই</div>`}
      ${d.countries.length ? `<div class="list tiny" style="margin-top:8px">${d.countries.map((c) => `<div class="li"><span>${flagOf(c.country_code)} ${COUNTRY_NAMES[c.country_code] ?? (c.country_code === "??" ? "জানা নেই" : c.country_code)}</span><b>${n(c.views)} ভিউ</b></div>`).join("")}</div>` : ""}</div>
    <div class="row" style="margin:14px 2px 6px"><b>🎬 প্রতিটি ভিডিওর হিসাব</b>
      <select id="vsort" style="width:auto;padding:5px 8px;font-size:12.5px"><option value="earn_paisa">আয় বেশি</option><option value="views">ভিউ বেশি</option><option value="likes">লাইক বেশি</option><option value="comments">কমেন্ট বেশি</option><option value="downloads">ডাউনলোড বেশি</option></select></div>
    <div id="vlist"></div>
    <p class="tiny muted">ভিডিওর আয় = ভিউয়ের আনুমানিক আয় (দৈনিক সীমার আগে) + লাইক, কমেন্ট, গিফট ও প্রিমিয়াম আনলকের আসল আয়।</p></div>`;
  const draw = (key) => {
    const vs = [...d.videos].sort((a, b) => Number(b[key]) - Number(a[key]));
    $("#vlist").innerHTML = vs.length ? vs.map((v, i) => {
      const gs = Number(v.male) + Number(v.female);
      return `<a class="vrow card" href="#watch/${S.me.id}/${v.id}">
        <div class="vth">${v.thumb_url ? `<img src="${esc(v.thumb_url)}" loading="lazy" alt="">` : "▶"}${i < 3 && Number(v[key]) > 0 ? `<em>#${i + 1}</em>` : ""}</div>
        <div class="vinfo"><div class="ell" translate="no">${esc(v.caption || "ক্যাপশন নেই")}${v.is_premium ? " 👑" : ""}</div>
          <div class="vstats"><span>👁 ${n(v.views)}</span><span>❤️ ${n(v.likes)}</span><span>💬 ${n(v.comments)}</span><span>↗️ ${n(v.shares)}</span><span>⬇️ ${n(v.downloads)}</span></div>
          <div class="tiny muted">${days} দিনে ${n(v.period_views)} ভিউ${gs ? ` · 👨 ${pct(v.male, gs)}% · 👩 ${pct(v.female, gs)}%` : ""}</div></div>
        <div class="vearn"><b>${tk(v.earn_paisa)}</b><small>আয়</small></div></a>`;
    }).join("") : `<div class="empty">এখনো কোনো প্রকাশিত ভিডিও নেই — ＋ চেপে প্রথম ভিডিও দিন</div>`;
  };
  $("#vsort").onchange = (ev) => draw(ev.target.value);
  draw("earn_paisa");
};

// ---------------- ভিডিও ডাউনলোড (ওয়াটারমার্কসহ, APK ≥ 1.0.8) ----------------
async function downloadVideo(v) {
  if (!Native?.downloadVideo) return toast("ডাউনলোড করতে নতুন অ্যাপ (APK) ইনস্টল করুন", true);
  if (v.is_premium && v.user_id !== S.me.id && !v._dlPaid) {
    if (v.locked) return toast("আগে ভিডিওটি আনলক করুন, তারপর ডাউনলোড করুন", true);
    const fee = Number(setting("premium_download_coins", 0));
    const owned = await sb.from("premium_downloads").select("video_id").eq("user_id", S.me.id).eq("video_id", v.id).maybeSingle().then((r) => !!r.data).catch(() => false);
    if (!owned && !confirm(`👑 প্রিমিয়াম ভিডিও ডাউনলোড করতে 🪙 ${n(fee)} কয়েন লাগবে। ডাউনলোড করবেন?`)) return;
    try {
      const r = await rpc("premium_download", { p_video: v.id });
      v.video_url = r.video_url; v._dlPaid = true;
      if (r.charged) toast(`🪙 ${n(r.charged)} কয়েন কাটা হয়েছে`);
    } catch (er) {
      toast(errMsg(er), true);
      if (String(er.message).includes("INSUFFICIENT_COINS")) setTimeout(() => (location.hash = "#cashin"), 900);
      return;
    }
  }
  if (!v.video_url) return;
  let bar = $("#dlbar");
  if (!bar) {
    bar = document.createElement("div"); bar.id = "dlbar"; bar.className = "dlbar";
    bar.innerHTML = `<span class="t"></span><div class="progress"><div></div></div>`;
    document.body.appendChild(bar);
  }
  const show = (txt, p) => { bar.classList.add("show"); bar.querySelector(".t").textContent = txt; bar.querySelector(".progress div").style.width = (p ?? 0) + "%"; };
  window.onDownloadState = (st) => {
    if (st.state === "downloading") show(`⬇️ ডাউনলোড হচ্ছে… ${st.p}%`, st.p / 2);
    else if (st.state === "processing") show(`🎬 ওয়াটারমার্ক বসানো হচ্ছে… ${st.p}%`, 50 + st.p / 2);
    else if (st.state === "busy") toast("আগের ডাউনলোড শেষ হতে দিন", true);
    else {
      bar.classList.remove("show");
      if (st.state === "done") { toast("✅ গ্যালারিতে সেভ হয়েছে (Movies/ReelsEnjoy)"); rpc("record_download", { p_video: v.id }).catch(() => {}); }
      else toast(st.msg === "permission" ? "স্টোরেজ অনুমতি দিন, তারপর আবার চেষ্টা করুন" : "ডাউনলোড হয়নি — ইন্টারনেট দেখে আবার চেষ্টা করুন", true);
    }
  };
  show("⬇️ ডাউনলোড শুরু হচ্ছে…", 0);
  Native.downloadVideo(v.video_url, String(setting("watermark_text", "Reels Enjoy") || "Reels Enjoy"), v.username || "", "");
}

// ---------------- 📖 স্টোরি ----------------
// হোম পেজের স্টোরি সারি
async function storyRow(box) {
  if (!box || setting("stories_enabled", true) === false) return;
  const rows = await rpc("story_feed", { p_limit: 40 }).catch(() => []);
  S.storyQueue = rows.map((r) => r.user_id);
  const mine = rows.find((r) => r.is_me);
  box.innerHTML = `<a class="st-it me" href="${mine ? `#story/${S.me.id}` : "#newstory"}"><span class="st-ring ${mine ? (mine.unseen ? "new" : "seen") : "none"}">${avatar(S.me)}</span>
      <b class="st-plus" onclick="event.preventDefault();event.stopPropagation();location.hash='#newstory'">＋</b><small>আপনার স্টোরি</small></a>
    ${rows.filter((r) => !r.is_me).map((r) => `<a class="st-it" href="#story/${r.user_id}"><span class="st-ring ${r.unseen ? "new" : "seen"} ${r.account_type === "host" ? "host" : ""}">${avatar(r)}</span><small translate="no">${esc(r.full_name || r.username)}</small></a>`).join("")}`;
  box.classList.remove("hidden");
}

// স্টোরি দেখা: #story/<userId>
R.story = async (uid) => {
  screen.classList.add("full");
  screen.innerHTML = `<div class="stv"><div class="spinner" style="margin-top:40vh"></div></div>`;
  try { Native?.setDarkBars?.(true); } catch { /* */ }
  document.body.classList.add("story-open");
  cleanup = () => document.body.classList.remove("story-open");
  const [list, { data: p }] = await Promise.all([rpc("user_stories", { p_user: uid }).catch(() => []), sb.from("profiles").select("id,username,full_name,avatar_url,account_type").eq("id", uid).maybeSingle()]);
  if (!list.length || !p) { toast("কোনো স্টোরি নেই", true); history.back(); return; }
  const mine = uid === S.me.id;
  let i = Math.max(0, list.findIndex((x) => !x.seen)); if (mine) i = 0;
  let timer = null, startT = 0, dur = 5000, elapsed = 0, paused = false, gone = false;
  screen.innerHTML = `<div class="stv">
    <div class="stv-bars">${list.map(() => `<i><b></b></i>`).join("")}</div>
    <div class="stv-head"><a href="#u/${p.id}">${avatar(p)}<span><b translate="no">${esc(p.full_name || p.username)}</b>${p.account_type === "host" ? " 👑" : ""}<small id="stAgo"></small></span></a>
      <button class="stv-x" id="stX">✕</button></div>
    <div class="stv-media" id="stM"></div>
    <div class="stv-mus hidden" id="stMu"></div>
    <div class="stv-tap l" id="tapL"></div><div class="stv-tap r" id="tapR"></div>
    <div class="stv-foot">${mine ? `<button class="stv-btn" id="stEye">👁 <span id="stVc">0</span></button><button class="stv-btn" id="stDel">🗑️ মুছুন</button><a class="stv-btn" href="#newstory">＋ নতুন</a>`
      : `<form id="stRf"><input id="stR" placeholder="উত্তর দিন…" maxlength="300" autocomplete="off"><button type="button" class="stv-heart" id="stH">❤️</button><button class="stv-send">➤</button></form>`}</div></div>`;
  const bars = [...screen.querySelectorAll(".stv-bars b")];
  const media = $("#stM");
  const stop = () => { clearInterval(timer); timer = null; const v = media.querySelector("video"); v?.pause(); BGM.pause(); };
  const close = () => { if (gone) return; gone = true; stop(); bgmStop(); history.back(); };
  const nextUser = () => {
    const q = S.storyQueue ?? []; const k = q.indexOf(uid);
    const nx = k >= 0 ? q[k + 1] : null;
    if (nx) { gone = true; stop(); location.replace(`#story/${nx}`); } else close();
  };
  const tick = () => {
    if (paused) return;
    elapsed = Date.now() - startT;
    const v = media.querySelector("video");
    const pr = v && v.duration ? v.currentTime / Math.min(v.duration, Number(setting("story_max_sec", 60))) : elapsed / dur;
    bars[i].style.width = Math.min(100, pr * 100) + "%";
    if (pr >= 1) go(1);
  };
  const show = () => {
    stop();
    const x = list[i];
    bars.forEach((b, k) => (b.style.width = k < i ? "100%" : "0%"));
    $("#stAgo").textContent = " · " + ago(x.created_at);
    const flt = x.fx ? `filter:${fxCss(x.fx)}` : "";
    media.innerHTML = x.kind === "text" ? `<div class="stv-text" style="background:${BGS[x.bg] ?? BGS.g1}" translate="no"><div>${rich(x.body)}</div></div>`
      : x.kind === "photo" ? `<img src="${esc(x.media_url)}" alt="" style="${flt}">`
      : `<video src="${esc(x.media_url)}" playsinline webkit-playsinline ${x.thumb_url ? `poster="${esc(x.thumb_url)}"` : ""} style="${flt}"></video>${x.body ? `<div class="stv-cap" translate="no">${rich(x.body)}</div>` : ""}`;
    $("#stMu").classList.toggle("hidden", !x.music_url);
    if (x.music_url) $("#stMu").innerHTML = `<span class="disc">🎵</span><span class="mq" translate="no">${esc(x.music_title)}${x.music_artist ? " · " + esc(x.music_artist) : ""}</span>`;
    if (mine) $("#stVc").textContent = n(x.views_count ?? 0);
    else if (!x.seen) { x.seen = true; rpc("view_story", { p_id: x.id }).catch(() => {}); }
    dur = x.kind === "text" ? Math.min(12000, 4000 + (x.body?.length ?? 0) * 60) : 6000;
    S.muted = false;
    const v = media.querySelector("video");
    if (v) {
      v.muted = !!x.music_url;
      v.play().catch(() => { v.muted = true; v.play().catch(() => {}); });
      v.onended = () => go(1);
    }
    if (x.music_url) bgmPlay(x.music_url, x.music_start || 0); else bgmStop();
    startT = Date.now(); elapsed = 0;
    timer = setInterval(tick, 80);
  };
  const go = (d) => {
    i += d;
    if (i < 0) { i = 0; return show(); }
    if (i >= list.length) return mine ? close() : nextUser();
    show();
  };
  const pause = (on) => {
    paused = on; const v = media.querySelector("video");
    if (on) { v?.pause(); BGM.pause(); } else { startT = Date.now() - elapsed; v?.play().catch(() => {}); if (list[i].music_url) bgmPlay(list[i].music_url, list[i].music_start || 0); }
  };
  let holdT = null, held = false;
  ["tapL", "tapR"].forEach((idn) => {
    const el = $("#" + idn);
    el.onpointerdown = () => { held = false; holdT = setTimeout(() => { held = true; pause(true); }, 220); };
    el.onpointerup = () => { clearTimeout(holdT); if (held) { pause(false); return; } go(idn === "tapL" ? -1 : 1); };
    el.onpointercancel = () => { clearTimeout(holdT); if (held) pause(false); };
  });
  $("#stX").onclick = close;
  $("#stR")?.addEventListener("focus", () => pause(true));
  $("#stR")?.addEventListener("blur", () => pause(false));
  const reply = async (text) => {
    try { await rpc("send_message", { p_to: uid, p_body: `📖 স্টোরির উত্তর: ${text}` }); toast("✅ পাঠানো হয়েছে"); }
    catch (er) { toast(errMsg(er), true); }
  };
  $("#stRf")?.addEventListener("submit", (e) => { e.preventDefault(); const t = $("#stR").value.trim(); if (!t) return; $("#stR").value = ""; $("#stR").blur(); reply(t); });
  $("#stH")?.addEventListener("click", () => { reply("❤️"); const h = document.createElement("div"); h.className = "big-heart"; h.textContent = "❤️"; screen.querySelector(".stv").appendChild(h); setTimeout(() => h.remove(), 900); });
  $("#stDel")?.addEventListener("click", async () => {
    pause(true);
    if (!confirm("এই স্টোরি মুছবেন?")) return pause(false);
    try { await rpc("delete_story", { p_id: list[i].id }); list.splice(i, 1); toast("মুছে ফেলা হয়েছে"); if (!list.length) return close(); i = Math.min(i, list.length - 1); screen.querySelectorAll(".stv-bars i")[0]?.remove(); bars.splice(0, 1); show(); }
    catch (er) { toast(errMsg(er), true); pause(false); }
  });
  $("#stEye")?.addEventListener("click", async () => {
    pause(true);
    const rows = await rpc("story_viewers", { p_id: list[i].id }).catch(() => []);
    const b = sheet(`<h3>👁 যারা দেখেছে (${n(rows.length)})</h3><div class="list">${rows.length ? rows.map((r) => `<a class="li" href="#u/${r.user_id}" style="display:flex;gap:10px;align-items:center">${avatar(r)}<span style="flex:1"><b translate="no">${esc(r.full_name || r.username)}</b><div class="tiny muted">${ago(r.viewed_at)}</div></span></a>`).join("") : `<div class="empty">এখনো কেউ দেখেনি</div>`}</div>`);
    void b;
    const ob = new MutationObserver(() => { if ($("#sheet").classList.contains("hidden")) { ob.disconnect(); if (!gone && location.hash.startsWith("#story/")) pause(false); } });
    ob.observe($("#sheet"), { attributes: true, attributeFilter: ["class"] });
  });
  const onVis = () => { if (document.hidden) pause(true); };
  document.addEventListener("visibilitychange", onVis);
  cleanup = () => { gone = true; stop(); document.body.classList.remove("story-open"); document.removeEventListener("visibilitychange", onVis); try { Native?.setDarkBars?.(false); } catch { /* */ } };
  show();
};

// নতুন স্টোরি: #newstory
R.newstory = () => {
  if (setting("stories_enabled", true) === false) { screen.innerHTML = `<div class="page">${header("📖 স্টোরি")}<div class="empty">স্টোরি এখন বন্ধ আছে</div></div>`; return; }
  const maxSec = Number(setting("story_max_sec", 60));
  screen.innerHTML = `<div class="page">${header("📖 নতুন স্টোরি")}
    <div class="seg" style="margin-top:0"><button class="on" data-k="media">📷 ছবি / 🎬 ভিডিও</button><button data-k="text">✍️ লেখা</button></div>
    <label class="pick" id="sPick"><input type="file" id="sf" accept="image/*,video/*" class="hidden"><div class="ic">📷</div><b>ক্যামেরা বা গ্যালারি থেকে বেছে নিন</b>
      <div class="muted tiny">ছবি বা ${maxSec} সেকেন্ড পর্যন্ত ভিডিও · ২৪ ঘণ্টা পর নিজে থেকে মুছে যাবে</div></label>
    <div class="st-prev hidden" id="sPrev"><div class="st-stage" id="sStage"></div></div>
    <div id="sTextBox" class="hidden"><div class="st-prev"><div class="st-stage"><div class="stv-text" id="sTP" style="background:${BGS.g1}"><textarea id="sTT" maxlength="300" placeholder="কিছু লিখুন…"></textarea></div></div></div>
      <div class="bgs" id="sBgs">${Object.entries(BGS).map(([k, v]) => `<button data-bg="${k}" style="background:${v}" class="${k === "g1" ? "on" : ""}"></button>`).join("")}</div></div>
    <div id="sCapW" class="hidden"><label class="lbl">স্টোরিতে লেখা (ঐচ্ছিক)</label><input id="sCap" maxlength="120" placeholder="ছবির উপর লেখা দেখাবে…"></div>
    <div id="mtools" class="hidden"></div>
    <button class="btn primary" id="sUp" disabled>📖 স্টোরি দিন</button>
    <div class="progress hidden" id="pg"><div></div></div>
    <p class="muted tiny">অশ্লীল বা অন্যের কপিরাইট করা কিছু দিলে অ্যাকাউন্ট জেলে যেতে পারে।</p></div>`;
  let mode = "media", file = null, kind = null, duration = 0, img = null, bg = "g1", mt = null;
  const prevBox = $("#sStage");
  const setMode = (m) => {
    mode = m;
    screen.querySelectorAll(".seg [data-k]").forEach((b) => b.classList.toggle("on", b.dataset.k === m));
    $("#sPick").classList.toggle("hidden", m !== "media"); $("#sPrev").classList.toggle("hidden", m !== "media" || !file);
    $("#sCapW").classList.toggle("hidden", m !== "media" || !file); $("#sTextBox").classList.toggle("hidden", m !== "text");
    $("#mtools").classList.toggle("hidden", m === "media" && !file);
    if (m === "text") { if (!mt) mt = mediaTools($("#mtools"), $("#sTP"), { kind: "story" }); $("#mtools").querySelector(".lbl")?.classList.add("hidden"); $("#mtF")?.classList.add("hidden"); $("#mtools .fx-adj")?.classList.add("hidden"); }
    $("#sUp").disabled = m === "media" ? !file : !$("#sTT").value.trim();
  };
  screen.querySelectorAll(".seg [data-k]").forEach((b) => (b.onclick = () => setMode(b.dataset.k)));
  $("#sTT").oninput = () => { $("#sUp").disabled = !$("#sTT").value.trim(); };
  attachSuggest($("#sTT")); attachSuggest($("#sCap"));
  $("#sBgs").onclick = (e) => { const b = e.target.closest("[data-bg]"); if (!b) return; bg = b.dataset.bg; $("#sTP").style.background = BGS[bg]; $("#sBgs").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); };
  $("#sCap").oninput = () => { const c = prevBox.querySelector(".stv-cap"); if (c) c.textContent = $("#sCap").value; };
  $("#sf").onchange = async () => {
    const f = $("#sf").files[0]; if (!f) return;
    file = null; img = null;
    const isV = (f.type || "").startsWith("video");
    if (isV && f.size > 50 * 1048576) return toast(`ফাইল ${(f.size / 1048576).toFixed(0)}MB — সর্বোচ্চ 50MB`, true);
    const url = URL.createObjectURL(f);
    if (isV) {
      prevBox.innerHTML = `<video src="${url}" playsinline loop controls></video><div class="stv-cap"></div>`;
      const v = prevBox.querySelector("video");
      await new Promise((r) => { v.onloadedmetadata = r; setTimeout(r, 4000); });
      duration = Math.round(v.duration || 0);
      if (duration > maxSec + 1) { toast(`ভিডিও ${duration} সেকেন্ড — স্টোরিতে সর্বোচ্চ ${maxSec} সেকেন্ড`, true); prevBox.innerHTML = ""; return; }
      kind = "video";
    } else {
      img = new Image(); img.src = url;
      try { await img.decode(); } catch { return toast("ছবিটি খোলা যায়নি", true); }
      prevBox.innerHTML = `<img src="${url}" alt=""><div class="stv-cap"></div>`;
      kind = "photo";
    }
    file = f;
    $("#sPick").classList.add("pick-sm"); $("#sPick b").textContent = "📷 অন্য ছবি/ভিডিও বেছে নিন";
    $("#mtools").classList.remove("hidden");
    mt = mediaTools($("#mtools"), prevBox.querySelector("img,video"), { kind: kind === "video" ? "video" : "photo", st: mt ?? {} });
    prevBox.querySelector(".stv-cap").textContent = $("#sCap").value;
    setMode("media");
  };
  $("#sUp").onclick = async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    const pg = $("#pg"); pg.classList.remove("hidden");
    const setP = (x) => (pg.firstElementChild.style.width = Math.round(x * 100) + "%");
    try {
      const stamp = Date.now(), fx = mt && !fxEmpty(mt.fx) ? mt.fx : null;
      let args = { p_kind: "text", p_media_url: null, p_media_path: null, p_thumb_url: null, p_body: null, p_bg: null, p_music: mt?.music?.id ?? null, p_music_start: mt?.start ?? 0, p_fx: null, p_duration: null };
      if (mode === "text") { args.p_body = $("#sTT").value.trim(); args.p_bg = bg; }
      else if (kind === "photo") {
        const k = Math.min(1, 1440 / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        const cx = c.getContext("2d"); if (fx) cx.filter = fxCss(fx); cx.drawImage(img, 0, 0, c.width, c.height); cx.filter = "none";
        const cap = $("#sCap").value.trim();
        if (cap) {
          const fs = Math.round(c.width / 16); cx.font = `700 ${fs}px sans-serif`; cx.textAlign = "center";
          const y = c.height * 0.82, w = Math.min(c.width * 0.9, cx.measureText(cap).width + fs);
          cx.fillStyle = "rgba(0,0,0,.45)"; cx.fillRect((c.width - w) / 2, y - fs * 1.1, w, fs * 1.5);
          cx.fillStyle = "#fff"; cx.fillText(cap, c.width / 2, y, c.width * 0.88);
        }
        const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.86));
        const path = `${S.me.id}/stories/${stamp}.jpg`;
        await xhrUpload("photos", path, blob, "image/jpeg", setP);
        Object.assign(args, { p_kind: "photo", p_media_path: path, p_media_url: sb.storage.from("photos").getPublicUrl(path).data.publicUrl });
      } else {
        const v = prevBox.querySelector("video");
        const thumb = await makeThumb(v);
        const ext = ((file.name || "").split(".").pop() || "mp4").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp4";
        const path = `${S.me.id}/stories/${stamp}.${ext}`;
        await xhrUpload("videos", path, file, file.type || "video/mp4", (x) => setP(x * 0.95));
        let tUrl = null;
        if (thumb) { const tp = `${S.me.id}/stories/${stamp}.jpg`; await xhrUpload("thumbs", tp, thumb, "image/jpeg", () => {}); tUrl = sb.storage.from("thumbs").getPublicUrl(tp).data.publicUrl; }
        Object.assign(args, { p_kind: "video", p_media_path: path, p_media_url: sb.storage.from("videos").getPublicUrl(path).data.publicUrl, p_thumb_url: tUrl,
          p_body: $("#sCap").value.trim() || null, p_fx: fx, p_duration: duration });
      }
      await rpc("create_story", args);
      setP(1); bgmStop(); toast("✅ স্টোরি দেওয়া হয়েছে");
      location.replace(`#story/${S.me.id}`);
    } catch (er) { toast(errMsg(er), true); btn.disabled = false; }
  };
  setMode("media");
};

// ---------------- HOME (Discover grid) ----------------
const LANGS = [["Bengali", "বাংলা"], ["English", "English"], ["Hindi", "हिन्दी"], ["Urdu", "اردو"], ["Arabic", "العربية"], ["Nepali", "नेपाली"]];
const langName = (l) => (LANGS.find(([k]) => k === l)?.[1] ?? l ?? "");
const LEVELS = [0, 10, 50, 200, 1000, 5000, 20000];
const levelOf = (f) => { let l = 0; LEVELS.forEach((t, i) => { if (Number(f) >= t) l = i; }); return l; };
const fmtDur = (sec) => { sec = Number(sec || 0); return sec ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}` : ""; };
S.disc = { lang: "", country: "" };
try { Object.assign(S.disc, JSON.parse(localStorage.getItem("disc") || "{}")); } catch { /* */ }

R.home = (tab = "video") => {
  if (!["video", "premium", "photo", "contest"].includes(tab)) tab = "video";
  const f = S.disc;
  const countries = Object.keys(COUNTRY_NAMES);
  screen.innerHTML = `<div class="disc">
    <div class="disc-top">
      <div class="disc-tabs">
        <a href="#home" class="${tab === "video" ? "on" : ""}">ভিডিও</a>
        <a href="#home/premium" class="${tab === "premium" ? "on" : ""}">প্রিমিয়াম</a>
        <a href="#home/photo" class="${tab === "photo" ? "on" : ""}">ফটো</a>
        <a href="#home/contest" class="${tab === "contest" ? "on" : ""}">কম্পিটিশন</a>
        <a href="#top" class="rank" aria-label="র‍্যাংকিং"><svg viewBox="0 0 32 32"><path d="M4 27h24M7 27V17h5v10M13.5 27V7h5v20M20 27V12h5v15" /></svg></a>
      </div>
      <div class="disc-filters ${tab === "video" || tab === "premium" ? "" : "hidden"}">
        <label>🅰️ <span id="flL">${f.lang ? langName(f.lang) : "সব"}</span><select id="fLang"><option value="">সব ভাষা</option>${LANGS.map(([k, l]) => `<option value="${k}" ${k === f.lang ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <label>📍 <span id="flC">${f.country ? flagOf(f.country) + " " + (COUNTRY_NAMES[f.country] ?? f.country) : "সব"}</span><select id="fCountry"><option value="">সব দেশ</option>${countries.map((c) => `<option value="${c}" ${c === f.country ? "selected" : ""}>${flagOf(c)} ${COUNTRY_NAMES[c]}</option>`).join("")}</select></label>
      </div>
    </div>
    ${notice() ? `<div style="padding:0 10px">${notice()}</div>` : ""}
    ${tab === "video" ? `<div class="st-row hidden" id="stRow"></div>` : ""}
    ${tab === "video" || tab === "photo" ? `<div class="trend-row hidden" id="trend"></div>` : ""}
    <div class="disc-grid"><div class="disc-col" id="c0"></div><div class="disc-col" id="c1"></div></div>
    <div id="dmore" style="padding:10px"></div>
    ${tab === "photo" ? `<a class="fab" href="#newphoto">📷 ফটো দিন</a>` : ""}</div>`;
  const save = () => { try { localStorage.setItem("disc", JSON.stringify(S.disc)); } catch { /* */ } };
  $("#fLang").onchange = (e) => { S.disc.lang = e.target.value; save(); R.home(tab); };
  $("#fCountry").onchange = (e) => { S.disc.country = e.target.value; save(); R.home(tab); };
  storyRow($("#stRow"));
  if ($("#trend")) rpc("trending_tags", { p_days: 7, p_limit: 12 }).then((tr) => {
    if (!tr?.length || !$("#trend")) return;
    $("#trend").innerHTML = `<a class="tr-all" href="#tags">🔥 ট্রেন্ডিং</a>${tr.map((t) => `<a href="#tag/${encodeURIComponent(t.tag)}" translate="no">#${esc(t.tag)}</a>`).join("")}`;
    $("#trend").classList.remove("hidden");
  }).catch(() => {});
  const st = { before: null, loading: false, done: false, count: 0 };
  const card = (v, i) => {
    const cc = v.country_code;
    return `<a class="dcard ${i % 4 === 1 || i % 4 === 2 ? "tall" : ""}" href="#play/${v.id}">
      <div class="ph ${v.locked ? "lock" : ""}">${v.thumb_url ? `<img src="${esc(v.thumb_url)}" loading="lazy" alt="">` : `<div class="noimg">▶</div>`}
        ${v.is_premium ? `<span class="prem">👑 ${n(v.premium_coins)}</span>` : ""}
        <div class="tags">${cc ? `<span>${flagOf(cc)} ${esc(cc)}</span>` : ""}<span>${esc(langName(v.language))}</span><span class="lv">✦Lv${v.level ?? 0}</span></div></div>
      ${v.caption ? `<div class="cap" translate="no">${richPlain(v.caption)}</div>` : ""}
      <div class="who">${avatar(v)}<span translate="no">${esc(v.full_name || v.username)}</span></div></a>`;
  };
  async function contests() {
    const list = await rpc("contests_list").catch(() => []);
    $(".disc-grid").outerHTML = `<div style="padding:0 12px">${list.length ? list.map((c) => `<a class="ccard" href="#contest/${c.id}">
      <div class="cimg">${c.cover_url ? `<img src="${esc(c.cover_url)}" alt="">` : "🏆"}</div>
      <div style="flex:1;min-width:0"><b translate="no">${esc(c.title)}</b>
        ${c.prize_paisa > 0 ? `<div class="prize-s">🎁 পুরস্কার ${tk(c.prize_paisa)}</div>` : ""}
        <div class="tiny muted">${c.is_open ? `⏳ শেষ ${dt(c.ends_at)}` : "✅ শেষ হয়েছে"} · ${n(c.entries)} জন</div></div>
      <span class="pill ${c.is_open ? "paid" : ""}">${c.is_open ? (c.joined ? "অংশ নিয়েছেন" : "অংশ নিন") : "ফলাফল"}</span></a>`).join("")
      : `<div class="empty">🏆 এখন কোনো কম্পিটিশন চলছে না।<br>নতুন কম্পিটিশন এলে এখানে দেখা যাবে।</div>`}</div>`;
    $("#dmore").innerHTML = "";
  }
  async function more() {
    if (st.loading || st.done) return;
    st.loading = true;
    $("#dmore").innerHTML = `<div class="spinner"></div>`;
    try {
      if (tab === "contest") { st.done = true; await contests(); return; }
      const rows = tab === "photo"
        ? await rpc("feed_posts", { p_kind: "photo", p_before: st.before, p_limit: 20, p_category: null, p_contest: null, p_user: null, p_sort: "new" })
        : await rpc("feed", { p_type: "foryou", p_before: st.before, p_limit: 20, p_user: null, p_category: tab === "premium" ? "premium" : null, p_lang: S.disc.lang || null, p_country: S.disc.country || null });
      for (const v of rows) {
        const c0 = $("#c0"), c1 = $("#c1");
        if (!c0) return;
        (c0.offsetHeight <= c1.offsetHeight ? c0 : c1).insertAdjacentHTML("beforeend", tab === "photo" ? postCard(v, st.count++) : card(v, st.count++));
      }
      if (rows.length) st.before = rows[rows.length - 1].id;
      if (rows.length < 20) st.done = true;
      $("#dmore").innerHTML = st.done && !st.count ? `<div class="empty">${tab === "photo" ? "এখনো কোনো ছবি নেই — 📷 চেপে প্রথম ছবি দিন" : tab === "premium" ? "👑 এখনো কোনো প্রিমিয়াম ভিডিও নেই।<br>হোস্টরা ＋ চেপে ভিডিও দেওয়ার সময় \"প্রিমিয়াম ভিডিও\" চালু করলে, অ্যাডমিন অনুমোদনের পর এখানে দেখা যাবে।" : "এখনো কোনো ভিডিও নেই"}</div>` : "";
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
    <div class="me-head" ${p.cover_url ? `style="background:linear-gradient(180deg,rgba(184,178,255,.25),#f7f6fb 96%),url('${esc(p.cover_url)}') center/cover"` : ""}>
      <div class="me-av">${avatar(p)}</div>
      <h2 translate="no">${esc(p.full_name || p.username)} ${p.is_verified ? "✔️" : ""}</h2>
      <div class="me-sub">@${esc(p.username)} · <span data-copy="${p.user_no}">ID ${p.user_no} ⧉</span>${host ? ` · 🎤 হোস্ট` : ""}</div>
      <div class="chips"><span>${flagOf(cc)} ${cc ? (COUNTRY_NAMES[cc] ?? cc) : "দেশ জানা নেই"}</span><span>🅰️ ${esc(langName(p.language))}</span></div>
      <div class="me-counts"><a href="#u/${p.id}"><b>${n(p.videos_count)}</b><span>ভিডিও</span></a><div><b>${n(p.following_count)}</b><span>ফলোয়িং</span></div><div><b>${n(p.followers_count)}</b><span>ফলোয়ার</span></div></div>
    </div>
    <div class="me-cards">
      <a href="#cashin" class="mc coins"><span>আমার কয়েন</span><b>${n(w?.coin_balance)}</b><svg class="deco" viewBox="0 0 64 64"><defs><linearGradient id="gm1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c9f0ff"/><stop offset="1" stop-color="#5aa9ff"/></linearGradient><linearGradient id="gm2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fd3ff"/><stop offset="1" stop-color="#3b82f6"/></linearGradient></defs><path d="M14 22 24 10h16l10 12-18 30z" fill="url(#gm1)"/><path d="M14 22h36L32 52z" fill="url(#gm2)" opacity=".9"/><path d="M24 10l-4 12 12 30 12-30-4-12" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="1.5"/><path d="M14 22h36" stroke="#fff" stroke-opacity=".8" stroke-width="1.5"/></svg></a>
      <a href="#wallet" class="mc money"><span>আমার ব্যালেন্স</span><b>${tk(w?.earning_paisa)}</b><svg class="deco" viewBox="0 0 64 64"><defs><linearGradient id="cn1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe7a3"/><stop offset="1" stop-color="#f5a524"/></linearGradient></defs><ellipse cx="34" cy="46" rx="20" ry="7" fill="#e08c14"/><rect x="14" y="36" width="40" height="10" fill="#f0a020"/><ellipse cx="34" cy="36" rx="20" ry="7" fill="url(#cn1)"/><circle cx="26" cy="24" r="15" fill="url(#cn1)" stroke="#e8961a" stroke-width="2"/><text x="26" y="30" text-anchor="middle" font-size="16" font-weight="700" fill="#c06a00" font-family="sans-serif">৳</text></svg></a>
    </div>
    <div class="me-quick"><a href="#withdraw">💸 উইথড্র</a><a href="#cashin">🪙 কয়েন কিনুন</a><a href="#history">📜 লেনদেন</a></div>
    ${p.coin_seller ? `<a href="#seller" class="me-banner seller"><span>💰 কয়েন সেলার প্যানেল</span><b>বিক্রি করুন ›</b></a>` : ""}
    <a href="#invite" class="me-banner"><span>রেফার করে আয় করুন</span><b>${tk(refs?.earned_paisa ?? 0)} ›</b></a>
    <div class="me-menu">
      <a href="#inbox"><i class="mi c1"><svg viewBox="0 0 24 24"><path d="M4 6.5h16a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3.5v-3.5H4A1.5 1.5 0 0 1 2.5 17V8A1.5 1.5 0 0 1 4 6.5z"/><path d="M7.5 12.5h.01M12 12.5h.01M16.5 12.5h.01" stroke-width="2.6"/></svg></i>মেসেজ<em>${(S.unread || 0) + (S.msgUnread || 0) ? `${(S.unread || 0) + (S.msgUnread || 0)} <b class="red"></b>` : ""}›</em></a>
      <a href="#creator"><i class="mi c4"><svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg></i>ক্রিয়েটর ড্যাশবোর্ড<em>›</em></a>
      <a href="#level"><i class="mi c2"><svg viewBox="0 0 24 24"><path d="M3.5 8l4.2 3.6L12 5l4.3 6.6L20.5 8l-1.8 10.5H5.3z"/><path d="M6 21h12"/></svg></i>আমার লেভেল<em>Lv${levelOf(p.followers_count)} ›</em></a>
      <a href="#invite"><i class="mi c3"><svg viewBox="0 0 24 24"><rect x="3.5" y="8.5" width="17" height="4" rx="1"/><path d="M5 12.5v8h14v-8M12 8.5v12M12 8.5S10.5 4 8 4.6C6 5.1 7 8.5 12 8.5zM12 8.5s1.5-4.5 4-3.9c2 .5 1 3.9-4 3.9z"/></svg></i>আমার রেফার<em>পুরস্কার নিন <b class="red"></b> ›</em></a>
      <a href="#rules"><i class="mi c4"><svg viewBox="0 0 24 24"><rect x="5" y="4.5" width="14" height="16.5" rx="2"/><path d="M9 3.5h6v3H9zM8.5 11.5l2 2 4-4M8.5 17h7"/></svg></i>আমার টাস্ক<em>›</em></a>
      <a href="#u/${p.id}"><i class="mi c5"><svg viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="4"/><path d="M4.5 20.5c1.2-4 4.2-5.5 7.5-5.5s6.3 1.5 7.5 5.5"/></svg></i>আমার প্রোফাইল<em>›</em></a>
      <a href="#settings"><i class="mi c6"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/></svg></i>সেটিংস<em>›</em></a>
    </div></div>`;
};

// ---------- আমার অ্যাকাউন্ট (আগের সেটিংস — এখন প্রোফাইল পেজে) ----------
function accountBlock(me) {
  const en = window.getLang?.() === "en", host = me.account_type === "host", pending = !host && me.host_requested_at;
  return `<div class="card acct-card"><b>অ্যাকাউন্টের ধরন</b>
      <div class="acct">
        <button data-t="user" class="${host ? "" : "on"}"><b>👤 ইউজার</b><small>প্রিমিয়াম ভিডিও কয়েন দিয়ে দেখবেন</small></button>
        <button data-t="host" class="${host ? "on" : ""}"><b>🎤 হোস্ট</b><small>${pending ? "⏳ আবেদন অপেক্ষায়" : "প্রিমিয়াম ভিডিও দিতে পারবেন"}</small></button>
      </div>
      <p class="tiny muted" style="margin:8px 0 0">হোস্ট হতে আবেদন করলে অ্যাডমিন যাচাই করে অনুমোদন দেবেন। হোস্টরা প্রিমিয়ামে ভিডিও দিতে পারেন; প্রিমিয়াম ফ্রি দেখার অনুমতি অ্যাডমিন আলাদা করে দেন।</p>
      ${host ? `<p class="tiny" style="margin:6px 0 0">👑 প্রিমিয়াম ফ্রি দেখা: <b>${me.premium_access ? "✅ চালু" : "❌ বন্ধ (অ্যাডমিনের অনুমতি লাগবে)"}</b></p>` : ""}</div>
    <div class="card list">
      <a class="li" href="#edit"><span>✏️ প্রোফাইল এডিট</span><span>›</span></a>
      <a class="li" href="#wallet"><span>💰 ওয়ালেট ও উইথড্র</span><span>›</span></a>
      <a class="li" href="#cashin"><span>💎 কয়েন কিনুন</span><span>›</span></a>
      <a class="li" href="#vault"><span>🔒 লক ফোল্ডার</span><span>›</span></a>
      <div class="li"><span>🌐 অ্যাপের ভাষা / Language</span><button class="btn small" id="lang" translate="no">${en ? "বাংলা" : "English"}</button></div>
      <div class="li"><span>🆔 আমার ID</span><b data-copy="${me.user_no}">${me.user_no} ⧉</b></div>
    </div>
    <button class="btn" id="lo" style="width:100%;color:#e5484d">🚪 লগআউট</button>`;
}
function bindAccount(me, reload) {
  const en = window.getLang?.() === "en", host = me.account_type === "host", pending = !host && me.host_requested_at;
  $("#lang")?.addEventListener("click", () => window.setLang?.(en ? "bn" : "en"));
  $("#lo")?.addEventListener("click", async () => { if (!confirm("লগআউট করবেন?")) return; await sb.auth.signOut(); S.me = null; location.hash = ""; showAuth(); });
  document.querySelectorAll(".acct button").forEach((b) => (b.onclick = async () => {
    const t = b.dataset.t;
    if ((t === "host" && (host || pending)) || (t === "user" && !host && !pending)) return;
    if (t === "user" && !confirm(host ? "হোস্ট থেকে ইউজারে ফিরবেন? আবার হোস্ট হতে অনুমোদন লাগবে।" : "হোস্ট আবেদন বাতিল করবেন?")) return;
    try {
      const r = await rpc("set_account_type", { p_type: t });
      toast(r === "pending" ? "✅ হোস্ট আবেদন পাঠানো হয়েছে" : r === "host" ? "🎤 আপনি এখন হোস্ট" : "👤 ইউজার অ্যাকাউন্ট");
      reload();
    } catch (e) { toast(errMsg(e), true); }
  }));
}

// ---------- সেটিংস: সাপোর্ট, নীতিমালা, নোটিফিকেশন, অ্যাকাউন্ট ডিলিট ----------
const POLICIES = [["privacy", "🔐", "গোপনীয়তা নীতি"], ["terms", "📄", "ব্যবহারের শর্তাবলি"], ["community", "🤝", "কমিউনিটি নির্দেশিকা"],
  ["child-safety", "🧒", "শিশু সুরক্ষা নীতি"], ["copyright", "©️", "কপিরাইট নীতি"], ["coins", "💎", "কয়েন ও রিফান্ড নীতি"],
  ["earnings", "💸", "আয় ও উইথড্র নীতি"], ["about", "ℹ️", "আমাদের সম্পর্কে"]];
R.settings = async () => {
  const { data: p } = await sb.from("profiles").select("*").eq("id", S.me.id).single();
  if (p) S.me = p;
  const me = S.me, delAt = me.deletion_requested_at;
  const tgUser = String(setting("support_telegram", "") || "").replace(/^@/, "");
  const { data: th } = await sb.from("support_threads").select("unread_user").eq("user_id", me.id).maybeSingle();
  screen.innerHTML = `<div class="page">${header("সেটিংস")}
    <a class="card support-cta" href="#support"><span class="sic">🎧</span><span><b>লাইভ সাপোর্ট</b><div class="tiny muted">${me.account_type === "host" ? "হোস্ট সাপোর্ট — " : ""}যেকোনো সমস্যা লিখুন, আমরা উত্তর দেব</div></span>
      <em>${th?.unread_user ? `<b class="badge-n">${th.unread_user}</b>` : ""}›</em></a>
    ${tgUser ? `<a class="card list-1" href="https://t.me/${esc(tgUser)}" target="_blank" rel="noopener"><span>✈️ টেলিগ্রামে যোগাযোগ</span><span class="muted">@${esc(tgUser)} ›</span></a>` : ""}
    <div class="card list">
      <label class="li"><span>🔔 নোটিফিকেশন</span><input type="checkbox" id="nt" class="sw" ${notifOn() ? "checked" : ""}></label>
    </div>
    <h3 class="sec">নীতিমালা</h3>
    <div class="card list">${POLICIES.map(([k, i, t]) => `<a class="li" href="#policy/${k}"><span>${i} ${t}</span><span>›</span></a>`).join("")}</div>
    <div class="card list">
      <a class="li" href="#delacct"><span style="color:#e5484d">🗑️ অ্যাকাউন্ট ডিলিট</span><span class="muted">${delAt ? "⏳ অনুরোধ করা হয়েছে" : ""} ›</span></a>
      <div class="li"><span>📱 অ্যাপ ভার্সন</span><span class="muted">${esc(Native?.appVersion?.() ?? "web")}</span></div>
    </div></div>`;
  $("#nt").onchange = (e) => { try { localStorage.setItem("notif", e.target.checked ? "on" : "off"); } catch { /* */ } toast(e.target.checked ? "🔔 নোটিফিকেশন চালু" : "🔕 নোটিফিকেশন বন্ধ"); };
};

R.policy = async (key) => {
  const item = POLICIES.find(([k]) => k === key) ?? [key, "📄", key === "delete-account" ? "অ্যাকাউন্ট ডিলিট" : "নীতি"];
  screen.innerHTML = `<div class="page">${header(item[2])}<div class="spinner"></div></div>`;
  try {
    const html = await (await fetch(`../policy/${key}.html`, { cache: "no-cache" })).text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const sec = doc.querySelector(window.getLang?.() === "en" ? "#en" : "#bn");
    sec?.querySelector("h2")?.remove();
    sec?.querySelectorAll("a[href$='.html']").forEach((a) => a.setAttribute("href", "#policy/" + a.getAttribute("href").replace(".html", "")));
    const upd = doc.querySelector("header .u")?.textContent ?? "";
    screen.innerHTML = `<div class="page">${header(item[2])}<div class="card policy" translate="no">${sec ? sec.innerHTML : ""}<p class="tiny muted">${esc(upd)}</p></div></div>`;
  } catch { screen.innerHTML = `<div class="page">${header(item[2])}<div class="empty">ইন্টারনেট সংযোগ নেই</div></div>`; }
};

R.delacct = async () => {
  const [{ data: p }, { data: w }] = await Promise.all([
    sb.from("profiles").select("deletion_requested_at").eq("id", S.me.id).single(),
    sb.from("wallets").select("earning_paisa,pending_paisa,coin_balance,points").eq("user_id", S.me.id).maybeSingle(),
  ]);
  const at = p?.deletion_requested_at;
  const until = at ? new Date(new Date(at).getTime() + 7 * 864e5) : null;
  screen.innerHTML = `<div class="page">${header("🗑️ অ্যাকাউন্ট ডিলিট")}
    ${at ? `<div class="card" style="border-color:#f5b4b4;background:#fff3f3"><b>⏳ ডিলিটের অনুরোধ করা হয়েছে</b>
        <p class="tiny">${dt(until)}-এর পর আপনার অ্যাকাউন্ট স্থায়ীভাবে মুছে যাবে। এর আগে মত বদলালে নিচের বাটন চাপুন।</p>
        <button class="btn primary" id="cancelDel">↩️ ডিলিট বাতিল করুন</button></div>`
    : `<div class="card"><b>ডিলিট করলে যা মুছে যাবে</b><ul class="tiny">
        <li>প্রোফাইল, নাম, ছবি, কভার, বায়ো</li><li>সব ভিডিও, ছবি, লেখা, কমেন্ট, ফলো</li><li>মেসেজ, সাপোর্ট মেসেজ ও লক ফোল্ডার</li><li>ফোন নম্বর, ইমেইল, জন্মতারিখ ও লোকেশন</li></ul>
        <p class="tiny muted">টাকা-কয়েনের লেনদেনের হিসাব আইনের প্রয়োজনে কিছুদিন রাখা হতে পারে। অবশিষ্ট ব্যালেন্স, পয়েন্ট ও কয়েন বাতিল হবে।</p></div>
      ${Number(w?.earning_paisa) + Number(w?.pending_paisa) > 0 || Number(w?.coin_balance) > 0 ? `<div class="notice">⚠️ আপনার এখনো ${tk(w.earning_paisa)} ব্যালেন্স, ${tk(w.pending_paisa)} পেন্ডিং ও 🪙 ${n(w.coin_balance)} কয়েন আছে। ডিলিটের আগে উইথড্র করে নিন।</div>` : ""}
      <p class="tiny muted">অনুরোধের ৭ দিন পর অ্যাকাউন্ট মুছে যাবে। এই ৭ দিনের মধ্যে চাইলে বাতিল করতে পারবেন।</p>
      <button class="btn" id="doDel" style="width:100%;background:#e5484d;color:#fff;border:0">🗑️ আমার অ্যাকাউন্ট ডিলিট করুন</button>`}
    <p class="tiny muted" style="margin-top:12px">বিস্তারিত: <a href="#policy/delete-account">অ্যাকাউন্ট ডিলিট নীতি</a></p></div>`;
  $("#doDel")?.addEventListener("click", async () => {
    if (!confirm("সত্যিই অ্যাকাউন্ট ডিলিট করবেন? ৭ দিন পর সব তথ্য স্থায়ীভাবে মুছে যাবে।")) return;
    try { await rpc("request_account_deletion", { p_cancel: false }); toast("ডিলিটের অনুরোধ নেওয়া হয়েছে"); R.delacct(); } catch (e) { toast(errMsg(e), true); }
  });
  $("#cancelDel")?.addEventListener("click", async () => {
    try { await rpc("request_account_deletion", { p_cancel: true }); toast("✅ ডিলিট বাতিল হয়েছে"); R.delacct(); } catch (e) { toast(errMsg(e), true); }
  });
};

// ---------- লাইভ সাপোর্ট ----------
R.support = async () => {
  const host = S.me.account_type === "host";
  screen.classList.add("chatmode");
  const tgUser = String(setting("support_telegram", "") || "").replace(/^@/, "");
  screen.innerHTML = `<div class="chat">
    <div class="chat-top"><button class="back" onclick="history.back()">←</button><span class="sic">🎧</span><span style="flex:1"><b>${host ? "হোস্ট সাপোর্ট" : "লাইভ সাপোর্ট"}</b><div class="tiny muted" translate="no">${esc(setting("support_hours", ""))}</div></span>
      ${tgUser ? `<a class="btn small" href="https://t.me/${esc(tgUser)}" target="_blank" rel="noopener">✈️ Telegram</a>` : ""}</div>
    <div class="chat-list" id="cl"><div class="spinner"></div></div>
    <form class="chat-box" id="cf"><input id="ci" placeholder="আপনার সমস্যা লিখুন…" maxlength="2000" autocomplete="off"><button class="btn small primary" style="width:auto;margin:0">পাঠান</button></form></div>`;
  const list = $("#cl");
  const bubble = (m) => `<div class="bub ${m.from_admin ? "" : "mine"}"><span translate="no">${esc(m.body)}</span><i>${m.from_admin ? "🎧 সাপোর্ট · " : ""}${new Date(m.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</i></div>`;
  const seen = new Set();
  const add = (m) => { if (seen.has(m.id)) return; seen.add(m.id); list.insertAdjacentHTML("beforeend", bubble(m)); list.scrollTop = list.scrollHeight; };
  try {
    const rows = await rpc("support_my_messages");
    list.innerHTML = `<div class="sys-msg">👋 আসসালামু আলাইকুম! আপনার সমস্যা বা প্রশ্ন লিখে পাঠান। ${host ? "হোস্টদের মেসেজ আলাদাভাবে দেখা হয়।" : ""} কয়েন/উইথড্র নিয়ে হলে TrxID বা তারিখ লিখে দিন।</div>`;
    rows.reverse().forEach(add);
  } catch (e) { list.innerHTML = `<div class="empty">${esc(errMsg(e))}</div>`; }
  const ch = sb.channel("sup-" + S.me.id)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "support_messages", filter: `user_id=eq.${S.me.id}` }, (p) => add(p.new))
    .subscribe();
  cleanup = () => { sb.removeChannel(ch); screen.classList.remove("chatmode"); };
  $("#cf").onsubmit = async (e) => {
    e.preventDefault();
    const body = $("#ci").value.trim(); if (!body) return;
    const btn = e.submitter; btn.disabled = true;
    try {
      const id = await rpc("support_send", { p_body: body });
      $("#ci").value = "";
      add({ id, body, from_admin: false, created_at: new Date().toISOString() });
      sb.functions.invoke("support-telegram", { body: { action: "notify", id } }).catch(() => {});
    } catch (er) { toast(errMsg(er), true); }
    btn.disabled = false;
  };
};

R.invite = async () => {
  screen.innerHTML = `<div class="page">${header("🎁 আমার রেফার")}<div class="spinner"></div></div>`;
  const r = await rpc("my_referrals").catch((e) => ({ error: e }));
  if (r.error) { screen.innerHTML = `<div class="page">${header("🎁 আমার রেফার")}<div class="empty">${esc(errMsg(r.error))}</div></div>`; return; }
  const shareText = `Reels Enjoy অ্যাপে ভিডিও দেখে ও বানিয়ে আয় করুন!${Number(setting("welcome_bonus_paisa", 0)) > 0 && setting("welcome_bonus_enabled", true) !== false ? ` নতুন ইউজাররা পাবেন ৳${Math.round(Number(setting("welcome_bonus_paisa")) / 100)} বোনাস 🎁` : ""}\n\n📲 ডাউনলোড: ${shareLink()}\n🎟️ রেজিস্টার করার সময় আমার রেফার কোড দিন: ${r.code}`;
  screen.innerHTML = `<div class="page">${header("🎁 আমার রেফার")}
    <div class="card hero" style="text-align:center"><div class="k">আপনার রেফার কোড</div>
      <div class="v" data-copy="${r.code}" style="letter-spacing:2px">${r.code} ⧉</div>
      <button class="btn" id="shr" style="background:#fff;color:#4b1c7a;border:0">📤 বন্ধুদের পাঠান</button></div>
    <div class="stats" style="margin-bottom:12px"><div><b>${n(r.total)}</b><span>মোট রেফার</span></div><div><b>${n(r.qualified)}</b><span>সফল</span></div><div><b>${tk(r.earned_paisa)}</b><span>রেফার আয়</span></div></div>
    <div class="card"><b>কীভাবে কাজ করে</b><div class="list tiny">
      <div class="li"><span>১. বন্ধু রেজিস্টারের সময় আপনার কোড দেবে</span></div>
      <div class="li"><span>২. বন্ধু ${n(r.min_views)}টি ভিডিও দেখলে রেফার সফল</span></div>
      <div class="li"><span>৩. প্রতি সফল রেফারে আপনি পাবেন</span><b>${tk(setting("referral_bonus_paisa"))}</b></div>
      <div class="li"><span>বন্ধু পাবে স্বাগত পয়েন্ট</span><b>⭐ ${n(setting("referral_welcome_points"))}</b></div>
      <div class="li"><span>⚠️ একই মোবাইলে খোলা দ্বিতীয় অ্যাকাউন্টের রেফার গণ্য হবে না। বন্ধুকে অ্যাপ (APK) থেকে লগইন করতে হবে।</span></div></div></div>
    ${r.tiers.length ? `<div class="card"><b>🏆 বাড়তি বোনাস</b><div class="list">${r.tiers.map((t) => `<div class="li"><span>${n(t.referrals)} জন সফল রেফার</span>
      <span>${t.awarded ? "✅ " : ""}<b>${tk(t.bonus_paisa)}</b></span></div>
      ${t.awarded ? "" : `<div class="progress" style="margin:0 0 6px"><div style="width:${Math.min(100, Math.round((r.qualified / t.referrals) * 100))}%"></div></div>`}`).join("")}</div></div>` : ""}
    <h3>আপনার রেফার করা বন্ধু</h3><div class="card list">${r.list.length ? r.list.map((x) => `<div class="li"><span>@${esc(x.username)}<div class="tiny muted">${dt(x.created_at)} · ${n(x.views)}/${n(r.min_views)} ভিডিও দেখেছে</div></span>
      <span class="pill ${x.qualified ? "paid" : x.blocked ? "rejected" : "pending"}">${x.qualified ? "সফল" : x.blocked ? "❌ বাতিল (একই মোবাইল)" : "চলছে"}</span></div>`).join("") : `<div class="empty">এখনো কেউ নেই — কোড শেয়ার করুন</div>`}</div></div>`;
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
  sb.from("stories").select("id", { count: "exact", head: true }).eq("user_id", id).eq("status", "active").gt("expires_at", new Date().toISOString()).then(({ count }) => {
    const av = $("#pAv"); if (!av || !count) return;
    av.classList.add("has-story"); av.onclick = () => (location.hash = `#story/${id}`);
  });
  const host = p.account_type === "host", seller = host && p.coin_seller;
  const grid = (list) => list.map((v) => `<a href="#watch/${id}/${v.id}">${v.thumb_url ? `<img src="${esc(v.thumb_url)}" loading="lazy" alt="">` : ""}<span class="vc">▶ ${n(v.views_count)}</span></a>`).join("");
  const lv = levelOf(p.followers_count);
  screen.innerHTML = `<div class="cover${seller ? " seller" : host ? " host" : ""}" ${p.cover_url ? `style="background-image:url('${esc(p.cover_url)}')"` : ""}><button class="back" onclick="history.back()">←</button></div>
    <div class="page${host ? " hostpage" : ""}${seller ? " sellerpage" : ""}" style="padding-top:0">
    <div class="prof${host ? " host" : ""}${seller ? " seller" : ""}">${host ? `<div class="avwrap" id="pAv">${avatar(p)}<span class="crown">👑</span></div>` : `<div class="avplain" id="pAv">${avatar(p)}</div>`}<h2 translate="no">${esc(p.full_name ?? "")} ${p.is_verified ? "✔️" : ""}</h2><div class="muted">@${esc(p.username)}</div>
      <div class="rbadges">${host ? `<span class="rbadge host">👑 HOST</span>` : `<span class="rbadge user">👤 ইউজার</span>`}${seller ? `<span class="rbadge seller">💰 কয়েন সেলার</span>` : ""}<span class="rbadge lv">Lv${lv}</span>${p.country_code ? `<span class="rbadge">${flagOf(p.country_code)}</span>` : ""}</div>
      <div class="idtag" data-copy="${p.user_no}">ID: ${p.user_no} ⧉</div>
      <div class="counts"><div><b>${n(p.videos_count)}</b><span>ভিডিও</span></div><div><b id="fc">${n(p.followers_count)}</b><span>ফলোয়ার</span></div><div><b>${n(p.following_count)}</b><span>ফলোয়িং</span></div></div>
      ${p.bio ? `<p translate="no">${esc(p.bio)}</p>` : ""}
      ${mine ? `<div class="row" style="justify-content:center;gap:8px;flex-wrap:wrap"><a class="btn small" href="#edit">✏️ প্রোফাইল এডিট</a><button class="btn small" id="accT">⚙️ আমার অ্যাকাউন্ট</button></div>`
        : `<div class="row" style="justify-content:center;gap:8px"><button class="btn" id="fb" style="min-width:130px;${following ? "" : "background:var(--purple);color:#fff;border:0"}">${following ? "ফলোয়িং" : "ফলো করুন"}</button>
           <a class="btn" href="#chat/${p.id}" style="min-width:110px">💬 মেসেজ</a></div>`}
    </div>
    ${mine ? `<div id="accBox" class="${S.openAcc ? "" : "hidden"}" style="margin-top:12px">${accountBlock(p)}</div>` : ""}
    ${seller && !mine ? `<a class="sellcta" href="#chat/${p.id}"><span>🪙</span><div><b>এই হোস্টের কাছ থেকে কয়েন কিনুন</b><small>মেসেজ দিন → টাকা পাঠান → কয়েন সাথে সাথে পাবেন</small></div><em>›</em></a>` : ""}
    ${seller && mine ? `<a class="sellcta" href="#seller"><span>💰</span><div><b>কয়েন সেলার প্যানেল</b><small>ইউজারদের কাছে কয়েন বিক্রি করুন</small></div><em>›</em></a>` : ""}
    ${host ? `<div class="hoststrip"><span>✨ অফিসিয়াল হোস্ট</span><span>🎬 ${n(p.videos_count)} কন্টেন্ট</span><span>👑 ${n(vids.filter((v) => v.is_premium).length)} প্রিমিয়াম</span></div>` : ""}
    <div class="seg"><button class="on" data-pt="v">🎬 ভিডিও</button>${host ? `<button data-pt="prem">👑 প্রিমিয়াম</button>` : ""}<button data-pt="photo">🖼️ ফটো</button><button data-pt="text">✍️ লেখা</button></div>
    <div id="ptab"></div>
    <div id="pend"></div>
    <div class="grid3" id="g">${vids.length ? grid(vids) : ""}</div>
    ${vids.length ? "" : `<div class="empty">${mine ? "এখনো কোনো ভিডিও নেই — ＋ চেপে প্রথম ভিডিও দিন" : "কোনো ভিডিও নেই"}</div>`}
    ${vids.length === 30 ? `<button class="btn" id="mr" style="width:100%;margin-top:10px">আরও</button>` : ""}</div>`;
  if (mine) {
    bindAccount(p, () => { S.openAcc = true; R.u(id); });
    $("#accT").onclick = () => { S.openAcc = $("#accBox").classList.toggle("hidden") === false; };
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
      e.target.style.background = following ? "" : "var(--purple)"; e.target.style.color = following ? "" : "#fff"; e.target.style.border = following ? "" : "0";
      p.followers_count += following ? 1 : -1; $("#fc").textContent = n(p.followers_count);
    } catch (er) { toast(errMsg(er), true); }
  });
  document.querySelectorAll(".seg [data-pt]").forEach((b) => (b.onclick = async () => {
    document.querySelectorAll(".seg [data-pt]").forEach((x) => x.classList.toggle("on", x === b));
    const k = b.dataset.pt, show = k === "v";
    ["#g", "#mr"].forEach((q) => $(q)?.classList.toggle("hidden", !show));
    screen.querySelector(".page > .empty")?.classList.toggle("hidden", !show);
    if (show) { $("#ptab").innerHTML = ""; return; }
    if (k === "prem") { const pv = vids.filter((v) => v.is_premium);
      $("#ptab").innerHTML = pv.length ? `<div class="grid3">${pv.map((v) => `<a href="#watch/${id}/${v.id}">${v.thumb_url ? `<img src="${esc(v.thumb_url)}" loading="lazy" alt="">` : ""}<span class="vc">👑 ${n(v.premium_coins)}</span></a>`).join("")}</div>` : `<div class="empty">কোনো প্রিমিয়াম ভিডিও নেই</div>`; return; }
    $("#ptab").innerHTML = `<div class="spinner" style="margin-top:14px"></div>`;
    const rows = await rpc("feed_posts", { p_kind: k, p_before: null, p_limit: 50, p_category: null, p_contest: null, p_user: id, p_sort: "new" }).catch(() => []);
    $("#ptab").innerHTML = !rows.length ? `<div class="empty">কিছু নেই</div>` : k === "photo"
      ? `<div class="grid3">${rows.map((v) => `<a href="#post/${v.id}"><img src="${esc(v.image_url)}" loading="lazy" alt=""><span class="vc">❤️ ${n(v.likes_count)}</span></a>`).join("")}</div>`
      : `<div class="nocopy" style="margin-top:12px">${rows.map((v) => `<a class="tmini" href="#post/${v.id}" style="background:${BGS[v.bg] ?? BGS.g1}" translate="no">${esc(v.body)}</a>`).join("")}</div>`;
  }));
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
    <span class="lbl">কভার ফটো</span>
    <div class="cover-edit" id="cvPrev" style="${p.cover_url ? `background-image:url('${esc(p.cover_url)}')` : ""}">${p.cover_url ? "" : "<span>কোনো কভার ফটো নেই</span>"}</div>
    <div class="row-btns"><label class="btn small"><input type="file" id="cvf" accept="image/*" class="hidden">🖼️ কভার বদলান</label>
      <button class="btn small del" id="cvDel" ${p.cover_url ? "" : "hidden"}>🗑️ কভার মুছুন</button></div>
    <div id="cvCrop" class="crop hidden"><div class="crop-view"><img alt=""></div><div class="crop-info tiny muted"></div>
      <div class="row-btns"><button class="btn small primary" id="cvOk" style="width:auto;margin:0">✅ ঠিক আছে</button><button class="btn small" id="cvNo">বাতিল</button></div></div>

    <span class="lbl">প্রোফাইল ছবি</span>
    <div class="av-edit"><div id="avPrev">${avatar(p)}</div>
      <div class="row-btns"><label class="btn small"><input type="file" id="af" accept="image/*" class="hidden">📷 ছবি বদলান</label>
        <button class="btn small del" id="avDel" ${p.avatar_url ? "" : "hidden"}>🗑️ ছবি মুছুন</button></div></div>
    <div id="avCrop" class="crop round hidden"><div class="crop-view"><img alt=""></div><div class="crop-info tiny muted"></div>
      <div class="row-btns"><button class="btn small primary" id="avOk" style="width:auto;margin:0">✅ ঠিক আছে</button><button class="btn small" id="avNo">বাতিল</button></div></div>

    <span class="lbl">নাম</span><input id="fn" value="${esc(p.full_name ?? "")}" maxlength="60">
    <span class="lbl">ইউজারনেম</span><input id="un" value="${esc(p.username)}" autocapitalize="off" maxlength="30">
    <span class="lbl">বায়ো</span><textarea id="bio" maxlength="300">${esc(p.bio ?? "")}</textarea>
    <span class="lbl">লিঙ্গ</span><select id="gd"><option value="">বলতে চাই না</option><option value="male" ${p.gender === "male" ? "selected" : ""}>👨 পুরুষ</option><option value="female" ${p.gender === "female" ? "selected" : ""}>👩 নারী</option><option value="other" ${p.gender === "other" ? "selected" : ""}>অন্যান্য</option></select>
    <span class="lbl">জন্মতারিখ</span><input id="bd" type="date">
    <span class="lbl">আপনার ভাষা</span><select id="lg">${LANGS.map(([k, l]) => `<option value="${k}" ${k === p.language ? "selected" : ""}>${l}</option>`).join("")}</select>
    <button class="btn primary" id="sv">সেভ করুন</button></div>`;
  sb.from("user_private").select("birth_date").eq("user_id", S.me.id).maybeSingle().then(({ data }) => { if (data?.birth_date) $("#bd").value = data.birth_date; });
  let avatarBlob = null, coverBlob = null, avatarDel = false, coverDel = false;
  const openCrop = async (file, boxId, ratio, onOk) => {
    const img = new Image(); img.src = URL.createObjectURL(file);
    try { await img.decode(); } catch { return toast("ছবিটি খোলা যায়নি", true); }
    const box = $(boxId); box.classList.remove("hidden");
    box.querySelector(".crop-view img").src = img.src;
    const render = photoFramer(box, img, ratio);
    box.scrollIntoView({ block: "center", behavior: "smooth" });
    box.querySelector("[id$=Ok]").onclick = async () => { onOk(await render(ratio === 1 ? 480 : 1500)); box.classList.add("hidden"); };
    box.querySelector("[id$=No]").onclick = () => box.classList.add("hidden");
  };
  $("#cvf").onchange = (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) openCrop(f, "#cvCrop", 3, (bl) => {
    coverBlob = bl; coverDel = false; $("#cvPrev").style.backgroundImage = `url('${URL.createObjectURL(bl)}')`; $("#cvPrev").innerHTML = ""; $("#cvDel").hidden = false; }); };
  $("#af").onchange = (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) openCrop(f, "#avCrop", 1, (bl) => {
    avatarBlob = bl; avatarDel = false; $("#avPrev .av").innerHTML = `<img src="${URL.createObjectURL(bl)}">`; $("#avDel").hidden = false; }); };
  $("#avDel").onclick = () => { if (!confirm("প্রোফাইল ছবি মুছবেন?")) return; avatarDel = true; avatarBlob = null; $("#avPrev").innerHTML = avatar({ ...p, avatar_url: null }); $("#avDel").hidden = true; };
  $("#cvDel").onclick = () => { if (!confirm("কভার ফটো মুছবেন?")) return; coverDel = true; coverBlob = null; $("#cvPrev").style.backgroundImage = ""; $("#cvPrev").innerHTML = "<span>কোনো কভার ফটো নেই</span>"; $("#cvDel").hidden = true; };
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
      if (avatarDel) await rpc("remove_photo", { p_which: "avatar" });
      if (coverBlob) {
        const cp = `${S.me.id}/cover-${Date.now()}.jpg`;
        await xhrUpload("avatars", cp, coverBlob, "image/jpeg", () => {});
        await rpc("set_cover", { p_url: sb.storage.from("avatars").getPublicUrl(cp).data.publicUrl });
      } else if (coverDel) await rpc("remove_photo", { p_which: "cover" });
      if (($("#gd").value || null) !== (p.gender || null)) await rpc("set_gender", { p_gender: $("#gd").value || null });
      if ($("#bd").value) await rpc("set_birth_date", { p_date: $("#bd").value });
      if ($("#lg").value !== p.language) await rpc("set_language", { p_lang: $("#lg").value });
      toast("সেভ হয়েছে");
      location.hash = "#u/" + S.me.id;
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
