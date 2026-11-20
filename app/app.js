import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const { SUPABASE_URL, SUPABASE_KEY } = window.REELS_CONFIG;
const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
const Native = window.ReelsAndroid || null; // APK-এর ভেতরে থাকলে অ্যাড/শেয়ার ব্রিজ
try { Native?.setLang?.(window.getLang?.() === "en" ? "en" : "bn"); } catch { /* */ }
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
const dt = (s) => new Date(s).toLocaleString(window.getLang?.() === "en" ? "en-GB" : "bn-BD", { timeZone: "Asia/Dhaka", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
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
    $("#mcat", body).innerHTML = cats.length ? [["", "সব"], ...cats.map((c) => [c, c])].map(([k, l]) => `<a href="javascript:void 0" data-c="${esc(k)}" class="${k === cat ? "on" : ""}"${k ? ' translate="no"' : ""}>${esc(l)}</a>`).join("") : "";
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

const isVip = (p) => !!p?.vip_until && new Date(p.vip_until) > new Date();
const vipPlan = (p) => (S.vipPlans ?? []).find((x) => x.id === p?.vip_plan_id);
// 💎 ধনী লেভেল: কয়েন কেনা বা খরচের যেটা বেশি (সার্ভার profiles.wealth_topup / wealth_spent রাখে)
const WEALTH_DEF = [1000, 3000, 10000, 30000, 100000, 300000, 1000000, 3000000, 10000000, 30000000];
const wealthSteps = () => { const w = setting("wealth_levels", WEALTH_DEF); return Array.isArray(w) && w.length ? w.map(Number) : WEALTH_DEF; };
const wealthVal = (p) => Math.max(Number(p?.wealth_topup ?? 0), Number(p?.wealth_spent ?? 0));
const wealthOf = (p) => wealthSteps().filter((t) => wealthVal(p) >= t).length;
const GEM = `<svg viewBox="0 0 24 24"><path d="M6.5 4h11l4 5.2L12 20.5 2.5 9.2z" fill="currentColor" fill-opacity=".9"/><path d="M2.5 9.2h19M9 4l3 16.5L15 4M6.5 4 9 9.2 12 4l3 5.2L17.5 4" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1"/></svg>`;
const wealthTag = (p) => {
  if (!p || setting("wealth_enabled", true) === false || p.wealth_topup == null) return "";
  const lv = wealthOf(p); if (!lv) return "";
  return `<span class="wtag w${lv >= 9 ? 4 : lv >= 7 ? 3 : lv >= 4 ? 2 : 1}">${GEM}Lv${lv}</span>`;
};
const vipTag = (p) => wealthTag(p) + (isVip(p) ? `<span class="viptag v-${esc(vipPlan(p)?.color || "gold")}">${esc(vipPlan(p)?.badge || "💎")} ${esc(vipPlan(p)?.name || "VIP")}</span>` : "");
// কেনা ফ্রেম পরানো অবতার
const avatarD = (p, cls = "av") => avatar(p, cls + (p?.deco?.frame ? ` fr fr-${String(p.deco.frame).replace(/[^a-z0-9-]/g, "")}` : ""));
const avatar = (p, cls = "av") => `<div class="${cls}">${p?.avatar_url ? `<img src="${esc(p.avatar_url)}" alt="">` : `<span class="ini">${esc((p?.full_name || p?.username || "?").trim().charAt(0).toUpperCase())}</span>`}</div>`;

const ERR = {
  "Invalid login credentials": "মোবাইল নম্বর বা পাসওয়ার্ড ভুল",
  INSUFFICIENT_COINS: "কয়েন যথেষ্ট নেই — আগে কয়েন কিনুন",
  INCOME_LOCKED: "এই সুবিধা শীঘ্রই চালু হবে 🔒", NOT_ENDED: "সিজন এখনো শেষ হয়নি",
  POOL_MODE: "এখন রিওয়ার্ড পুল চালু — পয়েন্ট দিয়ে প্রতিদিন পুলের ভাগ পাবেন", VIP_OFF: "VIP এখন বন্ধ", NOT_VIP: "এটা শুধু VIP-দের জন্য",
  ALREADY_CLAIMED: "এই পুরস্কার আগেই নিয়েছেন", NEED_APP: "এই পুরস্কার শুধু Reels Enjoy অ্যাপে (APK) পাওয়া যায়",
  DEVICE_USED: "এই মোবাইলে অন্য একটি অ্যাকাউন্ট এই পুরস্কার আগেই নিয়েছে", NOT_DONE: "আগে কাজটা শেষ করুন", EXPIRED: "সময় শেষ হয়ে গেছে", DISABLED: "এটা এখন বন্ধ আছে", ALREADY_OWNED: "এটা আপনার কাছে আগেই আছে", STORE_OFF: "দোকান এখন বন্ধ",
  BOOST_OFF: "বুস্ট এখন বন্ধ", NOT_PUBLISHED: "ভিডিও অনুমোদনের পরে বুস্ট করা যাবে",
  NOT_SELLER: "আপনি কয়েন সেলার নন",
  SELLER_OFF: "কয়েন বিক্রি এখন বন্ধ আছে",
  SELF_SALE: "নিজের কাছে বিক্রি করা যায় না",
  USER_NOT_FOUND: "এই ID-তে কোনো ইউজার নেই",
  USER_BANNED: "এই ইউজার ব্যান করা",
  BAD_AMOUNT: "সঠিক পরিমাণ দিন",
  TOO_MANY: "সর্বোচ্চ ৫টি নম্বর সেভ করা যায়",
  STORIES_OFF: "স্টোরি এখন বন্ধ আছে",
  LIVE_OFF: "লাইভ এখন বন্ধ আছে",
  HOST_ONLY: "শুধু অনুমোদিত হোস্টরা লাইভ করতে পারবে — সেটিংস থেকে হোস্ট হতে আবেদন করুন",
  LIVE_ENDED: "লাইভ শেষ হয়ে গেছে",
  COHOST_FULL: "লাইভে আর জায়গা নেই",
  CALLS_OFF: "এই হোস্ট এখন কল নিচ্ছে না",
  HOST_BUSY: "হোস্ট এখন অন্য কলে আছে — একটু পরে চেষ্টা করুন",
  CALL_ENDED: "কল শেষ হয়ে গেছে",
  PK_OFF: "PK এখন বন্ধ আছে",
  PARTY_OFF: "পার্টি এখন বন্ধ আছে",
  REF_ALREADY: "আপনি আগেই একজনের রেফারে যুক্ত আছেন",
  REF_TOO_LATE: "নতুন অ্যাকাউন্ট খোলার কয়েক দিনের মধ্যেই শুধু রেফার কোড দেওয়া যায়",
  REF_NOT_FOUND: "এই ID নম্বরের কোনো ইউজার পাওয়া যায়নি",
  REF_SELF: "নিজের বা আপনার রেফার করা কারো কোড দেওয়া যাবে না",
  PRICE_RANGE: "এই রেট আপনার লেভেলের সীমার বাইরে",
  PK_BUSY: "এই হোস্ট এখন অন্য PK-তে আছে",
  PK_EXPIRED: "PK চ্যালেঞ্জের সময় শেষ",
  NOT_ALLOWED: "অনুমতি নেই",
  NOT_CONFIGURED: "লাইভ/কল এখনো চালু করা হয়নি",
  DOWNLOADS_OFF: "ডাউনলোড এখন বন্ধ আছে",
  INSUFFICIENT_BALANCE: "ব্যালেন্স যথেষ্ট নেই",
  INSUFFICIENT_POINTS: "পয়েন্ট যথেষ্ট নেই",
  BELOW_MIN: "সর্বনিম্ন পরিমাণের চেয়ে কম",
  OPEN_REQUEST_EXISTS: "আগের একটি উইথড্র রিকোয়েস্ট এখনো চলছে",
  ACCOUNT_TOO_NEW: "নতুন অ্যাকাউন্ট — কয়েক দিন পর উইথড্র করতে পারবেন",
  WALLET_FROZEN: "আপনার ওয়ালেট সাময়িক বন্ধ আছে — সাপোর্টে যোগাযোগ করুন",
  BAD_NUMBER: "সঠিক মোবাইল নম্বর দিন (01XXXXXXXXX)",
  BAD_PHONE: "দেশ বেছে নিয়ে সঠিক মোবাইল নম্বর দিন",
  UNDER_18: "অ্যাপ ব্যবহার করতে বয়স ১৮+ হতে হবে — সঠিক জন্মতারিখ দিন",
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
const isEn = () => window.getLang?.() === "en";
const L = (bn, en) => (isEn() ? en : bn);
const trx = (x) => (isEn() && window.t ? window.t(String(x ?? "")) : x); // DOM-এর বাইরের লেখা (নেটিভ নোটিফিকেশন)
// অ্যাডমিনের লেখা (যার _en নেই): English মোডে অনুবাদ পুরো হলে দেখাও, নইলে লুকাও — ভাষা মিশবে না
const admTxt = (x) => { x = String(x ?? ""); if (!isEn() || !/[\u0980-\u09FF]/.test(x)) return x; const t = window.t ? window.t(x) : x; return /[\u0980-\u09FF]/.test(t) ? "" : t; };
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

// লগইন পেজ: প্রথমে Google / মোবাইল / আরও অপশন (Chamet-এর মতো)
const GOOGLE_WEB_CLIENT_ID = "851306897519-0dn72ho0853o6kfiogpbi26p98uduoo3.apps.googleusercontent.com"; // Google Cloud → Credentials → "Web application" OAuth client ID
const authShow = (which) => {
  ["authHome", "loginForm", "regForm", "onbForm", "pwForm"].forEach((x) => $("#" + x).classList.toggle("hidden", x !== which));
  $("#authErr").textContent = "";
};
function showAuth(msg = "") {
  $("#main").classList.add("hidden");
  $("#auth").classList.remove("hidden");
  authShow("authHome");
  restoreRegDraft();
  $("#authErr").textContent = msg;
}
document.querySelectorAll(".toHome").forEach((a) => (a.onclick = (e) => { e.preventDefault(); authShow("authHome"); }));
const setLoginMode = (m) => document.querySelector(`#loginForm [data-m="${m}"]`)?.click();
$("#authPhone").onclick = () => { authShow("loginForm"); setLoginMode("phone"); };
$("#authMore").onclick = () => $("#moreOpts").classList.toggle("hidden");
$("#authEmail").onclick = () => { authShow("loginForm"); setLoginMode("email"); };
$("#authNew").onclick = () => authShow("regForm");
// রেফার কোড: লগইনের আগে লিখে রাখলে নতুন অ্যাকাউন্ট খোলার পরে নিজে থেকে যুক্ত হয় (Google দিয়ে খুললেও)
$("#refTg").onclick = () => { $("#homeRef").classList.toggle("hidden"); $("#homeRef").focus(); };
$("#homeRef").addEventListener("input", (e) => { const v = e.target.value.replace(/\D/g, ""); e.target.value = v; try { v ? localStorage.setItem("refNo", v) : localStorage.removeItem("refNo"); } catch { /* */ } });
try { const r = localStorage.getItem("refNo"); if (r) { $("#homeRef").value = r; $("#homeRef").classList.remove("hidden"); } } catch { /* */ }
const refDaysLeft = (me) => Math.max(0, Number(setting("referral_add_days", 7)) - (Date.now() - new Date(me.created_at)) / 864e5);
$("#authGoogle").onclick = () => {
  if (!$("#agreeHome").checked) { $("#authErr").textContent = "আগে নিচের শর্তে টিক দিন"; return; }
  if (!GOOGLE_WEB_CLIENT_ID) { $("#authErr").textContent = "Google লগইন খুব শিগগিরই চালু হবে — এখন মোবাইল নম্বর দিয়ে লগইন করুন"; return; }
  if (!Native?.googleSignIn) { $("#authErr").textContent = "Google লগইনের জন্য অ্যাপ আপডেট করুন"; return; }
  $("#authGoogle").disabled = true; $("#authErr").textContent = "";
  Native.googleSignIn(GOOGLE_WEB_CLIENT_ID);
};
window.onGoogleSignIn = async (token, err) => {
  $("#authGoogle").disabled = false;
  if (!token) { if (err !== "cancel") $("#authErr").textContent = "Google লগইন হয়নি — আবার চেষ্টা করুন" + (err ? ` (${String(err).slice(0, 80)})` : ""); return; }
  const { error } = await sb.auth.signInWithIdToken({ provider: "google", token });
  if (error) { $("#authErr").textContent = errMsg(error); return; }
  start();
};
$("#pwForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const b = e.submitter; b.disabled = true;
  try {
    const a = $("#npw1").value, c = $("#npw2").value;
    if (a.length < 6) throw new Error("পাসওয়ার্ড কমপক্ষে ৬ অক্ষর দিন");
    if (a !== c) throw new Error("দুটো পাসওয়ার্ড মেলেনি");
    const { error } = await sb.auth.updateUser({ password: a });
    if (error) throw error;
    await rpc("clear_must_change_pw");
    toast("✅ নতুন পাসওয়ার্ড সেভ হয়েছে");
    start();
  } catch (er) { $("#authErr").textContent = errMsg(er); }
  b.disabled = false;
});
// Google দিয়ে নতুন অ্যাকাউন্ট: লিঙ্গ, ভাষা, জন্মতারিখ, রেফার কোড
const MONTHS_BN = ["জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন", "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর"];
function fillDob() {
  if ($("#obY").options.length) return;
  const y = new Date().getFullYear();
  $("#obD").innerHTML = `<option value="">তারিখ</option>` + Array.from({ length: 31 }, (_, i) => `<option>${i + 1}</option>`).join("");
  $("#obM").innerHTML = `<option value="">মাস</option>` + MONTHS_BN.map((m, i) => `<option value="${i + 1}">${m}</option>`).join("");
  $("#obY").innerHTML = `<option value="">সাল</option>` + Array.from({ length: 70 }, (_, i) => `<option>${y - 18 - i}</option>`).join("");
}
// কিছু ফোনে ঘরে চাপলে পেজ পাশে সরে যায় — সবসময় বাম দিকে ফিরিয়ে আনে
["focusin", "change", "scroll"].forEach((ev) => $("#auth").addEventListener(ev, () => { const a = $("#auth"); if (a.scrollLeft) a.scrollLeft = 0; if (document.scrollingElement.scrollLeft) document.scrollingElement.scrollLeft = 0; }, true));
function showOnboard() {
  $("#main").classList.add("hidden");
  $("#auth").classList.remove("hidden");
  authShow("onbForm");
  fillDob();
  $("input[name=obL][value=" + (window.getLang?.() === "en" ? "en" : "bn") + "]").checked = true;
}
document.querySelectorAll("input[name=obL]").forEach((r) => (r.onchange = () => window.setLang?.(r.value)));
$("#onbForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const b = e.submitter; b.disabled = true;
  try {
    const lg = $("input[name=obL]:checked")?.value ?? "bn";
    if (!$("input[name=obG]:checked")) throw new Error("ছেলে না মেয়ে বেছে নিন");
    const d = $("#obD").value, m = $("#obM").value, y = $("#obY").value;
    if (!d || !m || !y) throw new Error("জন্মতারিখ দিন (দিন, মাস, বছর)");
    const birth = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    await rpc("finish_onboarding", { p_gender: $("input[name=obG]:checked").value, p_lang: lg === "en" ? "English" : "Bengali", p_birth: birth, p_ref_no: $("#obRef").value.trim() });
    try { localStorage.setItem("lang", lg); } catch { /* */ }
    toast("স্বাগতম! 🎉");
    start();
  } catch (er) { $("#authErr").textContent = errMsg(er); }
  b.disabled = false;
});
$("#authLang").onclick = (e) => { e.preventDefault(); window.setLang?.(window.getLang?.() === "en" ? "bn" : "en"); };
$("#toReg").onclick = (e) => { e.preventDefault(); authShow("regForm"); };
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
  authShow("regForm");
  REG_FIELDS.forEach((k) => { if (d[k]) $("#" + k).value = d[k]; });
  if (d.rgCC) setTimeout(() => ($("#rgCC").value = d.rgCC), 0);
  if (d.g) { const g = document.querySelector(`input[name=rgG][value=${d.g}]`); if (g) g.checked = true; }
}
$("#toLogin").onclick = (e) => { e.preventDefault(); authShow("loginForm"); };

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
  if (me.needs_onboarding) rpc("finish_onboarding_skip").catch(() => {});
  const { data: pvt } = await sb.from("user_private").select("must_change_pw,temp_pw_expires").eq("user_id", session.user.id).maybeSingle();
  if (pvt?.must_change_pw) {
    if (pvt.temp_pw_expires && new Date(pvt.temp_pw_expires) < new Date()) { await sb.auth.signOut(); return showAuth("এককালীন পাসওয়ার্ডের মেয়াদ শেষ — সাপোর্ট থেকে নতুন একটি নিন"); }
    $("#main").classList.add("hidden"); $("#auth").classList.remove("hidden"); authShow("pwForm"); return;
  }
  S.me = me;
  try {
    const rn = localStorage.getItem("refNo");
    if (rn && !me.referred_by) rpc("set_referrer", { p_ref_no: rn }).then((r) => { S.me.referred_by = true; toast(`🎁 @${r.username}-এর রেফারে যুক্ত হয়েছেন`); }).catch(() => {}).finally(() => localStorage.removeItem("refNo"));
    else if (rn) localStorage.removeItem("refNo");
  } catch { /* */ }
  S.settings = Object.fromEntries((settings ?? []).map((s) => [s.key, s.value]));
  S.ads = Object.fromEntries((ads ?? []).map((a) => [a.key, a]));
  sb.from("vip_plans").select("*").order("sort").then(({ data }) => (S.vipPlans = data ?? []), () => {});
  // এডমিন রেট (কয়েনের দাম ইত্যাদি) বদলালে অ্যাপ খোলা থাকলেও কিছুক্ষণের মধ্যে নতুনটা দেখাবে
  if (!S.setTimer) {
    const reload = async () => { try { const { data } = await sb.from("settings").select("key,value"); if (data?.length) S.settings = Object.fromEntries(data.map((s) => [s.key, s.value])); } catch { /* */ } };
    S.setTimer = setInterval(reload, 120000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) reload(); });
  }
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
  if (!checkUpdate()) { requireLocation(); setTimeout(async () => { if (!(await checkinPopup())) offerPopup(); }, 2500); }
  setTimeout(() => { try { if (isPlay()) Native?.playRestore?.(); } catch { /* old APK */ } }, 3000);
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
      <p class="muted" translate="no">${esc(settingL("update_message", ""))}</p>
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
      if (document.hidden && notifOn()) { try { Native?.notify?.(trx(p.new.title), trx(p.new.body || "")); } catch { /* */ } }
    })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `receiver_id=eq.${S.me.id}` }, (p) => {
      if (S.chatWith === p.new.sender_id) { document.dispatchEvent(new CustomEvent("chatmsg", { detail: p.new })); return; }
      rpc("mark_delivered").catch(() => {});
      S.msgUnread = (S.msgUnread || 0) + 1; paintUnread();
      if (document.hidden && notifOn()) { try { Native?.notify?.(L("💬 নতুন মেসেজ", "💬 New message"), p.new.body); } catch { /* */ } }
      else toast("💬 নতুন মেসেজ");
    })
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter: `sender_id=eq.${S.me.id}` }, (p) => {
      document.dispatchEvent(new CustomEvent("msgupd", { detail: p.new }));
    })
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter: `receiver_id=eq.${S.me.id}` }, (p) => {
      document.dispatchEvent(new CustomEvent("msgupd", { detail: p.new }));
    })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "calls", filter: `callee_id=eq.${S.me.id}` }, (p) => incomingCall(p.new))
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "calls", filter: `callee_id=eq.${S.me.id}` }, (p) => document.dispatchEvent(new CustomEvent("callupd", { detail: p.new })))
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "calls", filter: `caller_id=eq.${S.me.id}` }, (p) => document.dispatchEvent(new CustomEvent("callupd", { detail: p.new })))
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
  const t = S.msgUnread || 0, nb = S.unread || 0;
  $("#unread").textContent = t ? (t > 99 ? "99+" : t) : "";
  document.querySelectorAll(".bell-n").forEach((b) => { b.textContent = nb ? (nb > 99 ? "99+" : nb) : ""; b.classList.toggle("hidden", !nb); });
}
// অ্যাপে কত সময় কাটছে (অ্যাডমিন অ্যানালিটিক্সের জন্য)
setInterval(() => { if (S.me && !document.hidden) rpc("track_time", { p_sec: 60 }).catch(() => {}); }, 60000);

