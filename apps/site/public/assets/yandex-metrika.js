(function (window, document) {
  var counterId = 113424299;
  var counterScriptUrl = "https://mc.yandex.ru/metrika/tag.js?id=113424299";
  var initializedFlag = "__octoportMetrika" + counterId + "Initialized";

  if (window[initializedFlag]) {
    return;
  }
  window[initializedFlag] = true;

  window.dataLayer = window.dataLayer || [];
  window.ym = window.ym || function () {
    (window.ym.a = window.ym.a || []).push(arguments);
  };
  window.ym.a = window.ym.a || [];
  window.ym.l = window.ym.l || Date.now();

  var scripts = document.getElementsByTagName("script");
  var counterScriptExists = false;
  for (var index = 0; index < scripts.length; index += 1) {
    if (scripts[index].src === counterScriptUrl) {
      counterScriptExists = true;
      break;
    }
  }

  if (!counterScriptExists) {
    var counterScript = document.createElement("script");
    counterScript.async = true;
    counterScript.src = counterScriptUrl;
    document.head.appendChild(counterScript);
  }

  window.ym(counterId, "init", {
    ssr: true,
    clickmap: true,
    ecommerce: "dataLayer",
    referrer: document.referrer,
    url: location.href,
    accurateTrackBounce: true,
    trackLinks: true
  });
})(window, document);
