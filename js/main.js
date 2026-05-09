// ===== Page Readiness — preloader control =====
// Spinner stays until EVERY data source resolves or rejects.
// Each fetch has its own AbortController timeout so nothing hangs.
// Sentinel starts at 1 and is released by window.load — prevents a cache hit
// from zeroing the counter before later IIFEs register their sources.
var _dataReady = { pending: 1, revealed: false };

function dataSourceStarted() { _dataReady.pending++; }
function dataSourceDone() {
	_dataReady.pending--;
	if (_dataReady.pending <= 0 && !_dataReady.revealed) revealPage();
}
function revealPage() {
	if (_dataReady.revealed) return;
	_dataReady.revealed = true;
	document.body.classList.add("ready");
	var pre = document.getElementById("preloader");
	if (pre) pre.classList.add("loaded");
	if (typeof AOS !== "undefined") {
		AOS.refreshHard();
		setTimeout(function () { AOS.refreshHard(); }, 50);
		setTimeout(function () { AOS.refresh(); }, 200);
	}
}

// Release the sentinel once the page's base assets are loaded.
// By then all top-level IIFEs have registered their data sources.
window.addEventListener("load", function () { dataSourceDone(); });

// Safety net: if all per-fetch timeouts somehow fail, force reveal at 2.5s
// (was 10s — that was a long time to stare at a blank screen if a single
// proxy timed out). Real fetches respond in <1s; 2.5s is safely above p99.
setTimeout(revealPage, 2500);

// Fetch wrapper with per-request timeout (default 6s) — never hangs
function fetchWithTimeout(url, opts, ms) {
	if (!ms) ms = 6000;
	if (typeof AbortController !== "undefined") {
		var ctrl = new AbortController();
		var timer = setTimeout(function () { ctrl.abort(); }, ms);
		opts = Object.assign({}, opts || {}, { signal: ctrl.signal });
		return fetch(url, opts).finally(function () { clearTimeout(timer); });
	}
	// Fallback for old browsers: race with a reject timer
	return Promise.race([
		fetch(url, opts),
		new Promise(function (_, reject) { setTimeout(function () { reject(new Error("Timeout")); }, ms); })
	]);
}

/* =====================================================================
   ABJ_SERIES — series detection & clubbing helper for the bookshelf.
   ---------------------------------------------------------------------
   When the Goodreads feed includes 30+ Berserk volumes (and 20+ One Piece,
   and a Fist-of-the-North-Star pile), rendering them all individually
   buries every other book on the shelf. This helper extracts a stable
   series key from a title so the renderer can group volumes into a single
   card with a "× N vols" badge.

   The detection is rule-based and tolerant:
     - "Berserk, Vol. 15"                              → "berserk"
     - "Berserk, Vol. 4 (Berserk, #4)"                 → "berserk"
     - "ベルセルク 39 [Berserk 39]"                       → "berserk"
     - "Берсерк. Том 1 (ベルセルク / Berserk #1-2)"        → "berserk"
     - "Fist of the North Star: Master Edition, Vol 2" → "fist of the north star"
     - "One Piece, Volume 7"                            → "one piece"
     - "Atomic Habits"                                  → null (single book)

   We intentionally stay generic — no per-series allow-list. New series get
   detected the moment their second volume lands in the feed.
   ===================================================================== */
window.ABJ_SERIES = (function () {
	// Patterns that signal a multi-volume work. If at least one matches,
	// the title is treated as a series volume and stripped down to the
	// series name.
	var VOLUME_PATTERNS = [
		// "Berserk, Vol. 15", "Berserk, Vol 15", "Vol. 15"
		/[,\s]\s*Vol\.?\s*\d+/i,
		// "Berserk Volume 7", "Volume 7"
		/[,\s]\s*Volume\s+\d+/i,
		// "(Berserk, #4)" or "(Series, #41)"
		/\([^()]*#\s*\d+[^()]*\)/,
		// Trailing "[Berserk 39]" bracket — common on Japanese localizations
		/\[[^\]]*\d+\]/,
		// Trailing bare volume number on a title that already contains
		// alphabetic content, e.g. "ベルセルク 39"
		/\s\d{1,3}$/
	];

	// English number words that sometimes stand in for digits.
	var WORD_NUMS = "(?:one|two|three|four|five|six|seven|eight|nine|ten)";

	function looksLikeSeries(title) {
		if (!title) return false;
		for (var i = 0; i < VOLUME_PATTERNS.length; i++) {
			if (VOLUME_PATTERNS[i].test(title)) return true;
		}
		// "Book Three", "Book 3" suffix
		if (new RegExp("\\bBook\\s+(?:\\d+|" + WORD_NUMS + ")\\b", "i").test(title)) return true;
		return false;
	}

	// Strip volume markers / parentheticals / bracketed translations to
	// arrive at the canonical series name. We extract the cleanest ASCII
	// candidate string we can find and let `keyFor` normalize it.
	function extractSeriesName(title) {
		var t = String(title || "");
		// 1. Look inside a "(Series, #N)" parenthetical — that's almost
		//    always the canonical English series name on Goodreads
		//    ("Berserk, Vol. 4 (Berserk, #4)" → "Berserk").
		var paren = t.match(/\(([^()]*?)\s*[,#][^()]*\)/);
		if (paren) {
			var inside = paren[1].trim();
			// Strip a trailing "Vol N" inside the parenthetical too
			inside = inside.replace(/[,\s]+Vol\.?\s*\d+.*$/i, "");
			if (asciiHasLetters(inside)) return inside;
		}
		// 2. Look inside a trailing "[Romanization N]" bracket — common
		//    on Japanese Goodreads entries: "ベルセルク 39 [Berserk 39]"
		//    → take "Berserk" out of the bracket.
		var bracket = t.match(/\[([^\]]+)\]\s*$/);
		if (bracket) {
			var b = bracket[1].replace(/\s*\d+\s*$/g, "").trim();
			if (asciiHasLetters(b)) return b;
		}
		// 3. Look for an ASCII transliteration buried mid-string after a
		//    slash: "Берсерк. Том 1 (ベルセルク / Berserk #1-2)"
		var slash = t.match(/\/\s*([A-Za-z][A-Za-z\s'.-]+)/);
		if (slash) return slash[1].trim();
		// 4. Otherwise, strip volume markers off the *primary* title.
		var primary = t;
		// Drop any "(...)" parentheticals at the end
		primary = primary.replace(/\s*\([^()]*\)\s*$/g, "");
		// Drop any "[...]" brackets at the end
		primary = primary.replace(/\s*\[[^\]]*\]\s*$/g, "");
		// Drop "Vol. N" / "Volume N" / "Book N"
		primary = primary.replace(/[,\s]+Vol\.?\s*\d+.*$/i, "");
		primary = primary.replace(/[,\s]+Volume\s+\d+.*$/i, "");
		primary = primary.replace(/[,\s]+Book\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b.*$/i, "");
		// Drop subtitle after colon / em-dash
		primary = primary.replace(/\s*[:–—]\s+.*$/, "");
		// Drop a bare trailing volume number ("ベルセルク 39", "One Piece 7")
		primary = primary.replace(/\s+\d{1,3}\s*$/, "");
		return primary.replace(/\s+/g, " ").trim();
	}

	function asciiHasLetters(s) {
		return /[A-Za-z]/.test(String(s || ""));
	}

	// Tokenize for cross-script matching: keep ASCII letters only, drop
	// digits and non-ASCII glyphs. Volume numbers and CJK / Cyrillic
	// localizations vary between editions of the same series, so excluding
	// both is what makes "ベルセルク 39 [Berserk 39]" group with
	// "Berserk, Vol. 15".
	function asciiKey(s) {
		return String(s || "")
			.toLowerCase()
			.replace(/[^ -~]+/g, " ")     // strip non-ASCII
			.replace(/[^a-z ]+/g, " ")    // also drop digits & punctuation
			.replace(/\s+/g, " ")
			.trim();
	}

	// Public — return a normalized series key, or null if `title` is a
	// single (non-series) book.
	function keyFor(title, author) {
		if (!looksLikeSeries(title)) return null;
		var name = extractSeriesName(title);
		var key = asciiKey(name);
		// If we couldn't extract anything ASCII (no English form anywhere)
		// fall back to the original title — better to leave it as a single
		// card than club unrelated books under an empty key.
		if (!key) return null;
		// Take only the first 4 significant words to keep "Berserk" and
		// "Berserk Deluxe Edition" in the same bucket but separate from a
		// completely different series with a coincidental shared word.
		var words = key.split(" ").filter(Boolean).slice(0, 4);
		if (!words.length) return null;
		return words.join(" ");
	}

	// Title-case the stripped name for display ("berserk" → "Berserk").
	function prettyName(seriesKey) {
		if (!seriesKey) return "";
		return seriesKey.replace(/\b([a-z])/g, function (_, c) { return c.toUpperCase(); });
	}

	return { keyFor: keyFor, prettyName: prettyName, looksLikeSeries: looksLikeSeries };
})();

/* =====================================================================
   ABJ_HM — DOM-grid heatmap component (LeetCode/GitHub-style).
   ---------------------------------------------------------------------
   Why DOM and not canvas: the previous canvas implementation scaled the
   element with `max-width: 100%` while the per-cell hit-test math stayed
   in canvas-logical pixels. On narrow viewports the right edge clipped
   (last month vanished) and tooltip mapping became wrong. A DOM grid
   uses the browser's own layout & hit testing for free, scrolls
   horizontally on small screens, and works perfectly on touch.

   Public API:
     var hm = ABJ_HM.create({
       gridEl,             // container; will be filled with day cells
       monthsEl,           // container for the month-label row
       tooltipEl,          // shared tooltip element
       weeks: 53,          // optional, defaults to 53
       levelClass(count, cell) → "hm-l-2" / "hm-lc-3" / etc,
       labelFor(cell) → string for the tooltip
     });
     hm.update(countsByDate, levelsByDate?);
   ===================================================================== */
window.ABJ_HM = (function () {
	var MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

	function pad2(n) { return String(n).padStart(2, "0"); }
	function dateKey(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }

	function create(opts) {
		var WEEKS = opts.weeks || 53;
		var gridEl = opts.gridEl;
		var monthsEl = opts.monthsEl;
		var tooltipEl = opts.tooltipEl;
		var levelClass = opts.levelClass || function () { return "hm-l-0"; };
		var labelFor = opts.labelFor || function (c) { return c.key; };

		// Build cells: WEEKS columns × 7 rows, ending today, aligned so the
		// final column's bottom-right is "today" or one of today's weekdays.
		var today = new Date(); today.setHours(0, 0, 0, 0);
		var startDay = new Date(today);
		// Sunday-first grid; (WEEKS*7-1) days back from today's column origin.
		startDay.setDate(startDay.getDate() - (WEEKS * 7 - 1) - today.getDay());

		var cells = []; // {date, key, count, level, el}
		var byKey = {};
		var d = new Date(startDay);
		while (d <= today) {
			var key = dateKey(d);
			cells.push({ date: new Date(d), key: key, count: 0, level: 0 });
			byKey[key] = cells.length - 1;
			d.setDate(d.getDate() + 1);
		}

		var cols = Math.ceil(cells.length / 7);

		// Render the day-cell grid. Each cell is a <button> for native focus,
		// keyboard support, and (most importantly) reliable touch hit-testing.
		gridEl.style.gridTemplateColumns = "repeat(" + cols + ", 1fr)";
		gridEl.style.gridTemplateRows = "repeat(7, 1fr)";
		gridEl.innerHTML = "";
		var frag = document.createDocumentFragment();
		for (var i = 0; i < cells.length; i++) {
			var cell = cells[i];
			var col = Math.floor(i / 7);
			var row = i % 7;
			var btn = document.createElement("button");
			btn.type = "button";
			btn.className = "hm-cell hm-l-0";
			btn.style.gridColumn = (col + 1);
			btn.style.gridRow = (row + 1);
			btn.setAttribute("data-key", cell.key);
			btn.setAttribute("aria-label", labelFor(cell));
			btn.tabIndex = -1;
			cell.el = btn;
			frag.appendChild(btn);
		}
		gridEl.appendChild(frag);

		// Render the month-label strip, aligned to the same N-column grid so
		// labels line up exactly with the start of each month's first column.
		if (monthsEl) {
			monthsEl.style.gridTemplateColumns = "repeat(" + cols + ", 1fr)";
			monthsEl.innerHTML = "";
			var lastLabeledMonth = -1;
			for (var c = 0; c < cols; c++) {
				var ci = c * 7;
				if (ci >= cells.length) break;
				var colDate = cells[ci].date;
				var span = document.createElement("span");
				span.className = "hm-month";
				span.style.gridColumn = (c + 1);
				if (colDate.getDate() <= 7 && colDate.getMonth() !== lastLabeledMonth) {
					span.textContent = MONTH_NAMES[colDate.getMonth()];
					lastLabeledMonth = colDate.getMonth();
				}
				monthsEl.appendChild(span);
			}
		}

		// ---- Tooltip handling — works for hover, click, AND touch tap. -----
		// Strategy: a single shared tooltip element. Hovering positions it
		// over the cell; clicking/tapping a cell pins it (visible until the
		// user taps elsewhere or another cell). Outside-click dismisses.
		var pinned = false;

		function showTipFor(cell) {
			if (!tooltipEl) return;
			tooltipEl.textContent = labelFor(cell);
			tooltipEl.classList.add("visible");
			// Position the tooltip in the heatmap's wrap, above the target cell.
			// We measure relative to the wrap so horizontal scroll doesn't break it.
			var wrap = tooltipEl.parentElement; // .hm-wrap
			if (!wrap) return;
			var wrapRect = wrap.getBoundingClientRect();
			var cellRect = cell.el.getBoundingClientRect();
			var tipW = tooltipEl.offsetWidth;
			var ideal = (cellRect.left - wrapRect.left) + (cellRect.width / 2) - (tipW / 2);
			var clamped = Math.max(8, Math.min(ideal, wrap.offsetWidth - tipW - 8));
			tooltipEl.style.left = clamped + "px";
			tooltipEl.style.top = (cellRect.top - wrapRect.top - tooltipEl.offsetHeight - 6) + "px";
		}

		function hideTip() {
			if (!tooltipEl) return;
			tooltipEl.classList.remove("visible");
			pinned = false;
		}

		// Hover (desktop only — touch devices won't fire this reliably).
		gridEl.addEventListener("mouseover", function (e) {
			if (pinned) return;
			var btn = e.target.closest(".hm-cell");
			if (!btn) return;
			var k = btn.getAttribute("data-key");
			if (k && byKey.hasOwnProperty(k)) showTipFor(cells[byKey[k]]);
		});
		gridEl.addEventListener("mouseleave", function () {
			if (!pinned) hideTip();
		});

		// Click / tap — pin the tooltip. Works on every platform.
		gridEl.addEventListener("click", function (e) {
			var btn = e.target.closest(".hm-cell");
			if (!btn) return;
			e.preventDefault();
			var k = btn.getAttribute("data-key");
			if (!k || !byKey.hasOwnProperty(k)) return;
			var cell = cells[byKey[k]];
			// If this same cell is already pinned, treat it as a toggle off.
			if (pinned && tooltipEl.dataset.pinnedKey === k) {
				hideTip();
				delete tooltipEl.dataset.pinnedKey;
				return;
			}
			pinned = true;
			tooltipEl.dataset.pinnedKey = k;
			showTipFor(cell);
		});

		// Outside-tap dismisses the pinned tooltip.
		document.addEventListener("click", function (e) {
			if (!pinned) return;
			if (e.target.closest(".hm-cell")) return;       // handled above
			if (e.target === tooltipEl) return;
			hideTip();
			delete tooltipEl.dataset.pinnedKey;
		}, true);

		// ---- Public update method ----
		// counts: { "YYYY-MM-DD": number }; levels: optional 0-4 per date.
		function update(counts, levels) {
			counts = counts || {};
			levels = levels || {};
			for (var i = 0; i < cells.length; i++) {
				var cell = cells[i];
				var c = counts[cell.key] | 0;
				var l = levels[cell.key];
				cell.count = c;
				if (typeof l === "number") cell.level = l;
				// Recompute class from count or level
				cell.el.className = "hm-cell " + levelClass(cell.count, cell);
				cell.el.setAttribute("aria-label", labelFor(cell));
				// If a tooltip is currently shown for this cell, refresh its text.
				if (pinned && tooltipEl && tooltipEl.dataset.pinnedKey === cell.key) {
					tooltipEl.textContent = labelFor(cell);
				}
			}
			// Auto-scroll to the right so the most-recent week is visible on
			// narrow screens. Only run once on first non-empty update.
			var scroller = gridEl.closest(".hm-scroll");
			if (scroller && !scroller.dataset.scrolledRight) {
				scroller.scrollLeft = scroller.scrollWidth;
				scroller.dataset.scrolledRight = "1";
			}
		}

		return { update: update, cells: cells };
	}

	return { create: create };
})();

(function ($) {
	"use strict";

	// Smooth scrolling — native for speed, jQuery fallback
	$('a.js-scroll-trigger[href*="#"]:not([href="#"])').click(function (e) {
		if (
			location.pathname.replace(/^\//, "") === this.pathname.replace(/^\//, "") &&
			location.hostname === this.hostname
		) {
			var el = document.querySelector(this.hash);
			if (!el) {
				el = document.querySelector("[name=" + this.hash.slice(1) + "]");
			}
			if (el) {
				e.preventDefault();
				// Land exactly at the section's top boundary, just below the fixed navbar.
				var nav = document.getElementById("mainNav");
				var navH = nav ? nav.getBoundingClientRect().height : 0;
				var top = el.getBoundingClientRect().top + window.pageYOffset - navH;
				window.scrollTo({ top: top, behavior: "smooth" });
			}
		}
	});

	// Close responsive menu on scroll-trigger click
	$(".js-scroll-trigger").click(function () {
		$(".navbar-collapse").collapse("hide");
	});

	// Scrollspy
	$("body").scrollspy({ target: "#mainNav", offset: 80 });

	// Navbar collapse on scroll
	var navbarCollapse = function () {
		if ($("#mainNav").offset().top > 100) {
			$("#mainNav").addClass("navbar-shrink");
		} else {
			$("#mainNav").removeClass("navbar-shrink");
		}
	};
	navbarCollapse();
	$(window).scroll(navbarCollapse);

})(jQuery);

// Copyright — month and year
(function () {
	var now = new Date();
	var yearEl = document.getElementById("year");
	var monthEl = document.getElementById("month");
	if (yearEl) yearEl.textContent = now.getFullYear();
	if (monthEl) {
		monthEl.textContent = [
			"January", "February", "March", "April", "May", "June",
			"July", "August", "September", "October", "November", "December"
		][now.getMonth()];
	}
})();

// ===== AOS — Apple-style bidirectional scroll animations =====
AOS.init({
	duration: 800,
	once: true,
	easing: "ease-out-cubic",
	anchorPlacement: "top-bottom",
	offset: 50
});

// ===== Hero Parallax + Fade =====
(function () {
	var hero = document.querySelector(".masthead");
	var content = hero ? hero.querySelector(".masthead-content") : null;
	if (!hero || !content) return;

	// Staggered entry on load
	content.style.opacity = "0";
	content.style.transform = "translateY(30px)";
	content.style.transition = "opacity 0.8s ease, transform 0.8s ease";
	setTimeout(function () {
		content.style.opacity = "1";
		content.style.transform = "translateY(0)";
	}, 200);

	window.addEventListener("scroll", function () {
		var scrollY = window.pageYOffset;
		var h = hero.offsetHeight;
		if (scrollY < h * 1.2) {
			hero.style.setProperty("--parallax-y", scrollY * 0.3 + "px");
			// Fade out as a single unit — starts fading at 20% scroll, gone by 80%
			var fade = 1 - Math.max(0, Math.min((scrollY - h * 0.1) / (h * 0.5), 1));
			content.style.opacity = fade;
			content.style.transform = "translateY(" + (scrollY * 0.15) + "px) scale(" + (0.95 + 0.05 * fade) + ")";
			content.style.transition = "none";
		}
	});
})();

// ===== Global Aurora Hue Shift — scroll-driven color evolution =====
(function () {
	var docH, winH, lastHue = -1;
	function measure() { docH = document.body.scrollHeight; winH = window.innerHeight; }
	measure();
	window.addEventListener("resize", measure);

	window.addEventListener("scroll", function () {
		var scrollPct = window.pageYOffset / (docH - winH || 1);
		// Full journey maps to 0 → 45 degree hue shift (subtle, not garish)
		var hue = Math.round(scrollPct * 45);
		if (hue !== lastHue) {
			lastHue = hue;
			document.documentElement.style.setProperty("--aurora-hue", hue + "deg");
		}
	});
})();

// ===== LeetCode — fully dynamic stats + heatmap =====
// Multi-strategy: (1) localStorage cache, (2) third-party API, (3) native GraphQL via CORS proxy
(function () {
	var LC_USER = "abhjkgp";
	var LC_GQL = "https://leetcode.com/graphql";
	var LC_CACHE_KEY = "lc_stats";
	var LC_CAL_CACHE_KEY = "lc_calendar";
	var CACHE_TTL = 2 * 60 * 60 * 1000; // 2 hours

	// ---- Third-party API endpoints (no CORS issues, GET-based) ----
	var LC_API_HOSTS = [
		"https://alfa-leetcode-api.onrender.com/",
		"https://leetcode-api-faisalshehbaz.vercel.app/"
	];

	// ---- CORS proxy for native GraphQL (POST) ----
	var CORS_PROXIES = [
		function (u) { return "https://corsproxy.io/?" + encodeURIComponent(u); }
	];

	function lcGraphQL(query, proxyIdx) {
		if (proxyIdx === undefined) proxyIdx = 0;
		if (proxyIdx >= CORS_PROXIES.length) return Promise.reject(new Error("All proxies failed"));
		var url = CORS_PROXIES[proxyIdx](LC_GQL);
		return fetchWithTimeout(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ query: query })
		}).then(function (r) {
			if (!r.ok) throw new Error("Proxy " + proxyIdx + " failed: " + r.status);
			return r.json();
		}).then(function (d) {
			if (!d || !d.data) throw new Error("No data from proxy " + proxyIdx);
			return d;
		}).catch(function () {
			return lcGraphQL(query, proxyIdx + 1);
		});
	}

	// ---- Helper: try multiple API hosts sequentially ----
	function fetchFromHosts(path, hostIdx) {
		if (hostIdx === undefined) hostIdx = 0;
		if (hostIdx >= LC_API_HOSTS.length) return Promise.reject(new Error("All API hosts failed"));
		return fetchWithTimeout(LC_API_HOSTS[hostIdx] + path)
			.then(function (r) {
				if (!r.ok) throw new Error("Host " + hostIdx + " returned " + r.status);
				return r.json();
			})
			.then(function (d) {
				if (!d || (d.errors && d.errors.length)) throw new Error("Bad data from host " + hostIdx);
				return d;
			})
			.catch(function () { return fetchFromHosts(path, hostIdx + 1); });
	}

	// ---- Helper: cache read/write ----
	function cacheRead(key) {
		try {
			var c = JSON.parse(localStorage.getItem(key));
			if (c && c.ts && (Date.now() - c.ts) < CACHE_TTL && c.data) return c.data;
		} catch (e) {}
		return null;
	}
	function cacheWrite(key, data) {
		try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data: data })); } catch (e) {}
	}

	// ---- Apply stats to DOM ----
	function applyStats(easy, medium, hard) {
		var total = easy + medium + hard;
		var el;
		if ((el = document.getElementById("lc-total"))) el.textContent = total;
		if ((el = document.getElementById("lc-easy"))) el.textContent = easy;
		if ((el = document.getElementById("lc-medium"))) el.textContent = medium;
		if ((el = document.getElementById("lc-hard"))) el.textContent = hard;
		if (total > 0) {
			if ((el = document.getElementById("lc-bar-easy"))) el.style.width = (easy / total * 100).toFixed(1) + "%";
			if ((el = document.getElementById("lc-bar-medium"))) el.style.width = (medium / total * 100).toFixed(1) + "%";
			if ((el = document.getElementById("lc-bar-hard"))) el.style.width = (hard / total * 100).toFixed(1) + "%";
		}
	}

	// ---- 1. Problem stats ----
	dataSourceStarted();
	var cachedStats = cacheRead(LC_CACHE_KEY);
	if (cachedStats) {
		applyStats(cachedStats.easy, cachedStats.medium, cachedStats.hard);
		dataSourceDone();
	} else {
		// Strategy A: third-party API (GET, no CORS issues)
		fetchFromHosts(LC_USER + "/solved")
			.then(function (d) {
				var easy = d.easySolved || 0, medium = d.mediumSolved || 0, hard = d.hardSolved || 0;
				applyStats(easy, medium, hard);
				cacheWrite(LC_CACHE_KEY, { easy: easy, medium: medium, hard: hard });
			})
			.catch(function () {
				// Strategy B: native GraphQL via CORS proxy
				return lcGraphQL('{ matchedUser(username: "' + LC_USER + '") { submitStats { acSubmissionNum { difficulty count } } } }')
					.then(function (d) {
						var stats = d.data.matchedUser.submitStats.acSubmissionNum;
						var easy = 0, medium = 0, hard = 0;
						stats.forEach(function (s) {
							if (s.difficulty === "Easy") easy = s.count;
							else if (s.difficulty === "Medium") medium = s.count;
							else if (s.difficulty === "Hard") hard = s.count;
						});
						applyStats(easy, medium, hard);
						cacheWrite(LC_CACHE_KEY, { easy: easy, medium: medium, hard: hard });
					});
			})
			.catch(function () {})
			.finally(dataSourceDone);
	}

	// ---- 2. Calendar heatmap (DOM grid — LeetCode-style) ----
	var hmGrid = document.getElementById("lc-hm-grid");
	var hmMonths = document.getElementById("lc-hm-months");
	var tooltip = document.getElementById("lc-heatmap-tooltip");
	if (!hmGrid) return;

	var hm = ABJ_HM.create({
		gridEl: hmGrid,
		monthsEl: hmMonths,
		tooltipEl: tooltip,
		levelClass: function (count) {
			if (count === 0) return "hm-lc-0";
			if (count <= 2) return "hm-lc-1";
			if (count <= 4) return "hm-lc-2";
			if (count <= 6) return "hm-lc-3";
			return "hm-lc-4";
		},
		labelFor: function (cell) {
			var dateStr = cell.date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
			if (cell.count > 0) {
				return cell.count + " submission" + (cell.count !== 1 ? "s" : "") + " on " + dateStr;
			}
			return "No submissions on " + dateStr;
		}
	});

	// ---- Apply calendar data ----
	function applyCalendar(cal, streak, activeDays) {
		var counts = {};
		Object.keys(cal).forEach(function (ts) {
			var dt = new Date(parseInt(ts, 10) * 1000);
			var key = dt.getFullYear() + "-" +
				String(dt.getMonth() + 1).padStart(2, "0") + "-" +
				String(dt.getDate()).padStart(2, "0");
			counts[key] = cal[ts];
		});
		hm.update(counts);

		var streakEl = document.getElementById("lc-streak");
		if (streakEl && (streak || activeDays)) {
			var parts = [];
			if (streak) parts.push(streak + " day streak");
			if (activeDays) parts.push(activeDays + " active days");
			streakEl.textContent = parts.join(" · ");
			if (streak > 0) streakEl.insertAdjacentHTML("beforebegin", '<i class="fas fa-fire-alt" style="color:#ffa116;margin-right:0.3rem;"></i>');
		}
	}

	// Fetch calendar: cache → third-party API → native GraphQL
	dataSourceStarted();
	var cachedCal = cacheRead(LC_CAL_CACHE_KEY);
	if (cachedCal && cachedCal.calendar) {
		applyCalendar(cachedCal.calendar, cachedCal.streak, cachedCal.activeDays);
		dataSourceDone();
	} else {
		// Strategy A: third-party API calendar endpoint
		fetchFromHosts("userProfile/" + LC_USER)
			.then(function (d) {
				// Third-party API returns submissionCalendar as JSON string
				var cal = d.submissionCalendar;
				if (typeof cal === "string") cal = JSON.parse(cal);
				if (!cal || typeof cal !== "object") throw new Error("No calendar data");
				var streak = d.streak || 0;
				var activeDays = d.totalActiveDays || 0;
				applyCalendar(cal, streak, activeDays);
				cacheWrite(LC_CAL_CACHE_KEY, { calendar: cal, streak: streak, activeDays: activeDays });
			})
			.catch(function () {
				// Strategy B: native GraphQL via CORS proxy
				return lcGraphQL('{ matchedUser(username: "' + LC_USER + '") { userCalendar { submissionCalendar streak totalActiveDays } } }')
					.then(function (d) {
						var uc = d.data.matchedUser.userCalendar;
						var cal = uc.submissionCalendar;
						if (typeof cal === "string") cal = JSON.parse(cal);
						applyCalendar(cal, uc.streak, uc.totalActiveDays);
						cacheWrite(LC_CAL_CACHE_KEY, { calendar: cal, streak: uc.streak, activeDays: uc.totalActiveDays });
					});
			})
			.catch(function () {})
			.finally(dataSourceDone);
	}
})();

