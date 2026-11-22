# Browser end-to-end test for the admin app: sign-in with 2FA, student table, login toggle, invitations.
# Start first: emulators (auth,database,functions) and `python -m http.server 8082 --bind 127.0.0.1` in apps/admin.
import json, re, sys, time, urllib.request
from playwright.sync_api import sync_playwright

AUTH = 'http://127.0.0.1:9099'; DB = 'http://127.0.0.1:9000'; NS = 'demo-safespace-default-rtdb'; PW = 'Sup3r-secret!'
BASE = 'http://127.0.0.1:8082/pages/'; EMU = '?emulator=1'


def req(url, body=None, method=None):
    h = {'Content-Type': 'application/json', 'Authorization': 'Bearer owner'}
    r = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, headers=h, method=method)
    with urllib.request.urlopen(r) as resp:
        raw = resp.read(); return json.loads(raw) if raw else None


def db_get(path):
    return req(f'{DB}/{path}.json?ns={NS}')


def make_user(email, role):
    u = req(f'{AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake', {'email': email, 'password': PW})
    req(f'{AUTH}/identitytoolkit.googleapis.com/v1/projects/demo-safespace/accounts:update', {'localId': u['localId'], 'customAttributes': json.dumps({'role': role})})
    return u['localId']


def auth_disabled(uid):
    r = req(f'{AUTH}/identitytoolkit.googleapis.com/v1/projects/demo-safespace/accounts:lookup', {'localId': [uid]})
    return bool(r['users'][0].get('disabled'))


def outbox_code(to, since):
    for _ in range(40):
        data = db_get('_dev_outbox') or {}
        mails = sorted([m for m in data.values() if m['to'] == to and m['at'] >= since], key=lambda m: m['at'])
        if mails:
            m = re.search(r'\b(\d{6})\b', mails[-1]['text'])
            return m.group(1) if m else mails[-1]
        time.sleep(0.5)
    raise SystemExit('no email for ' + to)


t = int(time.time())
adm, stu, pend = f'adm{t}@example.com', f'stu{t}@example.com', f'pend{t}@example.com'
adm_uid, stu_uid = make_user(adm, 'admin'), make_user(stu, 'student')
act_id, pend_id = f'A-{t}', f'P-{t}'
req(f'{DB}/students/{act_id}.json?ns={NS}', {'uid': stu_uid, 'student_id': act_id, 'email_address': stu, 'first_name': 'Active', 'last_name': 'Student', 'login': 'Enable', 'status': 2}, method='PUT')
cou = f'cou{t}@example.com'
cou_uid = make_user(cou, 'counselor')
req(f'{DB}/counselors/007.json?ns={NS}', {'uid': cou_uid, 'counselor_id': '007', 'email_address': cou, 'first_name': 'Old', 'last_name': 'Keyed', 'login': 'Enable', 'login_access': True, 'status': 'Active'}, method='PUT')
for i, st in enumerate(['completed', 'completed', 'pending']):
    req(f'{DB}/appointments_by_counselor/{cou_uid}/ap{i}.json?ns={NS}', {'student_uid': stu_uid, 'counselor_uid': cou_uid, 'status': st, 'date': '2026-01-0%d' % (i + 1)}, method='PUT')
req(f'{DB}/Session_report/{stu_uid}/case1/sessions/s1.json?ns={NS}', {'student_name': 'Active Student', 'personel_name': 'Old Keyed', 'session_number': 1, 'status': 'Completed', 'date': 1767225600000}, method='PUT')
req(f'{DB}/psych_tests/{act_id}/t1.json?ns={NS}', {'title': 'Test One'}, method='PUT')
req(f'{DB}/roster/{pend_id}.json?ns={NS}', {'student_id': pend_id, 'email_address': pend, 'first_name': 'Pending', 'last_name': 'Roster', 'status': 0}, method='PUT')

results = []


def check(name, cond, extra=''):
    results.append(bool(cond)); print(('PASS ' if cond else 'FAIL ') + name + (f'  [{extra}]' if extra and not cond else ''))


