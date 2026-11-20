// নীতিমালা পেজ: এক ভাষা (বাংলা বা English), মিশ্র নয়
(function () {
  var L; try { L = localStorage.getItem("lang"); } catch (e) {}
  if (!L) L = /^bn/i.test(navigator.language || "") ? "bn" : "en";
  var pick = function (s) { var m = s.split(/\s+[·\/]\s+/); if (m.length < 2) return s; var bn = m[0], en = m.slice(1).join(" "); return L === "en" ? en : bn; };
  var bnD = function (d) { var M = { January: "জানুয়ারি", February: "ফেব্রুয়ারি", March: "মার্চ", April: "এপ্রিল", May: "মে", June: "জুন", July: "জুলাই", August: "আগস্ট", September: "সেপ্টেম্বর", October: "অক্টোবর", November: "নভেম্বর", December: "ডিসেম্বর" };
    return d.replace(/[A-Za-z]+/, function (m) { return M[m] || m; }).replace(/\d/g, function (x) { return "০১২৩৪৫৬৭৮৯"[x]; }); };
  function apply() {
    document.documentElement.lang = L;
    document.querySelectorAll("header h1, header .u, nav.all a, main li > a, #data h2").forEach(function (el) {
      if (!el.dataset.o) el.dataset.o = el.textContent; var o = el.dataset.o;
      if (el.matches("header .u") && o.indexOf(":") > -1 && o.indexOf("/") > -1) { var d = (o.match(/\d+ \w+ \d{4}/) || [""])[0]; el.textContent = L === "en" ? "Last updated: " + d : "সর্বশেষ হালনাগাদ: " + bnD(d); }
      else el.textContent = pick(o);
    });
    if (!document.body.dataset.t) document.body.dataset.t = document.title; document.title = pick(document.body.dataset.t.replace(/ — Reels Enjoy$/, "")) + " — Reels Enjoy";
    ["bn", "en"].forEach(function (k) { var s = document.getElementById(k); if (s) s.style.display = k === L ? "" : "none"; });
    document.querySelectorAll("#data [lang]").forEach(function (el) { el.style.display = el.getAttribute("lang") === L ? "" : "none"; });
    document.querySelectorAll(".sw a").forEach(function (a) { a.style.opacity = a.getAttribute("href") === "#" + L ? "1" : ".55"; });
  }
  document.querySelectorAll(".sw a").forEach(function (a) {
    a.addEventListener("click", function (e) { e.preventDefault(); L = a.getAttribute("href").slice(1); try { localStorage.setItem("lang", L); } catch (x) {} apply(); });
  });
  apply();
})();