// ===== Competitive programming — solved-count per platform =====
// Codeforces, CodeChef and AtCoder are fetched in parallel from public APIs
// (or trusted third-party proxies for sites that don't publish CORS-friendly
// endpoints). Each card has a data-cp-platform / data-cp-handle attribute,
// and we update only the matching `[id^="cp-"]` span on success — failures
// leave the em-dash placeholder untouched, so the page never looks broken.
//
// SPOJ is intentionally not fetched live: their profile page is gated by a
// Cloudflare interactive challenge that no static-site request can solve.
// We just link to the profile and leave the count as "—".
(function () {
	var row = document.getElementById("cp-stats-row");
	if (!row) return;

	// v2 = AtCoder switched from "rated contests" → "problems solved".
	// v3 = fixed wrong Codeforces handle (`abhj` → `abj`) and wrong AtCoder
	//      handle (`abhjkgp` → `abj`); reverted AtCoder back to rated-
	//      contests count since kenkoooo's distinct-AC endpoint is dead.
	var CACHE_KEY = "cp_stats_v3";
	var CACHE_TTL = 60 * 60 * 1000;     // 1 hour
	var COUNTS = {};                    // { codeforces: 1296, codechef: 260, ... }

	// Format big numbers with thousands separators
	function fmt(n) {
		if (typeof n !== "number" || !isFinite(n)) return "—";
		return n.toLocaleString("en-US");
	}

	function paint() {
		var map = {
			codeforces: "cp-cf-solved",
			codechef:   "cp-cc-solved",
			atcoder:    "cp-ac-solved",
			spoj:       "cp-sp-solved"
		};
		Object.keys(map).forEach(function (k) {
			var el = document.getElementById(map[k]);
			if (el && typeof COUNTS[k] === "number") el.textContent = fmt(COUNTS[k]);
		});
	}

	// ---- Codeforces — count distinct OK-verdict submissions ----
	function fetchCodeforces(handle) {
		return fetchWithTimeout(
			"https://codeforces.com/api/user.status?handle=" + encodeURIComponent(handle) +
				"&from=1&count=10000",
			{}, 9000
		).then(function (r) { return r.json(); })
		 .then(function (d) {
			if (d.status !== "OK") throw new Error("CF API failed");
			var solved = {};
			(d.result || []).forEach(function (s) {
				if (s.verdict !== "OK") return;
				var p = s.problem || {};
				var key = (p.contestId || "X") + ":" + (p.index || "?");
				solved[key] = 1;
			});
			COUNTS.codeforces = Object.keys(solved).length;
		 });
	}

	// ---- CodeChef — scrape "Total Problems Solved: <N>" from profile HTML ----
	// CodeChef has no public API; we fetch the HTML through the same CORS
	// proxy chain used elsewhere in this file. The first proxy that responds
	// wins; the rest are skipped.
	var CC_PROXIES = [
		function (u) { return "https://corsproxy.io/?" + encodeURIComponent(u); },
		function (u) { return "https://api.allorigins.win/raw?url=" + encodeURIComponent(u); },
		function (u) { return "https://api.codetabs.com/v1/proxy/?quest=" + encodeURIComponent(u); }
	];
	function fetchCodechef(handle, idx) {
		idx = idx || 0;
		if (idx >= CC_PROXIES.length) return Promise.reject(new Error("CC: all proxies failed"));
		var url = CC_PROXIES[idx]("https://www.codechef.com/users/" + encodeURIComponent(handle));
		return fetchWithTimeout(url, {}, 8000)
			.then(function (r) {
				if (!r.ok) throw new Error("CC proxy " + idx + " status " + r.status);
				return r.text();
			})
			.then(function (html) {
				var m = html.match(/Total\s+Problems\s+Solved\s*[:<\/h>3 ]*\s*(\d{1,5})/i);
				if (!m) throw new Error("CC: count not found in HTML");
				COUNTS.codechef = parseInt(m[1], 10);
			})
			.catch(function () { return fetchCodechef(handle, idx + 1); });
	}

	// ---- AtCoder — rated-contests count ------------------------------------
	// AtCoder doesn't publish a CORS-friendly endpoint for "problems solved"
	// (kenkoooo's `ac_rank` API now 403s every request from outside their
	// frontend). The closest stat we CAN fetch reliably is the contest
	// history JSON at `/users/<handle>/history/json` — that endpoint has
	// permissive CORS and returns one entry per contest, with `IsRated`
	// flagging the rated ones. Counting `IsRated === true` gives us the
	// number AtCoder itself shows on the user's profile (a meaningful
	// engagement signal, even if it isn't problems-solved).
	//
	// If you ever migrate AtCoder back to a problems-solved API, bring
	// kenkoooo or its successor back here and bump the `cp_stats_v*` cache.
	var AC_PROXIES = [
		function (u) { return "https://corsproxy.io/?" + encodeURIComponent(u); },
		function (u) { return "https://api.allorigins.win/raw?url=" + encodeURIComponent(u); },
		function (u) { return "https://api.codetabs.com/v1/proxy/?quest=" + encodeURIComponent(u); }
	];

	function fetchAtcoder(handle) {
		var URL = "https://atcoder.jp/users/" + encodeURIComponent(handle) + "/history/json";
		// Try direct first — AtCoder's history endpoint is CORS-friendly in
		// modern browsers (Access-Control-Allow-Origin: *). Fall back to
		// the proxy chain only if a regional block or transient outage
		// kicks in.
		return fetchWithTimeout(URL, {}, 7000)
			.then(function (r) {
				if (!r.ok) throw new Error("AC status " + r.status);
				return r.json();
			})
			.then(function (history) {
				if (!Array.isArray(history)) throw new Error("AC: bad history");
				var rated = history.filter(function (h) { return h && h.IsRated; }).length;
				if (!rated) throw new Error("AC: zero rated");
				COUNTS.atcoder = rated;
			})
			.catch(function () { return fetchAtcoderViaProxy(URL, 0); });
	}

	function fetchAtcoderViaProxy(targetUrl, idx) {
		if (idx >= AC_PROXIES.length) return Promise.reject(new Error("AC: all proxies failed"));
		return fetchWithTimeout(AC_PROXIES[idx](targetUrl), {}, 8000)
			.then(function (r) {
				if (!r.ok) throw new Error("status " + r.status);
				return r.json();
			})
			.then(function (history) {
				if (!Array.isArray(history)) throw new Error("bad payload");
				var rated = history.filter(function (h) { return h && h.IsRated; }).length;
				if (!rated) throw new Error("zero rated");
				COUNTS.atcoder = rated;
			})
			.catch(function () { return fetchAtcoderViaProxy(targetUrl, idx + 1); });
	}

	// ---- Cache hit? Use it immediately, then refresh in background. ----
	try {
		var cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
		if (cached && cached.ts && (Date.now() - cached.ts) < CACHE_TTL && cached.counts) {
			COUNTS = Object.assign({}, cached.counts);
			paint();
		}
	} catch (e) { /* ignore */ }

	// ---- Fetch all three in parallel; any failure leaves "—" in place ----
	dataSourceStarted();
	Promise.allSettled([
		fetchCodeforces(row.querySelector('[data-cp-platform="codeforces"]').getAttribute("data-cp-handle")),
		fetchCodechef(row.querySelector('[data-cp-platform="codechef"]').getAttribute("data-cp-handle")),
		fetchAtcoder(row.querySelector('[data-cp-platform="atcoder"]').getAttribute("data-cp-handle"))
	]).then(function () {
		paint();
		try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), counts: COUNTS })); } catch (e) {}
	}).finally(dataSourceDone);
})();

