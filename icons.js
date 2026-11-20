// UI-র ইমোজি → লাইন আইকন (অ্যাডমিন)। i18n.js-এর পরে লোড হয়, তাই আগে অনুবাদ, পরে আইকন।
(function () {
  var EICON = {"🪙": "coin", "✅": "check", "✔": "tick", "🎁": "gift", "👑": "crown", "🎬": "video", "❤": "heart", "🤍": "heart", "💖": "heart", "💜": "heart", "💛": "heart", "🧡": "heart", "📞": "phone", "💬": "chat", "⏳": "clock", "⌛": "clock", "⏱": "clock", "⏰": "clock", "🎉": "party", "🏆": "trophy", "⭐": "star", "🧑‍💼": "brief", "💼": "brief", "💎": "gem", "🔒": "lock", "🔐": "lock", "🔓": "unlock", "🎤": "mic", "🎙": "mic", "📷": "camera", "💰": "money", "💸": "money", "🎵": "music", "🎶": "music", "🚀": "rocket", "✍": "pen", "✏": "pen", "🖋": "pen", "🗑": "trash", "📹": "videocam", "🎥": "videocam", "👁": "eye", "👀": "eye", "🎨": "palette", "🔥": "flame", "📢": "mega", "📣": "mega", "🖼": "image", "🔇": "mute", "🔊": "volume", "🤝": "users", "⚔": "swords", "📲": "mobile", "📱": "mobile", "📖": "book", "❌": "xcircle", "🚫": "ban", "📵": "ban", "⚠": "alert", "✨": "sparkle", "⬇": "down", "⬆": "up", "🔔": "bell", "🙋": "hand", "🌐": "globe", "👥": "users", "👤": "user", "👨": "user", "👩": "user", "🧒": "user", "📋": "clip", "📜": "clip", "🧾": "clip", "📄": "clip", "🎯": "target", "📅": "cal", "📊": "grid", "📈": "chart", "✂": "scissors", "🎧": "headset", "📍": "pin", "📌": "pin", "📤": "share", "🔁": "refresh", "🔄": "refresh", "💡": "bulb", "📎": "clip", "🏠": "home", "🚪": "logout", "🎟": "ticket", "🏁": "flag", "👉": "arrow", "📁": "folder", "💌": "mail", "⏸": "pause", "🪑": "seat", "✈": "plane", "☀": "sun", "📦": "box", "🎭": "theater", "📺": "tv", "💳": "card", "⚙": "gear", "🛡": "shield", "☁": "cloud", "🔎": "search", "🔍": "search", "#️⃣": "hash", "📉": "chart", "↗": "share", "📸": "camera", "🔗": "share", "🎂": "party", "🏅": "trophy", "🌙": "moon"};
  var keys = Object.keys(EICON).sort(function (a, b) { return b.length - a.length; }).map(function (k) { return k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); });
  var ERX = new RegExp("(" + keys.join("|") + ")\uFE0F?", "g"), ETEST = new RegExp(keys.join("|"));
  var SKIP = '[translate="no"],input,textarea,select,option,script,style,.noicon,.vcard .cap,.sup,.gift-e';
  function txt(t) {
    var v = t.nodeValue, el = t.parentElement;
    if (!v || !ETEST.test(v) || !el || el.closest(SKIP)) return;
    var f = document.createDocumentFragment(), last = 0;
    v.replace(ERX, function (m, k, off) {
      if (off > last) f.appendChild(document.createTextNode(v.slice(last, off)));
      var i = document.createElement("i-c"); i.className = EICON[k] === "coin" ? "coin" : "ei ei-" + EICON[k]; i.setAttribute("aria-hidden", "true"); f.appendChild(i);
      last = off + m.length; return m;
    });
    if (last < v.length) f.appendChild(document.createTextNode(v.slice(last)));
    t.replaceWith(f);
  }
  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) return txt(root);
    if (root.nodeType !== 1 || root.closest(SKIP)) return;
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), list = [], t;
    while ((t = w.nextNode())) if (ETEST.test(t.nodeValue)) list.push(t);
    list.forEach(txt);
  }
  function start() {
    walk(document.body);
    new MutationObserver(function (ms) { ms.forEach(function (m) { m.type === "characterData" ? txt(m.target) : m.addedNodes.forEach(walk); }); })
      .observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
})();
