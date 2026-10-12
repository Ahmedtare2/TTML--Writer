"""Inline web/core.js into web/editor.html and write app/src/main/assets/index.html (the page the app shows).

Run by the GitHub workflow before every build; run it yourself after editing anything in web/:
    python tools/build_assets.py
"""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
MARK = "/*__CORE_JS__*/"


def build():
    with open(os.path.join(ROOT, "web", "editor.html"), encoding="utf-8") as f:
        html = f.read()
    with open(os.path.join(ROOT, "web", "core.js"), encoding="utf-8") as f:
        core = f.read().replace("</script>", "<\\/script>")
    if MARK not in html:
        sys.exit("web/editor.html has no " + MARK + " placeholder")
    return html.replace(MARK, core)


if __name__ == "__main__":
    out = os.path.join(ROOT, "app", "src", "main", "assets", "index.html")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    page = build()
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        f.write(page)
    print(f"wrote {os.path.relpath(out, ROOT)} ({len(page) // 1024} KB)")