// ===== Per-repo metadata — LOC, languages, creation date =====
// For every featured repository card (`[data-gh-repo]`), pull live metadata
// from `api.github.com/repos/<owner>/<repo>` plus the language byte-count
// from `/languages`. The repo size in KB is converted into an approximate
// "lines of code" figure assuming ~30 bytes per line of source — a
// conservative average across the languages I write in.
//
// GitHub's unauthenticated rate limit is 60 req/hr per IP, so we cache each
// repo's data for 6 hours and fail silently if rate-limited (the static
// description in each card is already enough information).
(function () {
	var cards = document.querySelectorAll("[data-gh-repo]");
	if (!cards.length) return;
	var OWNER = "AbhJ";
	var CACHE_KEY = "gh_repo_meta_v1";
	var CACHE_TTL = 6 * 60 * 60 * 1000;     // 6 hours

	// Canonical github-linguist colors for the chips
	var LANG_COLORS = {
		"JavaScript": "#f1e05a", "TypeScript": "#3178c6", "Python": "#3572A5",
		"Java": "#b07219", "C++": "#f34b7d", "C": "#555555", "HTML": "#e34c26",
		"CSS": "#563d7c", "SCSS": "#c6538c", "Shell": "#89e051", "Go": "#00ADD8",
		"Rust": "#dea584", "Ruby": "#701516", "Swift": "#F05138", "Kotlin": "#A97BFF",
		"Dart": "#00B4AB", "PHP": "#4F5D95", "Jupyter Notebook": "#DA5B0B",
		"Makefile": "#427819", "Dockerfile": "#384d54", "Vue": "#41b883",
		"Objective-C": "#438eff", "Lua": "#000080", "Haskell": "#5e5086",
		"Perl": "#0298c3", "Scala": "#c22d40", "R": "#198CE7", "Matlab": "#e16737",
		"JSON": "#4d8a4a"
	};

	function readCache() {
		try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}") || {}; }
		catch (e) { return {}; }
	}
	function writeCache(data) {
		try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch (e) {}
	}

	function formatDate(iso) {
		if (!iso) return "";
		var d = new Date(iso);
		if (isNaN(d.getTime())) return "";
		var months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
		return months[d.getMonth()] + " " + d.getFullYear();
	}

	// Approximate lines-of-code from total bytes per language. The
	// average bytes-per-line varies (~25 for terse C++, ~50 for verbose
	// HTML/JSON), so a single conservative divisor gives us a useful
	// order-of-magnitude figure. Better to under-state than over-state.
	function formatLoc(bytesByLang) {
		var BYTES_PER_LINE = {
			"C++": 28, "C": 26, "Java": 36, "Python": 30, "JavaScript": 32,
			"TypeScript": 34, "Go": 28, "Rust": 30, "Shell": 28, "HTML": 50,
			"CSS": 38, "SCSS": 38, "Vue": 38, "Ruby": 30, "JSON": 60
		};
		var total = 0;
		Object.keys(bytesByLang || {}).forEach(function (lang) {
			var bpl = BYTES_PER_LINE[lang] || 32;
			total += Math.round(bytesByLang[lang] / bpl);
		});
		if (!total) return "—";
		if (total >= 100000) return (total / 1000).toFixed(0) + "k";
		if (total >= 10000)  return (total / 1000).toFixed(1) + "k";
		if (total >= 1000)   return (total / 1000).toFixed(2) + "k";
		return String(total);
	}

	function renderLangs(card, bytesByLang) {
		var container = card.querySelector("[data-gh-langs]");
		if (!container) return;
		var entries = Object.keys(bytesByLang || {}).map(function (k) {
			return { name: k, bytes: bytesByLang[k] };
		}).sort(function (a, b) { return b.bytes - a.bytes; });
		var top = entries.slice(0, 3);  // top 3 languages per card
		if (!top.length) { container.innerHTML = ""; return; }
		container.innerHTML = top.map(function (e) {
			var color = LANG_COLORS[e.name] || "#888";
			return '<span class="gh-lang-chip">' +
				'<span class="gh-lang-dot" style="background:' + color + '"></span>' +
				e.name +
				'</span>';
		}).join("");
	}

	function applyMeta(card, meta) {
		if (!meta) return;
		var locEl = card.querySelector("[data-gh-loc]");
		var dateEl = card.querySelector("[data-gh-created]");
		if (locEl) locEl.textContent = formatLoc(meta.langs || {});
		if (dateEl) dateEl.textContent = formatDate(meta.created_at) || "—";
		renderLangs(card, meta.langs || {});
	}

	function fetchOne(repo) {
		// Two API calls in parallel: repo metadata + language byte counts
		var base = "https://api.github.com/repos/" + OWNER + "/" + repo;
		return Promise.all([
			fetchWithTimeout(base, {}, 8000).then(function (r) { return r.ok ? r.json() : Promise.reject(new Error("repo " + r.status)); }),
			fetchWithTimeout(base + "/languages", {}, 8000).then(function (r) { return r.ok ? r.json() : Promise.reject(new Error("langs " + r.status)); })
		]).then(function (parts) {
			return { created_at: parts[0].created_at, langs: parts[1] || {} };
		});
	}

	var cache = readCache();
	var now = Date.now();
	var fetchTasks = [];

	cards.forEach(function (card) {
		var repo = card.getAttribute("data-gh-repo");
		// Use cache if fresh
		if (cache[repo] && cache[repo].ts && (now - cache[repo].ts) < CACHE_TTL) {
			applyMeta(card, cache[repo]);
			return;
		}
		// Otherwise queue a fetch
		fetchTasks.push(
			fetchOne(repo)
				.then(function (meta) {
					cache[repo] = Object.assign({ ts: now }, meta);
					applyMeta(card, meta);
				})
				.catch(function () { /* keep static fallback */ })
		);
	});

	if (!fetchTasks.length) return;
	dataSourceStarted();
	Promise.all(fetchTasks).then(function () {
		writeCache(cache);
	}).finally(dataSourceDone);
})();

// ===== GitHub Profile Stats — scraped from profile page (no API rate limit) =====
(function () {
	var USERNAME = "AbhJ";
	var CACHE_KEY = "gh_profile_stats";
	var CACHE_TTL = 60 * 60 * 1000; // 1 hour

	function applyStats(d) {
		var el;
		if ((el = document.getElementById("gh-repos"))) el.textContent = d.public_repos || "—";
		if ((el = document.getElementById("gh-followers"))) el.textContent = d.followers || "—";
		if ((el = document.getElementById("gh-following"))) el.textContent = d.following || "—";
		if ((el = document.getElementById("gh-since"))) el.textContent = d.since || "—";
	}

	function cacheAndApply(stats) {
		applyStats(stats);
		try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data: stats })); } catch (e) {}
	}

	// Try cache first
	dataSourceStarted();
	try {
		var cached = localStorage.getItem(CACHE_KEY);
		if (cached) {
			var parsed = JSON.parse(cached);
			if (parsed.data) applyStats(parsed.data);
			if (parsed.ts && (Date.now() - parsed.ts) < CACHE_TTL) { dataSourceDone(); return; }
		}
	} catch (e) {}

	// Primary: scrape profile page via CORS proxy (not rate-limited)
	var proxyUrl = "https://api.codetabs.com/v1/proxy/?quest=" + encodeURIComponent("https://github.com/" + USERNAME);
	fetchWithTimeout(proxyUrl)
		.then(function (r) { return r.ok ? r.text() : ""; })
		.then(function (html) {
			if (!html || html.length < 1000) throw new Error("Empty");
			var stats = { since: "2019" };
			// Repos from Counter class
			var tabs = html.match(/Counter[^>]*>(\d+)/g);
			if (tabs && tabs.length > 0) {
				stats.public_repos = parseInt(tabs[0].match(/(\d+)/)[1], 10);
			}
			// Followers/following from text-bold pattern
			var fm = html.match(/text-bold[^>]*>(\d+)<\/span>\s*followers/);
			if (fm) stats.followers = parseInt(fm[1], 10);
			var gm = html.match(/text-bold[^>]*>(\d+)<\/span>\s*following/);
			if (gm) stats.following = parseInt(gm[1], 10);
			// Joined year from profile page
			var joined = html.match(/Joined.*?datetime="(\d{4})/);
			if (joined) stats.since = joined[1];

			if (stats.public_repos || stats.followers) {
				cacheAndApply(stats);
			} else {
				throw new Error("Parse failed");
			}
		})
		.catch(function () {
			// Fallback: GitHub REST API (may be rate-limited)
			return fetchWithTimeout("https://api.github.com/users/" + USERNAME)
				.then(function (r) { return r.ok ? r.json() : null; })
				.then(function (d) {
					if (!d || d.message) return;
					cacheAndApply({
						public_repos: d.public_repos,
						followers: d.followers,
						following: d.following,
						since: d.created_at ? d.created_at.slice(0, 4) : "—"
					});
				})
				.catch(function () {});
		})
		.finally(dataSourceDone);
})();

