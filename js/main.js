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

// ===== Beyond Code — Bookshelf =====
// The shelf is now static HTML (a curated set of 5★ Goodreads picks)
// — no fetch needed. Kept this stub for the structural comment trail.

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
		'Full Stack Software Engineer at <strong>Salesforce</strong>',
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

