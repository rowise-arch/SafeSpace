# Browser check for the shared UI baseline (shared/assets/css/safespace.css) on the three sign-in pages.
# Serve the REPO ROOT first (pages link ../../../shared/...):   python -m http.server 8090 --bind 127.0.0.1
# Then:  python shared/tests/ui_baseline.py
# No Firebase emulator is needed; nothing is submitted.
import re
import sys
import glob
import os
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:8090/apps/'
PAGES = {
    'student sign-in': ('student/pages/signin.html', '#email'),
    'counselor login': ('counselor/pages/login.html', '#email'),
    'admin login': ('admin/pages/login.html', '#email'),
}
results = []


def check(name, cond, extra=''):
    results.append(bool(cond))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{extra}]' if extra and not cond else ''))


# every real page links the stylesheet exactly once and does not block zoom (static check, all 38 pages)
root = os.path.join(os.path.dirname(__file__), '..', '..')
pages = [p for p in glob.glob(os.path.join(root, 'apps', '*', 'pages', '*.html')) if os.path.getsize(p) > 0]
bad_link = [os.path.basename(p) for p in pages if open(p, encoding='utf-8').read().count('shared/assets/css/safespace.css') != 1]
bad_zoom = [os.path.basename(p) for p in pages if re.search(r'user-scalable|maximum-scale', open(p, encoding='utf-8').read())]
no_viewport = [os.path.basename(p) for p in pages if 'name="viewport"' not in open(p, encoding='utf-8').read()]
check(f'all {len(pages)} pages link the shared stylesheet once', not bad_link, str(bad_link))
check('no page blocks pinch zoom', not bad_zoom, str(bad_zoom))
check('every page has a viewport meta', not no_viewport, str(no_viewport))

with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)
    for name, (path, field) in PAGES.items():
        ctx = b.new_context(reduced_motion='reduce')
        page = ctx.new_page()
        page.on('dialog', lambda d: d.accept())
        resp = page.goto(BASE + path, wait_until='load')
        check(f'{name}: page loads', resp and resp.ok, str(resp and resp.status))
        primary = page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--ss-primary').trim()")
        check(f'{name}: design tokens are available', primary == '#00723f', primary)

        # keyboard focus: tab until the email field has focus, then read its outline
        page.wait_for_selector(field)
        for _ in range(15):
            page.keyboard.press('Tab')
            if page.evaluate(f"document.activeElement === document.querySelector('{field}')"):
                break
        outline = page.evaluate(f"(() => {{ const s = getComputedStyle(document.querySelector('{field}')); return [s.outlineStyle, s.outlineWidth].join(' '); }})()")
        check(f'{name}: keyboard focus ring is visible', outline == 'solid 3px', outline)

        # reduced motion: no transition or animation longer than a blink
        slow = page.evaluate("""(() => {
            let n = 0;
            for (const el of document.querySelectorAll('*')) {
                const s = getComputedStyle(el);
                const longest = (v) => Math.max(0, ...v.split(',').map(x => parseFloat(x) * (x.includes('ms') ? 0.001 : 1) || 0));
                if (longest(s.transitionDuration) > 0.01 || longest(s.animationDuration) > 0.01) n++;
            }
            return n;
        })()""")
        check(f'{name}: reduced motion removes transitions and animations', slow == 0, f'{slow} elements still animate')
        ctx.close()
    b.close()

print(f'\n{sum(results)}/{len(results)} checks passed')
sys.exit(0 if all(results) else 1)