// ===== GitHub Contribution Heatmap — scrapes GitHub's real contribution graph =====
// Primary: Fetches the GitHub contributions HTML page via CORS proxy (same data as profile).
// Fallback: GitHub Events API + direct Commits API for key repos.
// This avoids the 60 req/hr unauthenticated API rate limit entirely.
(function () {
	var USERNAME = "AbhJ";
	var hmGridEl = document.getElementById("gh-hm-grid");
	var hmMonthsEl = document.getElementById("gh-hm-months");
	var tooltip = document.getElementById("gh-heatmap-tooltip");
	var statusEl = document.getElementById("gh-heatmap-status");
	if (!hmGridEl) return;

	// Local refs to values that ABJ_HM also computes internally — used here
	// for the GitHub `since=` query, and for resolving tooltip-parsed dates
	// to grid years. Keeping them in this scope makes the IIFE self-contained.
	var MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
	var today = new Date(); today.setHours(0, 0, 0, 0);
	var startDay = new Date(today);
	// 53-week window, Sunday-aligned — matches ABJ_HM.create's internal default.
	startDay.setDate(startDay.getDate() - (53 * 7 - 1) - today.getDay());

	// useLevel flag — set to true when we have GitHub's level data
	var useLevel = false;

	function levelClassByCount(count) {
		if (count === 0) return "hm-l-0";
		if (count <= 2) return "hm-l-1";
		if (count <= 5) return "hm-l-2";
		if (count <= 10) return "hm-l-3";
		if (count <= 20) return "hm-l-4";
		return "hm-l-4";
	}

	function levelClassByLevel(level) {
		return "hm-l-" + Math.max(0, Math.min(4, level | 0));
	}

	var hm = ABJ_HM.create({
		gridEl: hmGridEl,
		monthsEl: hmMonthsEl,
		tooltipEl: tooltip,
		levelClass: function (count, cell) {
			if (useLevel) return levelClassByLevel(cell.level || 0);
			return levelClassByCount(count);
		},
		labelFor: function (cell) {
			var dateStr = cell.date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
			if (cell.count > 0) {
				return cell.count + " contribution" + (cell.count !== 1 ? "s" : "") + " on " + dateStr;
			}
			if (cell.level > 0) {
				return "Contributions on " + dateStr;
			}
			return "No contributions on " + dateStr;
		}
	});

	// ---- PRIMARY: Scrape GitHub contributions HTML via CORS proxy ----
	// GitHub's contributions page returns HTML with data-date and data-level attributes,
	// plus tooltip text with exact counts. NOT rate-limited like the REST API.
	var CORS_PROXIES = [
		function (url) { return "https://api.codetabs.com/v1/proxy/?quest=" + encodeURIComponent(url); },
		function (url) { return "https://api.allorigins.win/raw?url=" + encodeURIComponent(url); },
		function (url) { return "https://corsproxy.io/?" + encodeURIComponent(url); }
	];
	var GH_CONTRIB_URL = "https://github.com/users/" + USERNAME + "/contributions";

	function parseContributionsHTML(html) {
		var contribs = {}; // { "YYYY-MM-DD": { level: N, count: N } }

		// Parse data-date and data-level from td cells
		var cellRegex = /data-date="(\d{4}-\d{2}-\d{2})"[^>]*data-level="(\d)"/g;
		var match;
		while ((match = cellRegex.exec(html)) !== null) {
			var dateKey = match[1];
			var level = parseInt(match[2], 10);
			contribs[dateKey] = { level: level, count: 0 };
		}

		// Parse tooltip text for exact contribution counts
		// Format: "N contribution(s) on Month Dayth." or "No contributions on Month Dayth."
		var tipRegex = /(\d+)\s+contributions?\s+on\s+(\w+)\s+(\d+)\w*/g;
		var tipMatch;
		while ((tipMatch = tipRegex.exec(html)) !== null) {
			var count = parseInt(tipMatch[1], 10);
			var monthName = tipMatch[2];
			var day = parseInt(tipMatch[3], 10);
			// We need to figure out the year — match against our grid
			// Try current year first, then previous year
			var monthIdx = MONTH_NAMES.indexOf(monthName.slice(0, 3));
			if (monthIdx === -1) {
				// Try full month name mapping
				var fullMonths = ["January","February","March","April","May","June",
					"July","August","September","October","November","December"];
				monthIdx = fullMonths.indexOf(monthName);
			}
			if (monthIdx >= 0 && count > 0) {
				// Try both years in our range
				var yearNow = today.getFullYear();
				var candidates = [
					yearNow + "-" + String(monthIdx + 1).padStart(2, "0") + "-" + String(day).padStart(2, "0"),
					(yearNow - 1) + "-" + String(monthIdx + 1).padStart(2, "0") + "-" + String(day).padStart(2, "0")
				];
				for (var ci = 0; ci < candidates.length; ci++) {
					if (contribs[candidates[ci]]) {
						contribs[candidates[ci]].count = count;
						break;
					}
				}
			}
		}

		return contribs;
	}

	function fetchContribsViaProxy(proxyIdx, callback) {
		if (proxyIdx >= CORS_PROXIES.length) {
			callback(null);
			return;
		}
		var proxyUrl = CORS_PROXIES[proxyIdx](GH_CONTRIB_URL);
		fetchWithTimeout(proxyUrl)
			.then(function (r) {
				if (!r.ok) throw new Error("Proxy " + proxyIdx + " returned " + r.status);
				return r.text();
			})
			.then(function (html) {
				if (!html || html.indexOf("data-date") === -1) {
					throw new Error("Invalid HTML from proxy " + proxyIdx);
				}
				var contribs = parseContributionsHTML(html);
				callback(contribs);
			})
			.catch(function () {
				fetchContribsViaProxy(proxyIdx + 1, callback);
			});
	}

	// ---- Direct Commits API for key repos (catches ALL commits regardless of email) ----
	// Cached in localStorage to avoid burning the 60 req/hr unauthenticated rate limit.
	var KEY_REPOS = ["some-cp-files-3", "cp", "some-cp-files-2", "some-cp-files-1", "public-portfolio", "abj-blogs"];
	var CACHE_KEY = "gh_heatmap_repo_commits";
	var CACHE_TTL = 60 * 60 * 1000; // 1 hour

	function fetchRepoCommits(repos, callback) {
		// Try cache first
		try {
			var cached = localStorage.getItem(CACHE_KEY);
			if (cached) {
				var parsed = JSON.parse(cached);
				if (parsed.ts && (Date.now() - parsed.ts) < CACHE_TTL && parsed.data) {
					callback(parsed.data);
					return;
				}
			}
		} catch (e) {}

		var repoCommits = {};
		var done = 0;
		if (repos.length === 0) { callback(repoCommits); return; }
		repos.forEach(function (repo) {
			var url = "https://api.github.com/repos/" + USERNAME + "/" + repo +
				"/commits?per_page=100&since=" + startDay.toISOString();
			fetchWithTimeout(url)
				.then(function (r) { return r.ok ? r.json() : []; })
				.then(function (commits) {
					if (!Array.isArray(commits)) { commits = []; }
					commits.forEach(function (c) {
						if (!c.commit || !c.commit.author) return;
						var dateKey = c.commit.author.date.slice(0, 10);
						repoCommits[dateKey] = (repoCommits[dateKey] || 0) + 1;
					});
				})
				.catch(function () {})
				.finally(function () {
					done++;
					if (done === repos.length) {
						// Cache results
						try {
							localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data: repoCommits }));
						} catch (e) {}
						callback(repoCommits);
					}
				});
		});
	}

	// ---- Main fetch logic ----
	// 1. Try GitHub contributions HTML via CORS proxy (official graph data)
	// 2. ALWAYS also fetch direct repo commits (catches unlinked-email commits)
	// 3. Merge both sources — take the higher count per day
	dataSourceStarted(); // register GitHub heatmap as a data source
	var contribData = null;  // from contributions HTML
	var repoData = null;     // from direct repo Commits API
	var sourcesDone = 0;
	var totalSources = 2;

	function mergeAndDraw() {
		sourcesDone++;
		if (sourcesDone < totalSources) return; // wait for both

		// Build per-day data and feed it to the DOM heatmap.
		var counts = {};   // date → count
		var levels = {};   // date → level (0-4)

		if (contribData) {
			useLevel = true;
			Object.keys(contribData).forEach(function (dateKey) {
				levels[dateKey] = contribData[dateKey].level;
				counts[dateKey] = contribData[dateKey].count || 0;
			});
		}

		if (repoData) {
			Object.keys(repoData).forEach(function (dateKey) {
				var fromRepo = repoData[dateKey];
				// Take the higher count between contributions HTML and repo commits.
				if (!counts[dateKey] || fromRepo > counts[dateKey]) counts[dateKey] = fromRepo;
				// Promote level if we found commits but the HTML thought level=0.
				if (fromRepo > 0 && (!levels[dateKey] || levels[dateKey] === 0)) {
					if (fromRepo <= 2) levels[dateKey] = 1;
					else if (fromRepo <= 5) levels[dateKey] = 2;
					else if (fromRepo <= 10) levels[dateKey] = 3;
					else levels[dateKey] = 4;
				}
			});
		}

		hm.update(counts, levels);

		// Update status text with total contributions over the year.
		var total = 0;
		Object.keys(counts).forEach(function (k) { total += counts[k] || 0; });
		if (statusEl && total > 0) {
			statusEl.textContent = "(" + total + " contributions)";
		}

		dataSourceDone(); // GitHub heatmap finished
	}

	// Source 1: Contributions HTML
	fetchContribsViaProxy(0, function (contribs) {
		contribData = contribs;
		mergeAndDraw();
	});

	// Source 2: Direct repo commits (always runs — catches unlinked emails)
	fetchRepoCommits(KEY_REPOS, function (commits) {
		repoData = commits;
		mergeAndDraw();
	});
})();

