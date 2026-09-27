/* Кузница (тренировки) — офлайн-режим.
   Стратегия: сеть первой для страницы (чтобы не застрять на старой версии),
   кэш первым для иконок. Без сети всё берётся из кэша. */

var CACHE = "forge-body-v7";   /* имя новое: старый кэш игры-плана сносится сам */
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

/* ── Напоминание по сигналу службы ─────────────────────────────────
   Сигнал приходит пустым: ни фразы, ни группы мышц в нём нет. Всё это
   лежит в общей памяти (IndexedDB), которую заполняет само приложение,
   поэтому наружу данные о тренировках не уходят. */

function remState(write) {
  return new Promise(function (res) {
    var q = indexedDB.open("forge", 1);
    q.onupgradeneeded = function () { q.result.createObjectStore("rem"); };
    q.onerror = function () { res(null); };
    q.onsuccess = function () {
      var db = q.result;
      if (!write) {
        var r = db.transaction("rem", "readonly").objectStore("rem").get("state");
        r.onsuccess = function () { res(r.result || null); };
        r.onerror = function () { res(null); };
        return;
      }
      var t = db.transaction("rem", "readwrite");
      t.objectStore("rem").put(write, "state");
      t.oncomplete = function () { res(true); };
      t.onerror = function () { res(false); };
    };
  });
}

function hhmm() {
  var d = new Date(), h = d.getHours(), m = d.getMinutes();
  return (h < 10 ? "0" : "") + h + (m < 10 ? "0" : "") + m;
}

function todayLocal() {
  var d = new Date(), m = d.getMonth() + 1, day = d.getDate();
  return d.getFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day;
}

self.addEventListener("push", function (e) { e.waitUntil(remPush()); });

/* вынесено отдельно, чтобы поведение можно было проверить тестом */
function remPush() {
  return remState().then(function (st) {
    if (!st || !st.phrases || !st.phrases.length) return;
    if (st.done === todayLocal()) return;            /* день уже закрыт — молчим */

    var seen = st.seen || [], left = [], i;
    for (i = 0; i < st.phrases.length; i++) {
      if (seen.indexOf(st.phrases[i].k) < 0) left.push(st.phrases[i]);
    }
    if (!left.length) { seen = []; left = st.phrases; }   /* круг пройден */
    var p = left[Math.floor(Math.random() * left.length)];
    seen = seen.concat([p.k]);
    if (seen.length > st.phrases.length) seen = seen.slice(seen.length - st.phrases.length);

    var group = (st.dayNames || [])[new Date().getDay()] || "тренировка";
    var line = p.t + (p.sig ? " \u00b7 " + p.sig : "");

    st.seen = seen;
    return remState(st).then(function () {
      return self.registration.showNotification((st.head || "Кузница: сегодня ") + group.toLowerCase(), {
        body: line + "\n\n" + "План на сегодня не отмечен",
        icon: "./icon-192.png", badge: "./icon-192.png",
        tag: "forge-push-" + hhmm(), renotify: true
      });
    });
  });
}
