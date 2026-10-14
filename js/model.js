/* Объёмная проекция на настоящей анатомической модели.
   Геометрия берётся из model/body.bin (мышцы и кости, собранные из
   BodyParts3D), рисуется обычным мешем — это и точнее, и быстрее, чем
   прежняя фигура, которую приходилось описывать формулами.
   Наружу отдаёт тот же набор методов, что и старый Holo. */
(function (w) {
  "use strict";

  var GKEYS = ["chest", "abs", "obliques", "traps", "delts", "delts_rear", "biceps",
               "triceps", "forearms", "lats", "lowback", "glutes", "quads", "hams", "calves"];

  var BASE = "model/";
  var data = null, pending = null;

  /* ── загрузка: один раз на страницу ── */
  function load() {
    if (data) return Promise.resolve(data);
    if (pending) return pending;
    pending = Promise.all([
      fetch(BASE + "body.json").then(function (r) { return r.json(); }),
      fetch(BASE + "body.bin").then(function (r) { return r.arrayBuffer(); })
    ]).then(function (res) {
      data = { meta: res[0], buf: res[1] };
      return data;
    });
    return pending;
  }

  var VS = [
    "attribute vec3 aPos;",
    "attribute vec3 aNor;",
    "uniform mat4 uMVP;",
    "varying vec3 vN;",
    "varying vec3 vP;",
    "void main(){",
    "  vec3 p = aPos * 2.0;",                 /* позиции сжаты вдвое при упаковке */
    "  vN = aNor;",
    "  vP = p;",
    "  gl_Position = uMVP * vec4(p, 1.0);",
    "}"
  ].join("\n");

  var FS = [
    "precision highp float;",
    "varying vec3 vN;",
    "varying vec3 vP;",
    "uniform vec3 uEye;",
    "uniform float uOn;",                     /* 0 — покой, 1 — мышца в работе */
    "uniform float uTime;",
    "void main(){",
    "  vec3 n = normalize(vN);",
    "  vec3 v = normalize(uEye - vP);",
    "  if (dot(n, v) < 0.0) n = -n;",         /* модель местами вывернута наизнанку */

    /* студийный свет в осях камеры: ключевой, заполняющий, контровой */
    "  vec3 cr = normalize(cross(vec3(0.0, 1.0, 0.0), v));",
    "  vec3 cu = cross(v, cr);",
    "  vec3 l1 = normalize(v + cr * 0.72 + cu * 0.92);",
    "  vec3 l2 = normalize(v - cr * 1.05 + cu * 0.12);",
    "  vec3 l3 = normalize(-v + cu * 0.55);",
    "  float k1 = max(dot(n, l1), 0.0);",
    "  float k2 = max(dot(n, l2), 0.0);",
    "  float k3 = pow(max(dot(n, l3), 0.0), 1.8);",
    "  float sp = pow(max(dot(n, normalize(l1 + v)), 0.0), 86.0);",
    "  float fr = pow(1.0 - max(dot(n, v), 0.0), 3.2);",

    /* отражение студии: сверху светлое, снизу холодное */
    "  vec3 env = mix(vec3(0.08, 0.14, 0.30), vec3(0.80, 0.86, 0.96),",
    "                 clamp(reflect(-v, n).y * 0.5 + 0.5, 0.0, 1.0));",

    "  vec3 cold = vec3(0.90, 0.905, 0.930);",
    "  vec3 hot  = vec3(1.0, 0.24, 0.20);",
    "  vec3 alb  = mix(cold, hot, uOn * 0.92);",
    "  vec3 c = alb * (0.12 + k1 * 0.94 + k2 * 0.24) + alb * k3 * 0.36;",
    "  c += env * (0.10 + fr * 0.45);",
    "  c += vec3(1.0) * sp * 0.85;",
    "  c += hot * fr * uOn * 0.5;",

    /* бегущая полоса осмотра */
    "  float sweepY = mod(uTime * 0.42, 2.6) - 0.3;",
    "  c += vec3(0.40, 0.68, 1.0) * exp(-pow((vP.y - sweepY) * 13.0, 2.0)) * 0.10;",

    "  gl_FragColor = vec4(c / (1.0 + c * 0.14), 1.0);",
    "}"
  ].join("\n");

  /* Фон рисуется отдельным проходом: луч на каждый пиксель строится из
     осей камеры, по нему находим пол и ставим сетку. Дёшево и не мешает модели. */
  var BVS = [
    "attribute vec2 aP;",
    "varying vec2 vUv;",
    "void main(){ vUv = aP; gl_Position = vec4(aP, 0.0, 1.0); }"
  ].join("\n");

  var BFS = [
    "precision highp float;",
    "varying vec2 vUv;",
    "uniform vec3 uEye, uRight, uUp, uFwd;",
    "uniform float uAsp, uTan, uTime;",
    "void main(){",
    "  vec3 rd = normalize(uFwd + uRight * (vUv.x * uAsp * uTan) + uUp * (vUv.y * uTan));",
    "  float vg = length(vUv);",
    "  vec3 c = mix(vec3(0.07,0.14,0.30), vec3(0.015,0.03,0.09), clamp(vg * 0.75, 0.0, 1.0));",
    "  float a = smoothstep(1.45, 0.15, vg) * 0.96;",
    "  if (rd.y < -0.001) {",
    "    float tp = -uEye.y / rd.y;",
    "    if (tp > 0.0 && tp < 16.0) {",
    "      vec3 pf = uEye + rd * tp;",
    "      vec2 gf = abs(fract(pf.xz * 3.2) - 0.5);",
    "      float ln = 1.0 - smoothstep(0.0, 0.035, min(gf.x, gf.y));",
    "      float fade = exp(-length(pf.xz) * 0.85);",
    "      float pool = exp(-dot(pf.xz, pf.xz) * 4.0) * 0.5;",
    "      float ring = exp(-pow((length(pf.xz) - mod(uTime * 0.5, 2.2)) * 5.0, 2.0)) * 0.2;",
    "      c += vec3(0.25,0.55,1.0) * (ln * 0.30 + pool + ring) * fade;",
    "      a = max(a, (ln * 0.45 + pool + ring) * fade);",
    "    }",
    "  }",
    "  gl_FragColor = vec4(c, clamp(a, 0.0, 1.0));",
    "}"
  ].join("\n");

  function compile(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  }

  /* ── немного матричной арифметики (столбцами, как принято в WebGL) ── */
  function mul(a, b) {
    var o = new Float32Array(16), i, j, k, s;
    for (i = 0; i < 4; i++) for (j = 0; j < 4; j++) {
      s = 0;
      for (k = 0; k < 4; k++) s += a[i * 4 + k] * b[k * 4 + j];
      o[i * 4 + j] = s;
    }
    return o;
  }
  function norm3(v) { var l = Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]) || 1; return [v[0]/l, v[1]/l, v[2]/l]; }
  function cross3(a, b) { return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
  function dot3(a, b) { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }

  function lookAt(eye, tgt) {
    var f = norm3([tgt[0]-eye[0], tgt[1]-eye[1], tgt[2]-eye[2]]);
    var s = norm3(cross3(f, [0, 1, 0]));
    var u = cross3(s, f);
    return new Float32Array([
      s[0], u[0], -f[0], 0,
      s[1], u[1], -f[1], 0,
      s[2], u[2], -f[2], 0,
      -dot3(s, eye), -dot3(u, eye), dot3(f, eye), 1]);
  }
  function persp(fovY, asp, n, f) {
    var t = 1 / Math.tan(fovY / 2);
    return new Float32Array([t/asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f+n)/(n-f), -1, 0, 0, 2*f*n/(n-f), 0]);
  }

  /* С какой стороны показывать группу. Определять «спереди или сзади»
     по координатам ненадёжно: руки висят вдоль тела, и у бицепса центр
     оказывается за серединой корпуса. Поэтому сторона задана явно. */
  var SIDE = {
    chest: -0.30, abs: 0.0, obliques: -0.95, traps: Math.PI,
    delts: -0.85, delts_rear: Math.PI + 0.60, biceps: -0.90,
    triceps: Math.PI - 0.80, forearms: -0.95, lats: Math.PI - 0.40,
    lowback: Math.PI, glutes: Math.PI + 0.20, quads: 0.22,
    hams: Math.PI, calves: Math.PI + 0.20
  };

  /* ── куда смотреть при показе группы ──
     Мышцы парные, поэтому берём одну сторону (в модели правая — это
     отрицательный x) и подводим камеру вплотную к ней. */
  function focusOf(meta, key) {
    var marks = meta.marks || {}, pts = [], fid, m;
    for (fid in marks) {
      if (!marks.hasOwnProperty(fid)) continue;
      m = marks[fid];
      if (m.g === key) pts.push(m);
    }
    if (!pts.length) return null;
    var side = [], i;
    for (i = 0; i < pts.length; i++) if (pts[i].c[0] <= 0.01) side.push(pts[i]);
    if (side.length) pts = side;

    var lo = [9, 9, 9], hi = [-9, -9, -9], t;
    for (i = 0; i < pts.length; i++) for (t = 0; t < 3; t++) {
      lo[t] = Math.min(lo[t], pts[i].lo[t]);
      hi[t] = Math.max(hi[t], pts[i].hi[t]);
    }
    var c = [(lo[0]+hi[0])/2, (lo[1]+hi[1])/2, (lo[2]+hi[2])/2];
    var dx = hi[0]-lo[0], dy = hi[1]-lo[1], dz = hi[2]-lo[2];
    var span = Math.sqrt(dx*dx + dy*dy + dz*dz);
    return {
      t: [c[0], c[1], c[2] * 0.7],                  /* смотрим точно в центр мышцы */
      yaw: (SIDE[key] === undefined ? -0.32 : SIDE[key]),
      pitch: 0.05,
      d: Math.max(0.55, span * 2.6)
    };
  }

  var WIDE = { t: [0, 0.95, 0], yaw: 0.45, pitch: 0.03, d: 2.25 };

  function mount(cv, on, on2, onReady) {
    var gl = null;
    /* сглаживание кромок стоит дорого на телефоне; вместо него берём
       чуть большее разрешение буфера */
    /* сглаживание кромок включаем только на больших экранах: на телефоне
       оно дороже, чем выигрыш в чёткости */
    var aa = (w.innerWidth >= 900 && (w.devicePixelRatio || 1) < 2);
    try { gl = cv.getContext("webgl", { antialias: aa, alpha: true, premultipliedAlpha: false }); } catch (e) {}
    if (!gl) return null;

    var vs = compile(gl, gl.VERTEX_SHADER, VS), fs = compile(gl, gl.FRAGMENT_SHADER, FS);
    if (!vs || !fs) return null;
    var prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
    gl.useProgram(prog);
    gl.enable(gl.DEPTH_TEST);

    /* вторая программа — для фона */
    var bvs = compile(gl, gl.VERTEX_SHADER, BVS), bfs = compile(gl, gl.FRAGMENT_SHADER, BFS);
    var bprog = null, bq = null, BA = null, BU = null;
    if (bvs && bfs) {
      bprog = gl.createProgram();
      gl.attachShader(bprog, bvs); gl.attachShader(bprog, bfs); gl.linkProgram(bprog);
      if (gl.getProgramParameter(bprog, gl.LINK_STATUS)) {
        bq = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, bq);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
        BA = gl.getAttribLocation(bprog, "aP");
        BU = { eye: gl.getUniformLocation(bprog, "uEye"), right: gl.getUniformLocation(bprog, "uRight"),
               up: gl.getUniformLocation(bprog, "uUp"), fwd: gl.getUniformLocation(bprog, "uFwd"),
               asp: gl.getUniformLocation(bprog, "uAsp"), tan: gl.getUniformLocation(bprog, "uTan"),
               time: gl.getUniformLocation(bprog, "uTime") };
      } else { bprog = null; }
    }

    var A = { pos: gl.getAttribLocation(prog, "aPos"), nor: gl.getAttribLocation(prog, "aNor") };
    var U = { mvp: gl.getUniformLocation(prog, "uMVP"), eye: gl.getUniformLocation(prog, "uEye"),
              on: gl.getUniformLocation(prog, "uOn"), time: gl.getUniformLocation(prog, "uTime") };

    var parts = [], meta = null, live = true, ready = false;
    var yaw = WIDE.yaw, pitch = WIDE.pitch, dist = WIDE.d, tgt = WIDE.t.slice();
    var to = null, auto = 1, drag = null, pts = {}, pinch = 0;
    var lit = new Float32Array(16), pulse = 0, beat = 0;
    var t0 = (w.performance ? performance.now() : Date.now());
    var scale = 1, qi = (w.innerWidth < 760 ? 1 : 0), hold = 0, acc = 0, accN = 0, tLast = 0;
    var QUAL = [1.0, 0.85, 0.7, 0.55];
    var mvp = null, eye = [0, 0, 1];

    function setGroups(a, b) {
      a = a || []; b = b || [];
      var i;
      for (i = 0; i < 16; i++) lit[i] = 0;
      for (i = 0; i < GKEYS.length; i++) {
        if (a.indexOf(GKEYS[i]) >= 0) lit[i] = 1;
        else if (b.indexOf(GKEYS[i]) >= 0) lit[i] = 0.3;
      }
    }
    setGroups(on, on2);

    function px() { return Math.min(w.devicePixelRatio || 1, 1.5) * QUAL[qi] * scale; }
    function size() {
      var d = px();
      cv.width = Math.max(1, Math.round(cv.clientWidth * d));
      cv.height = Math.max(1, Math.round(cv.clientHeight * d));
      gl.viewport(0, 0, cv.width, cv.height);
    }

    /* ── управление пальцем и колесом ── */
    function zoom(k) { to = null; auto = 0; dist = Math.max(0.30, Math.min(3.2, dist * k)); }
    function spread() {
      var k = [], id;
      for (id in pts) if (pts.hasOwnProperty(id)) k.push(pts[id]);
      if (k.length < 2) return 0;
      return Math.sqrt(Math.pow(k[0].x - k[1].x, 2) + Math.pow(k[0].y - k[1].y, 2));
    }
    function down(e) {
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      pinch = spread();
      drag = pinch ? null : { x: e.clientX, y: e.clientY };
      auto = 0;
      try { cv.setPointerCapture(e.pointerId); } catch (err) {}
    }
    function move(e) {
      if (pts[e.pointerId]) { pts[e.pointerId].x = e.clientX; pts[e.pointerId].y = e.clientY; }
      var sp = spread();
      if (sp && pinch) { zoom(pinch / sp); pinch = sp; return; }
      if (!drag) return;
      yaw -= (e.clientX - drag.x) * 0.012;
      pitch = Math.max(-0.6, Math.min(0.6, pitch + (e.clientY - drag.y) * 0.006));
      drag.x = e.clientX; drag.y = e.clientY;
      to = null;
    }
    function up(e) {
      if (e && e.pointerId !== undefined) delete pts[e.pointerId];
      pinch = spread();
      drag = null;
    }
    function wheel(e) { e.preventDefault(); zoom(1 + (e.deltaY > 0 ? 1 : -1) * 0.09); }
    var tapT = 0;
    function tap() {
      var n = Date.now();
      if (n - tapT < 320) to = { t: WIDE.t.slice(), d: WIDE.d, yaw: null, pitch: WIDE.pitch };
      tapT = n;
    }
    cv.addEventListener("pointerdown", down);
    cv.addEventListener("pointermove", move);
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", up);
    cv.addEventListener("pointerup", tap);
    cv.addEventListener("wheel", wheel, { passive: false });

    load().then(function (d) {
      if (!live) return;
      meta = d.meta;
      var buf = d.buf;
      meta.chunks.forEach(function (c) {
        var pb = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, pb);
        gl.bufferData(gl.ARRAY_BUFFER, new Int16Array(buf, c.vo, c.vc * 3), gl.STATIC_DRAW);
        var nb = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, nb);
        gl.bufferData(gl.ARRAY_BUFFER, new Int8Array(buf, c.no, c.vc * 3), gl.STATIC_DRAW);
        var ib = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(buf, c.io, c.ic), gl.STATIC_DRAW);
        parts.push({ pb: pb, nb: nb, ib: ib, n: c.ic, g: c.g });
      });
      ready = true;
      if (onReady) onReady();
    })["catch"](function () { if (onReady) onReady(new Error("модель не загрузилась")); });

    function grade(ms) {
      if (hold > 0) { hold--; return; }
      if (ms > 23 && qi < 3) { qi++; size(); hold = 2; }
      else if (ms < 12 && qi > 0) { qi--; size(); hold = 8; }
    }

    function frame(now) {
      if (!live || !cv.isConnected) { live = false; return; }
      if (document.visibilityState !== "visible") { requestAnimationFrame(frame); return; }
      var t = ((w.performance ? performance.now() : Date.now()) - t0) / 1000;

      if (tLast) {
        acc += now - tLast; accN++;
        if (accN >= 20) { grade(acc / accN); acc = 0; accN = 0; }
      }
      tLast = now;

      if (auto) yaw += 0.0045;
      if (to) {
        var k = 0.09, done = 1, ax;
        for (ax = 0; ax < 3; ax++) {
          tgt[ax] += (to.t[ax] - tgt[ax]) * k;
          if (Math.abs(to.t[ax] - tgt[ax]) > 0.002) done = 0;
        }
        dist += (to.d - dist) * k;
        pitch += (to.pitch - pitch) * k;
        if (Math.abs(to.d - dist) > 0.004) done = 0;
        if (to.yaw !== null) {
          var dy = ((to.yaw - yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
          yaw += dy * k;
          if (Math.abs(dy) > 0.01) done = 0;
        }
        if (done) to = null;
      }

      /* такт движения: 0.6 с усилие, 0.9 с возврат */
      beat = (t % 1.5) / 1.5;
      pulse = beat < 0.4 ? Math.sin(beat / 0.4 * Math.PI * 0.5)
                         : Math.cos((beat - 0.4) / 0.6 * Math.PI * 0.5);

      if (cv.width !== Math.round(cv.clientWidth * px())) size();
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if (!ready) { requestAnimationFrame(frame); return; }

      var cp = Math.cos(pitch), sp = Math.sin(pitch);
      eye = [tgt[0] + Math.sin(yaw) * cp * dist, tgt[1] + sp * dist, tgt[2] + Math.cos(yaw) * cp * dist];
      var view = lookAt(eye, tgt);
      var proj = persp(0.95, cv.width / Math.max(1, cv.height), 0.03, 20);
      mvp = mul(view, proj);

      if (bprog) {                                   /* фон: сначала сцена, потом фигура */
        var fv = norm3([tgt[0]-eye[0], tgt[1]-eye[1], tgt[2]-eye[2]]);
        var rv = norm3(cross3(fv, [0, 1, 0]));
        var uv2 = cross3(rv, fv);
        gl.useProgram(bprog);
        gl.disable(gl.DEPTH_TEST);
        gl.uniform3fv(BU.eye, new Float32Array(eye));
        gl.uniform3fv(BU.right, new Float32Array(rv));
        gl.uniform3fv(BU.up, new Float32Array(uv2));
        gl.uniform3fv(BU.fwd, new Float32Array(fv));
        gl.uniform1f(BU.asp, cv.width / Math.max(1, cv.height));
        gl.uniform1f(BU.tan, Math.tan(0.475));
        gl.uniform1f(BU.time, t);
        gl.bindBuffer(gl.ARRAY_BUFFER, bq);
        gl.enableVertexAttribArray(BA);
        gl.vertexAttribPointer(BA, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.enable(gl.DEPTH_TEST);
        gl.useProgram(prog);
      }

      gl.uniformMatrix4fv(U.mvp, false, mvp);
      gl.uniform3fv(U.eye, new Float32Array(eye));
      gl.uniform1f(U.time, t);

      parts.forEach(function (p) {
        var on1 = p.g >= 0 ? lit[p.g] : 0;
        gl.uniform1f(U.on, on1 * (0.55 + 0.45 * pulse));
        gl.bindBuffer(gl.ARRAY_BUFFER, p.pb);
        gl.enableVertexAttribArray(A.pos);
        gl.vertexAttribPointer(A.pos, 3, gl.SHORT, true, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, p.nb);
        gl.enableVertexAttribArray(A.nor);
        gl.vertexAttribPointer(A.nor, 3, gl.BYTE, true, 0, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, p.ib);
        gl.drawElements(gl.TRIANGLES, p.n, gl.UNSIGNED_SHORT, 0);
      });
      requestAnimationFrame(frame);
    }
    size();
    requestAnimationFrame(frame);

    /* точка модели -> координаты на холсте (для выносок поверх картинки) */
    function project(p) {
      if (!mvp) return null;
      var x = mvp[0]*p[0] + mvp[4]*p[1] + mvp[8]*p[2] + mvp[12];
      var y = mvp[1]*p[0] + mvp[5]*p[1] + mvp[9]*p[2] + mvp[13];
      var wv = mvp[3]*p[0] + mvp[7]*p[1] + mvp[11]*p[2] + mvp[15];
      if (wv <= 0.001) return null;
      var W = cv.clientWidth, H = cv.clientHeight;
      return { x: (x / wv * 0.5 + 0.5) * W, y: (1 - (y / wv * 0.5 + 0.5)) * H, z: wv };
    }

    return {
      stop: function () { live = false; },
      set: function (a, b) { setGroups(a, b); },
      reset: function () { to = { t: WIDE.t.slice(), d: WIDE.d, yaw: WIDE.yaw, pitch: WIDE.pitch }; auto = 1; },
      focus: function (key) {
        var f = meta && key ? focusOf(meta, key) : null;
        try {                                        /* след для проверок: куда встала камера */
          localStorage.setItem("__model", JSON.stringify({ key: key, есть: !!f, f: f }));
        } catch (e) {}
        to = f ? { t: f.t, d: f.d, yaw: f.yaw, pitch: f.pitch }
               : { t: WIDE.t.slice(), d: WIDE.d, yaw: WIDE.yaw, pitch: WIDE.pitch };
        auto = 0;
      },
      marks: function () { return meta ? (meta.marks || {}) : {}; },
      ready: function () { return ready; },
      project: project,
      view: function (y, pt, d, t) {
        to = { t: (t || WIDE.t).slice(), d: d || WIDE.d, yaw: y, pitch: pt || 0 };
        auto = 0;
      },
      beat: function () { return { pulse: pulse, phase: beat }; },
      size: function () { return { w: cv.clientWidth, h: cv.clientHeight }; }
    };
  }

  function supported() {
    try {
      var c = document.createElement("canvas");
      return !!(c.getContext("webgl") || c.getContext("experimental-webgl"));
    } catch (e) { return false; }
  }

  w.Model = { mount: mount, supported: supported, load: load, keys: GKEYS };
})(window);