with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)
    ctx = b.new_context()
    page = ctx.new_page()
    alerts = []
    def on_dialog(d):
        alerts.append(d.message)
        try: d.accept()
        except Exception: pass
    page.on('dialog', on_dialog)
    page.on('pageerror', lambda e: print('  pageerror:', str(e)[:160]))

    # 1. a student account cannot use the admin login
    page.goto(BASE + 'login.html' + EMU)
    page.fill('#email', stu); page.fill('#password', PW); page.click('#signinBtn')
    for _ in range(40):  # page.wait_for_timeout (not time.sleep) lets Playwright deliver the dialog event
        if alerts: break
        page.wait_for_timeout(500)
    check('student cannot sign in to the admin app', any('not an admin' in a for a in alerts), str(alerts))

    # 2. admin: password -> emailed code -> dashboard
    page.goto(BASE + 'login.html' + EMU)
    t0 = int(time.time() * 1000) - 2000
    page.fill('#email', adm); page.fill('#password', PW); page.click('#signinBtn')
    page.wait_for_selector('#ss2faModal', timeout=30000)
    page.wait_for_selector('#ss2faStep2', state='visible', timeout=20000)
    code = outbox_code(adm, t0)
    wrong = '000000' if code != '000000' else '111111'
    page.fill('#ss2faCode', wrong); page.click('#ss2faVerify')
    page.wait_for_function("document.getElementById('ss2faErr').textContent.length > 0", timeout=20000)
    check('wrong code is rejected', 'Incorrect code' in page.inner_text('#ss2faErr'))
    page.fill('#ss2faCode', code); page.click('#ss2faVerify')
    page.wait_for_url('**/dashboard.html**', timeout=30000)
    time.sleep(4)
    check('correct code reaches the dashboard and the session holds', 'dashboard.html' in page.url, page.url)

    # 3. student table shows activated and not-yet-activated students
    page.goto(BASE + 'user-management.html' + EMU)
    page.wait_for_selector(f'tr[data-id="{act_id}"]', timeout=30000)
    check('activated student is listed', True)
    check('imported (roster) student is listed too', page.locator(f'tr[data-id="{pend_id}"]').count() == 1)
    check('login switch is disabled for a student who has not activated', page.locator(f'tr[data-id="{pend_id}"] .login-switch').is_disabled())

    # 4. login toggle disables the Firebase account
    page.evaluate(f"document.querySelector('tr[data-id=\"{act_id}\"] .login-switch').click()")
    for _ in range(30):
        if auth_disabled(stu_uid): break
        time.sleep(0.5)
    check('turning login off disables the account in Firebase Auth', auth_disabled(stu_uid))
    check('record mirrors it', (db_get(f'students/{act_id}/login')) == 'Disable')

    # 5. invitations are generated and emailed by the server
    t1 = int(time.time() * 1000) - 2000
    page.evaluate("document.getElementById('massEmail').click()")
    page.wait_for_selector('#confirmSendVerification', state='visible', timeout=10000)
    page.click('#confirmSendVerification')
    for _ in range(40):
        r = db_get(f'roster/{pend_id}') or {}
        if r.get('status') == 1: break
        time.sleep(0.5)
    r = db_get(f'roster/{pend_id}') or {}
    check('roster entry invited (status 1, code set on the server)', r.get('status') == 1 and bool(r.get('activation_code')), str(r))
    mail = outbox_code(pend, t1)
    check('invitation email was sent', mail is not None)
    check('activation code is not shown in the admin page', r.get('activation_code', 'x') not in page.inner_text('body'))

    # 4b. deleting an activated student removes the Firebase login too
    page.goto(BASE + 'user-management.html' + EMU)
    page.wait_for_selector(f'tr[data-id="{act_id}"]', timeout=30000)
    page.locator(f'tr[data-id="{act_id}"] .delete').click()
    page.wait_for_selector('#confirmModalYes', state='visible', timeout=10000)
    page.click('#confirmModalYes')
    gone = False
    for _ in range(30):
        users = req(f'{AUTH}/identitytoolkit.googleapis.com/v1/projects/demo-safespace/accounts:lookup', {'localId': [stu_uid]}).get('users')
        if not users:
            gone = True
            break
        page.wait_for_timeout(500)
    check('deleting a student also deletes their Firebase login', gone)
    check('student record removed', db_get(f'students/{act_id}') is None)

    # 5b. counselor management: legacy-keyed counselor is listed; the login toggle goes through the server
    page.goto(BASE + 'counselor-management.html' + EMU)
    page.wait_for_selector('tr[data-id="007"]', timeout=30000)
    check('counselor-management lists the counselor', True)
    page.evaluate("document.querySelector('tr[data-id=\"007\"] .login-switch').click()")
    for _ in range(30):
        if auth_disabled(cou_uid): break
        page.wait_for_timeout(500)
    check('counselor login toggle disables the Firebase account', auth_disabled(cou_uid))
    check('counselor record mirrors it', db_get('counselors/007/login') == 'Disable')

    # 5c. dashboard totals, session reports, psych tests load for the admin without permission errors
    denied = []
    page.on('console', lambda m: denied.append(m.text[:120]) if 'permission_denied' in m.text.lower() else None)
    page.goto(BASE + 'dashboard.html' + EMU)
    page.wait_for_timeout(8000)
    cards = page.eval_on_selector_all('.summary-card', 'els => els.map(e => e.innerText)')
    check('dashboard counts 3 appointments (2 completed, 1 pending)', any(re.search(r'(^|\s)3(\s|$)', c) for c in cards), str(cards)[:200])
    page.goto(BASE + 'session-report.html' + EMU)
    page.wait_for_timeout(8000)
    check('session-report page lists the record', 'Active Student' in page.inner_text('body'))
    page.goto(BASE + 'psych-test.html' + EMU)
    page.wait_for_timeout(8000)
    check('psych-test page stays signed in', 'psych-test' in page.url, page.url)
    check('no permission errors on dashboard, session reports, psych tests', not denied, str(denied[:3]))

    # 6. closing the dialog on a fresh sign-in signs the admin out
    ctx2 = b.new_context(); p2 = ctx2.new_page(); p2.on('dialog', lambda d: d.accept())
    p2.goto(BASE + 'login.html' + EMU)
    p2.fill('#email', adm); p2.fill('#password', PW); p2.click('#signinBtn')
    p2.wait_for_selector('#ss2faModal', timeout=30000)
    probe = ctx2.new_page(); probe.on('dialog', lambda d: d.accept())
    probe.goto(BASE + 'user-management.html' + EMU)
    probe.wait_for_url('**/login.html**', timeout=30000)
    check('an admin session without the code is bounced to login', True)
    b.close()

print(f'\n{sum(results)}/{len(results)} checks passed')
sys.exit(0 if all(results) else 1)