// ---------------- router ----------------
const R = {};
let cleanup = null;
// পেজ মনে রাখা: আগে দেখা পেজে ফিরলে সাথে সাথে আগের চেহারা ও স্ক্রল দেখায়, নতুন ডাটা পেছনে লোড হয়ে চুপচাপ বসে
const PAGE_CACHE = new Map();
const CACHEABLE = new Set(["home", "me", "u", "rules", "wallet", "invite", "notifs", "inbox", "history", "level", "creator", "settings", "season", "vip", "store", "offers", "texts", "tags", "tag", "top", "myprofile", "agent", "cashin", "withdraw", "callprice", "contest", "at", "support"]);
let keepPage = null, lastPage = null;
(() => {
  const d = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
  Object.defineProperty(screen, "innerHTML", {
    get() { return d.get.call(this); },
    set(v) {
      if (keepPage && keepPage.hash === location.hash) {
        const html = String(v);
        if (html.length < 900 && html.includes('class="spinner"')) return; // লোড হওয়ার সময় পুরনো পেজই থাকুক
        const y = keepPage.scroll; keepPage = null;
        d.set.call(this, v);
        this.scrollTop = y; requestAnimationFrame(() => { if (this.scrollTop < y) this.scrollTop = y; });
        return;
      }
      d.set.call(this, v);
    },
  });
})();
function route() {
  if (!S.me) return;
  if (lastPage && CACHEABLE.has(lastPage.name) && !screen.querySelector(":scope > .page > .spinner:only-child")) {
    PAGE_CACHE.set(lastPage.hash, { html: screen.innerHTML, scroll: screen.scrollTop });
    if (PAGE_CACHE.size > 25) PAGE_CACHE.delete(PAGE_CACHE.keys().next().value);
  }
  keepPage = null;
  if (cleanup) { try { cleanup(); } catch { /* */ } cleanup = null; }
  closeSheet();
  bgmStop();
  let [name, a, b, c] = (location.hash.slice(1) || "home").split("/");
  if (!R[name]) name = "home";
  if (S.me.jailed && !["jail", "cashin", "history"].includes(name)) name = "jail";
  const TABS = { home: ["home", "golive", "live", "goparty", "party", "notifs", "post", "contest", "newphoto", "top", "tag", "tags", "at", "story", "newstory"], feed: ["feed", "following", "watch", "play"],
    me: ["me", "myprofile", "callprice", "seller", "creator", "support", "policy", "delacct", "invite", "rules", "settings", "vault", "edit", "level", "wallet", "history", "withdraw", "cashin", "inbox", "chat"] };
  document.querySelectorAll(".tabbar a").forEach((x) => x.classList.toggle("on", x.dataset.t === name || (TABS[x.dataset.t] ?? []).includes(name)));
  screen.classList.remove("full");
  $(".tabbar").classList.toggle("dark", TABS.feed.includes(name));
  try { Native?.setDarkBars?.(TABS.feed.includes(name)); } catch { /* old APK */ }
  lastPage = { name, hash: location.hash };
  const cached = CACHEABLE.has(name) && PAGE_CACHE.get(location.hash);
  if (cached) {
    keepPage = { hash: location.hash, scroll: cached.scroll };
    Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML").set.call(screen, cached.html);
    screen.scrollTop = cached.scroll;
  } else screen.scrollTop = 0;
  R[name](a, b, c);
}
window.addEventListener("hashchange", route);
const back = () => (history.length > 1 ? history.back() : (location.hash = "#home"));
// এডমিনের লেখা নোটিশ: English বেছে নিলে <key>_en থাকলে সেটা দেখায়
const settingL = (k, d = "") => window.getLang?.() === "en" ? (setting(k + "_en", "") || "") : setting(k, d);
// লঞ্চ অফার: অ্যাডমিন যে আয় লক করেছে সেখানে "শীঘ্রই আসছে"
const locked = (k) => (setting("income_locks", {}) || {})[k] === true;
const soon = () => `<b class="soon">🔒 শীঘ্রই আসছে</b>`;
// ব্রাউজারের confirm() এর বদলে অ্যাপের নিজের ডায়ালগ (উপরে ওয়েবসাইটের ঠিকানা দেখায় না)
function ask(msg, { ok = "ঠিক আছে", cancel = "বাতিল", danger = /মুছ|ডিলিট|লগআউট|শেষ|কেটে/.test(String(msg)) } = {}) {
  return new Promise((res) => {
    const d = document.createElement("div");
    d.className = "ask-bg";
    d.innerHTML = `<div class="ask-box" role="dialog"><p></p><div class="ask-btns"><button class="ask-no">${cancel}</button><button class="ask-yes${danger ? " danger" : ""}">${ok}</button></div></div>`;
    d.querySelector("p").textContent = String(msg);
    const done = (v) => { d.classList.add("out"); setTimeout(() => d.remove(), 150); res(v); };
    d.querySelector(".ask-no").onclick = () => done(false);
    d.querySelector(".ask-yes").onclick = () => done(true);
    d.onclick = (e) => { if (e.target === d) done(false); };
    document.body.appendChild(d);
  });
}
// sbar: স্ক্রল করলে লেখা যেন স্ট্যাটাস বারের নিচে না যায়
const header = (title, showBack = true) => `<div class="sbar"></div><h1>${showBack ? `<button class="back" onclick="history.back()">←</button>` : ""}${title}</h1>`;
const notice = () => (settingL("app_notice", "") ? `<div class="notice" translate="no">📢 ${esc(settingL("app_notice", ""))}</div>` : "");

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
  const st = { before: startId ? startId + 1 : null, loading: false, done: false, slides: [], active: null, swipes: 0, timer: null, boostQ: null, boostSeen: new Set(), spons: null, sponI: 0 };
  const mixIn = !user && type !== "following" && type !== "user";   // শুধু সাধারণ ফিডে বুস্ট/স্পন্সর মেশানো
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
      if (mixIn && st.boostQ === null) {
        st.boostQ = (await rpc("boosted_feed", { p_limit: 10 }).catch(() => [])) ?? [];
        const { data: sp } = await sb.from("sponsor_ads").select("*").in("placement", ["all", "feed"]).order("sort");
        st.spons = sp ?? [];
      }
      const bN = Math.max(2, Number(setting("boost_every_n", 4))), sN = Math.max(3, Number(setting("sponsor_every_n", 8)));
      const addSlide = (el) => { st.slides.push(el); feedEl.appendChild(el); obs.observe(el); };
      for (const v of rows) {
        const el = slideEl(v, st.slides.length);
        addSlide(el); newEls.push(el);
        if (!mixIn) continue;
        const pos = st.slides.length;
        if (st.spons?.length && pos % sN === 0) addSlide(sponsorSlide(st.spons[st.sponI++ % st.spons.length], st.slides.length));
        else if (pos % bN === 0) {
          const b = (st.boostQ ?? []).find((x) => !st.boostSeen.has(x.id));
          if (b) { st.boostSeen.add(b.id); const be = slideEl({ ...b, _boost: true }, st.slides.length); addSlide(be); newEls.push(be); }
        }
      }
      if (rows.length) sb.from("videos").select("id,music_id,music_start,fx,orig_muted,music_baked,music:music_id(url,title,artist)").in("id", rows.map((r) => r.id)).then(({ data }) => {
        for (const x of data ?? []) {
          const el = newEls.find((e) => e._v.id === x.id); if (!el) continue;
          el._x = x; el._v._x = x;
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
        ${v.user_id === S.me.id && setting("boost_enabled", true) !== false ? `<button class="act bst"><span class="ic">🚀</span><span class="c">বুস্ট</span></button>` : ""}
        ${v.user_id !== S.me.id ? `<button class="act rp"><span class="ic svg sm"><svg viewBox="0 0 24 24"><path d="M5 21V4M5 4.5h12l-2.5 4 2.5 4H5"/></svg></span></button>` : ""}
      </div>
      <div class="info">
        ${v._boost ? `<span class="boosttag">🚀 প্রমোটেড</span>` : ""}
        <div class="uname"><a href="#u/${v.user_id}">@${esc(v.username)}</a>${v.is_verified ? " ✔️" : ""}${v.is_premium ? `<span class="premtag">👑 ${n(v.premium_coins)}</span>` : ""}
          ${v.user_id !== S.me.id ? `<button class="follow-btn ${v.following ? "on" : ""}">${v.following ? "ফলোয়িং" : "ফলো"}</button>` : ""}</div>
        <div class="cap" translate="no">${rich(v.caption)}</div>
        <div class="tiny muted">👁 ${n(v.views_count)} · ${ago(v.created_at)}</div>
      </div>
      ${v.locked ? `<div class="lockov"><div><div class="crown">👑</div><h3 style="margin:6px 0">প্রিমিয়াম ভিডিও</h3>
        <div class="muted">🪙 ${n(v.premium_coins)} কয়েন দিয়ে দেখুন</div>
        <button class="btn unl">🪙 ${n(v.premium_coins)} কয়েনে দেখুন</button></div></div>` : ""}`;
    el.querySelector(".unl")?.addEventListener("click", async (e) => {
      if (!await ask(`${v.premium_coins} কয়েন দিয়ে ভিডিওটি দেখবেন?`)) return;
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
        if (video.paused) { video.play().catch(() => {}); el.querySelector(".paused-ic")?.remove(); if (el._x?.music?.url && !el._x.music_baked) bgmPlay(el._x.music.url, el._x.music_start || 0); }
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
    el.querySelector(".bst")?.addEventListener("click", () => boostSheet(v));
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
    if (!x?.music?.url || x.music_baked || el._v.locked) return bgmStop();
    const vd = el.querySelector("video");
    if (x.orig_muted) vd.muted = true;
    if (!vd.paused || vd.readyState < 2) bgmPlay(x.music.url, x.music_start || 0);
  }
  function setSrc(el, on) {
    if (!el || el._sponsor) return;
    const video = el.querySelector("video");
    if (on && !video.getAttribute("src") && el._v.video_url) { video.src = el._v.video_url; video.preload = "auto"; }
    if (!on && video.getAttribute("src")) { video.pause(); video.removeAttribute("src"); video.load(); }
  }

  function activate(el) {
    if (st.active === el) return;
    if (st.active) { st.active.querySelector("video")?.pause(); st.active.querySelector(".paused-ic")?.remove(); }
    if (el._sponsor) {
      st.active = el; bgmStop();
      if (!el._seen) { el._seen = true; rpc("sponsor_event", { p_id: el._sponsor.id, p_kind: "view" }).catch(() => {}); }
      if (Number(el.dataset.idx) >= st.slides.length - 3) more();
      return;
    }
    st.active = el;
    const idx = Number(el.dataset.idx);
    st.slides.forEach((s, i) => { if (!s._sponsor) setSrc(s, Math.abs(i - idx) <= 1 || (i === idx + 2)); });
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
    if (!el || document.hidden || el._sponsor) return;
    const video = el.querySelector("video");
    if (video.paused || video.readyState < 3) return;
    el._watched += 500;
    if (el._v.user_id === S.me.id) return;
    if (!el._sent && el._watched >= minWatch) {
      el._sent = true;
      rpc("record_view", { p_video_id: el._v.id, p_watch_ms: el._watched })
        .then((r) => { el._viewOk = !!r?.counted; })
        .catch(() => { el._sent = false; });
    }
    // পুরো ভিডিও দেখা হলে পয়েন্ট (ছোট-বড় সব ভিডিও)
    const durMs = (Number(el._v.duration_sec) || video.duration || 0) * 1000;
    if (el._viewOk && !el._claimed && durMs > 0 && el._watched >= durMs * Number(setting("watch_full_pct", 95)) / 100) {
      el._claimed = true;
      rpc("claim_watch_reward", { p_video_id: el._v.id, p_watch_ms: el._watched })
        .then((r) => { if (r?.points > 0 && !locked("watch")) toast(`⭐ পুরো ভিডিও দেখেছেন: +${r.points} পয়েন্ট`); else if (r?.reason === "too_fast") el._claimed = false; })
        .catch(() => { el._claimed = false; });
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
    if (!d || !await ask("কমেন্ট মুছবেন?")) return;
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

async function openGifts(el, isPost = false, liveRoom = null, toUser = null) {
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
      const r = liveRoom ? await rpc("live_gift", { p_room: liveRoom, p_gift_id: sel.id, p_qty: qty, p_idem: uuid(), p_to: toUser })
        : isPost ? await rpc("send_post_gift", { p_post: v.id, p_gift_id: sel.id, p_qty: qty, p_idem: uuid() })
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
  return `${base}?ref=${S.me?.user_no ?? ""}${isEn() ? "&lang=en" : ""}`;
}
// ভিডিওর নিজের পেজ (লিংক খুললেই ভিডিও চলে, তারপর অ্যাপ ডাউনলোড) — প্রিমিয়াম হলে সাধারণ ডাউনলোড পেজ
function videoLink(v) {
  if (v.is_premium) return shareLink();
  const base = String(setting("share_link", "") || "https://akashpattadar19-cell.github.io/reels-admin/get/").replace(/get\/?(index\.html)?$/, "v/");
  return `${base}?id=${v.id}&ref=${S.me?.user_no ?? ""}${isEn() ? "&lang=en" : ""}`;
}
async function doShare(el) {
  const v = el._v;
  const text = `${v.caption ? v.caption + "\n\n" : ""}${L(`🎬 @${v.username}-এর ভিডিওটা দেখুন 👇\n`, `🎬 Watch @${v.username}'s video 👇\n`)}${videoLink(v)}`;
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
// ---------------- ভিডিও আপলোড + এডিটর ----------------
const EMOJIS = "😀 😂 🤣 😍 🥰 😘 😎 🤩 🥳 😇 🤔 😢 😭 😡 🤯 😱 👍 👏 🙏 💪 ✌️ 👌 ❤️ 🧡 💛 💚 💙 💜 🖤 💔 🔥 ✨ ⭐ 🌟 💯 🎉 🎂 🎁 🌹 🌸 🌙 ☀️ 🌈 ⚡ 💥 🎵 🎶 📍 🇧🇩 🇸🇦 🕌 ☕ 🍔 🚗 ✈️ 🏆 👑 💎 💰".split(" ");
const TXT_COLORS = ["#ffffff", "#000000", "#facc15", "#ef4444", "#22c55e", "#3b82f6", "#ec4899", "#a855f7"];
const CROP_RATIOS = [["orig", "মূল", 0], ["9:16", "9:16", 9 / 16], ["1:1", "1:1", 1], ["4:5", "4:5", 4 / 5], ["3:4", "3:4", 3 / 4], ["16:9", "16:9", 16 / 9]];

R.upload = () => {
  const maxSec = Number(setting("max_video_sec", 90));
  const pro = !!Native?.editAndUpload;
  screen.innerHTML = `<div class="page">${header("আপলোড", false)}
    <div class="seg" style="margin-top:0"><button class="on">🎬 ভিডিও</button><button onclick="location.hash='#newphoto'">📷 ফটো</button><button onclick="location.hash='#newstory'">📖 স্টোরি</button><button onclick="location.hash='#texts';setTimeout(()=>document.getElementById('newT')?.click(),300)">✍️ লেখা</button></div>
    <label class="pick" id="pickL"><input type="file" id="vf" accept="video/*" class="hidden"><div class="ic">🎬</div>
      <b>ভিডিও বেছে নিন</b><div class="muted tiny">${pro ? `লম্বা ভিডিও কেটে ${maxSec} সেকেন্ডের মধ্যে আনা যাবে` : `সর্বোচ্চ ${maxSec} সেকেন্ড`} · খাড়া (9:16) ভিডিও সবচেয়ে ভালো দেখায়</div></label>
    ${pro ? "" : `<p class="notice tiny">✂️ ভিডিও কাটা, ক্রপ, স্টিকার ও নিজের গান যোগ করতে অ্যাপ আপডেট করুন।</p>`}
    <div class="up-rule">${Number(setting("upload_reward_coins", 0)) > 0 && !locked("upload") ? `<b>🪙 প্রতিটা ভিডিও অনুমোদন হলে +${n(setting("upload_reward_coins", 0))} কয়েন!</b>` : `<b>📋 ভিডিও আপলোডের নিয়ম</b>`}
      <div>✅ নিজের তোলা আসল ভিডিও দিন</div>
      <div>❌ ওয়াটারমার্ক, TikTok / অন্য অ্যাপের লোগো, কোনো পেজের নাম থাকলে বাতিল হবে</div>
      <div>👀 এডমিন দেখে অনুমোদন করলে তবেই সবাই দেখতে পাবে</div></div>
    <div id="ved"></div>
    <video id="pv" class="preview hidden" controls playsinline></video>
    <div id="mtools" class="hidden"></div>
    <label class="lbl">ক্যাটাগরি</label>
    <select id="cat">${CATS.filter(([k]) => k && k !== "premium").map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select>
    ${S.me.account_type !== "host" && S.me.role !== "admin" && String(setting("premium_upload_hosts_only", true)) === "true"
      ? `<p class="tiny muted" style="margin-top:12px">👑 প্রিমিয়াম ভিডিও শুধু হোস্টরা দিতে পারবে — সেটিংস থেকে হোস্ট হতে আবেদন করুন।</p><input type="checkbox" id="prem" class="hidden"><div id="premBox" class="hidden"><input id="premC"></div>` : `
    <div class="card" style="margin-top:12px">
      <label class="toggle"><span><b>👑 প্রিমিয়াম ভিডিও</b><div class="tiny muted">দর্শক কয়েন দিয়ে দেখবে, আপনি পাবেন ${n(setting("premium_creator_pct", 60))}%। অনুমোদিত হোস্টরা ফ্রি দেখবে। অ্যাডমিন দেখে অনুমোদন দেবেন।</div></span><input type="checkbox" id="prem"></label>
      <div id="premBox" class="hidden"><span class="lbl">কত কয়েন লাগবে</span><input id="premC" type="number" min="1" max="100000" value="${Number(setting("premium_default_coins", 10))}">
        <p class="notice tiny" translate="no">⚠️ ${esc(settingL("premium_notice", ""))}</p></div></div>`}
    <label class="lbl">ক্যাপশন (#হ্যাশট্যাগ, @মেনশন দিন)</label>
    <textarea id="cap" maxlength="2200" placeholder="ভিডিও সম্পর্কে লিখুন… #funny #bangla"></textarea>
    <button class="btn primary" id="up" disabled>আপলোড করুন</button>
    <div class="progress hidden" id="pg"><div></div></div>
    <p id="msg" class="muted tiny"></p>
    <p class="muted tiny" id="quota"></p>
    <p class="muted tiny">আপলোডের পর ভিডিও অল্প সময় পর্যালোচনায় থাকবে, তারপর সবাই দেখতে পাবে।</p>
    <p class="muted tiny">অশ্লীল, সহিংস বা অন্যের কপিরাইট করা ভিডিও বা গান আপলোড করলে অ্যাকাউন্ট ব্লক ও ইনকাম বাতিল হবে।</p></div>`;
  attachSuggest($("#cap"));
  if (S.tagDraft) { $("#cap").value = S.tagDraft; S.tagDraft = null; }
  const vf = $("#vf"), pv = $("#pv");
  let file = null, duration = 0, mt = null, ed = null;
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
    const url = URL.createObjectURL(file);
    const pk = $("#pickL"); pk.classList.add("pick-sm"); pk.querySelector("b").textContent = "🎬 অন্য ভিডিও বেছে নিন";
    if (pro) {
      pv.classList.add("hidden");
      ed = videoEditor($("#ved"), url, maxSec, (ok) => ($("#up").disabled = !ok));
      return;
    }
    pv.src = url; pv.classList.remove("hidden");
    pv.onloadedmetadata = () => {
      duration = Math.round(pv.duration || 0);
      if (duration > maxSec + 1) { toast(`ভিডিও ${duration} সেকেন্ড — সর্বোচ্চ ${maxSec} সেকেন্ড`, true); file = null; $("#up").disabled = true; return; }
      $("#up").disabled = false;
      $("#msg").textContent = `${duration} সেকেন্ড · ${(file.size / 1048576).toFixed(1)}MB`;
      if (!mt) { $("#mtools").classList.remove("hidden"); mt = mediaTools($("#mtools"), pv, { kind: "video" }); }
    };
  };
  const finish = async (id, extras) => {
    await rpc("set_video_category", { p_id: id, p_category: $("#cat").value }).catch(() => {});
    if (extras) await rpc("set_media_extras", extras(id)).catch(() => {});
    const prem = $("#prem").checked;
    if (prem) await rpc("set_video_premium", { p_video: id, p_premium: true, p_coins: Number($("#premC").value) || null });
    bgmStop();
    const mins = Number(setting("auto_approve_minutes", 2));
    toast(prem ? "আপলোড হয়েছে ✅ প্রিমিয়াম ভিডিও অ্যাডমিন অনুমোদনের পর প্রকাশিত হবে" : mins > 0 ? `আপলোড হয়েছে ✅ ${mins} মিনিটের মধ্যে প্রকাশিত হবে` : "আপলোড হয়েছে ✅ অ্যাডমিন অ্যাপ্রুভ করলে প্রকাশিত হবে");
    setTimeout(() => (location.hash = "#u/" + S.me.id), 900);
  };
  $("#up").onclick = async () => {
    if (!file) return;
    const btn = $("#up"); btn.disabled = true;
    const pg = $("#pg"); pg.classList.remove("hidden");
    const setP = (x, m) => { pg.firstElementChild.style.width = Math.round(x) + "%"; $("#msg").textContent = m; };
    try {
      if (pro && ed) {
        ed.pause();
        const spec = await ed.spec();
        const stamp = Date.now();
        const vPath = `${S.me.id}/${stamp}.mp4`, tPath = `${S.me.id}/${stamp}.jpg`;
        const { data: { session } } = await sb.auth.getSession();
        spec.up = { base: SUPABASE_URL, key: SUPABASE_KEY, token: session.access_token, vPath, tPath };
        const res = await new Promise((resolve, reject) => {
          window.onEditState = (st) => {
            if (st.state === "processing") setP(st.p * 0.6, `🎬 ভিডিও তৈরি হচ্ছে… ${st.p}%`);
            else if (st.state === "uploading") setP(60 + st.p * 0.38, `⬆️ আপলোড হচ্ছে… ${st.p}%`);
            else if (st.state === "done") resolve(st.x || {});
            else if (st.state === "busy") reject(new Error("আগের কাজ শেষ হতে দিন"));
            else if (st.state === "error") reject(new Error(st.x === "music" ? "গান লোড করা যায়নি" : st.x === "upload" ? "আপলোড হয়নি — ইন্টারনেট দেখুন" : st.x === "nofile" ? "ভিডিওটি আবার বেছে নিন" : "এই ভিডিও এডিট করা যায়নি — অন্য ভিডিও চেষ্টা করুন"));
          };
          Native.editAndUpload(JSON.stringify(spec));
        });
        setP(99, "শেষ করা হচ্ছে…");
        const vUrl = sb.storage.from("videos").getPublicUrl(vPath).data.publicUrl;
        const tUrl = res.thumb ? sb.storage.from("thumbs").getPublicUrl(tPath).data.publicUrl : null;
        const id = await rpc("create_video", { p_video_path: vPath, p_video_url: vUrl, p_thumb_url: tUrl, p_caption: $("#cap").value, p_duration: res.dur || spec._len });
        if (spec._frame) await rpc("set_video_frame", { p_video: id, p_frame: spec._frame }).catch(() => {});
        setP(100, "✅ আপলোড সম্পন্ন!");
        await finish(id, spec._libMusic ? (vid) => ({ p_kind: "video", p_id: vid, p_music: spec._libMusic, p_start: Math.round((spec.music?.s || 0) / 1000), p_fx: null, p_mute: false, p_baked: true }) : null);
        return;
      }
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
      setP(100, "✅ আপলোড সম্পন্ন!");
      await finish(id, mt && (mt.music || !fxEmpty(mt.fx)) ? (vid) => ({ p_kind: "video", p_id: vid, p_music: mt.music?.id ?? null, p_start: mt.start, p_fx: fxEmpty(mt.fx) ? null : mt.fx, p_mute: !!mt.mute, p_baked: false }) : null);
    } catch (e) { toast(errMsg(e), true); $("#msg").textContent = "ব্যর্থ: " + errMsg(e); btn.disabled = false; }
  };
};

// প্রো ভিডিও এডিটর (APK ≥ 1.0.16): কাটা · ক্রপ · স্টিকার · লেখা · গান · সাউন্ড · ফিল্টার
function videoEditor(box, url, maxSec, onValid) {
  const E = { s: 0, e: 0, dur: 0, ratio: "orig", px: 0.5, py: 0.5, stickers: [], sel: null, music: null, mS: 0, mVol: 100, oVol: 100, fx: { f: "none", b: 100, c: 100, s: 100 } };
  box.innerHTML = `<div class="ved">
    <div class="ved-wrap"><div class="ved-stage" id="vs"><video id="vv" playsinline loop src="${url}"></video><div class="ved-ov" id="vo"></div></div></div>
    <div class="ved-play"><button type="button" id="vpp">▶</button><span id="vtime">0:00</span><div class="ved-bar" id="vbar"><i id="vbsel"></i><b id="vbcur"></b></div><span id="vlen"></span></div>
    <div class="ved-tabs" id="vt">${[["trim", "✂️", "কাটুন"], ["crop", "⛶", "ক্রপ"], ["emoji", "😀", "ইমোজি"], ["text", "Aa", "লেখা"], ["music", "🎵", "গান"], ["sound", "🔊", "সাউন্ড"], ["fx", "🎨", "ফিল্টার"]]
      .map(([k, i, l], j) => `<button type="button" data-t="${k}" class="${j === 0 ? "on" : ""}"><b>${i}</b><span>${l}</span></button>`).join("")}</div>
    <div class="ved-panel" id="vp"></div></div>`;
  const v = $("#vv", box), stage = $("#vs", box), ov = $("#vo", box);
  let tab = "trim";
  const len = () => Math.max(0, E.e - E.s);
  const valid = () => E.dur > 0 && len() >= 1 && len() <= maxSec + 0.5;
  const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
  const ratioVal = () => CROP_RATIOS.find((r) => r[0] === E.ratio)?.[2] || (v.videoWidth ? v.videoWidth / v.videoHeight : 9 / 16);
  const layout = () => {
    const r = ratioVal();
    stage.style.aspectRatio = String(r);
    stage.style.width = `min(100%, ${(56 * r).toFixed(2)}vh)`;
    v.style.objectPosition = `${E.px * 100}% ${E.py * 100}%`;
    v.style.filter = fxCss(E.fx);
    v.volume = E.oVol / 100; BGM.volume = E.mVol / 100;
  };
  const bar = () => {
    if (!E.dur) return;
    $("#vbsel", box).style.left = (E.s / E.dur) * 100 + "%"; $("#vbsel", box).style.width = (len() / E.dur) * 100 + "%";
    $("#vbcur", box).style.left = (v.currentTime / E.dur) * 100 + "%";
    $("#vtime", box).textContent = fmt(v.currentTime); $("#vlen", box).textContent = `${fmt(len())}${len() > maxSec + 0.5 ? " ⚠️" : ""}`;
  };
  const musicStart = () => { if (E.music) bgmPlay(E.music.url, E.mS + Math.max(0, v.currentTime - E.s)); };
  v.addEventListener("loadedmetadata", () => {
    E.dur = v.duration || 0; E.e = Math.min(E.dur, maxSec);
    layout(); bar(); panel(); onValid(valid());
    if (E.dur > maxSec + 0.5) toast(`ভিডিও ${Math.round(E.dur)} সেকেন্ড — "কাটুন" দিয়ে ${maxSec} সেকেন্ডের মধ্যে আনুন`);
  });
  v.addEventListener("timeupdate", () => { if (v.currentTime > E.e || v.currentTime < E.s - 0.3) { v.currentTime = E.s; if (E.music && !v.paused) bgmPlay(E.music.url, E.mS); } bar(); });
  v.addEventListener("play", () => { $("#vpp", box).textContent = "⏸"; S.muted = false; if (E.music) { BGM.pause(); BGM._url = null; musicStart(); } });
  v.addEventListener("pause", () => { $("#vpp", box).textContent = "▶"; BGM.pause(); });
  $("#vpp", box).onclick = () => (v.paused ? v.play().catch(() => {}) : v.pause());
  $("#vbar", box).onclick = (e) => { const r = $("#vbar", box).getBoundingClientRect(); v.currentTime = Math.max(E.s, Math.min(E.e, ((e.clientX - r.left) / r.width) * E.dur)); };
  // ক্রপ: ভিডিও টেনে সরানো
  let drag = null;
  v.addEventListener("pointerdown", (e) => { if (tab !== "crop" || E.ratio === "orig") return; drag = { x: e.clientX, y: e.clientY, px: E.px, py: E.py }; v.setPointerCapture(e.pointerId); });
  v.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const r = stage.getBoundingClientRect(), vr = v.videoWidth / v.videoHeight, sr = ratioVal();
    if (vr > sr) E.px = Math.max(0, Math.min(1, drag.px - (e.clientX - drag.x) / (r.width * (vr / sr - 1) || 1)));
    else E.py = Math.max(0, Math.min(1, drag.py - (e.clientY - drag.y) / (r.height * (sr / vr - 1) || 1)));
    layout();
  });
  v.addEventListener("pointerup", () => (drag = null));
  // স্টিকার
  const drawStickers = () => {
    ov.innerHTML = E.stickers.map((st, i) => `<div class="stk ${E.sel === i ? "sel" : ""} ${st.t === "text" ? "txt" : ""}" data-i="${i}" style="left:${st.x * 100}%;top:${st.y * 100}%;font-size:${st.size * stage.clientWidth}px;${st.t === "text" ? `color:${st.color};${st.bg ? `background:${st.color === "#ffffff" ? "rgba(0,0,0,.55)" : "rgba(255,255,255,.85)"};` : ""}` : ""}">${esc(st.v)}</div>`).join("");
  };
  let sd = null;
  ov.addEventListener("pointerdown", (e) => {
    const el = e.target.closest(".stk"); if (!el) return;
    const i = Number(el.dataset.i); E.sel = i; sd = { i, x: e.clientX, y: e.clientY, sx: E.stickers[i].x, sy: E.stickers[i].y };
    el.setPointerCapture(e.pointerId); drawStickers(); if (tab === "emoji" || tab === "text") panel();
  });
  ov.addEventListener("pointermove", (e) => {
    if (!sd) return;
    const r = stage.getBoundingClientRect(), st = E.stickers[sd.i];
    st.x = Math.max(0.03, Math.min(0.97, sd.sx + (e.clientX - sd.x) / r.width)); st.y = Math.max(0.03, Math.min(0.97, sd.sy + (e.clientY - sd.y) / r.height));
    const el = ov.querySelector(`[data-i="${sd.i}"]`); if (el) { el.style.left = st.x * 100 + "%"; el.style.top = st.y * 100 + "%"; }
  });
  ov.addEventListener("pointerup", () => (sd = null));
  const selTools = () => E.sel != null && E.stickers[E.sel] ? `<div class="ved-sel"><span>নির্বাচিত: <b>${esc(E.stickers[E.sel].v.slice(0, 12))}</b></span>
      <label class="tiny">সাইজ</label><input type="range" id="ssz" min="4" max="40" value="${Math.round(E.stickers[E.sel].size * 100)}"><button type="button" class="btn small" id="sdel">🗑️ মুছুন</button></div>` : `<p class="tiny muted">স্টিকারে চেপে ধরে টেনে জায়গা বদলান</p>`;
  const bindSel = () => {
    $("#ssz", box)?.addEventListener("input", (e) => { E.stickers[E.sel].size = Number(e.target.value) / 100; drawStickers(); });
    $("#sdel", box)?.addEventListener("click", () => { E.stickers.splice(E.sel, 1); E.sel = null; drawStickers(); panel(); });
  };
  function panel() {
    const P = $("#vp", box);
    box.querySelectorAll("#vt button").forEach((b) => b.classList.toggle("on", b.dataset.t === tab));
    stage.classList.toggle("cropping", tab === "crop" && E.ratio !== "orig");
    if (tab === "trim") {
      P.innerHTML = `<div class="tiny muted">পুরো ভিডিও ${fmt(E.dur)} · রাখবেন <b>${fmt(len())}</b> (সর্বোচ্চ ${fmt(maxSec)})</div>
        <label class="tiny">শুরু: <b id="ts">${fmt(E.s)}</b></label><input type="range" id="trs" min="0" max="${E.dur.toFixed(1)}" step="0.1" value="${E.s}">
        <label class="tiny">শেষ: <b id="te">${fmt(E.e)}</b></label><input type="range" id="tre" min="0" max="${E.dur.toFixed(1)}" step="0.1" value="${E.e}">
        <div class="row-btns"><button type="button" class="btn small" id="tsNow">⏱ এখান থেকে শুরু</button><button type="button" class="btn small" id="teNow">⏱ এখানে শেষ</button></div>`;
      const upd = () => { $("#ts", box).textContent = fmt(E.s); $("#te", box).textContent = fmt(E.e); bar(); onValid(valid()); P.querySelector(".tiny b").textContent = fmt(len()); };
      $("#trs", box).oninput = (e) => { E.s = Math.min(Number(e.target.value), E.e - 1); e.target.value = E.s; v.currentTime = E.s; upd(); };
      $("#tre", box).oninput = (e) => { E.e = Math.max(Number(e.target.value), E.s + 1); e.target.value = E.e; v.currentTime = Math.max(E.s, E.e - 2); upd(); };
      $("#tsNow", box).onclick = () => { E.s = Math.min(v.currentTime, E.e - 1); $("#trs", box).value = E.s; upd(); };
      $("#teNow", box).onclick = () => { E.e = Math.max(v.currentTime, E.s + 1); $("#tre", box).value = E.e; upd(); };
    } else if (tab === "crop") {
      P.innerHTML = `<div class="ved-chips">${CROP_RATIOS.map(([k, l, r]) => `<button type="button" data-r="${k}" class="${E.ratio === k ? "on" : ""}">${FRAME_ICON(r)}${l}</button>`).join("")}</div>
        <p class="tiny muted">${E.ratio === "orig" ? "মূল সাইজে পুরো ভিডিও থাকবে" : "👆 ভিডিও টেনে কোন অংশ রাখবেন ঠিক করুন — বাইরের অংশ কেটে যাবে"}</p>`;
      P.querySelectorAll("[data-r]").forEach((b) => (b.onclick = () => { E.ratio = b.dataset.r; E.px = 0.5; E.py = 0.5; layout(); drawStickers(); panel(); }));
    } else if (tab === "emoji") {
      P.innerHTML = `<div class="ved-emojis">${EMOJIS.map((x) => `<button type="button" data-e="${x}">${x}</button>`).join("")}</div>${selTools()}`;
      P.querySelectorAll("[data-e]").forEach((b) => (b.onclick = () => { E.stickers.push({ t: "emoji", v: b.dataset.e, x: 0.5, y: 0.4, size: 0.16 }); E.sel = E.stickers.length - 1; drawStickers(); panel(); }));
      bindSel();
    } else if (tab === "text") {
      P.innerHTML = `<div class="row" style="gap:6px"><input id="tx" maxlength="60" placeholder="ভিডিওর উপর লেখা…" style="flex:1;margin:0"><button type="button" class="btn small primary" id="txAdd" style="width:auto;margin:0">যোগ</button></div>
        <div class="ved-colors">${TXT_COLORS.map((c, i) => `<button type="button" data-c="${c}" style="background:${c}" class="${i === 0 ? "on" : ""}"></button>`).join("")}<label class="tiny"><input type="checkbox" id="txBg" checked style="width:auto"> পটভূমি</label></div>${selTools()}`;
      let col = TXT_COLORS[0];
      P.querySelectorAll("[data-c]").forEach((b) => (b.onclick = () => { col = b.dataset.c; P.querySelectorAll("[data-c]").forEach((x) => x.classList.toggle("on", x === b)); const st = E.stickers[E.sel]; if (st?.t === "text") { st.color = col; drawStickers(); } }));
      $("#txAdd", box).onclick = () => { const t = $("#tx", box).value.trim(); if (!t) return; E.stickers.push({ t: "text", v: t, x: 0.5, y: 0.75, size: 0.07, color: col, bg: $("#txBg", box).checked }); E.sel = E.stickers.length - 1; $("#tx", box).value = ""; drawStickers(); panel(); };
      bindSel();
    } else if (tab === "music") {
      const md = E.music?.duration_sec || 0, maxStart = Math.max(0, md - Math.min(len(), md));
      P.innerHTML = `<div class="row-btns"><button type="button" class="btn small" id="mLib">🎵 অ্যাপের গান</button><label class="btn small">📁 ফোনের গান<input type="file" id="mOwn" accept="audio/*" class="hidden"></label>${E.music ? `<button type="button" class="btn small" id="mRm">🚫 বাদ</button>` : ""}</div>
        ${E.music ? `<div class="ved-song"><span class="disc">🎵</span><span><b translate="no">${esc(E.music.title)}</b><small translate="no">${E.music.local ? "📁 আপনার ফোন থেকে" : esc(E.music.artist ?? "")} · ${fmt(md)}</small></span></div>
          <label class="tiny">✂️ গানের কোন অংশ বাজবে: <b id="mseg">${fmt(E.mS)} – ${fmt(Math.min(md, E.mS + len()))}</b></label>
          <input type="range" id="mst" min="0" max="${maxStart.toFixed(1)}" step="0.5" value="${Math.min(E.mS, maxStart)}">
          <div class="ved-wave" id="mwave"><i style="left:${md ? (E.mS / md) * 100 : 0}%;width:${md ? (Math.min(len(), md) / md) * 100 : 100}%"></i></div>
          <p class="tiny muted">স্লাইডার সরিয়ে গানের পছন্দের অংশ বাছুন। ▶ চেপে ভিডিওর সাথে শুনে দেখুন।</p>`
        : `<p class="tiny muted">অ্যাপের তালিকা থেকে গান বাছুন, অথবা নিজের ফোনের গান দিন। নিজের গান দিলে তা যেন আপনার নিজের বা অনুমতিপ্রাপ্ত হয়।</p>`}`;
      $("#mLib", box).onclick = async () => { v.pause(); const r = await pickMusic(E.music?.local ? null : E.music); if (r === "remove") E.music = null; else if (r?.music) { E.music = r.music; E.mS = 0; } panel(); };
      $("#mOwn", box).onchange = (e) => {
        const f = e.target.files[0]; if (!f) return;
        if (f.size > 20 * 1048576) return toast("গানের ফাইল 20MB-এর বেশি", true);
        const a = new Audio(URL.createObjectURL(f));
        a.onloadedmetadata = () => { E.music = { local: true, title: (f.name || L("আমার গান", "My song")).replace(/\.[^.]+$/, "").slice(0, 60), url: a.src, duration_sec: Math.round(a.duration || 0) }; E.mS = 0; panel(); v.currentTime = E.s; v.play().catch(() => {}); };
        a.onerror = () => toast("এই গানের ফাইল চালানো যায়নি", true);
      };
      $("#mRm", box)?.addEventListener("click", () => { E.music = null; bgmStop(); panel(); });
      $("#mst", box)?.addEventListener("input", (e) => { E.mS = Number(e.target.value); $("#mseg", box).textContent = `${fmt(E.mS)} – ${fmt(Math.min(md, E.mS + len()))}`; $("#mwave i", box).style.left = (md ? (E.mS / md) * 100 : 0) + "%"; });
      $("#mst", box)?.addEventListener("change", () => { v.currentTime = E.s; if (!v.paused) musicStart(); else v.play().catch(() => {}); });
    } else if (tab === "sound") {
      P.innerHTML = `<label class="tiny">🎬 ভিডিওর আসল সাউন্ড: <b id="ovv">${E.oVol}%</b></label><input type="range" id="ovr" min="0" max="100" value="${E.oVol}">
        <label class="tiny">🎵 গানের সাউন্ড: <b id="mvv">${E.mVol}%</b></label><input type="range" id="mvr" min="0" max="100" value="${E.mVol}" ${E.music ? "" : "disabled"}>
        <p class="tiny muted">${E.music ? "আসল সাউন্ড ০% করলে শুধু গান শোনা যাবে।" : "গান যোগ করলে দুটোর ভলিউম আলাদা করে ঠিক করতে পারবেন।"}</p>`;
      $("#ovr", box).oninput = (e) => { E.oVol = Number(e.target.value); $("#ovv", box).textContent = E.oVol + "%"; layout(); };
      $("#mvr", box).oninput = (e) => { E.mVol = Number(e.target.value); $("#mvv", box).textContent = E.mVol + "%"; layout(); };
    } else if (tab === "fx") {
      P.innerHTML = `<div class="fxrow">${FX_PRESETS.map(([k, l, c]) => `<button type="button" data-f="${k}" class="${E.fx.f === k ? "on" : ""}"><i style="filter:${c}"></i><span>${l}</span></button>`).join("")}</div>
        ${[["b", "☀️ উজ্জ্বলতা"], ["c", "◐ কনট্রাস্ট"], ["s", "🌈 রং"]].map(([k, l]) => `<label class="tiny">${l} <b id="fv${k}">${E.fx[k]}%</b></label><input type="range" min="50" max="150" value="${E.fx[k]}" data-k="${k}">`).join("")}`;
      P.querySelectorAll("[data-f]").forEach((b) => (b.onclick = () => { E.fx.f = b.dataset.f; P.querySelectorAll("[data-f]").forEach((x) => x.classList.toggle("on", x === b)); layout(); }));
      P.querySelectorAll("input[data-k]").forEach((r) => (r.oninput = () => { E.fx[r.dataset.k] = Number(r.value); $("#fv" + r.dataset.k, box).textContent = r.value + "%"; layout(); }));
    }
  }
  box.querySelector("#vt").onclick = (e) => { const b = e.target.closest("[data-t]"); if (!b) return; tab = b.dataset.t; panel(); };
  window.addEventListener("resize", drawStickers);
  return {
    pause: () => { v.pause(); bgmStop(); },
    async spec() {
      const vw = v.videoWidth, vh = v.videoHeight, vr = vw / vh, sr = ratioVal();
      let crop = null;
      if (E.ratio !== "orig" && vw) {
        if (vr > sr) { const w = sr / vr; crop = { x: (1 - w) * E.px, y: 0, w, h: 1 }; } else { const h = vr / sr; crop = { x: 0, y: (1 - h) * E.py, w: 1, h }; }
      }
      let overlay = "";
      if (E.stickers.length) {
        const W = 1080, H = Math.round(W / sr), c = document.createElement("canvas"); c.width = W; c.height = H;
        const cx = c.getContext("2d"); cx.textAlign = "center"; cx.textBaseline = "middle";
        for (const st of E.stickers) {
          const fs = st.size * W, x = st.x * W, y = st.y * H;
          if (st.t === "emoji") { cx.font = `${fs}px sans-serif`; cx.fillText(st.v, x, y); continue; }
          cx.font = `700 ${fs}px sans-serif`;
          if (st.bg) { const tw = cx.measureText(st.v).width; cx.fillStyle = st.color === "#ffffff" ? "rgba(0,0,0,.55)" : "rgba(255,255,255,.85)"; cx.beginPath(); cx.roundRect?.(x - tw / 2 - fs * 0.3, y - fs * 0.7, tw + fs * 0.6, fs * 1.4, fs * 0.3); cx.fill(); }
          cx.fillStyle = st.color; cx.fillText(st.v, x, y);
        }
        overlay = c.toDataURL("image/png");
      }
      const md = E.music?.duration_sec || 0;
      const fr = CROP_RATIOS.find((r) => r[0] === E.ratio);
      return {
        trim: { s: Math.round(E.s * 1000), e: Math.round(E.e * 1000) }, crop, overlay, fx: fxEmpty(E.fx) ? null : E.fx,
        music: E.music ? { src: E.music.local ? "local" : "url", url: E.music.local ? "" : E.music.url, s: Math.round(E.mS * 1000), e: Math.round(Math.min(md || 1e6, E.mS + len()) * 1000) } : null,
        ov: E.oVol / 100, mv: E.mVol / 100,
        _libMusic: E.music && !E.music.local ? E.music.id : null, _len: Math.round(len()),
        _frame: fr && FRAMES.some((f) => f[0] === E.ratio) ? E.ratio : null,
      };
    },
  };
}

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
  points_convert: "পয়েন্ট → টাকা", pending_release: "পেন্ডিং থেকে ব্যালেন্সে", cash_in: "ক্যাশ-ইন (কয়েন)", play_purchase: "Google Play থেকে কয়েন কেনা", vip_purchase: "💎 VIP কেনা", vip_daily: "💎 VIP ফ্রি কয়েন", store_purchase: "🎨 দোকান থেকে কেনা", video_boost: "🚀 ভিডিও বুস্ট", reward_pool: "💰 রিওয়ার্ড পুল", upload_reward: "🎬 ভিডিও আপলোড পুরস্কার", season_prize: "🏆 প্রতিযোগিতার পুরস্কার", admin_coin_grant: "🎁 অ্যাডমিন থেকে কয়েন", checkin_reward: "📅 চেক-ইন পুরস্কার", ref_topup_bonus: "🎁 বন্ধুর কয়েন কেনায় কমিশন", starter_reward: "🎯 নতুনদের কাজের পুরস্কার", agent_target_bonus: "🧑‍💼 এজেন্ট টার্গেট বোনাস", withdraw_hold: "উইথড্র রিকোয়েস্ট",
  withdraw_refund: "উইথড্র ফেরত", admin_adjust: "অ্যাডমিন অ্যাডজাস্টমেন্ট", premium_unlock: "প্রিমিয়াম ভিডিও আনলক", welcome_bonus: "নতুন ইউজার বোনাস", jail_release: "জেল থেকে মুক্তি",
};
// ================= আয়ের নতুন ফিচার: স্পন্সর, বুস্ট, VIP, দোকান, রিওয়ার্ড পুল =================
const openLink = (url) => { if (!url) return; if (url.startsWith("#")) location.hash = url; else location.href = url; };

// রিলের ভেতরে স্পন্সর স্লাইড
function sponsorSlide(ad, idx) {
  const el = document.createElement("div");
  el.className = "slide sponsor-slide";
  el.dataset.idx = idx;
  el._sponsor = ad;
  el._v = { id: -ad.id, user_id: S.me.id };
  el.innerHTML = `<img class="sp-img" src="${esc(ad.image_url)}" alt="">
    <div class="sp-info"><span class="sp-tag">স্পন্সরড</span><b translate="no">${esc(ad.title)}</b>
      ${ad.link_url ? `<button class="btn sp-go">আরও জানুন ›</button>` : ""}</div>`;
  el.querySelector(".sp-go")?.addEventListener("click", () => { rpc("sponsor_event", { p_id: ad.id, p_kind: "click" }).catch(() => {}); openLink(ad.link_url); });
  return el;
}

// হোমের উপরে স্পন্সর ব্যানার (একাধিক হলে ৫ সেকেন্ড পরপর বদলায়)
async function homeSponsors(box) {
  if (!box) return;
  const { data } = await sb.from("sponsor_ads").select("*").in("placement", ["all", "home"]).order("sort");
  if (!data?.length || !box.isConnected) return;
  let i = 0;
  const show = () => {
    const ad = data[i % data.length]; i++;
    box.innerHTML = `<div class="home-sp"><img src="${esc(ad.image_url)}" alt=""><span class="sp-tag">স্পন্সরড</span><b translate="no">${esc(ad.title)}</b></div>`;
    box.querySelector(".home-sp").onclick = () => { rpc("sponsor_event", { p_id: ad.id, p_kind: "click" }).catch(() => {}); openLink(ad.link_url); };
    rpc("sponsor_event", { p_id: ad.id, p_kind: "view" }).catch(() => {});
  };
  show();
  if (data.length > 1) { const t = setInterval(() => { if (!box.isConnected) return clearInterval(t); show(); }, 5000); }
}

// নিজের ভিডিও বুস্ট
function boostSheet(v) {
  const per = Number(setting("boost_coins_per_day", 100)), max = Math.max(1, Number(setting("boost_max_days", 7)));
  const opts = [1, 3, 7].filter((d) => d <= max);
  const body = sheet(`<h3 style="margin-top:0">🚀 ভিডিও বুস্ট করুন</h3>
    <p class="tiny muted">বুস্ট করা ভিডিও অনেক বেশি মানুষের রিলে "🚀 প্রমোটেড" হিসেবে দেখাবে। বেশি ভিউ মানে বেশি আয় আর ফলোয়ার।</p>
    <div class="boost-opts">${opts.map((d) => `<button data-d="${d}"><b>${n(d)} দিন</b><span>🪙 ${n(d * per)}</span></button>`).join("")}</div>
    ${v.boost_until && new Date(v.boost_until) > new Date() ? `<p class="tiny">এখন বুস্ট চলছে ${dt(v.boost_until)} পর্যন্ত — কিনলে সময় বাড়বে</p>` : ""}`);
  body.onclick = async (e) => {
    const b = e.target.closest("[data-d]"); if (!b) return;
    const d = Number(b.dataset.d);
    if (!await ask(`🪙 ${n(d * per)} কয়েন দিয়ে ${n(d)} দিন বুস্ট করবেন?`)) return;
    try { const r = await rpc("boost_video", { p_video: v.id, p_days: d }); v.boost_until = r.boost_until; closeSheet(); toast(`🚀 বুস্ট চালু — ${dt(r.boost_until)} পর্যন্ত`); }
    catch (er) { toast(errMsg(er), true); if (String(er.message).includes("INSUFFICIENT_COINS")) setTimeout(() => (location.hash = "#cashin"), 900); }
  };
}

// ---------- 🧑‍💼 এজেন্ট ----------
const agentLink = () => `${String(setting("share_link", "") || "https://akashpattadar19-cell.github.io/reels-admin/get/")}?ref=${S.me?.user_no ?? ""}&agent=1`;
const agentRuleItems = () => {
  const g = (k) => Number(setting("agent_" + k, 0)), days = g("req_post_days");
  return [{ k: "active_days", need: g("req_active_days"), have: 0, mins: g("req_minutes_per_day") },
    { k: "photo_days", need: g("req_photo_per_day") > 0 ? days : 0, have: 0, per: g("req_photo_per_day") },
    { k: "text_days", need: g("req_text_per_day") > 0 ? days : 0, have: 0, per: g("req_text_per_day") },
    { k: "video_days", need: g("req_video_per_day") > 0 ? days : 0, have: 0, per: g("req_video_per_day") },
    { k: "full_watch", need: g("req_full_watch"), have: 0 }, { k: "likes", need: g("req_likes"), have: 0 },
    { k: "comments", need: g("req_comments"), have: 0 }, { k: "shares", need: g("req_shares"), have: 0 }].filter((x) => x.need > 0);
};
R.agent = async () => {
  screen.innerHTML = `<div class="page">${header("🧑‍💼 এজেন্ট")}<div class="spinner"></div></div>`;
  const a = await rpc("my_agent").catch((e) => ({ error: e }));
  if (a.error) { screen.innerHTML = `<div class="page">${header("🧑‍💼 এজেন্ট")}<div class="empty">${esc(errMsg(a.error))}</div></div>`; return; }
  const per = Number(setting("agent_ref_bonus_paisa", 0)), tgt = Number(setting("agent_target_refs", 0)), tb = Number(setting("agent_target_bonus_paisa", 0));
  const days = Number(setting("agent_window_days", 7)), notice = settingL("agent_rules_text", "");
  const rules = `<div class="card"><b>📋 আপনার আনা ইউজারদের টাস্ক (${n(days)} দিনের মধ্যে)</b>
      <div class="tiny muted" style="margin:2px 0 8px">সব শেষ করলে তবেই রেফার সফল হবে আর বোনাস পাবেন</div>${refTaskList({ items: agentRuleItems() }, true)}
      <div class="tiny muted" style="margin-top:8px">❌ একই মোবাইলে একাধিক অ্যাকাউন্ট গোনা হয় না · 📱 অ্যাপ (APK) থেকে লগইন লাগবে</div>
      ${notice ? `<p class="tiny" style="margin:8px 0 0;white-space:pre-line" translate="no">${esc(notice)}</p>` : ""}</div>`;
  const perks = `<div class="ag-perks"><div><b>${tk(per)}</b><span>প্রতি সফল রেফার</span></div>${tgt > 0 && tb > 0 ? `<div><b>+${tk(tb)}</b><span>প্রতি ${n(tgt)} জন পূরণে</span></div>` : ""}<div><b>🧑‍💼</b><span>প্রোফাইলে এজেন্ট ব্যাজ</span></div></div>`;
  if (a.status !== "approved") {
    const site = "https://akashpattadar19-cell.github.io/reels-admin/site/#agent";
    screen.innerHTML = `<div class="page">${header("🧑‍💼 এজেন্ট")}
      <div class="ag-hero"><div class="ag-ic">🧑‍💼</div><b>${a.status === "pending" ? "⏳ আপনার আবেদন যাচাই হচ্ছে" : "আপনি এখনো এজেন্ট নন"}</b>
        <span>${a.status === "pending" ? "অনুমোদন হলে নোটিফিকেশন পাবেন, তখন এখানে আপনার এজেন্ট পেজ খুলবে।" : "এজেন্ট হতে আমাদের ওয়েবসাইটে আবেদন করুন। আবেদনে আপনার Reels Enjoy ID লাগবে:"}</span>
        ${a.status === "pending" ? "" : `<div class="ag-code" data-copy="${a.code}">ID ${a.code} ⧉</div>`}</div>
      ${a.status === "pending" ? "" : `<a class="btn primary" href="${site}" target="_blank" rel="noopener" style="width:100%">🌐 ওয়েবসাইটে আবেদন করুন</a>`}</div>`;
    return;
  }
  const link = agentLink();
  const shareText = L(`Reels Enjoy অ্যাপে যোগ দিন — ভিডিও দেখুন, বানান, প্রতিযোগিতায় পুরস্কার জিতুন!\n\n📲 ডাউনলোড: ${link}\n🧑‍💼 এজেন্ট কোড: ${a.code}`, `Join the Reels Enjoy app — watch and make videos, win contest prizes!\n\n📲 Download: ${link}\n🧑‍💼 Agent code: ${a.code}`);
  const done = tgt > 0 ? (a.qualified % tgt) : 0;
  screen.innerHTML = `<div class="page">${header("🧑‍💼 এজেন্ট ড্যাশবোর্ড")}
    <div class="ag-hero"><div class="ag-ic">🧑‍💼</div><b>আপনি Reels Enjoy এজেন্ট</b><span>এজেন্ট কোড</span>
      <div class="ag-code" data-copy="${a.code}">${a.code} ⧉</div>
      <div class="ag-link" data-copy="${esc(link)}" translate="no">${esc(link)} ⧉</div>
      <button class="btn" id="agShare" style="background:#fff;color:#5b2bd0;border:0;margin-top:8px">📤 লিংক শেয়ার করুন</button></div>
    <div class="ag-stats"><div><b>${n(a.total)}</b><span>মোট আনা</span></div><div><b>${n(a.running)}</b><span>টাস্ক চলছে</span></div><div><b>${n(a.qualified)}</b><span>সফল</span></div><div><b>${tk(a.earned_paisa)}</b><span>আয়</span></div></div>
    ${tgt > 0 ? `<div class="card"><b>🎯 টার্গেট: ${n(tgt)} জন সফল রেফার${tb > 0 ? ` → +${tk(tb)}` : ""}</b>
      <div class="progress" style="margin:8px 0 4px"><div style="width:${Math.round(done / tgt * 100)}%"></div></div>
      <div class="tiny muted">${n(done)}/${n(tgt)} · আর ${n(a.target_left)} জন বাকি${a.qualified >= tgt ? ` · এ পর্যন্ত ${n(Math.floor(a.qualified / tgt))} বার পূরণ ✅` : ""}</div></div>` : ""}
    <div class="card"><b>💰 আপনার আয়ের নিয়ম</b><div class="list tiny">
      <div class="li"><span>প্রতিটি সফল রেফার (আনা ইউজার সব টাস্ক শেষ করলে)</span><b>${tk(per)}</b></div>
      ${tgt > 0 && tb > 0 ? `<div class="li"><span>প্রতি ${n(tgt)} জন সফল হলে বাড়তি (বারবার)</span><b>+${tk(tb)}</b></div>
      <div class="li"><span>উদাহরণ: ${n(tgt)} জন সফল হলে মোট</span><b>${tk(per * tgt + tb)}</b></div>
      <div class="li"><span>উদাহরণ: ${n(tgt * 2)} জন সফল হলে মোট</span><b>${tk(per * tgt * 2 + tb * 2)}</b></div>` : ""}
      <div class="li"><span>আয় প্রথমে পেন্ডিং থাকে, তারপর ব্যালেন্সে আসে</span><b>${n(setting("pending_hold_hours", 48))} ঘণ্টা পর</b></div>
      <div class="li"><span>সর্বনিম্ন উইথড্র</span><b>${tk(setting("withdraw_min_paisa"))}</b></div>
      <div class="li"><span>একই মোবাইলের অ্যাকাউন্ট বা ভুয়া অ্যাকাউন্ট</span><b>❌ বোনাস নেই</b></div></div></div>
    <div class="card"><b>👥 আপনার আনা ইউজার</b>
      ${(a.list || []).map((x) => `<div class="ag-u"><div class="ag-uh">${avatar(x)}<span translate="no"><b>${esc(x.full_name || x.username)}</b><small>@${esc(x.username)} · ${dt(x.created_at)}</small></span>
        <em class="${x.qualified ? "ok" : x.blocked ? "bad" : ""}">${x.qualified ? "✅ সফল" : x.blocked === "same_device" ? "❌ একই মোবাইল" : x.blocked ? "⌛ সময় শেষ" : "⏳ চলছে"}</em></div>
        ${x.progress ? `<div class="tiny muted" style="margin:4px 0">⏳ ${refLeft(x.progress.end)}</div>${refTaskList(x.progress, true)}` : ""}</div>`).join("")
        || `<div class="empty">এখনো কেউ নেই — লিংক শেয়ার করে শুরু করুন 🚀</div>`}</div>
    ${rules}</div>`;
  $("#agShare").onclick = () => { if (Native?.share) Native.share(shareText); else navigator.share?.({ text: shareText }).catch(() => {}); };
};

// ---------- 📢 অফার ও খবর (অ্যাডমিন লেখে, অ্যাপ + ওয়েবসাইটে দেখায়) ----------
let OFFERS = null, OFFERS_AT = 0;
async function offersData(force) {
  if (!force && OFFERS_AT && Date.now() - OFFERS_AT < 120000) return OFFERS;
  OFFERS = await rpc("app_offers").catch(() => []); OFFERS_AT = Date.now();
  if (window.getLang?.() === "en") OFFERS = (OFFERS || []).filter((x) => x.title_en);
  return OFFERS || [];
}
const offT = (x, k) => (window.getLang?.() === "en" ? x[k + "_en"] : x[k]) || "";
function offerGo(x) {
  if (!x.link_url) return;
  if (x.link_url.startsWith("#")) location.hash = x.link_url; else openLink(x.link_url);
}
async function homeOffers(box) {
  if (!box) return;
  const list = await offersData();
  if (!list?.length || !box.isConnected) return;
  const x = list[0];
  box.innerHTML = `<a class="off-strip" href="#offers">${x.image_url ? `<img src="${esc(x.image_url)}" alt="">` : `<span class="oi">${x.kind === "news" ? "📢" : "🎁"}</span>`}
    <span class="ot"><b translate="no">${esc(offT(x, "title"))}</b>${list.length > 1 ? `<small>+${n(list.length - 1)} আরও অফার ও খবর</small>` : `<small>বিস্তারিত দেখুন</small>`}</span><span class="og">›</span></a>`;
}
R.offers = async () => {
  screen.innerHTML = `<div class="page">${header("📢 অফার ও খবর")}<div class="spinner"></div></div>`;
  const list = await offersData(true);
  screen.innerHTML = `<div class="page">${header("📢 অফার ও খবর")}<div id="ofSsn"></div>
    ${list.map((x, i) => `<div class="card off-card">${x.image_url ? `<img src="${esc(x.image_url)}" alt="">` : ""}
      <div class="off-k">${x.pinned ? "📌 " : ""}${x.kind === "news" ? "📢 খবর" : "🎁 অফার"} · ${dt(x.starts_at || x.created_at)}</div>
      <b translate="no">${esc(offT(x, "title"))}</b>
      ${offT(x, "body") ? `<p translate="no">${esc(offT(x, "body"))}</p>` : ""}
      ${x.ends_at ? `<div class="tiny muted">⏳ শেষ হবে ${dt(x.ends_at)}</div>` : ""}
      ${x.link_url ? `<button class="btn primary" data-go="${i}" style="width:100%;margin-top:10px">দেখুন →</button>` : ""}</div>`).join("")
      || `<div class="empty">এখন কোনো অফার নেই।<br>নতুন অফার এলে এখানে দেখাবে 🔔</div>`}
    <a class="btn" href="https://akashpattadar19-cell.github.io/reels-admin/site/" target="_blank" rel="noopener" style="width:100%;margin-top:6px" id="ofSite">🌐 আমাদের ওয়েবসাইট</a></div>`;
  seasonBanner($("#ofSsn")).catch(() => {});
  screen.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => offerGo(list[Number(b.dataset.go)])));
  $("#ofSite").onclick = (e) => { e.preventDefault(); openLink(e.currentTarget.href); };
};

