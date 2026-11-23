# SafeSpace design system

Source of truth: `shared/assets/css/safespace.css` (linked last in `<head>` of every page in `apps/*/pages`).
It is a consolidation of the colours the apps already use, not a new identity: green `#00723f` is the brand colour
(used 135 times across the apps) and the greys are the Tailwind greys already in the pages.

## What is in place
- **Tokens** (`--ss-*`): colour (brand, neutrals, status, dark theme via `[data-theme="dark"]`), type scale, 4/8 spacing,
  radius, elevation, motion durations/easing, z-index layers, 44px touch target. Prefixed so they never collide with a
  page's own `:root` variables.
- **Accessibility baseline, active on every page already**: visible keyboard focus ring (many pages used `outline: none`),
  `prefers-reduced-motion` support (none of the pages had it), no tap delay on controls, no iOS zoom on inputs under 16px,
  `.ss-skip-link` and `.ss-sr-only` helpers.
- **Pinch zoom is allowed everywhere** (four counselor pages disabled it); the one page without a viewport meta has one.
- Tested in `shared/tests/ui_baseline.py` (15 checks; serve the repo root, no emulator needed).

## Colour rules
All token pairs meet WCAG AA (ratios are listed in the CSS header). Three colours used as text across the apps do **not**:
`#10b981` (2.5:1), `#ef4444` (3.8:1) and `#1e8e3e` (4.2:1). Keep them for fills and icons; use `--ss-accent` for fills,
`--ss-danger` for error text, `--ss-primary` for brand text.

## Audit at the start of the rework (inline CSS, ~90k lines of HTML)
| | student | counselor | admin |
|---|---|---|---|
| distinct hex colours | 135 | 132 | 171 |
| distinct font-family declarations | 9 | 10 | 7 |
| `outline: none` rules | 7 | 16 | 31 |
| `prefers-reduced-motion` | 0 pages | 0 | 0 |
| font sizes under 12px | 9 | 39 | 6 |

## Next steps (not done yet)
1. Migrate each page's hard-coded colours and fonts to the tokens, one app at a time, starting with the sign-in pages
   (`student/signin`, `counselor/login`, `admin/login`) so the first screen of each app looks like one product.
2. Replace emoji and mixed icon sets used as UI icons with one SVG set (the counselor activity feed uses emoji).
3. Landmarks and skip links: add `<main id="main">` and the skip link to each page; heading order check.
4. Touch targets: raise small icon buttons to 44px hit areas; remove text under 12px.
5. Forms: visible labels instead of placeholder-only fields, errors next to the field with `aria-live`.
6. Dark theme for student and counselor apps (admin already switches `data-theme`); tokens exist, pages do not use them yet.
7. Charts on the admin dashboard: colour-independent encoding and a table alternative.

## "Calm & soft" pilot (student app)

Direction: warm sage-tinted neutrals, rounded corners (10/16/24px), soft green-tinted shadows, Nunito (self-hosted, `shared/assets/fonts`, OFL), pill buttons, one icon family (Font Awesome, inherits text colour).

| Layer | File | Use |
|---|---|---|
| Tokens, a11y baseline, font-face | `shared/assets/css/safespace.css` | every page |
| Components (`ss-auth`, `ss-field`, `ss-control`, `ss-btn`, `ss-alert`, `ss-modal`, `ss-card`, `ss-badge`) | `shared/assets/css/components.css` | rebuilt pages |
| `SafeSpaceUI.alert/confirm/setLoading`, password toggle, `showModal` shim | `shared/assets/js/ui.js` | rebuilt pages |
| Student app shell overrides (sidebar, top bar, cards, dashboard parts) | `apps/student/css/student.css` | student shell pages |
| Landmarks, skip link, keyboard access for the menu/notification/profile controls | `apps/student/js/shell.js` | student shell pages |

Rebuilt so far: student sign-in, verify, sign-up, forgot password, the 2FA dialog, and the student shell (dashboard, messages, history, assessments, resources, settings, profile get the new sidebar/top bar/cards). Phones now have a working menu button.
Not yet: complete-profile, the inner content of messages/history/assessments/resources/profile, counselor app, admin app.

Notes for the roll-out: the old pages stack several inline `<style>` layers, so `student.css` prefixes selectors with `body` to win on specificity; new pages should use the `ss-` components instead of overriding. Use only tokens that exist in `safespace.css` (an undefined `var()` silently becomes 0/none).

## Roll-out to counselor and admin

| App | Login | Shell |
|---|---|---|
| Counselor | rebuilt on `ss-auth` (script and 2FA dialog unchanged; dialog restyled by the `.modal*` classes in `components.css`) | `apps/counselor/css/counselor.css`: sidebar, top bar, Material Icons replace the emoji nav icons, cards, badges, phone bottom nav |
| Admin | rebuilt on `ss-auth`; the 2FA dialog in `apps/admin/js/main.js` uses the shared modal classes | `apps/admin/css/admin.css`: header and sidebar, calm action buttons, tables |

Admin's `theme.css` forces the old green header with `!important` even in dark mode, so `admin.css` uses `html body` plus `!important` to override it. Remove that from `theme.css` once the admin pages are rebuilt on components instead of overridden.

Screenshots for review: `shared/tests/shots.py` (student) and `shared/tests/shots_staff.py` (admin and counselor; signs in through the real emailed-code flow). Browser suites now take `STUDENT_BASE`, `COUNSELOR_BASE`, `ADMIN_BASE` so they can run against the repo root like the deployed site.

Still on the old inline styles (shell is new, page content is not): the inner content of every page apart from the shells and login pages, plus counselor `video`, `privacy`, `individual-inventory`, `student-profile` content, and admin `counselor-student` and `student-profile` (no shared shell markup, so they have no new shell yet).

## Landing page

`apps/counselor/pages/landing.html` (public marketing page) is rebuilt on the design system with `apps/counselor/css/landing.css`. Added a "choose your portal" strip (student, counselor, admin) because the old page only linked to the counselor login. The hotline list stays an image (it is the vetted source) with a full-size link and a descriptive alt text; transcribing it to HTML would make it readable on phones and let numbers be tapped to call, but the numbers must be checked by the GCSO first.