// ===== Beyond Code — Goodreads bookshelf (dynamic) =====
// Pulls my top-rated reads from the public Goodreads RSS feed:
//   /review/list_rss/<user_id>?shelf=read&per_page=200
// Goodreads doesn't expose CORS, so we route through a public RSS-to-JSON
// service first (rss2json.com — the only one that's reliably up across
// regions in our testing) and fall back to a chain of generic CORS proxies
// returning the raw XML. Cached in localStorage for 1 hour.
//
// The static HTML in index.html is a fallback — JS only replaces it on
// a successful fetch + parse. If every endpoint fails, the page still
// shows real books (just slightly out of date).
//
// Per book card: cover, star rating, title, author, date rated.
(function () {
	var grid = document.getElementById("bookshelf-grid");
	if (!grid) return;
	// Paint skeleton tiles while we wait for the live fetch. Keeps the
	// shelf height stable and signals "loading" to the user.
	if (!grid.children.length) {
		var n = parseInt(grid.getAttribute("data-shelf-skeleton") || "0", 10);
		var skel = "";
		for (var s = 0; s < n; s++) {
			skel += '<div class="book-skeleton" aria-hidden="true">' +
				'<div class="book-cover-wrap"></div></div>';
		}
		grid.innerHTML = skel;
	}
	var USER_ID = grid.getAttribute("data-gr-user") || "139705685";
	// rss2json caps the free tier at 10 items per request, and the underlying
	// Goodreads RSS feed obeys our sort/order params. To get a richer mix we
	// hit two sort orders in parallel and merge: highest-rated + most-
	// recently-rated. Each is at most 10 items, but the union (after dedupe
	// by book id) typically gives us 15-18 unique books — plenty for the
	// shelf, with the cap of MAX_CARDS at the render step.
	function buildFeedUrl(sort) {
		return "https://www.goodreads.com/review/list_rss/" + USER_ID +
			"?shelf=read&per_page=200&sort=" + sort + "&order=d";
	}
	var FEED_BY_RATING    = buildFeedUrl("rating");
	var FEED_BY_DATE_READ = buildFeedUrl("date_read");
	// v5 = extracted images from description blob, dropped per-author dedupe
	//      + 16-card cap so every 4★/5★ entry rendered.
	// v6 = added series-clubbing (one Berserk card with a "× N vols" badge),
	//      which subtly changes what `render()` returns — bump the key so
	//      anyone with v5 data cached doesn't see a stale shelf where books
	//      like AI Superpowers appear after the un-clubbed Berserk pile but
	//      not after the clubbed one.
	// v7 = lowered MIN_RATING from 4 to 3 + filtered manga out of the Books
	//      shelf (mangas now live in their own MAL-fed section).
	// v8 = removed the static HTML fallback entirely (shelf is fully data-
	//      driven now) and added paintBookStats() so the Books / Avg Rating
	//      cells render from the same payload as the shelf.
	// v9 = MIN_RATING dropped from 3 → 1 (every non-manga book renders).
	//      Bump invalidates v8 caches that were partial 5-or-6-book sets.
	var CACHE_KEY = "gr_books_v9";
	var CACHE_TTL = 60 * 60 * 1000;  // 1 hour
	// Show every non-manga book on the read shelf, regardless of rating.
	// (Earlier this was 4 — only highlighted 4★ and 5★ — which made the
	// shelf feel sparse. We still highlight 5★ visually via a hover-glow
	// but we no longer hide lower-rated books.)
	var MIN_RATING = 1;

	// Manga authors to exclude from the Books shelf — those entries already
	// appear in the dedicated Manga section (MyAnimeList-fed), so showing
	// them here too is duplication. Exposed on `window.ABJ_BOOKS` so the
	// static-DOM clubber (separate IIFE below) can apply the same filter.
	var MANGA_AUTHORS = {
		"kentaro miura": 1,
		"eiichiro oda": 1,
		"buronson": 1,
		"tetsuo hara": 1,
		"yoshihiro togashi": 1,
		"masashi kishimoto": 1,
		"hajime isayama": 1,
		"akira toriyama": 1,
		"naoki urasawa": 1,
		"hirohiko araki": 1,
		"gege akutami": 1,
		"koyoharu gotouge": 1,
		"tatsuya endo": 1,
		"tite kubo": 1,
		"chika umino": 1,
		"makoto yukimura": 1,
		"junji ito": 1,
		"haruichi furudate": 1
	};
	function isMangaAuthor(name) {
		if (!name) return false;
		var key = String(name).toLowerCase().replace(/\s+/g, " ").trim();
		return !!MANGA_AUTHORS[key];
	}
	window.ABJ_BOOKS = window.ABJ_BOOKS || {};
	window.ABJ_BOOKS.isMangaAuthor = isMangaAuthor;

	// ---- Source 1: rss2json (returns parsed JSON; no manual XML parsing) --
	function fetchOneRss2Json(feedUrl) {
		var url = "https://api.rss2json.com/v1/api.json?rss_url=" +
			encodeURIComponent(feedUrl);
		return fetchWithTimeout(url, {}, 8000)
			.then(function (r) {
				if (!r.ok) throw new Error("rss2json status " + r.status);
				return r.json();
			})
			.then(function (data) {
				if (!data || data.status !== "ok" || !Array.isArray(data.items)) {
					throw new Error("rss2json returned no items");
				}
				return data.items.map(itemFromRss2Json).filter(Boolean);
			});
	}
	function fetchViaRss2Json() {
		// Run both calls in parallel; succeed if at least one returns books.
		// `Promise.allSettled` keeps one failure from killing both.
		return Promise.allSettled([
			fetchOneRss2Json(FEED_BY_RATING),
			fetchOneRss2Json(FEED_BY_DATE_READ),
		]).then(function (results) {
			var merged = [];
			results.forEach(function (r) {
				if (r.status === "fulfilled" && Array.isArray(r.value)) {
					merged = merged.concat(r.value);
				}
			});
			if (!merged.length) throw new Error("Both rss2json calls returned empty");
			// Dedupe by book id, keeping the first (highest-rated) occurrence
			var seen = {};
			return merged.filter(function (b) {
				if (!b.id) return true;
				if (seen[b.id]) return false;
				seen[b.id] = true;
				return true;
			});
		});
	}

	// ---- Source 2: generic CORS proxies returning raw XML ----
	// We actually PREFER this path now: rss2json's free tier caps the
	// response at 10 items per request, but a CORS-proxied raw XML fetch
	// returns the entire shelf in one shot (all 90+ items). That's what we
	// need to render every 4★/5★ book. rss2json stays as the secondary
	// source for resilience if every CORS proxy is down.
	var PROXIES = [
		function (u) { return "https://corsproxy.io/?" + encodeURIComponent(u); },
		function (u) { return "https://api.allorigins.win/raw?url=" + encodeURIComponent(u); },
		function (u) { return "https://api.codetabs.com/v1/proxy/?quest=" + encodeURIComponent(u); }
	];
	function fetchViaProxies(idx) {
		idx = idx || 0;
		if (idx >= PROXIES.length) return Promise.reject(new Error("All proxies failed"));
		// FEED_BY_RATING returns books sorted highest-to-lowest user rating,
		// which is exactly the order we render in.
		return fetchWithTimeout(PROXIES[idx](FEED_BY_RATING), {}, 9000)
			.then(function (r) {
				if (!r.ok) throw new Error("Proxy " + idx + " status " + r.status);
				return r.text();
			})
			.then(function (xml) {
				if (!xml || xml.indexOf("<item>") < 0) {
					throw new Error("Proxy " + idx + " returned no items");
				}
				return parseRSS(xml);
			})
			.catch(function () { return fetchViaProxies(idx + 1); });
	}

	// Trim noisy long-form titles for the card. Goodreads titles often look
	// like "System Design Interview – An insider's guide" or "Berserk, Vol. 1
	// (Berserk, #1)" — drop the subtitle after a colon/em-dash and any
	// trailing series-number parenthesis. Falls back to the full title.
	function compactTitle(t) {
		if (!t) return "";
		// 1. Drop "(Series, #N)" trailing parenthesis
		t = t.replace(/\s*\([^()]*#\d+[^()]*\)\s*$/, "");
		// 2. Drop subtitle after a colon, en-dash, or em-dash followed by
		//    whitespace. Only do it when the main part is at least 8
		//    characters so we don't over-trim short titles.
		var split = t.split(/\s*[–—:]\s+/);
		if (split.length > 1 && split[0].length >= 8) {
			t = split[0];
		}
		return t.trim();
	}

	// ---- rss2json item → unified book record ----
	// rss2json flattens Goodreads' XML; the structured fields we need
	// (rating, dates) are NOT in the JSON top-level, but ARE embedded in
	// the `description` blob as plain text like `rating: 5<br>` and
	// `date added: 2026/03/25<br>`. Parse them out with a few regexes.
	function itemFromRss2Json(item) {
		var desc = item.description || item.content || "";
		// IMPORTANT: Goodreads' description has TWO `rating:` lines —
		//   average rating: 4.27   ← public Goodreads consensus
		//   rating: 5              ← my personal rating
		// Match the line that ends with a single integer (no decimal),
		// preceded by "rating:" not "average rating:". Negative lookbehind
		// works in modern browsers and Node — falls back to a non-LB
		// regex if unsupported.
		var ratingMatch;
		try {
			ratingMatch = desc.match(/(?<!average\s)rating:\s*(\d+)(?!\.)/i);
		} catch (e) {
			// Older Safari may reject lookbehind syntax; do it the manual way
			var lines = desc.split(/<br\s*\/?>/i);
			for (var li = 0; li < lines.length; li++) {
				var ln = lines[li];
				if (/^\s*rating:\s*\d+\s*$/i.test(ln)) {
					ratingMatch = ln.match(/rating:\s*(\d+)/i);
					break;
				}
			}
		}
		var rating = parseInt((ratingMatch || [])[1] || "0", 10);
		if (rating <= 0) return null;
		var readAt = (desc.match(/read at:\s*([\d/]+)/i) || [])[1] || "";
		var added  = (desc.match(/date added:\s*([\d/]+)/i) || [])[1] || "";
		// rss2json's "thumbnail" is the small _SY75_ variant; strip the size
		// suffix so the browser can request a higher-resolution copy.
		// IMPORTANT: when the feed is sorted by `date_read` rss2json drops the
		// `thumbnail` field entirely — even though the cover URL is still
		// present inside the `description` HTML's `<img src="…">`. Fall back
		// to that so cards never render with a blank `<img src="">` (which
		// the browser silently resolves to the page URL and shows broken).
		var img = (item.thumbnail || "").replace(/\._S[XY]\d+_/g, "");
		if (!img) {
			var imgM = desc.match(/<img[^>]+src=["']([^"']+gr-assets[^"']+)["']/i);
			if (imgM) img = imgM[1].replace(/\._S[XY]\d+_/g, "");
		}
		// Author is in the description blob too: "author: Alex Xu<br>"
		var author = (desc.match(/author:\s*([^<\n]+)/i) || [])[1] || "";
		// `link` from rss2json points at the review page; we want the BOOK
		// page so the card click leads where readers expect.
		var bookId = (img.match(/books\/\d+l\/(\d+)/) || [])[1] || "";
		var title = item.title || "";
		var displayTitle = compactTitle(title);
		return {
			id: bookId, title: title, displayTitle: displayTitle,
			author: author.trim(), image: img, rating: rating,
			ratedAt: (readAt || added).replace(/\//g, "-"),  // "2026/03/25" → "2026-03-25" parses cleaner
		};
	}

	// ---- Direct XML parse — used when rss2json is unreachable ----
	// Goodreads' feed wraps almost every value in CDATA, which makes
	// DOMParser awkward. Targeted regexes are simpler and less fragile
	// across browsers (Safari handles CDATA inconsistently).
	function decodeCdata(s) {
		if (!s) return "";
		var m = s.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
		s = m ? m[1] : s;
		return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
	}
	function tag(item, name) {
		var re = new RegExp("<" + name + ">([\\s\\S]*?)<\\/" + name + ">", "i");
		var m = item.match(re);
		return m ? decodeCdata(m[1]).trim() : "";
	}
	function parseRSS(xml) {
		var out = [];
		var itemRe = /<item>([\s\S]*?)<\/item>/g;
		var m;
		while ((m = itemRe.exec(xml)) !== null) {
			var item = m[1];
			var rating = parseInt(tag(item, "user_rating"), 10) || 0;
			if (rating <= 0) continue;
			var bookId = tag(item, "book_id");
			var title  = tag(item, "title");
			var author = tag(item, "author_name");
			var img    = tag(item, "book_large_image_url") || tag(item, "book_medium_image_url") || tag(item, "book_image_url");
			var readAt = tag(item, "user_read_at");
			var added  = tag(item, "user_date_created") || tag(item, "user_date_added");
			img = img.replace(/\._S[XY]\d+_/g, "");
			var displayTitle = compactTitle(title);
			out.push({
				id: bookId, title: title, displayTitle: displayTitle,
				author: author, image: img, rating: rating,
				ratedAt: readAt || added,
			});
		}
		return out;
	}

	// Pretty-print a date as "Jan 12, 2025" for compact display.
	var MONTH = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
	function formatDate(s) {
		if (!s) return "";
		var d = new Date(s);
		if (isNaN(d.getTime())) return "";
		return MONTH[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear();
	}

	function escapeHTML(s) {
		return String(s || "")
			.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
	}

	function render(books) {
		// Keep books at MIN_RATING or above, and skip manga (those have a
		// dedicated section fed by MyAnimeList).
		books = books.filter(function (b) {
			return b.rating >= MIN_RATING && !isMangaAuthor(b.author);
		});
		// Sort: rating desc, then most recently rated first within each tier
		books.sort(function (a, b) {
			if (b.rating !== a.rating) return b.rating - a.rating;
			var ta = new Date(a.ratedAt || 0).getTime();
			var tb = new Date(b.ratedAt || 0).getTime();
			return tb - ta;
		});
		// Dedupe by book id (some feeds repeat).
		var seenById = {};
		var deduped = [];
		for (var i = 0; i < books.length; i++) {
			var b = books[i];
			var key = b.id || (b.title + "|" + b.author);
			if (seenById[key]) continue;
			seenById[key] = true;
			deduped.push(b);
		}

		// Club multi-volume series (Berserk Vol. 1 … Vol. 41, etc.) into a
		// single representative card. Without this the shelf is dominated by
		// dozens of near-identical Berserk and Fist-of-the-North-Star covers
		// when the live Goodreads fetch lands. The detection is generic — it
		// works for any series with "Vol N", "(Series, #N)", "[Series N]", or
		// a trailing volume number — so it'll keep up as new volumes are
		// rated without per-series hand-coding.
		var groups = {};
		var picks = [];
		deduped.forEach(function (b) {
			var sk = window.ABJ_SERIES.keyFor(b.displayTitle || b.title, b.author);
			if (!sk) {
				picks.push(b);
				return;
			}
			var gkey = sk + "::" + (b.author || "").toLowerCase();
			if (!groups[gkey]) {
				groups[gkey] = { rep: b, count: 1, seriesName: window.ABJ_SERIES.prettyName(sk) };
				picks.push(groups[gkey]);
			} else {
				groups[gkey].count++;
				// Keep the highest-rated rep; ties broken by most-recently-rated
				var rep = groups[gkey].rep;
				var better = (b.rating > rep.rating) ||
					(b.rating === rep.rating && new Date(b.ratedAt || 0) > new Date(rep.ratedAt || 0));
				if (better) groups[gkey].rep = b;
			}
		});

		var html = picks.map(function (entry) {
			var b, count, seriesName;
			if (entry && entry.rep) {
				b = entry.rep; count = entry.count; seriesName = entry.seriesName;
			} else {
				b = entry; count = 1;
			}
			var fivestar = b.rating === 5 ? " book-card--star5" : "";
			var clubbed = count > 1 ? " book-card--series" : "";
			var titleText = count > 1 ? seriesName : b.displayTitle;
			var seriesBadge = count > 1
				? '<span class="book-series-count" aria-label="' + count + ' volumes in this series">' + count + ' vols</span>'
				: '';
			var ariaLabel = count > 1
				? seriesName + " — " + count + " volumes, all rated " + b.rating + " of 5 on Goodreads"
				: b.title + " — rated " + b.rating + " of 5 on Goodreads";
			return (
				'<a class="book-card' + fivestar + clubbed + '" ' +
				'href="https://www.goodreads.com/book/show/' + escapeHTML(b.id) + '" ' +
				'target="_blank" rel="noopener" ' +
				'aria-label="' + escapeHTML(ariaLabel) + '">' +
					'<div class="book-cover-wrap">' +
						'<img src="' + escapeHTML(b.image) + '" alt="' + escapeHTML(b.title) + '" loading="lazy" decoding="async">' +
						'<span class="book-rating" aria-label="Rated ' + b.rating + ' of 5">' + b.rating + '★</span>' +
						seriesBadge +
					'</div>' +
					'<div class="book-title">' + escapeHTML(titleText) + '</div>' +
					'<div class="book-author">' + escapeHTML(b.author) + '</div>' +
				'</a>'
			);
		}).join("");

		// Atomic swap to avoid layout flash
		grid.innerHTML = html;
	}

	// Update the Books stat cards (Books Read / Currently Reading / Avg
	// Rating) from the same RSS payload. The to-read / Plan-to-Read cell
	// has its own loader (it hits a different shelf URL).
	function paintBookStats(books) {
		// Total = everything on the read shelf, including manga (it's still
		// "books read" — the user-facing count from Goodreads).
		var total = books.length;
		// Avg of the user's actual ratings on Goodreads (only entries with
		// rating > 0). Skip manga from the average to mirror the shelf.
		var rated = books.filter(function (b) { return b.rating > 0 && !isMangaAuthor(b.author); });
		var avg = rated.length
			? (rated.reduce(function (s, x) { return s + x.rating; }, 0) / rated.length)
			: 0;
		var elTotal = document.getElementById("books-read");
		if (elTotal && total) elTotal.textContent = total;
		var elAvg = document.getElementById("books-avg");
		if (elAvg && avg) elAvg.innerHTML = avg.toFixed(2) + '<span class="gh-stat-unit">/ 5</span>';
	}

	// Count of cards `render()` would emit for a given book list, mirroring
	// its filters exactly. Used to decide whether the live fetch returned
	// enough qualifying entries to be worth clobbering the static fallback.
	function countRenderable(books) {
		return books.filter(function (b) {
			return b.rating >= MIN_RATING && !isMangaAuthor(b.author);
		}).length;
	}

	// `floor` = the minimum acceptable shelf size. We never render fewer
	// books than this. The baked file (data/books.js) sets the floor; any
	// other source — localStorage cache, live RSS — must beat it to win.
	// This prevents a stale cache or a capped rss2json response from
	// shrinking the shelf below the snapshot count.
	var floor = 0;

	// 1. Paint the baked snapshot from data/books.js. Never optional.
	if (window.ABJ_BOOKS_DATA && Array.isArray(window.ABJ_BOOKS_DATA.books)) {
		render(window.ABJ_BOOKS_DATA.books);
		var baked = window.ABJ_BOOKS_DATA;
		var elTotal = document.getElementById("books-read");
		if (elTotal && baked.meta && baked.meta.totalRead) elTotal.textContent = baked.meta.totalRead;
		var elAvg = document.getElementById("books-avg");
		if (elAvg && baked.meta && baked.meta.avgRating) {
			elAvg.innerHTML = baked.meta.avgRating.toFixed(2) + '<span class="gh-stat-unit">/ 5</span>';
		}
		floor = countRenderable(baked.books);
	}

	// 2. Consider the localStorage cache only if it BEATS the baked
	//    snapshot. Otherwise a stale 6-book cache from before the
	//    MIN_RATING change would clobber today's 18-book baked file.
	try {
		var cached = localStorage.getItem(CACHE_KEY);
		if (cached) {
			var parsed = JSON.parse(cached);
			if (parsed.ts && (Date.now() - parsed.ts) < CACHE_TTL &&
			    parsed.books && parsed.books.length &&
			    countRenderable(parsed.books) > floor) {
				render(parsed.books);
				paintBookStats(parsed.books);
				floor = countRenderable(parsed.books);
			}
		}
	} catch (e) { /* localStorage unavailable; ignore */ }

	// 3. Refresh from live RSS. Same rule: only overwrite the shelf when
	//    the live source returns at least `floor` qualifying books.
	dataSourceStarted();
	fetchViaProxies()
		.catch(function () { return fetchViaRss2Json(); })
		.then(function (books) {
			if (!books || !books.length) throw new Error("No rated books in feed");
			if (countRenderable(books) < floor) {
				// Live source is incomplete (rss2json hit the 10-item cap,
				// or a proxy returned a partial body). Keep the baked /
				// cached render in place; it's already on screen.
				return;
			}
			render(books);
			paintBookStats(books);
			try {
				localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), books: books }));
			} catch (e) {}
		})
		.catch(function (err) {
			if (window.console) console.warn("Goodreads fetch failed:", err && err.message);
		})
		.finally(dataSourceDone);
})();

// ===== Beyond Code — Goodreads shelf counters =====
// Fetches `to-read` and `currently-reading` item counts from the user's
// public Goodreads RSS, writing the numbers into the matching stat cards.
// Uses the same proxy chain the main Goodreads loader uses + rss2json as
// a final fallback. Each shelf is cached separately for an hour.
(function () {
	var USER_ID = "139705685";
	var CACHE_TTL = 60 * 60 * 1000;
	var SHELVES = [
		{ shelf: "to-read",           cellId: "books-toread",   cacheKey: "gr_toread_v2"  },
		{ shelf: "currently-reading", cellId: "books-reading",  cacheKey: "gr_reading_v1" }
	];
	var PROXIES = [
		function (u) { return "https://corsproxy.io/?" + encodeURIComponent(u); },
		function (u) { return "https://api.allorigins.win/raw?url=" + encodeURIComponent(u); },
		function (u) { return "https://api.codetabs.com/v1/proxy/?quest=" + encodeURIComponent(u); }
	];

	function feedUrl(shelf) {
		return "https://www.goodreads.com/review/list_rss/" + USER_ID +
			"?shelf=" + shelf + "&per_page=200";
	}

	function tryProxies(url, idx) {
		idx = idx || 0;
		if (idx >= PROXIES.length) return Promise.reject(new Error("all proxies failed"));
		return fetchWithTimeout(PROXIES[idx](url), {}, 8000)
			.then(function (r) { if (!r.ok) throw new Error("status " + r.status); return r.text(); })
			.then(function (xml) {
				if (!xml || xml.indexOf("<item>") < 0) throw new Error("empty");
				var n = (xml.match(/<item>/g) || []).length;
				if (n <= 0) throw new Error("zero");
				return n;
			})
			.catch(function () { return tryProxies(url, idx + 1); });
	}

	function tryRss2Json(url) {
		var u = "https://api.rss2json.com/v1/api.json?rss_url=" + encodeURIComponent(url);
		return fetchWithTimeout(u, {}, 8000)
			.then(function (r) { if (!r.ok) throw new Error("rss2json " + r.status); return r.json(); })
			.then(function (j) {
				if (!j || j.status !== "ok" || !Array.isArray(j.items) || !j.items.length) {
					throw new Error("rss2json: no items");
				}
				return j.items.length;
			});
	}

	function paint(cellId, n) {
		var el = document.getElementById(cellId);
		if (el && typeof n === "number" && n > 0) el.textContent = n;
	}

	SHELVES.forEach(function (s) {
		var el = document.getElementById(s.cellId);
		if (!el) return;
		var url = feedUrl(s.shelf);

		try {
			var cached = JSON.parse(localStorage.getItem(s.cacheKey) || "null");
			if (cached && cached.ts && (Date.now() - cached.ts) < CACHE_TTL) paint(s.cellId, cached.n);
		} catch (e) {}

		dataSourceStarted();
		tryProxies(url)
			.catch(function () { return tryRss2Json(url); })
			.then(function (n) {
				paint(s.cellId, n);
				try { localStorage.setItem(s.cacheKey, JSON.stringify({ ts: Date.now(), n: n })); } catch (e) {}
			})
			.catch(function (err) {
				if (window.console) console.warn("Goodreads " + s.shelf + " fetch failed:", err && err.message);
				// Cell stays at "—" if no cache and no live fetch.
			})
			.finally(dataSourceDone);
	});
})();

// ===== Beyond Code — IMDb films shelf + stat cards (data-driven) =====
// IMDb itself is CloudFront-WAF blocked from any static site (we tested
// every CORS proxy + the IMDb GraphQL endpoint — both gated). So the
// canonical source for this section is `data/films.js`, loaded as a
// plain <script> tag in index.html so the page works on file:// too
// (Chrome blocks fetch() on local files for security).
//
// Schema (window.ABJ_FILMS):
//   {
//     "updated": "YYYY-MM-DD",
//     "meta": { "titlesRated": N, "currentlyWatching": N,
//               "avgRating": N.N, "planToWatch": N },
//     "films": [
//       { "href": "...", "img": "...", "title": "...",
//         "meta": "year · director", "rating": 9 }, …
//     ]
//   }
(function () {
	var grid = document.getElementById("filmshelf-grid");
	if (!grid) return;

	function escapeAttr(s) {
		return String(s || "")
			.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
	}

	function renderShelf(films) {
		// Sort by rating desc, then alpha — stable visual order.
		films = films.slice().sort(function (a, b) {
			if (b.rating !== a.rating) return b.rating - a.rating;
			return (a.title || "").localeCompare(b.title || "");
		});
		grid.innerHTML = films.map(function (f) {
			return (
				'<a class="film-card" href="' + escapeAttr(f.href) + '" target="_blank" rel="noopener" ' +
				'aria-label="' + escapeAttr(f.title) + ' — rated ' + f.rating + ' of 10 on IMDb">' +
					'<div class="film-poster-wrap">' +
						'<img src="' + escapeAttr(f.img) + '" alt="' + escapeAttr(f.title) + '" loading="lazy" decoding="async">' +
						'<span class="film-rating" aria-label="Rated ' + f.rating + ' of 10">' + f.rating + '</span>' +
					'</div>' +
					'<div class="film-title">' + escapeAttr(f.title) + '</div>' +
					(f.meta ? '<div class="film-meta">' + escapeAttr(f.meta) + '</div>' : '') +
				'</a>'
			);
		}).join("");
	}

	function paintStats(meta) {
		if (!meta) return;
		var set = function (id, v) {
			var el = document.getElementById(id);
			if (el && v != null && v !== "") el.textContent = v;
		};
		var setRating = function (id, v) {
			var el = document.getElementById(id);
			if (!el || !v) return;
			el.innerHTML = '' + v + '<span class="gh-stat-unit">/ 10</span>';
		};
		set("imdb-rated", meta.titlesRated);
		set("imdb-watching", meta.currentlyWatching);
		setRating("imdb-avg", typeof meta.avgRating === "number"
			? meta.avgRating.toFixed(1) : meta.avgRating);
		set("imdb-towatch", meta.planToWatch);
	}

	var data = window.ABJ_FILMS;
	if (!data) {
		// data/films.js didn't load (or didn't expose the global). Show a
		// skeleton so the layout doesn't collapse.
		if (!grid.children.length) {
			var n = parseInt(grid.getAttribute("data-shelf-skeleton") || "0", 10);
			var skel = "";
			for (var s = 0; s < n; s++) {
				skel += '<div class="film-skeleton" aria-hidden="true">' +
					'<div class="film-poster-wrap"></div></div>';
			}
			grid.innerHTML = skel;
		}
		if (window.console) console.warn("ABJ_FILMS not defined — is data/films.js loaded?");
		return;
	}

	if (Array.isArray(data.films)) renderShelf(data.films);
	if (data.meta) paintStats(data.meta);
})();

// ===== Beyond Code — Static bookshelf series clubbing =====
// The Goodreads fetch above clubs series before rendering, but if the live
// fetch fails or returns fewer cards than the static fallback the static
// markup stays in place. That fallback ships with every Berserk volume,
// every Fist of the North Star volume, etc. — exactly the duplication the
// user wants collapsed. This pass walks the static cards already in the
// DOM, groups them with the same ABJ_SERIES rules used for the live data,
// and rewrites the shelf into a deduped form. Runs once at load; no
// network. If the live fetch later succeeds, its render() replaces what
// we did here, which is fine — both produce the same clubbed shape.
(function () {
	var grid = document.getElementById("bookshelf-grid");
	if (!grid || !window.ABJ_SERIES) return;

	function readCards() {
		var nodes = grid.querySelectorAll(".book-card");
		var out = [];
		nodes.forEach(function (node) {
			var img = node.querySelector(".book-cover-wrap img");
			var titleEl = node.querySelector(".book-title");
			var authorEl = node.querySelector(".book-author");
			var ratingEl = node.querySelector(".book-rating");
			if (!img || !titleEl) return;
			// Recover the rating from class or the badge text ("5★").
			var rating = node.classList.contains("book-card--star5") ? 5 : 0;
			if (!rating && ratingEl) {
				var rm = (ratingEl.textContent || "").match(/(\d+)/);
				if (rm) rating = parseInt(rm[1], 10);
			}
			// Prefer the longer alt text — it's the original Goodreads title
			// (e.g. "Berserk, Vol. 4 (Berserk, #4)") which the series rules
			// can match. The card's visible .book-title is the trimmed form.
			var fullTitle = img.getAttribute("alt") || titleEl.textContent || "";
			var displayTitle = (titleEl.textContent || "").trim();
			out.push({
				node: node,
				href: node.getAttribute("href") || "",
				img: img.getAttribute("src") || "",
				fullTitle: fullTitle.trim(),
				displayTitle: displayTitle,
				author: (authorEl ? authorEl.textContent : "").trim(),
				rating: rating || 4
			});
		});
		return out;
	}

	function clubAndRewrite() {
		var cards = readCards();
		if (cards.length < 2) return;

		// Drop manga-author cards entirely — they live in their own section
		// (MyAnimeList-fed). Without this, the static fallback would still
		// ship every Berserk / Fist of the North Star / One Piece volume.
		var isManga = (window.ABJ_BOOKS && window.ABJ_BOOKS.isMangaAuthor) || function () { return false; };
		var filteredCards = cards.filter(function (c) { return !isManga(c.author); });
		var droppedManga = filteredCards.length !== cards.length;
		cards = filteredCards;
		if (cards.length < 1) return;

		var groups = {};
		var order = [];
		cards.forEach(function (c) {
			var sk = window.ABJ_SERIES.keyFor(c.fullTitle, c.author);
			if (!sk) {
				order.push({ kind: "single", card: c });
				return;
			}
			var gkey = sk + "::" + c.author.toLowerCase();
			if (!groups[gkey]) {
				groups[gkey] = {
					kind: "series",
					rep: c,
					count: 1,
					seriesName: window.ABJ_SERIES.prettyName(sk)
				};
				order.push(groups[gkey]);
			} else {
				groups[gkey].count++;
				if (c.rating > groups[gkey].rep.rating) groups[gkey].rep = c;
			}
		});

		// Rewrite if we actually collapsed something OR dropped a manga
		// card. Skipping the rewrite when only manga-authors were filtered
		// would leave the static markup intact and the section unchanged.
		var collapsed = false;
		Object.keys(groups).forEach(function (k) { if (groups[k].count > 1) collapsed = true; });
		if (!collapsed && !droppedManga) return;

		function escapeAttr(s) {
			return String(s || "")
				.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
				.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
		}

		var html = order.map(function (entry) {
			var c, count, displayTitle, ariaLabel, badge;
			if (entry.kind === "series" && entry.count > 1) {
				c = entry.rep; count = entry.count;
				// Use the series name only for actual multi-volume groups.
				displayTitle = entry.seriesName;
				ariaLabel = entry.seriesName + " — " + count +
					" volumes, all rated " + c.rating + " of 5 on Goodreads";
				badge = '<span class="book-series-count" aria-label="' + count +
					' volumes in this series">' + count + ' vols</span>';
			} else {
				// Singletons keep their own title — even if they happened to
				// match the series-detection rules (e.g. "A Study in Scarlet
				// (Sherlock Holmes, #1)" should render as "A Study in Scarlet",
				// not "Sherlock Holmes").
				c = entry.kind === "series" ? entry.rep : entry.card;
				count = 1;
				displayTitle = c.displayTitle;
				ariaLabel = c.fullTitle + " — rated " + c.rating + " of 5 on Goodreads";
				badge = "";
			}
			var fivestar = c.rating === 5 ? " book-card--star5" : "";
			var clubbed = count > 1 ? " book-card--series" : "";
			return (
				'<a class="book-card' + fivestar + clubbed + '" ' +
				'href="' + escapeAttr(c.href) + '" target="_blank" rel="noopener" ' +
				'aria-label="' + escapeAttr(ariaLabel) + '">' +
					'<div class="book-cover-wrap">' +
						'<img src="' + escapeAttr(c.img) + '" alt="' + escapeAttr(c.fullTitle) + '" loading="lazy" decoding="async">' +
						'<span class="book-rating" aria-label="Rated ' + c.rating + ' of 5">' + c.rating + '★</span>' +
						badge +
					'</div>' +
					'<div class="book-title">' + escapeAttr(displayTitle) + '</div>' +
					'<div class="book-author">' + escapeAttr(c.author) + '</div>' +
				'</a>'
			);
		}).join("");

		grid.innerHTML = html;
	}

	// Run on DOM ready — synchronous against current static cards.
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", clubAndRewrite);
	} else {
		clubAndRewrite();
	}
})();

