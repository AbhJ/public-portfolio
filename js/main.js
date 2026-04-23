// ===== Page Readiness — preloader control =====
// Tracks async data sources. Reveals page once all resolve (or after timeout).
var _dataReady = { pending: 0, revealed: false };

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
	// Re-trigger AOS since elements are now visible
	if (typeof AOS !== "undefined") setTimeout(function () { AOS.refresh(); }, 100);
}
// Safety: always reveal after 4 seconds no matter what
setTimeout(revealPage, 4000);

(function ($) {
	"use strict";

	// Smooth scrolling
	$('a.js-scroll-trigger[href*="#"]:not([href="#"])').click(function () {
		if (
			location.pathname.replace(/^\//, "") === this.pathname.replace(/^\//, "") &&
			location.hostname === this.hostname
		) {
			var target = $(this.hash);
			target = target.length ? target : $("[name=" + this.hash.slice(1) + "]");
			if (target.length) {
				$("html, body").animate(
					{ scrollTop: target.offset().top - 71 },
					1000,
					"easeInOutExpo"
				);
				return false;
			}
		}
	});

	// Scroll-to-top button visibility
	$(document).scroll(function () {
		if ($(this).scrollTop() > 100) {
			$(".scroll-to-top").fadeIn();
		} else {
			$(".scroll-to-top").fadeOut();
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

	// Floating label form groups
	$("body")
		.on("input propertychange", ".floating-label-form-group", function (e) {
			$(this).toggleClass("floating-label-form-group-with-value", !!$(e.target).val());
		})
		.on("focus", ".floating-label-form-group", function () {
			$(this).addClass("floating-label-form-group-with-focus");
		})
		.on("blur", ".floating-label-form-group", function () {
			$(this).removeClass("floating-label-form-group-with-focus");
		});
})(jQuery);

// Copyright date
document.getElementById("year").textContent = new Date().getFullYear();
document.getElementById("month").textContent = [
	"January", "February", "March", "April", "May", "June",
	"July", "August", "September", "October", "November", "December"
][new Date().getMonth()];

// ===== AOS — Apple-style bidirectional scroll animations =====
AOS.init({
	duration: 1000,
	once: false,
	mirror: true,
	easing: "ease-out-cubic",
	anchorPlacement: "top-bottom"
});

// ===== Ember Trail — subtle mouse-reactive particles =====
// Monochrome embers: cool whites + dim blues. No stars, no colors. Clean.
(function () {
	var canvas = document.createElement("canvas");
	canvas.style.cssText =
		"position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:10000";
	document.body.appendChild(canvas);
	var ctx = canvas.getContext("2d");
	var embers = [];
	var mouse = { x: -1000, y: -1000, speed: 0, prevX: 0, prevY: 0 };

	function resize() {
		canvas.width = window.innerWidth;
		canvas.height = window.innerHeight;
	}
	resize();
	window.addEventListener("resize", resize);

	document.addEventListener("mousemove", function (e) {
		var dx = e.clientX - mouse.prevX;
		var dy = e.clientY - mouse.prevY;
		mouse.speed = Math.sqrt(dx * dx + dy * dy);
		mouse.x = e.clientX;
		mouse.y = e.clientY;
		mouse.prevX = e.clientX;
		mouse.prevY = e.clientY;

		// Spawn embers proportional to speed, capped
		if (mouse.speed > 8) {
			var count = Math.min(Math.floor(mouse.speed / 18), 3);
			for (var i = 0; i < count; i++) {
				embers.push(createEmber(mouse.x, mouse.y, "trail"));
			}
		}
	});

	// Sparse ambient embers — very occasional
	var ambientTimer = 0;

	function createEmber(x, y, type) {
		var isTrail = type === "trail";
		var size = isTrail ? 1 + Math.random() * 1.5 : 0.8 + Math.random() * 1.2;
		// Monochrome palette: white, blue-white, steel-blue
		var tones = [
			[255, 255, 255],
			[200, 220, 255],
			[160, 190, 240],
			[130, 170, 230]
		];
		var tone = tones[Math.floor(Math.random() * tones.length)];
		return {
			x: x + (Math.random() - 0.5) * 10,
			y: y + (Math.random() - 0.5) * 10,
			r: size,
			vx: (Math.random() - 0.5) * 0.6,
			vy: -(0.3 + Math.random() * 0.8),
			life: 1.0,
			decay: isTrail ? 0.015 + Math.random() * 0.012 : 0.006 + Math.random() * 0.005,
			color: tone,
			maxOpacity: isTrail ? 0.5 + Math.random() * 0.3 : 0.2 + Math.random() * 0.15
		};
	}

	function tick() {
		ctx.clearRect(0, 0, canvas.width, canvas.height);

		// Ambient embers — very sparse
		ambientTimer += 0.016;
		if (ambientTimer > 1.5 + Math.random() * 2) {
			embers.push(
				createEmber(
					Math.random() * canvas.width,
					Math.random() * canvas.height,
					"ambient"
				)
			);
			ambientTimer = 0;
		}

		for (var i = embers.length - 1; i >= 0; i--) {
			var e = embers[i];
			e.x += e.vx;
			e.y += e.vy;
			e.vy -= 0.003; // subtle upward drift
			e.life -= e.decay;

			if (e.life <= 0) {
				embers.splice(i, 1);
				continue;
			}

			var alpha = e.life * e.maxOpacity;
			// Dot
			ctx.beginPath();
			ctx.arc(e.x, e.y, e.r * e.life, 0, Math.PI * 2);
			ctx.fillStyle =
				"rgba(" + e.color[0] + "," + e.color[1] + "," + e.color[2] + "," + alpha + ")";
			ctx.fill();

			// Soft glow
			ctx.beginPath();
			ctx.arc(e.x, e.y, e.r * e.life * 4, 0, Math.PI * 2);
			ctx.fillStyle =
				"rgba(" + e.color[0] + "," + e.color[1] + "," + e.color[2] + "," + alpha * 0.12 + ")";
			ctx.fill();
		}

		requestAnimationFrame(tick);
	}
	tick();
})();

// ===== Enhanced Particle Background =====
(function () {
	var canvas = document.getElementById("particles");
	if (!canvas) return;
	var ctx = canvas.getContext("2d");
	var particles = [];
	var mouse = { x: null, y: null };
	var count = 80;

	function resize() {
		canvas.width = window.innerWidth;
		canvas.height = window.innerHeight;
	}
	resize();
	window.addEventListener("resize", resize);

	window.addEventListener("mousemove", function (e) {
		mouse.x = e.clientX;
		mouse.y = e.clientY;
	});

	var pColors = [
		[66, 170, 245],
		[120, 160, 220],
		[180, 200, 240],
		[100, 140, 200]
	];

	for (var i = 0; i < count; i++) {
		var c = pColors[Math.floor(Math.random() * pColors.length)];
		particles.push({
			x: Math.random() * canvas.width,
			y: Math.random() * canvas.height,
			r: Math.random() * 2.5 + 0.8,
			dx: (Math.random() - 0.5) * 0.4,
			dy: (Math.random() - 0.5) * 0.4,
			opacity: Math.random() * 0.5 + 0.1,
			color: c,
			pulsePhase: Math.random() * Math.PI * 2
		});
	}

	var time = 0;
	function draw() {
		time += 0.016;
		ctx.clearRect(0, 0, canvas.width, canvas.height);

		for (var i = 0; i < particles.length; i++) {
			var p = particles[i];
			var pulse = Math.sin(time * 2 + p.pulsePhase) * 0.3 + 0.7;
			var curOp = p.opacity * pulse;

			// Mouse repulsion — particles gently pushed away
			if (mouse.x !== null) {
				var mdx = p.x - mouse.x;
				var mdy = p.y - mouse.y;
				var mDist = Math.sqrt(mdx * mdx + mdy * mdy);
				if (mDist < 200 && mDist > 0) {
					var force = ((200 - mDist) / 200) * 0.5;
					p.x += (mdx / mDist) * force;
					p.y += (mdy / mDist) * force;
				}
			}

			// Glowing dot
			ctx.beginPath();
			ctx.arc(p.x, p.y, p.r * pulse, 0, Math.PI * 2);
			ctx.fillStyle =
				"rgba(" + p.color[0] + "," + p.color[1] + "," + p.color[2] + "," + curOp + ")";
			ctx.fill();

			// Soft glow halo
			ctx.beginPath();
			ctx.arc(p.x, p.y, p.r * pulse * 3, 0, Math.PI * 2);
			ctx.fillStyle =
				"rgba(" + p.color[0] + "," + p.color[1] + "," + p.color[2] + "," + curOp * 0.12 + ")";
			ctx.fill();

			// Connections
			for (var j = i + 1; j < particles.length; j++) {
				var p2 = particles[j];
				var dist = Math.sqrt(
					Math.pow(p.x - p2.x, 2) + Math.pow(p.y - p2.y, 2)
				);
				if (dist < 120) {
					var alpha = 0.06 * (1 - dist / 120);
					ctx.beginPath();
					ctx.moveTo(p.x, p.y);
					ctx.lineTo(p2.x, p2.y);
					ctx.strokeStyle =
						"rgba(" +
						p.color[0] + "," + p.color[1] + "," + p.color[2] + "," +
						alpha + ")";
					ctx.lineWidth = 0.5;
					ctx.stroke();
				}
			}

			p.x += p.dx;
			p.y += p.dy;
			if (p.x < 0 || p.x > canvas.width) p.dx *= -1;
			if (p.y < 0 || p.y > canvas.height) p.dy *= -1;
		}
		requestAnimationFrame(draw);
	}
	draw();
})();

// ===== Hero Parallax =====
(function () {
	var hero = document.querySelector(".masthead");
	if (!hero) return;

	window.addEventListener("scroll", function () {
		var scrollY = window.pageYOffset;
		if (scrollY < hero.offsetHeight * 1.2) {
			hero.style.setProperty("--parallax-y", scrollY * 0.3 + "px");
		}
	});
})();

// ===== Experience Section — scroll-reactive color shift =====
(function () {
	var exp = document.getElementById("experience");
	if (!exp) return;

	window.addEventListener("scroll", function () {
		var rect = exp.getBoundingClientRect();
		var vh = window.innerHeight;
		if (rect.top < vh && rect.bottom > 0) {
			var progress = (vh - rect.top) / (vh + rect.height);
			exp.style.setProperty("--aurora-progress", (progress * 100).toFixed(1) + "%");
		}
	});
})();

// ===== LeetCode — fully dynamic stats + heatmap =====
(function () {
	var LC_USER = "abhjkgp";
	var API = "https://alfa-leetcode-api.onrender.com/";

	// ---- 1. Problem stats ----
	dataSourceStarted();
	fetch(API + LC_USER + "/solved")
		.then(function (r) { return r.json(); })
		.then(function (d) {
			var easy = d.easySolved || 0;
			var medium = d.mediumSolved || 0;
			var hard = d.hardSolved || 0;
			var total = d.solvedProblem || (easy + medium + hard);

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

			dataSourceDone();
		})
		.catch(function () { dataSourceDone(); });

	// ---- 2. Calendar heatmap ----
	var canvas = document.getElementById("lc-heatmap");
	var tooltip = document.getElementById("lc-heatmap-tooltip");
	if (!canvas) return;
	var ctx = canvas.getContext("2d");
	var dpr = window.devicePixelRatio || 1;
	var WEEKS = 52, CELL = 11, GAP = 2, RADIUS = 3, MARGIN_LEFT = 32, MARGIN_TOP = 20;
	var COLORS = [
		"rgba(255,255,255,0.04)",
		"rgba(255,161,22,0.25)",
		"rgba(255,161,22,0.45)",
		"rgba(255,161,22,0.65)",
		"rgba(255,161,22,0.85)",
		"rgba(255,161,22,1.0)"
	];
	var DAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""];
	var MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

	var today = new Date(); today.setHours(0,0,0,0);
	var startDay = new Date(today);
	startDay.setDate(startDay.getDate() - (WEEKS * 7 - 1) - today.getDay());

	var grid = [];
	var dateMap = {};
	var d = new Date(startDay);
	while (d <= today) {
		var key = d.toISOString().slice(0, 10);
		grid.push({ date: new Date(d), key: key, count: 0 });
		dateMap[key] = grid.length - 1;
		d.setDate(d.getDate() + 1);
	}

	var cols = Math.ceil(grid.length / 7);
	var W = MARGIN_LEFT + cols * (CELL + GAP);
	var H = MARGIN_TOP + 7 * (CELL + GAP);
	canvas.width = W * dpr; canvas.height = H * dpr;
	canvas.style.width = W + "px"; canvas.style.height = H + "px";
	ctx.scale(dpr, dpr);

	function getColor(count) {
		if (count === 0) return COLORS[0];
		if (count <= 2) return COLORS[1];
		if (count <= 4) return COLORS[2];
		if (count <= 6) return COLORS[3];
		if (count <= 9) return COLORS[4];
		return COLORS[5];
	}

	function drawGrid() {
		ctx.clearRect(0, 0, W, H);
		ctx.font = "10px -apple-system, BlinkMacSystemFont, sans-serif";
		ctx.fillStyle = "rgba(255,255,255,0.3)";
		ctx.textBaseline = "middle";
		for (var r = 0; r < 7; r++) {
			if (DAY_LABELS[r]) ctx.fillText(DAY_LABELS[r], 0, MARGIN_TOP + r * (CELL + GAP) + CELL / 2);
		}
		var lastMonth = -1;
		for (var c = 0; c < cols; c++) {
			var ci = c * 7;
			if (ci >= grid.length) break;
			var m = grid[ci].date.getMonth();
			if (m !== lastMonth) {
				ctx.fillStyle = "rgba(255,255,255,0.3)";
				ctx.fillText(MONTH_NAMES[m], MARGIN_LEFT + c * (CELL + GAP), 10);
				lastMonth = m;
			}
		}
		for (var i = 0; i < grid.length; i++) {
			var col = Math.floor(i / 7), row = i % 7;
			var x = MARGIN_LEFT + col * (CELL + GAP), y = MARGIN_TOP + row * (CELL + GAP);
			ctx.beginPath();
			ctx.roundRect(x, y, CELL, CELL, RADIUS);
			ctx.fillStyle = getColor(grid[i].count);
			ctx.fill();
			grid[i].px = x; grid[i].py = y;
		}
	}

	canvas.addEventListener("mousemove", function (e) {
		var rect = canvas.getBoundingClientRect();
		var mx = e.clientX - rect.left, my = e.clientY - rect.top;
		var found = null;
		for (var i = 0; i < grid.length; i++) {
			if (mx >= grid[i].px && mx <= grid[i].px + CELL && my >= grid[i].py && my <= grid[i].py + CELL) {
				found = grid[i]; break;
			}
		}
		if (found) {
			var label = found.count > 0
				? found.count + " submission" + (found.count !== 1 ? "s" : "") + " on " + found.date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
				: "No submissions on " + found.date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
			tooltip.textContent = label;
			tooltip.classList.add("visible");
			var tipW = tooltip.offsetWidth;
			var wrapW = canvas.parentElement ? canvas.parentElement.offsetWidth : W;
			tooltip.style.left = Math.max(0, Math.min(found.px + CELL / 2 - tipW / 2, wrapW - tipW - 4)) + "px";
			tooltip.style.top = (found.py - 30) + "px";
		} else {
			tooltip.classList.remove("visible");
		}
	});
	canvas.addEventListener("mouseleave", function () { tooltip.classList.remove("visible"); });

	drawGrid(); // empty grid first

	// Fetch calendar data
	dataSourceStarted();
	fetch(API + LC_USER + "/calendar")
		.then(function (r) { return r.json(); })
		.then(function (d) {
			var cal = d.submissionCalendar;
			if (typeof cal === "string") cal = JSON.parse(cal);

			Object.keys(cal).forEach(function (ts) {
				var dt = new Date(parseInt(ts, 10) * 1000);
				var key = dt.getFullYear() + "-" +
					String(dt.getMonth() + 1).padStart(2, "0") + "-" +
					String(dt.getDate()).padStart(2, "0");
				if (dateMap.hasOwnProperty(key)) {
					grid[dateMap[key]].count = cal[ts];
				}
			});
			drawGrid();

			// Update streak text
			var streakEl = document.getElementById("lc-streak");
			if (streakEl && d.streak) {
				streakEl.textContent = d.streak + " day streak · " + d.totalActiveDays + " active days";
				if (d.streak > 0) streakEl.insertAdjacentHTML("beforebegin", '<i class="fas fa-fire-alt" style="color:#ffa116;margin-right:0.3rem;"></i>');
			}
		})
		.catch(function () {})
		.finally(dataSourceDone);
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
	fetch(proxyUrl)
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
			return fetch("https://api.github.com/users/" + USERNAME)
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
	var WEEKS = 52; // Full year of columns (matches GitHub profile)
	var CELL = 11;
	var GAP = 2;
	var RADIUS = 3;
	var MARGIN_LEFT = 32;
	var MARGIN_TOP = 20;
	var canvas = document.getElementById("gh-heatmap");
	var tooltip = document.getElementById("gh-heatmap-tooltip");
	var statusEl = document.getElementById("gh-heatmap-status");
	if (!canvas) return;
	var ctx = canvas.getContext("2d");
	var dpr = window.devicePixelRatio || 1;

	// Color scale — GitHub dark-mode style with blue accent
	var COLORS = [
		"rgba(255,255,255,0.04)",   // 0 contributions
		"rgba(66,170,245,0.25)",    // low
		"rgba(66,170,245,0.45)",    // medium-low
		"rgba(66,170,245,0.65)",    // medium
		"rgba(66,170,245,0.85)",    // high
		"rgba(66,170,245,1.0)"      // very high
	];
	var DAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""];
	var MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

	// Build the date grid: WEEKS columns x 7 rows, ending today
	var today = new Date();
	today.setHours(0,0,0,0);
	var endDay = new Date(today);
	// Start from (WEEKS * 7 - 1) days ago, aligned to Sunday
	var startDay = new Date(today);
	startDay.setDate(startDay.getDate() - (WEEKS * 7 - 1) - today.getDay());

	var grid = []; // [{date, key, commits}]
	var dateMap = {}; // "YYYY-MM-DD" -> index in grid
	var d = new Date(startDay);
	while (d <= endDay) {
		var key = d.toISOString().slice(0, 10);
		var idx = grid.length;
		grid.push({ date: new Date(d), key: key, commits: 0, level: 0 });
		dateMap[key] = idx;
		d.setDate(d.getDate() + 1);
	}

	// Canvas sizing
	var cols = Math.ceil(grid.length / 7);
	var W = MARGIN_LEFT + cols * (CELL + GAP);
	var H = MARGIN_TOP + 7 * (CELL + GAP);
	canvas.width = W * dpr;
	canvas.height = H * dpr;
	canvas.style.width = W + "px";
	canvas.style.height = H + "px";
	ctx.scale(dpr, dpr);

	// Color by level (GitHub's own 0-4 scale) or by commit count
	function getColorByLevel(level) {
		if (level <= 0) return COLORS[0];
		if (level === 1) return COLORS[1];
		if (level === 2) return COLORS[2];
		if (level === 3) return COLORS[3];
		return COLORS[4];
	}

	function getColorByCount(count) {
		if (count === 0) return COLORS[0];
		if (count <= 2) return COLORS[1];
		if (count <= 5) return COLORS[2];
		if (count <= 10) return COLORS[3];
		if (count <= 20) return COLORS[4];
		return COLORS[5];
	}

	// useLevel flag — set to true when we have GitHub's level data
	var useLevel = false;

	function drawGrid() {
		ctx.clearRect(0, 0, W, H);

		// Day labels
		ctx.font = "10px -apple-system, BlinkMacSystemFont, sans-serif";
		ctx.fillStyle = "rgba(255,255,255,0.3)";
		ctx.textBaseline = "middle";
		for (var r = 0; r < 7; r++) {
			if (DAY_LABELS[r]) {
				ctx.fillText(DAY_LABELS[r], 0, MARGIN_TOP + r * (CELL + GAP) + CELL / 2);
			}
		}

		// Month labels
		var lastMonth = -1;
		for (var c = 0; c < cols; c++) {
			var cellIdx = c * 7;
			if (cellIdx >= grid.length) break;
			var m = grid[cellIdx].date.getMonth();
			if (m !== lastMonth) {
				ctx.fillStyle = "rgba(255,255,255,0.3)";
				ctx.fillText(MONTH_NAMES[m], MARGIN_LEFT + c * (CELL + GAP), 10);
				lastMonth = m;
			}
		}

		// Cells
		for (var i = 0; i < grid.length; i++) {
			var col = Math.floor(i / 7);
			var row = i % 7;
			var x = MARGIN_LEFT + col * (CELL + GAP);
			var y = MARGIN_TOP + row * (CELL + GAP);

			ctx.beginPath();
			ctx.roundRect(x, y, CELL, CELL, RADIUS);
			ctx.fillStyle = useLevel ? getColorByLevel(grid[i].level) : getColorByCount(grid[i].commits);
			ctx.fill();

			// Store position for tooltip
			grid[i].px = x;
			grid[i].py = y;
		}
	}

	// Tooltip on hover
	canvas.addEventListener("mousemove", function (e) {
		var rect = canvas.getBoundingClientRect();
		var mx = (e.clientX - rect.left);
		var my = (e.clientY - rect.top);

		var found = null;
		for (var i = 0; i < grid.length; i++) {
			if (mx >= grid[i].px && mx <= grid[i].px + CELL &&
				my >= grid[i].py && my <= grid[i].py + CELL) {
				found = grid[i];
				break;
			}
		}

		if (found) {
			var count = found.commits;
			var label;
			if (count > 0) {
				label = count + " contribution" + (count !== 1 ? "s" : "") +
					" on " + found.date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
			} else if (found.level > 0) {
				// We have level data but no exact count
				label = "Contributions on " + found.date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
			} else {
				label = "No contributions on " + found.date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
			}
			tooltip.textContent = label;
			tooltip.classList.add("visible");
			// Clamp tooltip so it doesn't overflow left or right edge
			var tipW = tooltip.offsetWidth;
			var wrapW = canvas.parentElement ? canvas.parentElement.offsetWidth : W;
			var idealLeft = found.px + CELL / 2 - tipW / 2;
			var clampedLeft = Math.max(0, Math.min(idealLeft, wrapW - tipW - 4));
			tooltip.style.left = clampedLeft + "px";
			tooltip.style.top = (found.py - 30) + "px";
		} else {
			tooltip.classList.remove("visible");
		}
	});

	canvas.addEventListener("mouseleave", function () {
		tooltip.classList.remove("visible");
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
			console.warn("[Heatmap] All CORS proxies failed, falling back to GitHub API");
			callback(null); // All proxies failed
			return;
		}
		var proxyUrl = CORS_PROXIES[proxyIdx](GH_CONTRIB_URL);
		console.log("[Heatmap] Trying proxy " + proxyIdx + ": " + proxyUrl.slice(0, 60) + "...");
		fetch(proxyUrl)
			.then(function (r) {
				if (!r.ok) throw new Error("Proxy " + proxyIdx + " returned " + r.status);
				return r.text();
			})
			.then(function (html) {
				if (!html || html.indexOf("data-date") === -1) {
					throw new Error("Invalid HTML from proxy " + proxyIdx + " (length=" + (html ? html.length : 0) + ")");
				}
				console.log("[Heatmap] Proxy " + proxyIdx + " succeeded (" + html.length + " bytes)");
				var contribs = parseContributionsHTML(html);
				var nonZero = 0;
				Object.keys(contribs).forEach(function(k) { if (contribs[k].level > 0) nonZero++; });
				console.log("[Heatmap] Parsed " + Object.keys(contribs).length + " dates, " + nonZero + " with activity");
				callback(contribs);
			})
			.catch(function (err) {
				console.warn("[Heatmap] Proxy " + proxyIdx + " failed: " + err.message);
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
					console.log("[Heatmap] Using cached repo commits (" + Object.keys(parsed.data).length + " days)");
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
			fetch(url)
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

	drawGrid(); // Draw empty grid immediately

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

		// 1. Apply contributions HTML data (if available)
		if (contribData) {
			useLevel = true;
			Object.keys(contribData).forEach(function (dateKey) {
				if (dateMap.hasOwnProperty(dateKey)) {
					grid[dateMap[dateKey]].level = contribData[dateKey].level;
					grid[dateMap[dateKey]].commits = contribData[dateKey].count;
				}
			});
		}

		// 2. Merge direct repo commits on top — take max per day
		if (repoData) {
			Object.keys(repoData).forEach(function (dateKey) {
				if (dateMap.hasOwnProperty(dateKey)) {
					var current = grid[dateMap[dateKey]].commits;
					var fromRepo = repoData[dateKey];
					if (fromRepo > current) {
						grid[dateMap[dateKey]].commits = fromRepo;
					}
					// Also bump level if we found commits but level was 0
					if (fromRepo > 0 && grid[dateMap[dateKey]].level === 0) {
						if (fromRepo <= 2) grid[dateMap[dateKey]].level = 1;
						else if (fromRepo <= 5) grid[dateMap[dateKey]].level = 2;
						else if (fromRepo <= 10) grid[dateMap[dateKey]].level = 3;
						else grid[dateMap[dateKey]].level = 4;
					}
				}
			});
		}

		drawGrid();

		// Update status
		var total = 0;
		grid.forEach(function (g) { total += g.commits; });
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
