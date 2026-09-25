/* Кузница (тренировки) — офлайн-режим.
   Стратегия: сеть первой для страницы (чтобы не застрять на старой версии),
   кэш первым для иконок. Без сети всё берётся из кэша. */

var CACHE = "forge-body-v5";   /* имя новое: старый кэш игры-плана сносится сам */
var ASSETS = [
  "./",
  "./index.html",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
  "./manifest.json",
  "./img/body-front.webp",
  "./img/body-back.webp"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      /* addAll падает целиком, если хоть один файл не найден — кладём по одному */
      return Promise.all(ASSETS.map(function (u) {
        return c.add(u).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;

  var isPage = req.mode === "navigate" ||
               (req.headers.get("accept") || "").indexOf("text/html") > -1;

  if (isPage) {
    /* сеть первой: свежая версия важнее скорости */
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match(req).then(function (r) {
          return r || caches.match("./index.html");
        });
      })
    );
    return;
  }

  /* остальное — кэш первым */
  e.respondWith(
    caches.match(req).then(function (r) {
      return r || fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === "basic") {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return r; });
    })
  );
});

/* Нажали на напоминание — открываем игру или переводим фокус на открытую */
self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if ("focus" in list[i]) return list[i].focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("./");
    })
  );
});