// ===== Beyond Code — Music: 5 random tracks from the Lounge playlist =====
// Replaces the hand-picked 3-song fallback in #music-grid with 5 tracks
// drawn at random (per page load) from a public Apple Music playlist URL
// declared via `data-music-playlist` on the grid.
//
// Apple's Music API requires a developer token, but the public playlist
// page conveniently embeds a JSON-LD `<script type="application/ld+json">`
// block that lists every `track` with `url` (the canonical track URL) and
// `byArtist`. We scrape that via the same CORS proxy chain used by the
// Goodreads loader. From each track URL we pull the album/track ids and
// build the standard `embed.music.apple.com` iframe URL.
//
// Cached in localStorage for an hour so the playlist scrape happens at
// most once per session-ish; the random pick still re-runs on every load
// so the visible 5 tracks rotate.
(function () {
	var grid = document.getElementById("music-grid");
	if (!grid) return;
	var playlistUrl = grid.getAttribute("data-music-playlist") || "";
	var COUNT = parseInt(grid.getAttribute("data-music-count") || "5", 10);
	if (!playlistUrl) return;

	// Bumped to v2 when we switched parsing from `application/ld+json` (which
	// Apple doesn't actually emit for playlist pages) to the
	// `serialized-server-data` blob — anything cached under v1 is broken.
	var CACHE_KEY = "music_lounge_v2";
	var CACHE_TTL = 60 * 60 * 1000; // 1 hour
	var PROXIES = [
		function (u) { return "https://corsproxy.io/?" + encodeURIComponent(u); },
		function (u) { return "https://api.allorigins.win/raw?url=" + encodeURIComponent(u); },
		function (u) { return "https://api.codetabs.com/v1/proxy/?quest=" + encodeURIComponent(u); }
	];

	function escapeAttr(s) {
		return String(s || "")
			.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
	}

	// "https://music.apple.com/in/album/foo/123456789?i=987654321"
	//   ^storefront                ^slug   ^album id      ^track id
	function parseTrackUrl(href) {
		if (!href) return null;
		var m = href.match(/music\.apple\.com\/([a-z]{2})\/album\/([^\/?#]+)\/(\d+)(?:\?.*?\bi=(\d+))?/i);
		if (!m) return null;
		return { storefront: m[1].toLowerCase(), slug: m[2], albumId: m[3], trackId: m[4] || "" };
	}

	// Build an embed URL Apple's iframe will accept. The storefront and slug
	// matter — embeds with a wrong storefront for a region-locked track render
	// "Song Not Available" (this is what was happening to "Fire Burning —
	// Sean Kingston" when we hard-coded `/us/album/x/`). Preserve the
	// original locale + slug exactly as it came out of the playlist.
	function buildEmbedUrl(href) {
		var ids = parseTrackUrl(href);
		if (!ids) return null;
		var u = "https://embed.music.apple.com/" + ids.storefront +
			"/album/" + ids.slug + "/" + ids.albumId;
		if (ids.trackId) u += "?i=" + ids.trackId;
		return u;
	}

	// Fisher-Yates for a uniform shuffle.
	function shuffle(arr) {
		var a = arr.slice();
		for (var i = a.length - 1; i > 0; i--) {
			var j = Math.floor(Math.random() * (i + 1));
			var t = a[i]; a[i] = a[j]; a[j] = t;
		}
		return a;
	}

	// Returns a SHUFFLED pool (size up to ~3×n) of unique, embeddable tracks.
	// `render()` consumes the pool head-first and uses the tail as a backup
	// queue when individual iframes fail to load.
	function shuffledPool(tracks, n) {
		var pool = tracks.filter(function (t) { return buildEmbedUrl(t.url); });
		if (!pool.length) return [];
		// Dedupe by trackId so the same song doesn't show up twice
		var seen = {};
		pool = pool.filter(function (t) {
			var ids = parseTrackUrl(t.url);
			var k = ids ? (ids.trackId || ids.albumId) : t.url;
			if (seen[k]) return false;
			seen[k] = true;
			return true;
		});
		return shuffle(pool).slice(0, Math.max(n * 3, n + 6));
	}

	// Render `count` cards from `pool`. Each card auto-replaces itself with
	// the next track in `pool` if its iframe fails to load (or never fires
	// `load` within 6 s — a common symptom of a region-locked or de-listed
	// track Apple renders as a permanent "currently unavailable" frame).
	// This is what was causing "Fire Burning — Sean Kingston" to show as
	// blank: that track is unembeddable from some storefronts and the iframe
	// never finished loading.
	function render(pool, count) {
		if (!pool || !pool.length) return;
		// Used + queue: first `count` tracks are visible; the rest are kept
		// as a swap pool for any failed iframe.
		var visible = pool.slice(0, count);
		var queue = pool.slice(count);
		grid.innerHTML = "";

		visible.forEach(function (track, i) {
			var col = document.createElement("div");
			col.className = "col-lg-4 col-md-6 mb-4 music-slot";
			grid.appendChild(col);
			mountTrack(col, track, i);
		});

		function mountTrack(col, track, slotIdx) {
			var embed = buildEmbedUrl(track.url);
			var label = (track.title || "") + (track.artist ? " — " + track.artist : "");
			col.innerHTML =
				'<iframe allow="autoplay *; encrypted-media *; fullscreen *; clipboard-write" ' +
				'frameborder="0" class="apple-music-song" ' +
				'sandbox="allow-forms allow-popups allow-same-origin allow-scripts allow-storage-access-by-user-activation allow-top-navigation-by-user-activation" ' +
				'src="' + escapeAttr(embed) + '" loading="eager"></iframe>' +
				'<p class="song-label">' + escapeAttr(label) + '</p>';

			var iframe = col.querySelector("iframe");
			if (!iframe) return;
			var loaded = false;
			iframe.addEventListener("load", function () {
				loaded = true;
				// Once a frame has loaded, give Apple's DOM a beat to render.
				// If the iframe is essentially empty after that (most often
				// the "Song Not Available" sentinel page), swap.
				setTimeout(function () { probeFrame(col, track, iframe, slotIdx); }, 1200);
			});
			iframe.addEventListener("error", function () { swap(col, slotIdx, "error"); });
			// If neither load nor error fires within 7s, treat it as failed.
			setTimeout(function () {
				if (!loaded) swap(col, slotIdx, "timeout");
			}, 7000);
		}

		// Same-origin probing of an Apple iframe is blocked by CORS, so we
		// can't introspect its content document. The next-best signal we
		// can read cross-origin is the iframe's `clientHeight` — Apple
		// renders the unavailable sentinel at 0px / collapsed height because
		// our CSS gives it a fixed 175px frame. In practice we rely on the
		// load timeout above; this hook stays for future enhancement.
		function probeFrame(col, track, iframe, slotIdx) {
			// If the height collapsed to almost nothing, treat as failed.
			if (iframe.clientHeight < 50) swap(col, slotIdx, "collapsed");
		}

		function swap(col, slotIdx, reason) {
			if (!col || !col.parentNode) return;
			var next = queue.shift();
			if (!next) return;
			if (window.console) console.info("[music] swapping slot " + slotIdx + " (" + reason + ")");
			mountTrack(col, next, slotIdx);
		}
	}

	// Parse Apple's playlist HTML.
	//
	// We try TWO sources, in order:
	//   1. <script type="application/ld+json"> — the schema.org MusicPlaylist
	//      block. Cleanly structured but Apple sometimes ships the page
	//      without it.
	//   2. <script type="application/json" id="serialized-server-data"> — the
	//      Apple-internal page state. Always present. We don't rely on the
	//      schema; we just pull every `/album/<slug>/<albumId>?i=<trackId>`
	//      URL plus the nearest `"title":"…"` and `"subtitleLinks":[{"title":"<artist>"`
	//      that precede it.
	//
	// Each parsed track has { url, title, artist }.
	function parseTracksFromHtml(html) {
		if (!html) return [];
		var tracks = [];

		// ---- Source 1: ld+json (graceful, when present) ----
		var ldBlocks = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
		if (ldBlocks) {
			ldBlocks.forEach(function (block) {
				var inner = block.replace(/^[\s\S]*?<script[^>]*>/i, "").replace(/<\/script>[\s\S]*$/i, "");
				try {
					var data = JSON.parse(inner);
					var arr = Array.isArray(data) ? data : [data];
					arr.forEach(function (entry) {
						var list = entry && entry.track;
						if (!Array.isArray(list)) return;
						list.forEach(function (t) {
							if (!t || !t.url) return;
							var artist = "";
							if (typeof t.byArtist === "string") artist = t.byArtist;
							else if (t.byArtist && t.byArtist.name) artist = t.byArtist.name;
							else if (Array.isArray(t.byArtist) && t.byArtist[0]) artist = t.byArtist[0].name || "";
							tracks.push({ url: t.url, title: t.name || "", artist: artist });
						});
					});
				} catch (e) { /* keep trying other blocks */ }
			});
		}
		if (tracks.length) return tracks;

		// ---- Source 2: serialized-server-data (Apple's own page state) ----
		// The blob is large (~1MB). We don't JSON.parse it (too slow + brittle
		// against Apple's frequent shape changes). Instead, walk the string
		// and extract every track lockup: the canonical track URL is at
		// `"contentDescriptor":{"kind":"song", … "url":"…"}`. The nearest
		// preceding `"title":"…"` is the song name; the nearest following
		// `"subtitleLinks":[{"title":"<artist>"` is the artist.
		var serMatch = html.match(/<script[^>]+id=["']serialized-server-data["'][^>]*>([\s\S]*?)<\/script>/i);
		if (!serMatch) return tracks;
		var raw = serMatch[1];

		// Each song in the playlist appears inside a `track-lockup` object
		// shaped roughly like:
		//   { "id":"track-lockup - <playlistId> - <trackId>",
		//     "title":"<song name>",
		//     "trackNumber":null,
		//     "tertiaryLinks":[{ "title":"<album name>", … }],
		//     "duration": …,
		//     "contentDescriptor":{ "kind":"song", "url":"…?i=<trackId>" },
		//     "subtitleLinks":[{ "title":"<artist>", … }]
		//   }
		//
		// We anchor on the lockup `id` (it's stable across editions and
		// regions) and parse the next ~8 KB of text to pull out the song
		// title, the track URL, and the artist name.
		var lockupRe = /"id"\s*:\s*"track-lockup\s*[-–—]\s*[^"]+\s*[-–—]\s*(\d+)"/g;
		var seen = {};
		var m;
		while ((m = lockupRe.exec(raw)) !== null) {
			var trackId = m[1];
			if (seen[trackId]) continue;
			var slice = raw.slice(m.index, m.index + 8000);
			// Title — the FIRST `"title":"…"` inside the lockup is the song
			// name (`"title":"Shape of You"`).
			var titleMatch = slice.match(/"title"\s*:\s*"((?:[^"\\]|\\.)*)"/);
			var title = titleMatch ? unescapeJsonString(titleMatch[1]) : "";
			// URL — the song-kind contentDescriptor's `url` field.
			var urlMatch = slice.match(/"contentDescriptor"\s*:\s*\{\s*"kind"\s*:\s*"song"[\s\S]*?"url"\s*:\s*"([^"]+\?i=\d+)"/);
			if (!urlMatch) continue;
			var url = urlMatch[1].replace(/\\u002F/g, "/").replace(/\\\//g, "/");
			seen[trackId] = true;
			// Artist — the first `"title":"…"` inside `subtitleLinks`.
			var artistMatch = slice.match(/"subtitleLinks"\s*:\s*\[\s*\{\s*"title"\s*:\s*"((?:[^"\\]|\\.)*)"/);
			var artist = artistMatch ? unescapeJsonString(artistMatch[1]) : "";
			tracks.push({ url: url, title: title, artist: artist });
		}

		// Belt-and-braces fallback: if the lockup walk missed everything
		// (Apple changes the page shape from time to time), pull every
		// `/album/…?i=…` URL we can find. We lose titles & artists but the
		// embeds still play, which is the headline behaviour the user asked
		// for: 5 random songs from the Lounge playlist.
		if (!tracks.length) {
			var anyRe = /"url"\s*:\s*"(https:\/\/music\.apple\.com\/[^"]+\/album\/[^"]+\?i=\d+)"/g;
			while ((m = anyRe.exec(raw)) !== null) {
				var url2 = m[1];
				var tid = (url2.match(/\?i=(\d+)/) || [])[1];
				if (!tid || seen[tid]) continue;
				seen[tid] = true;
				tracks.push({ url: url2, title: "", artist: "" });
			}
		}
		return tracks;
	}

	function unescapeJsonString(s) {
		try { return JSON.parse('"' + s + '"'); } catch (e) { return String(s || ""); }
	}

	function tryProxies(idx) {
		idx = idx || 0;
		if (idx >= PROXIES.length) return Promise.reject(new Error("All music proxies failed"));
		return fetchWithTimeout(PROXIES[idx](playlistUrl), {}, 8000)
			.then(function (r) {
				if (!r.ok) throw new Error("status " + r.status);
				return r.text();
			})
			.then(function (html) {
				var tracks = parseTracksFromHtml(html);
				if (!tracks.length) throw new Error("no tracks");
				return tracks;
			})
			.catch(function () { return tryProxies(idx + 1); });
	}

	// 1. Try cache first — but always re-pick a random subset.
	try {
		var cached = localStorage.getItem(CACHE_KEY);
		if (cached) {
			var parsed = JSON.parse(cached);
			if (parsed.ts && (Date.now() - parsed.ts) < CACHE_TTL && parsed.tracks && parsed.tracks.length >= COUNT) {
				render(shuffledPool(parsed.tracks, COUNT), COUNT);
				return;
			}
		}
	} catch (e) { /* localStorage unavailable; ignore */ }

	dataSourceStarted();
	tryProxies()
		.then(function (tracks) {
			try {
				localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), tracks: tracks }));
			} catch (e) {}
			render(shuffledPool(tracks, COUNT), COUNT);
		})
		.catch(function (err) {
			if (window.console) console.warn("Lounge playlist fetch failed:", err && err.message);
			// Static fallback (3 hand-picked songs) stays in place.
		})
		.finally(dataSourceDone);
})();

