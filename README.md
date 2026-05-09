# Abhijay Mitra — Public Portfolio

My personal portfolio site. Hosted at https://abhj.github.io/public-portfolio.

A single-page static site showcasing work at Salesforce, achievements,
competitive-programming profiles, books, films, anime, manga, music,
and vlogs. Designed with a quiet, brass-on-dark editorial aesthetic.

> **Reading this as an AI assistant?** Skip ahead to [Manual sync surface area](#manual-sync-surface-area-the-only-places-you-edit). It lists every file and constant that needs to be touched when the user asks for a content update — nowhere else.

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

- **HTML5 / CSS3 / vanilla JavaScript** — no framework runtime.
- **[Bootstrap 4.1](https://getbootstrap.com/)** — grid system + a handful
  of utility classes; everything else is custom CSS.
- **[Font Awesome 5](https://fontawesome.com/)** — icons.
- **[AOS](https://michalsnik.github.io/aos/)** — scroll-reveal animations.
- **[Google Fonts](https://fonts.google.com/)** — Cormorant Garamond
  (display italic) + system stack for body.
- **[GitHub Pages](https://pages.github.com/)** for deploy. Push → live.

No build step. The page is `index.html`, `css/styles.css`, `js/main.js`,
and three small data files in `data/`.

---

## How the page gets its data

Every section pulls from one of three places:

| Source kind | What it means | Example sections |
|---|---|---|
| **Live network** | Fetched from the third-party site on every page load (with a 1 h `localStorage` cache so revisits are instant). No code change needed when the underlying account updates. | Codeforces, CodeChef, AtCoder, LeetCode, GitHub, Goodreads, Apple Music, MyAnimeList (manga + anime), YouTube |
| **Baked snapshot in `data/*.js`** | A small JS file loaded as a `<script>` tag. Source of truth for sites that block static fetches (IMDb), or as a `file://`-friendly fallback that survives flaky CORS proxies (Goodreads). Edit the JS, refresh the page. | IMDb (`films.js`), Goodreads fallback (`books.js`) |
| **Static markup in `index.html`** | Plain HTML that doesn't change unless the user explicitly edits the page. | Experience, Education, Skills, Highlights, hero/avatar links, social handles |

The split exists because not every site lets a static page read it
freely. IMDb is CloudFront-WAF-blocked from any proxy. Goodreads RSS works
through CORS proxies but those proxies sometimes time out and the free
rss2json fallback caps responses at 10 items, so we keep a baked safety
net on disk.

---

## Manual sync surface area (the only places you edit)

Everything below this line is a list of **the exact files and constants
to touch when the user asks for a content update**. If a value isn't on
this list, it's already live — no edit required.

### 1. `data/films.js` &nbsp; ← IMDb stat cells + film-shelf

**Why this is hardcoded:** IMDb actively blocks every static-site path
(CloudFront WAF on the HTML, terms-of-service forbid the GraphQL API,
no public RSS or per-user JSON export). There is no live source we can
read from a browser.

**Schema** (one global, `window.ABJ_FILMS`):

```js
window.ABJ_FILMS = {
  "updated": "YYYY-MM-DD",
  "meta": {
    "titlesRated": 224,        // → "Titles Rated" stat card
    "currentlyWatching": 3,    // → "Currently Watching" stat card
    "avgRating": 7.6,          // → "Avg Rating" stat card (rendered as "/ 10")
    "planToWatch": 42          // → "Plan to Watch" stat card
  },
  "films": [
    {
      "href":   "https://www.imdb.com/title/tt7405458/",
      "img":    "https://m.media-amazon.com/images/M/...jpg",
      "title":  "A Man Called Otto",
      "meta":   "2022 · Marc Forster",   // year · director, optional
      "rating": 10                        // 1..10
    },
    …
  ]
};
```

**When to update:** whenever you re-rate a film on IMDb, finish a
title, or change your watchlist. Recommended: keep only 9★/10★ entries
in the `films` array (the shelf is curated, not a dump).

---

### 2. `data/books.js` &nbsp; ← Goodreads books shelf safety net

**Why this is baked:** Goodreads RSS works through CORS proxies — but
not on `file://` (Chrome blocks `fetch()` for local files), and the
`rss2json` fallback caps at 10 items per response. Without a baked
snapshot, the page would render a 6-book shelf the moment the proxy
chain hiccups. The baked file is the floor; the live RSS fetch
**replaces** it whenever the full feed comes back.

**Schema** (one global, `window.ABJ_BOOKS_DATA`):

```js
window.ABJ_BOOKS_DATA = {
  "updated": "YYYY-MM-DD",
  "meta": {
    "totalRead":  98,    // → "Books Read" stat card
    "avgRating":  4.35   // → "Avg Rating" stat card (rendered as "/ 5")
  },
  "books": [
    {
      "id":           "54109255",
      "title":        "System Design Interview – An insider's guide",
      "displayTitle": "System Design Interview",
      "author":       "Alex Xu",
      "image":        "https://i.gr-assets.com/.../54109255.jpg",
      "rating":       5,                       // 1..5
      "ratedAt":      "Mon, 25 Mar 2026 ..."   // optional
    },
    …
  ]
};
```

**When to regenerate:** after any meaningful Goodreads change. Easiest
recipe — open a terminal at the repo root and run:

```bash
curl -sL "https://www.goodreads.com/review/list_rss/139705685?shelf=read&per_page=200&sort=rating&order=d" \
  -A "Mozilla/5.0" -o /tmp/r.xml

# Then run the small Python regenerator we use; it filters out manga
# authors, sorts by rating, and writes data/books.js. Source the recipe
# from git history (last successful regeneration: 2026-05-10).
```

The live RSS fetch will pick up newer ratings on its own; you only need
to regenerate when you want the `file://`-loaded view to stay current,
or when the full proxy chain is flaky in your region.

---

### 3. `MANGA_AUTHORS` allow-list &nbsp; ← `js/main.js`, line ~1396

```js
var MANGA_AUTHORS = {
    "kentaro miura": 1, "eiichiro oda": 1, "buronson": 1,
    …
};
```

**Why hardcoded:** Goodreads RSS doesn't expose a "format" or "category"
field. We tell manga from books by author name, against this allow-list.

**When to add a name:** if you start reading manga by an author whose
work shouldn't appear on the Books shelf (manga lives in its own MAL-fed
section, so we filter manga authors out of Books). Add the lowercase
name as a key with value `1`.

---

### 4. Profile handles &nbsp; ← `index.html` (CP cards) + a few JS constants

These are platform usernames embedded in the markup. The live fetchers
read them, so changing them re-points the live data sources.

| Section | Where | Current value |
|---|---|---|
| Codeforces | `index.html` `data-cp-handle` on the Codeforces card + `href` | `abj` |
| CodeChef   | `index.html` `data-cp-handle` on the CodeChef card + `href` | `abhj` |
| AtCoder    | `index.html` `data-cp-handle` on the AtCoder card + `href` | `abj` |
| SPOJ       | `index.html` `data-cp-handle` on the SPOJ card + `href` (Cloudflare-gated, count is static `100+`) | `abhj` |
| LeetCode   | `index.html` `View Profile` button + `js/main.js` `LC_USER` | `abhjkgp` |
| GitHub     | `js/main.js` `var USERNAME = "AbhJ"` (top of GitHub-stats IIFE) | `AbhJ` |
| Goodreads  | `js/main.js` `var USER_ID = "139705685"` (two places — main loader + shelf-counters loader) | `139705685` |
| Apple Music | `index.html` `data-music-playlist` on `#music-grid` (and the "View Profile" button below it) | Lounge playlist URL |
| MyAnimeList | `index.html` `data-mal-user` on both `#mangashelf-grid` and `#animeshelf-grid` | `abhj` |
| YouTube     | `js/main.js` `var CHANNEL_ID = "UC48s7RmRZUXT1fpVULeUAOw"` (vlogs IIFE) | the channel ID |
| IMDb        | `index.html` IMDb "View Profile" button (the watchlist link only — data lives in `films.js`) | `p.wfg2ldpigbxnlnkdabpv76dxpe` |

If a handle is wrong, that one section will silently render a placeholder.
The live data is correct as soon as the handle is.

---

### 5. Static narrative content &nbsp; ← `index.html`

These never auto-update. Rewrite directly in `index.html`:

- Hero / "I'm Abhijay" copy and subtitle
- Experience timeline (Salesforce, internships)
- Education cards (IIT Kharagpur, schools)
- Skills strip
- Highlights tiles (T&P All-Star award, Codeforces, CodeChef, Quora, StopStalk, ABJ Blogs)
- Section dividers and dek lines
- Footer email + city + social handles

Most of these sit between `<!-- ABOUT -->` style comment markers in the
HTML; search for the section heading text to find them.

### 6. Local images &nbsp; ← `assets/`

Hero portrait, lifestyle photos, T&P plaque, resume PDF. Replace the
file at the same path; the markup picks up the new asset on next load.

---

## What's NOT on the manual list (already live)

- **Codeforces problems solved** — counts distinct OK verdicts from
  `codeforces.com/api/user.status`.
- **CodeChef problems solved** — scrapes "Total Problems Solved: N"
  from the profile page through CORS proxies.
- **AtCoder rated contests** — counts `IsRated:true` entries from
  `atcoder.jp/users/<handle>/history/json`.
- **LeetCode total / easy / medium / hard / heatmap / streak** —
  multiple third-party APIs, with cache and graceful fallback.
- **GitHub repo count, followers, contribution heatmap, language
  bar** — `api.github.com` + a contribution-graph scrape via proxy.
- **Goodreads "Currently Reading", "Plan to Read" counts** — separate
  RSS feed per shelf.
- **Goodreads books shelf (live path)** — same RSS as the counts;
  whenever the live fetch returns more books than the baked snapshot,
  it overwrites. So in practice the shelf reflects today's Goodreads.
- **Goodreads "Books Read" + "Avg Rating"** — counted from the read
  shelf RSS. Avg includes manga to match the number Goodreads shows
  on the profile page.
- **Apple Music — 6 random tracks from your Lounge playlist** —
  scraped from the playlist HTML on every load; randomized client-side.
- **MyAnimeList — manga + anime shelves and stat cells** —
  `myanimelist.net/{anime,manga}list/<user>/load.json` through the
  CORS proxy chain. Manga shows everything you've at least started
  *plus* plan-to-read; anime shows entries rated 8+.
- **YouTube vlogs** — `youtube.com/feeds/videos.xml?channel_id=…`
  through CORS proxies; pulls the two latest videos.

If any of these is showing a stale or wrong number, the fix is **on the
source site, not in this repo** — re-rate the book on Goodreads, log a
contest on Codeforces, push commits to GitHub, etc. The page picks it up
within an hour (cache TTL) on next visit.

---

## File layout

```
public-portfolio/
├── index.html             ← main portfolio page (~1100 lines, was 2000+
│                            before the data-driven refactor)
├── legacy.html            ← earlier archived version
├── css/styles.css         ← all custom styles (~4400 lines)
├── js/main.js             ← data fetchers, heatmaps, lightbox, scroll FX
├── data/
│   ├── films.js           ← IMDb shelf + stat-cell numbers (manual)
│   └── books.js           ← Goodreads safety net (regenerate periodically)
├── assets/                ← local images + PDF resume
│   ├── abj_new_dp.jpg
│   ├── tp-allstar-award.jpg
│   ├── gym.jpg / travel.jpg / bike.jpg
│   └── resume-abhj.pdf
└── README.md              ← this file
```

---

## Local development

No build step. Serve the directory:

```bash
# Option A: Python's built-in
python3 -m http.server 3000

# Option B: any static server you prefer
npx serve .
```

Then open http://localhost:3000.

You can also open `index.html` directly via `file://` — the data files
are loaded as `<script>` tags specifically so this works. CORS proxies
that the live fetchers depend on may not work from `file://` on every
network, which is why `data/books.js` exists as a baked safety net.

### Cache invalidation

Stat cards and shelves are cached in `localStorage` for 1 hour.
If you've just updated a profile and want to see it reflected
immediately, open DevTools → Application → Local Storage and clear the
keys prefixed with `gr_`, `imdb_`, `mal_`, `cp_`, or `gh_`. The page
re-fetches on next load.

---

## Deployment

Push to `master` on the `public-portfolio` repo. GitHub Pages picks it
up within a minute. There's nothing to build.

---

## Credits

- Hero avatar, trophy photograph, lifestyle photos — my own.
- T&P All Star Award press release — [Salesforce Engineering](https://engineering.salesforce.com/celebrating-our-technology-and-products-all-stars-4dba20137cb).
- Icons — [Font Awesome 5](https://fontawesome.com/) and inline SVG.
- Book covers served via the [Goodreads CDN](https://i.gr-assets.com/).
- Film posters via [IMDb's media CDN](https://m.media-amazon.com/).
- Manga / anime art via the [MyAnimeList CDN](https://cdn.myanimelist.net/).
