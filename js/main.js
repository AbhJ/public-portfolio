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

// AOS
AOS.init({ duration: 2000 });
