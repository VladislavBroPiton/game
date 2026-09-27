/* Кузница — голографическая проекция тела.
   Свой маленький движок на WebGL: без библиотек, без моделей и без
   загрузок. Фигура собрана из эллипсоидов — каркас плюс «накладки» мышц,
   у каждой своё имя группы. Работающие мышцы разгораются.
   Материал голографический: свечение по краю (Френель) и бегущие полосы. */

var Holo = (function () {
  /* ── матрицы 4x4 ─────────────────────────────────────────── */
  function ident() { return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]); }

  function mul(a, b) {
    var o = new Float32Array(16), i, j, k, s;
    for (i = 0; i < 4; i++) for (j = 0; j < 4; j++) {
      s = 0;
      for (k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k];
      o[i * 4 + j] = s;
    }
    return o;
  }

  function persp(fov, asp, n, f) {
    var t = 1 / Math.tan(fov / 2), o = new Float32Array(16);
    o[0] = t / asp; o[5] = t; o[10] = (f + n) / (n - f); o[11] = -1; o[14] = 2 * f * n / (n - f);
    return o;
  }

  /* сдвиг, масштаб и наклон в плоскости экрана — этого хватает для накладок */
  function trs(x, y, z, sx, sy, sz, rz) {
    var c = Math.cos(rz || 0), s = Math.sin(rz || 0), o = ident();
    o[0] = c * sx; o[1] = s * sx; o[4] = -s * sy; o[5] = c * sy; o[10] = sz;
    o[12] = x; o[13] = y; o[14] = z;
    return o;
  }

  function rotY(a) { var c = Math.cos(a), s = Math.sin(a), o = ident(); o[0] = c; o[2] = -s; o[8] = s; o[10] = c; return o; }
  function rotX(a) { var c = Math.cos(a), s = Math.sin(a), o = ident(); o[5] = c; o[6] = s; o[9] = -s; o[10] = c; return o; }
  function trans(x, y, z) { var o = ident(); o[12] = x; o[13] = y; o[14] = z; return o; }

  /* ── сфера: одна геометрия на все части тела ─────────────── */
  function sphere(seg, ring) {
    var pos = [], nrm = [], idx = [], i, j, u, v, x, y, z, a, b;
    for (i = 0; i <= ring; i++) {
      v = i / ring * Math.PI;
      for (j = 0; j <= seg; j++) {
        u = j / seg * 6.28318;
        x = Math.sin(v) * Math.cos(u); y = Math.cos(v); z = Math.sin(v) * Math.sin(u);
        pos.push(x, y, z); nrm.push(x, y, z);
      }
    }
    for (i = 0; i < ring; i++) for (j = 0; j < seg; j++) {
      a = i * (seg + 1) + j; b = a + seg + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
    return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), idx: new Uint16Array(idx) };
  }

  /* ── фигура ───────────────────────────────────────────────
     x вправо, y вверх, z вперёд, рост около 2 единиц.
     g — ключ группы мышц, null — каркас, он не подсвечивается. */
  var BODY = [
    { g: null, p: [0, 1.62, 0],          s: [0.115, 0.145, 0.125] },
    { g: null, p: [0, 1.45, 0],          s: [0.055, 0.055, 0.055] },
    { g: null, p: [0, 1.10, 0],          s: [0.215, 0.30, 0.135] },
    { g: null, p: [0, 0.78, 0],          s: [0.175, 0.20, 0.115] },
    { g: null, p: [0, 0.55, 0],          s: [0.195, 0.13, 0.125] },
    { g: null, p: [-0.30, 1.16, 0],      s: [0.075, 0.175, 0.075], r: 0.12 },
    { g: null, p: [0.30, 1.16, 0],       s: [0.075, 0.175, 0.075], r: -0.12 },
    { g: null, p: [-0.34, 0.80, 0],      s: [0.062, 0.165, 0.062] },
    { g: null, p: [0.34, 0.80, 0],       s: [0.062, 0.165, 0.062] },
    { g: null, p: [-0.30, 0.60, 0],      s: [0.05, 0.065, 0.05] },
    { g: null, p: [0.30, 0.60, 0],       s: [0.05, 0.065, 0.05] },
    { g: null, p: [-0.10, 0.28, 0],      s: [0.095, 0.25, 0.10] },
    { g: null, p: [0.10, 0.28, 0],       s: [0.095, 0.25, 0.10] },
    { g: null, p: [-0.10, -0.10, 0],     s: [0.075, 0.21, 0.085] },
    { g: null, p: [0.10, -0.10, 0],      s: [0.075, 0.21, 0.085] },
    { g: null, p: [-0.10, -0.32, 0.04],  s: [0.065, 0.045, 0.11] },
    { g: null, p: [0.10, -0.32, 0.04],   s: [0.065, 0.045, 0.11] },

    { g: "chest",    p: [-0.10, 1.20, 0.10],   s: [0.105, 0.085, 0.07] },
    { g: "chest",    p: [0.10, 1.20, 0.10],    s: [0.105, 0.085, 0.07] },
    { g: "abs",      p: [0, 0.83, 0.10],       s: [0.085, 0.18, 0.055] },
    { g: "obliques", p: [-0.155, 0.85, 0.05],  s: [0.045, 0.15, 0.075] },
    { g: "obliques", p: [0.155, 0.85, 0.05],   s: [0.045, 0.15, 0.075] },
    { g: "traps",    p: [0, 1.34, -0.03],      s: [0.20, 0.075, 0.09] },
    { g: "delts",    p: [-0.285, 1.27, 0],     s: [0.095, 0.085, 0.095] },
    { g: "delts",    p: [0.285, 1.27, 0],      s: [0.095, 0.085, 0.095] },
    { g: "delts_rear", p: [-0.285, 1.27, -0.05], s: [0.09, 0.08, 0.07] },
    { g: "delts_rear", p: [0.285, 1.27, -0.05],  s: [0.09, 0.08, 0.07] },
    { g: "biceps",   p: [-0.305, 1.10, 0.045], s: [0.058, 0.115, 0.05] },
    { g: "biceps",   p: [0.305, 1.10, 0.045],  s: [0.058, 0.115, 0.05] },
    { g: "triceps",  p: [-0.315, 1.10, -0.05], s: [0.055, 0.12, 0.05] },
    { g: "triceps",  p: [0.315, 1.10, -0.05],  s: [0.055, 0.12, 0.05] },
    { g: "forearms", p: [-0.345, 0.80, 0.02],  s: [0.058, 0.15, 0.055] },
    { g: "forearms", p: [0.345, 0.80, 0.02],   s: [0.058, 0.15, 0.055] },
    { g: "lats",     p: [-0.19, 1.02, -0.07],  s: [0.075, 0.20, 0.075], r: -0.22 },
    { g: "lats",     p: [0.19, 1.02, -0.07],   s: [0.075, 0.20, 0.075], r: 0.22 },
    { g: "lowback",  p: [0, 0.74, -0.10],      s: [0.085, 0.13, 0.05] },
    { g: "glutes",   p: [-0.105, 0.52, -0.09], s: [0.105, 0.095, 0.08] },
    { g: "glutes",   p: [0.105, 0.52, -0.09],  s: [0.105, 0.095, 0.08] },
    { g: "quads",    p: [-0.10, 0.30, 0.055],  s: [0.085, 0.215, 0.06] },
    { g: "quads",    p: [0.10, 0.30, 0.055],   s: [0.085, 0.215, 0.06] },
    { g: "hams",     p: [-0.10, 0.30, -0.07],  s: [0.075, 0.20, 0.05] },
    { g: "hams",     p: [0.10, 0.30, -0.07],   s: [0.075, 0.20, 0.05] },
    { g: "calves",   p: [-0.10, -0.08, -0.05], s: [0.065, 0.135, 0.055] },
    { g: "calves",   p: [0.10, -0.08, -0.05],  s: [0.065, 0.135, 0.055] }
  ];

  var VS = [
    "attribute vec3 aPos;",
    "attribute vec3 aNrm;",
    "uniform mat4 uProj, uView, uModel;",
    "varying vec3 vN, vP;",
    "varying float vY;",
    "void main(){",
    "  vec4 wp = uModel * vec4(aPos, 1.0);",
    "  vN = normalize(mat3(uModel) * aNrm);",
    "  vP = wp.xyz;",
    "  vY = wp.y;",
    "  gl_Position = uProj * uView * wp;",
    "}"
  ].join("\n");

  var FS = [
    "precision mediump float;",
    "varying vec3 vN, vP;",
    "varying float vY;",
    "uniform float uOn, uTime;",
    "uniform vec3 uCam;",
    "void main(){",
    "  vec3 v = normalize(uCam - vP);",
    "  float fres = pow(1.0 - max(dot(normalize(vN), v), 0.0), 2.2);",
    "  float scan = 0.5 + 0.5 * sin(vY * 46.0 - uTime * 2.4);",
    "  vec3 cold = vec3(0.24, 0.62, 1.0);",
    "  vec3 hot = vec3(1.0, 0.52, 0.22);",
    "  vec3 col = mix(cold, hot, uOn);",
    "  float a = 0.52 + fres * 0.42 + uOn * 0.20;",
    "  float lit = 0.22 + fres * 0.85 + scan * (0.05 + 0.22 * uOn) + uOn * 0.35;",
    "  gl_FragColor = vec4(col * lit, clamp(a, 0.0, 0.96));",
    "}"
  ].join("\n");

  function compile(gl, type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) return null;
    return sh;
  }

  function create(cv) {
    var gl = null;
    try { gl = cv.getContext("webgl", { alpha: true, antialias: true, premultipliedAlpha: false }); } catch (e) {}
    if (!gl) return null;

    var vs = compile(gl, gl.VERTEX_SHADER, VS), fs = compile(gl, gl.FRAGMENT_SHADER, FS);
    if (!vs || !fs) return null;
    var p = gl.createProgram();
    gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return null;
    gl.useProgram(p);

    var m = sphere(18, 12);
    var bp = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bp); gl.bufferData(gl.ARRAY_BUFFER, m.pos, gl.STATIC_DRAW);
    var bn = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bn); gl.bufferData(gl.ARRAY_BUFFER, m.nrm, gl.STATIC_DRAW);
    var bi = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bi); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.idx, gl.STATIC_DRAW);

    var aPos = gl.getAttribLocation(p, "aPos"), aNrm = gl.getAttribLocation(p, "aNrm");
    gl.enableVertexAttribArray(aPos); gl.bindBuffer(gl.ARRAY_BUFFER, bp); gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(aNrm); gl.bindBuffer(gl.ARRAY_BUFFER, bn); gl.vertexAttribPointer(aNrm, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bi);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.DEPTH_TEST);                /* с глубиной фигура читается как объём,
                                                а не как стопка светящихся пятен */
    gl.depthFunc(gl.LEQUAL);

    return {
      gl: gl, count: m.idx.length,
      u: {
        proj: gl.getUniformLocation(p, "uProj"), view: gl.getUniformLocation(p, "uView"),
        model: gl.getUniformLocation(p, "uModel"), on: gl.getUniformLocation(p, "uOn"),
        time: gl.getUniformLocation(p, "uTime"), cam: gl.getUniformLocation(p, "uCam")
      }
    };
  }

  /* ── запуск на конкретном холсте ─────────────────────────── */
  function mount(cv, on, on2) {
    var g = create(cv);
    if (!g) return null;
    var gl = g.gl, yaw = 0.45, pitch = 0.05, drag = null, live = true, auto = 1;
    var t0 = (window.performance ? performance.now() : Date.now());
    on = on || []; on2 = on2 || [];

    function dprNow() { return Math.min(2, window.devicePixelRatio || 1); }
    function size() {
      var d = dprNow();
      cv.width = Math.max(1, Math.round(cv.clientWidth * d));
      cv.height = Math.max(1, Math.round(cv.clientHeight * d));
      gl.viewport(0, 0, cv.width, cv.height);
    }
    size();

    function down(e) { drag = { x: e.clientX, y: e.clientY }; auto = 0; try { cv.setPointerCapture(e.pointerId); } catch (err) {} }
    function move(e) {
      if (!drag) return;
      yaw += (e.clientX - drag.x) * 0.012;
      pitch = Math.max(-0.7, Math.min(0.7, pitch + (e.clientY - drag.y) * 0.006));
      drag.x = e.clientX; drag.y = e.clientY;
    }
    function up() { drag = null; }
    cv.addEventListener("pointerdown", down);
    cv.addEventListener("pointermove", move);
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", up);

    function frame() {
      if (!live || !cv.isConnected) { live = false; return; }
      if (document.visibilityState !== "visible") { requestAnimationFrame(frame); return; }

      var t = ((window.performance ? performance.now() : Date.now()) - t0) / 1000;
      if (auto) yaw += 0.004;
      if (cv.width !== Math.round(cv.clientWidth * dprNow())) size();

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      var asp = cv.width / Math.max(1, cv.height);
      var view = mul(trans(0, -0.60, -2.55), mul(rotX(pitch), rotY(yaw)));
      gl.uniformMatrix4fv(g.u.proj, false, persp(0.95, asp, 0.1, 20));
      gl.uniformMatrix4fv(g.u.view, false, view);
      gl.uniform1f(g.u.time, t);
      gl.uniform3f(g.u.cam, 0, 0.60, 2.55);

      for (var i = 0; i < BODY.length; i++) {
        var b = BODY[i];
        var lvl = 0;
        if (b.g) lvl = on.indexOf(b.g) >= 0 ? 1 : (on2.indexOf(b.g) >= 0 ? 0.45 : 0);
        gl.uniform1f(g.u.on, lvl ? lvl * (0.78 + 0.22 * Math.sin(t * 3 + i)) : 0);
        gl.uniformMatrix4fv(g.u.model, false, trs(b.p[0], b.p[1], b.p[2], b.s[0], b.s[1], b.s[2], b.r || 0));
        gl.drawElements(gl.TRIANGLES, g.count, gl.UNSIGNED_SHORT, 0);
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    return {
      stop: function () { live = false; },
      set: function (a, b) { on = a || []; on2 = b || []; },
      reset: function () { yaw = 0.45; pitch = 0.05; auto = 1; }
    };
  }

  function supported() {
    try {
      var c = document.createElement("canvas");
      return !!(c.getContext("webgl") || c.getContext("experimental-webgl"));
    } catch (e) { return false; }
  }

  return { mount: mount, supported: supported };
})();
