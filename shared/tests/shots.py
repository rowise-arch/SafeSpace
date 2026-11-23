# Takes screenshots of the student app (desktop + phone) against the Firebase emulators, for before/after reviews.
# Needs: emulators (auth,database,functions) and `python -m http.server 8090 --bind 127.0.0.1` in the REPO ROOT.
#   python shared/tests/shots.py <label> [app]        app = student (default)
# Output: <scratch>/shots/<label>/<page>-<desktop|phone>.png  (path printed at the end)
import json
import os
import sys
import time
import urllib.request
from playwright.sync_api import sync_playwright

label = sys.argv[1] if len(sys.argv) > 1 else 'shots'
OUT = os.environ.get('SHOTS_DIR', os.path.join(os.getcwd(), 'shots', label))
os.makedirs(OUT, exist_ok=True)
AUTH = 'http://127.0.0.1:9099'
DB = 'http://127.0.0.1:9000'
NS = 'demo-safespace-default-rtdb'
PW = 'Sup3r-secret!'
BASE = 'http://127.0.0.1:8090/apps/student/pages/'
EMU = '?emulator=1'


def req(url, body=None, method=None):
    h = {'Content-Type': 'application/json', 'Authorization': 'Bearer owner'}
    r = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, headers=h, method=method)
    with urllib.request.urlopen(r) as resp:
        raw = resp.read()
        return json.loads(raw) if raw else None


def make_user(email, role):
    u = req(f'{AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake', {'email': email, 'password': PW})
    req(f'{AUTH}/identitytoolkit.googleapis.com/v1/projects/demo-safespace/accounts:update',
        {'localId': u['localId'], 'customAttributes': json.dumps({'role': role})})
    return u['localId']


t = int(time.time())
email = f'demo{t}@example.com'
uid = make_user(email, 'student')
cuid = make_user(f'coun{t}@example.com', 'counselor')
req(f'{DB}/students/{uid}.json?ns={NS}', {
    'uid': uid, 'student_id': '2024-00123', 'email_address': email, 'first_name': 'Maria', 'last_name': 'Santos',
    'course': 'BS Psychology', 'login': 'Enable', 'status': 2, 'profileCompleted': True, 'gender': 'Female', 'username': 'maria'}, method='PUT')
req(f'{DB}/counselors/{cuid}.json?ns={NS}', {
    'uid': cuid, 'counselor_id': '001', 'first_name': 'Elena', 'last_name': 'Reyes', 'specialization': 'Anxiety and stress',
    'status': 'Active', 'login': 'Enable', 'login_access': True, 'email_address': f'coun{t}@example.com'}, method='PUT')

with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)
    for kind, size in (('desktop', {'width': 1366, 'height': 820}), ('phone', {'width': 390, 'height': 844})):
        ctx = b.new_context(viewport=size, device_scale_factor=1)
        page = ctx.new_page()
        page.on('dialog', lambda d: d.accept())
        for name in ('signin', 'verify', 'signup', 'forgot'):
            page.goto(BASE + name + '.html' + EMU, wait_until='load')
            page.wait_for_timeout(600)
            page.screenshot(path=os.path.join(OUT, f'{name}-{kind}.png'), full_page=True)
        page.goto(BASE + 'signin.html' + EMU)
        page.fill('#email', email)
        page.fill('#password', PW)
        page.click('#signinBtn')
        page.wait_for_url('**/pages/index.html**', timeout=30000)
        for name in ('index', 'messages', 'history', 'assessments', 'resources', 'settings', 'profile', 'complete-profile'):
            page.goto(BASE + name + '.html' + EMU, wait_until='load')
            page.wait_for_timeout(3500)
            page.screenshot(path=os.path.join(OUT, f'{name}-{kind}.png'), full_page=False)
        ctx.close()
    b.close()
print('screenshots in', OUT)
