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
