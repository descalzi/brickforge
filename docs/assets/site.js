(() => {
  const links = document.querySelectorAll('.main-nav a[href^="#"]');
  if (!('IntersectionObserver' in window) || links.length === 0) return;

  const sections = [...links]
    .map((link) => document.querySelector(link.getAttribute('href')))
    .filter(Boolean);

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const link = document.querySelector(`.main-nav a[href="#${entry.target.id}"]`);
      if (!link) continue;
      if (entry.isIntersecting) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
  }, { rootMargin: '-25% 0px -65% 0px' });

  sections.forEach((section) => observer.observe(section));
})();
