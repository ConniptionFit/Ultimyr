# Ultimyr branding

The mark is the open book from the app icon (same teal and cream as the UI) with a small spark above the spine, for the Archives. Wordmark is Inter Display SemiBold, converted to outlines so it renders the same everywhere (no font needed).

| Colour | Light | Dark |
| --- | --- | --- |
| Tile | `#2f6f62` | `#6fb5a5` |
| Book and spark | `#faf7f0` | `#14130f` |
| Wordmark | `#1d1b16` | `#efe9d9` |

## Which file to use where

| Use | File |
| --- | --- |
| Git repo avatar (Forgejo, GitHub) | `png/icon-light-512.png` (or `icon-dark-512.png`) |
| Repo social preview (1280x640) | `png/social-preview-dark.png` or `-light` |
| README header | `svg/logo-horizontal-light.svg` / `-dark.svg` |
| authentik: application icon, flow/brand logo | `svg/logo-horizontal-light.svg` (light theme) or `-dark.svg`; if it wants a square, `png/icon-light-512.png` |
| authentik: favicon | `png/icon-light-64.png` or `favicon.ico` |
| Other IdPs (Keycloak, Okta, Entra tile) | `png/icon-light-256.png` or `icon-light-512.png`; Entra and Okta want a square PNG |
| Browser favicon, PWA | `favicon.ico`, `png/icon-light-192.png`, `png/icon-light-512.png` |
| Apple touch icon | `png/icon-light-180.png` |
| Mark with no tile (on any background) | `svg/glyph-on-light.svg`, `glyph-on-dark.svg`, `glyph-white.svg` |

Tip: the horizontal logos have a transparent background. Use the **dark** file on dark pages and the **light** file on light pages.

## Regenerate

`pip install fonttools`, then `python3 branding/build.py` (needs Chromium and ImageMagick). Edit the palette or shapes at the top of the script.
