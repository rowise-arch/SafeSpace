# Browser check: student messages/history pages only read the student's own consultations (scoped queries).
# Start the emulators and `python -m http.server 8081 --bind 127.0.0.1` in apps/student first (see student_flow.py).
import os, json, sys, time, urllib.request
from playwright.sync_api import sync_playwright

AUTH = 'http://127.0.0.1:9099'; DB = 'http://127.0.0.1:9000'; NS = 'demo-safespace-default-rtdb'; PW = 'Sup3r-secret!'
BASE = os.environ.get('STUDENT_BASE', 'http://127.0.0.1:8081/pages/'); EMU = '?emulator=1'


def req(url, body=None, method=None):
    h = {'Content-Type': 'application/json', 'Authorization': 'Bearer owner'}
    r = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, headers=h, method=method)
    with urllib.request.urlopen(r) as resp:
        raw = resp.read(); return json.loads(raw) if raw else None


def make_student(tag):
    email = f'{tag}{int(time.time())}@example.com'
    u = req(f'{AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake', {'email': email, 'password': PW})
    req(f'{AUTH}/identitytoolkit.googleapis.com/v1/projects/demo-safespace/accounts:update', {'localId': u['localId'], 'customAttributes': json.dumps({'role': 'student'})})
    req(f'{DB}/students/{u["localId"]}.json?ns={NS}', {'uid': u['localId'], 'login': 'Enable', 'email_address': email, 'first_name': tag}, method='PUT')
    return email, u['localId']


a_mail, a_uid = make_student('alice')
b_mail, b_uid = make_student('bob')
req(f'{DB}/consultations/c_alice.json?ns={NS}', {'studentId': a_uid, 'counselorId': 'cx', 'status': 'CLOSED', 'appointmentId': 'ap1'}, method='PUT')
req(f'{DB}/consultations/c_bob.json?ns={NS}', {'studentId': b_uid, 'counselorId': 'cx', 'status': 'CLOSED', 'appointmentId': 'ap2'}, method='PUT')

results = []


def check(name, cond, extra=''):
    results.append(bool(cond)); print(('PASS ' if cond else 'FAIL ') + name + (f'  [{extra}]' if extra and not cond else ''))


with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)
    page = b.new_context().new_page()
    denied = []
    page.on('console', lambda m: denied.append(m.text) if 'consultations' in m.text and 'permission' in m.text.lower() else None)
    page.on('pageerror', lambda e: denied.append(str(e)) if 'consultations' in str(e) else None)
    page.on('dialog', lambda d: d.accept())
    page.goto(BASE + 'signin.html' + EMU)
    page.fill('#email', a_mail); page.fill('#password', PW); page.click('#signinBtn')
    page.wait_for_url('**/pages/index.html**', timeout=30000)

    got = page.evaluate("window.myConsultations().then(s => Object.keys(s.val() || {}))")
    check('myConsultations returns only the student\'s own record', got == ['c_alice'], str(got))
    whole = page.evaluate("firebase.database().ref('consultations').once('value').then(() => 'read', e => e.code || e.message)")
    check('reading the whole collection is refused', whole != 'read', str(whole))
    other = page.evaluate("firebase.database().ref('consultations/c_bob').once('value').then(() => 'read', e => 'denied')")
    check('another student\'s consultation is refused', other == 'denied', str(other))

    for name in ('messages', 'history'):
        page.goto(BASE + name + '.html' + EMU)
        time.sleep(6)
        check(f'{name}.html stays signed in', name in page.url, page.url)
    check('no consultations permission errors while pages load', not denied, str(denied[:3]))
    b.close()

print(f'\n{sum(results)}/{len(results)} checks passed')
sys.exit(0 if all(results) else 1)
