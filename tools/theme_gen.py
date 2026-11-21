"""app.css / site.css থেকে ডার্ক থিমের CSS বানায় (html[data-theme="dark"] ...)। পুনরায় চালালে নতুন করে লেখে।
ব্যবহার: python3 tools/theme_gen.py app/app.css app/theme-dark.css [--skip=.full,.lv-]"""
import re, sys, colorsys
SRC, OUT = sys.argv[1], sys.argv[2]
SKIP = []
for a in sys.argv[3:]:
    if a.startswith("--skip="): SKIP = [x for x in a[7:].split(",") if x]
PFX = 'html[data-theme="dark"]'
BG = (16, 13, 28)   # #100d1c
COL = re.compile(r'#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|\bwhite\b')
def parse(c):
    c = c.strip()
    if c == "white": return (255, 255, 255, 1)
    if c.startswith("#"):
        h = c[1:]
        if len(h) in (3, 4): h = "".join(x * 2 for x in h)
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
        a = int(h[6:8], 16) / 255 if len(h) == 8 else 1
        return (r, g, b, a)
    m = re.findall(r'[\d.]+%?', c)
    v = [float(x.rstrip('%')) for x in m]
    if len(v) < 3: return None
    return (v[0], v[1], v[2], v[3] if len(v) > 3 else 1)
def lum(r, g, b):
    f = lambda v: (v / 255) / 12.92 if v / 255 <= .03928 else (((v / 255) + .055) / 1.055) ** 2.4
    return .2126 * f(r) + .7152 * f(g) + .0722 * f(b)
def fmt(r, g, b, a=1):
    return f"rgba({int(r)},{int(g)},{int(b)},{round(a,3)})" if a < 1 else f"#{int(r):02x}{int(g):02x}{int(b):02x}"
def dark_surface(c):
    r, g, b, a = c
    if lum(r, g, b) > .93 and max(r, g, b) - min(r, g, b) < 12:
        return "var(--panel)" if a >= .99 else fmt(255, 255, 255, a * .08)
    # রঙিন হালকা টিন্ট → একই রঙের গাঢ় ভার্সন
    h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
    r2, g2, b2 = colorsys.hls_to_rgb(h, .16, min(s, .55))
    return fmt(r2 * 255, g2 * 255, b2 * 255, a)
def light_text(c):
    r, g, b, a = c
    h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
    if s < .18: return "var(--text)" if l < .3 else "var(--muted)"
    r2, g2, b2 = colorsys.hls_to_rgb(h, .76, min(1, s))
    return fmt(r2 * 255, g2 * 255, b2 * 255, a)
def map_bg(val):
    cols = COL.findall(val)
    if not cols: return None
    pc = [parse(x) for x in cols]
    if any(p is None for p in pc): return None
    if "url(" in val: return None
    light = [p for p in pc if lum(*p[:3]) > .6 and p[3] > .3]
    if not light: return None
    if "gradient" in val and len(light) < len(pc) - sum(1 for p in pc if p[3] < .05): return None   # রঙিন গ্রেডিয়েন্ট (ব্যান্ড ইত্যাদি) থাকুক
    return COL.sub(lambda m: dark_surface(parse(m.group())) if (lambda p: p and lum(*p[:3]) > .6 and p[3] > .3)(parse(m.group())) else m.group(), val)
def map_color(val):
    cols = COL.findall(val)
    if len(cols) != 1: return None
    p = parse(cols[0])
    if not p or lum(*p[:3]) > .35: return None
    return COL.sub(lambda m: light_text(parse(m.group())), val)
def map_border(val):
    def f(m):
        p = parse(m.group())
        return "var(--line)" if p and lum(*p[:3]) > .6 else m.group()
    nv = COL.sub(f, val)
    return nv if nv != val else None
def convert(sel, body):
    out = []
    for d in body.split(";"):
        if ":" not in d: continue
        k, v = d.split(":", 1); k = k.strip().lower(); v = v.strip()
        imp = " !important" if "!important" in v else ""
        v = v.replace("!important", "").strip()
        nv = None
        if k in ("background", "background-color"): nv = map_bg(v)
        elif k in ("color", "-webkit-text-fill-color") and "transparent" not in v: nv = map_color(v)
        elif k.startswith("border") and "radius" not in k and "width" not in k and "style" not in k: nv = map_border(v)
        elif k == "fill" or k == "stroke": nv = None
        if nv: out.append(f"{k}: {nv}{imp}")
    if not out: return ""
    sels = []
    for s in sel.split(","):
        s = s.strip()
        if not s or s.startswith(":root") or s.startswith("html"): continue
        if any(x in s for x in SKIP): continue
        sels.append(f"{PFX} {s}")
    return (", ".join(sels) + " { " + "; ".join(out) + " }") if sels else ""
css = open(SRC, encoding="utf8").read()
css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
res = []
i = 0
def block(text):
    out, i = [], 0
    while i < len(text):
        j = text.find("{", i)
        if j < 0: break
        head = text[i:j].strip()
        if head.startswith("@keyframes") or head.startswith("@font-face"):
            depth, k = 1, j + 1
            while depth and k < len(text):
                depth += {"{": 1, "}": -1}.get(text[k], 0); k += 1
            i = k; continue
        if head.startswith("@media") or head.startswith("@supports"):
            depth, k = 1, j + 1
            while depth and k < len(text):
                depth += {"{": 1, "}": -1}.get(text[k], 0); k += 1
            inner = block(text[j + 1:k - 1])
            if inner: out.append(head + " { " + "\n".join(inner) + " }")
            i = k; continue
        k = text.find("}", j)
        r = convert(head, text[j + 1:k])
        if r: out.append(r)
        i = k + 1
    return out
res = block(css)
open(OUT, "w", encoding="utf8").write("/* স্বয়ংক্রিয়ভাবে তৈরি — tools/theme_gen.py */\n" + "\n".join(res) + "\n")
print(len(res), "rules")
