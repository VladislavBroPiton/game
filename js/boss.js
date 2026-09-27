/* Кузница — бой с боссом.
   Сцена на canvas: силуэт противника, полоса здоровья, удар на каждый
   записанный подход и раскол фигуры при победе. Никаких картинок —
   силуэт строится кодом, поэтому у каждой группы мышц он свой. */

var BossFx = (function () {
  var scenes = [];                       /* активные сцены: по одной на холст */

  function rnd(seed) {                   /* свой генератор: силуэт босса всегда одинаковый */
    var x = seed;
    return function () { x = (x * 1103515245 + 12345) & 0x7fffffff; return x / 0x7fffffff; };
  }

  /* Силуэт стража: половина контура задана точками, вторая — зеркало.
     Зерно меняет ширину плеч, рост и рога, поэтому у каждой группы мышц
     свой противник, но всегда узнаваемо человекоподобный. */
  var HALF = [
    [0.00, -1.00], [0.17, -0.97], [0.26, -0.86], [0.27, -0.72],
    [0.19, -0.63], [0.30, -0.58], [0.58, -0.50], [0.76, -0.34],
    [0.80, -0.12], [0.72, 0.16], [0.60, 0.48], [0.50, 0.78],
    [0.44, 0.95], [0.00, 1.00]
  ];

  function shape(seed, w, h) {
    var r = rnd(seed), pts = [], i, p, sx, sy, jag;
    var broad = 0.85 + r() * 0.45;          /* ширина плеч */
    var tall  = 0.90 + r() * 0.18;          /* рост */
    var horn  = r() > 0.45 ? 0.10 + r() * 0.16 : 0;   /* рога есть не у всех */
    /* пропорции берём от высоты: иначе на широком холсте страж расплывается */
    var ry = h * 0.36, rx = Math.min(w * 0.22, ry * 0.62);

    function put(x, y) { pts.push({ x: x * rx, y: y * ry }); }

    for (i = 0; i < HALF.length; i++) {     /* правая половина сверху вниз */
      p = HALF[i];
      jag = (r() - 0.5) * 0.05;
      sx = p[0] * (p[1] < -0.4 ? 1 : broad) + jag;
      sy = p[1] * tall;
      if (horn && i === 1) put(sx + horn * 0.7, sy - horn * 1.5);   /* рог */
      put(sx, sy);
    }
    for (i = HALF.length - 2; i >= 0; i--) {  /* и зеркально левая */
      p = HALF[i];
      jag = (r() - 0.5) * 0.05;
      sx = -(p[0] * (p[1] < -0.4 ? 1 : broad) + jag);
      sy = p[1] * tall;
      put(sx, sy);
      if (horn && i === 1) put(sx - horn * 0.7, sy - horn * 1.5);
    }
    return pts;
  }

  function make(cv, seed, tint) {
    var ctx = cv.getContext("2d"), dpr = Math.min(2, window.devicePixelRatio || 1);
    var sc = {
      cv: cv, ctx: ctx, dpr: dpr, seed: seed, tint: tint || "#4DA6FF",
      w: 0, h: 0, hp: 1, hpShown: 1, shake: 0, flash: 0, parts: [], dead: 0, t: 0, raf: null
    };
    sc.pts = null;
    resize(sc);
    scenes.push(sc);
    return sc;
  }

  function resize(sc) {
    sc.w = sc.cv.clientWidth; sc.h = sc.cv.clientHeight;
    sc.cv.width = Math.round(sc.w * sc.dpr); sc.cv.height = Math.round(sc.h * sc.dpr);
    sc.ctx.setTransform(sc.dpr, 0, 0, sc.dpr, 0, 0);
    sc.pts = shape(sc.seed, sc.w, sc.h);
  }

  /* Удар: вспышка, тряска и осколки в сторону */
  function hit(sc, hp) {
    sc.hp = Math.max(0, Math.min(1, hp));
    sc.flash = 1; sc.shake = 9;
    var i, a, sp;
    for (i = 0; i < 16; i++) {
      a = Math.random() * 6.283; sp = 1 + Math.random() * 3.4;
      sc.parts.push({ x: 0, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1,
                      life: 1, size: 1 + Math.random() * 2.4 });
    }
    if (sc.hp <= 0 && !sc.dead) kill(sc);
  }

  /* Добивание: силуэт разлетается кусками */
  function kill(sc) {
    sc.dead = 1; sc.shake = 16; sc.flash = 1.4;
    var i, a, sp;
    for (i = 0; i < 60; i++) {
      a = Math.random() * 6.283; sp = 1.5 + Math.random() * 5;
      sc.parts.push({ x: (Math.random() - 0.5) * sc.w * 0.3, y: (Math.random() - 0.5) * sc.h * 0.3,
                      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.4,
                      life: 1, size: 1.4 + Math.random() * 3.6, shard: 1 });
    }
  }

  function step(sc, dt) {
    sc.t += dt;
    sc.hpShown += (sc.hp - sc.hpShown) * 0.12;
    sc.shake *= 0.88; sc.flash *= 0.90;
    for (var i = sc.parts.length - 1; i >= 0; i--) {
      var p = sc.parts[i];
      p.x += p.vx; p.y += p.vy; p.vy += 0.16; p.vx *= 0.985;
      p.life -= 0.022;
      if (p.life <= 0) sc.parts.splice(i, 1);
    }
  }

  function draw(sc) {
    var ctx = sc.ctx, w = sc.w, h = sc.h, i, p;
    ctx.clearRect(0, 0, w, h);

    var cx = w / 2 + (Math.random() - 0.5) * sc.shake;
    var cy = h * 0.58 + (Math.random() - 0.5) * sc.shake;   /* ниже полосы здоровья */

    /* пол под противником */
    var fg = ctx.createRadialGradient(w / 2, h * 0.92, 2, w / 2, h * 0.92, w * 0.45);
    fg.addColorStop(0, "rgba(77,166,255,.20)");
    fg.addColorStop(1, "rgba(77,166,255,0)");
    ctx.fillStyle = fg;
    ctx.beginPath(); ctx.ellipse(w / 2, h * 0.9, w * 0.34, h * 0.07, 0, 0, 6.283); ctx.fill();

    if (!sc.dead) {
      var alpha = 0.30 + sc.flash * 0.5;
      ctx.save(); ctx.translate(cx, cy);
      ctx.beginPath();
      for (i = 0; i < sc.pts.length; i++) {
        p = sc.pts[i];
        var q = sc.pts[(i + 1) % sc.pts.length];
        var br = 1 + Math.sin(sc.t / 420 + i) * 0.012;          /* фигура «дышит» */
        if (i === 0) ctx.moveTo(p.x * br, p.y * br);
        ctx.quadraticCurveTo(p.x * br, p.y * br, (p.x + q.x) / 2 * br, (p.y + q.y) / 2 * br);
      }
      ctx.closePath();
      var g = ctx.createLinearGradient(0, -h * 0.4, 0, h * 0.4);
      g.addColorStop(0, "rgba(40,80,140," + alpha + ")");
      g.addColorStop(1, "rgba(12,24,44," + alpha + ")");
      ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = "rgba(150,210,255," + (0.5 + sc.flash * 0.5) + ")";
      ctx.lineWidth = 1.6; ctx.stroke();

      /* глаза: гаснут по мере потери здоровья */
      var eye = 0.25 + sc.hpShown * 0.75;
      ctx.fillStyle = "rgba(255,120,90," + eye + ")";
      ctx.beginPath(); ctx.arc(-w * 0.032, -h * 0.30, 2.4, 0, 6.283); ctx.fill();
      ctx.beginPath(); ctx.arc(w * 0.032, -h * 0.30, 2.4, 0, 6.283); ctx.fill();
      ctx.restore();
    }

    /* осколки и искры */
    for (i = 0; i < sc.parts.length; i++) {
      p = sc.parts[i];
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.shard ? "rgba(140,200,255,.85)" : "rgba(255,190,120,.9)";
      ctx.fillRect(cx + p.x, cy + p.y, p.size, p.size);
    }
    ctx.globalAlpha = 1;

    /* полоса здоровья */
    var bw = w * 0.7, bx = (w - bw) / 2, by = h * 0.075;
    ctx.fillStyle = "rgba(255,255,255,.08)";
    ctx.fillRect(bx, by, bw, 5);
    ctx.fillStyle = sc.hpShown > 0.35 ? "rgba(255,90,80,.9)" : "rgba(255,170,60,.95)";
    ctx.fillRect(bx, by, bw * Math.max(0, sc.hpShown), 5);
    ctx.strokeStyle = "rgba(150,210,255,.35)"; ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, 4);
  }

  function frame() {
    var alive = false;
    for (var i = 0; i < scenes.length; i++) {
      var sc = scenes[i];
      if (!sc.cv.isConnected) continue;
      alive = true;
      step(sc, 16); draw(sc);
    }
    if (alive && document.visibilityState === "visible") requestAnimationFrame(frame);
    else running = false;
  }

  var running = false;
  function start() { if (running) return; running = true; requestAnimationFrame(frame); }

  /* Сцена привязывается к холсту в блоке босса; hp — доля оставшегося здоровья */
  function mount(cv, seed, hp) {
    for (var i = scenes.length - 1; i >= 0; i--) if (!scenes[i].cv.isConnected) scenes.splice(i, 1);
    for (i = 0; i < scenes.length; i++) if (scenes[i].cv === cv) { scenes[i].hp = hp; start(); return scenes[i]; }
    var sc = make(cv, seed);
    sc.hp = sc.hpShown = hp;
    if (hp <= 0) sc.dead = 1;          /* уже повержен: показываем пустую арену, без повторного взрыва */
    start();
    return sc;
  }

  function find(cv) {
    for (var i = 0; i < scenes.length; i++) if (scenes[i].cv === cv) return scenes[i];
    return null;
  }

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") start();
  });

  return { mount: mount, hit: function (cv, hp) { var s = find(cv); if (s) hit(s, hp); },
           kill: function (cv) { var s = find(cv); if (s) kill(s); } };
})();