// ===== Beyond Code — Manga & Anime shelves from MyAnimeList =====
// MAL doesn't offer a CORS-friendly public API. Their list-page UI calls
// `/{anime,manga}list/<user>/load.json?status=7&offset=<N>` which returns
// JSON pages of ~300 items each — that's what we proxy here through the
// same CORS chain used by Goodreads + the playlist scraper.
//
// Filters by section (different intent, same source):
//   - manga: every entry the user has at least started — status ∈
//     {reading=1, completed=2, on_hold=3, dropped=4}. Plan-to-read=6 is
//     skipped. Image required. Rendered with the .book-card layout so it
//     reads as a sibling shelf to the Goodreads books above.
//   - anime: rated 8/9/10. Rendered as .film-card to match the IMDb shelf.
//
// The static markup ships an empty grid; if every proxy fails the row
// hides itself so the page stays clean. Cached in localStorage for an
// hour to avoid hammering MAL on every page load.
(function () {
	var grids = document.querySelectorAll("[data-mal-list]");
	if (!grids.length) return;

	var CACHE_TTL = 60 * 60 * 1000;
	var PROXIES = [
		function (u) { return "https://corsproxy.io/?" + encodeURIComponent(u); },
		function (u) { return "https://api.allorigins.win/raw?url=" + encodeURIComponent(u); },
		function (u) { return "https://api.codetabs.com/v1/proxy/?quest=" + encodeURIComponent(u); }
	];

	function escapeAttr(s) {
		return String(s || "")
			.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
	}

	// Trim cache-busting `?s=…` off MAL CDN URLs so we don't fetch a new
	// asset every load (MAL keeps the underlying image stable).
	function normalizeImg(url) {
		if (!url) return "";
		return url.split("?")[0];
	}

	// Walk the paginated load.json endpoint until it returns < 300 items.
	// MAL caps each page at 300; for users with tens of entries one page
	// is enough, but the loop is here so this works even if abhj's list
	// grows beyond that.
	function fetchAllPages(kind, user, idx) {
		idx = idx || 0;
		if (idx >= PROXIES.length) return Promise.reject(new Error("mal: all proxies failed"));
		return fetchPagesViaProxy(kind, user, PROXIES[idx])
			.catch(function () { return fetchAllPages(kind, user, idx + 1); });
	}

	function fetchPagesViaProxy(kind, user, proxy) {
		var collected = [];
		function loop(offset) {
			var target = "https://myanimelist.net/" + kind + "list/" +
				encodeURIComponent(user) + "/load.json?offset=" + offset + "&status=7";
			return fetchWithTimeout(proxy(target), {}, 9000)
				.then(function (r) {
					if (!r.ok) throw new Error("status " + r.status);
					return r.json();
				})
				.then(function (page) {
					if (!Array.isArray(page)) throw new Error("not an array");
					collected = collected.concat(page);
					if (page.length < 300) return collected;
					if (offset >= 1500) return collected;  // safety cap
					return loop(offset + page.length);
				});
		}
		return loop(0);
	}

	// MAL's anime payload uses `anime_*` keys; manga uses `manga_*`. The
	// renderer needs a uniform shape, so fold both into one object.
	//
	// MAL list-status enum:
	//   anime: 1=watching, 2=completed, 3=on hold, 4=dropped, 6=plan to watch
	//   manga: 1=reading,  2=completed, 3=on hold, 4=dropped, 6=plan to read
	// Both share the same numeric meaning (1..4 = engaged, 6 = queued).
	var STATUS_LABEL = {
		anime: { 1: "Watching", 2: "Completed", 3: "On Hold", 4: "Dropped", 6: "Plan to Watch" },
		manga: { 1: "Reading",  2: "Completed", 3: "On Hold", 4: "Dropped", 6: "Plan to Read" }
	};

	function normalize(kind, item) {
		var prefix = kind === "anime" ? "anime_" : "manga_";
		var title = item[prefix + "title_eng"] || item[prefix + "title"] || "";
		var url = item[prefix + "url"] || "";
		// MAL URLs are sometimes returned relative ("/anime/12345/Foo")
		if (url && url.indexOf("http") !== 0) url = "https://myanimelist.net" + url;
		var img = normalizeImg(item[prefix + "image_path"]);
		var score = parseInt(item.score, 10) || 0;
		var status = item.status || 0;
		var meta = "";
		var subline = "";
		if (kind === "anime") {
			var eps = item.anime_num_episodes;
			if (eps) meta = eps + (eps === 1 ? " ep" : " eps");
			subline = meta;
		} else {
			// For manga, prefer "X / Y chapters" or "X / Y volumes" when we
			// have the user's read count. That's more informative than the
			// total alone, especially for ongoing series like One Piece.
			var read = item.num_read_chapters || 0;
			var readVol = item.num_read_volumes || 0;
			var totalCh = item.manga_num_chapters || 0;
			var totalVol = item.manga_num_volumes || 0;
			if (readVol && totalVol) subline = readVol + " / " + totalVol + " vols";
			else if (read && totalCh) subline = read + " / " + totalCh + " ch";
			else if (read) subline = read + (read === 1 ? " ch" : " ch");
			else if (totalVol) subline = totalVol + (totalVol === 1 ? " vol" : " vols");
			else if (totalCh) subline = totalCh + (totalCh === 1 ? " ch" : " ch");
			meta = subline;
		}
		return {
			title: title, url: url, img: img, score: score,
			status: status, meta: meta, subline: subline
		};
	}

	// ---- Renderers --------------------------------------------------------
	// Anime keeps the IMDb-style .film-card layout (poster, rating, title,
	// meta). Manga gets the Goodreads-style .book-card layout (cover, badge,
	// title, author/sub-line) so the section reads as a sibling shelf to
	// the Books above it.
	function renderAnime(grid, items) {
		var picks = items
			.filter(function (it) { return it.score >= 8 && it.score <= 10 && it.img; })
			.sort(function (a, b) { return b.score - a.score; });
		if (!picks.length) { grid.style.display = "none"; return; }
		grid.innerHTML = picks.map(function (it) {
			return (
				'<a class="film-card" href="' + escapeAttr(it.url) + '" target="_blank" rel="noopener" ' +
				'aria-label="' + escapeAttr(it.title) + ' — rated ' + it.score + ' of 10 on MyAnimeList">' +
					'<div class="film-poster-wrap">' +
						'<img src="' + escapeAttr(it.img) + '" alt="' + escapeAttr(it.title) + '" loading="lazy" decoding="async">' +
						'<span class="film-rating" aria-label="Rated ' + it.score + ' of 10">' + it.score + '</span>' +
					'</div>' +
					'<div class="film-title">' + escapeAttr(it.title) + '</div>' +
					(it.meta ? '<div class="film-meta">' + escapeAttr(it.meta) + '</div>' : '') +
				'</a>'
			);
		}).join("");
	}

	function renderManga(grid, items) {
		// Show every entry in the user's MAL list (status 1..4 = engaged
		// with, 6 = plan-to-read). Image is the only hard requirement —
		// everything else falls into a sensible default. Engaged entries
		// rank higher than plan-to-read; within each group, score desc.
		function statusRank(s) {
			// 1=reading, 2=completed: engaged-and-active first
			if (s === 1 || s === 2) return 0;
			// 3=on hold, 4=dropped: engaged but stalled
			if (s === 3 || s === 4) return 1;
			// 6=plan-to-read: queued
			if (s === 6) return 2;
			return 3;
		}
		var picks = items
			.filter(function (it) {
				return it.img && (it.status >= 1 && it.status <= 4 || it.status === 6);
			})
			.sort(function (a, b) {
				var ra = statusRank(a.status), rb = statusRank(b.status);
				if (ra !== rb) return ra - rb;
				// Within a group: rated entries first, then by score desc.
				if (b.score !== a.score) return b.score - a.score;
				return 0;
			});
		if (!picks.length) { grid.style.display = "none"; return; }
		grid.innerHTML = picks.map(function (it) {
			// Convert MAL 8-10 to a Goodreads-style 4-5★ for visual rhyme
			// with the books shelf — anything 8+ shows as 5★, anything 6-7
			// shows as 4★, lower or unrated shows no badge.
			var stars = 0;
			if (it.score >= 8) stars = 5;
			else if (it.score >= 6) stars = 4;
			var fivestar = stars === 5 ? " book-card--star5" : "";
			var ratingBadge = stars
				? '<span class="book-rating" aria-label="Rated ' + stars + ' of 5">' + stars + '★</span>'
				: '';
			// Sub-line: for plan-to-read entries, show the status label
			// ("Plan to Read") rather than the manga's full volume count,
			// since the user hasn't read any of it yet. For everything
			// else, prefer the read-progress meta (e.g. "8 / 27 vols").
			var subline = it.status === 6
				? (STATUS_LABEL.manga[6] || "Plan to Read")
				: (it.subline || (STATUS_LABEL.manga[it.status] || ""));
			return (
				'<a class="book-card' + fivestar + '" href="' + escapeAttr(it.url) +
				'" target="_blank" rel="noopener" ' +
				'aria-label="' + escapeAttr(it.title) +
				(it.score ? " — rated " + it.score + " of 10 on MyAnimeList" : " — on MyAnimeList") + '">' +
					'<div class="book-cover-wrap">' +
						'<img src="' + escapeAttr(it.img) + '" alt="' + escapeAttr(it.title) + '" loading="lazy" decoding="async">' +
						ratingBadge +
					'</div>' +
					'<div class="book-title">' + escapeAttr(it.title) + '</div>' +
					'<div class="book-author">' + escapeAttr(subline) + '</div>' +
				'</a>'
			);
		}).join("");
	}

	function render(grid, kind, items) {
		if (kind === "manga") return renderManga(grid, items);
		return renderAnime(grid, items);
	}

	// Update the four stat cards above each shelf. Mirrors the Books / Titles
	// stat row exactly (Total · Currently · Avg Rating · Plan to). Counts
	// derive from raw MAL list items (not the rendered subset) so the
	// numbers reflect the user's full library.
	function paintStats(kind, raw) {
		var label = kind === "manga" ? "manga" : "anime";
		var total = raw.length;
		var currentlyStatus = 1;        // 1 = reading/watching for both kinds
		var planned = raw.filter(function (it) { return it.status === 6; }).length;
		var current = raw.filter(function (it) { return it.status === currentlyStatus; }).length;
		var rated = raw.filter(function (it) {
			var s = parseInt(it.score, 10) || 0;
			return s > 0;
		});
		var avg = rated.length
			? (rated.reduce(function (s, x) { return s + x.score; }, 0) / rated.length)
			: 0;

		function set(id, v) {
			var el = document.getElementById(id);
			if (el && v != null && v !== "") el.textContent = v;
		}
		// "Avg Rating" cell takes a "/ 10" suffix so the scale (MAL is /10)
		// is unambiguous next to the Books shelf, which uses /5.
		function setRating(id, v) {
			var el = document.getElementById(id);
			if (!el) return;
			if (!v) { el.textContent = "—"; return; }
			el.innerHTML = '' + v + '<span class="gh-stat-unit">/ 10</span>';
		}

		// "Total" for the user's library counts only entries they've engaged
		// with — status 1..4 = reading/watching, completed, on hold, dropped.
		// Plan-to-read/watch (status 6) gets its own card, so excluding it
		// here keeps the headline number meaningful.
		var engaged = raw.filter(function (it) {
			return it.status >= 1 && it.status <= 4;
		}).length;

		set("mal-" + label + "-total", engaged);
		set("mal-" + label + "-" + (kind === "manga" ? "reading" : "watching"), current);
		setRating("mal-" + label + "-avg", avg ? avg.toFixed(2) : "");
		set("mal-" + label + "-planned", planned);
	}

	grids.forEach(function (grid) {
		var kind = grid.getAttribute("data-mal-list");
		var user = grid.getAttribute("data-mal-user");
		if (!kind || !user) return;

		// v2 = manga renderer switched to .book-card layout + status-based
		//      inclusion (anything started, not just rated 8+).
		// v3 = manga shelf now also includes plan-to-read entries (status
		//      6) so the row isn't sparse when only a few books have been
		//      started. Bumped so anyone with a v2 cache rerenders.
		var CACHE_KEY = "mal_" + kind + "_v3_" + user;

		// 1. Cache hit — render immediately, then refresh in background.
		try {
			var cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
			if (cached && cached.ts && (Date.now() - cached.ts) < CACHE_TTL && Array.isArray(cached.items)) {
				render(grid, kind, cached.items.map(function (it) { return normalize(kind, it); }));
				paintStats(kind, cached.items);
			}
		} catch (e) { /* ignore */ }

		dataSourceStarted();
		fetchAllPages(kind, user, 0)
			.then(function (raw) {
				try {
					localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), items: raw }));
				} catch (e) {}
				render(grid, kind, raw.map(function (it) { return normalize(kind, it); }));
				paintStats(kind, raw);
			})
			.catch(function (err) {
				if (window.console) console.warn("MAL " + kind + " fetch failed:", err && err.message);
				// If nothing rendered (no cache, fetch failed), hide the
				// empty grid so the page doesn't ship with a blank shelf.
				if (!grid.children.length) grid.style.display = "none";
			})
			.finally(dataSourceDone);
	});
})();