// ---------- 🏆 সিজন প্রতিযোগিতা ----------
let SSN = null, SSN_AT = 0;
async function seasonData(force) {
  if (!force && SSN_AT && Date.now() - SSN_AT < 60000) return SSN;
  SSN = await rpc("season_current").catch(() => null); SSN_AT = Date.now();
  return SSN;
}
const ssnTitle = (s) => (isEn() ? s.title_en || admTxt(s.title) || "Season contest" : s.title);
function ssnLeft(s) {
  const en = window.getLang?.() === "en";
  const t = new Date(s.state === "upcoming" ? s.starts_at : s.ends_at) - Date.now();
  if (s.state === "paid") return en ? "🎉 Winners announced" : "🎉 বিজয়ী ঘোষণা হয়েছে";
  if (s.state === "ended" || t <= 0) return en ? "🏁 Finished — results soon" : "🏁 শেষ — শীঘ্রই ফলাফল";
  const d = Math.floor(t / 864e5), h = Math.floor(t % 864e5 / 36e5), m = Math.floor(t % 36e5 / 6e4);
  const span = en ? `${d ? d + "d " : ""}${h}h ${m}m` : `${d ? n(d) + " দিন " : ""}${n(h)} ঘণ্টা ${n(m)} মিনিট`;
  return s.state === "upcoming" ? (en ? `⏳ Starts in ${span}` : `⏳ শুরু হতে ${span}`) : (en ? `⏳ ${span} left` : `⏳ শেষ হতে ${span}`);
}
const RANK_IC = ["🥇", "🥈", "🥉"];
async function seasonBanner(box, home) {
  if (!box) return;
  const s = await seasonData();
  if (!s || !box.isConnected) return;
  const b = s.creator_prizes?.length ? "creator" : "referral";
  const prizes = s[b + "_prizes"] || [], me = s[b]?.me;
  box.innerHTML = `<a class="ssn-banner${home ? " home" : ""}" href="#season"><div class="ssn-l"><b translate="no">🏆 ${esc(ssnTitle(s))}</b>
      <span class="ssn-p">${prizes.slice(0, 3).map((p, i) => `${RANK_IC[i]} ৳${n(p)}`).join(" · ")}${prizes.length > 3 ? ` · +${n(prizes.length - 3)}` : ""}</span>
      <span class="ssn-t">${ssnLeft(s)}</span></div>
    <div class="ssn-r">${me?.rank ? `<i>#${n(me.rank)}</i><span>আপনার র‍্যাংক</span>` : `<i>👉</i><span>যোগ দিন</span>`}</div></a>`;
}
R.season = async (tab) => {
  screen.innerHTML = `<div class="page">${header("🏆 প্রতিযোগিতা")}<div class="spinner"></div></div>`;
  const s = await seasonData(true);
  if (!s) { screen.innerHTML = `<div class="page">${header("🏆 প্রতিযোগিতা")}<div class="empty">এখন কোনো প্রতিযোগিতা চলছে না।<br>নতুন অফার এলে এখানে দেখাবে 🔔</div></div>`; return; }
  const boards = ["creator", "referral"].filter((b) => s[b + "_prizes"]?.length);
  if (!boards.includes(tab)) tab = boards[0];
  const W = s.weights || {}, en = window.getLang?.() === "en";
  const prizes = s[tab + "_prizes"] || [], bd = s[tab] || { top: [], me: {} }, me = bd.me || {};
  const total = boards.reduce((a, b) => a + (s[b + "_prizes"] || []).reduce((x, y) => x + y, 0), 0);
  const P = me.parts || {};
  const whyTxt = { videos: `আরও ${n(Math.max(0, s.min_videos - (P.video || 0)))}টি ভিডিও অনুমোদন হলে তালিকায় আসবেন`, no_device: "Reels Enjoy অ্যাপ (APK) থেকে লগইন করলে গোনা হবে",
    blocked: "আপনার অ্যাকাউন্ট এখন অংশ নিতে পারছে না", excluded: "নিয়ম ভাঙায় এই সিজনে বাদ দেওয়া হয়েছে", admin: "অ্যাডমিন অংশ নিতে পারেন না" };
  const parts = tab === "creator"
    ? [["video", "🎬", "অনুমোদিত ভিডিও", W.video], ["watch", "👀", "পুরো দেখা", W.watch], ["like", "❤️", "লাইক", W.like], ["comment", "💬", "কমেন্ট", W.comment], ["share", "🔁", "শেয়ার", W.share]]
    : [["referral", "🤝", "সফল রেফার", W.referral]];
  const paid = s.state === "paid";
  screen.innerHTML = `<div class="page">${header("🏆 প্রতিযোগিতা")}
    <div class="ssn-hero"><div class="ssn-trophy">🏆</div><b translate="no">${esc(ssnTitle(s))}</b>
      <div class="ssn-total">${en ? "Total prize" : "মোট পুরস্কার"} <span>৳${Number(total).toLocaleString("en-IN")}</span></div>
      <div class="ssn-clock" id="ssnClock">${ssnLeft(s)}</div>
      <div class="ssn-prizes">${prizes.map((p, i) => `<span class="${i < 3 ? "top" : ""}">${i < 3 ? RANK_IC[i] : "#" + n(i + 1)} ৳${n(p)}</span>`).join("")}</div></div>
    ${boards.length > 1 ? `<div class="seg">${boards.map((b) => `<button class="${b === tab ? "on" : ""}" onclick="location.hash='#season/${b}'">${b === "creator" ? "🎬 সেরা ক্রিয়েটর" : "🤝 সেরা রেফারকারী"}</button>`).join("")}</div>` : ""}
    ${paid ? "" : `<div class="card ssn-me">${avatarD(S.me)}<div style="flex:1;min-width:0"><b>${me.rank ? `${en ? "Your rank" : "আপনার র‍্যাংক"} #${n(me.rank)}` : "আপনি এখনো তালিকায় নেই"}</b>
        <div class="tiny muted">${en ? "Score" : "স্কোর"} ${n(me.score || 0)}${me.rank && prizes[me.rank - 1] ? ` · 🎁 ৳${n(prizes[me.rank - 1])}` : ""}</div>
        ${!me.eligible && me.why ? `<div class="tiny ssn-why">⚠️ ${whyTxt[me.why] || ""}</div>` : ""}</div></div>
      <div class="ssn-parts">${parts.map(([k, i, l, w]) => `<div><b>${i} ${n(P[k] || 0)}</b><span>${l}</span><em>×${n(w || 0)}</em></div>`).join("")}</div>
      <div class="row" style="gap:8px;margin:10px 0">${tab === "creator" ? `<a class="btn primary" href="#upload" style="flex:1">🎬 ভিডিও আপলোড</a>` : ""}<a class="btn ${tab === "creator" ? "" : "primary"}" href="#invite" style="flex:1">🤝 বন্ধুকে রেফার</a></div>`}
    <div class="card"><b>${paid ? "🎉 বিজয়ীরা" : "📊 লিডারবোর্ড"}</b>
      ${(bd.top || []).map((r) => `<a class="top-row${r.user_id === S.me.id ? " me" : ""}" href="#u/${r.user_id}"><span class="rk">${r.rank <= 3 ? RANK_IC[r.rank - 1] : n(r.rank)}</span>${avatarD(r)}
        <span style="flex:1;min-width:0"><b translate="no">${esc(r.full_name || r.username)}</b> ${vipTag(r)}<div class="tiny muted" translate="no">@${esc(r.username)} · ID ${r.user_no}</div></span>
        <b style="text-align:right">${n(r.score)}<div class="tiny" style="color:#16a34a;font-weight:700">${(paid ? r.prize_paisa / 100 : prizes[r.rank - 1]) ? "৳" + n(paid ? r.prize_paisa / 100 : prizes[r.rank - 1]) : ""}</div></b></a>`).join("")
        || `<div class="empty">এখনো কেউ নেই — প্রথম হওয়ার সুযোগ আপনার! 🚀</div>`}</div>
    <div class="card"><b>📋 নিয়ম</b><div class="list tiny">
      ${tab === "creator" ? `${parts.map(([k, i, l, w]) => `<div class="li"><span>${i} ${l}</span><b>${n(w || 0)} পয়েন্ট</b></div>`).join("")}
        <div class="li"><span>তালিকায় আসতে কমপক্ষে অনুমোদিত ভিডিও</span><b>${n(s.min_videos)}টি</b></div>
        ${W.actor_cap > 0 ? `<div class="li"><span>একজন দর্শক আপনাকে সর্বোচ্চ দিতে পারবে</span><b>${n(W.actor_cap)} পয়েন্ট</b></div>` : ""}`
        : `<div class="li"><span>🤝 প্রতি সফল রেফার (বন্ধু ৩ দিনের টাস্ক শেষ করলে)</span><b>${n(W.referral || 0)} পয়েন্ট</b></div>`}
      <div class="li"><span>নিজের কাজ বা একই মোবাইলের অন্য অ্যাকাউন্টের কাজ গোনা হয় না</span><b>❌</b></div>
      ${s.require_device ? `<div class="li"><span>শুধু অ্যাপ (APK) থেকে লগইন করা ইউজার গোনা হয়</span><b>📱</b></div>` : ""}
      <div class="li"><span>বিজয়ীরা পাবেন</span><b>৳ ব্যালেন্সে${s.frame_days > 0 ? ` + 👑 ফ্রেম ${n(s.frame_days)} দিন` : ""}</b></div>
      <div class="li"><span>সময়</span><b>${dt(s.starts_at)} – ${dt(s.ends_at)}</b></div></div>
      ${(en ? s.notice_en : s.notice) ? `<p class="tiny" style="margin:10px 0 0;white-space:pre-line" translate="no">${esc(en ? s.notice_en : s.notice)}</p>` : ""}
      <p class="tiny muted" style="margin:8px 0 0">স্কোর প্রতি কয়েক মিনিটে আপডেট হয়। ভুয়া কাজ পেলে অ্যাডমিন পুরস্কার বাতিল করতে পারেন।</p></div></div>`;
  const tick = setInterval(() => { const c = $("#ssnClock"); if (!c) return clearInterval(tick); c.textContent = ssnLeft(s); }, 30000);
  cleanup = () => clearInterval(tick);
};

// রিওয়ার্ড পুল কার্ড (চালু থাকলে)
async function poolCard(box) {
  if (!box || setting("pool_enabled", false) !== true) return;
  const p = await rpc("pool_today").catch(() => null);
  if (!p?.enabled || !box.isConnected) return;
  const y = p.yesterday;
  box.innerHTML = `<div class="card pool-card"><div class="pc-top"><span>💰 আজকের রিওয়ার্ড পুল</span><b>${tk(p.pool_paisa)}</b></div>
    <div class="tiny">আজকের কয়েন বিক্রির একটা অংশ পুলে জমা হয়। দিন শেষে সবার পয়েন্ট অনুযায়ী ভাগ হয়ে ব্যালেন্সে আসে।</div>
    <div class="pc-me"><div><b>⭐ ${n(p.my_points)}</b><span>আজ আপনার পয়েন্ট</span></div><div><b>${tk(p.my_est_paisa)}</b><span>আনুমানিক ভাগ</span></div></div>
    ${p.my_points < p.min_points ? `<div class="tiny">ভাগ পেতে আজ কমপক্ষে ⭐ ${n(p.min_points)} পয়েন্ট দরকার — ভিডিও পুরো দেখুন</div>` : ""}
    ${y?.settled_at ? `<div class="tiny muted">গতকাল: পুল ${tk(y.pool_paisa)} · ${n(y.users)} জন পেয়েছেন</div>` : ""}</div>`;
}

// ---------- 💎 VIP ----------
R.vip = async () => {
  screen.innerHTML = `<div class="page">${header("💎 VIP মেম্বারশিপ")}<div class="spinner"></div></div>`;
  const [{ data: plans }, { data: me }, { data: w }] = await Promise.all([
    sb.from("vip_plans").select("*").eq("active", true).order("sort"),
    sb.from("profiles").select("*").eq("id", S.me.id).single(),
    sb.from("wallets").select("coin_balance").eq("user_id", S.me.id).single()]);
  S.me = me; S.vipPlans = plans ?? S.vipPlans;
  const en = window.getLang?.() === "en";
  const cur = isVip(me) ? vipPlan(me) : null, claimed = me.vip_claimed_on === new Date(Date.now() + 6 * 3600e3).toISOString().slice(0, 10);
  screen.innerHTML = `<div class="page">${header("💎 VIP মেম্বারশিপ")}
    <div class="vip-hero">${avatarD(me)}<div><b translate="no">${esc(me.full_name || me.username)}</b> ${vipTag(me)}
      <div class="tiny" translate="no">${cur ? (en ? `Valid until ${dt(me.vip_until)}` : `মেয়াদ ${dt(me.vip_until)} পর্যন্ত`) : (en ? "Not VIP yet" : "এখনো VIP নন")} · 🪙 ${n(w?.coin_balance)}</div></div></div>
    ${cur && cur.daily_coins > 0 ? `<button class="btn primary" id="vipClaim" ${claimed ? "disabled" : ""} style="width:100%;margin-bottom:12px">${claimed ? "✅ আজকের ফ্রি কয়েন নেওয়া হয়েছে" : `🎁 আজকের ফ্রি 🪙 ${n(cur.daily_coins)} কয়েন নিন`}</button>` : ""}
    ${(plans ?? []).map((pl) => `<div class="vip-plan v-${esc(pl.color)}"><div class="vp-head"><span class="vp-b">${esc(pl.badge)}</span><b>${esc(pl.name)}</b><em translate="no">${n(pl.days)} ${en ? "days" : "দিন"}</em></div>
      <ul><li translate="no">${esc(pl.badge)} ${en ? `${esc(pl.name)} badge on profile, chat and live` : `প্রোফাইল, চ্যাট ও লাইভে ${esc(pl.name)} ব্যাজ`}</li>
        ${pl.daily_coins > 0 ? `<li>🎁 প্রতিদিন ফ্রি 🪙 ${n(pl.daily_coins)} কয়েন</li>` : ""}
        ${pl.points_bonus_pct > 0 ? `<li>⭐ ভিডিও দেখার পয়েন্ট +${n(pl.points_bonus_pct)}%</li>` : ""}
        <li>✨ লাইভে ঢুকলে বিশেষ এন্ট্রি</li><li>🎨 শুধু VIP-দের ফ্রেম ও ইফেক্ট কেনা যাবে</li></ul>
      <button class="btn vp-buy" data-p="${pl.id}" translate="no">🪙 ${n(pl.price_coins)} ${en ? (cur?.id === pl.id ? "coins — extend" : "coins — get it") : (cur?.id === pl.id ? "কয়েনে মেয়াদ বাড়ান" : "কয়েনে নিন")}</button></div>`).join("") || `<div class="empty">এখন কোনো VIP প্ল্যান নেই</div>`}`;
  $("#vipClaim")?.addEventListener("click", async (e) => {
    e.target.disabled = true;
    try { const r = await rpc("claim_vip_daily"); toast(`🎁 +${n(r.coins)} কয়েন`); R.vip(); } catch (er) { toast(errMsg(er), true); }
  });
  screen.querySelectorAll(".vp-buy").forEach((b) => (b.onclick = async () => {
    const pl = plans.find((x) => x.id === Number(b.dataset.p));
    if (!await ask(`${pl.name} ${n(pl.days)} দিনের জন্য 🪙 ${n(pl.price_coins)} কয়েন কাটবে। নেবেন?`)) return;
    try { await rpc("buy_vip", { p_plan: pl.id }); toast(`💎 আপনি এখন ${pl.name}!`); R.vip(); }
    catch (er) { toast(errMsg(er), true); if (String(er.message).includes("INSUFFICIENT_COINS")) setTimeout(() => (location.hash = "#cashin"), 900); }
  }));
};

