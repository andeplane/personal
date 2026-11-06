"""Set and verify no-index metadata on the final GitHub Pages HTML artifact.

Run after model/build validation: only publication metadata changes, with no
changes to the tracked geometry sources or their recorded fingerprints.
"""

from html.parser import HTMLParser
from pathlib import Path
import re
import sys

DIRECTIVES = "noindex, nofollow, noarchive"


class RobotsTags(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags = {}

    def handle_starttag(self, tag, attrs):
        if tag != "meta":
            return
        attrs = dict(attrs)
        name = (attrs.get("name") or "").lower()
        if name in {"robots", "googlebot"}:
            self.tags.setdefault(name, []).append(
                set(re.split(r"[\s,]+", (attrs.get("content") or "").lower()))
            )


def prepare(html):
    missing = []
    for name in ("robots", "googlebot"):
        meta = f'<meta name="{name}" content="{DIRECTIVES}">'
        pattern = rf'<meta\b(?=[^>]*\bname\s*=\s*[\"\x27]{name}[\"\x27])[^>]*>'
        if re.search(pattern, html, flags=re.I):
            html = re.sub(pattern, meta, html, flags=re.I)
        else:
            missing.append(meta)
    if missing:
        # Export tools and source fragments can use the HTML implicit head.
        head = re.search(r"<head\b[^>]*>", html, flags=re.I)
        doctype = re.search(r"<!doctype\b[^>]*>", html, flags=re.I)
        position = (head or doctype).end() if (head or doctype) else 0
        html = html[:position] + "\n" + "\n".join(missing) + "\n" + html[position:]
    return html


def main():
    if sys.argv[1:] not in ([], ["--check"]):
        print("Usage: python3 scripts/prepare-pages.py [--check]", file=sys.stderr)
        return 2
    check_only = sys.argv[1:] == ["--check"]
    root = Path(__file__).resolve().parents[1]
    pages = sorted(
        page for page in root.rglob("*.html")
        if ".git" not in page.relative_to(root).parts
    )
    problems = []
    for page in pages:
        html = page.read_text(encoding="utf-8")
        if not check_only:
            prepared = prepare(html)
            if prepared != html:
                page.write_text(prepared, encoding="utf-8")
            html = prepared
        parser = RobotsTags()
        parser.feed(html)
        for name in ("robots", "googlebot"):
            tags = parser.tags.get(name, [])
            if not tags or any("noindex" not in tokens for tokens in tags):
                problems.append(f"{page.relative_to(root)}: missing {name} noindex")
    if problems or not pages:
        print("\n".join(problems) or "No HTML pages found", file=sys.stderr)
        return 1
    print(f"Verified no-index metadata on {len(pages)} HTML pages.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
