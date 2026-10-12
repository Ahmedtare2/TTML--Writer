"""Fail the build early if the page is broken: JavaScript syntax (needs node) and the placeholder."""
import os
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
page = open(os.path.join(ROOT, "app", "src", "main", "assets", "index.html"), encoding="utf-8").read()
if "__CORE_JS__" in page:
    sys.exit("core.js was not inlined: run python tools/build_assets.py")
scripts = re.findall(r"<script>(.*?)</script>", page, flags=re.S)
if not scripts:
    sys.exit("no inline script found in index.html")
node = shutil.which("node")
if not node:
    print("node not found: skipping the JavaScript syntax check")
    sys.exit(0)
bad = 0
for i, src in enumerate(scripts):
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as f:
        f.write(src)
    r = subprocess.run([node, "--check", f.name], capture_output=True, text=True)
    os.unlink(f.name)
    if r.returncode:
        bad += 1
        print(f"script {i}: syntax error\n{r.stderr}")
if bad:
    sys.exit(1)
print(f"{len(scripts)} script block(s) parse cleanly")
