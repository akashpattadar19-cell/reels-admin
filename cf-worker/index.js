// reelsenjoy.com: GitHub Pages থেকে ওয়েবসাইট দেখায় (অ্যাপ ও অ্যাডমিন github.io-তেই থাকে) — v2
const GH = "https://akashpattadar19-cell.github.io/reels-admin";
const KEEP = ["get", "v", "policy", "download", "site"];

export default {
  async fetch(req) {
    const u = new URL(req.url);
    if (u.hostname.startsWith("www.")) {
      u.hostname = u.hostname.slice(4);
      return Response.redirect(u.toString(), 301);
    }
    const top = u.pathname.split("/")[1];
    const path = KEEP.includes(top) ? u.pathname : "/site" + u.pathname;
    const r = await fetch(GH + path + u.search, { redirect: "manual" });
    if (r.status >= 300 && r.status < 400) {
      let loc = (r.headers.get("Location") || "/").replace(GH, "https://" + u.host);
      if (!KEEP.includes(top)) loc = loc.replace("/site/", "/");
      return Response.redirect(loc, r.status);
    }
    return new Response(r.body, { status: r.status, headers: r.headers });
  },
};
