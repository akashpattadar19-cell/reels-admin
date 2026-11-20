#!/usr/bin/env python3
"""Run before every push: adds ?v=<time> to the app/admin script & css links so phones load the new files at once."""
import re, time, pathlib
v = time.strftime("%Y%m%d%H%M")
root = pathlib.Path(__file__).resolve().parent.parent
for f in ["index.html", "app/index.html", "site/index.html"]:
    p = root / f
    s = p.read_text()
    s = re.sub(r'((?:src|href)="(?:\.\./)?(?:i18n-admin|i18n|config|app|style|site|icons)\.(?:js|css))(\?v=\w+)?"', rf'\1?v={v}"', s)
    p.write_text(s)
print("stamped", v)
