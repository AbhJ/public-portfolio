(function ($) {
	"use strict";

	// ===== Smooth Scrolling =====
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

	// ===== Scroll-to-Top Button Visibility =====
	$(document).scroll(function () {
		if ($(this).scrollTop() > 100) {
			$(".scroll-to-top").fadeIn();
		} else {
			$(".scroll-to-top").fadeOut();
		}
	});

	// ===== Close Responsive Menu on Scroll-Trigger Click =====
	$(".js-scroll-trigger").click(function () {
		$(".navbar-collapse").collapse("hide");
	});

	// ===== Scrollspy =====
	$("body").scrollspy({ target: "#mainNav", offset: 80 });

	// ===== Navbar Shrink on Scroll =====
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

// ===== Copyright Date =====
(function () {
	var yearEl = document.getElementById("year");
	var monthEl = document.getElementById("month");
	var now = new Date();
	var months = [
		"January", "February", "March", "April", "May", "June",
		"July", "August", "September", "October", "November", "December"
	];
	if (yearEl) {
		yearEl.textContent = now.getFullYear();
	}
	if (monthEl) {
		monthEl.textContent = months[now.getMonth()];
	}
})();

// ===== AOS Initialization =====
AOS.init({
	duration: 1000,
	once: true,
	easing: "ease-out-cubic",
	offset: 80
});

// ===== Particle Background =====
(function () {
	var canvas = document.getElementById("particles");
	if (!canvas) return;
	var ctx = canvas.getContext("2d");
	var particles = [];
	var mouseX = -1000;
	var mouseY = -1000;
	var count = 80;
	var connectionDistance = 140;
	var mouseRadius = 200;

	function resize() {
		canvas.width = window.innerWidth;
		canvas.height = window.innerHeight;
	}
	resize();
	window.addEventListener("resize", resize);

	// Track mouse position for interactive connections
	document.addEventListener("mousemove", function (e) {
		mouseX = e.clientX;
		mouseY = e.clientY;
	});

	document.addEventListener("mouseleave", function () {
		mouseX = -1000;
		mouseY = -1000;
	});

	// Adjust particle count for mobile
	if (window.innerWidth < 768) {
		count = 40;
		connectionDistance = 100;
	}

	// Create particles
	for (var i = 0; i < count; i++) {
		particles.push({
			x: Math.random() * canvas.width,
			y: Math.random() * canvas.height,
			r: Math.random() * 1.8 + 0.5,
			dx: (Math.random() - 0.5) * 0.4,
			dy: (Math.random() - 0.5) * 0.4,
			opacity: Math.random() * 0.35 + 0.1
		});
	}

	function draw() {
		ctx.clearRect(0, 0, canvas.width, canvas.height);

		for (var i = 0; i < particles.length; i++) {
			var p = particles[i];

			// Subtle mouse repulsion
			var dxMouse = p.x - mouseX;
			var dyMouse = p.y - mouseY;
			var distMouse = Math.sqrt(dxMouse * dxMouse + dyMouse * dyMouse);
			if (distMouse < mouseRadius && distMouse > 0) {
				var force = (mouseRadius - distMouse) / mouseRadius * 0.015;
				p.x += dxMouse / distMouse * force;
				p.y += dyMouse / distMouse * force;
			}

			// Draw particle
			ctx.beginPath();
			ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
			ctx.fillStyle = "rgba(66, 170, 245, " + p.opacity + ")";
			ctx.fill();

			// Draw connections between nearby particles
			for (var j = i + 1; j < particles.length; j++) {
				var p2 = particles[j];
				var dx = p.x - p2.x;
				var dy = p.y - p2.y;
				var dist = Math.sqrt(dx * dx + dy * dy);
				if (dist < connectionDistance) {
					var alpha = 0.06 * (1 - dist / connectionDistance);
					ctx.beginPath();
					ctx.moveTo(p.x, p.y);
					ctx.lineTo(p2.x, p2.y);
					ctx.strokeStyle = "rgba(66, 170, 245, " + alpha + ")";
					ctx.lineWidth = 0.5;
					ctx.stroke();
				}
			}

			// Update position
			p.x += p.dx;
			p.y += p.dy;

			// Bounce off edges with wrapping for smoother feel
			if (p.x < -10) p.x = canvas.width + 10;
			if (p.x > canvas.width + 10) p.x = -10;
			if (p.y < -10) p.y = canvas.height + 10;
			if (p.y > canvas.height + 10) p.y = -10;
		}

		requestAnimationFrame(draw);
	}
	draw();
})();