// ===== Beyond Code — Latest YouTube videos =====
// Fetches the channel's public RSS feed via a CORS proxy, parses out the
// two most recent videoIds, and swaps them into the placeholder slots. RSS
// is preferred over the YouTube Data API because it's auth-free and
// rate-limit-friendly. Cached in localStorage for an hour.
(function () {
	var row = document.getElementById("latest-yt-row");
	if (!row) return;
	var CHANNEL_ID = "UC48s7RmRZUXT1fpVULeUAOw";
	var FEED = "https://www.youtube.com/feeds/videos.xml?channel_id=" + CHANNEL_ID;
	var CACHE_KEY = "yt_latest_v1";
	var CACHE_TTL = 60 * 60 * 1000;  // 1 hour
	var slots = row.querySelectorAll("[data-yt-slot]");
	if (slots.length < 2) return;

	function inject(items) {
		for (var i = 0; i < Math.min(2, items.length); i++) {
			var slot = slots[i];
			if (!slot) continue;
			var v = items[i];
			slot.innerHTML =
				'<iframe allowfullscreen ' +
				'src="https://www.youtube.com/embed/' + v.id + '?rel=0" ' +
				'title="' + (v.title || "YouTube video").replace(/"/g, "&quot;") + '" ' +
				'loading="lazy"></iframe>';
		}
		// Hide any unfilled slot so we don't show a half-skeleton
		for (var j = items.length; j < slots.length; j++) {
			slots[j].parentElement.style.display = "none";
		}
	}

	// Try cache first
	try {
		var cached = localStorage.getItem(CACHE_KEY);
		if (cached) {
			var parsed = JSON.parse(cached);
			if (parsed.ts && (Date.now() - parsed.ts) < CACHE_TTL && parsed.items) {
				inject(parsed.items);
				return;
			}
		}
	} catch (e) { /* ignore */ }

	dataSourceStarted();

	function parseRSS(xmlText) {
		var items = [];
		// Each entry has <yt:videoId>VID</yt:videoId> and <title>...</title>
		var entryRe = /<entry>([\s\S]*?)<\/entry>/g;
		var m;
		while ((m = entryRe.exec(xmlText)) !== null) {
			var entry = m[1];
			var idM = /<yt:videoId>([^<]+)<\/yt:videoId>/.exec(entry);
			var titleM = /<title>([^<]+)<\/title>/.exec(entry);
			if (idM) items.push({ id: idM[1], title: titleM ? titleM[1] : "" });
			if (items.length >= 2) break;
		}
		return items;
	}

	// Use the existing CORS proxy already in this codebase (corsproxy.io).
	var proxyUrl = "https://corsproxy.io/?" + encodeURIComponent(FEED);
	fetchWithTimeout(proxyUrl, {}, 7000)
		.then(function (r) { return r.ok ? r.text() : ""; })
		.then(function (xml) {
			if (!xml || xml.indexOf("<entry>") < 0) throw new Error("Bad feed");
			var items = parseRSS(xml);
			if (!items.length) throw new Error("No videos");
			inject(items);
			try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), items: items })); } catch (e) {}
		})
		.catch(function () {
			// Graceful fallback: hide both slots (the channel button below
			// stays visible so visitors can still get to the channel).
			row.style.display = "none";
		})
		.finally(dataSourceDone);
})();

// ===== Resume Modal — in-page PDF viewer with download fallback =====
// Uses event delegation at the document level so the click handler is wired
// even if the page-ready sentinel never resolves (a hanging data source
// would otherwise leave `<main>` with `pointer-events: none` until the 10s
// safety net fires). The resume button must always be reachable.
(function () {
	var modal = document.getElementById("resumeModal");
	var frame = document.getElementById("resumeFrame");
	if (!modal || !frame) return;
	var closeBtn = modal.querySelector(".resume-modal-close");
	var RESUME_URL = "assets/resume-abhj.pdf";

	function open() {
		// Only set src the first time — keeps the modal snappy on re-open
		if (!frame.src || frame.src === "about:blank" || frame.src.indexOf(RESUME_URL) === -1) {
			frame.src = RESUME_URL;
		}
		modal.classList.add("open");
		modal.setAttribute("aria-hidden", "false");
		document.body.classList.add("resume-open");
		// Force-reveal the page if it hasn't already revealed — the resume
		// modal sits at z-index 100001 (above the preloader at 99999), but
		// we don't want a partially-loaded site sitting behind it either.
		if (!document.body.classList.contains("ready")) {
			if (typeof revealPage === "function") revealPage();
		}
	}

	function close() {
		modal.classList.remove("open");
		modal.setAttribute("aria-hidden", "true");
		document.body.classList.remove("resume-open");
	}

	// Delegate the open click to document so the trigger is reachable even
	// while the page is in `body:not(.ready)` mode (which sets
	// `pointer-events: none` on <main>). Capture phase ensures we run before
	// any other handler that might preventDefault.
	document.addEventListener("click", function (e) {
		var trigger = e.target.closest("#openResume");
		if (trigger) {
			e.preventDefault();
			open();
		}
	}, true);

	if (closeBtn) closeBtn.addEventListener("click", close);
	modal.addEventListener("click", function (e) {
		if (e.target === modal) close();
	});
	document.addEventListener("keydown", function (e) {
		if (e.key === "Escape" && modal.classList.contains("open")) close();
	});
})();

/* Hard guarantee: the resume button stays clickable even when the rest of
   <main> is in pointer-events: none state. Inserted via JS so it survives
   any cached CSS. */
(function () {
	var style = document.createElement("style");
	style.textContent = "#openResume{pointer-events:auto !important;position:relative;z-index:2}";
	document.head.appendChild(style);
})();

// ===== WakaTime image error fallback =====
// wakatime.com occasionally returns 502/timeouts on its share-SVG endpoints.
// When the image fails to load, mark the card so CSS shows a friendly hint
// instead of leaving an invisible 0-height blob. Also retry once after 4s
// in case it was a transient hiccup.
(function () {
	var imgs = document.querySelectorAll(".wakatime-card img");
	if (!imgs.length) return;
	imgs.forEach(function (img) {
		var attempted = false;
		img.addEventListener("error", function () {
			img.classList.add("wakatime-img-error");
			img.parentElement && img.parentElement.classList.add("wakatime-card--error");
			if (!attempted) {
				attempted = true;
				// Single retry with a cache-bust after 4s
				setTimeout(function () {
					var sep = img.src.indexOf("?") >= 0 ? "&" : "?";
					var base = img.src.split(/[?&]_r=/)[0];
					img.src = base + sep + "_r=" + Date.now();
				}, 4000);
			}
		});
		// If on retry it loads fine, drop the error classes
		img.addEventListener("load", function () {
			img.classList.remove("wakatime-img-error");
			img.parentElement && img.parentElement.classList.remove("wakatime-card--error");
		});
	});
})();

// ===== Lightbox — fullscreen image viewer for zoom buttons =====
(function () {
	var lightbox = document.getElementById("lightbox");
	var lightboxImg = document.getElementById("lightboxImg");
	if (!lightbox || !lightboxImg) return;
	var closeBtn = lightbox.querySelector(".lightbox-close");

	var LIGHTBOX_BASE_CLASS = "lightbox-img";
	var _activeClass = "";

	function open(src, alt, extraClass) {
		lightboxImg.src = src;
		lightboxImg.alt = alt || "";
		_activeClass = extraClass || "";
		lightboxImg.className = LIGHTBOX_BASE_CLASS + (_activeClass ? " " + _activeClass : "");
		lightbox.classList.add("open");
		lightbox.setAttribute("aria-hidden", "false");
		document.body.classList.add("lightbox-open");
	}

	function close() {
		lightbox.classList.remove("open");
		lightbox.setAttribute("aria-hidden", "true");
		document.body.classList.remove("lightbox-open");
		// Clear src + variant class after transition so the big image drops from memory
		setTimeout(function () {
			if (!lightbox.classList.contains("open")) {
				lightboxImg.src = "";
				lightboxImg.className = LIGHTBOX_BASE_CLASS;
				_activeClass = "";
			}
		}, 350);
	}

	// Any element with data-lightbox-src opens the lightbox.
	// Capture phase ensures we run before any other delegated handler that
	// might preventDefault/stopPropagation on intermediate parents. Without
	// capture, the hero avatar's click was getting swallowed somewhere in
	// the masthead's smooth-scroll chain on certain build-ordering edge cases.
	document.addEventListener("click", function (e) {
		var trigger = e.target.closest("[data-lightbox-src]");
		if (trigger) {
			e.preventDefault();
			e.stopPropagation();
			open(
				trigger.getAttribute("data-lightbox-src"),
				trigger.getAttribute("data-lightbox-alt"),
				trigger.getAttribute("data-lightbox-class")
			);
		}
	}, true);

	// Close on backdrop click, X button, or Escape
	lightbox.addEventListener("click", function (e) {
		if (e.target === lightbox) close();
	});
	if (closeBtn) closeBtn.addEventListener("click", close);
	document.addEventListener("keydown", function (e) {
		if (e.key === "Escape" && lightbox.classList.contains("open")) close();
	});
})();

// ===== Scroll Progress FAB — ring fills as you scroll; flips direction past halfway =====
(function () {
	var fab = document.getElementById("scrollFab");
	if (!fab) return;
	var ring = fab.querySelector(".scroll-fab-progress");
	var CIRC = 2 * Math.PI * 21; // matches r="21" in SVG
	var ticking = false;

	function update() {
		ticking = false;
		var scrollY = window.pageYOffset;
		var max = document.documentElement.scrollHeight - window.innerHeight;
		var pct = max > 0 ? Math.min(scrollY / max, 1) : 0;

		// Show after 120px of scroll
		if (scrollY > 120) fab.classList.add("visible");
		else fab.classList.remove("visible");

		// Flip to "down" arrow when in the top half
		if (pct < 0.5) fab.classList.add("flip");
		else fab.classList.remove("flip");

		// Fill ring
		ring.style.strokeDashoffset = CIRC * (1 - pct);
	}

	function onScroll() {
		if (!ticking) {
			requestAnimationFrame(update);
			ticking = true;
		}
	}

	fab.addEventListener("click", function () {
		var scrollY = window.pageYOffset;
		var max = document.documentElement.scrollHeight - window.innerHeight;
		var pct = max > 0 ? scrollY / max : 0;
		var target = pct < 0.5 ? max : 0;
		window.scrollTo({ top: target, behavior: "smooth" });
	});

	window.addEventListener("scroll", onScroll, { passive: true });
	window.addEventListener("resize", onScroll);
	update();
})();

// ===== Highlight chip deep-link pulse — flashes the target card on arrival =====
(function () {
	document.addEventListener("click", function (e) {
		var link = e.target.closest("a.highlight-chip--link");
		if (!link) return;
		var href = link.getAttribute("href");
		if (!href || href.charAt(0) !== "#") return;
		var target = document.querySelector(href);
		if (!target) return;
		// Let the existing smooth-scroll handler run first; then pulse.
		setTimeout(function () {
			target.classList.remove("pulse");
			void target.offsetWidth; // force reflow so animation restarts
			target.classList.add("pulse");
			setTimeout(function () { target.classList.remove("pulse"); }, 1700);
		}, 650);
	});
})();

// ===== Rotating Hero Subheading — cycles the three one-liners =====
(function () {
	var el = document.getElementById("hero-rotate");
	if (!el) return;
	var lines = [
		'Full Stack Software Engineer',
		'Building enterprise-grade software at scale',
		"B.Tech EECS &middot; IIT Kharagpur"
	];
	var idx = 0;
	setInterval(function () {
		el.classList.add("fade-out");
		setTimeout(function () {
			idx = (idx + 1) % lines.length;
			el.innerHTML = lines[idx];
			el.classList.remove("fade-out");
		}, 400);
	}, 3500);
})();

// ===== GitHub Languages — live aggregate of bytes-per-language across repos =====
// Fetches up to 100 public repos, then the language breakdown for each, sums
// the byte counts, picks the top N by volume, and renders a stacked bar + legend.
// Cached in localStorage for 1h so repeat visits don't hammer the API.
(function () {
	var USERNAME = "AbhJ";
	var CACHE_KEY = "gh_lang_stats_v2"; // bumped when we stopped capping at 25 repos
	var CACHE_TTL = 60 * 60 * 1000; // 1 hour
	var MAX_SEGMENTS = 6;            // top N languages shown in the bar + legend

	// Canonical GitHub language colors (matching github-linguist)
	var LANG_COLORS = {
		"JavaScript": "#f1e05a", "TypeScript": "#3178c6", "Python": "#3572A5",
		"Java": "#b07219", "C++": "#f34b7d", "C": "#555555", "HTML": "#e34c26",
		"CSS": "#563d7c", "SCSS": "#c6538c", "Shell": "#89e051", "Go": "#00ADD8",
		"Rust": "#dea584", "Ruby": "#701516", "Swift": "#F05138", "Kotlin": "#A97BFF",
		"Dart": "#00B4AB", "PHP": "#4F5D95", "Jupyter Notebook": "#DA5B0B",
		"Makefile": "#427819", "Dockerfile": "#384d54", "Vue": "#41b883",
		"Objective-C": "#438eff", "Lua": "#000080", "Haskell": "#5e5086",
		"Perl": "#0298c3", "Scala": "#c22d40", "R": "#198CE7", "Matlab": "#e16737"
	};

	var bar = document.getElementById("gh-langs-bar");
	var legend = document.getElementById("gh-langs-legend");
	var summary = document.getElementById("gh-langs-summary");
	if (!bar || !legend || !summary) return;

	function renderBar(totals) {
		var sum = 0;
		Object.keys(totals).forEach(function (k) { sum += totals[k]; });
		if (!sum) return;

		var entries = Object.keys(totals).map(function (k) {
			return { name: k, bytes: totals[k] };
		}).sort(function (a, b) { return b.bytes - a.bytes; });

		var top = entries.slice(0, MAX_SEGMENTS);
		var restSum = 0;
		entries.slice(MAX_SEGMENTS).forEach(function (e) { restSum += e.bytes; });
		if (restSum > 0) top.push({ name: "Other", bytes: restSum });

		// Build bar
		bar.innerHTML = "";
		top.forEach(function (e) {
			var pct = (e.bytes / sum) * 100;
			var seg = document.createElement("div");
			seg.className = "gh-langs__bar-seg";
			seg.style.flexBasis = pct + "%";
			seg.style.background = LANG_COLORS[e.name] || "#888";
			seg.title = e.name + " — " + pct.toFixed(1) + "%";
			bar.appendChild(seg);
		});

		// Build legend
		legend.innerHTML = "";
		top.forEach(function (e) {
			var pct = (e.bytes / sum) * 100;
			var item = document.createElement("span");
			item.className = "gh-langs__legend-item";
			item.innerHTML =
				'<span class="gh-langs__legend-dot" style="background:' +
				(LANG_COLORS[e.name] || "#888") + '"></span>' +
				e.name +
				'<span class="gh-langs__legend-pct">' + pct.toFixed(1) + '%</span>';
			legend.appendChild(item);
		});

		// Estimated line count — industry-average ~30 bytes/line across
		// mixed-language codebases. Written into the `Lines of Code` stat
		// card and a shorter summary label beside the bar.
		var lines = Math.round(sum / 30);
		var lineStr;
		if (lines >= 1e6) lineStr = (lines / 1e6).toFixed(1) + "M";
		else if (lines >= 1e3) lineStr = Math.round(lines / 1e3) + "K";
		else lineStr = String(lines);

		var locEl = document.getElementById("gh-loc");
		if (locEl) locEl.textContent = "~" + lineStr;

		// `entries` is the full language list before top-N slicing — use its
		// length for the true count, not the bar-segment count.
		var totalLangs = entries.length;
		summary.textContent = totalLangs + " languages across all public repos";
	}

	// Cache read
	dataSourceStarted();
	try {
		var cached = localStorage.getItem(CACHE_KEY);
		if (cached) {
			var parsed = JSON.parse(cached);
			if (parsed.ts && (Date.now() - parsed.ts) < CACHE_TTL && parsed.data) {
				renderBar(parsed.data);
				dataSourceDone();
				return;
			}
		}
	} catch (e) {}

	// Fetch repo list + language breakdowns
	// Fetch up to 100 owned repos, sorted by largest first so the byte-count
	// has the biggest impact on the total. No post-slice cap — we count every
	// non-fork non-archived repo so the "lines of code" figure reflects the
	// full body of work, not just the 25 most recently-touched.
	var reposUrl = "https://api.github.com/users/" + USERNAME + "/repos?per_page=100&type=owner&sort=updated";
	fetchWithTimeout(reposUrl)
		.then(function (r) { return r.ok ? r.json() : []; })
		.then(function (repos) {
			if (!Array.isArray(repos) || !repos.length) throw new Error("No repos");
			var ownRepos = repos.filter(function (r) { return !r.fork && !r.archived; });
			var totals = {};
			var done = 0;

			ownRepos.forEach(function (repo) {
				fetchWithTimeout("https://api.github.com/repos/" + USERNAME + "/" + repo.name + "/languages")
					.then(function (r) { return r.ok ? r.json() : {}; })
					.then(function (langs) {
						Object.keys(langs || {}).forEach(function (k) {
							totals[k] = (totals[k] || 0) + langs[k];
						});
					})
					.catch(function () {})
					.finally(function () {
						done++;
						if (done === ownRepos.length) {
							if (Object.keys(totals).length) {
								renderBar(totals);
								try {
									localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data: totals }));
								} catch (e) {}
							} else {
								summary.textContent = "Unavailable";
							}
							dataSourceDone();
						}
					});
			});

			if (!ownRepos.length) {
				summary.textContent = "No public repos";
				dataSourceDone();
			}
		})
		.catch(function () {
			summary.textContent = "Unavailable";
			dataSourceDone();
		});
})();