// ---------- 🎨 দোকান: ফ্রেম / এন্ট্রি / চ্যাট বাবল ----------
const STORE_TABS = [["frame", "🖼️ ফ্রেম"], ["entry", "✨ এন্ট্রি"], ["bubble", "💬 চ্যাট বাবল"]];
R.store = async (tab = "frame") => {
  if (!STORE_TABS.some((t) => t[0] === tab)) tab = "frame";
  screen.innerHTML = `<div class="page">${header("🎨 প্রোফাইল সাজান")}<div class="spinner"></div></div>`;
  const [{ data: items }, { data: mine }, { data: me }, { data: w }] = await Promise.all([
    sb.from("store_items").select("*").eq("active", true).eq("kind", tab).order("sort"),
    sb.from("user_items").select("*").eq("user_id", S.me.id),
    sb.from("profiles").select("*").eq("id", S.me.id).single(),
    sb.from("wallets").select("coin_balance").eq("user_id", S.me.id).single()]);
  S.me = me;
  const own = new Map((mine ?? []).filter((x) => !x.expires_at || new Date(x.expires_at) > new Date()).map((x) => [x.item_id, x]));
  const worn = me.deco?.[tab];
  const preview = (it) => tab === "frame" ? avatar(me, `av fr fr-${it.style}`)
    : tab === "entry" ? `<span class="entry e-${it.style}">${ENTRY_IC[it.style] ?? "✨"} <b translate="no">${esc(me.username)}</b> এসেছে</span>`
    : `<div class="bub mine bb-${it.style}"><span class="bt">হ্যালো! 👋</span></div>`;
  screen.innerHTML = `<div class="page">${header("🎨 প্রোফাইল সাজান")}
    <div class="seg">${STORE_TABS.map(([k, l]) => `<button class="${k === tab ? "on" : ""}" onclick="location.hash='#store/${k}'">${l}</button>`).join("")}</div>
    <div class="tiny muted" style="margin:6px 2px 10px">🪙 আপনার কয়েন: <b>${n(w?.coin_balance)}</b> · কিনলেই সাথে সাথে পরানো হবে</div>
    <div class="store-grid">${(items ?? []).map((it) => { const o = own.get(it.id), on = o && worn === it.style;
      return `<div class="st-item ${on ? "on" : ""}"><div class="st-prev">${preview(it)}</div><b>${esc(it.name)}</b>
        <div class="tiny muted">${it.days ? `${n(it.days)} দিন` : "সারাজীবন"}${it.vip_only ? " · 💎 শুধু VIP" : ""}${o?.expires_at ? ` · ${dt(o.expires_at)} পর্যন্ত` : ""}</div>
        ${on ? `<button class="btn small" data-off="1">✅ পরা আছে — খুলুন</button>`
          : o ? `<button class="btn small primary" data-eq="${it.id}">পরুন</button>`
          : `<button class="btn small primary" data-buy="${it.id}">🪙 ${n(it.price_coins)}</button>`}</div>`; }).join("") || `<div class="empty">এখনো কিছু নেই</div>`}</div>`;
  screen.querySelector(".store-grid").onclick = async (e) => {
    const b = e.target.closest("button"); if (!b) return;
    try {
      if (b.dataset.buy) {
        const it = items.find((x) => x.id === Number(b.dataset.buy));
        if (!await ask(`${it.name} — 🪙 ${n(it.price_coins)} কয়েন কাটবে। কিনবেন?`)) return;
        await rpc("buy_item", { p_item: it.id }); toast("🎉 কেনা হয়েছে, পরানো হলো");
      } else if (b.dataset.eq) { await rpc("equip_item", { p_kind: tab, p_item: Number(b.dataset.eq) }); toast("পরানো হলো"); }
      else if (b.dataset.off) { await rpc("equip_item", { p_kind: tab, p_item: null }); toast("খুলে রাখা হলো"); }
      R.store(tab);
    } catch (er) { toast(errMsg(er), true); if (String(er.message).includes("INSUFFICIENT_COINS")) setTimeout(() => (location.hash = "#cashin"), 900); }
  };
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
        ${setting("pool_enabled", false) === true ? `<a href="#rules"><span class="ic">💰</span>রিওয়ার্ড পুল<small>পয়েন্ট দিয়ে পুলের ভাগ</small></a>`
          : `<button id="conv"><span class="ic">🔁</span>পয়েন্ট → টাকা<small>${locked("convert") ? "🔒 শীঘ্রই আসছে" : `${n(setting("points_convert_min", 1000))} পয়েন্ট থেকে`}</small></button>`}
        ${rew && Native?.showRewarded && !locked("ads") ? `<button id="rw"><span class="ic">📺</span>অ্যাড দেখে পয়েন্ট<small>+${rew.viewer_points} পয়েন্ট</small></button>` : `<a href="#history"><span class="ic">📜</span>লেনদেন<small>সব হিসাব</small></a>`}
      </div>
      <div id="poolBox"></div><div id="ssnBox"></div>
      <a class="btn" style="width:100%;margin-bottom:12px" href="#history">📜 লেনদেনের হিসাব</a>
      <div class="card"><b>কীভাবে আয় করবেন</b>
        <div class="list tiny">
          <div class="li"><span>আপনার ভিডিওর প্রতি ১০০০ ভিউ</span>${locked("views") ? soon() : `<b>${tk(setting("view_rate_paisa_per_1000"))}</b>`}</div>
          <div class="li"><span>প্রতি লাইক / প্রতি কমেন্টকারী</span>${locked("likes") && locked("comments") ? soon() : `<b>${locked("likes") ? "🔒" : tk(setting("like_rate_paisa"))} / ${locked("comments") ? "🔒" : tk(setting("comment_rate_paisa"))}</b>`}</div>
          <div class="li"><span>গিফট পেলে</span><b>গিফটের দামের বড় অংশ</b></div>
          <div class="li"><span>ভিডিও দেখে (প্রতি ভিডিও, দিনে সর্বোচ্চ ${n(setting("viewer_daily_points_cap"))})</span>${locked("watch") ? soon() : `<b>+${n(setting("watch_points"))} পয়েন্ট</b>`}</div>
          ${setting("pool_enabled", false) === true ? `<div class="li"><span>পয়েন্ট</span><b>প্রতিদিনের রিওয়ার্ড পুলের ভাগ</b></div>`
            : `<div class="li"><span>${n(setting("points_convert_min"))} পয়েন্ট</span>${locked("convert") ? soon() : `<b>${tk(setting("points_convert_min") * setting("point_value_paisa"))}</b>`}</div>`}
          <div class="li"><span>🤝 প্রতি সফল রেফার</span><b>${tk(setting("referral_bonus_paisa"))}</b></div>
          <div class="li"><span>আয় ব্যালেন্সে আসে</span><b>${n(setting("pending_hold_hours"))} ঘণ্টা পরে</b></div>
          <div class="li"><span>সর্বনিম্ন উইথড্র</span><b>${tk(setting("withdraw_min_paisa"))} · ${n(setting("withdraw_cooldown_days"))} দিনে একবার</b></div>
        </div></div></div>`;
    poolCard($("#poolBox")).catch(() => {});
    seasonBanner($("#ssnBox")).catch(() => {});
    if ($("#conv")) $("#conv").onclick = async () => {
      if (locked("convert")) return toast("এই সুবিধা শীঘ্রই চালু হবে 🔒");
      const min = Number(setting("points_convert_min", 1000));
      if (w.points < min) return toast(`কমপক্ষে ${n(min)} পয়েন্ট লাগবে`, true);
      if (!await ask(`${n(w.points)} পয়েন্ট → ${tk(w.points * setting("point_value_paisa", 1))} ব্যালেন্সে যোগ করবেন?`)) return;
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
// ---------------- প্রতিদিন চেক-ইন ও নতুনদের কাজ (পুরস্কার কয়েন) ----------------
let CHK = null;
async function loadCheckin() { try { CHK = await rpc("checkin_status"); } catch { CHK = null; } return CHK; }
const chkDays = (c) => (c.rewards || []).map((coins, i) => {
  const day = i + 1, got = c.done_today ? day <= c.cycle_day : day < c.cycle_day, today = day === c.cycle_day && !c.done_today;
  return `<div class="chk-d${got ? " got" : ""}${today ? " today" : ""}${day === 7 ? " big" : ""}"><small>দিন ${n(day)}</small><i>${got ? "✅" : day === 7 ? "🎁" : "🪙"}</i><b>${n(coins)}</b></div>`;
}).join("");
function checkinCard(c, compact = false) {
  if (!c?.enabled || (compact && c.done_today)) return "";
  return `<div class="card chk-card"><div class="chk-h"><b>📅 প্রতিদিন চেক-ইন</b><span>${c.done_today ? `🔥 টানা ${n(c.streak)} দিন` : `আজ পাবেন 🪙 ${n(c.next_coins)}`}</span></div>
    <div class="chk-row">${chkDays(c)}</div>
    ${c.done_today ? `<div class="chk-done">✅ আজকের পুরস্কার নেওয়া হয়েছে — কাল আবার আসুন, পাবেন 🪙 ${n(c.next_coins)}</div>`
      : `<button class="btn primary chk-go">🎁 চেক-ইন করে 🪙 ${n(c.next_coins)} নিন</button>`}
    ${compact ? "" : `<p class="tiny muted" style="margin:8px 0 0">টানা ৭ দিন এলে ৭ম দিনে সবচেয়ে বড় পুরস্কার। একদিন বাদ গেলে আবার দিন ১ থেকে শুরু। কয়েন দিয়ে গিফট, VIP, বুস্ট ও ফ্রেম কেনা যায়।</p>`}</div>`;
}
function wireCheckin(box, after) {
  box?.querySelector(".chk-go")?.addEventListener("click", async (e) => {
    const b = e.currentTarget; b.disabled = true;
    try { const r = await rpc("daily_checkin"); toast(`🎉 🪙 ${n(r.coins)} কয়েন পেয়েছেন!`); await loadCheckin(); after?.(); }
    catch (er) { toast(errMsg(er), true); b.disabled = false; }
  });
}
const STARTER = { avatar: ["🖼️", "প্রোফাইল ছবি দিন", "#edit"], video: ["🎬", "প্রথম ভিডিও পোস্ট করুন (অনুমোদন হলে)", "#upload"],
  follow: ["👥", "", "#home"], done: ["🏆", "সব কাজ শেষ — বড় বোনাস", null] };
function starterCard(st) {
  if (!st?.enabled) return "";
  const items = st.items || [];
  if (!items.length || items.every((x) => x.claimed)) return "";
  const doneN = items.filter((x) => x.k !== "done" && x.done).length;
  return `<div class="card st-card"><div class="chk-h"><b>🎯 নতুনদের কাজ — কয়েন নিন</b><span>${n(doneN)}/৩</span></div>
    ${items.map((x) => {
      const t = STARTER[x.k] || ["⭐", x.k, null];
      const label = x.k === "follow" ? `${n(x.need)} জনকে ফলো করুন (${n(x.have)}/${n(x.need)})` : t[1];
      const right = x.claimed ? `<em class="st-ok">✅</em>` : x.done ? `<button class="btn small primary" data-st="${x.k}">🪙 ${n(x.coins)} নিন</button>`
        : t[2] ? `<a class="btn small" href="${t[2]}">করুন ›</a>` : `<em class="st-lock">🔒</em>`;
      return `<div class="st-i${x.claimed ? " ok" : ""}"><span class="st-ic">${t[0]}</span><div><b>${label}</b><small>🪙 ${n(x.coins)} কয়েন</small></div>${right}</div>`;
    }).join("")}
    <p class="tiny muted" style="margin:6px 0 0">⏳ ${dt(st.ends_at)} পর্যন্ত</p></div>`;
}
function wireStarter(box, after) {
  box?.querySelectorAll("[data-st]").forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    try { const r = await rpc("starter_claim", { p_task: b.dataset.st }); toast(`🎉 🪙 ${n(r.coins)} কয়েন পেয়েছেন!`); after?.(); }
    catch (er) { toast(errMsg(er), true); b.disabled = false; }
  }));
}
// Me / টাস্ক পেজে বসানো
async function growBox(box, compact, after) {
  if (!box) return;
  const [st, c] = await Promise.all([rpc("starter_status").catch(() => null), loadCheckin()]);
  if (!box.isConnected) return;
  box.innerHTML = starterCard(st) + checkinCard(c, compact);
  wireStarter(box, after); wireCheckin(box, after);
}
// অ্যাপ খুললে দিনে একবার চেক-ইন পপআপ (দেখালে true)
async function checkinPopup() {
  try {
    const c = await loadCheckin();
    if (!c?.enabled || c.done_today || (c.need_device && !c.has_device)) return false;
    const key = "chkpop_" + new Date().toDateString();
    if (localStorage.getItem(key)) return false;
    localStorage.setItem(key, "1");
    const d = document.createElement("div");
    d.className = "upd-gate soft";
    d.innerHTML = `<div class="upd-card chkpop">${checkinCard(c)}<button class="btn" id="chkX" style="margin-top:8px">পরে</button></div>`;
    document.body.appendChild(d);
    wireCheckin(d, () => setTimeout(() => d.remove(), 900));
    d.querySelector("#chkX").onclick = () => d.remove();
    return true;
  } catch { return false; }
}
// অ্যাপ খুললে দিনে একবার নতুন অফার পপআপ
async function offerPopup() {
  try {
    if (location.hash.startsWith("#cashin") || !helpersAllowed()) return;
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
    const go = (id) => { d.remove(); S.pickOffer = id ?? null; location.hash = "#cashin/r"; };
    d.querySelectorAll("[data-of]").forEach((b) => (b.onclick = () => go(Number(b.dataset.of))));
    d.querySelector("#ofGo").onclick = () => go();
    d.querySelector("#ofX").onclick = () => d.remove();
  } catch { /* ignore */ }
}

// ---------------- আমার কয়েন / কয়েন কিনুন (Chamet-স্টাইল: Google · রিকমেন্ড · টপ-আপ হেল্পার) ----------------
const isPlay = () => { try { return Native?.store?.() === "play"; } catch { return false; } };
// Play ভার্সনে বাইরের পেমেন্ট/হেল্পার শুধু এডমিন চালু করলে দেখাবে (Play নীতিমালা)
const helpersAllowed = () => !isPlay() || setting("play_show_helpers", false) === true;
function coinArt(level) {
  const pos = [[32, 40], [20, 44], [44, 44], [26, 32], [38, 32], [14, 50], [50, 50], [32, 24]];
  const k = Math.max(1, Math.min(pos.length, level));
  return `<svg class="ci-art" viewBox="0 0 64 64">${pos.slice(0, k).reverse().map(([x, y]) =>
    `<g transform="translate(${x} ${y})"><ellipse rx="11" ry="4.2" cy="3" fill="#c98a12"/><ellipse rx="11" ry="4.2" fill="url(#cg)"/><ellipse rx="7" ry="2.5" fill="none" stroke="#fff6c4" stroke-opacity=".8"/></g>`).join("")}
    <defs><linearGradient id="cg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff1a6"/><stop offset=".55" stop-color="#ffc83d"/><stop offset="1" stop-color="#e59a0c"/></linearGradient></defs></svg>`;
}
const ciCard = (attrs, coins, base, price, level, best) => `<button type="button" class="ci-card${best ? " best" : ""}" ${attrs}>
  ${best ? `<i class="ci-best">👍</i>` : ""}${coinArt(level)}<b>${Number(coins).toLocaleString("en-US")}</b>${base && base < coins ? `<s>${Number(base).toLocaleString("en-US")}</s>` : `<s class="ghost">0</s>`}
  <span class="ci-price">${price}</span></button>`;

// Play কেনার ফলাফল — অ্যাপ যেকোনো পেজে থাকলেও কাজ করে (অসম্পূর্ণ কেনাও অ্যাপ খুললে আবার আসে)
// অ্যাড লোড/দেখাতে ব্যর্থ হলে কারণ সার্ভারে (এডমিন অ্যাড পেজে দেখা যায়) — APK ≥ v1.0.20
window.onAdFail = (placement, code, msg) => {
  if (!S.me) return;
  rpc("log_ad_error", { p_placement: String(placement || ""), p_code: Number(code), p_message: String(msg || ""), p_build: Number(Native?.appBuild?.() || 0) || null }).catch(() => {});
};
window.onPlayPurchase = async (raw) => {
  let r; try { r = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return; }
  if (!r || !S.me) return;
  if (r.error) { if (r.error !== "USER_CANCELED") toast(r.error === "PENDING" ? "পেমেন্ট প্রক্রিয়াধীন — শেষ হলে কয়েন যোগ হবে" : "কেনা যায়নি, আবার চেষ্টা করুন", r.error !== "PENDING"); return; }
  try {
    const g = await fnCall("play-purchase", { productId: r.productId, token: r.token });
    try { Native?.playConsume?.(r.token); } catch { /* ignore */ }
    if (!g.already) toast(`🎉 🪙 ${n(g.coins)} কয়েন যোগ হয়েছে`);
    if (location.hash.startsWith("#cashin")) R.cashin();
  } catch (e) {
    toast(String(e.message).includes("PENDING") ? "পেমেন্ট প্রক্রিয়াধীন — শেষ হলে কয়েন যোগ হবে" : "কয়েন যোগ হয়নি — অ্যাপ আবার খুললে চেষ্টা করবে", true);
  }
};

R.cashin = async () => {
  const play = isPlay(), helpers = helpersAllowed();
  const nums = helpers ? ["bkash", "nagad", "rocket"].filter((m) => setting(m + "_number", "")) : [];
  const coinPrice = Number(setting("coin_price_paisa", 100));
  const tabs = [];
  if (play && setting("play_billing_enabled", true) !== false) tabs.push(["g", "Google"]);
  if (nums.length) tabs.push(["r", "রিকমেন্ড"]);
  if (helpers && setting("coin_seller_enabled", true) !== false) tabs.push(["h", "টপ-আপ হেল্পার"]);
  const want = (location.hash.split("/")[1] || "");
  let tab = tabs.some((t) => t[0] === want) ? want : tabs[0]?.[0];
  const { data: w } = await sb.from("wallets").select("coin_balance").eq("user_id", S.me.id).maybeSingle();
  const tabIc = { g: 3, r: 5, h: 8 };
  screen.innerHTML = `<div class="ci-top"><button class="back" onclick="history.back()">←</button>
      <a class="ci-hist" href="#history" title="লেনদেনের হিসাব">🧾</a>
      <div class="ci-bal">${coinArt(2)}<b id="ciBal">${Number(w?.coin_balance ?? 0).toLocaleString("en-US")}</b></div></div>
    <div class="ci-tabs">${tabs.map(([k, l]) => `<button data-t="${k}" class="${k === tab ? "on" : ""}"><span>${l}</span>${coinArt(tabIc[k])}</button>`).join("")}</div>
    <div class="page ci-page" id="ciBody">${tabs.length ? `<div class="spinner"></div>` : `<div class="card">কয়েন কেনা এখন বন্ধ আছে। পরে চেষ্টা করুন।</div>`}</div>`;
  const show = (k) => {
    tab = k; history.replaceState(null, "", "#cashin/" + k);
    document.querySelectorAll(".ci-tabs button").forEach((b) => b.classList.toggle("on", b.dataset.t === k));
    ({ g: ciGoogle, r: ciRecommend, h: ciHelpers })[k]?.({ nums, coinPrice });
  };
  document.querySelectorAll(".ci-tabs button").forEach((b) => (b.onclick = () => show(b.dataset.t)));
  if (tab) show(tab);
};

const agreeRow = () => { const en = window.getLang?.() === "en";
  return `<label class="ci-agree"><input type="checkbox" id="ciAg" ${localStorage.getItem("ciAgree") ? "checked" : ""}><span translate="no">${en
    ? `I agree to the <a href="#policy/terms">Terms of Service</a> and <a href="#policy/coins">Coin Policy</a>`
    : `আমি <a href="#policy/terms">ব্যবহারের শর্তাবলি</a> ও <a href="#policy/coins">কয়েন নীতিমালা</a> মেনে নিচ্ছি`}</span></label>`; };
const agreed = () => { const ok = $("#ciAg")?.checked; if (ok) localStorage.setItem("ciAgree", "1"); else toast("আগে শর্তাবলিতে টিক দিন", true); return ok; };

async function ciGoogle() {
  const body = $("#ciBody");
  const { data } = await sb.from("play_products").select("*").eq("active", true).order("sort").order("coins");
  const list = data ?? [];
  if (!list.length) { body.innerHTML = `<div class="empty">এখনো কোনো প্যাকেজ নেই</div>`; return; }
  const ordered = [...list].sort((a, b) => a.coins - b.coins), lvl = (p) => ordered.indexOf(p) + 1;
  body.innerHTML = `<div class="ci-grid">${list.map((p) => ciCard(`data-pp="${esc(p.product_id)}"`, p.coins, p.base_coins, `<span data-price="${esc(p.product_id)}">…</span>`, lvl(p), !!p.badge)).join("")}</div>
    ${agreeRow()}<p class="tiny muted ci-note">পেমেন্ট হবে Google Play-এর মাধ্যমে (কার্ড, Google Play ব্যালেন্স বা মোবাইল বিল)। কেনার পর কয়েন সাথে সাথে যোগ হয়।</p>`;
  window.onPlayProducts = (raw) => {
    let arr = []; try { arr = JSON.parse(raw) || []; } catch { /* ignore */ }
    arr.forEach((x) => document.querySelectorAll(`[data-price="${x.id}"]`).forEach((el) => (el.textContent = x.price)));
    document.querySelectorAll("[data-price]").forEach((el) => { if (el.textContent === "…") el.closest(".ci-card")?.classList.add("na"); });
  };
  try { Native?.playProducts?.(JSON.stringify(list.map((p) => p.product_id))); } catch { /* ignore */ }
  body.querySelectorAll("[data-pp]").forEach((b) => (b.onclick = () => {
    if (b.classList.contains("na")) return toast("এই প্যাকেজ এখন পাওয়া যাচ্ছে না", true);
    if (!agreed()) return;
    if (!Native?.playBuy) return toast("Play Store থেকে অ্যাপটি আপডেট করুন", true);
    Native.playBuy(b.dataset.pp, S.me.id);
  }));
}

async function ciRecommend({ nums, coinPrice }) {
  const body = $("#ciBody");
  let offers = await loadOffers();
  const std = [100, 200, 500, 1000, 2000, 5000].map((t, i) => ({ id: null, price_taka: t, coins: Math.floor(t * 100 / coinPrice), std: i }));
  const all = [...offers.map((o) => ({ ...o, base: Math.floor(o.price_taka * 100 / coinPrice) })), ...std];
  const lv = (x) => { const s = [...all].sort((a, b) => a.coins - b.coins); return Math.min(8, Math.ceil((s.indexOf(x) + 1) * 8 / s.length)); };
  let method = nums[0];
  body.innerHTML = `<div class="ci-method"><span class="ci-mic">📱</span><b id="ciM">${METHOD[method]}</b>
      <select id="ciMs">${nums.map((m) => `<option value="${m}">${METHOD[m]}</option>`).join("")}</select><span class="ci-chg">পরিবর্তন</span></div>
    <div class="ci-grid">${all.map((x, i) => ciCard(`data-ri="${i}"`, x.coins, x.base, "৳" + n(x.price_taka), lv(x), !!x.badge || (x.id && x.coins > x.base))).join("")}
      <button type="button" class="ci-card other" data-ri="custom"><b>✏️</b><span>অন্য পরিমাণ</span><span class="ci-price">নিজে লিখুন</span></button></div>
    ${settingL("cashin_notice", "") ? `<div class="ci-tip"><span>💡</span><div translate="no">${esc(settingL("cashin_notice", ""))}</div></div>` : ""}
    <form class="card hidden" id="cf"><b id="cfT"></b>
      <div class="ci-steps"><div><i>১</i> <span translate="no">${window.getLang?.() === "en" ? "<b>Send Money</b> to this number:" : "এই নম্বরে <b>Send Money</b> করুন:"}</span> <span class="copy" id="cfNum"></span></div>
      <div><i>২</i> <span>নিচের তথ্য দিয়ে রিকোয়েস্ট পাঠান</span></div></div>
      <input id="am" type="number" inputmode="numeric" min="1" placeholder="কত টাকা পাঠিয়েছেন" required>
      <div class="tiny muted" id="cv"></div>
      <input id="sn" inputmode="numeric" placeholder="যে নম্বর থেকে পাঠিয়েছেন (01XXXXXXXXX)" required>
      <input id="tx" placeholder="TrxID (যেমন 9AB7C6D5E4)" autocapitalize="characters" required>
      <label class="proofpick"><input type="file" id="pf" accept="image/*" class="hidden"><span id="pfl">📎 পেমেন্টের স্ক্রিনশট দিন (ঐচ্ছিক)</span></label>
      <button class="btn primary">রিকোয়েস্ট পাঠান</button>
      <p class="tiny muted">অ্যাডমিন যাচাই করার পর কয়েন যোগ হবে। ভুল/ভুয়া TrxID দিলে অ্যাকাউন্ট ব্লক হবে। সর্বনিম্ন ৳${n(setting("min_cash_in_taka", 20))}</p></form>
    ${agreeRow()}
    <button class="ci-status" id="ciSt">আমার রিচার্জের অবস্থা দেখুন ›</button><div class="card list hidden" id="cl"></div>`;
  let offerId = null;
  const setNum = () => { $("#ciM").textContent = METHOD[method]; const v = setting(method + "_number", ""); $("#cfNum").textContent = v; $("#cfNum").dataset.copy = v; };
  $("#ciMs").value = method; $("#ciMs").onchange = (e) => { method = e.target.value; setNum(); };
  setNum();
  const open = (x) => {
    if (!agreed()) return;
    body.querySelectorAll("[data-ri]").forEach((b) => b.classList.remove("on"));
    $("#cf").classList.remove("hidden");
    offerId = x?.id ?? null;
    $("#am").readOnly = !!offerId;
    $("#am").value = x ? x.price_taka : "";
    $("#cfT").textContent = x ? `🪙 ${n(x.coins)} কয়েন — ৳${n(x.price_taka)}` : "নিজের পরিমাণ লিখুন";
    $("#cv").textContent = x ? (offerId ? `অফার: ঠিক ৳${n(x.price_taka)} পাঠান` : `আপনি পাবেন 🪙 ${n(x.coins)} কয়েন`) : "";
    $("#cf").scrollIntoView({ behavior: "smooth", block: "start" });
    if (!x) $("#am").focus();
  };
  body.querySelectorAll("[data-ri]").forEach((b) => (b.onclick = () => { open(b.dataset.ri === "custom" ? null : all[Number(b.dataset.ri)]); b.classList.add("on"); }));
  if (S.pickOffer) { const i = all.findIndex((x) => x.id === S.pickOffer); if (i >= 0) { localStorage.setItem("ciAgree", "1"); $("#ciAg").checked = true; open(all[i]); body.querySelector(`[data-ri="${i}"]`).classList.add("on"); } }
  S.pickOffer = null;
  $("#am").addEventListener("input", (e) => ($("#cv").textContent = e.target.value ? `আপনি পাবেন 🪙 ${n(Math.floor(e.target.value * 100 / coinPrice))} কয়েন` : ""));
  let proof = null;
  $("#pf").addEventListener("change", async (e) => {
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
  $("#cf").addEventListener("submit", async (e) => {
    e.preventDefault();
    const b = e.submitter; b.disabled = true;
    try {
      const id = await rpc("request_cash_in", { p_method: method, p_amount_taka: Math.floor(Number($("#am").value)),
        p_sender: cleanPhone($("#sn").value), p_trx: $("#tx").value.trim(), p_offer_id: offerId });
      if (proof && id) {
        try {
          const path = `${S.me.id}/${id}-${Date.now()}.jpg`;
          await xhrUpload("proofs", path, proof, "image/jpeg", () => {});
          await rpc("set_cash_in_proof", { p_id: id, p_path: path });
        } catch { toast("স্ক্রিনশট যায়নি, তবে রিকোয়েস্ট পাঠানো হয়েছে", true); }
      }
      toast("রিকোয়েস্ট পাঠানো হয়েছে — যাচাইয়ের পর কয়েন যোগ হবে");
      ciRecommend({ nums, coinPrice }).then(() => $("#ciSt").click());
    } catch (er) { toast(errMsg(er), true); b.disabled = false; }
  });
  $("#ciSt").onclick = async () => {
    const cl = $("#cl"); if (!cl.classList.toggle("hidden")) {
      cl.innerHTML = `<div class="spinner"></div>`;
      const { data } = await sb.from("cash_in_requests").select("*").eq("user_id", S.me.id).order("id", { ascending: false }).limit(20);
      cl.innerHTML = data?.length ? data.map((c) => `<div class="li"><div><b>${tk(c.amount_paisa)}</b> · ${METHOD[c.method]} · 🪙 ${n(c.coins)}
        <div class="tiny muted">${dt(c.created_at)} · TrxID ${esc(c.trx_id)}${c.proof_path ? " · 📎" : ""}${c.reject_reason ? " · " + esc(c.reject_reason) : ""}</div></div><span class="pill ${c.status}">${STATUS[c.status]}</span></div>`).join("")
        : `<div class="empty">কোনো রিকোয়েস্ট নেই</div>`;
      cl.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  };
}

async function ciHelpers() {
  const body = $("#ciBody");
  const { data } = await sb.from("profiles").select("id,username,full_name,avatar_url,user_no,country_code")
    .eq("coin_seller", true).eq("account_type", "host").eq("status", "active").limit(60);
  const list = (data ?? []).filter((x) => x.id !== S.me.id);
  const countries = [...new Set(list.map((x) => x.country_code).filter(Boolean))];
  const note = settingL("topup_helper_notice", "");
  body.innerHTML = `${note ? `<div class="ci-tip"><span>💡</span><div translate="no">${esc(note)}</div></div>` : ""}
    <div class="ci-region"><b>এলাকা</b><select id="ciRg"><option value="">🌐 সব</option>${countries.map((c) => `<option value="${c}">${flagOf(c)} ${c}</option>`).join("")}</select></div>
    <div class="ci-helpers" id="ciHl"></div>`;
  const paint = (cc) => {
    const l = cc ? list.filter((x) => x.country_code === cc) : list;
    $("#ciHl").innerHTML = l.length ? l.map((x) => `<a class="ci-h" href="#chat/${x.id}">${avatar(x)}<div><b translate="no">${esc(x.full_name || x.username)}</b>
      <span>${x.country_code ? `<i class="fl">${flagOf(x.country_code)}</i>` : ""}<em class="idp">ID: ${x.user_no}</em><em class="msg">💬 মেসেজ</em></span></div><u>›</u></a>`).join("")
      : `<div class="empty">এই এলাকায় কোনো হেল্পার নেই</div>`;
  };
  $("#ciRg").onchange = (e) => paint(e.target.value);
  paint("");
}

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
    if (!await ask("এই নম্বর মুছবেন?")) return;
    try { await rpc("delete_payout_account", { p_id: Number(d.dataset.del) }); R.withdraw(); } catch (er) { toast(errMsg(er), true); }
  });
  $("#wf")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const amount = Math.round(Number($("#am").value) * 100);
    const sel = saved.find((a) => a.id === Number($("input[name=acc]:checked")?.value));
    const m = sel ? sel.method : $("input[name=m]:checked").value, acc = sel ? sel.account : cleanPhone($("#ac").value), nm = sel ? sel.name ?? "" : $("#an").value;
    if (!acc) return toast("নম্বর দিন", true);
    if (!await ask(`${tk(amount)} ${METHOD[m]} ${acc} নম্বরে উইথড্র করবেন?`)) return;
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
        <div class="tiny muted">${dt(r.created_at)}${r.taka_paisa ? ` · ${tk(r.taka_paisa)}` : ""}${r.note ? ` · <span>${esc(r.note)}</span>` : ""}</div></div>
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
    if (!await ask(`@${buyer.username}-কে 🪙 ${n(c)} কয়েন পাঠাবেন?\nআপনার স্টক থেকে কাটবে 🪙 ${n(c + com(c))} (কমিশনসহ)`)) return;
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
  if (tab === "notif") return location.replace("#notifs");
  screen.innerHTML = `<div class="page">${header("💬 মেসেজ")}
    <div class="card list" id="nl"><div class="spinner"></div></div></div>`;
  {
    const rows = await rpc("my_chats").catch(() => []);
    $("#nl").innerHTML = rows.length ? rows.map((c) => `<a class="li chat-li" href="#chat/${c.other_id}">${avatar(c)}
        <span style="flex:1;min-width:0"><b translate="no">${esc(c.full_name || c.username)}</b><div class="tiny muted ell" translate="no">${c.last_from_me ? (c.last_status === "seen" ? '<b class="tk seen">✓✓</b> ' : c.last_status === "delivered" ? '<b class="tk">✓✓</b> ' : '<b class="tk">✓</b> ') + "আপনি: " : ""}${esc(c.last_body)}</div></span>
        <span class="tiny muted" style="text-align:right">${ago(c.last_at)}${c.unread ? `<div><b class="ubadge">${c.unread}</b></div>` : ""}</span></a>`).join("")
      : `<div class="empty">এখনো কোনো চ্যাট নেই।<br>কারো প্রোফাইলে গিয়ে "💬 মেসেজ" চাপুন।</div>`;
    return;
  }
};

// ---------------- 🔔 নোটিফিকেশন (হোম পেজের ঘণ্টা আইকন) ----------------
R.notifs = async () => {
  screen.innerHTML = `<div class="page">${header("🔔 নোটিফিকেশন")}<div class="card list" id="nl"><div class="spinner"></div></div></div>`;
  const { data } = await sb.from("notifications").select("*").eq("user_id", S.me.id).order("id", { ascending: false }).limit(80);
  const icon = { like: "❤️", comment: "💬", gift: "🎁", follow: "👤", withdraw: "💸", cash_in: "🪙", system: "📢", mention: "📣", season_prize: "🏆" };
  const href = (x) => x.data?.video_id ? `#v/${x.data.video_id}` : x.data?.post_id ? `#post/${x.data.post_id}` : x.data?.contest_id ? `#contest/${x.data.contest_id}`
    : x.data?.user_id ? `#u/${x.data.user_id}` : x.data?.route ? x.data.route : x.type === "season_prize" ? "#season" : x.type === "withdraw" ? "#withdraw" : x.type === "cash_in" ? "#cashin" : "";
  $("#nl").innerHTML = data?.length ? data.map((x) => `<a class="li" ${href(x) ? `href="${href(x)}"` : ""}
      style="${x.is_read ? "" : "background:rgba(155,92,255,.08);margin:0 -14px;padding:12px 14px"}">
      <div style="display:flex;gap:10px"><span style="font-size:22px">${icon[x.type] ?? "🔔"}</span><div><b>${esc(x.title)}</b>${x.body ? `<div class="tiny muted">${esc(x.body)}</div>` : ""}<div class="tiny muted">${ago(x.created_at)}</div></div></div></a>`).join("")
    : `<div class="empty">কোনো নোটিফিকেশন নেই</div>`;
  if (S.unread) { await rpc("mark_notifications_read").catch(() => {}); S.unread = 0; paintUnread(); }
};

