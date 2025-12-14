// Mobile Navigation Toggle
const hamburger = document.getElementById('hamburger');
const navMenu = document.getElementById('nav-menu');

hamburger.addEventListener('click', () => {
    hamburger.classList.toggle('active');
    navMenu.classList.toggle('active');
});

// // Close mobile menu when clicking on a link
// document.querySelectorAll('.nav-link').forEach(n => n.addEventListener('click', () => {
//     hamburger.classList.remove('active');
//     navMenu.classList.remove('active');
// }));

// Dropdown Toggle for Clubs Menu
const dropdownToggle = document.querySelector('.dropdown-toggle');
const navDropdown = document.querySelector('.nav-dropdown');

if (dropdownToggle && navDropdown) {
    dropdownToggle.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        // Toggle active class for mobile
        navDropdown.classList.toggle('active');
    });

    // Close dropdown when clicking anywhere else
    document.addEventListener('click', (e) => {
        if (!navDropdown.contains(e.target)) {
            navDropdown.classList.remove('active');
        }
    });

    // Remove active class when mouse leaves (for desktop hover to work cleanly)
    navDropdown.addEventListener('mouseleave', () => {
        navDropdown.classList.remove('active');
    });
}

// Smooth scrolling for anchor links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        const href = this.getAttribute('href');

        // Skip if href is just '#' (dropdown toggles, etc.)
        if (href === '#' || href.length <= 1) {
            return;
        }

        const target = document.querySelector(href);
        if (target) {
            e.preventDefault();
            target.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    });
});

// Form submission handler
const contactForm = document.querySelector('.contact-form form');
if (contactForm) {
    contactForm.addEventListener('submit', function(e) {
        // Add your form submission logic here
        alert('Thank you for your message! We will get back to you soon.');
    });
}

// Add scroll effect to navbar
window.addEventListener('scroll', () => {
    const navbar = document.querySelector('.navbar');
    if (window.scrollY > 100) {
        navbar.style.background = 'rgba(44, 44, 44, 0.95)';
    } else {
        navbar.style.background = '#2C2C2C';
    }
});

// Get Started Popup Logic with Cookie Management
(function() {
    const popup = document.getElementById('get-started-popup');
    const closeBtn = document.getElementById('popup-close');
    const cookieName = 'wu_guan_popup_dismissed';
    const cookieExpireDays = 30;

    // Cookie helper functions
    function setCookie(name, value, days) {
        const date = new Date();
        date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
        const expires = "expires=" + date.toUTCString();
        document.cookie = name + "=" + value + ";" + expires + ";path=/";
    }

    function getCookie(name) {
        const nameEQ = name + "=";
        const ca = document.cookie.split(';');
        for(let i = 0; i < ca.length; i++) {
            let c = ca[i];
            while (c.charAt(0) === ' ') c = c.substring(1);
            if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
        }
        return null;
    }

    function showPopup() {
        if (popup) {
            popup.classList.add('show');
            document.body.style.overflow = 'hidden'; // Prevent background scrolling
        }
    }

    function hidePopup() {
        if (popup) {
            popup.classList.remove('show');
            document.body.style.overflow = ''; // Restore scrolling
            setCookie(cookieName, 'true', cookieExpireDays);
        }
    }

    // Show popup on first visit (if not dismissed before)
    if (popup && !getCookie(cookieName)) {
        // Delay popup slightly for better UX
        setTimeout(showPopup, 1000);
    }

    // Close popup when clicking close button
    if (closeBtn) {
        closeBtn.addEventListener('click', hidePopup);
    }

    // Close popup when clicking outside the content
    if (popup) {
        popup.addEventListener('click', function(e) {
            if (e.target === popup) {
                hidePopup();
            }
        });
    }

    // Close popup with Escape key
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && popup && popup.classList.contains('show')) {
            hidePopup();
        }
    });
})();
