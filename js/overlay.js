/* Кузница — разметка поверх объёмной проекции.
   Рисует то, чего не умеет шейдер: выноски к отдельным пучкам мышцы
   и траекторию движения снаряда со стрелкой. Точки заданы в координатах
   фигуры, а на экран их переводит сам движок проекции — поэтому разметка
   поворачивается вместе с телом. */

var HoloMarks = (function () {

  /* Пучки внутри группы. Координаты даны для правой половины тела
     (x больше нуля), подпись ставится сбоку выноской. */
  var HEADS = {
    triceps:  [["длинная",     [0.228, 1.200, -0.054]],
               ["латеральная", [0.258, 1.130, -0.046]],
               ["медиальная",  [0.250, 1.048, -0.040]]],
    biceps:   [["длинная",     [0.242, 1.158, 0.058]],
               ["короткая",    [0.218, 1.198, 0.050]]],
    delts:    [["передняя",    [0.194, 1.292, 0.062]],
               ["средняя",     [0.244, 1.296, 0.010]]],
    delts_rear: [["задняя",    [0.196, 1.290, -0.060]]],
    chest:    [["верх груди",  [0.080, 1.262, 0.100]],
               ["низ груди",   [0.088, 1.158, 0.110]]],
    lats:     [["широчайшая",  [0.142, 1.040, -0.086]]],
    traps:    [["верх",        [0.084, 1.352, -0.028]],
               ["середина",    [0.072, 1.242, -0.088]]],
    lowback:  [["разгибатели", [0.042, 0.900, -0.094]]],
    abs:      [["верх пресса", [0.000, 1.006, 0.108]],
               ["низ пресса",  [0.000, 0.862, 0.104]]],
    obliques: [["косая",       [0.122, 0.930, 0.058]]],
    forearms: [["сгибатели",   [0.258, 0.940, 0.046]],
               ["разгибатели", [0.268, 0.920, -0.042]]],
    glutes:   [["большая",     [0.100, 0.730, -0.102]]],
    quads:    [["прямая",      [0.074, 0.600, 0.080]],
               ["латеральная", [0.130, 0.580, 0.054]]],
    hams:     [["двуглавая",   [0.112, 0.580, -0.088]],
               ["полусухожильная", [0.058, 0.566, -0.090]]],
    calves:   [["икроножная",  [0.102, 0.320, -0.074]],
               ["камбаловидная", [0.094, 0.218, -0.060]]]
  };


  /* Траектория снаряда: три точки дуги и подпись.
     from — нижняя (начало), mid — середина, to — верхняя (конец). */
  var MOVES = {
    triceps:  { a: [0.205, 1.262, 0.070], b: [0.290, 1.120, 0.095], c: [0.265, 0.930, 0.045], l: "разгибание локтя" },
    biceps:   { a: [0.275, 0.800, 0.028], b: [0.300, 1.000, 0.090], c: [0.230, 1.195, 0.110], l: "сгибание локтя" },
    chest:    { a: [0.110, 1.196, 0.115], b: [0.125, 1.220, 0.240], c: [0.110, 1.235, 0.350], l: "жим от груди" },
    delts:    { a: [0.260, 1.250, 0.040], b: [0.235, 1.470, 0.020], c: [0.160, 1.690, 0.000], l: "жим вверх" },
    delts_rear: { a: [0.260, 1.250, -0.045], b: [0.315, 1.280, 0.085], c: [0.290, 1.300, 0.220], l: "отведение назад" },
    traps:    { a: [0.230, 1.215, 0.010], b: [0.232, 1.290, 0.010], c: [0.230, 1.365, 0.010], l: "подъём плеч" },
    lats:     { a: [0.230, 0.950, 0.320], b: [0.245, 0.990, 0.180], c: [0.250, 1.030, 0.055], l: "тяга к корпусу" },
    lowback:  { a: [0.000, 0.700, 0.300], b: [0.000, 0.820, 0.180], c: [0.000, 0.900, 0.070], l: "выпрямление спины" },
    abs:      { a: [0.000, 1.330, 0.100], b: [0.000, 1.230, 0.195], c: [0.000, 1.120, 0.260], l: "скручивание" },
    obliques: { a: [0.140, 1.150, 0.060], b: [0.210, 1.080, 0.060], c: [0.245, 0.980, 0.055], l: "наклон в сторону" },
    forearms: { a: [0.285, 0.860, 0.055], b: [0.290, 0.895, 0.110], c: [0.282, 0.935, 0.130], l: "сгибание кисти" },
    glutes:   { a: [0.000, 0.560, -0.040], b: [0.000, 0.660, -0.015], c: [0.000, 0.760, 0.005], l: "подъём таза" },
    quads:    { a: [0.000, 0.540, 0.010], b: [0.000, 0.660, 0.005], c: [0.000, 0.780, 0.000], l: "подъём из приседа" },
    hams:     { a: [0.100, 0.270, -0.025], b: [0.115, 0.380, -0.115], c: [0.110, 0.500, -0.170], l: "сгибание ноги" },
    calves:   { a: [0.095, 0.060, 0.010], b: [0.095, 0.130, 0.010], c: [0.095, 0.200, 0.010], l: "подъём на носки" }
  };

  /* точка на квадратичной кривой */
  function bez(a, b, c, t) {
    var u = 1 - t;
    return [u * u * a[0] + 2 * u * t * b[0] + t * t * c[0],
            u * u * a[1] + 2 * u * t * b[1] + t * t * c[1],
            u * u * a[2] + 2 * u * t * b[2] + t * t * c[2]];
  }

  function mount(cv, holo, groups) {
    if (!cv || !holo) return null;
    var ctx = cv.getContext("2d"), live = true;
    var main = groups && groups.length ? groups[0] : null;

    function size() {
      var d = Math.min(2, window.devicePixelRatio || 1);
      var w = cv.clientWidth, h = cv.clientHeight;
      if (cv.width !== Math.round(w * d)) {
        cv.width = Math.round(w * d); cv.height = Math.round(h * d);
      }
      ctx.setTransform(d, 0, 0, d, 0, 0);
      return { w: w, h: h };
    }

    /* Подпись с линией к точке. Сторона выбирается так, чтобы ярлык
       не налезал на фигуру, а текст не уходил за край холста. */
    function label(p, text, w, h, color, taken) {
      var right = p.x < w * 0.5;
      ctx.font = "600 11px -apple-system, 'Segoe UI', Roboto, sans-serif";
      var tw = ctx.measureText(text).width;
      var pad = 6, lw = tw + pad * 2, lh = 18;
      /* ярлык прижимаем к краю кадра, иначе он закрывает саму мышцу */
      var lx = right ? w - lw - 6 : 6;
      var ly = p.y - lh / 2;
      ly = Math.max(4, Math.min(h - lh - 4, ly));

      /* если ярлык накрывает уже поставленный — сдвигаем ниже */
      if (taken) {
        for (var g = 0; g < 8; g++) {
          var clash = false;
          for (var i = 0; i < taken.length; i++) {
            var q = taken[i];
            if (lx < q.x + q.w + 4 && lx + lw + 4 > q.x && ly < q.y + q.h + 3 && ly + lh + 3 > q.y) { clash = true; break; }
          }
          if (!clash) break;
          ly += lh + 4;
          if (ly + lh > h - 4) { ly = 4 + g * 3; }
        }
        taken.push({ x: lx, y: ly, w: lw, h: lh });
      }

      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(right ? lx : lx + lw, ly + lh / 2);
      ctx.stroke();
      ctx.globalAlpha = 1;

      ctx.fillStyle = "rgba(8,12,20,.82)";
      ctx.beginPath();
      if (ctx.roundRect) { ctx.roundRect(lx, ly, lw, lh, 5); } else { ctx.rect(lx, ly, lw, lh); }
      ctx.fill();
      ctx.strokeStyle = color; ctx.globalAlpha = 0.55; ctx.stroke(); ctx.globalAlpha = 1;

      ctx.fillStyle = "#E8EEF8";
      ctx.fillText(text, lx + pad, ly + 13);

      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(p.x, p.y, 2.6, 0, 6.283); ctx.fill();
    }

    /* Дуга траектории со стрелкой и бегущей по ней точкой */
    function path(move, w, h, beat, taken) {
      var pts = [], i, t, p;
      for (i = 0; i <= 24; i++) {
        p = holo.project(bez(move.a, move.b, move.c, i / 24));
        if (!p) return;
        pts.push(p);
      }
      ctx.strokeStyle = "rgba(190,230,255,.85)";
      ctx.lineWidth = 2.2; ctx.lineCap = "round";
      ctx.setLineDash([7, 5]);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
      ctx.setLineDash([]);

      /* стрелка на конце */
      var e = pts[pts.length - 1], q = pts[pts.length - 4];
      var ang = Math.atan2(e.y - q.y, e.x - q.x);
      ctx.fillStyle = "rgba(190,230,255,.95)";
      ctx.beginPath();
      ctx.moveTo(e.x, e.y);
      ctx.lineTo(e.x - Math.cos(ang - 0.42) * 12, e.y - Math.sin(ang - 0.42) * 12);
      ctx.lineTo(e.x - Math.cos(ang + 0.42) * 12, e.y - Math.sin(ang + 0.42) * 12);
      ctx.closePath(); ctx.fill();

      /* точка идёт по дуге в такт подсветке мышцы */
      var tt = beat.phase < 0.4 ? beat.phase / 0.4 : 1 - (beat.phase - 0.4) / 0.6;
      var m = holo.project(bez(move.a, move.b, move.c, Math.max(0, Math.min(1, tt))));
      if (m) {
        var gg = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, 11);
        gg.addColorStop(0, "rgba(255,190,120,.95)");
        gg.addColorStop(1, "rgba(255,150,60,0)");
        ctx.fillStyle = gg;
        ctx.beginPath(); ctx.arc(m.x, m.y, 11, 0, 6.283); ctx.fill();
      }

      /* подпись движения у начала дуги, в обход уже занятых мест */
      ctx.font = "600 11px -apple-system, 'Segoe UI', Roboto, sans-serif";
      var tw = ctx.measureText(move.l).width;
      var lx = Math.max(6, Math.min(w - tw - 8, pts[0].x - tw / 2));
      var ly = Math.max(16, Math.min(h - 10, pts[0].y + 26));
      if (taken) {
        for (var g = 0; g < 8; g++) {
          var clash = false;
          for (var i2 = 0; i2 < taken.length; i2++) {
            var q = taken[i2];
            if (lx < q.x + q.w + 4 && lx + tw + 4 > q.x && ly - 11 < q.y + q.h + 3 && ly + 4 > q.y) { clash = true; break; }
          }
          if (!clash) break;
          ly += 17;
          if (ly > h - 10) { ly = 16 + g * 4; }
        }
        taken.push({ x: lx, y: ly - 11, w: tw, h: 15 });
      }
      ctx.fillStyle = "rgba(8,12,20,.75)";
      ctx.fillRect(lx - 4, ly - 11, tw + 8, 15);
      ctx.fillStyle = "rgba(190,230,255,.95)";
      ctx.fillText(move.l, lx, ly);
    }

    var fr = 0, half = window.innerWidth < 760;         /* на телефоне рисуем через кадр */
    function frame() {
      if (!live || !cv.isConnected) { live = false; return; }
      if (document.visibilityState !== "visible") { requestAnimationFrame(frame); return; }
      if (half && (++fr & 1)) { requestAnimationFrame(frame); return; }
      var s = size();
      ctx.clearRect(0, 0, s.w, s.h);

      var beat = holo.beat();
      var heads = main && HEADS[main];
      var move = main && MOVES[main];

      var taken = [];
      if (heads) {
        for (var i = 0; i < heads.length; i++) {
          var p = holo.project(heads[i][1]);
          if (!p) continue;
          /* первый пучок выделяем тёплым, остальные холодным */
          var col = i === 0 ? "rgba(255,150,90,.95)" : "rgba(120,200,255,.9)";
          label(p, heads[i][0], s.w, s.h, col, taken);
        }
      }
      if (move) path(move, s.w, s.h, beat, taken);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    return {
      stop: function () { live = false; },
      set: function (gs) { main = gs && gs.length ? gs[0] : null; },
      has: function (key) { return !!(HEADS[key] || MOVES[key]); }
    };
  }

  return { mount: mount, HEADS: HEADS, MOVES: MOVES };
})();