const TICK = (m) => m.read_at ? `<b class="tk seen">✓✓</b>` : m.delivered_at ? `<b class="tk">✓✓</b>` : `<b class="tk">✓</b>`;
R.chat = async (uid) => {
  const { data: o } = await sb.from("profiles").select("id,username,full_name,avatar_url,deco,vip_until,vip_plan_id").eq("id", uid).maybeSingle();
  if (!o) { screen.innerHTML = `<div class="page"><div class="empty">ইউজার পাওয়া যায়নি</div></div>`; return; }
  const bubCls = (mine) => { const b = (mine ? S.me : o)?.deco?.bubble; return b ? ` bb-${String(b).replace(/[^a-z0-9-]/g, "")}` : ""; };
  screen.classList.add("chatmode");
  screen.innerHTML = `<div class="chat">
    <div class="chat-top"><button class="back" onclick="history.back()">←</button><a href="#u/${o.id}" style="display:flex;align-items:center;gap:10px">${avatarD(o)}<b translate="no">${esc(o.full_name || o.username)}</b>${vipTag(o)}</a></div>
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
  const bubble = (m) => `<div class="bub ${m.sender_id === S.me.id ? "mine" : ""}${bubCls(m.sender_id === S.me.id)}" data-id="${m.id}">${quote(m)}<span class="bt" translate="no">${esc(m.body)}</span>
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
      else if (a === "del" && await ask("মেসেজটি মুছবেন?")) {
        try { await rpc("delete_message", { p_id: m.id }); msgs.delete(m.id); list.querySelector(`.bub[data-id="${m.id}"]`)?.remove(); } catch (er) { toast(errMsg(er), true); }
      }
    };
  }

  const onMsg = (e) => { put(e.detail); rpc("mark_read", { p_with: uid }).catch(() => {}); };
  const onUpd = (e) => { const m = e.detail; if (msgs.has(m.id)) repaint(m); };
  document.addEventListener("chatmsg", onMsg);
  document.addEventListener("msgupd", onUpd);
  let pipStop = null; livePip(uid, o).then((f) => { pipStop = f; });
  cleanup = () => { document.removeEventListener("chatmsg", onMsg); document.removeEventListener("msgupd", onUpd); S.chatWith = null; screen.classList.remove("chatmode"); try { pipStop?.(); } catch { /* */ } document.querySelector(".chat-live")?.remove(); };
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
    const text = `${first ? first + "…\n\n" : ""}${L(`✨ @${v.username}-এর ${v.kind === "text" ? "লেখা" : "ছবি"} দেখুন Reels Enjoy অ্যাপে!\n\n📲 অ্যাপ ডাউনলোড করুন: `, `✨ See @${v.username}'s ${v.kind === "text" ? "post" : "photo"} on the Reels Enjoy app!\n\n📲 Download the app: `)}${shareLink()}`;
    try {
      if (Native?.share) Native.share(text); else if (navigator.share) await navigator.share({ text }); else { await navigator.clipboard.writeText(text); toast("কপি হয়েছে"); }
      await rpc("record_post_share", { p_post: v.id }); v.shares_count++; el.querySelector(".sh span").textContent = n(v.shares_count);
    } catch { /* */ }
  };
  el.querySelector(".gf")?.addEventListener("click", () => openGifts(el, true));
  el.querySelector(".del")?.addEventListener("click", async () => {
    if (!await ask("পোস্টটি মুছবেন?")) return;
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
    const d = e.target.closest(".del"); if (!d || !await ask("কমেন্ট মুছবেন?")) return;
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
    <p class="notice tiny" translate="no">${esc(settingL("text_notice", ""))}</p>
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
    if (!owned && !await ask(`👑 প্রিমিয়াম ভিডিও ডাউনলোড করতে 🪙 ${n(fee)} কয়েন লাগবে। ডাউনলোড করবেন?`)) return;
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
  if (v._x === undefined) {
    const { data } = await sb.from("videos").select("music_start,fx,orig_muted,music_baked,music:music_id(url)").eq("id", v.id).maybeSingle();
    v._x = data ?? null;
  }
  const x = v._x?.music_baked ? null : v._x;
  const hasExtra = !!(x?.music?.url || (x?.fx && !fxEmpty(x.fx)));
  if (hasExtra && !Native.downloadVideo2) { toast("গান ও ফিল্টারসহ ডাউনলোড করতে অ্যাপ আপডেট করুন", true); checkUpdate(); return; }
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
      else toast(st.msg === "permission" ? "স্টোরেজ অনুমতি দিন, তারপর আবার চেষ্টা করুন" : st.msg === "music" ? "এই ফোনে গানসহ ভিডিও তৈরি করা যায়নি — আবার চেষ্টা করুন" : "ডাউনলোড হয়নি — ইন্টারনেট দেখে আবার চেষ্টা করুন", true);
    }
  };
  show("⬇️ ডাউনলোড শুরু হচ্ছে…", 0);
  const brand = String(setting("watermark_text", "Reels Enjoy") || "Reels Enjoy");
  if (Native.downloadVideo2) Native.downloadVideo2(v.video_url, brand, v.username || "", "", JSON.stringify({ music: x?.music?.url || "", start: x?.music_start || 0, mute: !!x?.orig_muted, fx: x?.fx && !fxEmpty(x.fx) ? x.fx : null }));
  else Native.downloadVideo(v.video_url, brand, v.username || "", "");
}

// ---------------- 🔴 লাইভ ও 📞 কল (Agora Web SDK, WebView-এর ভেতরে) ----------------
let AgoraRTC = null;
async function loadAgora() {
  if (AgoraRTC) return AgoraRTC;
  if (!window.AgoraRTC) {
    await new Promise((res, rej) => {
      const sc = document.createElement("script");
      sc.src = "https://cdn.jsdelivr.net/npm/agora-rtc-sdk-ng@4/AgoraRTC_N-production.js";
      sc.onload = res; sc.onerror = () => rej(new Error("লাইভ চালু করা যায়নি — ইন্টারনেট দেখুন"));
      document.head.appendChild(sc);
    });
  }
  AgoraRTC = window.AgoraRTC;
  try { AgoraRTC.setLogLevel(3); AgoraRTC.disableLogUpload?.(); } catch { /* */ }
  return AgoraRTC;
}
const agoraToken = (channel) => fnCall("agora-token", { channel });
const needMedia = () => { if (Native && !Native.appVersion) return; const b = Number(String(Native?.appVersion?.() || "").split(".")[2] || 0); if (Native && b && b < 17) throw new Error("লাইভ ও কলের জন্য অ্যাপ আপডেট করুন"); };
const hms2 = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const callRate = (p, kind) => Number((kind === "video" ? p.call_video_rate : p.call_audio_rate) ?? setting(kind === "video" ? "call_video_coins_per_min" : "call_audio_coins_per_min", kind === "video" ? 60 : 30));

// লাইভ কার্ড (হোমের ভিডিও কার্ডের মতো) — ক্লিক = লাইভ দেখা, 📞 = কল
const LIVE_HOSTS = new Map();
const liveCard = (r, i) => {
  LIVE_HOSTS.set(r.host_id, r);
  const img = r.thumb_url || r.avatar_url || r.cover_url;
  const callable = r.account_type === "host" && r.calls_on !== false && setting("calls_enabled", true) !== false && r.host_id !== S.me.id;
  if (r.kind === "party") return `<a class="dcard live party ${i % 4 === 1 || i % 4 === 2 ? "tall" : ""}" href="#party/${r.id}">
    <div class="ph">${r.avatar_url || r.cover_url ? `<img src="${esc(r.avatar_url || r.cover_url)}" loading="lazy" alt="">` : `<div class="noimg">🎉</div>`}
      <span class="lbadge pb"><i class="eq"><b></b><b></b><b></b></i>PARTY</span><span class="lview">👁 ${n(r.viewers)}</span>
      <span class="pseats">🎤 ${n(r.on_seats + 1)}/${n(r.seats + 1)}</span>
      <div class="tags">${r.country_code ? `<span>${flagOf(r.country_code)} ${esc(r.country_code)}</span>` : ""}${r.language ? `<span>${esc(langName(r.language))}</span>` : ""}<span class="lv">✦Lv${r.level ?? 0}</span></div></div>
    ${r.title ? `<div class="cap" translate="no">${esc(r.title)}</div>` : ""}
    <div class="who">${callable ? `<span class="lcall" data-call="${r.host_id}">📞</span>` : avatar(r)}<span translate="no">${esc(r.full_name || r.username)}</span>${r.account_type === "host" ? " 👑" : ""}</div></a>`;
  return `<a class="dcard live ${i % 4 === 1 || i % 4 === 2 ? "tall" : ""}" href="#live/${r.id}">
    <div class="ph">${img ? `<img src="${esc(img)}" loading="lazy" alt="">` : `<div class="noimg">${esc((r.full_name || r.username || "?").charAt(0))}</div>`}
      <span class="lbadge"><i class="eq"><b></b><b></b><b></b></i>LIVE${r.in_pk ? " · ⚔️PK" : ""}</span><span class="lview">👁 ${n(r.viewers)}</span>
      <div class="tags">${r.country_code ? `<span>${flagOf(r.country_code)} ${esc(r.country_code)}</span>` : ""}${r.language ? `<span>${esc(langName(r.language))}</span>` : ""}<span class="lv">✦Lv${r.level ?? 0}</span></div></div>
    ${r.title ? `<div class="cap" translate="no">${esc(r.title)}</div>` : ""}
    <div class="who">${callable ? `<span class="lcall" data-call="${r.host_id}">📞</span>` : avatar(r)}<span translate="no">${esc(r.full_name || r.username)}</span>${r.account_type === "host" ? " 👑" : ""}</div></a>`;
};
function callChooser(h) {
  const host = { id: h.host_id ?? h.id, call_video_rate: h.call_video_rate, call_audio_rate: h.call_audio_rate };
  const body = sheet(`<div style="text-align:center">${avatar(h)}<h3 translate="no">${esc(h.full_name || h.username)}</h3>
    <div class="callbtns"><button class="cb vid" data-k="video">📹 ভিডিও কল<small>🪙${n(callRate(host, "video"))}/মিনিট</small></button>
    <button class="cb aud" data-k="audio">📞 অডিও কল<small>🪙${n(callRate(host, "audio"))}/মিনিট</small></button></div></div>`);
  body.onclick = (e) => { const b = e.target.closest("[data-k]"); if (!b) return; closeSheet(); startCall(host, b.dataset.k); };
}
document.addEventListener("click", (e) => {
  const c = e.target.closest("[data-call]"); if (!c) return;
  e.preventDefault(); e.stopPropagation();
  const h = LIVE_HOSTS.get(c.dataset.call); if (h) callChooser(h);
}, true);
const livesFor = async () => ((await rpc("list_lives", { p_limit: 60 }).catch(() => [])) ?? [])
  .filter((r) => (!S.disc?.lang || r.language === S.disc.lang) && (!S.disc?.country || r.country_code === S.disc.country));

// হোম → লাইভ ট্যাব
async function liveGrid(box) {
  const rows = await livesFor();
  const canGo = S.me.account_type === "host" || S.me.role === "admin" || setting("live_hosts_only", true) === false;
  box.innerHTML = `${canGo ? `<a class="golive-btn" href="#golive">🔴 লাইভে যান</a>` : ""}
    ${rows.length ? `<div class="disc-grid" style="padding:0"><div class="disc-col" id="lc0"></div><div class="disc-col" id="lc1"></div></div>`
      : `<div class="empty">🔴 এখন কেউ লাইভে নেই।${canGo ? "<br>আপনিই প্রথম লাইভে যান!" : ""}</div>`}`;
  rows.forEach((r, i) => { const c0 = $("#lc0"), c1 = $("#lc1"); (c0.offsetHeight <= c1.offsetHeight ? c0 : c1).insertAdjacentHTML("beforeend", liveCard(r, i)); });
}

// কেউ লাইভে থাকলে চ্যাটে ছোট ভাসমান লাইভ (শব্দ ছাড়া), চাপলে পুরো লাইভ
async function livePip(uid, o) {
  const L = await rpc("user_live", { p_user: uid }).catch(() => null);
  if (!L || location.hash !== `#chat/${uid}`) return () => {};
  const d = document.createElement("a");
  d.className = "chat-live"; d.href = `#${L.kind === "party" ? "party" : "live"}/${L.id}`;
  d.innerHTML = `${L.thumb_url || o.avatar_url ? `<img src="${esc(L.thumb_url || o.avatar_url)}" alt="">` : ""}<div class="clv" id="clv"></div>
    <span class="lbadge"><i class="eq"><b></b><b></b><b></b></i>LIVE</span><b class="clp">▶</b><button class="clx" type="button">✕</button>`;
  document.body.appendChild(d);
  let client = null, gone = false;
  const stop = () => { gone = true; d.remove(); try { client?.leave(); } catch { /* */ } client = null; };
  d.querySelector(".clx").onclick = (e) => { e.preventDefault(); e.stopPropagation(); stop(); };
  const av = document.querySelector(".chat-top .av"); if (av) av.parentElement.classList.add("is-live");
  if (L.kind === "party") { d.querySelector(".lbadge").lastChild.textContent = "PARTY"; return stop; }
  try {
    const A = await loadAgora();
    const tk = await agoraToken(`live_${L.id}`);
    if (gone) return stop;
    client = A.createClient({ mode: "live", codec: "vp8" });
    await client.setClientRole("audience", { level: 1 });
    client.on("user-published", async (user, type) => {
      if (type !== "video" || gone) return;
      await client.subscribe(user, "video");
      const box = d.querySelector("#clv"); box.innerHTML = ""; user.videoTrack?.play(box); d.classList.add("on");
    });
    await client.join(tk.appId, `live_${L.id}`, tk.token, tk.uid);
    if (gone) { client.leave(); client = null; }
  } catch { /* ছবি দেখাবে */ }
  return stop;
}

// লাইভ ও পার্টির উপরের অংশ, নিয়মের নোটিশ, দর্শক তালিকা
const roomTopHtml = (hp, host, coins) => `<div class="rt"><div class="rt-host"><a href="#u/${hp.id}">${avatarD(hp)}</a>
    <div class="rt-n"><b translate="no">${esc(hp.full_name || hp.username)}</b><small>🪙 <span id="lvG">${n(coins)}</span></small></div>
    ${host ? "" : `<button class="rt-fol hidden" id="lvF" type="button">＋</button>`}</div>
  <div class="rt-top" id="rtTop"></div><button class="rt-cnt" id="rtCnt" type="button"><span id="lvV">0</span></button></div>
  <div class="rt-fan hidden" id="rtFan"></div>`;
const ENTRY_IC = { stars: "✨", fire: "🔥", royal: "👑", rocket: "🚀", vip: "💎" };
function entryHtml(m) {
  const [, style, vip] = String(m.body).split(":"), st = String(style || "vip").replace(/[^a-z0-9-]/g, "");
  return `<span class="entry e-${st}">${ENTRY_IC[st] ?? "✨"} ${vip === "vip" ? `<i class="vipmini">VIP</i>` : ""}<b translate="no">${esc(m.username || "")}</b> এসেছে</span>`;
}
const roomMsgHtml = (m, hp) => m.kind === "rules" ? `<span class="rules" translate="no">📢 ${esc(m.body)}</span>`
  : m.kind === "fol" ? `${avatar(hp)}<span>আমাকে ফলো করুন</span><i>＋</i>`
  : m.kind === "chat" ? `<b translate="no">${esc(m.username || "")}</b> <span translate="no">${esc(m.body)}</span>`
  : m.kind === "gift" ? `🎁 <b translate="no">${esc(m.username || "")}</b> পাঠিয়েছে <span>${esc(m.body)}</span>`
  : m.kind === "like" ? `❤️ <b translate="no">${esc(m.username || "")}</b>`
  : m.kind === "join" && String(m.body || "").startsWith("fx:") ? entryHtml(m)
  : m.kind === "join" ? `<b translate="no">${esc(m.username || "")}</b> রুমে যোগ দিয়েছে`
  : `<b translate="no">${esc(m.username || "")}</b> ${esc(m.body || "")}`;
async function audienceSheet(id) {
  const body = sheet(`<h3>👥 দর্শক</h3><div class="spinner"></div>`);
  const list = (await rpc("live_audience", { p_room: id }).catch(() => [])) ?? [];
  body.innerHTML = `<h3>👥 দর্শক (${n(list.length)})</h3><div class="list aud">${list.length ? list.map((u, i) => `<a class="li" href="#u/${u.id}">
    <em class="rk ${i < 3 && u.coins ? "r" + (i + 1) : ""}">${u.coins ? i + 1 : ""}</em>${avatar(u)}<span style="flex:1;min-width:0"><b translate="no">${esc(u.full_name || u.username)}</b>
    <small class="lvb">✦Lv${u.level ?? 0}</small></span>${u.coins ? `<span class="cn">🪙 ${n(u.coins)}</span>` : ""}</a>`).join("") : `<div class="empty">এখন কোনো দর্শক নেই</div>`}</div>`;
}
async function roomTopWire(id, hp, host, addMsg) {
  addMsg({ kind: "rules", body: settingL("live_rules_notice", "অশ্লীল, অপ্রাপ্তবয়স্ক, অশালীন, সহিংস বা বেআইনি কিছু সম্পূর্ণ নিষিদ্ধ। নিয়ম ভাঙলে সঙ্গে সঙ্গে অ্যাকাউন্ট ব্যান করা হবে।") });
  const follow = async () => {
    try { const on = await rpc("toggle_follow", { p_target: hp.id }); if (on) { $("#lvF")?.classList.add("hidden"); document.querySelectorAll(".lm.fol").forEach((x) => x.remove()); toast("✓ ফলো করেছেন"); } }
    catch (er) { toast(errMsg(er), true); }
  };
  if (!host) {
    const { data: f } = await sb.from("follows").select("follower_id").eq("follower_id", S.me.id).eq("following_id", hp.id).maybeSingle();
    if (!f) { $("#lvF")?.classList.remove("hidden"); addMsg({ kind: "fol" }); }
  }
  $("#lvF")?.addEventListener("click", follow);
  $("#lvM")?.addEventListener("click", (e) => { if (e.target.closest(".lm.fol")) follow(); });
  $("#rtCnt").onclick = () => audienceSheet(id);
  $("#rtTop").onclick = () => audienceSheet(id);
  $("#rtFan").onclick = () => audienceSheet(id);
  return async () => {
    const st = await rpc("room_state", { p_room: id }).catch(() => null);
    if (!st) return null;
    if ($("#lvV")) $("#lvV").textContent = n(st.viewers);
    if ($("#rtTop")) $("#rtTop").innerHTML = (st.top ?? []).map((u, i) => `<span class="tp t${i + 1}">${avatar(u)}</span>`).join("");
    const f = st.top?.[0], fan = $("#rtFan");
    if (fan) { fan.classList.toggle("hidden", !f); if (f) fan.innerHTML = `${avatar(f)}<b>টপ ফ্যান</b>`; }
    return st;
  };
}
// নিচের বার: 💬 চাপলে লেখার ঘর খোলে
function roomChatWire(id) {
  const box = $("#lvIn"), inp = $("#lvI");
  $("#lvChat").onclick = () => { box.classList.remove("hidden"); inp.focus(); };
  inp.addEventListener("blur", () => setTimeout(() => { if (document.activeElement !== inp) box.classList.add("hidden"); }, 250));
  $("#lvF2").addEventListener("submit", async (e) => {
    e.preventDefault(); const t = inp.value.trim(); if (!t) return; inp.value = "";
    try { await rpc("live_send", { p_room: id, p_body: t, p_kind: "chat" }); } catch (er) { toast(errMsg(er), true); }
  });
  attachSuggest(inp);
}
const callPill = (hp, host) => !host && hp.account_type === "host" && hp.calls_on !== false && setting("calls_enabled", true) !== false
  ? `<button class="call-pill" id="lvCall" type="button">📞 ${n(callRate(hp, "video"))}🪙/মিনিট</button>` : "";

// মাঝের ＋ বাটন: লাইভ / পার্টি
function plusSheet() {
  const canGo = S.me?.account_type === "host" || S.me?.role === "admin" || setting("live_hosts_only", true) === false;
  const body = sheet(`<div class="plus-opts">
    <button data-o="live"><i class="po live"><svg viewBox="0 0 32 32"><rect x="3" y="8" width="19" height="16" rx="4"/><path d="M22 14l7-4v12l-7-4z"/><path class="h" d="M12.5 20.5l-3.6-3.4a2.1 2.1 0 0 1 3-3l.6.6.6-.6a2.1 2.1 0 0 1 3 3z"/></svg></i><span>লাইভ</span></button>
    <button data-o="party"><i class="po party"><svg viewBox="0 0 32 32"><path d="M4 14L16 5l12 9v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path class="h" d="M11 23v-5M16 23v-8M21 23v-4"/></svg></i><span>পার্টি<small>ভয়েস রুম</small></span></button></div>`);
  body.onclick = (e) => {
    const b = e.target.closest("[data-o]"); if (!b) return;
    closeSheet();
    if (b.dataset.o === "party") {
      if (setting("party_enabled", true) === false) return toast("পার্টি এখন বন্ধ আছে", true);
      const okP = S.me?.account_type === "host" || S.me?.role === "admin" || setting("party_hosts_only", true) === false;
      if (!okP) { toast("শুধু অনুমোদিত হোস্টরা পার্টি খুলতে পারবে — নিচে \"হোস্ট\" বেছে আবেদন করুন", true); location.hash = "#me"; return; }
      location.hash = "#goparty"; return;
    }
    if (setting("live_enabled", true) === false) return toast("লাইভ এখন বন্ধ আছে", true);
    if (!canGo) { toast("শুধু অনুমোদিত হোস্টরা লাইভ করতে পারবে — নিচে \"হোস্ট\" বেছে আবেদন করুন", true); location.hash = "#me"; return; }
    location.hash = "#golive";
  };
}
document.getElementById("plusBtn")?.addEventListener("click", (e) => { e.preventDefault(); plusSheet(); });

// লাইভ শুরুর আগের পেজ
R.golive = async () => {
  if (setting("live_enabled", true) === false) { screen.innerHTML = `<div class="page">${header("🔴 লাইভ")}<div class="empty">লাইভ এখন বন্ধ আছে</div></div>`; return; }
  screen.innerHTML = `<div class="page">${header("🔴 লাইভে যান")}
    <div class="lv-prev" id="lvp"><div class="spinner"></div></div>
    <input id="lvt" maxlength="80" placeholder="লাইভের শিরোনাম (যেমন: আড্ডা দিই 😊)">
    <button class="btn primary" id="lvGo">🔴 লাইভ শুরু করুন</button>
    <p class="notice tiny">⚠️ অশ্লীল, সহিংস বা নিয়মবিরোধী কিছু লাইভে দেখালে লাইভ বন্ধ করে অ্যাকাউন্ট ব্যান করা হবে।</p></div>`;
  let cam = null;
  try {
    needMedia();
    const A = await loadAgora();
    cam = await A.createCameraVideoTrack({ encoderConfig: "720p_1" });
    $("#lvp").innerHTML = ""; cam.play($("#lvp"), { mirror: true });
  } catch (e) { $("#lvp").innerHTML = `<div class="empty">${esc(e.message || "ক্যামেরা চালু করা যায়নি — অনুমতি দিন")}</div>`; }
  cleanup = () => { try { cam?.close(); } catch { /* */ } };
  $("#lvGo").onclick = async (e) => {
    e.currentTarget.disabled = true;
    try { const r = await rpc("live_start", { p_title: $("#lvt").value }); try { cam?.close(); } catch { /* */ } cam = null; location.replace(`#live/${r.room_id}`); }
    catch (er) { toast(errMsg(er), true); e.currentTarget.disabled = false; }
  };
};

