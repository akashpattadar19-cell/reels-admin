// Reels Enjoy ওয়েবসাইট — অ্যাপ থেকে সরাসরি তথ্য (site_info, লগইন ছাড়া পড়া যায়)
(function () {
  const CFG = window.REELS_CONFIG || {};
  let lang = (() => { try { return localStorage.getItem("lang") === "en" ? "en" : "bn"; } catch { return "bn"; } })();
  let INFO = null, clockT = null;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const L = (bn, en) => (lang === "en" ? en : bn);
  const BN_DIG = "০১২৩৪৫৬৭৮৯";
  const num = (x) => { const s = Number(x || 0).toLocaleString("en-IN"); return lang === "en" ? s : s.replace(/\d/g, (d) => BN_DIG[d]); };
  const tk = (paisa) => "৳" + num(Math.round(Number(paisa || 0)) / 100);
  const date = (iso) => new Date(iso).toLocaleDateString(lang === "en" ? "en-GB" : "bn-BD", { day: "numeric", month: "long", year: "numeric" });
  function launchOffers(S) {
    const box = $("#lnCards"); if (!box) return;
    const du = S.daily_task_user || {}, dh = S.daily_task_host || {}, he = S.host_engage || {}, tu = S.ref_top_user || {}, th = S.ref_top_host || {};
    const tasks = (d) => [["video_post", "ভিডিও পোস্ট", "video posts"], ["text_post", "লেখা পোস্ট", "text posts"], ["watch", "ভিডিও পুরো দেখা", "full video watches"],
      ["like", "ভিডিওতে লাইক", "video likes"], ["comment", "ভিডিওতে কমেন্ট", "video comments"], ["tlike", "লেখায় লাইক", "text post likes"],
      ["tcomment", "লেখায় কমেন্ট", "text post comments"], ["share", "শেয়ার", "shares"]]
      .filter(([k]) => Number(d[k]) > 0).map(([k, bn, en]) => `<span>${num(d[k])} ${L(bn, en)}</span>`).join("");
    const tiers = (t) => (t.tiers || []).map((x) => `<div class="tr"><span>${L(`${num(x.refs)} রেফার + ${num(x.active)}% এক্টিভ`, `${num(x.refs)} referrals + ${num(x.active)}% active`)}</span><b>${tk(x.paisa)}</b></div>`).join("");
    const item = (ic, title, body) => `<div class="li"><i>${ic}</i><div><b>${title}</b>${body ? `<p>${body}</p>` : ""}</div></div>`;
    const refCond = L(`দুজনকেই কমপক্ষে ${num(S.ref_req_video_posts)}টি ভিডিও ও ${num(S.ref_req_text_posts)}টি লেখা পোস্ট করতে হবে (নতুন জন ${num(S.ref_window_days)} দিনের মধ্যে)`,
      `Both must post at least ${num(S.ref_req_video_posts)} videos and ${num(S.ref_req_text_posts)} text posts (the new user within ${num(S.ref_window_days)} days)`);
    const user = `<div class="ln-card user"><div class="ln-top"><span class="ln-ic">👤</span><div><h3>${L("ইউজারদের জন্য", "For users")}</h3><small>${L("দেখুন, পোস্ট করুন, বন্ধুদের আনুন", "Watch, post and invite friends")}</small></div></div>
      ${item("🤝", L(`প্রতি সফল রেফারে <em>${tk(S.referral_bonus_paisa)}</em> — বন্ধুও পাবে <em>${tk(S.ref_new_user_paisa)}</em>`, `<em>${tk(S.referral_bonus_paisa)}</em> per successful referral — your friend gets <em>${tk(S.ref_new_user_paisa)}</em> too`), refCond)}
      ${S.daily_task_enabled !== false && Number(du.coins) > 0 ? item("🎯", L(`দৈনিক টার্গেট পূরণে <em>🪙 ${num(du.coins)} কয়েন</em>`, `Daily target = <em>🪙 ${num(du.coins)} coins</em>`), `<span class="chips">${tasks(du)}</span>`) : ""}
      ${S.ref_top_enabled !== false && (tu.tiers || []).length ? item("🏆", L(`প্রতি ১০ দিনে টপ ${num(tu.top)} রেফারার বোনাস (মাসে ৩ বার)`, `Top ${num(tu.top)} referrers every 10 days (3 times a month)`), `<div class="tiers">${tiers(tu)}</div>`) : ""}
      ${item("💸", L(`bKash / Nagad / Rocket-এ উইথড্র — সর্বনিম্ন ${tk(S.withdraw_min_paisa)}`, `Withdraw to bKash / Nagad / Rocket — from ${tk(S.withdraw_min_paisa)}`), L(`${num(S.withdraw_cooldown_days)} দিনে একবার · ভালো কাজ করলে এডমিন ⚡ দ্রুত উইথড্র চালু করেন`, `Once every ${num(S.withdraw_cooldown_days)} days · admin turns on ⚡ fast withdraw for hard workers`))}
      </div>`;
    const host = `<div class="ln-card host"><div class="ln-top"><span class="ln-ic">👑</span><div><h3>${L("হোস্টদের জন্য", "For hosts")}</h3><small>${L("ভিডিও, লাইভ, কল — বেশি আয়", "Videos, live, calls — earn more")}</small></div></div>
      ${item("🤝", L(`প্রতি সফল রেফারে <em>${tk(S.host_referral_bonus_paisa)}</em> — নতুন জন পাবে <em>${tk(S.host_ref_new_user_paisa)}</em>`, `<em>${tk(S.host_referral_bonus_paisa)}</em> per successful referral — the new user gets <em>${tk(S.host_ref_new_user_paisa)}</em>`),
        Number(S.host_ref_every_n) > 0 && Number(S.host_ref_every_paisa) > 0 ? L(`প্রতি ${num(S.host_ref_every_n)} জন সফল রেফারে বাড়তি <em>${tk(S.host_ref_every_paisa)}</em>`, `Extra <em>${tk(S.host_ref_every_paisa)}</em> for every ${num(S.host_ref_every_n)} successful referrals`) : "")}
      ${S.daily_task_enabled !== false && Number(dh.coins) > 0 ? item("🎯", L(`দৈনিক টার্গেট পূরণে <em>🪙 ${num(dh.coins)} কয়েন</em>`, `Daily target = <em>🪙 ${num(dh.coins)} coins</em>`), `<span class="chips">${tasks(dh)}</span>`) : ""}
      ${he.enabled && Number(he.coins) > 0 ? item("❤️", L(`আপনার ভিডিওতে প্রতি লাইক, কমেন্ট, শেয়ারে <em>🪙 ${num(he.coins)}</em>`, `<em>🪙 ${num(he.coins)}</em> for every like, comment and share on your videos`), Number(he.daily_cap) > 0 ? L(`দিনে সর্বোচ্চ 🪙 ${num(he.daily_cap)} · যত বেশি ভিডিও ও রেফার, তত বেশি আয়`, `Up to 🪙 ${num(he.daily_cap)} a day · more videos and referrals = more income`) : "") : ""}
      ${item("🔴", L("লাইভ ও কলে আরও বেশি আয় — <em>শীঘ্রই আসছে</em>", "Bigger income from live & calls — <em>coming soon</em>"), L("গিফট ও কলের কয়েন Beans হয়ে টাকায় তোলা যাবে", "Gift and call coins become Beans you can withdraw as taka"))}
      ${S.ref_top_enabled !== false && (th.tiers || []).length ? item("🏆", L(`প্রতি ১০ দিনে টপ ${num(th.top)} হোস্ট রেফার বোনাস`, `Top ${num(th.top)} host referral bonus every 10 days`), `<div class="tiers">${tiers(th)}</div>`) : ""}
      </div>`;
    box.innerHTML = user + host;
    $("#lnTrust").innerHTML = [
      ["🛡️", L("আসল মানুষ, আসল পুরস্কার", "Real people, real rewards"), L("একই মোবাইলে বাড়তি অ্যাকাউন্ট বা ভুয়া কাজ ধরা পড়লে বোনাস বাতিল — তাই সৎ ইউজাররাই পুরো টাকা পান।", "Extra accounts on one phone or fake activity lose the bonus — so honest users get paid in full.")],
      ["🔎", L("সব নিয়ম খোলাখুলি", "Every rule in the open"), L("টার্গেট, রেফার আর উইথড্রর সব নিয়ম এই পেজে ও অ্যাপে লেখা — লুকানো কোনো শর্ত নেই।", "All target, referral and withdraw rules are written here and in the app — no hidden conditions.")],
      ["✅", L("এডমিন যাচাই করে পেমেন্ট", "Payments checked by admin"), L("প্রতিটা উইথড্র যাচাই করে পাঠানো হয়, অ্যাপে ট্রানজেকশন আইডি দেখায়।", "Every withdrawal is checked and sent; the transaction ID shows in the app.")],
      ["🚫", L("কোনো টাকা দিয়ে যোগ দিতে হয় না", "No joining fee — ever"), L("অ্যাপ ব্যবহার ফ্রি। কেউ “নিশ্চিত আয়” বলে টাকা চাইলে দেবেন না।", "The app is free. Never pay anyone who promises “guaranteed income”.")],
    ].map(([i, t, d]) => `<div class="tc"><i>${i}</i><b>${t}</b><p>${d}</p></div>`).join("");
  }
  const T = (x, k) => (lang === "en" ? (x[k + "_en"] || (k === "title" || k === "season" ? x[k] : "")) : x[k]) || "";

  function applyLang() {
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-en]").forEach((el) => {
      if (el.dataset.bn === undefined) el.dataset.bn = el.textContent;
      el.textContent = lang === "en" ? el.dataset.en : el.dataset.bn;
    });
    $("#lang").textContent = lang === "en" ? "বাংলা" : "EN";
    document.querySelectorAll("[data-src-en]").forEach((el) => {
      if (el.dataset.srcBn === undefined) { el.dataset.srcBn = el.getAttribute("src"); el.dataset.posterBn = el.getAttribute("poster") || ""; }
      const src = lang === "en" ? el.dataset.srcEn : el.dataset.srcBn;
      if (el.getAttribute("src") !== src) {
        if (el.dataset.posterEn) el.setAttribute("poster", lang === "en" ? el.dataset.posterEn : el.dataset.posterBn);
        el.setAttribute("src", src);
        if (el.tagName === "VIDEO") { el.load(); el.play().catch(() => {}); }
      }
    });
    if (INFO) render();
  }
  $("#lang").onclick = () => { lang = lang === "en" ? "bn" : "en"; try { localStorage.setItem("lang", lang); } catch { /* */ } applyLang(); };


  // অ্যাডমিন → ওয়েবসাইট পেজের লেখা ও ডিজাইন
  function applySite(S) {
    const T = S.site_texts || {};
    document.querySelectorAll("[data-k]").forEach((el) => {
      const k = el.dataset.k;
      if (el.dataset.bn === undefined) el.dataset.bn = el.textContent;
      if (T[k]) el.dataset.bn = T[k];
      if (T[k + "_en"]) el.dataset.en = T[k + "_en"];
    });
    const rib = $("#ribbon"), rt = lang === "en" ? T.notice_en : T.notice;
    if (rt) { rib.textContent = rt; rib.classList.remove("hidden"); } else rib.classList.add("hidden");
    const soc = [["facebook", "📘 Facebook"], ["youtube", "▶️ YouTube"], ["tiktok", "🎵 TikTok"], ["instagram", "📸 Instagram"]]
      .filter(([k]) => /^https:\/\//.test(T[k] || "")).map(([k, l]) => `<a href="${esc(T[k])}" target="_blank" rel="noopener">${l}</a>`);
    const wa = String(T.whatsapp || "").replace(/[^0-9]/g, "");
    if (wa) soc.unshift(`<a href="https://wa.me/${wa}" target="_blank" rel="noopener">💬 WhatsApp</a>`);
    $("#socials").innerHTML = soc.join(" · ");
    $("#footNote").textContent = (lang === "en" ? T.footer_en : T.footer) || "";
    document.body.className = "t-c";
  }
  function extraFaq(S) {
    const T = S.site_texts || {};
    return String((lang === "en" && T.faq_en) || T.faq || "").split("\n").map((l) => l.split("||")).filter((x) => x.length === 2 && x[0].trim() && x[1].trim())
      .map(([q, a]) => [q.trim(), a.trim()]);
  }
  function left(s) {
    const t = new Date(s.state === "upcoming" ? s.starts_at : s.ends_at) - Date.now();
    if (s.state === "paid") return L("🎉 বিজয়ী ঘোষণা হয়েছে", "🎉 Winners announced");
    if (t <= 0 || s.state === "ended") return L("🏁 শেষ — শীঘ্রই ফলাফল", "🏁 Finished — results soon");
    const d = Math.floor(t / 864e5), h = Math.floor(t % 864e5 / 36e5), m = Math.floor(t % 36e5 / 6e4);
    const span = lang === "en" ? `${d ? d + "d " : ""}${h}h ${m}m` : `${d ? num(d) + " দিন " : ""}${num(h)} ঘণ্টা ${num(m)} মিনিট`;
    return s.state === "upcoming" ? L(`⏳ শুরু হতে ${span}`, `⏳ Starts in ${span}`) : L(`⏳ শেষ হতে ${span}`, `⏳ ${span} left`);
  }
  const RK = ["🥇", "🥈", "🥉"];

  function seasonHtml(s) {
    const board = s.creator_prizes?.length ? "creator" : "referral";
    const prizes = s[board + "_prizes"] || [];
    const total = [...(s.creator_prizes || []), ...(s.referral_prizes || [])].reduce((a, b) => a + b, 0);
    const W = s.weights || {};
    return `<div class="season"><div>
        <h3>🏆 ${esc(T(s, "title"))}</h3>
        <div class="clock" id="sClock">${left(s)}</div>
        <div class="total">${L("মোট পুরস্কার", "Total prize")}<b>৳${num(total)}</b></div>
        <div class="prizes">${prizes.map((p, i) => `<span class="${i < 3 ? "t" : ""}">${i < 3 ? RK[i] : "#" + num(i + 1)} ৳${num(p)}</span>`).join("")}</div>
        ${s.referral_prizes?.length && board === "creator" ? `<div class="prizes">${s.referral_prizes.map((p, i) => `<span>🤝 ${i < 3 ? RK[i] : "#" + num(i + 1)} ৳${num(p)}</span>`).join("")}</div>` : ""}
        <div style="margin-top:10px;font-size:14px;opacity:.95">${date(s.starts_at)} — ${date(s.ends_at)}</div>
      </div><div>
        <div class="how"><b>${L("কীভাবে পয়েন্ট পাবেন", "How you score")}</b><ul>
          ${s.creator_prizes?.length ? `<li>${L("অনুমোদিত প্রতিটি ভিডিও", "Each approved video")}: ${num(W.video)}</li>
          <li>${L("অন্যরা পুরো ভিডিও দেখলে", "Others watch your full video")}: ${num(W.watch)} · ${L("লাইক", "like")}: ${num(W.like)} · ${L("কমেন্ট", "comment")}: ${num(W.comment)} · ${L("শেয়ার", "share")}: ${num(W.share)}</li>
          <li>${L(`তালিকায় আসতে কমপক্ষে ${num(s.min_videos)}টি অনুমোদিত ভিডিও`, `At least ${num(s.min_videos)} approved videos to be listed`)}</li>` : ""}
          ${s.referral_prizes?.length ? `<li>${L("প্রতি সফল রেফার", "Each successful referral")}: ${num(W.referral)}</li>` : ""}
          <li>${L("নিজের বা একই মোবাইলের অন্য অ্যাকাউন্টের কাজ গোনা হয় না", "Your own or same-phone accounts don't count")}</li></ul></div>
        ${s.top?.length ? `<div class="top5">${s.top.map((r) => `<div>${r.rank <= 3 ? RK[r.rank - 1] : "#" + num(r.rank)} <span>${esc(r.name)}</span><em>${num(r.score)}</em></div>`).join("")}</div>` : ""}
      </div></div>`;
  }

  function render() {
    const I = INFO, S = I.settings || {}, LK = S.income_locks || {};
    applySite(S); document.querySelectorAll("[data-k]").forEach((el) => (el.textContent = lang === "en" ? el.dataset.en : el.dataset.bn));
    // ডাউনলোড লিংক ও ভার্সন
    if (S.apk_url) { $("#dlTop").href = S.apk_url; $("#dlBottom").href = S.apk_url; }
    const ver = S.latest_app_build ? `v1.0.${S.latest_app_build}` : "";
    $("#verTop").textContent = L(`ফ্রি · APK ${ver}`, `Free · APK ${ver}`);
    $("#verBottom").textContent = L(`Android · ফ্রি · ${ver}`, `Android · Free · ${ver}`);

    // অফার
    const cards = [];
    if (S.welcome_bonus_enabled && Number(S.welcome_bonus_paisa) > 0)
      cards.push(`<div class="oc"><span class="ic">🎁</span><b>${L("নতুন ইউজার বোনাস", "New user bonus")}</b><div class="big">${tk(S.welcome_bonus_paisa)}</div>
        <p>${L("প্রথমবার অ্যাপ খুললে ব্যালেন্সে আসে। একটি মোবাইলে একবারই।", "Added to your balance the first time you open the app. Once per phone.")}</p></div>`);
    if (Number(S.referral_bonus_paisa) > 0)
      cards.push(`<div class="oc"><span class="ic">🤝</span><b>${L("বন্ধুকে রেফার করুন", "Invite friends")}</b><div class="big">${tk(S.referral_bonus_paisa)} <small style="font-size:14px;color:var(--muted)">${L("প্রতি সফল রেফার", "per successful referral")}</small></div>
        <p>${esc(T(S, "ref_offer_text")) || L(`বন্ধু ${num(S.ref_window_days)} দিনের মধ্যে কাজগুলো শেষ করলে বোনাস পাবেন।`, `You get the bonus when your friend finishes the tasks within ${num(S.ref_window_days)} days.`)}</p></div>`);
    (I.coin_offers || []).forEach((o) => cards.push(`<div class="oc">${o.badge ? `<span class="badge">${esc(o.badge)}</span>` : ""}<span class="ic">🪙</span><b>${esc(o.title)}</b>
      <div class="big">🪙 ${num(o.coins)}</div><p>${L(`মাত্র ৳${num(o.price_taka)}-এ (অ্যাপের কয়েন পেজে)`, `for only ৳${num(o.price_taka)} (in the app's coin page)`)}</p>${o.ends_at ? `<div class="when">⏳ ${L("শেষ", "Ends")} ${date(o.ends_at)}</div>` : ""}</div>`));
    (I.posts || []).filter((x) => lang !== "en" || x.title_en).forEach((x) => cards.push(`<div class="oc">${x.image_url ? `<img src="${esc(x.image_url)}" alt="">` : `<span class="ic">${x.kind === "news" ? "📢" : "🎁"}</span>`}
      ${x.pinned ? `<span class="badge">📌</span>` : ""}<b>${esc(T(x, "title"))}</b>${T(x, "body") ? `<p>${esc(T(x, "body"))}</p>` : ""}
      <div class="when">${date(x.starts_at || x.created_at)}${x.ends_at ? ` · ⏳ ${L("শেষ", "Ends")} ${date(x.ends_at)}` : ""}</div>
      ${x.link_url && /^https?:/.test(x.link_url) ? `<a class="btn small" style="margin-top:10px" href="${esc(x.link_url)}" target="_blank" rel="noopener">${L("দেখুন", "Open")} →</a>` : ""}</div>`));
    $("#liveOffers").innerHTML = (I.season ? seasonHtml(I.season) : "") + (cards.length ? `<div class="ocards">${cards.join("")}</div>` : "")
      || `<div class="loading">${L("এখন কোনো অফার নেই — নতুন অফার এলে এখানে দেখাবে।", "No offers right now — new offers will show here.")}</div>`;
    clearInterval(clockT);
    if (I.season) clockT = setInterval(() => { const c = $("#sClock"); if (c) c.textContent = left(I.season); }, 30000);

    // লঞ্চ অফার (ইউজার / হোস্ট) — সব সংখ্যা সেটিংস থেকে
    launchOffers(S);

    // পরিসংখ্যান (যথেষ্ট ইউজার হলে)
    const st = I.stats || {};
    if (st.users >= 100) {
      $("#statsIn").innerHTML = `<div class="s"><b>${num(st.users)}+</b><span>${L("ইউজার", "users")}</span></div><div class="s"><b>${num(st.videos)}+</b><span>${L("ভিডিও", "videos")}</span></div>`
        + (st.paid_count > 0 ? `<div class="s"><b>${num(st.paid_count)}</b><span>${L("সফল উইথড্র", "withdrawals paid")}</span></div><div class="s"><b>${tk(st.paid_paisa)}</b><span>${L("মোট পরিশোধ", "total paid")}</span></div>` : "");
      $("#stats").classList.remove("hidden");
    }

    // পুরস্কার ও আয়
    const soon = `<span class="soon">🔒 ${L("শীঘ্রই আসছে", "Coming soon")}</span>`;
    const row = (ic, bn, en, val, sub) => `<div class="r"><i>${ic}</i><div><b>${L(bn, en)}</b>${val}${sub ? `<small>${sub}</small>` : ""}</div></div>`;
    const v = (x) => `<div class="v">${x}</div>`;
    const lockOr = (k, x) => (LK[k] ? soon : v(x));
    $("#earnList").innerHTML = [
      row("🏆", "সিজন প্রতিযোগিতা", "Season contest", v(I.season ? L("চলছে", "Running") : L("নতুন সিজন শীঘ্রই", "Next season soon")), L("সেরা ক্রিয়েটর ও রেফারকারীরা নগদ পুরস্কার পান", "Top creators and referrers win cash prizes")),
      row("🤝", "প্রতি সফল রেফার", "Each successful referral", v(tk(S.referral_bonus_paisa)), L("বন্ধু নির্দিষ্ট কাজগুলো শেষ করলে", "When your friend finishes the tasks")),
      S.welcome_bonus_enabled ? row("🎁", "নতুন ইউজার বোনাস", "New user bonus", v(tk(S.welcome_bonus_paisa)), L("একটি মোবাইলে একবার", "Once per phone")) : "",
      row("💝", "গিফট পেলে", "Receiving gifts", v(L("গিফটের দামের বড় অংশ", "A large share of the gift")), L("দর্শকরা আপনার ভিডিও, লাইভ বা পোস্টে গিফট পাঠালে", "When viewers send gifts on your videos, lives or posts")),
      row("👀", "আপনার ভিডিওর প্রতি ১০০০ ভিউ", "Per 1000 views on your videos", lockOr("views", tk(S.view_rate_paisa_per_1000))),
      row("❤️", "প্রতি লাইক / কমেন্টকারী", "Per like / commenter", LK.likes && LK.comments ? soon : v(`${LK.likes ? "🔒" : tk(S.like_rate_paisa)} / ${LK.comments ? "🔒" : tk(S.comment_rate_paisa)}`)),
      row("⭐", "পুরো ভিডিও দেখলে", "Watching a full video", lockOr("watch", `${num(S.watch_points)} ${L("পয়েন্ট", "points")}`)),
      row("🔁", "পয়েন্ট থেকে টাকা", "Points to money", lockOr("convert", `${num(S.points_convert_min)} ${L("পয়েন্ট", "points")} = ${tk(S.points_convert_min * S.point_value_paisa)}`)),
      row("📺", "অ্যাড দেখে পয়েন্ট", "Points for ads", LK.ads ? soon : v(L("চালু", "On"))),
      row("🖼️", "ফটো ও লেখা থেকে আয়", "Photo & text posts", LK.posts ? soon : v(L("চালু", "On"))),
      Number(S.upload_reward_coins) > 0 ? row("🪙", "ভিডিও অনুমোদন হলে", "Approved video", lockOr("upload", `🪙 ${num(S.upload_reward_coins)}`)) : "",
    ].join("");

    // টাকা-পয়সার নিয়ম
    const coinTk = Number(S.coin_price_paisa || 0) / 100;
    $("#moneyRules").innerHTML = [
      row("💸", "সর্বনিম্ন উইথড্র", "Minimum withdrawal", v(tk(S.withdraw_min_paisa)), "bKash · Nagad · Rocket"),
      row("📅", "কত দিন পরপর", "How often", v(L(`${num(S.withdraw_cooldown_days)} দিনে একবার`, `Once every ${num(S.withdraw_cooldown_days)} days`)), L("একসাথে একটাই রিকোয়েস্ট", "One request at a time")),
      row("⏳", "আয় ব্যালেন্সে আসে", "Earnings become withdrawable", v(L(`${num(S.pending_hold_hours)} ঘণ্টা পর`, `after ${num(S.pending_hold_hours)} hours`)), L("ভুয়া কাজ যাচাইয়ের সময়", "Time to check for fraud")),
      row("✅", "উইথড্র কীভাবে হয়", "How payouts work", v(L("অ্যাডমিন যাচাই করে পাঠায়", "Checked and sent by admin")), L("পাঠানোর পর অ্যাপে ট্রানজেকশন আইডি দেখাবে", "The transaction ID shows in the app")),
      row("🪙", "কয়েনের দাম", "Coin price", v(`🪙 1 = ৳${coinTk.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`), L("কয়েন দিয়ে গিফট, VIP, প্রোফাইল সাজানো, বুস্ট — কয়েন টাকায় তোলা যায় না", "Coins are for gifts, VIP, profile style and boosts — coins can't be withdrawn")),
      row("🛒", "কয়েন কেনা", "Buying coins", v(L("অ্যাপের ভেতর থেকে", "Inside the app")), L(`bKash / Nagad, কমপক্ষে ৳${num(S.min_cash_in_taka)} · Google Play শীঘ্রই`, `bKash / Nagad, from ৳${num(S.min_cash_in_taka)} · Google Play soon`)),
    ].join("");

    // রেফার টাস্ক
    const tasks = [
      ["ref_req_full_watch", "টি ভিডিও পুরো দেখবে", " full video watches"], ["ref_req_likes", "টি ভিডিওতে লাইক দেবে", " likes"],
      ["ref_req_comments", "টি কমেন্ট করবে", " comments"], ["ref_req_shares", "টি ভিডিও শেয়ার করবে", " shares"],
      ["ref_req_video_posts", "টি ভিডিও পোস্ট করবে (অনুমোদিত)", " approved video posts"], ["ref_req_text_posts", "টি লেখা পোস্ট করবে", " text posts"],
    ].filter(([k]) => Number(S[k]) > 0).map(([k, bn, en]) => `<li>${lang === "en" ? num(S[k]) + en : num(S[k]) + bn}</li>`);
    if (Number(S.ref_req_active_days) > 0) tasks.push(`<li>${L(`${num(S.ref_req_active_days)} দিন অ্যাপ ব্যবহার (প্রতিদিন কমপক্ষে ${num(S.ref_req_minutes_per_day)} মিনিট)`, `Uses the app on ${num(S.ref_req_active_days)} days (at least ${num(S.ref_req_minutes_per_day)} min each day)`)}</li>`);
    tasks.push(`<li>${L(`সব কাজ শেষ করার সময়: ${num(S.ref_window_days)} দিন`, `Time to finish everything: ${num(S.ref_window_days)} days`)}</li>`);
    $("#refTasks").innerHTML = tasks.join("");


    // এজেন্ট
    if (S.agent_enabled !== false && S.agent_enabled !== undefined) {
      const pd = Number(S.agent_req_post_days || 0);
      const t = [
        Number(S.agent_req_active_days) > 0 && L(`${num(S.agent_req_active_days)} দিন অ্যাপ ব্যবহার (প্রতিদিন কমপক্ষে ${num(S.agent_req_minutes_per_day)} মিনিট)`, `Uses the app on ${num(S.agent_req_active_days)} days (${num(S.agent_req_minutes_per_day)}+ min a day)`),
        Number(S.agent_req_photo_per_day) > 0 && L(`${num(pd)} দিন — প্রতিদিন ${num(S.agent_req_photo_per_day)}টি ফটো পোস্ট`, `${num(pd)} days — ${num(S.agent_req_photo_per_day)} photo posts a day`),
        Number(S.agent_req_text_per_day) > 0 && L(`${num(pd)} দিন — প্রতিদিন ${num(S.agent_req_text_per_day)}টি লেখা পোস্ট`, `${num(pd)} days — ${num(S.agent_req_text_per_day)} text posts a day`),
        Number(S.agent_req_video_per_day) > 0 && L(`${num(pd)} দিন — প্রতিদিন ${num(S.agent_req_video_per_day)}টি ভিডিও পোস্ট`, `${num(pd)} days — ${num(S.agent_req_video_per_day)} video posts a day`),
        Number(S.agent_req_full_watch) > 0 && L(`অন্যদের ${num(S.agent_req_full_watch)}টি ভিডিও পুরো দেখা`, `Watches ${num(S.agent_req_full_watch)} full videos by others`),
        L(`${num(S.agent_req_likes)}টি লাইক, ${num(S.agent_req_comments)}টি কমেন্ট, ${num(S.agent_req_shares)}টি শেয়ার`, `${num(S.agent_req_likes)} likes, ${num(S.agent_req_comments)} comments, ${num(S.agent_req_shares)} shares`),
        L(`সব কাজ ${num(S.agent_window_days)} দিনের মধ্যে`, `Everything within ${num(S.agent_window_days)} days`),
      ].filter(Boolean);
      $("#agentBox").innerHTML = `<div class="two" style="margin-top:0"><div class="card"><h3>${L("এজেন্ট যা পাবেন", "What agents get")}</h3><div class="rules-grid" style="grid-template-columns:1fr">
          ${row("💰", "প্রতি সফল রেফার", "Each successful referral", v(tk(S.agent_ref_bonus_paisa)))}
          ${Number(S.agent_target_refs) > 0 && Number(S.agent_target_bonus_paisa) > 0 ? row("🎯", `প্রতি ${num(S.agent_target_refs)} জন সফল রেফারে`, `Every ${num(S.agent_target_refs)} successful referrals`, v("+" + tk(S.agent_target_bonus_paisa)), L("বারবার পাওয়া যায়", "Repeats every time")) : ""}
          ${row("🧑‍💼", "প্রোফাইলে এজেন্ট ব্যাজ", "Agent badge on profile", v(L("হ্যাঁ", "Yes")))}</div></div>
        <div class="card"><h3>${L("এজেন্টের আনা ইউজারকে যা করতে হবে", "What an agent's new user must do")}</h3><ul class="checks">${t.map((x) => `<li>${x}</li>`).join("")}</ul>
          <p class="note">${L("একই মোবাইলে একাধিক অ্যাকাউন্ট গোনা হয় না। ভুয়া অ্যাকাউন্ট আনলে এজেন্ট পদ বাতিল।", "Several accounts on one phone don't count. Fake accounts cancel the agent role.")}</p></div></div>`;
      $("#agent").classList.remove("hidden");
    }
    // বিজয়ী
    if (I.winners?.length) {
      $("#winList").innerHTML = I.winners.map((w) => `<div class="w"><span class="rk">${w.rank <= 3 ? RK[w.rank - 1] : "#" + num(w.rank)}</span>
        <span class="av">${w.avatar_url ? `<img src="${esc(w.avatar_url)}" alt="">` : esc((w.name || "?").charAt(0))}</span>
        <span><b>${esc(w.name)}</b><small>${esc(T(w, "season"))} · ${w.board === "referral" ? L("রেফার", "Referral") : L("ক্রিয়েটর", "Creator")}</small></span><em>${tk(w.prize_paisa)}</em></div>`).join("");
      $("#winners").classList.remove("hidden");
    }

    // যোগাযোগ
    if (S.support_email) { $("#supEmail").href = "mailto:" + S.support_email; $("#supEmail").textContent = S.support_email; }
    const tg = String(S.support_telegram || "").replace(/^@/, "");
    $("#supTg").innerHTML = tg ? `✈️ Telegram: <a href="https://t.me/${esc(tg)}" target="_blank" rel="noopener">@${esc(tg)}</a>` : "";
    $("#supHours").textContent = lang === "en" ? "We usually reply within a few hours." : (S.support_hours || "");

    // প্রশ্ন ও উত্তর
    const faq = [
      [L("Reels Enjoy কি ফ্রি?", "Is Reels Enjoy free?"), L("হ্যাঁ। অ্যাপ নামানো, ভিডিও দেখা ও বানানো, লাইভ দেখা — সব ফ্রি। কয়েন কেনা ঐচ্ছিক, শুধু গিফট, VIP বা প্রোফাইল সাজানোর জন্য।", "Yes. Downloading, watching and making videos, and watching lives are free. Buying coins is optional — only for gifts, VIP or profile style.")],
      [L("কিছু আয়ে “শীঘ্রই আসছে” লেখা কেন?", "Why do some rewards say “Coming soon”?"), L("অ্যাপ সবে শুরু হয়েছে। এখন পুরস্কার আসে প্রতিযোগিতা, রেফার আর গিফট থেকে। বাকি আয় চালু হলে এই ওয়েবসাইট আর অ্যাপে ঘোষণা দেওয়া হবে।", "The app has just launched. For now rewards come from contests, referrals and gifts. Other rewards will be announced here and in the app when they start.")],
      [L("টাকা কীভাবে তুলব?", "How do I withdraw?"), L(`অ্যাপে ওয়ালেট → উইথড্র। কমপক্ষে ${tk(S.withdraw_min_paisa)}, ${num(S.withdraw_cooldown_days)} দিনে একবার। bKash, Nagad বা Rocket নম্বরে অ্যাডমিন যাচাই করে পাঠায়।`, `In the app: Wallet → Withdraw. At least ${tk(S.withdraw_min_paisa)}, once every ${num(S.withdraw_cooldown_days)} days. The admin checks and sends it to your bKash, Nagad or Rocket number.`)],
      [L("প্রতিযোগিতায় কীভাবে জিতব?", "How do I win a contest?"), L("নিজের ভালো ভিডিও বানিয়ে আপলোড করুন — অন্যরা যত দেখবে, লাইক, কমেন্ট ও শেয়ার করবে, তত পয়েন্ট। বন্ধুদের রেফার করলেও পয়েন্ট। ভুয়া অ্যাকাউন্ট বা ভুয়া লাইক ধরা পড়লে পুরস্কার বাতিল।", "Upload your own good videos — the more others watch, like, comment and share, the more points you get. Referrals also score. Fake accounts or likes cancel the prize.")],
      [L("আমার রেফার কেন গোনা হয়নি?", "Why didn't my referral count?"), L(`বন্ধুকে ${num(S.ref_window_days)} দিনের মধ্যে সব কাজ শেষ করতে হবে। একই মোবাইলে আগে অন্য অ্যাকাউন্ট খোলা থাকলে রেফার গোনা হয় না। অ্যাপের “রেফার” পেজে প্রত্যেক বন্ধুর অগ্রগতি দেখা যায়।`, `Your friend must finish all tasks within ${num(S.ref_window_days)} days. Referrals from a phone that already had another account don't count. The Invite page in the app shows each friend's progress.`)],
      [L("কয়েন কি টাকায় ফেরত নেওয়া যায়?", "Can coins be turned back into money?"), L("না। কয়েন শুধু অ্যাপের ভেতরে খরচের জন্য। তবে আপনি গিফট পেলে তার বড় অংশ আপনার উইথড্রযোগ্য আয়ে যোগ হয়।", "No. Coins are only for spending in the app. But when you receive gifts, a large share is added to your withdrawable earnings.")],
      [L("অ্যাপ Google Play-তে নেই কেন?", "Why isn't the app on Google Play?"), L("Google Play-তে প্রকাশের কাজ চলছে। ততদিন এই অফিসিয়াল পেজ থেকে নামাতে পারবেন। Play-তে এলে এখানে জানানো হবে।", "Publishing on Google Play is in progress. Until then you can download from this official page. We'll announce it here when it's live.")],
      [L("কারা ব্যবহার করতে পারবে?", "Who can use it?"), L("১৮ বছর বা তার বেশি বয়সীরা। অশ্লীল বা নিয়মবিরোধী কিছু দিলে অ্যাকাউন্ট বন্ধ হতে পারে।", "People aged 18 or older. Accounts posting obscene or rule-breaking content can be closed.")],
      [L("আমার তথ্য কি নিরাপদ?", "Is my data safe?"), L("আপনার ফোন নম্বর ও ইমেইল অন্য ইউজারদের দেখানো হয় না। অবস্থান আনুমানিকভাবে রাখা হয়, সঠিক ঠিকানা নয়। বিস্তারিত গোপনীয়তা নীতিতে।", "Your phone number and email are never shown to other users. Location is stored only roughly, never your exact address. Details are in the privacy policy.")],
      [L("সমস্যা হলে কোথায় জানাব?", "Where do I get help?"), L("অ্যাপে সেটিংস → লাইভ সাপোর্ট, অথবা নিচের ইমেইলে লিখুন।", "In the app: Settings → Live Support, or email us below.")],
    ];
    faq.push(...extraFaq(S));
    $("#faqList").innerHTML = faq.map(([q, a], i) => `<details ${i === 0 ? "open" : ""}><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("");
  }

  async function load() {
    try {
      const r = await fetch(`${CFG.SUPABASE_URL}/rest/v1/rpc/site_info`, {
        method: "POST", headers: { apikey: CFG.SUPABASE_KEY, "Content-Type": "application/json" }, body: "{}" });
      if (!r.ok) throw new Error(r.status);
      INFO = await r.json();
      render();
    } catch (e) {
      $("#liveOffers").innerHTML = `<div class="loading">${L("অফার লোড করা যায়নি — একটু পরে আবার দেখুন।", "Couldn't load offers — please try again later.")}</div>`;
      $("#earnList").innerHTML = "";
    }
  }

  // এজেন্ট আবেদন (লগইন ছাড়া)
  const AG_ERR = { NO_SUCH_ID: ["এই ID-র কোনো অ্যাকাউন্ট নেই — অ্যাপে আমি পেজে ID দেখে নিন", "No account with this ID — check the ID on the app's Me page"],
    PHONE: ["সঠিক ফোন নম্বর দিন", "Enter a valid phone number"], NAME: ["পুরো নাম লিখুন", "Enter your full name"],
    ACCOUNT_BLOCKED: ["এই অ্যাকাউন্ট এখন আবেদন করতে পারবে না", "This account can't apply right now"],
    TRY_LATER: ["অনেক আবেদন এসেছে — কিছুক্ষণ পরে আবার চেষ্টা করুন", "Too many applications — please try again later"],
    AGENT_OFF: ["এখন এজেন্ট আবেদন বন্ধ আছে", "Agent applications are closed right now"] };
  $("#agForm").onsubmit = async (e) => {
    e.preventDefault();
    const msg = $("#agMsg"), btn = e.submitter || $("#agForm button");
    const no = Number(($("#agNo").value || "").replace(/\D/g, ""));
    if (!no) { msg.className = "note err"; msg.textContent = L("ID নম্বর দিন", "Enter your ID"); return; }
    btn.disabled = true; msg.className = "note"; msg.textContent = L("পাঠানো হচ্ছে…", "Sending…");
    try {
      const r = await fetch(`${CFG.SUPABASE_URL}/rest/v1/rpc/agent_web_apply`, { method: "POST", headers: { apikey: CFG.SUPABASE_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ p_user_no: no, p_name: $("#agName").value, p_phone: $("#agPhone").value, p_area: $("#agArea").value, p_plan: $("#agPlan").value }) });
      const j = await r.json();
      if (!r.ok) { const k = Object.keys(AG_ERR).find((x) => String(j.message || "").includes(x)); throw new Error(k ? L(...AG_ERR[k]) : L("পাঠানো যায়নি — আবার চেষ্টা করুন", "Couldn't send — please try again")); }
      msg.className = "note ok";
      msg.textContent = j === "already_agent" ? L("আপনি আগে থেকেই এজেন্ট — অ্যাপে এজেন্ট পেজ দেখুন", "You're already an agent — see the Agent page in the app")
        : j === "already_pending" ? L("আপনার আবেদন আগেই জমা আছে, যাচাই চলছে", "Your application is already in and being checked")
        : L("✅ আবেদন জমা হয়েছে! অ্যাডমিন যাচাই করে অনুমোদন দিলে অ্যাপে নোটিফিকেশন পাবেন।", "✅ Application sent! You'll get a notification in the app once the admin approves it.");
      if (j === "ok") $("#agForm").reset();
    } catch (er) { msg.className = "note err"; msg.textContent = er.message; }
    btn.disabled = false;
  };
  applyLang();
  load();
})();
