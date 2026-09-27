/* Кузница — голографическая проекция тела.
   Тело не собрано из отдельных фигур: оно задано функцией расстояния (SDF)
   и считается лучевым маршем прямо во фрагментном шейдере. Части сливаются
   сглаженным объединением, поэтому мышцы выглядят рельефом на цельном теле,
   а не приклеенными шарами. Каждая часть знает свою группу мышц — работающие
   разгораются. Ни моделей, ни текстур: всё живёт в одном шейдере. */

var Holo = (function () {
  /* порядок важен: индекс здесь равен номеру группы в шейдере */
  var GKEYS = ["chest", "abs", "obliques", "traps", "delts", "delts_rear",
               "biceps", "triceps", "forearms", "lats", "lowback",
               "glutes", "quads", "hams", "calves"];

  var VS = [
    "attribute vec2 aPos;",
    "varying vec2 vUv;",
    "void main(){ vUv = aPos; gl_Position = vec4(aPos, 0.0, 1.0); }"
  ].join("\n");

  var FS = [
    "precision highp float;",
    "varying vec2 vUv;",
    "uniform vec2 uRes;",
    "uniform float uTime, uYaw, uPitch;",
    "uniform float uOn[16];",

    "float sdSph(vec3 p, float r){ return length(p) - r; }",
    "float sdEll(vec3 p, vec3 r){ float k0 = length(p/r); float k1 = length(p/(r*r)); return k0*(k0-1.0)/k1; }",
    "float sdCap(vec3 p, vec3 a, vec3 b, float r){",
    "  vec3 pa = p - a, ba = b - a;",
    "  float h = clamp(dot(pa,ba)/dot(ba,ba), 0.0, 1.0);",
    "  return length(pa - ba*h) - r;",
    "}",
    "vec2 smin2(vec2 a, vec2 b, float k){",
    "  float h = clamp(0.5 + 0.5*(b.x-a.x)/k, 0.0, 1.0);",
    "  float d = mix(b.x, a.x, h) - k*h*(1.0-h);",
    "  return vec2(d, h > 0.5 ? a.y : b.y);",
    "}",

    "vec2 map(vec3 p){",
    "  vec3 q = vec3(abs(p.x), p.y, p.z);",
    "  vec2 r = vec2(sdEll(p - vec3(0.0,1.60,0.02), vec3(0.105,0.135,0.115)), 0.0);",
    "  r = smin2(r, vec2(sdCap(p, vec3(0.0,1.40,0.0), vec3(0.0,1.50,0.0), 0.055), 0.0), 0.05);",
    "  r = smin2(r, vec2(sdEll(p - vec3(0.0,1.14,0.0), vec3(0.175,0.19,0.105)), 0.0), 0.08);",
    "  r = smin2(r, vec2(sdEll(p - vec3(0.0,0.90,0.0), vec3(0.145,0.14,0.09)), 0.0), 0.09);",
    "  r = smin2(r, vec2(sdEll(p - vec3(0.0,0.74,0.0), vec3(0.165,0.12,0.10)), 0.0), 0.08);",
    "  r = smin2(r, vec2(sdCap(q, vec3(0.235,1.27,0.0), vec3(0.275,1.02,0.01), 0.062), 7.0), 0.07);",
    "  r = smin2(r, vec2(sdCap(q, vec3(0.275,1.02,0.01), vec3(0.315,0.80,0.02), 0.05), 9.0), 0.05);",
    "  r = smin2(r, vec2(sdSph(q - vec3(0.325,0.72,0.02), 0.052), 0.0), 0.04);",
    "  r = smin2(r, vec2(sdCap(q, vec3(0.085,0.72,0.0), vec3(0.10,0.40,0.0), 0.088), 13.0), 0.09);",
    "  r = smin2(r, vec2(sdCap(q, vec3(0.10,0.40,0.0), vec3(0.10,0.07,0.01), 0.062), 15.0), 0.06);",
    "  r = smin2(r, vec2(sdEll(q - vec3(0.10,0.035,0.045), vec3(0.055,0.035,0.10)), 0.0), 0.04);",

    "  r = smin2(r, vec2(sdEll(q - vec3(0.075,1.22,0.085), vec3(0.085,0.072,0.05)), 1.0), 0.037);",
    "  r = smin2(r, vec2(sdEll(p - vec3(0.0,0.93,0.085), vec3(0.072,0.135,0.04)), 2.0), 0.043);",
    "  r = smin2(r, vec2(sdEll(q - vec3(0.125,0.94,0.03), vec3(0.04,0.115,0.06)), 3.0), 0.037);",
    "  r = smin2(r, vec2(sdEll(q - vec3(0.10,1.335,-0.02), vec3(0.11,0.05,0.07)), 4.0), 0.037);",
    "  r = smin2(r, vec2(sdEll(q - vec3(0.235,1.285,0.02), vec3(0.075,0.07,0.075)), 5.0), 0.031);",
    "  r = smin2(r, vec2(sdEll(q - vec3(0.235,1.285,-0.06), vec3(0.07,0.062,0.055)), 6.0), 0.031);",
    "  r = smin2(r, vec2(sdEll(q - vec3(0.252,1.16,0.05), vec3(0.05,0.085,0.045)), 7.0), 0.031);",
    "  r = smin2(r, vec2(sdEll(q - vec3(0.262,1.16,-0.045), vec3(0.048,0.09,0.042)), 8.0), 0.031);",
    "  r = smin2(r, vec2(sdEll(q - vec3(0.292,0.955,0.02), vec3(0.052,0.085,0.048)), 9.0), 0.031);",
    "  r = smin2(r, vec2(sdEll(q - vec3(0.135,1.07,-0.055), vec3(0.075,0.14,0.055)), 10.0), 0.043);",
    "  r = smin2(r, vec2(sdEll(p - vec3(0.0,0.90,-0.085), vec3(0.075,0.11,0.04)), 11.0), 0.037);",
    "  r = smin2(r, vec2(sdEll(q - vec3(0.09,0.72,-0.075), vec3(0.09,0.085,0.06)), 12.0), 0.037);",
    "  r = smin2(r, vec2(sdEll(q - vec3(0.085,0.58,0.055), vec3(0.075,0.16,0.045)), 13.0), 0.043);",
    "  r = smin2(r, vec2(sdEll(q - vec3(0.10,0.58,-0.06), vec3(0.065,0.15,0.04)), 14.0), 0.043);",
    "  r = smin2(r, vec2(sdEll(q - vec3(0.10,0.30,-0.045), vec3(0.06,0.10,0.045)), 15.0), 0.037);",
    "  return r;",
    "}",

    "vec3 norm(vec3 p){",
    "  vec2 e = vec2(0.0018, 0.0);",
    "  return normalize(vec3(map(p+e.xyy).x - map(p-e.xyy).x,",
    "                        map(p+e.yxy).x - map(p-e.yxy).x,",
    "                        map(p+e.yyx).x - map(p-e.yyx).x));",
    "}",

    "float onOf(float id){",
    "  float v = 0.0;",
    "  for (int i = 0; i < 16; i++) { if (abs(float(i) - id) < 0.5) v = uOn[i]; }",
    "  return v;",
    "}",

    "void main(){",
    "  vec2 uv = vUv;",
    "  uv.x *= uRes.x / uRes.y;",
    "  float cy = cos(uYaw), sy = sin(uYaw), cp = cos(uPitch), sp = sin(uPitch);",
    "  vec3 ro = vec3(0.0, 0.88, 1.85);",
    "  vec3 rd = normalize(vec3(uv * 0.72, -1.0));",
    "  ro.yz = mat2(cp, -sp, sp, cp) * (ro.yz - vec2(0.88, 0.0)) + vec2(0.88, 0.0);",
    "  rd.yz = mat2(cp, -sp, sp, cp) * rd.yz;",
    "  ro.xz = mat2(cy, -sy, sy, cy) * ro.xz;",
    "  rd.xz = mat2(cy, -sy, sy, cy) * rd.xz;",

    "  float t = 0.0, id = 0.0;",
    "  bool hit = false;",
    "  for (int i = 0; i < 72; i++) {",
    "    vec3 pp = ro + rd * t;",
    "    vec2 d = map(pp);",
    "    if (d.x < 0.0016) { id = d.y; hit = true; break; }",
    "    t += d.x * 0.92;",
    "    if (t > 6.0) break;",
    "  }",
    "  if (!hit) { gl_FragColor = vec4(0.0); return; }",

    "  vec3 p = ro + rd * t;",
    "  vec3 n = norm(p);",
    "  vec3 v = normalize(ro - p);",
    "  float on = onOf(id);",

    "  float fres = pow(1.0 - max(dot(n, v), 0.0), 2.6);",
    "  float lam = max(dot(n, normalize(vec3(0.5, 0.9, 0.7))), 0.0);",
    "  float rim = pow(max(dot(n, normalize(vec3(-0.6, 0.3, -0.7))), 0.0), 2.0);",
    "  float scan = 0.5 + 0.5 * sin(p.y * 64.0 - uTime * 2.6);",
    "  float sweepY = mod(uTime * 0.42, 2.6) - 0.3;",
    "  float sweep = exp(-pow((p.y - sweepY) * 13.0, 2.0));",
    "  float grid = smoothstep(0.75, 1.0, scan) * 0.12;",

    "  vec3 cold = vec3(0.16, 0.52, 1.0);",
    "  vec3 hot = vec3(1.0, 0.45, 0.14);",
    "  vec3 col = mix(cold, hot, on);",
    "  float lit = 0.26 + lam * 0.55 + fres * 1.15 + rim * 0.40 + grid * 1.6 + on * 0.75 + sweep * 0.9;",
    "  float a = 0.46 + fres * 0.45 + lam * 0.22 + on * 0.25 + sweep * 0.25;",
    "  gl_FragColor = vec4(col * lit, clamp(a, 0.0, 0.98));",
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
    try { gl = cv.getContext("webgl", { alpha: true, antialias: false, premultipliedAlpha: false }); } catch (e) {}
    if (!gl) return null;

    var vs = compile(gl, gl.VERTEX_SHADER, VS), fs = compile(gl, gl.FRAGMENT_SHADER, FS);
    if (!vs || !fs) return null;
    var p = gl.createProgram();
    gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return null;
    gl.useProgram(p);

    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var a = gl.getAttribLocation(p, "aPos");
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    return { gl: gl, u: {
      res: gl.getUniformLocation(p, "uRes"), time: gl.getUniformLocation(p, "uTime"),
      yaw: gl.getUniformLocation(p, "uYaw"), pitch: gl.getUniformLocation(p, "uPitch"),
      on: gl.getUniformLocation(p, "uOn[0]")
    } };
  }

  function mount(cv, on, on2) {
    var g = create(cv);
    if (!g) return null;
    var gl = g.gl, yaw = 0.5, pitch = 0.0, drag = null, live = true, auto = 1;
    var t0 = (window.performance ? performance.now() : Date.now());
    var lit = new Float32Array(16), scale = 1;

    function setGroups(a, b) {
      a = a || []; b = b || [];
      var i;
      for (i = 0; i < 16; i++) lit[i] = 0;
      for (i = 0; i < GKEYS.length; i++) {
        if (a.indexOf(GKEYS[i]) >= 0) lit[i + 1] = 1;
        else if (b.indexOf(GKEYS[i]) >= 0) lit[i + 1] = 0.45;
      }
    }
    setGroups(on, on2);

    /* лучевой марш дорог по пикселям: на плотных экранах считаем мельче */
    function px() { return Math.min(window.devicePixelRatio || 1, 1.5) * scale; }
    function size() {
      var d = px();
      cv.width = Math.max(1, Math.round(cv.clientWidth * d));
      cv.height = Math.max(1, Math.round(cv.clientHeight * d));
      gl.viewport(0, 0, cv.width, cv.height);
    }
    size();

    function down(e) { drag = { x: e.clientX, y: e.clientY }; auto = 0; try { cv.setPointerCapture(e.pointerId); } catch (err) {} }
    function move(e) {
      if (!drag) return;
      yaw -= (e.clientX - drag.x) * 0.012;
      pitch = Math.max(-0.5, Math.min(0.5, pitch - (e.clientY - drag.y) * 0.006));
      drag.x = e.clientX; drag.y = e.clientY;
    }
    function up() { drag = null; }
    cv.addEventListener("pointerdown", down);
    cv.addEventListener("pointermove", move);
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", up);

    var slow = 0, tLast = 0;
    function frame(now) {
      if (!live || !cv.isConnected) { live = false; return; }
      if (document.visibilityState !== "visible") { requestAnimationFrame(frame); return; }

      var t = ((window.performance ? performance.now() : Date.now()) - t0) / 1000;
      if (auto) yaw += 0.0045;

      /* кадры идут тяжело — один раз снижаем разрешение */
      if (tLast && now - tLast > 34) slow++;
      tLast = now;
      if (slow > 25 && scale > 0.7) { scale = 0.7; slow = 0; size(); }

      if (cv.width !== Math.round(cv.clientWidth * px())) size();

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(g.u.res, cv.width, cv.height);
      gl.uniform1f(g.u.time, t);
      gl.uniform1f(g.u.yaw, yaw);
      gl.uniform1f(g.u.pitch, pitch);
      gl.uniform1fv(g.u.on, lit);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    return {
      stop: function () { live = false; },
      set: function (a, b) { setGroups(a, b); },
      reset: function () { yaw = 0.5; pitch = 0; auto = 1; }
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