// লাইভ দেখা / চালানো: #live/<id>
R.live = async (rid) => {
  const id = Number(rid);
  screen.classList.add("full");
  document.body.classList.add("story-open");
  try { Native?.setDarkBars?.(true); Native?.setSecure?.(true); } catch { /* */ }
  screen.innerHTML = `<div class="lvroom"><div class="spinner" style="margin-top:40vh"></div></div>`;
  let info;
  try { needMedia(); info = await rpc("live_join", { p_room: id }); }
  catch (e) { document.body.classList.remove("story-open"); toast(errMsg(e), true); location.replace("#home"); return; }
  const host = info.host_id === S.me.id;
  const { data: hp } = await sb.from("profiles").select("id,username,full_name,avatar_url,user_no,account_type,calls_on,call_video_rate,call_audio_rate,deco,vip_until,vip_plan_id").eq("id", info.host_id).single();
  screen.innerHTML = `<div class="lvroom">
    <div class="lv-main" id="lvMain"><div class="lv-wait">${avatar(hp)}<div>লাইভ লোড হচ্ছে…</div></div></div>
    <div class="lv-guest hidden" id="lvGuest"></div><div class="lv-pk2 hidden" id="lvPk2"></div>
    <div class="pkbar hidden" id="pkBar"><div class="pk-names"><b id="pkNa" translate="no"></b><span id="pkTm"></span><b id="pkNb" translate="no"></b></div>
      <div class="pk-track"><i id="pkA"></i><i id="pkB"></i><span class="sa" id="pkSa">0</span><span class="sb" id="pkSb">0</span></div></div>
    <div class="pk-res hidden" id="pkRes"></div>
    ${roomTopHtml(hp, host, info.gift_coins)}
    ${info.title ? `<div class="lv-title" translate="no">${esc(info.title)}</div>` : ""}
    <div class="lv-msgs" id="lvM"></div>
    <div class="lv-hearts" id="lvH"></div>
    <div class="lv-in hidden" id="lvIn"><form id="lvF2"><input id="lvI" maxlength="200" placeholder="কিছু বলুন…" autocomplete="off"><button class="lv-send">➤</button></form></div>
    <div class="lv-bar"><button class="lv-b" id="lvChat" type="button">💬</button>${callPill(hp, host)}<span class="sp"></span>
      ${host ? `${setting("pk_enabled", true) !== false ? `<button class="lv-b pkb" id="lvPk">⚔️</button>` : ""}<button class="lv-b" id="lvReq">🙋<b id="lvRc" class="hidden"></b></button><button class="lv-b" id="lvCam">🔄</button><button class="lv-b" id="lvMic">🎤</button>`
        : `<button class="lv-b" id="lvJoin">🙋</button><button class="lv-b" id="lvLike">❤️</button><button class="lv-b gift" id="lvGift">🎁</button>`}<button class="lv-b" id="lvX">✕</button></div></div>`;
  const msgs = $("#lvM");
  const addMsg = (m) => {
    const d = document.createElement("div");
    d.className = "lm " + m.kind;
    d.innerHTML = roomMsgHtml(m, hp);
    msgs.appendChild(d);
    while (msgs.children.length > 60) msgs.firstChild.remove();
    msgs.scrollTop = msgs.scrollHeight;
    if (m.kind === "gift") { const f = document.createElement("div"); f.className = "gift-fly"; f.textContent = (m.body || "🎁").split(" ")[0]; document.body.appendChild(f); setTimeout(() => f.remove(), 1700); }
    if (m.kind === "like") heart();
  };
  const heart = () => { const h = document.createElement("i"); h.textContent = ["❤️", "💖", "💜", "💛", "🧡"][Math.floor(Math.random() * 5)]; h.style.left = 20 + Math.random() * 40 + "px"; $("#lvH")?.appendChild(h); setTimeout(() => h.remove(), 2200); };
  const refreshTop = await roomTopWire(id, hp, host, addMsg);
  const { data: old } = await sb.from("live_messages").select("*").eq("room_id", id).order("id", { ascending: false }).limit(30);
  (old ?? []).reverse().forEach(addMsg);
  refreshTop();
  roomChatWire(id);
  $("#lvCall")?.addEventListener("click", () => callChooser({ ...hp, host_id: hp.id }));

  // Agora
  let client = null, mic = null, cam = null, ended = false, myRole = "audience", facing = "user";
  const mainUid = hp.user_no;
  const showEnded = (why) => {
    if (ended) return; ended = true;
    $("#lvMain").innerHTML = `<div class="lv-wait">${avatar(hp)}<div><b>লাইভ শেষ হয়েছে</b></div><div class="tiny">${esc(why || "")}</div><a class="btn small" href="#home" style="margin-top:12px">অন্য লাইভ দেখুন</a></div>`;
    $("#lvGuest").classList.add("hidden");
    leaveRtc();
  };
  const liveThumb = async () => {
    try {
      const f = cam?.getCurrentFrameData?.(); if (!f?.width) return;
      const c = document.createElement("canvas"), sc = Math.min(1, 720 / Math.max(f.width, f.height));
      const t = document.createElement("canvas"); t.width = f.width; t.height = f.height; t.getContext("2d").putImageData(f, 0, 0);
      c.width = Math.round(f.width * sc); c.height = Math.round(f.height * sc); c.getContext("2d").drawImage(t, 0, 0, c.width, c.height);
      const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.8));
      const path = `${S.me.id}/live-${id}.jpg`;
      await xhrUpload("photos", path, blob, "image/jpeg", () => {});
      await rpc("live_set_thumb", { p_room: id, p_url: sb.storage.from("photos").getPublicUrl(path).data.publicUrl + "?t=" + Date.now() });
    } catch { /* ছবি না গেলে প্রোফাইল ছবি দেখাবে */ }
  };
  const leaveRtc = async () => { try { mic?.close(); cam?.close(); } catch { /* */ } mic = cam = null; try { await client?.leave(); } catch { /* */ } };
  const publish = async () => {
    const A = await loadAgora();
    if (!mic) [mic, cam] = await A.createMicrophoneAndCameraTracks({}, { encoderConfig: "720p_1", facingMode: facing });
    await client.setClientRole("host");
    await client.publish([mic, cam]);
    myRole = "host";
    if (host) { $("#lvMain").innerHTML = ""; cam.play($("#lvMain"), { mirror: facing === "user" }); setTimeout(liveThumb, 4000); }
    else { const g = $("#lvGuest"); g.classList.remove("hidden"); g.innerHTML = ""; cam.play(g, { mirror: true }); }
  };
  try {
    const A = await loadAgora();
    const tk = await agoraToken(`live_${id}`);
    client = A.createClient({ mode: "live", codec: "vp8" });
    client.on("user-published", async (user, type) => {
      await client.subscribe(user, type);
      if (type === "audio") user.audioTrack?.play();
      if (type === "video") {
        const box = user.uid === mainUid ? $("#lvMain") : $("#lvGuest");
        if (!box) return;
        box.classList.remove("hidden"); box.innerHTML = ""; user.videoTrack?.play(box);
      }
    });
    client.on("user-unpublished", (user, type) => { if (type === "video" && user.uid !== mainUid) $("#lvGuest")?.classList.add("hidden"); });
    client.on("user-left", (user) => { if (user.uid !== mainUid) $("#lvGuest")?.classList.add("hidden"); });
    client.on("token-privilege-will-expire", async () => { try { const t = await agoraToken(`live_${id}`); await client.renewToken(t.token); } catch { /* */ } });
    if (tk.role === "publisher") { await client.setClientRole("host"); } else await client.setClientRole("audience", { level: 1 });
    await client.join(tk.appId, `live_${id}`, tk.token, tk.uid);
    if (host || tk.role === "publisher") await publish();
  } catch (e) { toast(errMsg(e), true); }

  // ⚔️ PK ব্যাটল
  let pk = null, pkClient = null, pkT = null, pkCh = null;
  const pkPaint = () => {
    if (!pk) return;
    const mineA = pk.room_a === id, a = mineA ? pk.score_a : pk.score_b, b = mineA ? pk.score_b : pk.score_a, t = Number(a) + Number(b);
    $("#pkA").style.width = (t ? Math.max(8, Math.min(92, (a * 100) / t)) : 50) + "%";
    $("#pkSa").textContent = n(a); $("#pkSb").textContent = n(b);
  };
  const pkTick = () => {
    if (!pk) return;
    const left = Math.max(0, (new Date(pk.ends_at) - Date.now()) / 1000);
    $("#pkTm").textContent = "⚔️ " + hms2(left);
    if (left <= 0 && !pk.fin) { pk.fin = true; rpc("pk_finish", { p_pk: pk.id }).then(() => pkEnd()).catch(() => {}); }
  };
  async function pkStart(pid) {
    if (pk?.id === pid || ended) return;
    const { data: b } = await sb.from("pk_battles").select("*").eq("id", pid).single();
    if (!b || b.status !== "active") return;
    pk = b;
    const mineA = b.room_a === id, otherRoom = mineA ? b.room_b : b.room_a;
    const { data: op } = await sb.from("profiles").select("id,username,full_name,avatar_url,user_no").eq("id", mineA ? b.host_b : b.host_a).single();
    $(".lvroom").classList.add("pk");
    $("#pkBar").classList.remove("hidden");
    $("#pkNa").textContent = "@" + hp.username; $("#pkNb").textContent = "@" + (op?.username ?? "");
    const box = $("#pkVs"); if (box) box.remove();
    $("#lvPk2").classList.remove("hidden"); $("#lvPk2").innerHTML = `<div class="lv-wait">${avatar(op)}</div>`;
    pkPaint(); pkTick(); pkT = setInterval(pkTick, 1000);
    const vs = document.createElement("div"); vs.className = "pk-vs"; vs.id = "pkVs"; vs.textContent = "VS"; $(".lvroom").appendChild(vs); setTimeout(() => vs.remove(), 2500);
    pkCh = sb.channel("pk-" + pid).on("postgres_changes", { event: "UPDATE", schema: "public", table: "pk_battles", filter: `id=eq.${pid}` }, (p) => {
      if (!pk) return; Object.assign(pk, p.new); pkPaint(); if (p.new.status !== "active") pkEnd();
    }).subscribe();
    try {
      const A = await loadAgora();
      const tk = await agoraToken(`live_${otherRoom}`);
      pkClient = A.createClient({ mode: "live", codec: "vp8" });
      await pkClient.setClientRole("audience", { level: 1 });
      pkClient.on("user-published", async (user, type) => {
        if (user.uid !== op?.user_no) return;
        await pkClient.subscribe(user, type);
        if (type === "audio") user.audioTrack?.play();
        if (type === "video" && $("#lvPk2")) { $("#lvPk2").innerHTML = ""; user.videoTrack?.play($("#lvPk2")); }
      });
      await pkClient.join(tk.appId, `live_${otherRoom}`, tk.token, tk.uid);
    } catch { /* অন্য হোস্টের ছবি দেখাবে */ }
  }
  async function pkEnd() {
    if (!pk) return;
    const old = pk; pk = null;
    clearInterval(pkT); if (pkCh) sb.removeChannel(pkCh); pkCh = null;
    try { await pkClient?.leave(); } catch { /* */ } pkClient = null;
    const { data: b } = await sb.from("pk_battles").select("*").eq("id", old.id).single();
    const myHost = old.room_a === id ? old.host_a : old.host_b, res = $("#pkRes");
    if (b?.status === "ended" && res) {
      res.innerHTML = !b.winner ? "🤝 ড্র" : b.winner === myHost ? `🏆 জয়!${host && b.bonus_paisa ? `<small>বোনাস ${tk(b.bonus_paisa)}</small>` : ""}` : "😢 হার";
      res.className = "pk-res " + (!b.winner ? "draw" : b.winner === myHost ? "win" : "lose");
      setTimeout(() => res.classList.add("hidden"), 5000);
    }
    $(".lvroom")?.classList.remove("pk"); $("#pkBar")?.classList.add("hidden"); $("#lvPk2")?.classList.add("hidden");
  }
  const { data: lr0 } = await sb.from("live_rooms").select("pk_id").eq("id", id).single();
  if (lr0?.pk_id) pkStart(lr0.pk_id);
  const pkInvite = async (b) => {
    if (!host || b.room_b !== id || b.status !== "invited") return;
    const { data: op } = await sb.from("profiles").select("username,full_name,avatar_url").eq("id", b.host_a).single();
    const body = sheet(`<div style="text-align:center">${avatar(op)}<h3>⚔️ PK চ্যালেঞ্জ!</h3><p><b translate="no">@${esc(op?.username)}</b> আপনাকে ${hms2(b.duration_sec)} মিনিটের PK ব্যাটলে ডেকেছে।<br>যে বেশি গিফট পাবে সে জিতবে আর বোনাস পাবে।</p>
      <div class="row" style="gap:8px"><button class="btn" id="pkNo">না</button><button class="btn primary" id="pkYes">⚔️ রাজি</button></div></div>`);
    const tmo = setTimeout(closeSheet, 35000);
    body.querySelector("#pkNo").onclick = () => { clearTimeout(tmo); closeSheet(); rpc("pk_answer", { p_pk: b.id, p_accept: false }).catch(() => {}); };
    body.querySelector("#pkYes").onclick = async () => { clearTimeout(tmo); closeSheet(); try { await rpc("pk_answer", { p_pk: b.id, p_accept: true }); pkStart(b.id); } catch (e) { toast(errMsg(e), true); } };
  };
  $("#lvPk")?.addEventListener("click", async () => {
    if (pk) { if (await ask("PK এখনই শেষ করবেন? যার স্কোর বেশি সে জিতবে।")) rpc("pk_finish", { p_pk: pk.id }).then(() => pkEnd()).catch((e) => toast(errMsg(e), true)); return; }
    const list = (await rpc("pk_candidates", { p_room: id }).catch(() => [])) ?? [];
    const body = sheet(`<h3>⚔️ PK ব্যাটল</h3><p class="tiny muted">অন্য একজন লাইভ হোস্টকে চ্যালেঞ্জ দিন। ${hms2(setting("pk_duration_sec", 300))} মিনিটে যার দর্শকরা বেশি গিফট দেবে সে জিতবে ও বোনাস পাবে।</p>
      <div class="list">${list.length ? list.map((r) => `<div class="li" style="display:flex;gap:10px;align-items:center">${avatar(r)}<span style="flex:1"><b translate="no">${esc(r.full_name || r.username)}</b><div class="tiny muted">👁 ${n(r.viewers)} <span translate="no">${esc(r.title || "")}</span></div></span>
        <button class="btn small primary" data-pk="${r.room_id}" style="width:auto;margin:0">⚔️ চ্যালেঞ্জ</button></div>`).join("") : `<div class="empty">এখন আর কোনো হোস্ট লাইভে নেই</div>`}</div>`);
    body.onclick = async (e) => {
      const b = e.target.closest("[data-pk]"); if (!b) return;
      try { await rpc("pk_invite", { p_room: id, p_target: Number(b.dataset.pk) }); closeSheet(); toast("⚔️ চ্যালেঞ্জ পাঠানো হয়েছে — রাজি হলে PK শুরু হবে"); } catch (er) { toast(errMsg(er), true); }
    };
  });

  // রিয়েলটাইম
  const ch = sb.channel("live-" + id)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "pk_battles", filter: `host_b=eq.${S.me.id}` }, (p) => pkInvite(p.new))
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "pk_battles", filter: `host_a=eq.${S.me.id}` }, (p) => {
      if (!host || p.new.room_a !== id) return;
      if (p.new.status === "active") pkStart(p.new.id); else if (p.new.status === "declined") toast("হোস্ট PK-তে রাজি হয়নি");
    })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "live_messages", filter: `room_id=eq.${id}` }, (p) => {
      addMsg(p.new);
      if (p.new.kind === "gift") { rpc("live_heartbeat", { p_room: id }).then((h) => { if ($("#lvG")) $("#lvG").textContent = n(h.gift_coins); }).catch(() => {}); refreshTop(); }
    })
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "live_rooms", filter: `id=eq.${id}` }, (p) => {
      if (p.new.status === "ended") showEnded(p.new.ended_reason === "admin" ? "অ্যাডমিন লাইভ বন্ধ করেছেন" : "");
      if (p.new.pk_id && pk?.id !== p.new.pk_id) pkStart(p.new.pk_id); else if (!p.new.pk_id && pk) pkEnd();
      if ($("#lvL")) $("#lvL").textContent = n(p.new.likes);
      if ($("#lvG")) $("#lvG").textContent = n(p.new.gift_coins);
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "live_cohosts", filter: `room_id=eq.${id}` }, async (p) => {
      const r = p.new;
      if (host) { paintReq(); return; }
      if (r.user_id !== S.me.id) return;
      if (r.status === "accepted" && myRole !== "host") {
        try { const t = await agoraToken(`live_${id}`); await client.renewToken(t.token); await publish(); toast("🎤 আপনি এখন লাইভে!"); }
        catch (e) { toast(errMsg(e), true); }
      } else if ((r.status === "ended" || r.status === "rejected") && myRole === "host") {
        try { await client.unpublish(); mic?.close(); cam?.close(); mic = cam = null; await client.setClientRole("audience", { level: 1 }); } catch { /* */ }
        myRole = "audience"; $("#lvGuest").classList.add("hidden");
      } else if (r.status === "rejected") toast("হোস্ট এখন রাজি নয়");
    })
    .subscribe();
  const hb = setInterval(() => rpc("live_heartbeat", { p_room: id }).then((h) => {
    if (h.status === "ended") return showEnded();
    refreshTop();
  }).catch(() => {}), 20000);

  // হোস্টের অতিথি অনুরোধ
  let reqs = [];
  async function paintReq() {
    const { data } = await sb.from("live_cohosts").select("user_id,status,profiles!live_cohosts_user_id_fkey(username,full_name,avatar_url)").eq("room_id", id).in("status", ["pending", "accepted"]);
    reqs = data ?? [];
    const pend = reqs.filter((r) => r.status === "pending").length;
    const b = $("#lvRc"); if (b) { b.textContent = pend; b.classList.toggle("hidden", !pend); }
  }
  if (host) paintReq();
  $("#lvReq")?.addEventListener("click", async () => {
    await paintReq();
    const body = sheet(`<h3>🙋 লাইভে যোগ দিতে চায়</h3><div class="list">${reqs.length ? reqs.map((r) => `<div class="li" style="display:flex;gap:10px;align-items:center">${avatar(r.profiles)}
      <span style="flex:1"><b translate="no">${esc(r.profiles?.full_name || r.profiles?.username)}</b><div class="tiny muted">@${esc(r.profiles?.username)}${r.status === "accepted" ? " · 🎤 লাইভে আছে" : ""}</div></span>
      ${r.status === "pending" ? `<button class="btn small primary" data-a="${r.user_id}" style="width:auto;margin:0">রাজি</button><button class="btn small" data-r="${r.user_id}" style="width:auto;margin:0">না</button>`
        : `<button class="btn small" data-r="${r.user_id}" style="width:auto;margin:0">সরান</button>`}</div>`).join("") : `<div class="empty">এখনো কেউ অনুরোধ করেনি</div>`}</div>`);
    body.onclick = async (e) => {
      const a = e.target.closest("[data-a]"), r = e.target.closest("[data-r]"); if (!a && !r) return;
      try { await rpc("live_answer_cohost", { p_room: id, p_user: (a || r).dataset.a || (a || r).dataset.r, p_accept: !!a }); closeSheet(); paintReq(); } catch (er) { toast(errMsg(er), true); }
    };
  });
  $("#lvJoin")?.addEventListener("click", async () => {
    if (myRole === "host") { if (await ask("লাইভ থেকে নেমে যাবেন?")) { await rpc("live_leave", { p_room: id }).catch(() => {}); } return; }
    try { await rpc("live_request_cohost", { p_room: id }); toast("🙋 অনুরোধ পাঠানো হয়েছে — হোস্ট রাজি হলে আপনি লাইভে চলে আসবেন"); } catch (e) { toast(errMsg(e), true); }
  });
  $("#lvGift")?.addEventListener("click", () => openGifts({ _v: { username: hp.username, id: 0 } }, false, id));
  let likeT = 0;
  $("#lvLike")?.addEventListener("click", () => { heart(); if (Date.now() - likeT > 1500) { likeT = Date.now(); rpc("live_send", { p_room: id, p_body: "❤️", p_kind: "like" }).catch(() => {}); } });

  $("#lvCam")?.addEventListener("click", async () => { facing = facing === "user" ? "environment" : "user"; try { await cam?.setDevice({ facingMode: facing }); } catch { toast("ক্যামেরা বদলানো যায়নি", true); } });
  $("#lvMic")?.addEventListener("click", async (e) => { if (!mic) return; const on = !mic.muted; await mic.setMuted(on); e.currentTarget.textContent = on ? "🔇" : "🎤"; });
  const endLive = async () => { await rpc("live_end", { p_room: id }).catch(() => {}); showEnded(); };
  $("#lvEnd")?.addEventListener("click", async () => { if (await ask("লাইভ শেষ করবেন?")) { await endLive(); location.replace("#home"); } });
  $("#lvX").onclick = async () => { if (host && !ended) { if (!await ask("লাইভ শেষ করে বের হবেন?")) return; await endLive(); } history.back(); };
  cleanup = () => {
    clearInterval(hb); sb.removeChannel(ch); clearInterval(pkT); if (pkCh) sb.removeChannel(pkCh); try { pkClient?.leave(); } catch { /* */ }
    if (host && !ended) rpc("live_end", { p_room: id }).catch(() => {}); else rpc("live_leave", { p_room: id }).catch(() => {});
    leaveRtc();
    document.body.classList.remove("story-open");
    try { Native?.setSecure?.(false); Native?.setDarkBars?.(false); } catch { /* */ }
  };
};

// 🎉 পার্টি (ভয়েস রুম)
R.goparty = () => {
  const max = Math.max(1, Number(setting("party_max_seats", 8)));
  const opts = [2, 4, 6, 8, 12].filter((x) => x <= max); if (!opts.includes(max)) opts.push(max);
  screen.innerHTML = `<div class="page">${header("🎉 পার্টি খুলুন")}
    <div class="pty-prev"><div class="pty-hostseat">${avatar(S.me)}<b translate="no">${esc(S.me.full_name || S.me.username)}</b></div>
      <div class="pty-seats demo">${Array.from({ length: Math.min(max, 8) }, (_, i) => `<div class="seat"><i>🪑</i><small>${i + 1}</small></div>`).join("")}</div></div>
    <input id="pyt" maxlength="80" placeholder="পার্টির নাম (যেমন: রাতের আড্ডা 🌙)">
    <label class="lbl">কতগুলো সিট (অতিথি)</label>
    <div class="seg" id="pys">${opts.map((x) => `<button type="button" data-n="${x}" class="${x === Math.min(8, max) ? "on" : ""}">${x}</button>`).join("")}</div>
    <label class="toggle card" style="margin-top:12px"><span><b>🔓 ফ্রি সিট</b><div class="tiny muted">চালু থাকলে যে কেউ খালি সিটে চাপ দিয়ে বসতে পারবে, না হলে আপনার অনুমতি লাগবে</div></span><input type="checkbox" id="pyf" class="sw"></label>
    <button class="btn primary" id="pyGo">🎉 পার্টি শুরু করুন</button>
    <p class="notice tiny">⚠️ গালিগালাজ, অশ্লীল বা নিয়মবিরোধী কথা বললে পার্টি বন্ধ করে অ্যাকাউন্ট ব্যান করা হবে।</p></div>`;
  let seats = Math.min(8, max);
  $("#pys").onclick = (e) => { const b = e.target.closest("[data-n]"); if (!b) return; seats = Number(b.dataset.n); $("#pys").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); };
  $("#pyGo").onclick = async (e) => {
    e.currentTarget.disabled = true;
    try {
      needMedia();
      const r = await rpc("party_start", { p_title: $("#pyt").value, p_seats: seats });
      if ($("#pyf").checked) await rpc("party_settings", { p_room: r.room_id, p_free: true }).catch(() => {});
      location.replace(`#party/${r.room_id}`);
    } catch (er) { toast(errMsg(er), true); e.currentTarget.disabled = false; }
  };
};

R.party = async (rid) => {
  const id = Number(rid);
  screen.classList.add("full");
  document.body.classList.add("story-open");
  try { Native?.setDarkBars?.(true); } catch { /* */ }
  screen.innerHTML = `<div class="pty"><div class="spinner" style="margin-top:40vh"></div></div>`;
  let info;
  try { needMedia(); info = await rpc("live_join", { p_room: id }); }
  catch (e) { document.body.classList.remove("story-open"); toast(errMsg(e), true); location.replace("#home"); return; }
  const host = info.host_id === S.me.id;
  const [{ data: hp }, { data: room }] = await Promise.all([
    sb.from("profiles").select("id,username,full_name,avatar_url,user_no,account_type,deco,vip_until,vip_plan_id").eq("id", info.host_id).single(),
    sb.from("live_rooms").select("id,kind,seats,free_seats,title").eq("id", id).single(),
  ]);
  if (room?.kind !== "party") { location.replace(`#live/${id}`); return; }
  let free = !!room.free_seats;
  const { data: hpx } = await sb.from("profiles").select("calls_on,call_video_rate,call_audio_rate").eq("id", hp.id).single();
  Object.assign(hp, hpx ?? {});
  screen.innerHTML = `<div class="pty">
    ${roomTopHtml(hp, host, info.gift_coins)}
    <div class="pty-title" translate="no">🎉 ${esc(room.title || L("পার্টি রুম", "Party room"))}</div>
    <div class="pty-grid" id="pySeats"></div>
    <div class="lv-msgs pty-msgs" id="lvM"></div>
    <div class="lv-hearts" id="lvH"></div>
    <div class="lv-in hidden" id="lvIn"><form id="lvF2"><input id="lvI" maxlength="200" placeholder="কিছু বলুন…" autocomplete="off"><button class="lv-send">➤</button></form></div>
    <div class="lv-bar"><button class="lv-b" id="lvChat" type="button">💬</button>${callPill(hp, host)}<span class="sp"></span>
      ${host ? `<button class="lv-b" id="pyReq">🙋<b id="lvRc" class="hidden"></b></button><button class="lv-b" id="pyFree">${free ? "🔓" : "🔒"}</button><button class="lv-b" id="pyMic">🎤</button>`
        : `<button class="lv-b" id="pyMic">🎤</button><button class="lv-b" id="pyLike">❤️</button><button class="lv-b gift" id="pyGift">🎁</button>`}<button class="lv-b" id="lvX">✕</button></div></div>`;
  if (!host) $("#pyMic").style.display = "none";
  const msgs = $("#lvM");
  const heart = () => { const h = document.createElement("i"); h.textContent = ["❤️", "💖", "💜", "💛", "🧡"][Math.floor(Math.random() * 5)]; h.style.left = 20 + Math.random() * 40 + "px"; $("#lvH")?.appendChild(h); setTimeout(() => h.remove(), 2200); };
  const addMsg = (m) => {
    const d = document.createElement("div");
    d.className = "lm " + m.kind;
    d.innerHTML = roomMsgHtml(m, hp);
    msgs.appendChild(d);
    while (msgs.children.length > 60) msgs.firstChild.remove();
    msgs.scrollTop = msgs.scrollHeight;
    if (m.kind === "gift") { const f = document.createElement("div"); f.className = "gift-fly"; f.textContent = (m.body || "🎁").split(" ")[0]; document.body.appendChild(f); setTimeout(() => f.remove(), 1700); }
    if (m.kind === "like") heart();
  };
  const refreshTop = await roomTopWire(id, hp, host, addMsg);
  const { data: old } = await sb.from("live_messages").select("*").eq("room_id", id).order("id", { ascending: false }).limit(30);
  (old ?? []).reverse().forEach(addMsg);
  roomChatWire(id);
  $("#lvCall")?.addEventListener("click", () => callChooser({ ...hp, host_id: hp.id }));

  // সিট (৩ কলামের টাইল: ১ = হোস্ট 🏠)
  let seatRows = [], me = null, reqs = [], rs = { recv: {}, cc: {} };
  const tile = (num, u, p, muted, isHost) => `<div class="tile on" data-u="${u}" data-uno="${p?.user_no ?? ""}">
      <span class="tn">${isHost ? "🏠" : num}</span><span class="tc">🪙 ${n(rs.recv?.[u] ?? 0)}</span>${avatar(p)}
      <div class="tb">${rs.cc?.[u] ? `<i class="fl">${flagOf(rs.cc[u])}</i>` : ""}<b translate="no">${esc(p?.full_name || p?.username || "")}</b><i class="mc">${muted ? "🔇" : "🎙️"}</i></div></div>`;
  const paintSeats = () => {
    const box = $("#pySeats"); if (!box || ended) return;
    box.innerHTML = tile(1, hp.id, hp, false, true) + Array.from({ length: room.seats }, (_, i) => {
      const r = seatRows.find((x) => x.seat === i + 1);
      return r ? tile(i + 2, r.user_id, r.profiles, r.muted, false) : `<div class="tile" data-empty="${i + 1}"><span class="tn">${i + 2}</span><i class="chair">🪑</i></div>`;
    }).join("");
  };
  const refreshAll = async () => { const st = await refreshTop(); if (st) { rs = st; paintSeats(); } };
  const uidMap = new Map([[hp.user_no, hp.id]]);
  async function loadSeats() {
    const { data } = await sb.from("live_cohosts").select("user_id,status,seat,muted,profiles!live_cohosts_user_id_fkey(username,full_name,avatar_url,user_no)").eq("room_id", id).in("status", ["pending", "accepted"]);
    seatRows = (data ?? []).filter((r) => r.status === "accepted");
    reqs = (data ?? []).filter((r) => r.status === "pending");
    seatRows.forEach((r) => uidMap.set(r.profiles?.user_no, r.user_id));
    me = seatRows.find((r) => r.user_id === S.me.id) ?? null;
    paintSeats();
    const b = $("#lvRc"); if (b) { b.textContent = reqs.length; b.classList.toggle("hidden", !reqs.length); }
    await syncRole();
  }

  // Agora (শুধু আওয়াজ)
  let client = null, mic = null, ended = false, onStage = false, myMuted = false;
  const syncRole = async () => {
    if (!client || ended) return;
    const want = host || !!me;
    try {
      if (want && !onStage) {
        onStage = true;
        if (!host) { const t = await agoraToken(`live_${id}`); await client.renewToken(t.token); }
        const A = await loadAgora();
        mic = mic || await A.createMicrophoneAudioTrack({ AEC: true, ANS: true });
        await client.setClientRole("host");
        await client.publish([mic]);
        if (!host) { $("#pyMic").style.display = ""; toast("🎤 আপনি সিটে বসেছেন — এখন কথা বলতে পারবেন"); }
      } else if (!want && onStage) {
        onStage = false;
        try { await client.unpublish(); } catch { /* */ }
        try { mic?.close(); } catch { /* */ } mic = null;
        await client.setClientRole("audience", { level: 1 });
        if (!host) $("#pyMic").style.display = "none";
      }
      if (me && mic) { const m = !!me.muted; if (m !== myMuted) { myMuted = m; await mic.setMuted(m); $("#pyMic").textContent = m ? "🔇" : "🎤"; } }
    } catch (e) { onStage = false; toast(errMsg(e), true); }
  };
  try {
    const A = await loadAgora();
    const tk = await agoraToken(`live_${id}`);
    client = A.createClient({ mode: "live", codec: "vp8" });
    client.on("user-published", async (user, type) => { if (type !== "audio") return; await client.subscribe(user, "audio"); user.audioTrack?.play(); });
    client.on("token-privilege-will-expire", async () => { try { const t = await agoraToken(`live_${id}`); await client.renewToken(t.token); } catch { /* */ } });
    client.enableAudioVolumeIndicator();
    client.on("volume-indicator", (vols) => {
      document.querySelectorAll(".pty .talk").forEach((x) => x.classList.remove("talk"));
      for (const v of vols) {
        if (v.level < 6) continue;
        const uno = v.uid === 0 || v.uid === tk.uid ? S.me.user_no : v.uid;
        document.querySelector(`.pty [data-uno="${uno}"]`)?.classList.add("talk");
      }
    });
    await client.setClientRole(tk.role === "publisher" ? "host" : "audience", tk.role === "publisher" ? undefined : { level: 1 });
    await client.join(tk.appId, `live_${id}`, tk.token, tk.uid);
  } catch (e) { toast(errMsg(e), true); }
  await loadSeats();
  refreshAll();

  const showEnded = (why) => {
    if (ended) return; ended = true;
    $("#pySeats").outerHTML = `<div class="lv-wait" style="position:static;background:none;margin-top:120px">${avatar(hp)}<b>পার্টি শেষ হয়েছে</b><div class="tiny">${esc(why || "")}</div><a class="btn small" href="#home" style="margin-top:12px">অন্য লাইভ দেখুন</a></div>`;
    try { mic?.close(); } catch { /* */ } mic = null; try { client?.leave(); } catch { /* */ }
  };
  const ch = sb.channel("party-" + id)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "live_messages", filter: `room_id=eq.${id}` }, (p) => { addMsg(p.new); if (p.new.kind === "gift") refreshAll(); })
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "live_rooms", filter: `id=eq.${id}` }, (p) => {
      if (p.new.status === "ended") showEnded(p.new.ended_reason === "admin" ? "অ্যাডমিন পার্টি বন্ধ করেছেন" : "");
      if ($("#lvG")) $("#lvG").textContent = n(p.new.gift_coins);
      free = !!p.new.free_seats; if ($("#pyFree")) $("#pyFree").textContent = free ? "🔓" : "🔒";
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "live_cohosts", filter: `room_id=eq.${id}` }, (p) => {
      const was = !!me;
      loadSeats().then(() => { if (was && !me && p.new?.user_id === S.me.id && p.new.status === "ended") toast("আপনাকে সিট থেকে নামানো হয়েছে"); if (p.new?.user_id === S.me.id && p.new.status === "rejected") toast("হোস্ট এখন রাজি নয়"); });
    })
    .subscribe();
  const hb = setInterval(() => rpc("live_heartbeat", { p_room: id }).then((h) => {
    if (h.status === "ended") return showEnded();
    refreshAll();
  }).catch(() => {}), 20000);

  // সিটে চাপ
  screen.querySelector(".pty").addEventListener("click", async (e) => {
    const empty = e.target.closest("[data-empty]");
    if (empty) {
      if (host) return toast("অতিথিরা 🪑 খালি সিটে চাপ দিয়ে বসতে চাইবে");
      if (me) return toast("আপনি ইতিমধ্যে সিটে আছেন");
      try { await rpc("live_request_cohost", { p_room: id }); if (!free) toast("🙋 অনুরোধ পাঠানো হয়েছে — হোস্ট রাজি হলে আপনি সিটে বসবেন"); } catch (er) { toast(errMsg(er), true); }
      return;
    }
    const s = e.target.closest(".tile.on"); if (!s) return;
    const uid = s.dataset.u, isHostSeat = uid === hp.id, row = seatRows.find((r) => r.user_id === uid), pr = isHostSeat ? hp : row?.profiles;
    const self = uid === S.me.id;
    const body = sheet(`<div style="text-align:center">${avatar(pr)}<h3 translate="no">${esc(pr?.full_name || pr?.username || "")}</h3>
      <div class="list">
        <a class="li" href="#u/${uid}">👤 প্রোফাইল দেখুন</a>
        ${self ? "" : `<button class="li" data-a="gift">🎁 গিফট পাঠান</button>`}
        ${host && !isHostSeat ? `<button class="li" data-a="mute">${row?.muted ? "🔊 মাইক চালু করুন" : "🔇 মাইক বন্ধ করুন"}</button><button class="li" data-a="kick">⬇️ সিট থেকে নামান</button>` : ""}
        ${self && !host ? `<button class="li" data-a="leave">⬇️ সিট ছেড়ে দিন</button>` : ""}</div></div>`);
    body.onclick = async (ev) => {
      const a = ev.target.closest("[data-a]")?.dataset.a; if (!a) return;
      closeSheet();
      try {
        if (a === "gift") openGifts({ _v: { username: pr?.username, id: 0 } }, false, id, isHostSeat ? null : uid);
        else if (a === "mute") await rpc("party_mute", { p_room: id, p_user: uid, p_muted: !row?.muted });
        else if (a === "kick") await rpc("live_answer_cohost", { p_room: id, p_user: uid, p_accept: false });
        else if (a === "leave") await rpc("live_leave", { p_room: id });
      } catch (er) { toast(errMsg(er), true); }
    };
  });
  $("#pyReq")?.addEventListener("click", async () => {
    await loadSeats();
    const body = sheet(`<h3>🙋 সিটে বসতে চায়</h3><div class="list">${reqs.length ? reqs.map((r) => `<div class="li" style="display:flex;gap:10px;align-items:center">${avatar(r.profiles)}
      <span style="flex:1"><b translate="no">${esc(r.profiles?.full_name || r.profiles?.username)}</b><div class="tiny muted">@${esc(r.profiles?.username)}</div></span>
      <button class="btn small primary" data-a="${r.user_id}" style="width:auto;margin:0">রাজি</button><button class="btn small" data-r="${r.user_id}" style="width:auto;margin:0">না</button></div>`).join("") : `<div class="empty">এখনো কেউ অনুরোধ করেনি</div>`}</div>`);
    body.onclick = async (e) => {
      const a = e.target.closest("[data-a]"), r = e.target.closest("[data-r]"); if (!a && !r) return;
      try { await rpc("live_answer_cohost", { p_room: id, p_user: (a || r).dataset.a || (a || r).dataset.r, p_accept: !!a }); closeSheet(); loadSeats(); } catch (er) { toast(errMsg(er), true); }
    };
  });
  $("#pyFree")?.addEventListener("click", async () => { try { await rpc("party_settings", { p_room: id, p_free: !free }); free = !free; $("#pyFree").textContent = free ? "🔓" : "🔒"; toast(free ? "🔓 ফ্রি সিট — যে কেউ বসতে পারবে" : "🔒 সিটে বসতে আপনার অনুমতি লাগবে"); } catch (er) { toast(errMsg(er), true); } });
  $("#pyMic").addEventListener("click", async (e) => {
    if (!mic) return;
    const m = !mic.muted; await mic.setMuted(m); myMuted = m; e.currentTarget.textContent = m ? "🔇" : "🎤";
    if (!host) rpc("party_mute", { p_room: id, p_user: S.me.id, p_muted: m }).catch(() => {});
  });
  $("#pyGift")?.addEventListener("click", () => openGifts({ _v: { username: hp.username, id: 0 } }, false, id));
  let likeT = 0;
  $("#pyLike")?.addEventListener("click", () => { heart(); if (Date.now() - likeT > 1500) { likeT = Date.now(); rpc("live_send", { p_room: id, p_body: "❤️", p_kind: "like" }).catch(() => {}); } });
  const endParty = async () => { await rpc("live_end", { p_room: id }).catch(() => {}); showEnded(); };
  $("#pyEnd")?.addEventListener("click", async () => { if (await ask("পার্টি শেষ করবেন?")) { await endParty(); location.replace("#home"); } });
  $("#lvX").onclick = async () => { if (host && !ended) { if (!await ask("পার্টি শেষ করে বের হবেন?")) return; await endParty(); } history.back(); };
  cleanup = () => {
    clearInterval(hb); sb.removeChannel(ch);
    if (host && !ended) rpc("live_end", { p_room: id }).catch(() => {}); else rpc("live_leave", { p_room: id }).catch(() => {});
    try { mic?.close(); } catch { /* */ } try { client?.leave(); } catch { /* */ }
    document.body.classList.remove("story-open");
    try { Native?.setDarkBars?.(false); } catch { /* */ }
  };
};

