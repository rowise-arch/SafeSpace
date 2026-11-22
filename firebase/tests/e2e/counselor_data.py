# Browser check: a signed-in (2FA-verified) counselor can load the pages that read consultations/appointments
# without permission errors, and sees only their own records.
# Start emulators + `python -m http.server 8080 --bind 127.0.0.1` in apps/counselor first (see counselor_login.py).
import os
import json, re, sys, time, urllib.request
from playwright.sync_api import sync_playwright

AUTH = 'http://127.0.0.1:9099'; DB = 'http://127.0.0.1:9000'; NS = 'demo-safespace-default-rtdb'; PW = 'Sup3r-secret!'
BASE = os.environ.get('COUNSELOR_BASE', 'http://127.0.0.1:8080/pages/'); EMU = '?emulator=1'


def req(url, body=None, method=None):
    h = {'Content-Type': 'application/json', 'Authorization': 'Bearer owner'}
    r = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, headers=h, method=method)
    with urllib.request.urlopen(r) as resp:
        raw = resp.read(); return json.loads(raw) if raw else None


def make_user(email, role):
    u = req(f'{AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake', {'email': email, 'password': PW})
    req(f'{AUTH}/identitytoolkit.googleapis.com/v1/projects/demo-safespace/accounts:update', {'localId': u['localId'], 'customAttributes': json.dumps({'role': role})})
    return u['localId']


def outbox_code(to, since):
    for _ in range(40):
        data = req(f'{DB}/_dev_outbox.json?ns={NS}') or {}
        mails = [m for m in data.values() if m['to'] == to and m['at'] >= since]
        if mails:
            return re.search(r'\b(\d{6})\b', mails[-1]['text']).group(1)
        time.sleep(0.5)
    raise SystemExit('no email for ' + to)


t = int(time.time())
cou, stu, other = f'c{t}@example.com', f's{t}@example.com', f'o{t}@example.com'
cu, su, ou = make_user(cou, 'counselor'), make_user(stu, 'student'), make_user('x' + other, 'counselor')
req(f'{DB}/counselors/{cu}.json?ns={NS}', {'uid': cu, 'email_address': cou, 'first_name': 'Mine', 'last_name': 'C', 'login_access': True, 'status': 'Active'}, method='PUT')
req(f'{DB}/students/{su}.json?ns={NS}', {'uid': su, 'student_id': 'S1', 'email_address': stu, 'first_name': 'Stu', 'last_name': 'Dent', 'login': 'Enable'}, method='PUT')
req(f'{DB}/config/loginEnabled.json?ns={NS}', True, method='PUT')
req(f'{DB}/consultations/c_mine.json?ns={NS}', {'studentId': su, 'counselorId': cu, 'status': 'ACCEPTED'}, method='PUT')
req(f'{DB}/consultations/c_other.json?ns={NS}', {'studentId': su, 'counselorId': ou, 'status': 'ACCEPTED'}, method='PUT')
req(f'{DB}/appointments_by_counselor/{cu}/a1.json?ns={NS}', {'student_uid': su, 'counselor_uid': cu, 'status': 'completed', 'date': '2026-01-01', 'time': '09:00 - 10:00'}, method='PUT')

results = []


def check(name, cond, extra=''):
    results.append(bool(cond)); print(('PASS ' if cond else 'FAIL ') + name + (f'  [{extra}]' if extra and not cond else ''))


with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)
    page = b.new_context().new_page()
    denied = []
    page.on('console', lambda m: denied.append(m.text[:140]) if 'permission_denied' in m.text.lower() and ('consultations' in m.text or 'appointments_by' in m.text) else None)
    page.on('dialog', lambda d: d.accept())
    t0 = int(time.time() * 1000) - 2000
    page.goto(BASE + 'login.html' + EMU)
    page.fill('#email', cou); page.fill('#password', PW); page.click('#signinBtn')
    page.wait_for_selector('#twoFAModal.active', timeout=30000)
    for i, d in enumerate(outbox_code(cou, t0)):
        page.locator('.verification-input').nth(i).fill(d)
    page.click('#twoFAVerify')
    page.wait_for_url('**/pages/index.html**', timeout=30000)

    for name in ('message', 'students', 'appointment'):
        page.goto(BASE + name + '.html' + EMU)
        time.sleep(7)
        check(f'{name}.html stays signed in', name in page.url, page.url)
    check('no consultations/appointments permission errors', not denied, str(denied[:3]))

    page.goto(BASE + 'students.html' + EMU)
    time.sleep(7)
    body = page.inner_text('body')
    check('students page lists the student', 'Stu' in body and 'Dent' in body)
    b.close()

print(f'\n{sum(results)}/{len(results)} checks passed')
sys.exit(0 if all(results) else 1)
