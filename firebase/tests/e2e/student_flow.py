# Browser end-to-end test for the student journey: activation -> sign-up -> sign-in -> enable 2FA -> sign-in with 2FA.
# Needs Python + playwright + Chrome. Start first:
#   1) cd firebase && npx firebase emulators:start --only auth,database,functions --project demo-safespace
#   2) cd <repo root> && python -m http.server 8090 --bind 127.0.0.1   (pages load ../../../shared/assets)
#      then set STUDENT_BASE=http://127.0.0.1:8090/apps/student/pages/
#   3) python firebase/tests/e2e/student_flow.py
import os, json, re, sys, time, urllib.request
from playwright.sync_api import sync_playwright

AUTH = 'http://127.0.0.1:9099'
DB = 'http://127.0.0.1:9000'
NS = 'demo-safespace-default-rtdb'
PW = 'Sup3r-secret!'
BASE = os.environ.get('STUDENT_BASE', 'http://127.0.0.1:8081/pages/')
EMU = '?emulator=1'


def req(url, body=None, method=None):
    h = {'Content-Type': 'application/json', 'Authorization': 'Bearer owner'}
    r = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, headers=h, method=method)
    with urllib.request.urlopen(r) as resp:
        raw = resp.read()
        return json.loads(raw) if raw else None


def db_get(path):
    return req(f'{DB}/{path}.json?ns={NS}')


def outbox_code(to, since):
    for _ in range(40):
        data = db_get('_dev_outbox') or {}
        mails = sorted([m for m in data.values() if m['to'] == to and m['at'] >= since], key=lambda m: m['at'])
        if mails:
            return re.search(r'\b(\d{6})\b', mails[-1]['text']).group(1)
        time.sleep(0.5)
    raise SystemExit('no email arrived for ' + to)


stamp = int(time.time())
sid = f'2026-{stamp}'
email = f'student{stamp}@example.com'
code = 'ABCD2345'
req(f'{DB}/roster/{sid}.json?ns={NS}', {
    'student_id': sid, 'email_address': email, 'first_name': 'Ana', 'last_name': 'Reyes',
    'status': 1, 'activation_code': code, 'expiry_date': int(time.time() * 1000) + 86400000, 'login': 'Enable'}, method='PUT')

results = []


def check(name, cond, extra=''):
    results.append(bool(cond))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{extra}]' if extra and not cond else ''))


def open_signin(page):
    """Sign out, then land on a clean sign-in page (pages redirect themselves after sign-out, so wait for that)."""
    page.evaluate("firebase.auth().signOut()")
    try:
        page.wait_for_url('**/signin.html**', timeout=5000)
    except Exception:
        page.goto(BASE + 'signin.html' + EMU)
    page.wait_for_load_state('load')
    if 'emulator' not in page.url and 'dev_use_emulators' not in (page.evaluate("localStorage.getItem('dev_use_emulators')") or ''):
        page.goto(BASE + 'signin.html' + EMU)
    page.wait_for_selector('#email')


def modal_text(page):
    page.wait_for_selector('#alertModal', timeout=20000)
    return page.inner_text('#alertModal')


