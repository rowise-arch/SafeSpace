# Screenshots of the admin and counselor apps (desktop + phone) against the Firebase emulators, for before/after reviews.
# Needs: emulators (auth,database,functions) and `python -m http.server 8090 --bind 127.0.0.1` in the REPO ROOT.
#   python shared/tests/shots_staff.py <label> [admin|counselor]
# Signs in through the real login + emailed-code flow, then visits every page. Output: <SHOTS_DIR>/<label>/<app>-<page>-<desktop|phone>.png
import json, os, re, sys, time, urllib.request
from playwright.sync_api import sync_playwright

label = sys.argv[1] if len(sys.argv) > 1 else 'staff'
only = sys.argv[2] if len(sys.argv) > 2 else None
OUT = os.environ.get('SHOTS_DIR', os.path.join(os.getcwd(), 'shots', label))
os.makedirs(OUT, exist_ok=True)
AUTH, DB, NS, PW = 'http://127.0.0.1:9099', 'http://127.0.0.1:9000', 'demo-safespace-default-rtdb', 'Sup3r-secret!'
ROOT = 'http://127.0.0.1:8090/apps/'
EMU = '?emulator=1'

ADMIN_PAGES = ['dashboard', 'user-management', 'counselor-management', 'student-profile', 'session-report',
               'report-management', 'content-management', 'psych-test', 'settings', 'profile']
COUNSELOR_PAGES = ['index', 'appointment', 'message', 'students', 'settings', 'account', 'individual-inventory', 'video', 'privacy', 'student-profile']


def req(url, body=None, method=None):
    h = {'Content-Type': 'application/json', 'Authorization': 'Bearer owner'}
    r = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, headers=h, method=method)
    with urllib.request.urlopen(r) as resp:
        raw = resp.read()
        return json.loads(raw) if raw else None


def db_get(path):
    return req(f'{DB}/{path}.json?ns={NS}')


def put(path, body):
    req(f'{DB}/{path}.json?ns={NS}', body, method='PUT')


def make_user(email, role):
    u = req(f'{AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake', {'email': email, 'password': PW})
    req(f'{AUTH}/identitytoolkit.googleapis.com/v1/projects/demo-safespace/accounts:update',
        {'localId': u['localId'], 'customAttributes': json.dumps({'role': role})})
    return u['localId']


def outbox_code(to, since):
    for _ in range(40):
        data = db_get('_dev_outbox') or {}
        mails = sorted([m for m in data.values() if m['to'] == to and m['at'] >= since], key=lambda m: m['at'])
        if mails:
            m = re.search(r'\b(\d{6})\b', mails[-1]['text'])
            if m:
                return m.group(1)
        time.sleep(0.5)
    raise SystemExit('no email for ' + to)


t = int(time.time())
adm, cou, stu = f'adm{t}@example.com', f'cou{t}@example.com', f'stu{t}@example.com'
adm_uid, cou_uid, stu_uid = make_user(adm, 'admin'), make_user(cou, 'counselor'), make_user(stu, 'student')
put(f'students/S-{t}', {'uid': stu_uid, 'student_id': f'S-{t}', 'email_address': stu, 'first_name': 'Maya', 'last_name': 'Santos',
                        'login': 'Enable', 'status': 2, 'program': 'BS Psychology', 'year_level': '3rd Year'})
put(f'counselors/{cou_uid}', {'uid': cou_uid, 'counselor_id': '007', 'email_address': cou, 'first_name': 'Ana', 'last_name': 'Reyes',
                              'login': 'Enable', 'login_access': True, 'status': 'Active'})
put(f'roster/P-{t}', {'student_id': f'P-{t}', 'email_address': f'p{t}@example.com', 'first_name': 'Pedro', 'last_name': 'Cruz', 'status': 0})
for i, st in enumerate(['completed', 'completed', 'pending', 'approved']):
    put(f'appointments_by_counselor/{cou_uid}/ap{i}', {'student_uid': stu_uid, 'counselor_uid': cou_uid, 'status': st, 'date': '2026-01-0%d' % (i + 1)})
put(f'Session_report/{stu_uid}/case1/sessions/s1', {'student_name': 'Maya Santos', 'personel_name': 'Ana Reyes', 'session_number': 1,
                                                    'status': 'Completed', 'date': 1767225600000})


def login_admin(page):
    page.goto(ROOT + 'admin/pages/login.html' + EMU)
    t0 = int(time.time() * 1000) - 2000
    page.fill('#email', adm); page.fill('#password', PW); page.click('#signinBtn')
    page.wait_for_selector('#ss2faStep2', state='visible', timeout=30000)
    page.fill('#ss2faCode', outbox_code(adm, t0)); page.click('#ss2faVerify')
    page.wait_for_url('**/dashboard.html**', timeout=30000)
    page.wait_for_timeout(2500)


def login_counselor(page):
    page.goto(ROOT + 'counselor/pages/login.html' + EMU)
    t0 = int(time.time() * 1000) - 2000
    page.fill('#email', cou); page.fill('#password', PW); page.click('#signinBtn')
    page.wait_for_selector('#twoFAModal.active', timeout=30000)
    page.wait_for_timeout(1500)
    code = outbox_code(cou, t0)
    boxes = page.locator('.verification-input')
    for i, ch in enumerate(code):
        boxes.nth(i).fill(ch)
    page.click('#twoFAVerify')
    page.wait_for_url('**/index.html**', timeout=30000)
    page.wait_for_timeout(2500)


def shoot(browser, app, pages, login):
    for form, vp in (('desktop', {'width': 1366, 'height': 820}), ('phone', {'width': 390, 'height': 844})):
        ctx = browser.new_context(viewport=vp)
        page = ctx.new_page()
        login(page)
        for name in pages:
            try:
                page.goto(f'{ROOT}{app}/pages/{name}.html{EMU}')
                page.wait_for_timeout(2500)
                page.screenshot(path=os.path.join(OUT, f'{app}-{name}-{form}.png'))
            except Exception as e:  # keep going: a broken page is exactly what a review wants to see
                print('  could not capture', app, name, form, str(e)[:100])
        ctx.close()


with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)
    # login pages themselves (signed out)
    for app in ([only] if only else ['admin', 'counselor']):
        for form, vp in (('desktop', {'width': 1366, 'height': 820}), ('phone', {'width': 390, 'height': 844})):
            ctx = b.new_context(viewport=vp)
            pg = ctx.new_page()
            pg.goto(f'{ROOT}{app}/pages/login.html{EMU}')
            pg.wait_for_timeout(1500)
            pg.screenshot(path=os.path.join(OUT, f'{app}-login-{form}.png'))
            ctx.close()
    if only in (None, 'admin'):
        shoot(b, 'admin', ADMIN_PAGES, login_admin)
    if only in (None, 'counselor'):
        shoot(b, 'counselor', COUNSELOR_PAGES, login_counselor)
    b.close()
print('screenshots in', OUT)