// 📞 কল
let ringCtx = null, ringT = null;
function ringStart(incoming) {
  ringStop();
  try {
    ringCtx = new (window.AudioContext || window.webkitAudioContext)();
    const beep = () => { const o = ringCtx.createOscillator(), g = ringCtx.createGain(); o.frequency.value = incoming ? 660 : 440; g.gain.value = 0.12; o.connect(g); g.connect(ringCtx.destination); o.start(); o.stop(ringCtx.currentTime + (incoming ? 0.8 : 1.2)); };
    beep(); ringT = setInterval(beep, incoming ? 1600 : 3000);
  } catch { /* */ }
  try { if (incoming) navigator.vibrate?.([600, 400, 600, 400, 600]); } catch { /* */ }
}
function ringStop() { clearInterval(ringT); ringT = null; try { ringCtx?.close(); } catch { /* */ } ringCtx = null; try { navigator.vibrate?.(0); } catch { /* */ } }

async function incomingCall(c) {
  if (c.status !== "ringing" || S.inCall) return;
  const { data: p } = await sb.from("profiles").select("id,username,full_name,avatar_url").eq("id", c.caller_id).single();
  if (document.hidden) { try { Native?.notify?.(c.kind === "video" ? L("📹 ভিডিও কল আসছে", "📹 Incoming video call") : L("📞 কল আসছে", "📞 Incoming call"), "@" + (p?.username ?? "")); } catch { /* */ } }
  document.getElementById("incall")?.remove();
  const d = document.createElement("div");
  d.id = "incall"; d.className = "incall";
  d.innerHTML = `<div class="ic-card">${avatar(p)}<b translate="no">${esc(p?.full_name || p?.username || "")}</b><small>${c.kind === "video" ? "📹 ভিডিও কল" : "📞 অডিও কল"} · 🪙${n(c.rate_coins)}/মিনিট</small>
    <div class="ic-btns"><button class="ic-no" id="icNo">✕</button><button class="ic-yes" id="icYes">${c.kind === "video" ? "📹" : "📞"}</button></div></div>`;
  document.body.appendChild(d);
  ringStart(true);
  const close = () => { ringStop(); d.remove(); document.removeEventListener("callupd", onUpd); };
  const onUpd = (e) => { if (e.detail.id === c.id && e.detail.status !== "ringing") close(); };
  document.addEventListener("callupd", onUpd);
  $("#icNo").onclick = async () => { close(); rpc("call_answer", { p_call: c.id, p_accept: false }).catch(() => {}); };
  $("#icYes").onclick = async () => {
    close();
    try { needMedia(); await rpc("call_answer", { p_call: c.id, p_accept: true }); location.hash = `#call/${c.id}`; }
    catch (e) { toast(errMsg(e), true); }
  };
}

async function startCall(host, kind) {
  try {
    needMedia();
    if (!await ask(`${kind === "video" ? "📹 ভিডিও" : "📞 অডিও"} কল: প্রতি মিনিটে 🪙 ${n(callRate(host, kind))} কয়েন কাটবে। কল দেবেন?`)) return;
    const r = await rpc("call_start", { p_callee: host.id, p_kind: kind });
    location.hash = `#call/${r.call_id}`;
  } catch (e) {
    toast(errMsg(e), true);
    if (String(e.message).includes("INSUFFICIENT_COINS")) setTimeout(() => (location.hash = "#cashin"), 900);
  }
}

R.call = async (cid) => {
  const id = Number(cid);
  const { data: c } = await sb.from("calls").select("*").eq("id", id).maybeSingle();
  if (!c) { toast("কল পাওয়া যায়নি", true); history.back(); return; }
  const me = S.me.id, caller = c.caller_id === me, otherId = caller ? c.callee_id : c.caller_id;
  const { data: o } = await sb.from("profiles").select("id,username,full_name,avatar_url,user_no").eq("id", otherId).single();
  if (["ended", "missed", "rejected", "cancelled"].includes(c.status)) { toast("কল শেষ হয়ে গেছে"); history.back(); return; }
  S.inCall = true;
  screen.classList.add("full");
  document.body.classList.add("story-open");
  try { Native?.setDarkBars?.(true); Native?.setSecure?.(true); } catch { /* */ }
  const video = c.kind === "video";
  screen.innerHTML = `<div class="cl ${video ? "vid" : "aud"}">
    <div class="cl-remote" id="clR"></div><div class="cl-local ${video ? "" : "hidden"}" id="clL"></div>
    <div class="cl-info">${avatar(o)}<b translate="no">${esc(o.full_name || o.username)}</b><small id="clS">${c.status === "ringing" ? (caller ? "কল যাচ্ছে…" : "সংযোগ হচ্ছে…") : "সংযোগ হচ্ছে…"}</small>
      <small id="clC">${caller ? `🪙 ${n(c.rate_coins)}/মিনিট` : `আপনার আয় চলছে 💰`}</small></div>
    <div class="cl-bar">${video ? `<button id="clCam">🔄</button><button id="clVid">📷</button>` : ""}<button id="clMic">🎤</button><button class="end" id="clEnd">📞</button></div></div>`;
  let client = null, mic = null, cam = null, joined = false, done = false, t0 = null, timer = null, tick = null, facing = "user";
  if (caller && c.status === "ringing") ringStart(false);
  const finish = async (msg) => {
    if (done) return; done = true;
    ringStop(); clearInterval(timer); clearInterval(tick);
    try { mic?.close(); cam?.close(); } catch { /* */ }
    try { await client?.leave(); } catch { /* */ }
    const r = await rpc("call_end", { p_call: id }).catch(() => null);
    if (msg) toast(msg); else if (r?.billed) toast(`কল শেষ · ${r.billed} মিনিট${caller ? ` · 🪙 ${n(r.coins)}` : ""}`);
    setTimeout(() => { if (location.hash === `#call/${id}`) history.back(); }, 600);
  };
  const join = async () => {
    if (joined) return; joined = true;
    ringStop();
    $("#clS").textContent = "সংযোগ হচ্ছে…";
    try {
      const A = await loadAgora();
      const tk = await agoraToken(`call_${id}`);
      client = A.createClient({ mode: "rtc", codec: "vp8" });
      client.on("user-published", async (user, type) => {
        await client.subscribe(user, type);
        if (type === "audio") user.audioTrack?.play();
        if (type === "video") { $("#clR").innerHTML = ""; user.videoTrack?.play($("#clR")); $("#clR").classList.add("on"); }
      });
      client.on("user-left", (u) => { if (u.uid === o.user_no) finish("অন্যজন কল কেটে দিয়েছে"); });
      await client.join(tk.appId, `call_${id}`, tk.token, tk.uid);
      if (video) { [mic, cam] = await A.createMicrophoneAndCameraTracks({}, { encoderConfig: "480p_1", facingMode: "user" }); cam.play($("#clL"), { mirror: true }); await client.publish([mic, cam]); }
      else { mic = await A.createMicrophoneAudioTrack(); await client.publish([mic]); }
      t0 = Date.now();
      timer = setInterval(() => { if ($("#clS")) $("#clS").textContent = "⏱ " + hms2((Date.now() - t0) / 1000); }, 1000);
      const doTick = () => rpc("call_tick", { p_call: id }).then((r) => {
        if (r.status !== "active") return finish(r.reason === "no_coins" ? "কয়েন শেষ — কল বন্ধ হয়েছে" : "কল শেষ");
        if (caller && $("#clC")) { $("#clC").textContent = `🪙 বাকি ${n(r.coins_left)} · ${r.billed} মিনিট`; if (r.coins_left < r.rate) toast("⚠️ কয়েন প্রায় শেষ — পরের মিনিটে কল কেটে যাবে", true); }
      }).catch(() => {});
      doTick(); tick = setInterval(doTick, 30000);
    } catch (e) { finish(errMsg(e)); }
  };
  const onUpd = (e) => {
    const x = e.detail; if (x.id !== id) return;
    if (x.status === "active") join();
    else if (x.status !== "ringing") finish(x.status === "rejected" ? "কল ধরেনি" : x.status === "missed" ? "কেউ ধরেনি" : x.end_reason === "no_coins" ? "কয়েন শেষ — কল বন্ধ হয়েছে" : "কল শেষ");
  };
  document.addEventListener("callupd", onUpd);
  if (c.status === "active") join();
  const poll = setInterval(async () => { if (joined || done) return; const { data: x } = await sb.from("calls").select("*").eq("id", id).single(); if (x) onUpd({ detail: x }); }, 4000);
  $("#clEnd").onclick = () => finish();
  $("#clMic").onclick = async (e) => { if (!mic) return; const m = !mic.muted; await mic.setMuted(m); e.currentTarget.textContent = m ? "🔇" : "🎤"; };
  $("#clVid")?.addEventListener("click", async (e) => { if (!cam) return; const m = !cam.muted; await cam.setMuted(m); e.currentTarget.textContent = m ? "🚫" : "📷"; });
  $("#clCam")?.addEventListener("click", async () => { facing = facing === "user" ? "environment" : "user"; try { await cam?.setDevice({ facingMode: facing }); } catch { /* */ } });
  cleanup = () => {
    clearInterval(poll); document.removeEventListener("callupd", onUpd);
    if (!done) finish();
    S.inCall = false;
    document.body.classList.remove("story-open");
    try { Native?.setSecure?.(false); Native?.setDarkBars?.(false); } catch { /* */ }
  };
};

