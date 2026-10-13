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

  /* Куда поворачивать и приближать камеру под каждую группу:
     цель, поворот вокруг вертикали, наклон и расстояние. */
  var FOCUS = {
    chest:      { t: [0, 1.17, 0.06],    yaw: 0.10, pitch: 0.05, d: 0.68 },
    abs:        { t: [0, 0.94, 0.06],    yaw: 0.10, pitch: 0.05, d: 0.66 },
    obliques:   { t: [0.11, 0.92, 0.02], yaw: 0.75, pitch: 0.05, d: 0.64 },
    traps:      { t: [0, 1.31, -0.04],   yaw: 3.05, pitch: -0.18, d: 0.66 },
    delts:      { t: [0.215, 1.28, 0.01], yaw: 0.55, pitch: 0.02, d: 0.56 },
    delts_rear: { t: [0.215, 1.28, -0.05], yaw: 2.60, pitch: 0.02, d: 0.56 },
    biceps:     { t: [0.235, 1.15, 0.04], yaw: 0.45, pitch: 0.02, d: 0.52 },
    triceps:    { t: [0.235, 1.15, -0.05], yaw: 2.70, pitch: 0.02, d: 0.52 },
    forearms:   { t: [0.26, 0.93, 0.01], yaw: 0.55, pitch: 0.05, d: 0.50 },
    lats:       { t: [0.13, 1.05, -0.06], yaw: 2.95, pitch: 0.02, d: 0.70 },
    lowback:    { t: [0, 0.89, -0.08],   yaw: 3.14, pitch: 0.05, d: 0.64 },
    glutes:     { t: [0.09, 0.73, -0.08], yaw: 2.95, pitch: 0.12, d: 0.62 },
    quads:      { t: [0.095, 0.57, 0.05], yaw: 0.20, pitch: 0.10, d: 0.74 },
    hams:       { t: [0.095, 0.57, -0.07], yaw: 2.95, pitch: 0.10, d: 0.74 },
    calves:     { t: [0.095, 0.27, -0.06], yaw: 2.90, pitch: 0.18, d: 0.56 }
  };
  var WIDE = { t: [0, 0.88, 0], yaw: 0.5, pitch: 0.0, d: 1.85 };

  var VS = [
    "attribute vec2 aPos;",
    "varying vec2 vUv;",
    "void main(){ vUv = aPos; gl_Position = vec4(aPos, 0.0, 1.0); }"
  ].join("\n");

  var FS = [
    "#extension GL_OES_standard_derivatives : enable",
    "precision highp float;",
    "varying vec2 vUv;",
    "uniform vec2 uRes;",
    "uniform float uTime, uYaw, uPitch, uDist, uPulse, uQ;",
    "uniform vec3 uTarget;",
    "uniform float uOn[16];",

    "float sdSph(vec3 p, float r){ return length(p) - r; }",
    "float sdEll(vec3 p, vec3 r){ float k0 = length(p/r); float k1 = length(p/(r*r)); return k0*(k0-1.0)/k1; }",
    "float sdCap(vec3 p, vec3 a, vec3 b, float r){",
    "  vec3 pa = p - a, ba = b - a;",
    "  float h = clamp(dot(pa,ba)/dot(ba,ba), 0.0, 1.0);",
    "  return length(pa - ba*h) - r;",
    "}",
    /* Конус со скруглёнными концами: кость или мышца, которая к одному
       концу толще, чем к другому. Прямая капсула даёт «трубу», этот —
       естественное сужение к суставу. */
    /* Скруглённый параллелепипед: кубики пресса — плиты с фасками,
       эллипсоид на их месте читается как ряд шариков. */
    "float sdRB(vec3 p, vec3 b, float r){",
    "  vec3 d = abs(p) - b;",
    "  return length(max(d, 0.0)) + min(max(d.x, max(d.y, d.z)), 0.0) - r;",
    "}",

    "float sdRC(vec3 p, vec3 a, vec3 b, float r1, float r2){",
    "  vec3 ba = b - a; float l2 = dot(ba, ba);",
    "  float rr = r1 - r2; float a2 = l2 - rr * rr; float il2 = 1.0 / l2;",
    "  vec3 pa = p - a; float y = dot(pa, ba); float z = y - l2;",
    "  vec3 xp = pa * l2 - ba * y; float x2 = dot(xp, xp);",
    "  float y2 = y * y * l2; float z2 = z * z * l2;",
    "  float k = sign(rr) * rr * rr * x2;",
    "  if (sign(z) * a2 * z2 > k) return sqrt(x2 + z2) * il2 - r2;",
    "  if (sign(y) * a2 * y2 < k) return sqrt(x2 + y2) * il2 - r1;",
    "  return (sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;",
    "}",

    /* Поворот перед замером: мышцы лежат наискось, а не по осям. */
    "vec3 rot2(vec3 p, float az, float ax){",
    "  float c = cos(az), s = sin(az);",
    "  p.xy = mat2(c, -s, s, c) * p.xy;",
    "  c = cos(ax); s = sin(ax);",
    "  p.yz = mat2(c, -s, s, c) * p.yz;",
    "  return p;",
    "}",

    /* Мягкое вычитание: прорезает в теле борозду. Тенью такие линии не
       получить, а без них грудь и живот выглядят единой плитой. */
    "float carve(float d, float g, float k){",
    "  float h = clamp(0.5 - 0.5 * (d + g) / k, 0.0, 1.0);",
    "  return mix(d, -g, h) + k * h * (1.0 - h);",
    "}",

    "vec2 smin2(vec2 a, vec2 b, float k){",
    "  float h = clamp(0.5 + 0.5*(b.x-a.x)/k, 0.0, 1.0);",
    "  float d = mix(b.x, a.x, h) - k*h*(1.0-h);",
    "  return vec2(d, h > 0.5 ? a.y : b.y);",
    "}",

    /* Тело разбито на зоны. Для точки луча сначала считается расстояние до
       шара, накрывающего зону: если он далеко, вся зона пропускается одним
       сравнением вместо десятка форм. Шар — заведомо нижняя оценка, поэтому
       луч не проскочит сквозь тело. Это главный источник скорости: раньше
       каждый шаг луча считал все пятьдесят форм. */
    "vec2 map(vec3 p){",
    "  vec3 q = vec3(abs(p.x), p.y, p.z);",

    /* грубая оболочка всей фигуры: пока луч далеко, шагаем по ней */
    "  float shell = sdCap(p, vec3(0.0,0.06,0.0), vec3(0.0,1.66,0.02), 0.40);",
    "  if (shell > 0.04) return vec2(shell, 0.0);",

    "  vec2 r = vec2(8.0, 0.0);",
    "  float z;",

    /* голова и шея */
    "  z = sdSph(p - vec3(0.0,1.520,0.030), 0.210);",
    "  if (z < 0.09) {",
    "    r = smin2(r, vec2(sdEll(p - vec3(0.0,1.608,0.020), vec3(0.082,0.098,0.098)), 0.0), 0.02);",
    "    r = smin2(r, vec2(sdEll(p - vec3(0.0,1.546,0.042), vec3(0.062,0.058,0.082)), 0.0), 0.045);",
    "    r = smin2(r, vec2(sdEll(q - vec3(0.052,1.580,0.070), vec3(0.028,0.020,0.030)), 0.0), 0.030);",
    "    r = smin2(r, vec2(sdEll(p - vec3(0.0,1.566,0.104), vec3(0.015,0.026,0.020)), 0.0), 0.022);",
    "    r = smin2(r, vec2(sdEll(q - vec3(0.084,1.594,0.004), vec3(0.010,0.024,0.018)), 0.0), 0.016);",
    "    r = smin2(r, vec2(sdRC(p, vec3(0.0,1.385,-0.005), vec3(0.0,1.515,0.0), 0.050, 0.036), 0.0), 0.05);",
    "    if (p.y > 1.46) {",
    "      r.x = carve(r.x, sdEll(q - vec3(0.034,1.600,0.092), vec3(0.022,0.013,0.016)), 0.018);",
    "      r.x = carve(r.x, sdCap(p, vec3(-0.020,1.524,0.090), vec3(0.020,1.524,0.090), 0.004), 0.012);",
    "    }",
    "  } else r.x = min(r.x, z);",

    /* верх корпуса: рёбра, грудь, ключица, трапеции, широчайшие */
    "  z = sdSph(p - vec3(0.0,1.150,0.000), 0.340);",
    "  if (z < 0.09) {",
    "    r = smin2(r, vec2(sdEll(p - vec3(0.0,1.164,0.010), vec3(0.152,0.180,0.104)), 0.0), 0.08);",
    "    r = smin2(r, vec2(sdRC(q, vec3(0.020,1.310,0.050), vec3(0.180,1.294,0.026), 0.012, 0.016), 0.0), 0.024);",
    "    r = smin2(r, vec2(sdEll(rot2(q - vec3(0.070,1.196,0.084), -0.14, 0.0), vec3(0.098,0.072,0.032)), 1.0), 0.038);",
    "    r = smin2(r, vec2(sdEll(rot2(q - vec3(0.092,1.344,-0.014), 0.22, 0.0), vec3(0.092,0.032,0.052)), 4.0), 0.026);",
    "    r = smin2(r, vec2(sdEll(q - vec3(0.058,1.240,-0.066), vec3(0.064,0.066,0.034)), 4.0), 0.026);",
    "    r = smin2(r, vec2(sdEll(rot2(q - vec3(0.128,1.104,-0.058), 0.34, 0.0), vec3(0.048,0.082,0.046)), 10.0), 0.022);",
    "    r = smin2(r, vec2(sdEll(rot2(q - vec3(0.106,0.994,-0.062), 0.46, 0.0), vec3(0.042,0.080,0.044)), 10.0), 0.022);",
    "    if (p.z > 0.02) {",
    "      r.x = carve(r.x, sdCap(p, vec3(0.0,1.258,0.090), vec3(0.0,1.134,0.088), 0.008), 0.032);",
    "      r.x = carve(r.x, sdEll(p - vec3(0.0,1.120,0.094), vec3(0.096,0.004,0.022)), 0.050);",
    "    }",
    "  } else r.x = min(r.x, z);",

    /* низ корпуса: талия, таз, пресс, косые, поясница, ягодицы */
    "  z = sdSph(p - vec3(0.0,0.840,-0.010), 0.290);",
    "  if (z < 0.09) {",
    "    r = smin2(r, vec2(sdEll(p - vec3(0.0,0.900,0.004), vec3(0.112,0.140,0.082)), 0.0), 0.09);",
    "    r = smin2(r, vec2(sdEll(p - vec3(0.0,0.740,-0.008), vec3(0.136,0.112,0.100)), 0.0), 0.08);",
    "    r = smin2(r, vec2(sdRB(vec3(q.x-0.030,q.y-1.014,q.z-0.086), vec3(0.021,0.018,0.012), 0.013), 2.0), 0.016);",
    "    r = smin2(r, vec2(sdRB(vec3(q.x-0.030,q.y-0.950,q.z-0.088), vec3(0.022,0.018,0.013), 0.013), 2.0), 0.016);",
    "    r = smin2(r, vec2(sdRB(vec3(q.x-0.029,q.y-0.888,q.z-0.088), vec3(0.021,0.017,0.013), 0.013), 2.0), 0.016);",
    "    r = smin2(r, vec2(sdRB(vec3(q.x-0.027,q.y-0.832,q.z-0.082), vec3(0.019,0.015,0.011), 0.012), 2.0), 0.016);",
    "    r = smin2(r, vec2(sdRB(p - vec3(0.0,0.788,0.074), vec3(0.030,0.016,0.012), 0.015), 2.0), 0.022);",
    "    r = smin2(r, vec2(sdEll(rot2(q - vec3(0.104,0.956,0.026), 0.30, 0.0), vec3(0.032,0.070,0.050)), 3.0), 0.024);",
    "    r = smin2(r, vec2(sdEll(rot2(q - vec3(0.100,0.862,0.018), 0.38, 0.0), vec3(0.030,0.060,0.048)), 3.0), 0.024);",
    "    r = smin2(r, vec2(sdEll(q - vec3(0.034,0.900,-0.076), vec3(0.026,0.090,0.030)), 11.0), 0.018);",
    "    r = smin2(r, vec2(sdEll(q - vec3(0.088,0.736,-0.082), vec3(0.072,0.068,0.052)), 12.0), 0.024);",
    "    if (p.z > 0.0) r.x = carve(r.x, sdCap(p, vec3(0.0,1.040,0.088), vec3(0.0,0.800,0.078), 0.010), 0.022);",
    "  } else r.x = min(r.x, z);",

    /* плечо: кость, дельта, бицепс, трицепс */
    "  z = sdSph(q - vec3(0.230,1.170,0.000), 0.230);",
    "  if (z < 0.09) {",
    "    r = smin2(r, vec2(sdRC(q, vec3(0.215,1.272,0.0), vec3(0.245,1.020,0.010), 0.046, 0.030), 7.0), 0.06);",
    "    r = smin2(r, vec2(sdRC(q, vec3(0.186,1.306,0.042), vec3(0.230,1.166,0.030), 0.044, 0.020), 5.0), 0.050);",
    "    r = smin2(r, vec2(sdRC(q, vec3(0.212,1.312,0.000), vec3(0.244,1.158,0.004), 0.050, 0.022), 5.0), 0.050);",
    "    r = smin2(r, vec2(sdRC(q, vec3(0.188,1.302,-0.044), vec3(0.232,1.168,-0.032), 0.044, 0.020), 6.0), 0.050);",
    "    r = smin2(r, vec2(sdRC(q, vec3(0.224,1.252,0.034), vec3(0.234,1.148,0.044), 0.016, 0.034), 7.0), 0.020);",
    "    r = smin2(r, vec2(sdRC(q, vec3(0.234,1.148,0.044), vec3(0.246,1.036,0.030), 0.034, 0.013), 7.0), 0.020);",
    "    r = smin2(r, vec2(sdRC(q, vec3(0.212,1.240,0.038), vec3(0.228,1.120,0.042), 0.014, 0.028), 7.0), 0.020);",
    "    r = smin2(r, vec2(sdRC(q, vec3(0.206,1.262,-0.036), vec3(0.226,1.140,-0.046), 0.016, 0.034), 8.0), 0.020);",
    "    r = smin2(r, vec2(sdRC(q, vec3(0.226,1.140,-0.046), vec3(0.248,1.030,-0.030), 0.034, 0.014), 8.0), 0.020);",
    "    r = smin2(r, vec2(sdRC(q, vec3(0.232,1.240,-0.028), vec3(0.242,1.108,-0.038), 0.014, 0.028), 8.0), 0.020);",
    "    r.x = carve(r.x, sdCap(q, vec3(0.150,1.300,0.052), vec3(0.196,1.196,0.044), 0.013), 0.026);",
    "    r.x = carve(r.x, sdCap(q, vec3(0.232,1.244,-0.028), vec3(0.254,1.100,-0.026), 0.010), 0.022);",
    "  } else r.x = min(r.x, z);",

    /* предплечье и кисть */
    "  z = sdSph(q - vec3(0.272,0.840,0.010), 0.230);",
    "  if (z < 0.09) {",
    "    r = smin2(r, vec2(sdRC(q, vec3(0.245,1.020,0.010), vec3(0.272,0.800,0.020), 0.038, 0.021), 9.0), 0.05);",
    "    r = smin2(r, vec2(sdRC(q, vec3(0.248,1.006,0.026), vec3(0.268,0.826,0.018), 0.032, 0.012), 9.0), 0.020);",
    "    r = smin2(r, vec2(sdRC(q, vec3(0.254,1.000,-0.026), vec3(0.272,0.830,-0.014), 0.030, 0.011), 9.0), 0.020);",
    "    r = smin2(r, vec2(sdRC(q, vec3(0.242,1.040,0.010), vec3(0.262,0.900,0.016), 0.024, 0.014), 9.0), 0.020);",
    "    r = smin2(r, vec2(sdEll(q - vec3(0.280,0.736,0.020), vec3(0.030,0.038,0.019)), 0.0), 0.030);",
    "    r = smin2(r, vec2(sdRC(q, vec3(0.284,0.712,0.021), vec3(0.292,0.652,0.024), 0.021, 0.013), 0.0), 0.022);",
    "    r = smin2(r, vec2(sdRC(q, vec3(0.258,0.722,0.030), vec3(0.248,0.684,0.040), 0.012, 0.008), 0.0), 0.018);",
    "  } else r.x = min(r.x, z);",

    /* бедро: кость, квадрицепс, задняя поверхность */
    "  z = sdSph(q - vec3(0.090,0.530,0.000), 0.250);",
    "  if (z < 0.09) {",
    "    r = smin2(r, vec2(sdRC(q, vec3(0.078,0.720,-0.004), vec3(0.092,0.400,0.004), 0.062, 0.040), 13.0), 0.08);",
    "    r = smin2(r, vec2(sdEll(q - vec3(0.080,0.600,0.048), vec3(0.032,0.115,0.032)), 13.0), 0.026);",
    "    r = smin2(r, vec2(sdEll(q - vec3(0.120,0.590,0.018), vec3(0.032,0.105,0.038)), 13.0), 0.026);",
    "    r = smin2(r, vec2(sdEll(q - vec3(0.056,0.472,0.038), vec3(0.028,0.058,0.034)), 13.0), 0.026);",
    "    r = smin2(r, vec2(sdEll(q - vec3(0.040,0.610,0.000), vec3(0.026,0.100,0.038)), 13.0), 0.026);",
    "    r = smin2(r, vec2(sdEll(q - vec3(0.112,0.600,-0.058), vec3(0.030,0.110,0.034)), 14.0), 0.026);",
    "    r = smin2(r, vec2(sdEll(q - vec3(0.058,0.586,-0.060), vec3(0.028,0.100,0.032)), 14.0), 0.026);",
    "    r.x = carve(r.x, sdCap(q, vec3(0.104,0.620,0.040), vec3(0.108,0.470,0.040), 0.011), 0.024);",
    "  } else r.x = min(r.x, z);",

    /* голень и стопа */
    "  z = sdSph(q - vec3(0.092,0.220,0.020), 0.280);",
    "  if (z < 0.09) {",
    "    r = smin2(r, vec2(sdRC(q, vec3(0.092,0.400,0.004), vec3(0.092,0.070,0.014), 0.042, 0.024), 15.0), 0.05);",
    "    r = smin2(r, vec2(sdEll(q - vec3(0.092,0.032,0.048), vec3(0.046,0.028,0.098)), 0.0), 0.04);",
    "    r = smin2(r, vec2(sdEll(q - vec3(0.092,0.072,-0.004), vec3(0.034,0.034,0.038)), 0.0), 0.035);",
    "    r = smin2(r, vec2(sdEll(q - vec3(0.114,0.326,-0.044), vec3(0.028,0.072,0.032)), 15.0), 0.022);",
    "    r = smin2(r, vec2(sdEll(q - vec3(0.074,0.330,-0.044), vec3(0.028,0.075,0.032)), 15.0), 0.022);",
    "    r = smin2(r, vec2(sdEll(q - vec3(0.094,0.220,-0.028), vec3(0.028,0.058,0.028)), 15.0), 0.020);",
    "    r = smin2(r, vec2(sdEll(q - vec3(0.072,0.300,0.030), vec3(0.018,0.080,0.022)), 15.0), 0.020);",
    "  } else r.x = min(r.x, z);",

    /* позвоночник — борозда через весь корпус */
    "  if (p.z < -0.02 && p.y > 0.78 && p.y < 1.36) {",
    "    r.x = carve(r.x, sdCap(p, vec3(0.0,1.320,-0.096), vec3(0.0,0.820,-0.074), 0.017), 0.034);",
    "  }",

    "  return r;",
    "}",

    "vec3 norm(vec3 p){",
    "  vec2 e = vec2(0.0018, 0.0);",
    "  return normalize(vec3(map(p+e.xyy).x - map(p-e.xyy).x,",
    "                        map(p+e.yxy).x - map(p-e.yxy).x,",
    "                        map(p+e.yyx).x - map(p-e.yyx).x));",
    "}",

    /* Направление волокон мышцы. Волокна тянутся от прикрепления к
       прикреплению, поэтому у конечностей они вдоль кости, у груди и
       пресса — поперёк. По этому направлению рисуется рельеф. */
    "vec3 fiberDir(float id){",
    "  if (id < 1.5) return normalize(vec3(0.92, 0.20, 0.0));",   /* грудь — веером к плечу */
    "  if (id < 2.5) return vec3(0.0, 1.0, 0.0);",                /* пресс — вдоль */
    "  if (id < 3.5) return normalize(vec3(0.45, 0.88, 0.0));",   /* косые — наискось */
    "  if (id < 4.5) return normalize(vec3(0.80, 0.55, 0.0));",   /* трапеция */
    "  if (id < 6.5) return normalize(vec3(0.30, 0.94, 0.0));",   /* дельты */
    "  if (id < 9.5) return vec3(0.0, 1.0, 0.0);",                /* руки — вдоль */
    "  if (id < 10.5) return normalize(vec3(0.75, 0.62, 0.0));",  /* широчайшие — веером */
    "  if (id < 12.5) return vec3(0.0, 1.0, 0.0);",
    "  return normalize(vec3(0.12, 0.98, 0.0));",                 /* ноги — почти вдоль */
    "}",

    /* Затенение в углублениях. Без него соседние пучки сливаются в один
       гладкий объём: борозду между ними видно только по тени. */
    "float occ(vec3 p, vec3 n){",
    "  float sum = 0.0, sca = 1.0;",
    "  for (int i = 0; i < 3; i++) {",
    "    float h = 0.014 + 0.070 * float(i);",
    "    sum += (h - map(p + n * h).x) * sca;",
    "    sca *= 0.62;",
    "  }",
    "  return clamp(1.0 - 1.45 * sum, 0.18, 1.0);",
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
    "  vec3 ro = vec3(0.0, 0.0, uDist);",
    "  vec3 rd = normalize(vec3(uv * 0.72, -1.0));",
    "  ro.yz = mat2(cp, -sp, sp, cp) * ro.yz;",
    "  rd.yz = mat2(cp, -sp, sp, cp) * rd.yz;",
    "  ro.xz = mat2(cy, -sy, sy, cy) * ro.xz;",
    "  rd.xz = mat2(cy, -sy, sy, cy) * rd.xz;",
    "  ro += uTarget;",

    "  float t = 0.0, id = 0.0, near = 1.0;",
    "  bool hit = false;",
    "  float steps = 56.0 - uQ * 7.0;",
    "  for (int i = 0; i < 56; i++) {",
    "    if (float(i) > steps) break;",
    "    vec3 pp = ro + rd * t;",
    "    vec2 d = map(pp);",
    "    near = min(near, d.x / max(t, 0.3));",           /* насколько близко луч прошёл мимо */
    "    if (d.x < 0.0013 + t * 0.0022) { id = d.y; hit = true; break; }",
    "    t += d.x * 0.98;",
    "    if (t > 6.0) break;",
    "  }",

    /* ── мимо тела: сетка пола и ореол вокруг силуэта ── */
    "  if (!hit) {",
    "    vec4 bg = vec4(0.0);",
    "    if (rd.y < -0.001) {",
    "      float tp = -ro.y / rd.y;",
    "      if (tp > 0.0 && tp < 14.0) {",
    "        vec3 pf = ro + rd * tp;",
    "        vec2 gp = pf.xz * 3.2;",
    "        vec2 gf = abs(fract(gp) - 0.5);",
    "        float w = fwidth(gp.x) * 1.6 + 0.01;",
    "        float ln = 1.0 - smoothstep(0.0, w, min(gf.x, gf.y));",
    "        float fade = exp(-length(pf.xz) * 0.85);",
    "        float pool = exp(-dot(pf.xz, pf.xz) * 4.0) * 0.42;",   /* пятно света под фигурой */
    "        float pulseRing = exp(-pow((length(pf.xz) - mod(uTime * 0.5, 2.2)) * 5.0, 2.0)) * 0.22;",
    "        float a0 = (ln * 0.55 + pool + pulseRing) * fade;",
    "        bg = vec4(vec3(0.22, 0.55, 1.0) * (0.7 + ln * 0.8), a0);",
    "      }",
    "    }",
    "    float halo = exp(-near * 90.0);",                 /* мягкий край: он же сглаживание */
    "    bg.rgb = mix(bg.rgb, vec3(0.40, 0.72, 1.0), halo);",
    "    bg.a = clamp(bg.a + halo * 0.55, 0.0, 1.0);",
    "    gl_FragColor = bg;",
    "    return;",
    "  }",

    "  vec3 p = ro + rd * t;",
    "  vec3 n = norm(p);",
    "  vec3 v = normalize(ro - p);",
    "  float on = onOf(id);",
    "  float work = on * (0.55 + 0.45 * uPulse);",   /* такт движения: усилие ярче возврата */

    /* ── рельеф: волокна поперёк направления мышцы ── */
    "  vec3 fd = fiberDir(id);",
    "  vec3 tg = normalize(fd - n * dot(n, fd) + vec3(0.0001));",
    "  vec3 bt = cross(n, tg);",
    "  float fib = sin(dot(p, bt) * 165.0);",
    "  float fib2 = sin(dot(p, bt) * 61.0 + dot(p, tg) * 7.0);",
    "  vec3 nb = normalize(n + bt * (fib * 0.030 + fib2 * 0.055) + tg * fib2 * 0.015);",

    /* ── свет: основной, заполняющий и контурный ── */
    "  float ao = uQ > 2.5 ? 0.86 : occ(p, n);",
    "  float cav = pow(ao, 1.7);",                      /* борозды между пучками */
    "  float fres = pow(1.0 - max(dot(nb, v), 0.0), 2.6);",
    /* свет считаем в осях камеры: иначе при повороте фигура уходит в тень */
    "  vec3 cr = normalize(cross(vec3(0.0, 1.0, 0.0), v));",
    "  vec3 cu = cross(v, cr);",
    "  vec3 lkey = normalize(v + cr * 0.62 + cu * 0.78);",
    "  vec3 lfil = normalize(v - cr * 0.90 - cu * 0.22);",
    "  float lam = max(dot(nb, lkey), 0.0);",
    "  float fill = max(dot(nb, lfil), 0.0) * 0.38;",
    "  float rim = pow(1.0 - max(dot(n, v), 0.0), 3.5) * 1.2;",
    "  vec3 hv = normalize(lkey + v);",
    "  float spec = pow(max(dot(nb, hv), 0.0), 34.0) * 0.55;",

    /* ── просвет сквозь объём: тонкие места светятся сильнее ── */
    "  float sss = pow(1.0 - abs(dot(n, v)), 1.4) * (0.35 + 0.65 * ao);",

    /* ── служебная разметка поверх ── */
    "  float scan = 0.5 + 0.5 * sin(p.y * 64.0 - uTime * 2.6);",
    "  float sweepY = mod(uTime * 0.42, 2.6) - 0.3;",
    "  float sweep = exp(-pow((p.y - sweepY) * 13.0, 2.0));",
    "  float grid = smoothstep(0.78, 1.0, scan) * 0.10;",

    /* ── граница между мышцами: светящийся контур, как обводка в атласе ── */
    "  vec3 e1 = normalize(cross(n, vec3(0.0, 1.0, 0.07)));",
    "  vec3 e2 = cross(n, e1);",
    "  float ed = 0.0;",
    "  if (uQ < 1.5) {",
    "    ed += step(0.5, abs(map(p + e1 * 0.0062).y - id));",
    "    ed += step(0.5, abs(map(p + e2 * 0.0062).y - id));",
    "  }",
    "  float edge = clamp(ed * 0.52, 0.0, 1.0);",

    /* у каждой группы свой оттенок — иначе мышцы не отличить друг от друга */
    "  float tint = fract(id * 0.173);",
    "  vec3 cold = vec3(0.13 + tint * 0.14, 0.44 + tint * 0.22, 0.86 + tint * 0.14);",
    "  vec3 deep = vec3(0.04, 0.11, 0.28);",            /* цвет в глубине борозды */
    "  vec3 hot = vec3(1.0, 0.45, 0.14);",
    "  vec3 base = mix(cold, hot, work);",
    "  vec3 col = mix(deep, base, 0.45 + 0.55 * cav);",
    "  col = mix(col, vec3(0.70, 0.90, 1.0), edge * 0.34 * (1.0 - work));",
    "  col = mix(col, vec3(1.0, 0.85, 0.55), edge * 0.34 * work);",
    "  float lit = 0.40 + lam * 0.78 + fill + fres * 1.15 + rim * 0.42",
    "            + spec + sss * 0.45 + grid * 1.5 + work * 0.30 + sweep * 0.85;",
    "  lit *= (0.52 + 0.48 * ao) * (1.0 + work * 0.45);",                       /* тень в углублениях */
    "  lit += fib * 0.022 * (0.4 + work);",             /* блики по волокнам */
    "  lit += edge * 0.20;",
    "  float a = 0.52 + fres * 0.42 + lam * 0.20 + work * 0.26 + sweep * 0.22 + edge * 0.07 - (1.0 - cav) * 0.10;",
    /* мягкое ограничение яркости: без него светлые места выбеливаются */
    "  vec3 outc = col * lit;",
    "  outc = outc / (1.0 + outc * 0.40);",
    "  outc = mix(outc, base * 0.95, work * 0.42);",
    "  gl_FragColor = vec4(outc * 1.52, clamp(a, 0.0, 0.98));",
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

    /* fwidth нужен для ровных линий пола; где расширения нет — берём
       постоянную толщину, иначе шейдер просто не соберётся */
    var src = FS;
    if (!gl.getExtension("OES_standard_derivatives")) {
      src = src.replace("#extension GL_OES_standard_derivatives : enable", "")
               .replace("fwidth(gp.x) * 1.6", "0.030");
    }
    var vs = compile(gl, gl.VERTEX_SHADER, VS), fs = compile(gl, gl.FRAGMENT_SHADER, src);
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
      dist: gl.getUniformLocation(p, "uDist"), pulse: gl.getUniformLocation(p, "uPulse"),
      target: gl.getUniformLocation(p, "uTarget"),
      on: gl.getUniformLocation(p, "uOn[0]"), qual: gl.getUniformLocation(p, "uQ")
    } };
  }

  function mount(cv, on, on2) {
    var g = create(cv);
    if (!g) return null;
    var gl = g.gl, yaw = WIDE.yaw, pitch = WIDE.pitch, drag = null, live = true, auto = 1;
    var tgt = WIDE.t.slice(), dist = WIDE.d;            /* куда смотрим и с какого расстояния */
    var to = null;                                      /* цель наезда, пока камера едет */
    var pulse = 0, beat = 0;                            /* такт движения: усилие и возврат */
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
    function px() { return Math.min(window.devicePixelRatio || 1, 1.25) * scale; }
    function size() {
      var d = px();
      cv.width = Math.max(1, Math.round(cv.clientWidth * d));
      cv.height = Math.max(1, Math.round(cv.clientHeight * d));
      gl.viewport(0, 0, cv.width, cv.height);
    }
    size();

    var pts = {}, pinch = 0;                            /* пальцы на экране и расстояние между ними */

    function zoom(k) {
      to = null;                                        /* ручное приближение отменяет доводку камеры */
      auto = 0;
      dist = Math.max(0.32, Math.min(2.60, dist * k));
    }
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
      if (sp && pinch) {                                /* два пальца — щипок, приближаем */
        zoom(pinch / sp);
        pinch = sp;
        return;
      }
      if (!drag) return;
      yaw -= (e.clientX - drag.x) * 0.012;
      pitch = Math.max(-0.5, Math.min(0.5, pitch - (e.clientY - drag.y) * 0.006));
      drag.x = e.clientX; drag.y = e.clientY;
    }
    function up(e) {
      if (e && e.pointerId !== undefined) delete pts[e.pointerId];
      pinch = spread();
      drag = null;
    }
    function wheel(e) {
      e.preventDefault();
      zoom(1 + (e.deltaY > 0 ? 1 : -1) * 0.09);
    }
    var tapT = 0;
    function tap() {                                    /* двойное нажатие — вернуться к обзору */
      var n = Date.now();
      if (n - tapT < 320) { to = { t: WIDE.t.slice(), d: WIDE.d, yaw: null, pitch: WIDE.pitch }; }
      tapT = n;
    }
    cv.addEventListener("pointerdown", down);
    cv.addEventListener("pointermove", move);
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", up);
    cv.addEventListener("wheel", wheel, { passive: false });
    cv.addEventListener("pointerup", tap);

    /* Ступени качества. Телефоны очень разные, поэтому вместо догадок
       движок смотрит на время кадра и сам опускается на ступень ниже:
       сперва мельче буфер, потом без контуров, потом без затенения и на
       тридцати кадрах. Поднимается обратно, когда стабильно быстро. */
    var QUAL = [
      { s: 1.00, hz: 1 },
      { s: 0.82, hz: 1 },
      { s: 0.68, hz: 2 },
      { s: 0.54, hz: 2 }
    ];
    var qi = (window.innerWidth < 760 ? 1 : 0);          /* на телефоне начинаем осторожнее */
    scale = QUAL[qi].s;
    var tLast = 0, acc = 0, accN = 0, hold = 0, tick = 0;

    function grade(ms) {                                 /* ms — среднее время одного кадра */
      if (hold > 0) { hold--; return; }                  /* пауза считается в проверках, не в кадрах */
      var step = ms > 48 ? 2 : 1;                        /* совсем медленно — прыгаем через ступень */
      if (ms > 23 && qi < 3) { qi = Math.min(3, qi + step); scale = QUAL[qi].s; size(); hold = 2; }
      else if (ms < 12 && qi > 0) { qi--; scale = QUAL[qi].s; size(); hold = 8; }
    }

    function frame(now) {
      if (!live || !cv.isConnected) { live = false; return; }
      if (document.visibilityState !== "visible") { requestAnimationFrame(frame); return; }
      tick++;
      if (QUAL[qi].hz > 1 && (tick % QUAL[qi].hz)) { requestAnimationFrame(frame); return; }

      var t = ((window.performance ? performance.now() : Date.now()) - t0) / 1000;
      if (auto) yaw += 0.0045;

      /* плавный переезд к выбранной зоне */
      if (to) {
        var k = 0.08, done = 1;
        for (var ax = 0; ax < 3; ax++) {
          tgt[ax] += (to.t[ax] - tgt[ax]) * k;
          if (Math.abs(to.t[ax] - tgt[ax]) > 0.002) done = 0;
        }
        dist += (to.d - dist) * k;
        pitch += (to.pitch - pitch) * k;
        if (Math.abs(to.d - dist) > 0.004 || Math.abs(to.pitch - pitch) > 0.004) done = 0;
        if (to.yaw !== null) {
          var dy = ((to.yaw - yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
          yaw += dy * k;
          if (Math.abs(dy) > 0.01) done = 0;
        }
        if (done) to = null;
      }

      /* такт: 0.6 с усилие, 0.9 с возврат — мышца разгорается в нужной фазе */
      beat = (t % 1.5) / 1.5;
      pulse = beat < 0.4 ? Math.sin(beat / 0.4 * Math.PI * 0.5)
                         : Math.cos((beat - 0.4) / 0.6 * Math.PI * 0.5);

      if (tLast) {                                       /* среднее за полсекунды */
        acc += (now - tLast) / QUAL[qi].hz; accN++;
        if (accN >= (qi === 0 && hold === 0 ? 12 : 30)) { grade(acc / accN); acc = 0; accN = 0; }
      }
      tLast = now;

      if (cv.width !== Math.round(cv.clientWidth * px())) size();

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(g.u.res, cv.width, cv.height);
      gl.uniform1f(g.u.time, t);
      gl.uniform1f(g.u.yaw, yaw);
      gl.uniform1f(g.u.pitch, pitch);
      gl.uniform1f(g.u.dist, dist);
      gl.uniform1f(g.u.pulse, pulse);
      gl.uniform3f(g.u.target, tgt[0], tgt[1], tgt[2]);
      gl.uniform1f(g.u.qual, qi);
      gl.uniform1fv(g.u.on, lit);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    /* Та же математика, что в шейдере, но в обратную сторону: по точке
       на фигуре даёт место на экране — чтобы рисовать поверх подписи и стрелки. */
    function project(p) {
      var cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
      var ro = [0, 0, dist];
      var y1 = cp * ro[1] - sp * ro[2], z1 = sp * ro[1] + cp * ro[2];
      ro[1] = y1; ro[2] = z1;
      var x2 = cy * ro[0] - sy * ro[2], z2 = sy * ro[0] + cy * ro[2];
      ro[0] = x2 + tgt[0]; ro[1] += tgt[1]; ro[2] = z2 + tgt[2];

      var v = [p[0] - ro[0], p[1] - ro[1], p[2] - ro[2]];
      var ix = cy * v[0] + sy * v[2], iz = -sy * v[0] + cy * v[2];     /* обратный поворот вокруг вертикали */
      v[0] = ix; v[2] = iz;
      var iy = cp * v[1] + sp * v[2]; iz = -sp * v[1] + cp * v[2];     /* обратный наклон */
      v[1] = iy; v[2] = iz;

      if (v[2] > -0.05) return null;                                   /* точка за камерой */
      var W = cv.clientWidth, H = cv.clientHeight, asp = W / Math.max(1, H);
      var ux = (v[0] / -v[2]) / 0.72 / asp, uy = (v[1] / -v[2]) / 0.72;
      return { x: (ux + 1) / 2 * W, y: (1 - uy) / 2 * H, z: -v[2] };
    }

    return {
      stop: function () { live = false; },
      set: function (a, b) { setGroups(a, b); },
      reset: function () { to = { t: WIDE.t.slice(), d: WIDE.d, yaw: WIDE.yaw, pitch: WIDE.pitch }; auto = 1; },
      focus: function (key) {
        var f = key && FOCUS[key];
        to = f ? { t: f.t.slice(), d: f.d, yaw: f.yaw, pitch: f.pitch }
               : { t: WIDE.t.slice(), d: WIDE.d, yaw: WIDE.yaw, pitch: WIDE.pitch };
        auto = 0;
      },
      /* поставить камеру вручную — нужно для проверки ракурсов */
      view: function (y, pt, d, t) {
        to = { t: (t || WIDE.t).slice(), d: d || WIDE.d, yaw: y, pitch: pt || 0 };
        auto = 0;
      },
      project: project,
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

  return { mount: mount, supported: supported };
})();
