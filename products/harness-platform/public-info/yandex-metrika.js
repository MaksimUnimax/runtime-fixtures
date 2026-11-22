(() => {
  const counter = 114504756;
  if (!['octoport.ru', 'www.octoport.ru'].includes(location.hostname) ||
      /^\/admin(?:\/|$)/.test(location.pathname) || window.octoportMetrikaInitialized) return;
  window.octoportMetrikaInitialized = true;

  const isPublic = document.currentScript?.dataset.analytics === 'public';
  const tag = document.createElement('script');
  tag.async = true;
  tag.src = 'https://mc.yandex.ru/metrika/tag.js?id=' + counter;
  window.ym ||= function () { (window.ym.a ||= []).push(arguments); };
  window.ym.l ||= Date.now();

  function publicReferrer() {
    if (!document.referrer) return '';
    const referrer = new URL(document.referrer);
    if (referrer.origin !== location.origin) return referrer.origin + '/';
    const path = referrer.pathname.replace(/^\/app\/chats\/[^/]+.*$/, '/app/chats');
    return referrer.origin + path;
  }

  if (isPublic) {
    window.dataLayer ||= [];
    window.ym(counter, 'init', {
      ssr: true, webvisor: true, clickmap: true, ecommerce: 'dataLayer',
      referrer: publicReferrer(), url: location.href, accurateTrackBounce: true, trackLinks: true,
    });
  } else {
    // Count views without sending conversation IDs, query parameters or account data.
    const path = location.pathname.replace(/^\/app\/chats\/[^/]+.*$/, '/app/chats');
    const url = location.origin + path;
    const referer = publicReferrer();
    window.ym(counter, 'init', {
      defer: true, webvisor: false, clickmap: false, trackLinks: false,
      accurateTrackBounce: true, url, referrer: referer,
    });
    window.ym(counter, 'hit', url, {title: 'Октопорт', referer});
  }
  document.head.appendChild(tag);
})();
