# Anchor — site

Static landing page for [Anchor](https://github.com/priyank766/anchor).
Designed by Claude Design from a brief by Priyank Patel.

## Deploy to GitHub Pages

1. Copy the contents of this folder to `docs/` at your repo root, or push to a `gh-pages` branch.
2. In repo Settings → Pages, select the source.
3. The `.nojekyll` file is required and is already present.

## Deploy to Cloudflare Pages

1. Connect the repo.
2. Build command: (none).
3. Output directory: this folder.

## Deploy to Vercel

1. Import the repo.
2. Framework preset: Other.
3. Build command: (none). Output directory: this folder.

## Local preview

```
npx serve .
```

## Customize

- `index.html` — copy, links, metadata.
- `assets/og.png` — replace with your own.
- `styles/main.css` — color tokens are CSS custom properties at the top of the file; change them to retheme without touching the rest.

## Page weight

Excluding fonts, the page is well under 400 KB (HTML + CSS + JS + favicon).
Fonts are loaded from Google Fonts CDN (Fraunces, Inter, JetBrains Mono);
to self-host, drop WOFF2 files in `fonts/` and replace the `<link>` in `index.html`
with `@font-face` declarations in `styles/main.css`.

## Accessibility

- Lighthouse 95+ targeted across all four categories.
- WCAG 2.1 AA contrast ratios in both themes.
- Every interactive element reachable by keyboard, with a 2 px rust focus ring.
- All motion respects `prefers-reduced-motion: reduce`.
- Page renders without JavaScript: motion is gone, layout and content remain.
