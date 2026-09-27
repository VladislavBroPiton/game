/* Кузница — цепи врат.
   Верёвочная физика по Верле: цепь это цепочка точек, каждая помнит,
   где была в прошлом кадре. Скорость не хранится — она получается из
   разницы положений, поэтому симуляция устойчива и почти ничего не стоит.
   Цепи висят за интерфейсом, качаются от наклона телефона и вздрагивают,
   когда в игре что-то происходит. */

var Chains = (function () {
  var cv, ctx, W = 0, H = 0, dpr = 1, ropes = [], raf = null, live = false;
  var ov, octx;                          /* второй холст: он лежит внутри затемнения,
                                            поэтому подвес виден поверх фона, но под окном */
  var gx = 0, gxTarget = 0;              /* боковая «гравитация»: наклон или мышь */
  var LINK = 15;                         /* длина звена, px */
  var GRAV = 0.42, DAMP = 0.985, ITER = 3;

  /* Подвес: оба конца закреплены, середина провисает. На таких цепях
     висит окно Системы — цепи натягиваются, когда оно появляется. */
  function hang(ax, ay, bx, by, n, w) {
    var pts = [], i, t;
    for (i = 0; i < n; i++) {
      t = i / (n - 1);
      pts.push({ x: ax + (bx - ax) * t, y: ay + (by - ay) * t - Math.sin(t * 3.14) * 26,
                 px: ax + (bx - ax) * t, py: ay + (by - ay) * t });
    }
    return { pts: pts, w: w, tint: 1.25, phase: Math.random() * 6.283, both: 1,
             a: { x: ax, y: ay }, b: { x: bx, y: by } };
  }

  function rope(x, n, w, tint) {
    var pts = [], i;
    for (i = 0; i < n; i++) pts.push({ x: x, y: i * LINK - 40, px: x, py: i * LINK - 40 });
    return { pts: pts, w: w, tint: tint, phase: Math.random() * 6.283 };
  }

  function build() {
    var wide = W > 720;
    ropes = [];
    ropes.push(rope(W * (wide ? 0.08 : 0.12), wide ? 16 : 12, 2.6, 0.9));
    ropes.push(rope(W * (wide ? 0.18 : 0.30), wide ? 11 : 8,  1.8, 0.55));
    ropes.push(rope(W * (wide ? 0.88 : 0.86), wide ? 18 : 13, 2.9, 1));
    ropes.push(rope(W * (wide ? 0.79 : 0.68), wide ? 12 : 9,  1.9, 0.6));
  }

  function dist(a, b) { var dx = b.x - a.x, dy = b.y - a.y; return Math.sqrt(dx * dx + dy * dy) || 1; }

  function size() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    build();
  }

  function step(t) {
    var r, p, i, j, k, dx, dy, d, diff, a, b, wind;
    gx += (gxTarget - gx) * 0.06;
    for (k = 0; k < ropes.length; k++) {
      r = ropes[k];
      wind = Math.sin(t / 1400 + r.phase) * 0.06 + Math.sin(t / 430 + r.phase * 2) * 0.02;
      for (i = 1; i < r.pts.length; i++) {          /* нулевая точка закреплена */
        p = r.pts[i];
        var vx = (p.x - p.px) * DAMP, vy = (p.y - p.py) * DAMP;
        p.px = p.x; p.py = p.y;
        p.x += vx + gx + wind;
        p.y += vy + GRAV;
      }
      var link = r.both ? dist(r.a, r.b) / (r.pts.length - 1) * 1.22 : LINK;   /* с запасом — цепь провисает */
      for (j = 0; j < ITER; j++) {                  /* звенья держат длину */
        for (i = 0; i < r.pts.length - 1; i++) {
          a = r.pts[i]; b = r.pts[i + 1];
          dx = b.x - a.x; dy = b.y - a.y;
          d = Math.sqrt(dx * dx + dy * dy) || 0.001;
          diff = (link - d) / d * 0.5;
          dx *= diff; dy *= diff;
          if (i > 0) { a.x -= dx; a.y -= dy; }
          if (!(r.both && i === r.pts.length - 2)) { b.x += dx; b.y += dy; }
          else { a.x -= dx; a.y -= dy; }
        }
        if (r.both) {                               /* концы держатся за точки крепления */
          r.pts[0].x = r.a.x; r.pts[0].y = r.a.y;
          r.pts[r.pts.length - 1].x = r.b.x; r.pts[r.pts.length - 1].y = r.b.y;
        }
      }
    }
  }

  function draw() {
    var r, i, p, q, g, c;
    ctx.clearRect(0, 0, W, H);
    ctx.lineCap = "round";
    if (octx) { octx.clearRect(0, 0, W, H); octx.lineCap = "round"; }
    for (var k = 0; k < ropes.length; k++) {
      r = ropes[k];
      c = r.both && octx ? octx : ctx;
      g = c.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "rgba(175,220,255," + Math.min(0.9, 0.50 * r.tint) + ")");
      g.addColorStop(1, "rgba(90,175,255," + Math.min(0.8, 0.22 * r.tint) + ")");
      c.strokeStyle = g; c.lineWidth = r.w;
      c.beginPath();
      c.moveTo(r.pts[0].x, r.pts[0].y);
      for (i = 1; i < r.pts.length; i++) {          /* сглаживаем углы звеньев */
        p = r.pts[i - 1]; q = r.pts[i];
        c.quadraticCurveTo(p.x, p.y, (p.x + q.x) / 2, (p.y + q.y) / 2);
      }
      c.stroke();
      for (i = 1; i < r.pts.length; i += r.both ? 1 : 2) {   /* блики на звеньях */
        p = r.pts[i];
        c.fillStyle = "rgba(200,235,255," + Math.min(0.6, 0.20 * r.tint) + ")";
        c.beginPath(); c.arc(p.x, p.y, r.w * 0.8, 0, 6.283); c.fill();
      }
      if (!r.both) {                                /* груз только у свободно висящих */
        p = r.pts[r.pts.length - 1];
        c.fillStyle = "rgba(150,210,255," + (0.22 * r.tint) + ")";
        c.beginPath(); c.arc(p.x, p.y, r.w * 1.9, 0, 6.283); c.fill();
      }
    }
  }

  function loop(t) {
    if (!live) return;
    step(t || 0); draw();
    raf = requestAnimationFrame(loop);
  }

  function start() { if (live || !cv) return; live = true; raf = requestAnimationFrame(loop); }
  function stop() { live = false; if (raf) cancelAnimationFrame(raf); raf = null; }

  /* Толчок: цепи вздрагивают, когда в игре что-то произошло */
  function impulse(power) {
    var f = (power || 1) * 2.6, k, i, r;
    for (k = 0; k < ropes.length; k++) {
      r = ropes[k];
      for (i = 1; i < r.pts.length; i++) {
        r.pts[i].px += (Math.random() - 0.5) * f;
        r.pts[i].py += (Math.random() - 0.6) * f * 0.7;
      }
    }
  }

  /* Подвесить окно Системы на две цепи, идущие от верха экрана к его углам */
  function attach(rect) {
    detach();
    if (!cv || !rect) return;
    var ovl = document.getElementById("overlay");
    if (ovl) {
      if (!ov) {
        ov = document.createElement("canvas");
        ov.className = "chains-ov";
        ov.setAttribute("aria-hidden", "true");
        octx = ov.getContext("2d");
      }
      ov.width = Math.round(W * dpr); ov.height = Math.round(H * dpr);
      octx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ovl.insertBefore(ov, ovl.firstChild);      /* перед окном: окно остаётся сверху */
    }
    /* крепим к потолку ближе к центру: цепи расходятся вниз-наружу и обе видны целиком */
    var lx = rect.left + rect.width * 0.26, rx = rect.left + rect.width * 0.74;
    ropes.push(hang(lx, -8, rect.left + 3, rect.top + 3, 16, 3));
    ropes.push(hang(rx, -8, rect.right - 3, rect.top + 3, 16, 3));
    impulse(1.6);
  }
  function detach() {
    for (var i = ropes.length - 1; i >= 0; i--) if (ropes[i].both) ropes.splice(i, 1);
    if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
    if (octx) octx.clearRect(0, 0, W, H);
  }

  function tiltTo(v) { gxTarget = Math.max(-0.55, Math.min(0.55, v)); }

  function init() {
    if (cv) return;
    if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    cv = document.getElementById("chains");
    if (!cv || !cv.getContext) return;
    ctx = cv.getContext("2d");
    size();
    window.addEventListener("resize", size);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") start(); else stop();
    });
    window.addEventListener("deviceorientation", function (e) {
      if (typeof e.gamma === "number") tiltTo(e.gamma / 90 * 0.5);
    });
    window.addEventListener("mousemove", function (e) {
      tiltTo((e.clientX / Math.max(1, W) - 0.5) * 0.5);
    });
    start();
  }

  return { init: init, impulse: impulse, attach: attach, detach: detach, start: start, stop: stop };
})();