with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', headless=True)
    ctx = browser.new_context()
    page = ctx.new_page()
    page.on('pageerror', lambda e: print('  pageerror:', str(e)[:160]))
    page.on('dialog', lambda d: d.accept())  # some pages alert() before redirecting

    # ---- 1. verify: wrong code, then right code
    page.goto(BASE + 'verify.html' + EMU)
    page.fill('#studentId', sid); page.fill('#email', email); page.fill('#lastname', 'Reyes'); page.fill('#code', 'WRONG123')
    page.click('#verifyBtn')
    check('wrong activation code -> generic message', 'No valid match' in modal_text(page))
    page.click('#modalOkBtn')
    page.fill('#code', code.lower())
    page.click('#verifyBtn')
    page.wait_for_url('**/signup.html**', timeout=20000)
    check('verify passes and moves to signup without exposing details in the URL', 'key=' not in page.url and sid not in page.url, page.url)

    # ---- 2. signup
    page.fill('#username', 'ana'); page.select_option('#gender', index=1)
    page.fill('#password', 'short'); page.fill('#confirmPassword', 'short')
    page.check('#consentCheck')  # required Data Privacy consent
    page.click('#signupBtn')
    check('short password rejected by the server', 'at least 8' in modal_text(page), modal_text(page))
    page.click('#modalOkBtn')
    page.fill('#password', PW); page.fill('#confirmPassword', PW)
    page.click('#signupBtn')
    check('signup succeeds', 'Signup successful' in modal_text(page))
    page.click('#modalOkBtn')
    page.wait_for_url('**/complete-profile.html**', timeout=20000)
    uid = None
    stu = None
    for k, v in (db_get('students') or {}).items():
        if v.get('email_address') == email:
            stu, uid = v, k
    check('student record created under their uid with no activation code', stu is not None and stu.get('uid') == uid and 'activation_code' not in stu, str(stu))
    check('roster entry marked activated and code wiped', (db_get(f'roster/{sid}') or {}).get('status') == 2 and 'activation_code' not in (db_get(f'roster/{sid}') or {}))

    # replaying the same activation is refused
    page2 = ctx.new_page()
    page2.goto(BASE + 'verify.html' + EMU)
    page2.fill('#studentId', sid); page2.fill('#email', email); page2.fill('#lastname', 'Reyes'); page2.fill('#code', code)
    page2.click('#verifyBtn')
    check('activation code cannot be reused', 'No valid match' in modal_text(page2) or 'already verified' in modal_text(page2))
    page2.close()

    # ---- 3. sign out, sign in (no 2FA yet)
    open_signin(page)
    page.fill('#email', email); page.fill('#password', 'wrong-password')
    page.click('#signinBtn')
    check('wrong password -> generic error', 'Incorrect Email or Password' in modal_text(page))
    page.click('#modalOkBtn')
    page.fill('#password', PW)
    page.click('#signinBtn')
    page.wait_for_url('**/pages/index.html**', timeout=30000)
    time.sleep(4)
    check('signed in without 2FA lands on the dashboard and stays', 'index.html' in page.url, page.url)

    # ---- 4. enable 2FA in settings (needs an emailed code first)
    t0 = int(time.time() * 1000) - 2000
    page.goto(BASE + 'settings.html' + EMU)
    page.wait_for_selector('#email2FA', state='attached')
    page.evaluate("document.getElementById('email2FA').click()")
    page.wait_for_selector('#confirmTwoFAConfirm', state='visible', timeout=20000)
    page.click('#confirmTwoFAConfirm')
    page.wait_for_selector('#ss2faModal', timeout=20000)
    page.click('#ss2faSend')
    page.wait_for_selector('#ss2faStep2', state='visible', timeout=20000)
    c1 = outbox_code(email, t0)
    page.fill('#ss2faCode', '000000' if c1 != '000000' else '111111')
    page.click('#ss2faVerify')
    page.wait_for_function("document.getElementById('ss2faErr').textContent.length > 0", timeout=20000)
    check('wrong code rejected in the 2FA dialog', 'Incorrect code' in page.inner_text('#ss2faErr'))
    page.fill('#ss2faCode', c1)
    page.click('#ss2faVerify')
    page.wait_for_selector('#ss2faModal', state='detached', timeout=20000)
    claims = {}
    for _ in range(30):  # setTwoFactor runs right after the dialog closes; poll instead of guessing a delay
        claims = page.evaluate("firebase.auth().currentUser.getIdTokenResult(true).then(t => t.claims)")
        if claims.get('mfa_required') is True:
            break
        time.sleep(0.5)
    check('mfa_required claim is set on the account', claims.get('mfa_required') is True, str(claims))
    mirrored = None
    for _ in range(20):  # the database mirror is written just after the claim
        mirrored = db_get(f'students/{uid}/email2FA')
        if mirrored is True:
            break
        time.sleep(0.5)
    check('students/{uid}/email2FA mirrors it', mirrored is True)

    # ---- 5. new sign-in now requires the code
    open_signin(page)
    t1 = int(time.time() * 1000) - 2000
    page.fill('#email', email); page.fill('#password', PW)
    page.click('#signinBtn')
    page.wait_for_selector('#ss2faModal', timeout=30000)
    check('2FA dialog appears after password sign-in', True)
    page.wait_for_selector('#ss2faStep2', state='visible', timeout=20000)
    c2 = outbox_code(email, t1)
    # until the code is entered the dashboard must not accept the session
    probe = ctx.new_page()
    probe.goto(BASE + 'index.html' + EMU)
    probe.wait_for_url('**/signin.html**', timeout=30000)
    check('dashboard bounces a session that has not passed 2FA', True)
    probe.close()
    page.fill('#ss2faCode', c2)
    page.click('#ss2faVerify')
    page.wait_for_url('**/pages/index.html**', timeout=30000)
    time.sleep(4)
    check('correct code reaches the dashboard and the session holds', 'index.html' in page.url, page.url)

    # ---- 6. closing the dialog abandons the sign-in
    open_signin(page)
    page.fill('#email', email); page.fill('#password', PW)
    page.click('#signinBtn')
    page.wait_for_selector('#ss2faModal', timeout=30000)
    page.click('#ss2faClose')
    check('closing the 2FA dialog signs the user out', 'cancelled' in modal_text(page).lower() and page.evaluate("firebase.auth().currentUser === null"))

    browser.close()

print(f'\n{sum(results)}/{len(results)} checks passed')
sys.exit(0 if all(results) else 1)
