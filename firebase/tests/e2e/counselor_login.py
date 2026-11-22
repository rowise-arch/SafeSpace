# Browser end-to-end test for the counselor login (needs Python + playwright + Chrome).
# 1) cd firebase && npx firebase emulators:start --only auth,database,functions --project demo-safespace
# 2) cd <repo root> && python -m http.server 8090 --bind 127.0.0.1  (set COUNSELOR_BASE=http://127.0.0.1:8090/apps/counselor/pages/)
# 3) python firebase/tests/e2e/counselor_login.py
import os
import json, time, urllib.request, sys
from playwright.sync_api import sync_playwright

AUTH = 'http://127.0.0.1:9099'
DB = 'http://127.0.0.1:9000'
NS = 'demo-safespace-default-rtdb'
PW = 'Sup3r-secret!'
BASE = os.environ.get('COUNSELOR_BASE', 'http://127.0.0.1:8080/pages/') + 'login.html?emulator=1'


def req(url, body=None, method=None, headers=None):
    h = {'Content-Type': 'application/json', 'Authorization': 'Bearer owner'}
    h.update(headers or {})
    r = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, headers=h, method=method)
    with urllib.request.urlopen(r) as resp:
        raw = resp.read()
        return json.loads(raw) if raw else None


def make_user(email, role):
    u = req(f'{AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake', {'email': email, 'password': PW})
    req(f'{AUTH}/identitytoolkit.googleapis.com/v1/projects/demo-safespace/accounts:update',
        {'localId': u['localId'], 'customAttributes': json.dumps({'role': role})})
    return u['localId']


def outbox_code(to, since):
    for _ in range(30):
        data = req(f'{DB}/_dev_outbox.json?ns={NS}') or {}
        mails = [m for m in data.values() if m['to'] == to and m['at'] >= since]
        if mails:
            import re
            return re.search(r'\b(\d{6})\b', mails[-1]['text']).group(1)
        time.sleep(0.5)
    raise SystemExit('no email arrived for ' + to)


stamp = int(time.time())
cou = f'cou{stamp}@example.com'
stu = f'stu{stamp}@example.com'
cou_uid = make_user(cou, 'counselor')
make_user(stu, 'student')
req(f'{DB}/counselors/{cou_uid}.json?ns={NS}', {'uid': cou_uid, 'email_address': cou, 'first_name': 'Test', 'last_name': 'Counselor', 'login_access': True, 'status': 'Active'}, method='PUT')
req(f'{DB}/config/loginEnabled.json?ns={NS}', True, method='PUT')

results = []


def check(name, cond, extra=''):
    results.append((name, bool(cond), extra))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{extra}]' if extra and not cond else ''))


with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', headless=True)

    def fresh():
        ctx = browser.new_context()
        page = ctx.new_page()
        page.on('pageerror', lambda e: print('  pageerror:', str(e)[:200]))
        return ctx, page

    def sign_in(page, email, password):
        page.goto(BASE)
        page.wait_for_selector('#email')
        page.fill('#email', email)
        page.fill('#password', password)
        page.click('#signinBtn')

    # 1. wrong password
    ctx, page = fresh()
    sign_in(page, cou, 'not-the-password')
    page.wait_for_function("document.getElementById('loginStatus').textContent.includes('Incorrect')", timeout=15000)
    check('wrong password shows generic error', 'Incorrect email or password' in page.inner_text('#loginStatus'))
    check('2FA modal not shown after wrong password', 'active' not in (page.get_attribute('#twoFAModal', 'class') or ''))
    ctx.close()

    # 2. non-counselor account is turned away
    ctx, page = fresh()
    sign_in(page, stu, PW)
    page.wait_for_function("document.getElementById('loginStatus').textContent.includes('Only counselor')", timeout=15000)
    check('student account rejected on counselor login', True)
    check('student is signed out again', page.evaluate("window.firebaseAuth && window.firebaseAuth.currentUser === null"))
    ctx.close()

    # 3. counselor: password -> modal -> wrong code -> right code -> app
    ctx, page = fresh()
    t0 = int(time.time() * 1000) - 2000
    sign_in(page, cou, PW)
    page.wait_for_selector('#twoFAModal.active', timeout=20000)
    check('2FA modal opens after correct password', True)
    status = page.inner_text('#loginStatus')
    check('status never reveals a code', not any(ch.isdigit() for ch in status.replace(cou, '')), status)
    code = outbox_code(cou, t0)

    wrong = '000000' if code != '000000' else '111111'
    for i, d in enumerate(wrong):
        page.locator('.verification-input').nth(i).fill(d)
    page.click('#twoFAVerify')
    page.wait_for_function("document.getElementById('twoFAError').style.display === 'block'", timeout=15000)
    check('wrong code rejected', 'Incorrect code' in page.inner_text('#twoFAError'), page.inner_text('#twoFAError'))
    check('still on login page after wrong code', 'login.html' in page.url)

    for i, d in enumerate(code):
        page.locator('.verification-input').nth(i).fill(d)
    page.click('#twoFAVerify')
    page.wait_for_url('**/pages/index.html**', timeout=30000)
    check('correct code redirects to the counselor dashboard', True)
    time.sleep(4)
    check('dashboard keeps the session (not bounced back to login)', 'index.html' in page.url, page.url)
    claims = page.evaluate("window.firebaseAuth.currentUser.getIdTokenResult().then(t => ({role: t.claims.role, twofa: t.claims.twofa_until}))")
    check('token carries role and twofa_until', claims['role'] == 'counselor' and claims['twofa'] > time.time() * 1000, str(claims))

    # 4. a counselor session without 2FA cannot use the app: open dashboard directly after clearing the stamp
    ctx.close()
    ctx, page = fresh()
    sign_in(page, cou, PW)
    page.wait_for_selector('#twoFAModal.active', timeout=20000)
    page.goto(os.environ.get('COUNSELOR_BASE', 'http://127.0.0.1:8080/pages/') + 'index.html')
    page.wait_for_url('**/login.html**', timeout=20000)
    check('dashboard redirects to login when 2FA is not completed', True)
    ctx.close()

    browser.close()

failed = [r for r in results if not r[1]]
print(f'\n{len(results) - len(failed)}/{len(results)} checks passed')
sys.exit(1 if failed else 0)
