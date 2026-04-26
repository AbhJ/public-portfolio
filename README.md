# Abhijay Mitra — Public Portfolio

My personal portfolio site. Hosted at https://abhj.github.io/public-portfolio.

A single-page site showcasing work at Salesforce, achievements, competitive-programming profiles, and interests beyond code — designed with a quiet, Apple-inspired dark aesthetic.

---

## Tech stack

<p>
  <img alt="HTML5" src="https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white">
  <img alt="CSS3" src="https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white">
  <img alt="JavaScript" src="https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black">
  <img alt="Bootstrap" src="https://img.shields.io/badge/Bootstrap_4-7952B3?style=for-the-badge&logo=bootstrap&logoColor=white">
  <img alt="Font Awesome" src="https://img.shields.io/badge/Font_Awesome-528DD7?style=for-the-badge&logo=fontawesome&logoColor=white">
  <img alt="GitHub Pages" src="https://img.shields.io/badge/GitHub_Pages-222?style=for-the-badge&logo=github&logoColor=white">
</p>

### Core
- **HTML5 / CSS3 / vanilla JavaScript** — no framework runtime. Just hand-written code.
- **[Bootstrap 4.1](https://getbootstrap.com/)** — grid system and a handful of utility classes; everything else is custom CSS.
- **[Font Awesome 5](https://fontawesome.com/)** — icon set for all UI glyphs.
- **[AOS — Animate On Scroll](https://michalsnik.github.io/aos/)** — subtle fade/slide-in reveals as sections enter the viewport.
- **[Google Fonts](https://fonts.google.com/)** — Montserrat (display) + Lato (body).

### Dynamic data
The site pulls live stats from several sources at runtime — no backend, no build step required:

- **GitHub profile & contribution graph** — scraped from the public profile HTML via CORS proxy (codetabs, allorigins, corsproxy), with cached repo-commit data as a fallback. Avoids the 60 req/hr unauthenticated API rate limit.
- **LeetCode solve counts & submission heatmap** — multi-strategy fetch: localStorage cache → third-party API (`alfa-leetcode-api`, `leetcode-api-faisalshehbaz`) → native GraphQL via CORS proxy. 2-hour TTL on cache.
- **WakaTime coding activity** — embedded SVG charts (languages, editors, OS, coding activity) filtered via CSS `invert` + `hue-rotate` to match the dark theme.
- **Open Library book covers** — Goodreads-synced bookshelf, covers loaded by ISBN at runtime with graceful fallback when a cover isn't available.
- **Apple Music & YouTube embeds** — iframe-based, responsive 16:9.

Each of the above is wrapped in a `fetchWithTimeout()` helper (`AbortController`, 6 s default) so the page never stalls on a slow third-party dependency.

### UX engineering
- **Preloader with coordinated reveal** — spinner stays up until every declared data source resolves or times out. Sentinel counter prevents premature reveals when caches hit synchronously.
- **Lightbox** — any gallery image (avatar, lifestyle photos, WakaTime SVG, T&P Award photo) opens in a fullscreen viewer with backdrop blur, ESC-to-close, and per-image filter preservation.
- **Scroll progress FAB** — a small circular button that fills as you scroll; flips direction based on viewport position (scroll to top / scroll to bottom).
- **Section scroll-fade** — CSS-variable driven; every section fades as the viewport leaves it, matching the Apple Keynote feel.
- **Smooth anchor scrolling** — measures the navbar height dynamically so nav clicks always land flush under it.
- **GitHub & LeetCode contribution heatmaps** — drawn on `<canvas>` with DPR-aware scaling, tooltip-on-hover, and GitHub-style level colors.
- **Responsive image zoom** — small images still render at a meaningful minimum size when opened.

### Styling
- **Hand-written CSS** (`css/styles.css`) — no preprocessor, no CSS-in-JS.
- **CSS custom properties** for theme tokens (`--primary`, `--secondary`, `--accent`).
- **Glass-morphic navbar** — `backdrop-filter: saturate(180%) blur(20px)`.
- **Soft aurora gradients** behind each section via animated pseudo-elements.
- **Dark mode only** — the palette and gradients are designed for a premium dark reading surface.

### Deployment
- **[GitHub Pages](https://pages.github.com/)** — served as a static site; no build step.
- Push to `master` → Pages picks it up → live site updates within a minute.

---

## Pages

| Path | Purpose |
|---|---|
| `/` (`index.html`) | The current portfolio — Experience, Education, Skills, Highlights, Code Stats, Beyond Code |
| `/legacy.html` | Preserved older version for archival reference |

---

## Local development

No build step needed. Just serve the directory:

```bash
# Option A: Python's built-in
python3 -m http.server 3000

# Option B: any static server you prefer
npx serve .
```

Then open http://localhost:3000 in your browser.

### Dev dependencies

Only one — `aos` for the scroll-reveal animations (pulled at runtime from unpkg, but kept in `package.json` for version locking):

```bash
npm install      # optional — only needed if you bundle AOS locally
```

---

## File layout

```
public-portfolio-master/
├── index.html                 ← main portfolio page
├── legacy.html                ← earlier archived version
├── css/
│   └── styles.css             ← all custom styles (~2200 lines)
├── js/
│   └── main.js                ← data fetchers, heatmaps, lightbox, scroll FX
├── assets/                    ← local images + PDF resume
│   ├── abj_new_dp.jpg
│   ├── tp-allstar-award.jpg
│   ├── abj-blog-preview.jpg   ← screenshot of the modern blog theme
│   ├── gym.jpg / travel.jpg / bike.jpg
│   └── resume-abhj.pdf
└── README.md
```

---

## Credits

- Hero avatar, trophy photograph, lifestyle photos — my own.
- T&P All Star Award press release — [Salesforce Engineering](https://engineering.salesforce.com/celebrating-our-technology-and-products-all-stars-4dba20137cb).
- Icons — [Font Awesome 5](https://fontawesome.com/) and inline SVG.
- Book covers served via [Open Library](https://openlibrary.org/dev/docs/api/covers).