// ---------------- 📖 স্টোরি ----------------
// হোম পেজের স্টোরি সারি
async function storyRow(box) {
  if (!box || setting("stories_enabled", true) === false) return;
  const rows = (await rpc("story_feed", { p_limit: 40 }).catch(() => [])) ?? [];
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
    if (!await ask("এই স্টোরি মুছবেন?")) return pause(false);
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
        <a href="#notifs" class="bell" aria-label="নোটিফিকেশন"><svg viewBox="0 0 32 32"><path d="M16 4.5c-4.6 0-8 3.6-8 8.3v5.6l-2.5 4.1h21l-2.5-4.1v-5.6c0-4.7-3.4-8.3-8-8.3z"/><path d="M12.8 25.5c.6 1.4 1.8 2.2 3.2 2.2s2.6-.8 3.2-2.2"/></svg><b class="bell-n hidden"></b></a>
        <a href="#top" class="rank" aria-label="র‍্যাংকিং"><svg viewBox="0 0 32 32"><path d="M4 27h24M7 27V17h5v10M13.5 27V7h5v20M20 27V12h5v15" /></svg></a>
      </div>
      <div class="disc-filters ${tab === "video" || tab === "premium" ? "" : "hidden"}">
        <label>🅰️ <span id="flL">${f.lang ? langName(f.lang) : "সব"}</span><select id="fLang"><option value="">সব ভাষা</option>${LANGS.map(([k, l]) => `<option value="${k}" ${k === f.lang ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <label>📍 <span id="flC">${f.country ? flagOf(f.country) + " " + (COUNTRY_NAMES[f.country] ?? f.country) : "সব"}</span><select id="fCountry"><option value="">সব দেশ</option>${countries.map((c) => `<option value="${c}" ${c === f.country ? "selected" : ""}>${flagOf(c)} ${COUNTRY_NAMES[c]}</option>`).join("")}</select></label>
      </div>
    </div>
    ${notice() ? `<div style="padding:0 10px">${notice()}</div>` : ""}
    ${tab === "video" ? `<div id="homeSsn" style="padding:0 10px"></div><div id="homeOf" style="padding:0 10px"></div><div id="homeSp" style="padding:0 10px"></div>` : ""}
    ${tab === "video" ? `<div class="st-row hidden" id="stRow"></div>` : ""}
    ${tab === "video" || tab === "photo" ? `<div class="trend-row hidden" id="trend"></div>` : ""}
    <div class="disc-grid"><div class="disc-col" id="c0"></div><div class="disc-col" id="c1"></div></div>
    <div id="dmore" style="padding:10px"></div>
    ${tab === "photo" ? `<a class="fab" href="#newphoto">📷 ফটো দিন</a>` : ""}</div>`;
  paintUnread();
  const save = () => { try { localStorage.setItem("disc", JSON.stringify(S.disc)); } catch { /* */ } };
  $("#fLang").onchange = (e) => { S.disc.lang = e.target.value; save(); R.home(tab); };
  $("#fCountry").onchange = (e) => { S.disc.country = e.target.value; save(); R.home(tab); };
  storyRow($("#stRow"));
  homeSponsors($("#homeSp")).catch(() => {});
  seasonBanner($("#homeSsn"), true).catch(() => {});
  homeOffers($("#homeOf")).catch(() => {});
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
      if (tab === "live") { st.done = true; $(".disc-grid").outerHTML = `<div id="liveBox" style="padding:0 10px"></div>`; await liveGrid($("#liveBox")); $("#dmore").innerHTML = ""; return; }
      if (tab === "video" && st.before === null && !st.livesShown && setting("live_enabled", true) !== false) {
        st.livesShown = true;
        for (const r of await livesFor()) { const c0 = $("#c0"), c1 = $("#c1"); if (!c0) return; (c0.offsetHeight <= c1.offsetHeight ? c0 : c1).insertAdjacentHTML("beforeend", liveCard(r, st.count++)); }
      }
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

R.level = async (tab = "c") => {
  const { data: p } = await sb.from("profiles").select("followers_count,wealth_topup,wealth_spent").eq("id", S.me.id).single();
  const seg = `<div class="seg" style="margin-top:0"><button class="${tab !== "w" ? "on" : ""}" onclick="location.replace('#level')">👑 ক্রিয়েটর লেভেল</button><button class="${tab === "w" ? "on" : ""}" onclick="location.replace('#level/w')">💎 ধনী লেভেল</button></div>`;
  if (tab === "w") {
    const steps = wealthSteps(), val = wealthVal(p), lv = wealthOf(p), next = steps[lv], prev = lv ? steps[lv - 1] : 0;
    screen.innerHTML = `<div class="page">${header("💎 ধনী লেভেল")}${seg}
      <div class="lvbig wl"><div>আপনার ধনী লেভেল</div><b>Lv${lv}</b><div>কেনা 🪙 ${n(p?.wealth_topup ?? 0)} · খরচ 🪙 ${n(p?.wealth_spent ?? 0)}</div>
        ${next ? `<div class="progress"><div style="width:${Math.min(100, Math.round(((val - prev) / (next - prev)) * 100))}%"></div></div><div class="tiny" style="margin-top:6px">Lv${lv + 1} হতে আরও 🪙 ${n(next - val)} কয়েন</div>` : `<div class="tiny">সর্বোচ্চ লেভেল 🎉</div>`}</div>
      <div class="card"><b>লেভেল কীভাবে বাড়ে</b><p class="tiny muted" style="margin:4px 0 8px">মোট যত কয়েন কিনেছেন বা খরচ করেছেন (গিফট, কল, VIP, দোকান, বুস্ট) — দুটোর যেটা বেশি, সেটা দিয়ে লেভেল।</p>
        <div class="list tiny">${steps.map((t, i) => `<div class="li"><span>${i + 1 === lv ? "👉 " : ""}${wealthTag({ wealth_topup: t, wealth_spent: 0 })}</span><b>🪙 ${n(t)}</b></div>`).join("")}</div></div>
      <p class="tiny muted">ধনী লেভেলের ব্যাজ আপনার প্রোফাইল, চ্যাট আর লাইভে সবাই দেখবে।</p>
      <a class="btn primary" href="#cashin" style="display:block;text-align:center">কয়েন কিনুন</a></div>`;
    return;
  }
  const f = p?.followers_count ?? 0, lv = levelOf(f), next = LEVELS[lv + 1];
  screen.innerHTML = `<div class="page">${header("👑 আমার লেভেল")}${seg}
    <div class="lvbig"><div>আপনার লেভেল</div><b>Lv${lv}</b><div>${n(f)} জন ফলোয়ার</div>
      ${next ? `<div class="progress"><div style="width:${Math.min(100, Math.round(((f - LEVELS[lv]) / (next - LEVELS[lv])) * 100))}%"></div></div><div class="tiny" style="margin-top:6px">Lv${lv + 1} হতে আরও ${n(next - f)} জন ফলোয়ার লাগবে</div>` : `<div class="tiny">সর্বোচ্চ লেভেল 🎉</div>`}</div>
    <div class="card"><b>লেভেল কীভাবে বাড়ে</b><div class="list tiny">${LEVELS.map((t, i) => `<div class="li"><span>${i === lv ? "👉 " : ""}Lv${i}</span><b>${n(t)}+ ফলোয়ার</b></div>`).join("")}</div></div>
    <p class="tiny muted">ভালো ভিডিও দিন, নিয়মিত পোস্ট করুন — ফলোয়ার বাড়লে লেভেল বাড়বে এবং আপনার ভিডিও বেশি মানুষ দেখবে।</p></div>`;
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
      <div class="li"><span>কারণ</span><b translate="no">${esc(p.jail_reason || L("নিয়ম ভঙ্গ", "Rule violation"))}</b></div>
      <div class="li"><span>তারিখ</span><span>${p.jailed_at ? dt(p.jailed_at) : "-"}</span></div>
      <div class="li"><span>মুক্তির জন্য লাগবে</span><b>🪙 ${n(fee)} কয়েন</b></div>
      <div class="li"><span>আপনার কয়েন</span><b>🪙 ${n(bal)}</b></div></div></div>
    <p class="muted tiny">জেলে থাকা অবস্থায় ভিডিও আপলোড, লাইক, কমেন্ট, গিফট ও আয় বন্ধ থাকবে।</p>
    ${bal >= fee ? `<button class="btn primary" id="pay">🔓 ${n(fee)} কয়েন দিয়ে মুক্ত হোন</button>` : `<a class="btn primary" href="#cashin">🪙 কয়েন কিনুন</a>`}
    <button class="btn" id="lo" style="width:100%;margin-top:10px">🚪 লগআউট</button></div>`;
  $("#pay")?.addEventListener("click", async (e) => {
    if (!await ask(`${fee} কয়েন দিয়ে জেল থেকে মুক্ত হবেন?`)) return;
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
      <div class="me-av">${avatarD(p)}</div>
      <h2 translate="no">${esc(p.full_name || p.username)} ${p.is_verified ? "✔️" : ""}</h2>${vipTag(p)}
      <div class="me-sub">@${esc(p.username)} · <span data-copy="${p.user_no}">ID ${p.user_no} ⧉</span>${host ? ` · 🎤 হোস্ট` : ""}</div>
      <div class="chips"><span>${flagOf(cc)} ${cc ? (COUNTRY_NAMES[cc] ?? cc) : "দেশ জানা নেই"}</span><span>🅰️ ${esc(langName(p.language))}</span></div>
      <div class="me-counts"><a href="#u/${p.id}"><b>${n(p.videos_count)}</b><span>ভিডিও</span></a><div><b>${n(p.following_count)}</b><span>ফলোয়িং</span></div><div><b>${n(p.followers_count)}</b><span>ফলোয়ার</span></div></div>
    </div>
    <div class="me-cards">
      <a href="#cashin" class="mc coins"><span>আমার কয়েন</span><b>${n(w?.coin_balance)}</b><svg class="deco" viewBox="0 0 64 64"><defs><linearGradient id="gm1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c9f0ff"/><stop offset="1" stop-color="#5aa9ff"/></linearGradient><linearGradient id="gm2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fd3ff"/><stop offset="1" stop-color="#3b82f6"/></linearGradient></defs><path d="M14 22 24 10h16l10 12-18 30z" fill="url(#gm1)"/><path d="M14 22h36L32 52z" fill="url(#gm2)" opacity=".9"/><path d="M24 10l-4 12 12 30 12-30-4-12" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="1.5"/><path d="M14 22h36" stroke="#fff" stroke-opacity=".8" stroke-width="1.5"/></svg></a>
      <a href="#wallet" class="mc money"><span>আমার ব্যালেন্স</span><b>${tk(w?.earning_paisa)}</b><svg class="deco" viewBox="0 0 64 64"><defs><linearGradient id="cn1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe7a3"/><stop offset="1" stop-color="#f5a524"/></linearGradient></defs><ellipse cx="34" cy="46" rx="20" ry="7" fill="#e08c14"/><rect x="14" y="36" width="40" height="10" fill="#f0a020"/><ellipse cx="34" cy="36" rx="20" ry="7" fill="url(#cn1)"/><circle cx="26" cy="24" r="15" fill="url(#cn1)" stroke="#e8961a" stroke-width="2"/><text x="26" y="30" text-anchor="middle" font-size="16" font-weight="700" fill="#c06a00" font-family="sans-serif">৳</text></svg></a>
    </div>
    <div id="meGrow"></div>
    <div class="me-create"><b>＋ পোস্ট করুন</b><div><a href="#upload"><i>🎬</i>ভিডিও</a><a href="#newphoto"><i>📷</i>ফটো</a><a href="#newstory"><i>📖</i>স্টোরি</a>
      <a href="#texts" onclick="setTimeout(()=>document.getElementById('newT')?.click(),300)"><i>✍️</i>লেখা</a></div></div>
    <div class="me-promo">${setting("vip_enabled", true) !== false ? `<a href="#vip" class="vipb"><b>💎 VIP</b><span>${isVip(p) ? `${new Date(p.vip_until).toLocaleDateString(window.getLang?.() === "en" ? "en-GB" : "bn-BD")} পর্যন্ত` : "বাড়তি পয়েন্ট, ফ্রি কয়েন"}</span></a>` : ""}
      ${setting("store_enabled", true) !== false ? `<a href="#store" class="storeb"><b>🎨 সাজান</b><span>ফ্রেম · এন্ট্রি · বাবল</span></a>` : ""}</div>
    ${p.coin_seller ? `<a href="#seller" class="me-banner seller"><span>💰 কয়েন সেলার প্যানেল</span><b>বিক্রি করুন ›</b></a>` : ""}
    ${!p.referred_by && refDaysLeft(p) > 0 ? `<div class="me-ref"><span>🎁 বন্ধুর রেফার কোড দিন</span><input id="meRef" inputmode="numeric" maxlength="12" placeholder="ID নম্বর"><button id="meRefOk">যুক্ত করুন</button></div>` : ""}
    <a href="#invite" class="me-banner"><span>রেফার করে আয় করুন</span><b>${tk(refs?.earned_paisa ?? 0)} ›</b></a>
    <div class="me-menu">
      ${p.account_type === "host" ? `<a href="#callprice"><i class="mi c1"><svg viewBox="0 0 24 24"><path d="M6.5 3.5l3 3.5-2 2.5a12 12 0 0 0 7 7l2.5-2 3.5 3-1.6 2.6c-.4.6-1.1.9-1.8.8C10 20 4 14 3.1 7.4c-.1-.7.2-1.4.8-1.8z"/></svg></i>আমার কলের রেট<em>🪙 ${n(p.call_video_rate ?? setting("call_video_coins_per_min", 60))}/মিনিট ›</em></a>` : ""}
      <a href="#inbox"><i class="mi c1"><svg viewBox="0 0 24 24"><path d="M4 6.5h16a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3.5v-3.5H4A1.5 1.5 0 0 1 2.5 17V8A1.5 1.5 0 0 1 4 6.5z"/><path d="M7.5 12.5h.01M12 12.5h.01M16.5 12.5h.01" stroke-width="2.6"/></svg></i>মেসেজ<em>${S.msgUnread ? `${S.msgUnread} <b class="red"></b>` : ""}›</em></a>
      <a href="#history"><i class="mi c2"><svg viewBox="0 0 24 24"><path d="M7 3.5h10a1.5 1.5 0 0 1 1.5 1.5v15l-3-2-3 2-3-2-3 2V5A1.5 1.5 0 0 1 7 3.5z"/><path d="M9 8.5h6M9 12h6"/></svg></i>লেনদেনের হিসাব<em>›</em></a>
      <a href="#creator"><i class="mi c4"><svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg></i>ক্রিয়েটর ড্যাশবোর্ড<em>›</em></a>
      <a href="#level"><i class="mi c2"><svg viewBox="0 0 24 24"><path d="M3.5 8l4.2 3.6L12 5l4.3 6.6L20.5 8l-1.8 10.5H5.3z"/><path d="M6 21h12"/></svg></i>আমার লেভেল<em>Lv${levelOf(p.followers_count)} ›</em></a>
      <a href="#invite"><i class="mi c3"><svg viewBox="0 0 24 24"><rect x="3.5" y="8.5" width="17" height="4" rx="1"/><path d="M5 12.5v8h14v-8M12 8.5v12M12 8.5S10.5 4 8 4.6C6 5.1 7 8.5 12 8.5zM12 8.5s1.5-4.5 4-3.9c2 .5 1 3.9-4 3.9z"/></svg></i>আমার রেফার<em>পুরস্কার নিন <b class="red"></b> ›</em></a>
      ${p.agent_status === "approved" ? `<a href="#agent"><i class="mi c5"><svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c2 .7 3.2 2.5 3.6 5.2"/></svg></i>${p.agent_status === "approved" ? "এজেন্ট ড্যাশবোর্ড" : "এজেন্ট হন"}<em>${p.agent_status === "pending" ? "⏳ যাচাই হচ্ছে " : p.agent_status === "approved" ? "🧑‍💼 " : "নতুন "}›</em></a>` : ""}
      <a href="#rules"><i class="mi c4"><svg viewBox="0 0 24 24"><rect x="5" y="4.5" width="14" height="16.5" rx="2"/><path d="M9 3.5h6v3H9zM8.5 11.5l2 2 4-4M8.5 17h7"/></svg></i>আমার টাস্ক<em>›</em></a>
      <a href="#u/${p.id}"><i class="mi c5"><svg viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="4"/><path d="M4.5 20.5c1.2-4 4.2-5.5 7.5-5.5s6.3 1.5 7.5 5.5"/></svg></i>আমার প্রোফাইল<em>›</em></a>
      <a href="#settings"><i class="mi c6"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/></svg></i>সেটিংস<em>›</em></a>
    </div></div>`;
  growBox($("#meGrow"), true, () => growBox($("#meGrow"), true)).catch(() => {});
  $("#meRefOk")?.addEventListener("click", async (e) => {
    const v = $("#meRef").value.replace(/\D/g, "");
    if (!v) return toast("বন্ধুর ID নম্বর দিন", true);
    e.target.disabled = true;
    try { const r = await rpc("set_referrer", { p_ref_no: v }); S.me.referred_by = true; toast(`🎁 @${r.username}-এর রেফারে যুক্ত হয়েছেন`); $(".me-ref")?.remove(); }
    catch (er) { toast(errMsg(er), true); e.target.disabled = false; }
  });
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
  $("#lo")?.addEventListener("click", async () => { if (!await ask("লগআউট করবেন?")) return; await sb.auth.signOut(); S.me = null; location.hash = ""; showAuth(); });
  document.querySelectorAll(".acct button").forEach((b) => (b.onclick = async () => {
    const t = b.dataset.t;
    if ((t === "host" && (host || pending)) || (t === "user" && !host && !pending)) return;
    if (t === "user" && !await ask(host ? "হোস্ট থেকে ইউজারে ফিরবেন? আবার হোস্ট হতে অনুমোদন লাগবে।" : "হোস্ট আবেদন বাতিল করবেন?")) return;
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
      <a class="li" href="#offers"><span>📢 অফার ও খবর</span><span>›</span></a>
      <a class="li" href="https://akashpattadar19-cell.github.io/reels-admin/site/" target="_blank" rel="noopener"><span>🌐 আমাদের ওয়েবসাইট</span><span>›</span></a>
      <label class="li"><span>🔔 নোটিফিকেশন</span><input type="checkbox" id="nt" class="sw" ${notifOn() ? "checked" : ""}></label>
      ${me.account_type === "host" ? `<label class="li"><span>📞 কল নিতে রাজি (ইউজাররা আপনাকে কল দিতে পারবে)</span><input type="checkbox" id="cOn" class="sw" ${me.calls_on !== false ? "checked" : ""}></label>` : ""}
    </div>
    <h3 class="sec">নীতিমালা</h3>
    <div class="card list">${POLICIES.map(([k, i, t]) => `<a class="li" href="#policy/${k}"><span>${i} ${t}</span><span>›</span></a>`).join("")}</div>
    <div class="card list">
      <a class="li" href="#delacct"><span style="color:#e5484d">🗑️ অ্যাকাউন্ট ডিলিট</span><span class="muted">${delAt ? "⏳ অনুরোধ করা হয়েছে" : ""} ›</span></a>
      <div class="li"><span>📱 অ্যাপ ভার্সন</span><span class="muted">${esc(Native?.appVersion?.() ?? "web")}</span></div>
    </div></div>`;
  $("#cOn")?.addEventListener("change", async (e) => { try { await rpc("set_call_prefs", { p_on: e.target.checked }); toast(e.target.checked ? "📞 কল চালু" : "📵 কল বন্ধ"); } catch (er) { toast(errMsg(er), true); } });
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
    if (!await ask(L("সত্যিই অ্যাকাউন্ট ডিলিট করবেন? ৭ দিন পর সব তথ্য স্থায়ীভাবে মুছে যাবে।", "Really delete your account? All data will be permanently erased after 7 days."))) return;
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
    <div class="chat-top"><button class="back" onclick="history.back()">←</button><span class="sic">🎧</span><span style="flex:1"><b>${host ? "হোস্ট সাপোর্ট" : "লাইভ সাপোর্ট"}</b><div class="tiny muted" translate="no">${esc(admTxt(setting("support_hours", "")))}</div></span>
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

const REF_TASKS = { full_watch: ["🎬", "ভিডিও পুরো দেখুন"], likes: ["❤️", "ভিডিওতে লাইক দিন"], comments: ["💬", "কমেন্ট করুন"],
  shares: ["↗️", "ভিডিও শেয়ার করুন"], active_days: ["📱", "দিন অ্যাপ ব্যবহার করুন"], video_posts: ["🎥", "ভিডিও পোস্ট করুন (অনুমোদিত)"],
  text_posts: ["✍️", "টেক্সট পোস্ট করুন"], photo_days: ["📷", "ফটো"], text_days: ["✍️", "লেখা"], video_days: ["🎥", "ভিডিও"] };
const refLeft = (end) => { const ms = new Date(end) - Date.now(); if (ms <= 0) return "সময় শেষ"; const h = Math.floor(ms / 3600e3);
  return h >= 24 ? `${n(Math.floor(h / 24))} দিন ${n(h % 24)} ঘণ্টা বাকি` : `${n(h)} ঘণ্টা বাকি`; };
// রেফারের টাস্ক তালিকা (have/need + প্রগ্রেস বার)
const refTaskList = (pr, compact) => `<div class="rt-list${compact ? " compact" : ""}">${pr.items.filter((x) => x.need > 0).map((x) => {
  const ok = x.have >= x.need, pct = Math.min(100, Math.round((x.have / x.need) * 100));
  return `<div class="rt-i ${ok ? "ok" : ""}"><span class="rt-ic">${ok ? "✅" : REF_TASKS[x.k][0]}</span><div><div class="rt-t">${n(x.need)} ${x.k === "active_days" ? `দিন অ্যাপ ব্যবহার (প্রতিদিন ${n(x.mins)} মিনিট)` : /_days$/.test(x.k) ? `দিন — প্রতিদিন ${n(x.per)}টি ${REF_TASKS[x.k][1]} পোস্ট` : REF_TASKS[x.k][1].replace(/^দিন /, "")}</div>
    <div class="progress"><div style="width:${pct}%"></div></div></div><b>${n(Math.min(x.have, x.need))}/${n(x.need)}</b></div>`;
}).join("")}</div>`;
// রেফারের নিয়ম (সেটিংস থেকে) — শেয়ার করার আগে বন্ধুকে বোঝাতে
const refRuleItems = () => [["full_watch", "ref_req_full_watch"], ["likes", "ref_req_likes"], ["comments", "ref_req_comments"], ["shares", "ref_req_shares"],
  ["active_days", "ref_req_active_days"], ["video_posts", "ref_req_video_posts"], ["text_posts", "ref_req_text_posts"]]
  .map(([k, sk]) => ({ k, need: Number(setting(sk, 0)), have: 0, mins: Number(setting("ref_req_minutes_per_day", 0)) })).filter((x) => x.need > 0);

R.invite = async () => {
  screen.innerHTML = `<div class="page">${header("🎁 আমার রেফার")}<div class="spinner"></div></div>`;
  const [r, mine, { data: rtb }] = await Promise.all([rpc("my_referrals").catch((e) => ({ error: e })), rpc("my_referral_tasks").catch(() => null),
    sb.from("transactions").select("amount").eq("user_id", S.me.id).eq("type", "ref_topup_bonus").limit(1000)]);
  const topupCoins = (rtb ?? []).reduce((a2, x) => a2 + Number(x.amount || 0), 0);
  if (r.error) { screen.innerHTML = `<div class="page">${header("🎁 আমার রেফার")}<div class="empty">${esc(errMsg(r.error))}</div></div>`; return; }
  const wb = Number(setting("welcome_bonus_paisa", 0)) > 0 && setting("welcome_bonus_enabled", true) !== false ? Math.round(Number(setting("welcome_bonus_paisa")) / 100) : 0;
  const shareText = L(`Reels Enjoy অ্যাপে ভিডিও দেখে ও বানিয়ে আয় করুন!${wb ? ` নতুন ইউজাররা পাবেন ৳${wb} বোনাস 🎁` : ""}\n\n📲 ডাউনলোড: ${shareLink()}\n🎟️ রেজিস্টার করার সময় আমার রেফার কোড দিন: ${r.code}`, `Watch and make videos on Reels Enjoy and earn!${wb ? ` New users get a ৳${wb} bonus 🎁` : ""}\n\n📲 Download: ${shareLink()}\n🎟️ Enter my referral code when you sign up: ${r.code}`);
  const days = Number(setting("ref_window_days", 3)), offer = settingL("ref_offer_text", "");
  const rules = refRuleItems();
  screen.innerHTML = `<div class="page">${header("🎁 আমার রেফার")}
    ${offer ? `<div class="ref-offer"><span>🔥</span><div translate="no">${esc(offer)}</div></div>` : ""}
    ${S.me?.agent_status === "approved" ? `<a class="card ag-cta" href="#agent"><span>🧑‍💼</span><div><b>${S.me?.agent_status === "approved" ? "এজেন্ট ড্যাশবোর্ড" : "এজেন্ট হয়ে বেশি বোনাস নিন"}</b><small>নিজের লিংক · প্রতি ${n(setting("agent_target_refs", 20))} জনে বাড়তি পুরস্কার</small></div><em>›</em></a>` : ""}
    ${mine && !mine.qualified && !mine.blocked ? `<div class="card ref-mine"><b>🎯 আপনার টাস্ক (@${esc(mine.referrer)}-এর রেফারে যুক্ত)</b>
      <div class="tiny muted" style="margin:2px 0 8px">⏳ ${refLeft(mine.end)} · সব শেষ করলে আপনি পাবেন ⭐ ${n(setting("referral_welcome_points"))} পয়েন্ট</div>${refTaskList(mine)}</div>` : ""}
    <div class="card hero" style="text-align:center"><div class="k">আপনার রেফার কোড</div>
      <div class="v" data-copy="${r.code}" style="letter-spacing:2px">${r.code} ⧉</div>
      <button class="btn" id="shr" style="background:#fff;color:#4b1c7a;border:0">📤 বন্ধুদের পাঠান</button></div>
    <div class="stats" style="margin-bottom:12px"><div><b>${n(r.total)}</b><span>মোট রেফার</span></div><div><b>${n(r.qualified)}</b><span>সফল</span></div><div><b>${tk(r.earned_paisa)}</b><span>রেফার আয়</span></div></div>
    <div class="card"><b>কীভাবে কাজ করে</b><div class="list tiny">
      <div class="li"><span>১. বন্ধু রেজিস্টারের সময় (বা লগইনের পর রেফার পেজে) আপনার কোড দেবে</span></div>
      <div class="li"><span>২. বন্ধু ${n(days)} দিনের মধ্যে নিচের সব টাস্ক শেষ করলে রেফার সফল</span></div>
      <div class="li"><span>৩. প্রতি সফল রেফারে আপনি পাবেন</span><b>${tk(S.me.account_type === "host" && Number(setting("host_referral_bonus_paisa", 0)) > 0 ? setting("host_referral_bonus_paisa") : setting("referral_bonus_paisa"))}</b></div>
      ${Number(setting("ref_topup_pct", 0)) > 0 ? `<div class="li"><span>৪. বন্ধু যতবার কয়েন কিনবে, আপনি পাবেন (সারাজীবন)</span><b>🪙 ${n(setting("ref_topup_pct", 0))}%</b></div>` : ""}
      <div class="li"><span>বন্ধু পাবে স্বাগত পয়েন্ট</span><b>⭐ ${n(setting("referral_welcome_points"))}</b></div></div>
      ${rules.length ? `<div class="tiny" style="margin:10px 0 4px"><b>বন্ধুর টাস্ক (${n(days)} দিনের মধ্যে)</b></div><div class="ref-rules">${rules.map((x) =>
        `<span>${REF_TASKS[x.k][0]} ${n(x.need)} ${x.k === "active_days" ? `দিন অ্যাপ ব্যবহার (প্রতিদিন ${n(x.mins)} মিনিট)` : REF_TASKS[x.k][1].replace(/^দিন /, "")}</span>`).join("")}</div>` : ""}
      <div class="tiny muted" style="margin-top:8px">⚠️ একই মোবাইলে খোলা দ্বিতীয় অ্যাকাউন্টের রেফার গণ্য হবে না। বন্ধুকে অ্যাপ (APK) থেকে লগইন করতে হবে।</div></div>
    ${r.tiers.length ? `<div class="card"><b>🏆 বাড়তি বোনাস</b><div class="list">${r.tiers.map((t) => `<div class="li"><span>${n(t.referrals)} জন সফল রেফার</span>
      <span>${t.awarded ? "✅ " : ""}<b>${tk(t.bonus_paisa)}</b></span></div>
      ${t.awarded ? "" : `<div class="progress" style="margin:0 0 6px"><div style="width:${Math.min(100, Math.round((r.qualified / t.referrals) * 100))}%"></div></div>`}`).join("")}</div></div>` : ""}
    <h3>আপনার রেফার করা বন্ধু</h3>${r.list.length ? r.list.map((x) => `<div class="card ref-fr"><div class="row" style="justify-content:space-between;align-items:center">
        <span><b translate="no">@${esc(x.username)}</b><div class="tiny muted">${dt(x.created_at)}${x.progress ? ` · ⏳ ${refLeft(x.progress.end)}` : ""}</div></span>
        <span class="pill ${x.qualified ? "paid" : x.blocked ? "rejected" : "pending"}">${x.qualified ? "✅ সফল" : x.blocked === "same_device" ? "❌ বাতিল (একই মোবাইল)" : x.blocked === "expired" ? "⌛ সময় শেষ" : x.blocked ? "❌ বাতিল" : "চলছে"}</span></div>
        ${x.progress ? refTaskList(x.progress, true) : ""}</div>`).join("") : `<div class="card"><div class="empty">এখনো কেউ নেই — কোড শেয়ার করুন</div></div>`}
  </div>`;
  $("#shr").onclick = async () => {
    try {
      if (Native?.share) Native.share(shareText);
      else if (navigator.share) await navigator.share({ text: shareText });
      else { await navigator.clipboard.writeText(shareText); toast("কপি হয়েছে"); }
    } catch { /* */ }
  };
};

R.rules = async () => {
  const [{ data: tiers }, mine] = await Promise.all([sb.from("referral_tiers").select("*").eq("is_active", true).order("referrals"), rpc("my_referral_tasks").catch(() => null)]);
  const rew = S.ads.rewarded_points;
  screen.innerHTML = `<div class="page">${header("📋 আমার টাস্ক ও আয়ের নিয়ম")}
    <div id="growBox2"></div>
    <div id="ssnBox2"></div>
    ${S.ads.rewarded_points && Native?.showRewarded && !locked("ads") ? `<div class="card hero"><b>🎬 অ্যাড দেখে পয়েন্ট নিন</b><div class="tiny" style="margin:4px 0 10px">প্রতি অ্যাডে ⭐ ${n(S.ads.rewarded_points.viewer_points)} · দিনে ${n(S.ads.rewarded_points.daily_cap)} বার</div><a class="btn" href="#wallet" style="background:#fff;color:#5b2bd0;border:0">ওয়ালেটে গিয়ে অ্যাড দেখুন</a></div>` : ""}
    <div id="poolBox2"></div>
    ${mine && !mine.qualified && !mine.blocked ? `<a class="card ref-mine" href="#invite" style="display:block"><b>🎯 রেফার টাস্ক — ⭐ ${n(setting("referral_welcome_points"))} পয়েন্ট পাবেন</b>
      <div class="tiny muted" style="margin:2px 0 8px">⏳ ${refLeft(mine.end)}</div>${refTaskList(mine, true)}</a>` : ""}
    <div class="card"><b>✅ প্রতিদিনের টাস্ক</b><div class="list tiny">
      <div class="li"><span>ভিডিও পুরোটা দেখুন (ছোট-বড় যেকোনো ভিডিও)</span>${locked("watch") ? soon() : `<b>⭐ ${n(setting("watch_points"))} / ভিডিও</b>`}</div>
      <div class="li"><span>ভিডিও আপলোড করুন</span><a href="#upload" class="btn small">আপলোড</a></div>
      <div class="li"><span>বন্ধুকে রেফার করুন</span><a href="#invite" class="btn small">রেফার</a></div></div></div>
    <div class="card"><b>🎬 ভিডিও বানিয়ে (ক্রিয়েটর)</b><div class="list tiny">
      <div class="li"><span>প্রতি ১০০০ ভিউ</span>${locked("views") ? soon() : `<b>${tk(setting("view_rate_paisa_per_1000"))}</b>`}</div>
      <div class="li"><span>প্রতি লাইক</span>${locked("likes") ? soon() : `<b>${tk(setting("like_rate_paisa"))}</b>`}</div>
      <div class="li"><span>প্রতি কমেন্টকারী</span>${locked("comments") ? soon() : `<b>${tk(setting("comment_rate_paisa"))}</b>`}</div>
      <div class="li"><span>গিফট পেলে</span><b>গিফটের দামের বড় অংশ</b></div>
      ${Number(setting("upload_reward_coins", 0)) > 0 ? `<div class="li"><span>ভিডিও অনুমোদন হলে</span>${locked("upload") ? soon() : `<b>🪙 ${n(setting("upload_reward_coins"))}</b>`}</div>` : ""}
      ${rew ? `<div class="li"><span>আপনার ভিডিওতে কেউ অ্যাড দেখলে</span>${locked("ads") ? soon() : `<b>⭐ ${n(rew.creator_points)}</b>`}</div>` : ""}</div></div>
    <div class="card"><b>👀 ভিডিও দেখে (দর্শক)</b><div class="list tiny">
      <div class="li"><span>প্রতি ভিডিও</span>${locked("watch") ? soon() : `<b>⭐ ${n(setting("watch_points"))}</b>`}</div>
      ${locked("watch") ? "" : `<div class="li"><span>দিনে সর্বোচ্চ</span><b>⭐ ${n(setting("viewer_daily_points_cap"))}</b></div>`}
      ${rew ? `<div class="li"><span>অ্যাড দেখে (দিনে সর্বোচ্চ ${n(rew.daily_cap)} বার)</span>${locked("ads") ? soon() : `<b>⭐ ${n(rew.viewer_points)}</b>`}</div>` : ""}
      <div class="li"><span>${n(setting("points_convert_min"))} পয়েন্ট</span>${locked("convert") ? soon() : `<b>${tk(setting("points_convert_min") * setting("point_value_paisa"))}</b>`}</div></div></div>
    <div class="card"><b>🤝 রেফার</b><div class="list tiny">
      <div class="li"><span>প্রতি সফল রেফার</span><b>${tk(setting("referral_bonus_paisa"))}</b></div>
      ${(tiers ?? []).map((t) => `<div class="li"><span>${n(t.referrals)} জন সফল রেফার হলে বাড়তি</span><b>${tk(t.bonus_paisa)}</b></div>`).join("")}</div></div>
    <div class="card"><b>💸 উইথড্র</b><div class="list tiny">
      <div class="li"><span>সর্বনিম্ন উইথড্র</span><b>${tk(setting("withdraw_min_paisa"))}</b></div>
      <div class="li"><span>কত দিন পরপর</span><b>${n(setting("withdraw_cooldown_days"))} দিন</b></div>
      <div class="li"><span>আয় ব্যালেন্সে আসে</span><b>${n(setting("pending_hold_hours"))} ঘণ্টা পরে</b></div></div></div></div>`;
  poolCard($("#poolBox2")).catch(() => {});
  seasonBanner($("#ssnBox2")).catch(() => {});
  growBox($("#growBox2"), false, () => growBox($("#growBox2"), false)).catch(() => {});
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
  if (!mine) rpc("user_live", { p_user: id }).then((L) => {
    if (!L || !$("#pAv")) return;
    const to = `#${L.kind === "party" ? "party" : "live"}/${L.id}`;
    const av = $("#pAv"); av.classList.add("is-live"); av.onclick = () => (location.hash = to);
    av.insertAdjacentHTML("afterend", `<a class="live-now" href="${to}"><i class="eq"><b></b><b></b><b></b></i> এখন লাইভে — দেখুন</a>`);
  }).catch(() => {});
  sb.from("stories").select("id", { count: "exact", head: true }).eq("user_id", id).eq("status", "active").gt("expires_at", new Date().toISOString()).then(({ count }) => {
    const av = $("#pAv"); if (!av || !count) return;
    av.classList.add("has-story"); av.onclick = () => (location.hash = `#story/${id}`);
  });
  const host = p.account_type === "host", seller = host && p.coin_seller;
  const grid = (list) => list.map((v) => `<a href="#watch/${id}/${v.id}">${v.thumb_url ? `<img src="${esc(v.thumb_url)}" loading="lazy" alt="">` : ""}<span class="vc">▶ ${n(v.views_count)}</span></a>`).join("");
  const lv = levelOf(p.followers_count);
  screen.innerHTML = `<div class="cover${seller ? " seller" : host ? " host" : ""}" ${p.cover_url ? `style="background-image:url('${esc(p.cover_url)}')"` : ""}><button class="back" onclick="history.back()">←</button></div>
    <div class="page${host ? " hostpage" : ""}${seller ? " sellerpage" : ""}" style="padding-top:0">
    <div class="prof${host ? " host" : ""}${seller ? " seller" : ""}">${host ? `<div class="avwrap" id="pAv">${avatarD(p)}<span class="crown">👑</span></div>` : `<div class="avplain" id="pAv">${avatarD(p)}</div>`}${vipTag(p)}<h2 translate="no">${esc(p.full_name ?? "")} ${p.is_verified ? "✔️" : ""}</h2><div class="muted">@${esc(p.username)}</div>
      <div class="rbadges">${host ? `<span class="rbadge host">👑 HOST</span>` : `<span class="rbadge user">👤 ইউজার</span>`}${seller && helpersAllowed() ? `<span class="rbadge seller">💰 কয়েন সেলার</span>` : ""}${p.agent_status === "approved" ? `<span class="rbadge agent">🧑‍💼 এজেন্ট</span>` : ""}<span class="rbadge lv">Lv${lv}</span>${p.country_code ? `<span class="rbadge">${flagOf(p.country_code)}</span>` : ""}</div>
      <div class="idtag" data-copy="${p.user_no}">ID: ${p.user_no} ⧉</div>
      <div class="counts"><div><b>${n(p.videos_count)}</b><span>ভিডিও</span></div><div><b id="fc">${n(p.followers_count)}</b><span>ফলোয়ার</span></div><div><b>${n(p.following_count)}</b><span>ফলোয়িং</span></div></div>
      ${p.bio ? `<p translate="no">${esc(p.bio)}</p>` : ""}
      ${p.interests?.length ? `<div class="int-chips">${p.interests.map((t) => `<span>${esc(t)}</span>`).join("")}</div>` : ""}
      ${mine ? `<div class="row" style="justify-content:center;gap:8px;flex-wrap:wrap"><a class="btn small" href="#myprofile">✏️ প্রোফাইল এডিট</a><button class="btn small" id="accT">⚙️ আমার অ্যাকাউন্ট</button></div>`
        : `<div class="row" style="justify-content:center;gap:8px"><button class="btn" id="fb" style="min-width:130px;${following ? "" : "background:var(--purple);color:#fff;border:0"}">${following ? "ফলোয়িং" : "ফলো করুন"}</button>
           <a class="btn" href="#chat/${p.id}" style="min-width:110px">💬 মেসেজ</a></div>`}
    </div>
    ${mine ? `<div id="accBox" class="${S.openAcc ? "" : "hidden"}" style="margin-top:12px">${accountBlock(p)}</div>` : ""}
    ${host && !mine && setting("calls_enabled", true) !== false && p.calls_on !== false ? `<div class="callbtns"><button class="cb vid" id="cbV">📹 ভিডিও কল<small>🪙${n(callRate(p, "video"))}/মিনিট</small></button><button class="cb aud" id="cbA">📞 অডিও কল<small>🪙${n(callRate(p, "audio"))}/মিনিট</small></button></div>` : ""}
    ${seller && !mine && helpersAllowed() ? `<a class="sellcta" href="#chat/${p.id}"><span>🪙</span><div><b>এই হোস্টের কাছ থেকে কয়েন কিনুন</b><small>মেসেজ দিন → টাকা পাঠান → কয়েন সাথে সাথে পাবেন</small></div><em>›</em></a>` : ""}
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
  $("#lo")?.addEventListener("click", async () => { if (!await ask("লগআউট করবেন?")) return; await sb.auth.signOut(); S.me = null; location.hash = ""; showAuth(); });
  $("#cbV")?.addEventListener("click", () => startCall(p, "video"));
  $("#cbA")?.addEventListener("click", () => startCall(p, "audio"));
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

// 📞 আমার কলের রেট (হোস্ট নিজে ঠিক করে, লেভেল অনুযায়ী সর্বোচ্চ সীমা)
R.callprice = async () => {
  screen.innerHTML = `<div class="page">${header("আমার কলের রেট")}<div class="spinner"></div></div>`;
  let c = await rpc("my_call_price").catch((e) => { toast(errMsg(e), true); return null; });
  if (!c) return;
  const taka = (coins) => tk(coins * (c.coin_paisa || 10));
  const EN_ = window.getLang?.() === "en";
  const paint = () => {
    const LV = Object.keys(c.caps || {}).map(Number).sort((a, b) => a - b);
    screen.innerHTML = `<div class="page cp-page">${header("আমার কলের রেট")}
      <div class="cp-hero"><span class="cp-coin">🪙</span><b>${n(c.video)}</b><small>/মিনিট</small></div>
      <div class="cp-card">
        <div class="cp-row"><span>📹 ভিডিও কলের রেট</span><b>🪙 ${n(c.video)} /মিনিট</b><button class="cp-edit" data-k="video">✏️ বদলান</button></div>
        <div class="cp-row"><span>📞 অডিও কলের রেট</span><b>🪙 ${n(c.audio)} /মিনিট</b><button class="cp-edit" data-k="audio">✏️ বদলান</button></div>
        <ol class="cp-notes">
          <li translate="no">${EN_ ? `For every call minute you get ${n(c.host_pct)}% of your price (🪙100 = ${taka(100)}).` : `প্রতি মিনিট কলে আপনি রেটের ${n(c.host_pct)}% পাবেন (🪙১০০ = ${taka(100)})।`}</li>
          <li>লেভেল বাড়লে আরও বেশি রেট রাখতে পারবেন।</li>
          <li>রেট বেশি হলে কল কম আসতে পারে — নিজের মতো ঠিক করুন।</li>
        </ol>
      </div>
      <div class="cp-card"><h3>লেভেল অনুযায়ী সর্বোচ্চ রেট</h3>
        <table class="cp-table">${LV.map((l, i) => `<tr class="${l === c.level ? "me" : ""}"><td>${i === 0 && l > 0 ? "≤" : i === LV.length - 1 ? "≥" : ""}Lv${l}</td><td>🪙 ${n(c.caps[l])}</td></tr>`).join("")}</table>
        <p class="cp-lv">আমার লেভেল <b>Lv${c.level}</b> · ${EN_ ? "max" : "সর্বোচ্চ"} 🪙 ${n(c.cap)} <a href="#level">›</a></p></div>
      <label class="li card"><span>📞 কল নিতে রাজি</span><input type="checkbox" id="cpOn" class="sw" ${c.calls_on ? "checked" : ""}></label></div>`;
    screen.querySelectorAll(".cp-edit").forEach((b) => (b.onclick = () => {
      const k = b.dataset.k;
      const body = sheet(`<h3>${k === "video" ? "📹 ভিডিও" : "📞 অডিও"} কলের রেট</h3>
        <p class="tiny muted" translate="no">${EN_ ? `1 to ${n(c.cap)} coins / minute (your level Lv${c.level})` : `১ থেকে ${n(c.cap)} কয়েন / মিনিট (আপনার লেভেল Lv${c.level})`}</p>
        <input id="cpV" type="number" inputmode="numeric" min="1" max="${c.cap}" value="${c[k]}">
        <div class="cp-quick">${[30, 60, 100, 200, 300].filter((x) => x <= c.cap).map((x) => `<button type="button" data-v="${x}">${x}</button>`).join("")}</div>
        <button class="btn primary" id="cpOk">সেভ করুন</button>`);
      body.querySelector(".cp-quick").onclick = (e) => { const q = e.target.closest("[data-v]"); if (q) body.querySelector("#cpV").value = q.dataset.v; };
      body.querySelector("#cpOk").onclick = async (e) => {
        const v = Math.round(Number(body.querySelector("#cpV").value));
        if (!(v >= 1 && v <= c.cap)) return toast(EN_ ? `Enter 1 to ${n(c.cap)}` : `১ থেকে ${n(c.cap)} এর মধ্যে দিন`, true);
        e.target.disabled = true;
        try { c = await rpc("set_my_call_price", { p_video: k === "video" ? v : null, p_audio: k === "audio" ? v : null }); S.me.call_video_rate = c.video; S.me.call_audio_rate = c.audio; closeSheet(); toast("সেভ হয়েছে"); paint(); }
        catch (er) { toast(errMsg(er), true); e.target.disabled = false; }
      };
    }));
    $("#cpOn").onchange = async (e) => { try { await rpc("set_call_prefs", { p_on: e.target.checked }); c.calls_on = e.target.checked; toast(e.target.checked ? "📞 কল চালু" : "📵 কল বন্ধ"); } catch (er) { toast(errMsg(er), true); } };
  };
  paint();
};

// 👤 আমার প্রোফাইল (তালিকা আকারে, প্রতিটি সারিতে চাপলে বদলানো যায়)
const INTERESTS = ["🎵 গান", "💃 নাচ", "🎮 গেম", "📚 পড়াশোনা", "✈️ ভ্রমণ", "🍳 রান্না", "⚽ খেলা", "🎬 সিনেমা", "😂 মজা", "💬 আড্ডা", "📸 ফটোগ্রাফি", "💪 ফিটনেস", "🕌 ধর্ম", "💼 ব্যবসা", "🐱 পোষা প্রাণী", "🌸 ফ্যাশন"];
const ageOf = (d) => { if (!d) return null; const b = new Date(d), t = new Date(); let a = t.getFullYear() - b.getFullYear(); if (t < new Date(t.getFullYear(), b.getMonth(), b.getDate())) a--; return a; };
R.myprofile = async () => {
  screen.innerHTML = `<div class="page">${header("আমার প্রোফাইল")}<div class="spinner"></div></div>`;
  const [{ data: p }, { data: pv }] = await Promise.all([
    sb.from("profiles").select("*").eq("id", S.me.id).single(),
    sb.from("user_private").select("phone,email,birth_date,country_code,city,country").eq("user_id", S.me.id).maybeSingle(),
  ]);
  S.me = { ...S.me, ...p };
  const age = ageOf(pv?.birth_date);
  const mask = (x) => (x ? String(x).replace(/^(\+?\d{3})\d+(\d{3})$/, "$1•••••$2") : "");
  const USERDATA = ["name", "bio", "loc", "phone", "email"];
  const row = (k, label, val, edit = true) => `<button class="pr-row" data-k="${k}" ${edit ? "" : "disabled"}><span>${label}</span><b ${val && USERDATA.includes(k) ? 'translate="no"' : ""}>${val || `<i class="muted">যোগ করুন</i>`}</b>${edit ? "<em>›</em>" : ""}</button>`;
  screen.innerHTML = `<div class="page">${header("আমার প্রোফাইল")}
    <div class="pr-list">
      <a class="pr-row" href="#edit"><span>আমার ছবি</span><b>${avatar(p)}</b><em>›</em></a>
      <button class="pr-row" data-k="id"><span>ID</span><b>${p.user_no} <small class="copy">কপি</small></b></button>
      ${row("name", "নাম", esc(p.full_name || p.username))}
      ${row("gender", "লিঙ্গ", p.gender === "male" ? "👨 ছেলে" : p.gender === "female" ? "👩 মেয়ে" : "")}
      ${row("age", "বয়স", age != null ? `${age} বছর` : "")}
      ${row("region", "দেশ", pv?.country_code ? `${flagOf(pv.country_code)} ${esc(COUNTRY_NAMES[pv.country_code] ?? pv.country ?? pv.country_code)}` : "", false)}
      ${row("loc", "লোকেশন", esc([pv?.city, pv?.country_code].filter(Boolean).join(" - ")), false)}
      ${row("lang", "ভাষা", esc(langName(p.language)))}
      ${row("lang2", "দ্বিতীয় ভাষা", p.language2 ? esc(langName(p.language2)) : "")}
      ${row("tags", "আগ্রহ / ট্যাগ", (p.interests ?? []).map(esc).join(" "))}
      ${row("bio", "নিজের পরিচয়", esc((p.bio ?? "").slice(0, 40)) + ((p.bio ?? "").length > 40 ? "…" : ""))}
    </div>
    <div class="pr-list">
      ${row("phone", "ফোন", esc(mask(pv?.phone)), false)}
      ${row("email", "ইমেইল", esc(pv?.email ?? ""), false)}
      <a class="pr-row" href="#edit"><span>কভার ফটো ও ইউজারনেম</span><b></b><em>›</em></a>
    </div>
    <p class="tiny muted" style="text-align:center">দেশ ও লোকেশন ফোনের লোকেশন থেকে নিজে থেকেই আসে।</p></div>`;
  const saveBasic = (fields) => rpc("update_profile", { p_full_name: fields.name ?? p.full_name, p_username: p.username, p_bio: fields.bio ?? p.bio ?? "", p_avatar_url: null });
  screen.querySelector(".page").onclick = async (e) => {
    const r = e.target.closest("button.pr-row"); if (!r) return;
    const k = r.dataset.k;
    if (k === "id") { try { await navigator.clipboard.writeText(String(p.user_no)); toast("ID কপি হয়েছে"); } catch { toast(String(p.user_no)); } return; }
    let html = "", get = null;
    if (k === "name") { html = `<h3>নাম</h3><input id="pe" maxlength="60" value="${esc(p.full_name ?? "")}">`; get = async () => saveBasic({ name: $("#pe").value }); }
    else if (k === "bio") { html = `<h3>নিজের পরিচয়</h3><textarea id="pe" maxlength="300" placeholder="নিজের সম্পর্কে কিছু লিখুন…">${esc(p.bio ?? "")}</textarea>`; get = async () => saveBasic({ bio: $("#pe").value }); }
    else if (k === "gender") { html = `<h3>লিঙ্গ</h3><select id="pe"><option value="">বলতে চাই না</option><option value="male" ${p.gender === "male" ? "selected" : ""}>👨 ছেলে</option><option value="female" ${p.gender === "female" ? "selected" : ""}>👩 মেয়ে</option></select>`; get = async () => rpc("set_gender", { p_gender: $("#pe").value || null }); }
    else if (k === "age") { html = `<h3>জন্মতারিখ</h3><input id="pe" type="date" value="${esc(pv?.birth_date ?? "")}"><p class="tiny muted">বয়স জন্মতারিখ থেকে হিসাব হয়। অ্যাপ ব্যবহার করতে ১৮+ হতে হবে।</p>`; get = async () => { if (!$("#pe").value) throw new Error("তারিখ দিন"); if (ageOf($("#pe").value) < 18) throw new Error("অ্যাপ ব্যবহার করতে ১৮+ হতে হবে"); return rpc("set_birth_date", { p_date: $("#pe").value }); }; }
    else if (k === "lang" || k === "lang2") {
      const cur = k === "lang" ? p.language : p.language2;
      html = `<h3>${k === "lang" ? "ভাষা" : "দ্বিতীয় ভাষা"}</h3><select id="pe">${k === "lang2" ? `<option value="">নেই</option>` : ""}${LANGS.filter(([x]) => x).map(([x, l]) => `<option value="${x}" ${x === cur ? "selected" : ""}>${l}</option>`).join("")}</select>`;
      get = async () => k === "lang" ? rpc("set_language", { p_lang: $("#pe").value }) : rpc("set_profile_extra", { p_language2: $("#pe").value || null, p_interests: p.interests ?? [] });
    } else if (k === "tags") {
      const sel = new Set(p.interests ?? []);
      html = `<h3>আগ্রহ / ট্যাগ <small class="muted">(সর্বোচ্চ ৮টি)</small></h3><div class="int-pick" id="pe">${INTERESTS.map((t) => `<button type="button" class="${sel.has(t) ? "on" : ""}">${t}</button>`).join("")}</div>`;
      get = async () => rpc("set_profile_extra", { p_language2: p.language2, p_interests: [...$("#pe").querySelectorAll(".on")].map((b) => b.textContent) });
    } else return;
    const body = sheet(`${html}<button class="btn primary" id="peOk">সেভ করুন</button>`);
    body.querySelector(".int-pick")?.addEventListener("click", (ev) => { const b = ev.target.closest("button"); if (!b) return; if (!b.classList.contains("on") && body.querySelectorAll(".int-pick .on").length >= 8) return toast("সর্বোচ্চ ৮টি বেছে নিন", true); b.classList.toggle("on"); });
    body.querySelector("#peOk").onclick = async (ev) => {
      ev.target.disabled = true;
      try { await get(); closeSheet(); toast("সেভ হয়েছে"); R.myprofile(); } catch (er) { toast(errMsg(er), true); ev.target.disabled = false; }
    };
  };
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
  $("#avDel").onclick = async () => { if (!await ask("প্রোফাইল ছবি মুছবেন?")) return; avatarDel = true; avatarBlob = null; $("#avPrev").innerHTML = avatar({ ...p, avatar_url: null }); $("#avDel").hidden = true; };
  $("#cvDel").onclick = async () => { if (!await ask("কভার ফটো মুছবেন?")) return; coverDel = true; coverBlob = null; $("#cvPrev").style.backgroundImage = ""; $("#cvPrev").innerHTML = "<span>কোনো কভার ফটো নেই</span>"; $("#cvDel").hidden = true; };
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
      if (!await ask("ফাইলটি স্থায়ীভাবে মুছবেন?")) return;
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
