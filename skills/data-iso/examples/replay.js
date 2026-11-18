/* 주행 다시 보기 그림 부품. 전역 이름: AurajiReplay.
   앞부분(등각 투영·입체 함수)은 anatomy의 kit/iso-kit.mjs를 개조한 것이다 (쓰는 함수만 옮겼다. 문자열 SVG 함수는 뺐다).
   https://github.com/wheresryan22/anatomy

   MIT License

   Copyright (c) 2026 Ryan

   Permission is hereby granted, free of charge, to any person obtaining a copy
   of this software and associated documentation files (the "Software"), to deal
   in the Software without restriction, including without limitation the rights
   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
   copies of the Software, and to permit persons to whom the Software is
   furnished to do so, subject to the following conditions:

   The above copyright notice and this permission notice shall be included in all
   copies or substantial portions of the Software.

   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
   SOFTWARE. */
(function () {
"use strict";

/* ---- anatomy에서 옮긴 부분 ---- */
const AZIMUTH = 45;
const ELEVATION = 30;
const SHADES = 4;
const RADIANS = Math.PI / 180;
const UNIT = Math.sqrt(1.6);
function cameraOf({ scale, azimuth = AZIMUTH, elevation = ELEVATION }) {
    const a = azimuth * RADIANS;
    const e = elevation * RADIANS;
    return { sinA: Math.sin(a), cosA: Math.cos(a), sinE: Math.sin(e), cosE: Math.cos(e), k: scale * UNIT };
}
function iso([x, y, z], projection) {
    const { origin } = projection;
    const { sinA, cosA, sinE, cosE, k } = cameraOf(projection);
    return [origin[0] + (x * sinA - y * cosA) * k, origin[1] + ((x * cosA + y * sinA) * sinE - z * cosE) * k];
}
function towardViewer(projection) {
    const { sinA, cosA } = cameraOf(projection);
    return [cosA, sinA];
}
function depthOf([x, y, z], projection) {
    const { sinA, cosA, sinE, cosE } = cameraOf(projection);
    return (x * cosA + y * sinA) * cosE + z * sinE;
}
// anatomy는 0.1 px로 맞춘다. 여기서는 0.01 px: 확대하면 0.1 px의 계단이 보인다
const num = (value) => String(Math.round(value * 100) / 100 || 0);
function pathOf(points, closed = false) {
    if (!points.length)
        return "";
    return points.map(([x, y], at) => `${at ? "L" : "M"}${num(x)} ${num(y)}`).join("") + (closed ? "Z" : "");
}
function roundedPlan({ x, y, w, d, r }, steps = 8) {
    const radius = Math.max(0, Math.min(r, w / 2, d / 2));
    const corners = [
        [x + w - radius, y + radius, -90],
        [x + w - radius, y + d - radius, 0],
        [x + radius, y + d - radius, 90],
        [x + radius, y + radius, 180],
    ];
    const out = [];
    for (const [cx, cy, start] of corners) {
        const count = radius > 0 ? steps : 0;
        for (let step = 0; step <= count; step++) {
            const angle = (start + (count ? (90 * step) / count : 45)) * RADIANS;
            out.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
        }
    }
    return out;
}
function signedArea(points) {
    let area = 0;
    for (let index = 0; index < points.length; index++) {
        const [ax, ay] = points[index];
        const [bx, by] = points[(index + 1) % points.length];
        area += ax * by - bx * ay;
    }
    return area / 2;
}
const oriented = (points) => (signedArea(points) < 0 ? [...points].reverse() : points);
function convexHull(points) {
    const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (sorted.length < 3)
        return sorted;
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [];
    for (const point of sorted) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0)
            lower.pop();
        lower.push(point);
    }
    const upper = [];
    for (let index = sorted.length - 1; index >= 0; index--) {
        const point = sorted[index];
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0)
            upper.pop();
        upper.push(point);
    }
    return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}
function runsOf(flags, want) {
    const count = flags.length;
    const runs = [];
    const start = flags.findIndex((flag, index) => flag !== flags[(index + count - 1) % count]);
    if (start < 0)
        return flags[0] === want ? [Array.from({ length: count + 1 }, (_, index) => index % count)] : [];
    let run = null;
    for (let step = 0; step < count; step++) {
        const index = (start + step) % count;
        if (flags[index] === want) {
            if (!run)
                run = [index];
            run.push((index + 1) % count);
        }
        else if (run) {
            runs.push(run);
            run = null;
        }
    }
    if (run)
        runs.push(run);
    return runs;
}
function extrude(ring, z, height, projection, options = {}) {
    const convex = options.convex ?? true;
    const count = ring.length;
    const counter = signedArea(ring) > 0;
    const [vx, vy] = towardViewer(projection);
    const { sinA, cosA } = cameraOf(projection);
    const normals = ring.map(([ax, ay], index) => {
        const [bx, by] = ring[(index + 1) % count];
        const dx = bx - ax;
        const dy = by - ay;
        const length = Math.hypot(dx, dy) || 1;
        return (counter ? [dy / length, -dx / length] : [-dy / length, dx / length]);
    });
    const facing = normals.map(([nx, ny]) => nx * vx + ny * vy > 1e-9);
    const top = ring.map(([x, y]) => iso([x, y, z + height], projection));
    const bottom = ring.map(([x, y]) => iso([x, y, z], projection));
    const outline = [];
    const crease = [];
    for (const run of runsOf(facing, false))
        outline.push(pathOf(run.map((index) => top[index])));
    for (const run of runsOf(facing, true)) {
        crease.push(pathOf(run.map((index) => top[index])));
        if (height > 0)
            outline.push(pathOf(run.map((index) => bottom[index])));
    }
    if (height > 0) {
        for (let index = 0; index < count; index++) {
            if (facing[(index + count - 1) % count] !== facing[index])
                outline.push(pathOf([top[index], bottom[index]]));
        }
    }
    let fill;
    if (convex) {
        fill = pathOf(convexHull([...top, ...bottom]), true);
    }
    else {
        const parts = [pathOf(oriented(top), true), pathOf(oriented(bottom), true)];
        for (let index = 0; index < count; index++) {
            if (!facing[index])
                continue;
            const next = (index + 1) % count;
            parts.push(pathOf(oriented([top[index], top[next], bottom[next], bottom[index]]), true));
        }
        fill = parts.join("");
    }
    const buckets = Array.from({ length: SHADES }, () => []);
    if (height > 0) {
        const [lx, ly] = [-sinA, cosA];
        for (let index = 0; index < count; index++) {
            if (!facing[index])
                continue;
            const [nx, ny] = normals[index];
            const lit = (nx * lx + ny * ly + 1) / 2;
            const shade = Math.min(SHADES - 1, Math.max(0, Math.floor(lit * SHADES)));
            const next = (index + 1) % count;
            buckets[shade].push(pathOf(oriented([top[index], top[next], bottom[next], bottom[index]]), true));
        }
    }
    let bevel;
    if (options.bevel && options.bevel > 0) {
        const by = options.bevel;
        const inset = ring.map(([x, y], index) => {
            const [ax, ay] = normals[(index + count - 1) % count];
            const [bx, by2] = normals[index];
            const mx = ax + bx;
            const my = ay + by2;
            const length = Math.hypot(mx, my) || 1;
            return [x - (mx / length) * by, y - (my / length) * by];
        });
        const insetTop = inset.map(([x, y]) => iso([x, y, z + height], projection));
        bevel = runsOf(facing, true)
            .map((run) => pathOf([top[run[0]], ...run.slice(1, -1).map((index) => insetTop[index]), top[run[run.length - 1]]]))
            .join("");
    }
    return {
        fill,
        outline: outline.join(""),
        crease: crease.join(""),
        top: pathOf(oriented(top), true),
        shades: buckets.map((paths) => paths.join("")),
        bevel,
    };
}
function circleRing(cx, cy, radius, steps = 40) {
    return Array.from({ length: steps }, (_, step) => {
        const angle = (step / steps) * Math.PI * 2;
        return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
    });
}
function cylinder(cx, cy, radius, z, height, projection, steps = 32, bevel = 0) {
    return extrude(circleRing(cx, cy, radius, steps), z, height, projection, { convex: true, bevel });
}
function sideArc(cx, cy, radius, z, projection, steps = 24) {
    const [vx, vy] = towardViewer(projection);
    const facing = Math.atan2(vy, vx);
    const points = [];
    for (let step = 0; step <= steps; step++) {
        const angle = facing - Math.PI / 2 + (step / steps) * Math.PI;
        points.push(iso([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle), z], projection));
    }
    return pathOf(points);
}

/* ---- 옆으로 누운 기둥 (이 저장소에서 새로 씀) ----
   (앞 f, 높이 z) 단면을 왼쪽 l0 ~ l1로 민다. 궤도처럼 앞뒤 끝이 둥근 부품을 그린다.
   map(f, l, z)는 anatomy 세계 좌표를 돌려준다. 단면은 볼록해야 한다. */
function prism(profile, l0, l1, map, projection) {
    const pts = signedArea(profile) < 0 ? [...profile].reverse() : profile;
    const { sinA, cosA, sinE, cosE } = cameraOf(projection);
    const view = [cosA * cosE, sinA * cosE, sinE];
    const o = map(0, 0, 0);
    const unit = (f, l, z) => { const v = map(f, l, z).map((a, i) => a - o[i]); const n = Math.hypot(...v) || 1; return v.map((a) => a / n); };
    const F = unit(1, 0, 0), side = unit(0, 1, 0);
    const near = side[0] * view[0] + side[1] * view[1] > 0 ? l1 : l0; // 보이는 옆면의 l
    const a = pts.map(([f, z]) => iso(map(f, l0, z), projection));
    const b = pts.map(([f, z]) => iso(map(f, l1, z), projection));
    const buckets = Array.from({ length: SHADES }, () => []);
    const shadeOf = (nx, ny) => Math.min(SHADES - 1, Math.max(0, Math.floor(((nx * -sinA + ny * cosA) / (Math.hypot(nx, ny) || 1) + 1) / 2 * SHADES)));
    const roofs = [];
    for (let i = 0; i < pts.length; i++) {
        const j = (i + 1) % pts.length;
        const nf = pts[j][1] - pts[i][1], nz = pts[i][0] - pts[j][0]; // 반시계 단면의 바깥 법선
        const n = [F[0] * nf, F[1] * nf, nz];
        if (n[0] * view[0] + n[1] * view[1] + n[2] * view[2] <= 1e-9) continue;
        const quad = pathOf(oriented([a[i], a[j], b[j], b[i]]), true);
        if (nz / Math.hypot(nf, nz) > 0.6) roofs.push(quad);
        else buckets[shadeOf(n[0], n[1])].push(quad);
    }
    const cap = near === l1 ? b : a;
    buckets[shadeOf(near === l1 ? side[0] : -side[0], near === l1 ? side[1] : -side[1])].push(pathOf(oriented(cap), true));
    const hull = pathOf(convexHull([...a, ...b]), true);
    return { fill: hull, outline: hull + pathOf(cap, true), crease: "", top: roofs.join(""), shades: buckets.map((s) => s.join("")), near };
}
// 앞뒤가 반원인 단면 (f0 ~ f1, z0 ~ z1)
function stadium(f0, f1, z0, z1, steps = 8) {
    const r = (z1 - z0) / 2, out = [];
    for (let k = 0; k <= steps; k++) { const t = -Math.PI / 2 + (k / steps) * Math.PI; out.push([f1 - r + r * Math.cos(t), z0 + r + r * Math.sin(t)]); }
    for (let k = 0; k <= steps; k++) { const t = Math.PI / 2 + (k / steps) * Math.PI; out.push([f0 + r + r * Math.cos(t), z0 + r + r * Math.sin(t)]); }
    return out;
}

/* ---- 좌표: 세계 (m, 오른손, y 위) → 화면 (px, y 아래) ---- */
const SIDE = 420, PAD = 16, EDGE = 6; // px. 그림판 폭, 위에서 본 지도의 여백, 등각 보기의 여백
// 등각 보기 = 지도를 뒤로 눕힌 것. 지도와 같은 방향(x 오른쪽, y 뒤)에서 10°만 돌린다. 45°로 돌리면 그림판의 네 귀가 빈다
const CAMERA = { azimuth: 80, elevation: 42 };
const ZOOMS = [1, 2, 3, 4]; // 확대 배율. 1 = 전체. 8배 고정은 방이 보이지 않아 너무 셌다 (결정 D16)
const WALL_H = 0.5, LEDGE_H = 0.05, COPING = 0.015, COPING_H = 0.04, LIP = 0.12, BASE_T = 0.08; // m. COPING = 갓돌을 벽 안으로 들인 폭. 받침판 = 방 둘레의 턱과 두께
const at3 = (x, y, z = 0) => [100 * x, -100 * y, 100 * z]; // anatomy는 cm, y 부호 반대
const cm = (ring) => ring.map(([x, y]) => [100 * x, -100 * y]);
const cornersOf = ({ center: [cx, cy], size: [w, d] }) => [[cx - w / 2, cy - d / 2], [cx + w / 2, cy - d / 2], [cx + w / 2, cy + d / 2], [cx - w / 2, cy + d / 2]];
const ringPath = (p, cx, cy, r, z) => pathOf(circleRing(cx, cy, r, 32).map(([x, y]) => p(x, y, z)), true);

function boundsOf(traj, scene) {
  if (scene && scene.bounds) return scene.bounds;
  const pts = traj.poses.map((q) => [q[0], q[1]]);
  if (traj.goal) pts.push(traj.goal);
  const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const h = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2 + 0.3;
  return [cx - h, cy - h, cx + h, cy + h];
}

// 반환: p(x, y, z=0) → [px, py], pr = 등각 투영 (위에서 본 지도는 null), size = 그림판 [폭, 높이], lip = 받침판 턱의 폭 (m)
function frameOf(view, [x0, y0, x1, y1]) {
  const bw = x1 - x0, bh = y1 - y0;
  if (view === "top") {
    const inner = SIDE - 2 * PAD, s = inner / Math.max(bw, bh);
    const ox = PAD + (inner - bw * s) / 2, oy = PAD + (inner - bh * s) / 2;
    return { pr: null, size: [SIDE, SIDE], lip: (PAD - 4) / s, p: (x, y) => [ox + (x - x0) * s, oy + (y1 - y) * s] };
  }
  // 받침판이 그림판 폭을 채운다. 그림판 높이는 방의 투영을 따른다 (SIDE 이하)
  const raw = { ...CAMERA, scale: 1, origin: [0, 0] }, m = LIP;
  const pts = [[x0 - m, y0 - m], [x1 + m, y0 - m], [x1 + m, y1 + m], [x0 - m, y1 + m]].flatMap(([x, y]) => [-BASE_T, WALL_H].map((z) => iso(at3(x, y, z), raw)));
  const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
  const s = (SIDE - 2 * EDGE) / Math.max(w, h);
  const pr = { ...CAMERA, scale: s, origin: [(SIDE - w * s) / 2 - Math.min(...xs) * s, EDGE - Math.min(...ys) * s] };
  return { pr, size: [SIDE, Math.ceil(h * s) + 2 * EDGE], lip: LIP, p: (x, y, z = 0) => iso(at3(x, y, z), pr) };
}

const toScreen = (view, [x, y], bounds) => frameOf(view, bounds).p(x, y);

function heading(view, yaw, bounds) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  if (view === "top") return [c, -s];
  const { p } = frameOf(view, bounds || [-1, -1, 1, 1]);
  const [ax, ay] = p(0, 0), [bx, by] = p(c, s);
  const len = Math.hypot(bx - ax, by - ay) || 1;
  return [(bx - ax) / len, (by - ay) / len];
}

/* ---- DOM (innerHTML·style 속성을 쓰지 않는다) ---- */
const SVGNS = "http://www.w3.org/2000/svg";
function el(tag, cls, parent, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}
let pool = null; // redraw 동안만 있다: 부모 → 다음에 다시 쓸 자식의 번호
// pool에 든 부모에는 새로 만들지 않고 그 자리의 자식을 다시 쓴다 (속성만 바꾼다)
function sv(tag, attrs, parent) {
  const at = pool && pool.get(parent), old = at != null && parent.children[at];
  const e = old && old.tagName === tag ? old : document.createElementNS(SVGNS, tag);
  if (e === old) for (const { name } of [...e.attributes]) if (!(name in attrs) && name !== "vector-effect") e.removeAttribute(name);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  e.setAttribute("vector-effect", "non-scaling-stroke"); // 확대해도 선 굵기를 지킨다
  if (at == null) return parent ? parent.appendChild(e) : e;
  if (e !== old) parent.insertBefore(e, old || null);
  pool.set(parent, at + 1);
  if (tag === "g") pool.set(e, 0);
  return e;
}
// g의 그림을 다시 그린다. 재생은 프레임마다 로봇을 다시 그리므로 요소를 새로 만들지 않는다. 남은 요소만 지운다
function redraw(g, draw) {
  pool = new Map([[g, 0]]);
  try { draw(); } finally {
    for (const [parent, used] of pool) while (parent.children.length > used) parent.lastChild.remove();
    pool = null;
  }
}
const fmtDeg = (yaw) => Math.round((((yaw / RADIANS + 180) % 360) + 360) % 360 - 180);

/* ---- 그림 (anatomy 규칙: 가는 선 1종, 밝은 4톤, 바탕 lo · 구조 mid · 주인공 hi) ---- */
const line = (parent, d, tone, cls = "") => d && sv("path", { class: `replay-line ${cls}`.trim(), "data-tone": tone, d }, parent);
const dot = (parent, [cx, cy], r) => sv("circle", { class: "replay-dot", cx, cy, r }, parent);
// 표지의 점. 길이 0인 선의 둥근 끝이라서 확대해도 크기가 같다
const pin = (parent, [x, y]) => sv("path", { class: "replay-end", d: `M${num(x)} ${num(y)}h0` }, parent);

// 면 순서: 바탕 → 옆면 4톤 → 윗면 → 이음선·bevel·홈(inner) → 테두리. cls가 있으면 g로 묶는다 (CSS가 색을 바꾼다)
function drawSolid(parent, e, cls, tone = "mid", inner = "") {
  const g = cls ? sv("g", { class: cls }, parent) : parent;
  sv("path", { class: "replay-hull", d: e.fill }, g);
  e.shades.forEach((d, i) => d && sv("path", { class: "replay-shade", "data-shade": i, d }, g));
  const roof = sv("path", { class: "replay-roof", d: e.top }, g);
  line(g, (e.crease || "") + (e.bevel || "") + inner, tone === "hi" ? "lo" : "faint");
  line(g, e.outline, tone);
  return roof;
}

const WHEEL_R = 0.0215; // m. 실제 바퀴의 반지름 (지름 43 mm). 바퀴가 도는 각 = 궤도가 간 거리 / WHEEL_R

// 궤도형 차체의 치수 (m). 바닥 = [길이 L, 폭 W], 위판 높이 H = L × 108/225 (실제 비율 225 : 220 : 108).
// roll = [왼쪽, 오른쪽] 궤도가 이 시점까지 간 거리 (m). 무늬와 바퀴가 이만큼 움직인다
function chassisOf([L, W], x, y, yaw, roll = [0, 0]) {
  const H = L * 108 / 225, TW = 0.2 * W, c = Math.cos(yaw), s = Math.sin(yaw);
  const local = (f, l) => [x + f * c - l * s, y + f * s + l * c]; // (앞 f, 왼쪽 l) → 세계
  const plan = (f0, f1, l0, l1, r) => roundedPlan({ x: f0, y: l0, w: f1 - f0, d: l1 - l0, r }, 4).map(([f, l]) => local(f, l));
  return {
    L, W, H, TW, c, s, local, plan, rollOf: (sd) => roll[sd > 0 ? 0 : 1], TH: 0.6 * H, OFF: (W - TW) / 2, BODY: W / 2 - 1.1 * TW, DECK: W / 2 - 0.7 * TW,
    SF: 0.2 * L, ST: 0.014 * L, SW: 0.16 * W, EYE_L: 0.075 * W, EYE_R: 0.052 * Math.min(L, W), // 센서 판의 위치·반 두께·반 폭, 눈의 위치·반지름
  };
}

// 궤도 윗면과 둥근 끝의 V자 줄. 띠의 한 가장자리에서 다른 가장자리까지 긋는다. seen(nf, nz) = 그 자리의 면이 보이는가.
// 줄은 궤도가 간 거리만큼 앞으로 흐른다 (윗면의 띠는 차체보다 그만큼 앞으로 간다). 줄 간격으로 나눈 나머지만 옮긴다
function tread(p, d, sd, seen) {
  const { L, TW, TH, OFF } = d, r = TH / 2, run = L - TH, arc = (Math.PI * r) / 2, n = 13, pitch = (run + 2 * arc) / n;
  const flow = ((d.rollOf(sd) % pitch) + pitch) % pitch;
  let out = "";
  for (let k = 0; k < n; k++) {
    const u = k * pitch + flow, back = u < arc, front = u > arc + run;
    const t = back ? Math.PI - (u / arc) * (Math.PI / 2) : front ? (1 - (u - arc - run) / arc) * (Math.PI / 2) : Math.PI / 2;
    const nf = Math.cos(t), nz = Math.sin(t), f = (back ? -run / 2 : front ? run / 2 : u - arc - run / 2) + r * nf, z = r + r * nz;
    if (!seen(nf, nz)) continue;
    const tip = [f + 0.03 * L * nz, sd * OFF, z - 0.03 * L * nf]; // V의 꼭짓점은 앞을 본다
    out += pathOf([[f, sd * OFF - TW / 2, z], tip, [f, sd * OFF + TW / 2, z]].map(([a, b, h]) => p(...d.local(a, b), h)));
  }
  return out;
}

// 위판의 뚫린 곳(통풍 슬롯 5줄, 옆의 긴 슬롯 2개, 가운데 배선 구멍)과 네 귀의 나사
function deckMarks(g, p, d) {
  const { L, H, DECK } = d, flat = (ring) => pathOf(ring.map(([a, b]) => p(a, b, H)), true);
  let cut = flat(d.plan(-0.12 * L, 0.06 * L, -0.3 * DECK, 0.3 * DECK, 0.02 * L));
  for (let k = 0; k < 5; k++) cut += flat(d.plan((-0.4 + 0.045 * k) * L, (-0.375 + 0.045 * k) * L, -0.5 * DECK, 0.5 * DECK, 0.0125 * L));
  for (const sd of [1, -1]) cut += flat(d.plan(-0.14 * L, 0.1 * L, sd * 0.74 * DECK - 0.014 * L, sd * 0.74 * DECK + 0.014 * L, 0.014 * L));
  sv("path", { class: "replay-slot", d: cut }, g);
  for (const [f, sd] of [[-0.41, 1], [-0.41, -1], [0.29, 1], [0.29, -1]]) {
    const q = d.local(f * L, sd * (DECK - 0.04 * L));
    line(g, ringPath(p, q[0], q[1], 0.016 * L, H), "lo");
    dot(g, p(q[0], q[1], H), 0.12);
  }
}

// 위에서 본 차체: 등각 보기와 같은 부품의 평면도
function robotPlan({ g, p }, d) {
  const { L, TW, OFF, BODY, DECK, SF, ST, SW, EYE_L, EYE_R } = d;
  const face = (ring, cls = "") => sv("path", { class: `replay-face ${cls}`.trim(), d: pathOf(ring.map(([a, b]) => p(a, b)), true) }, g);
  for (const sd of [1, -1]) {
    face(d.plan(-L / 2, L / 2, sd * OFF - TW / 2, sd * OFF + TW / 2, 0.03 * L), "replay-track");
    line(g, tread(p, d, sd, (nf, nz) => nz > 0.5), "lo");
  }
  face(d.plan(-0.42 * L, 0.45 * L, -BODY, BODY, 0.02 * L));
  face(d.plan(-0.45 * L, 0.33 * L, -DECK, DECK, 0.02 * L));
  deckMarks(g, p, d);
  face(d.plan(SF - 0.07 * L, SF + ST, -SW, SW, 0), "replay-accent");
  for (const sd of [1, -1]) face(d.plan(SF + ST, SF + 0.085 * L, sd * EYE_L - EYE_R, sd * EYE_L + EYE_R, 0), "replay-lens");
}

// 등각 보기의 차체. 그리는 순서: 먼 궤도 → 몸통·앞판 → 가까운 궤도 → 위판 → 센서
function robotIso({ g, p, pr }, d) {
  const { L, W, H, TW, TH, OFF, BODY, DECK, SF, ST, SW, EYE_L, EYE_R, c, s } = d;
  const { sinA, cosA, sinE, cosE } = cameraOf(pr), BELT = 0.13 * TH;
  const W3 = (f, l, z) => at3(...d.local(f, l), z), P = (f, l, z) => iso(W3(f, l, z), pr);
  // 로컬 법선 (앞, 왼쪽, 위)의 면이 보는 쪽을 향하는가
  const facing = (nf, nl, nz) => ((nf * c - nl * s) * cosA - (nf * s + nl * c) * sinA) * cosE + nz * sinE > 0;
  const side = (pts, l) => pathOf(pts.map(([f, z]) => P(f, l, z)), true);
  // 앞뒤 f0 ~ f1, 반 폭 hw, 높이 z0 ~ z1의 상자. bevel(cm)을 주면 귀도 둥글다
  const box = (f0, f1, hw, z0, z1, cls, bevel) => drawSolid(g, extrude(cm(d.plan(f0, f1, -hw, hw, bevel ? 0.02 * L : 0)), 100 * z0, 100 * (z1 - z0), pr, { bevel }), cls, "hi");
  const wheel = (f, r, l, toothed, turn) => { // 맨 뒤 1개는 톱니, 나머지는 컵 모양. turn(rad)만큼 구른다: 위쪽이 앞으로 간다
    const at = (k, t) => [f + k * r * Math.cos(t - turn), TH / 2 + k * r * Math.sin(t - turn)];
    const rim = Array.from({ length: 24 }, (_, i) => at(toothed && i % 2 ? 0.8 : 1, (i / 12) * Math.PI));
    sv("path", { class: "replay-wheel", d: side(rim, l) }, g);
    sv("path", { class: "replay-slot", d: side(circleRing(f, TH / 2, 0.55 * r, 16), l) }, g); // 컵의 어두운 속
    line(g, pathOf([at(0.55, 0), at(0.55, Math.PI)].map(([a, z]) => P(a, l, z))), "lo"); // 속을 가로지르는 살 1줄. 컵 바퀴는 둥글어서 살이 없으면 도는 것이 보이지 않는다
    dot(g, P(f, l, TH / 2), 0.15);
  };
  const track = (sd) => {
    drawSolid(g, prism(stadium(-L / 2, L / 2, 0, TH), sd * OFF - TW / 2, sd * OFF + TW / 2, W3, pr), "replay-track", "hi");
    line(g, tread(p, d, sd, (nf, nz) => facing(nf, 0, nz)), "lo");
    if (!facing(0, sd, 0)) return; // 바퀴는 궤도의 바깥 옆면에 있다
    line(g, side(stadium(-L / 2 + BELT, L / 2 - BELT, BELT, TH - BELT), sd * W / 2), "lo"); // 띠의 안쪽 가장자리
    for (let k = 0; k < 4; k++) wheel(((k - 1.5) * (L - TH)) / 3, TH / 2 - 1.25 * BELT, sd * W / 2, k === 0, d.rollOf(sd) / WHEEL_R);
  };
  const body = () => box(-0.42 * L, 0.3 * L, BODY, 0.14 * H, 0.9 * H, null, 0.6 * L);
  const nose = () => { // 앞으로 기운 앞판과 뚫린 무늬
    drawSolid(g, prism([[0.3 * L, 0.14 * H], [0.45 * L, 0.22 * H], [0.45 * L, 0.36 * H], [0.3 * L, 0.9 * H]], -BODY, BODY, W3, pr), null, "hi");
    if (!facing(0.866, 0, 0.5)) return;
    const on = ([u, l]) => P((0.45 - 0.15 * u) * L, l * BODY, (0.36 + 0.54 * u) * H); // u = 기운 면의 아래 0 → 위 1
    let cut = pathOf([[0.1, -0.14], [0.1, 0.14], [0.2, 0.14], [0.2, -0.14]].map(on), true);
    for (const sd of [1, -1]) for (const [u, a, b] of [[0.6, 0.2, 0.82], [0.3, 0.15, 0.62]]) cut += pathOf([[u, sd * a], [u + 0.16, sd * a], [u + 0.04, sd * b], [u - 0.12, sd * b]].map(on), true);
    sv("path", { class: "replay-slot", d: cut }, g);
  };
  const eye = (l) => { // 앞을 보는 누운 원통. 앞면이 보이면 렌즈 고리를 그린다
    const e = prism(circleRing(l, 1.32 * H, EYE_R, 16), SF + ST, SF + 0.085 * L, (a, b, z) => W3(b, a, z), pr);
    drawSolid(g, e, "replay-lens", "hi");
    if (e.near > SF + ST) line(g, pathOf(circleRing(l, 1.32 * H, 0.6 * EYE_R, 14).map(([a, z]) => P(e.near, a, z)), true), "lo");
  };
  const far = facing(0, 1, 0) ? -1 : 1, ahead = facing(1, 0, 0); // 왼쪽 옆면이 보이면 오른쪽 궤도가 먼 쪽이다
  track(far);
  (ahead ? [body, nose] : [nose, body]).forEach((draw) => draw());
  track(-far);
  box(-0.45 * L, 0.33 * L, DECK, 0.9 * H, H, null, 1.2 * L);
  deckMarks(g, p, d);
  box(SF - 0.07 * L, SF - ST, 0.3 * SW, H, 1.1 * H); // 센서 받침 (서보)
  const foot = () => box(SF - 0.07 * L, SF + ST, SW, 1.1 * H, 1.13 * H, "replay-accent");
  const plate = () => box(SF - ST, SF + ST, SW, 1.1 * H, 1.5 * H, "replay-accent");
  const eyes = () => [far, -far].forEach((sd) => eye(sd * EYE_L));
  (ahead ? [foot, plate, eyes] : [eyes, plate, foot]).forEach((draw) => draw());
}

// roll = [왼쪽, 오른쪽] 궤도가 간 거리. 동작 줄이기에서는 무늬와 바퀴를 세워 둔다 (시험용 값은 자료 그대로 남긴다)
function robot(a, [x, y, yaw], size, roll) {
  const d = chassisOf(size, x, y, yaw, STILL.matches ? [0, 0] : roll), pt = (q, z) => a.p(q[0], q[1], z).join(",");
  redraw(a.g, () => (a.pr ? robotIso : robotPlan)(a, d));
  a.g.dataset.roll = roll.join(","); // 시험용: 궤도가 간 거리 (m)와 바퀴가 돈 각 (rad). 왼쪽, 오른쪽
  a.g.dataset.spin = roll.map((m) => m / WHEEL_R).join(",");
  a.g.dataset.center = pt([x, y], d.H); // 시험용: 센서 판 중심(= 앞 표시)과 궤도 중심의 화면 좌표
  a.g.dataset.tip = pt(d.local(d.SF, 0), d.H);
  a.g.dataset.wl = pt(d.local(0, d.OFF), d.TH / 2);
  a.g.dataset.wr = pt(d.local(0, -d.OFF), d.TH / 2);
}

// 받침판: 방 둘레의 턱(눈금 자), 바닥, 격자, 네 귀의 나사. 두 보기가 같은 것을 그린다 (등각 보기만 두께가 있다)
function drawBase(svg, { p, pr, lip }, [x0, y0, x1, y1], gap) {
  const g = sv("g", { class: "replay-base" }, svg); // g로 묶어 방의 면(시험 A13)과 구별한다
  const ring = (m) => roundedPlan({ x: x0 - m, y: y0 - m, w: x1 - x0 + 2 * m, d: y1 - y0 + 2 * m, r: m / 3 }, 6);
  const flat = (pts, closed = true) => pathOf(pts.map(([x, y]) => p(x, y)), closed);
  if (pr) drawSolid(g, extrude(cm(ring(lip)), -100 * BASE_T, 100 * BASE_T, pr, { bevel: 1.5 }), null, "lo");
  else sv("path", { class: "replay-face", "data-tone": "lo", d: flat(ring(lip)) }, g);
  sv("path", { class: "replay-floor", d: flat(ring(0)) }, g);
  const step = gap / 10; // 눈금 1칸 = 격자의 1/10. 눈금은 바닥의 가장자리에서 자란다
  let grid = "", fine = "", bold = "";
  const rule = (lo, hi, at, [ox, oy]) => {
    for (let k = Math.ceil(lo / step - 1e-9); k * step <= hi + 1e-9; k++) {
      const len = lip * (k % 10 ? (k % 5 ? 0.3 : 0.55) : 0.8);
      for (const far of [0, 1]) {
        const [x, y] = at(k * step, far), sign = far ? 1 : -1, d = flat([[x, y], [x + sign * ox * len, y + sign * oy * len]], false);
        if (k % 5) fine += d; else bold += d;
      }
      if (k % 10 === 0) grid += flat([at(k * step, 0), at(k * step, 1)], false);
    }
  };
  rule(x0, x1, (x, far) => [x, far ? y1 : y0], [0, 1]);
  rule(y0, y1, (y, far) => [far ? x1 : x0, y], [1, 0]);
  line(g, grid, "faint");
  line(g, fine, "lo");
  line(g, bold + flat(ring(0)), "mid");
  for (const cx of [x0 - lip / 2, x1 + lip / 2]) for (const cy of [y0 - lip / 2, y1 + lip / 2]) {
    line(g, ringPath(p, cx, cy, lip / 4, 0), "lo");
    dot(g, p(cx, cy), 0.5);
  }
}

// 목표: 바닥에 새긴 과녁. 십자 눈금은 안쪽 고리에서 바깥 고리까지 긋는다
function drawGoal(svg, p, [gx, gy], radius) {
  if (radius) {
    const spokes = [[1, 0], [0, 1], [-1, 0], [0, -1]].map(([a, c]) => pathOf([0.5, 1].map((k) => p(gx + k * a * radius, gy + k * c * radius)))).join("");
    sv("path", { class: "replay-pad", d: ringPath(p, gx, gy, radius, 0) }, svg);
    line(svg, ringPath(p, gx, gy, radius / 2, 0) + spokes, "mid");
    sv("path", { class: "replay-goal", d: ringPath(p, gx, gy, radius, 0) }, svg);
  }
  pin(svg, p(gx, gy));
}

// 시간 자의 자료. cross(자세) = [가운데, 왼쪽 가장자리, 오른쪽 가장자리]의 화면 점. marks = 1 s 가로대의 자세 번호
function trailOf(p, poses, step, hw) {
  const cross = ([x, y, yaw]) => {
    const c = Math.cos(yaw) * hw, s = Math.sin(yaw) * hw;
    return [p(x, y), p(x - s, y + c), p(x + s, y - c)];
  };
  const marks = [];
  for (let k = 1, i; (i = Math.round(k / step)) < poses.length; k++) marks.push(i);
  return { cross, pts: poses.map(cross), marks };
}

// 경로 = 로봇이 바닥에 깔고 간 자. 폭 = 로봇의 폭, 가로대 1개 = 1 s.
// 남은 길(가는 선·짧은 1 s 눈금·끝 점) → 시간 자(띠·가장자리·가로대·가운데 선) → 시작 표지(바닥 윤곽과 0초의 가로대). 시간 자의 모양은 layTrail이 채운다
function drawTrail(svg, p, poses, t, [L, W]) {
  const short = ([, l, r]) => pathOf([0.3, 0.7].map((k) => [l[0] + (r[0] - l[0]) * k, l[1] + (r[1] - l[1]) * k]));
  sv("path", { class: "replay-rest", d: pathOf(t.pts.map((q) => q[0])) + t.marks.map((i) => short(t.pts[i])).join("") }, svg);
  pin(svg, t.pts[poses.length - 1][0]);
  const g = sv("g", { class: "replay-trail" }, svg);
  for (const part of ["swath", "rail", "rung", "path"]) t[part] = sv("path", { class: `replay-${part}` }, g);
  const footprint = chassisOf([L, W], ...poses[0]).plan(-L / 2, L / 2, -W / 2, W / 2, 0.03 * L);
  line(svg, pathOf(footprint.map(([x, y]) => p(x, y)), true), "mid");
  sv("path", { class: "replay-start", d: pathOf(t.pts[0].slice(1)) }, svg);
}

// 로봇이 자를 깐다: 시간 자를 자세 번호 at(소수 가능)까지만 그린다
function layTrail(t, at, pose) {
  const laid = [...t.pts.slice(0, Math.floor(at) + 1), t.cross(pose)], col = (k) => laid.map((q) => q[k]);
  t.path.setAttribute("d", pathOf(col(0)));
  t.rail.setAttribute("d", pathOf(col(1)) + pathOf(col(2)));
  t.swath.setAttribute("d", pathOf([...col(1), ...col(2).reverse()], true));
  t.rung.setAttribute("d", t.marks.filter((i) => i <= at).map((i) => pathOf(t.pts[i].slice(1))).join(""));
}

// 기둥의 받침을 바닥에 고정하는 볼트 8개의 자리 (갓 밖으로 보이는 받침 테의 가운데)
const boltsOf = (cx, cy, r) => Array.from({ length: 8 }, (_, k) => [cx + 0.93 * r * Math.cos((k * Math.PI) / 4), cy + 0.93 * r * Math.sin((k * Math.PI) / 4)]);

// 위에서 본 장애물: 등각 보기와 같은 부품의 평면도. 기둥 = 받침·볼트·갓·윗면 고리, 벽 = 몸통과 갓돌
function planShapes(svg, p, shapes) {
  const flat = (pts) => pathOf(pts.map(([x, y]) => p(x, y)), true);
  for (const s of shapes) {
    const [cx, cy] = s.center, r = s.radius;
    if (s.kind === "rect") {
      sv("path", { class: "replay-solid", d: flat(cornersOf(s)) }, svg);
      if (Math.min(...s.size) > 2 * COPING) line(svg, flat(cornersOf(copingOf(s))), "faint");
      continue;
    }
    sv("path", { class: "replay-solid", d: ringPath(p, cx, cy, r, 0) }, svg);
    for (const q of boltsOf(cx, cy, r)) dot(svg, p(...q), 0.45);
    line(svg, ringPath(p, cx, cy, 0.86 * r, 0), "mid");
    line(svg, ringPath(p, cx, cy, 0.5 * r, 0), "faint");
    line(svg, ringPath(p, cx, cy, 0.13 * r, 0), "lo");
    dot(svg, p(cx, cy), 0.45);
  }
}

// 원기둥 장애물 (cm): 볼트로 고정한 받침 → 홈 2줄이 있는 몸통 → 띠 → 몸통 → 갓 → 윗면의 고리와 나사.
// 아래부터 그리면 겹침 순서가 맞는다. 가장 넓은 받침이 자료의 반지름이다 (부품을 더해도 닿는 크기는 그대로)
function pillar(g, cx, cy, r, h, pr) {
  const drum = (k, z0, z1, bevel = 0, inner = "") => drawSolid(g, cylinder(cx, cy, k * r, z0, z1 - z0, pr, 32, bevel), null, "mid", inner);
  const ring = (k, tone) => line(g, pathOf(circleRing(cx, cy, k * r, 24).map(([x, y]) => iso([x, y, h], pr)), true), tone);
  drum(1, 0, 0.08 * h, 0.6);
  for (const [x, y] of boltsOf(cx, cy, r)) dot(g, iso([x, y, 0.08 * h], pr), 0.45);
  drum(0.74, 0.08 * h, 0.56 * h, 0, sideArc(cx, cy, 0.74 * r, 0.16 * h, pr) + sideArc(cx, cy, 0.74 * r, 0.21 * h, pr));
  drum(0.84, 0.56 * h, 0.66 * h, 0.5);
  drum(0.74, 0.66 * h, 0.9 * h);
  drum(0.86, 0.9 * h, h, 1.2);
  ring(0.5, "faint");
  ring(0.13, "lo");
  dot(g, iso([cx, cy, h], pr), 0.45);
}

const copingOf = ({ center, size: [w, d] }) => ({ center, size: [w - 2 * COPING, d - 2 * COPING] }); // 벽 안으로 들인 갓돌의 바닥

// 벽: 몸통(자료의 크기 그대로) + 갓돌. 보는 쪽의 두 면에 gap마다 이음선을 긋는다 (바닥 격자와 같은 자리).
// 낮은 턱(잘라 낸 벽)은 갓돌이 없고 이음선이 윗면을 가로지른다. 선은 모두 면의 한 모서리에서 다른 모서리까지 간다
function wall(g, s, pr, low, gap) {
  const [cx, cy] = s.center, [w, d] = s.size, x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - d / 2, y1 = cy + d / 2;
  const top = low ? LEDGE_H : WALL_H - COPING_H, [vx, vy] = towardViewer(pr), fx = vx > 0 ? x1 : x0, fy = vy > 0 ? y0 : y1; // anatomy의 y는 세계의 −y
  const P = (x, y, z) => iso(at3(x, y, z), pr);
  let joints = "";
  for (let x = Math.ceil((x0 + 0.01) / gap) * gap; x < x1; x += gap) joints += pathOf(low ? [P(x, y0, top), P(x, y1, top)] : [P(x, fy, 0), P(x, fy, top)]);
  for (let y = Math.ceil((y0 + 0.01) / gap) * gap; y < y1; y += gap) joints += pathOf(low ? [P(x0, y, top), P(x1, y, top)] : [P(fx, y, 0), P(fx, y, top)]);
  const roof = drawSolid(g, extrude(cm(cornersOf(s)), 0, 100 * top, pr, { bevel: low ? 0.8 : 0 }), null, "mid", joints);
  if (low) roof.setAttribute("data-low", "1");
  else if (Math.min(w, d) > 2 * COPING) drawSolid(g, extrude(cm(cornersOf(copingOf(s))), 100 * top, 100 * COPING_H, pr, { bevel: 0.6 }));
}

// 등각 보기의 장애물. 모양마다 g 1개 (place가 로봇의 앞뒤로 옮긴다). 먼 것부터 돌려준다.
// 잘라 낸 보기: 방 가운데보다 보는 쪽(5 cm 넘게)에 있는 사각형은 낮은 턱으로 그린다
function isoShapes(svg, pr, [x0, y0, x1, y1], shapes, gap) {
  const mid = depthOf([50 * (x0 + x1), -50 * (y0 + y1), 0], pr);
  return shapes.map((s) => ({ s, depth: depthOf(at3(...s.center), pr) })).sort((a, b) => a.depth - b.depth).map(({ s, depth }) => {
    const g = sv("g", { class: "replay-shape" }, svg);
    if (s.kind === "rect") wall(g, s, pr, depth - mid > 5, gap);
    else pillar(g, 100 * s.center[0], -100 * s.center[1], 100 * s.radius, 100 * WALL_H, pr);
    return { g, s };
  });
}

// 모양이 로봇 (x, y)보다 보는 쪽에 있는가. 사각형은 로봇에 가장 가까운 점으로 잰다 (긴 벽은 가운데로 재면 틀린다)
function inFront({ kind, center: [cx, cy], size }, x, y, pr) {
  const [w, d] = kind === "rect" ? size : [0, 0];
  const q = [Math.max(cx - w / 2, Math.min(x, cx + w / 2)), Math.max(cy - d / 2, Math.min(y, cy + d / 2))];
  return depthOf(at3(...q), pr) > depthOf(at3(x, y), pr);
}

const turnOf = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a)); // yaw a → b의 가장 짧은 회전 (−π ~ π)
const lerp = (list, at) => { const i = Math.floor(at); return list[i] + (at - i) * ((list[i + 1] ?? list[i]) - list[i]); };

// 자세 사이를 잇는다 (재생 중에만 쓴다. 화면 주사율로 움직인다). 위치는 직선으로, 방향은 가까운 쪽으로 돈다
function poseAt(poses, at) {
  const i = Math.floor(at), a = poses[i], b = poses[i + 1], t = at - i;
  if (!b || !t) return a;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + turnOf(a[2], b[2]) * t];
}

// 자세마다의 누적 거리 (m). dist = 지나온 길, left·right = 두 궤도가 간 거리. hw = 궤도 사이 폭의 반.
// 자세 i−1 → i: 간 거리 d (뒤로 가면 음수), 돈 각 dθ → 왼쪽 d − dθ·hw, 오른쪽 d + dθ·hw. 읽을 때 1번만 계산한다
function odometryOf(poses, hw) {
  const dist = [0], left = [0], right = [0];
  for (let i = 1; i < poses.length; i++) {
    const [ax, ay, a] = poses[i - 1], [bx, by, b] = poses[i], turn = turnOf(a, b), mid = a + turn / 2;
    const d = Math.hypot(bx - ax, by - ay), go = Math.sign((bx - ax) * Math.cos(mid) + (by - ay) * Math.sin(mid)) * d;
    dist.push(dist[i - 1] + d);
    left.push(left[i - 1] + go - turn * hw);
    right.push(right[i - 1] + go + turn * hw);
  }
  return { dist, left, right };
}

// 계약 scene.agent_size = [길이, 폭] (m)가 맞으면 그 값, 아니면 2·agent_radius 정사각형 (없으면 반지름 0.1)
function agentSize(scene) {
  const a = scene && scene.agent_size;
  if (Array.isArray(a) && a.length === 2 && a.every((v) => typeof v === "number" && v > 0)) return a;
  const d = 2 * (scene && scene.agent_radius > 0 ? scene.agent_radius : 0.1);
  return [d, d];
}

function drawScene(st) {
  const { svg, view } = st, { trajectory: traj, scene } = st.data;
  svg.textContent = "";
  const b = boundsOf(traj, scene), f = frameOf(view, b), shapes = (scene && scene.shapes) || [], body = agentSize(scene);
  const gap = Math.max(1, Math.ceil(Math.max(b[2] - b[0], b[3] - b[1]) / 20)); // 격자 간격 (m). 벽의 이음선도 같은 자리에 온다
  st.size = f.size;
  drawBase(svg, f, b, gap);
  if (traj.goal) drawGoal(svg, f.p, traj.goal, scene && scene.goal_radius);
  st.trail = trailOf(f.p, traj.poses, st.step, body[1] / 2);
  drawTrail(svg, f.p, traj.poses, st.trail, body);
  st.shapes = f.pr ? isoShapes(svg, f.pr, b, shapes, gap) : (planShapes(svg, f.p, shapes), []);
  st.agent = { g: sv("g", { class: "replay-robot replay-black" }, svg), p: f.p, pr: f.pr };
  const sel = st.sel || {};
  st.ui.title.textContent = `에피소드 #${sel.scenario}`;
  st.ui.hint.textContent = view === "top" ? "위에서 본 지도" : "등각 보기";
  st.ui.caption.textContent = `${sel.run} · 시드 ${sel.seed} · 방 ${(b[2] - b[0]).toFixed(1)} × ${(b[3] - b[1]).toFixed(1)} m · 주황 띠의 폭은 로봇의 폭이고, 가로대 1개는 1초예요.`;
  place(st, st.idx);
}

// 읽은 값과 슬라이더는 기록된 자세 n의 것이다 (재생 중의 보간 값을 보이지 않는다)
function readOut(st, n) {
  const [x, y, yaw] = st.data.trajectory.poses[n];
  st.ui.slider.value = n;
  st.ui.time.textContent = `${(n * st.step).toFixed(1)} s`;
  st.ui.dist.textContent = `이동 ${st.odo.dist[n].toFixed(2)} m`;
  st.ui.pos.textContent = `x ${x.toFixed(2)} m · y ${y.toFixed(2)} m`;
  st.ui.deg.textContent = `${fmtDeg(yaw)}°`;
}

// 로봇보다 보는 쪽에 있는 장애물은 로봇 다음에 그린다. 앞뒤가 바뀐 프레임에만 요소를 옮긴다 (먼 것부터 다시 넣어 순서를 지킨다)
function orderShapes(st, x, y) {
  const front = st.shapes.map((o) => inFront(o.s, x, y, st.agent.pr));
  if (front.every((f, i) => f === st.shapes[i].front)) return;
  st.shapes.forEach((o, i) => { o.front = front[i]; st.svg.insertBefore(o.g, front[i] ? null : st.agent.g); });
}

// 자세 번호 at의 화면: 로봇, 깊이 순서, 시간 자, 확대 창, 읽은 값. at이 소수이면 두 자세 사이다 (재생 중에만)
function place(st, at) {
  const { poses } = st.data.trajectory, a = st.agent, [W, H] = st.size;
  st.idx = Math.max(0, Math.min(at, poses.length - 1));
  const pose = poseAt(poses, st.idx), [x, y] = pose;
  robot(a, pose, agentSize(st.data.scene), [lerp(st.odo.left, st.idx), lerp(st.odo.right, st.idx)]);
  layTrail(st.trail, st.idx, pose);
  orderShapes(st, x, y);
  const [cx, cy] = a.p(x, y), k = st.zoom; // 확대 k배: 그림판의 1/k 창을 로봇 가운데에 둔다 (로봇을 따라간다). 좌표 계산은 그대로
  st.svg.setAttribute("viewBox", k > 1 ? `${cx - W / k / 2} ${cy - H / k / 2} ${W / k} ${H / k}` : `0 0 ${W} ${H}`);
  readOut(st, Math.floor(st.idx));
}

/* ---- 재생 ---- */
const STILL = window.matchMedia("(prefers-reduced-motion: reduce)");
function stop(st) {
  st.playing = false;
  cancelAnimationFrame(st.raf);
  st.ui.play.textContent = "재생";
}
function tick(st, now) {
  if (!st.playing) return;
  if (!st.root.isConnected) return stop(st);
  const last = st.data.trajectory.poses.length - 1, raw = st.i0 + (now - st.t0) / (st.step * 1000);
  const at = Math.min(last, STILL.matches ? Math.floor(raw) : raw); // 재생 중에만 자세 사이를 잇는다. 동작 줄이기: 자세 단위로 넘긴다
  if (at !== st.idx) place(st, at);
  if (at >= last) return stop(st);
  st.raf = requestAnimationFrame((t) => tick(st, t));
}
function togglePlay(st) {
  if (st.playing) { // 멈추면 읽은 값이 가리키는 기록된 자세로 맞춘다
    stop(st);
    return place(st, Math.floor(st.idx));
  }
  const last = st.data.trajectory.poses.length - 1;
  st.i0 = st.idx >= last ? 0 : st.idx;
  st.t0 = performance.now();
  st.playing = true;
  st.ui.play.textContent = "멈춤";
  st.raf = requestAnimationFrame((t) => tick(st, t));
}

/* ---- 칸 (상태는 box마다 WeakMap에) ---- */
const states = new WeakMap();
let seq = 0; // datalist의 id를 칸마다 다르게 한다

// 범례의 표지. 그림과 같은 클래스를 쓴다
const KEYS = [
  ["경로", (m) => {
    sv("path", { class: "replay-swath", d: "M0 1H16V9H0Z" }, m);
    sv("path", { class: "replay-rail", d: "M0 1H16M0 9H16" }, m);
    sv("path", { class: "replay-rung", d: "M4 1V9M12 1V9" }, m);
    sv("path", { class: "replay-path", d: "M0 5H16" }, m);
  }],
  ["남은 길", (m) => sv("path", { class: "replay-rest", d: "M0 5H16M8 3V7" }, m)],
  ["시작", (m) => { line(m, "M3 1H13V9H3Z", "mid"); sv("path", { class: "replay-start", d: "M8 1V9" }, m); }],
  ["목표", (m) => { sv("circle", { class: "replay-goal", cx: 8, cy: 5, r: 4.4 }, m); line(m, "M10.2 5A2.2 2.2 0 1 1 5.8 5A2.2 2.2 0 1 1 10.2 5Z", "mid"); pin(m, [8, 5]); }],
  ["로봇", (m) => {
    const g = sv("g", { class: "replay-black" }, m);
    sv("rect", { class: "replay-face", x: 3, y: 1, width: 10, height: 8, rx: 1 }, g);
    sv("rect", { class: "replay-face replay-accent", x: 9, y: 2.5, width: 1.6, height: 5 }, g);
  }],
];

function build(box) {
  box.textContent = "";
  const root = el("div", "replay", box), ui = {};
  ui.msg = el("p", "replay-msg", root);
  ui.err = el("p", "replay-err", root);
  ui.body = el("div", "replay-body", root);
  const bar = el("div", "replay-bar", ui.body);
  ui.runs = el("select", "replay-select", bar);
  ui.runs.setAttribute("aria-label", "실행과 시드");
  const seg = el("div", "replay-seg", bar);
  seg.setAttribute("role", "group");
  seg.setAttribute("aria-label", "보기");
  ui.views = { top: el("button", "", seg, "위에서 본 지도"), iso: el("button", "", seg, "등각 보기") };
  // 확대: 보기 단추와 같은 나눔 단추. 이름표는 눈에 보이는 글 1개, 묶음의 이름 1개 (화면 낭독기가 두 번 읽지 않는다)
  const zoom = el("div", "replay-zoom", bar);
  el("span", "", zoom, "확대").setAttribute("aria-hidden", "true");
  const steps = el("div", "replay-seg", zoom);
  steps.setAttribute("role", "group");
  steps.setAttribute("aria-label", "확대");
  ui.zooms = ZOOMS.map((k) => el("button", "", steps, k === 1 ? "전체" : `${k}배`));
  ui.eps = el("div", "replay-eps", ui.body);
  ui.eps.setAttribute("role", "group");
  ui.eps.setAttribute("aria-label", "에피소드");
  // 그림판: 위 = 그림 번호·제목, 가운데 = 그림, 아래 = 보기 이름·읽은 값, 판 밖 = 범례·설명
  const fig = el("figure", "replay-plate", ui.body);
  const head = el("div", "replay-corners", fig);
  el("span", "replay-fig", head, "Fig. 1");
  ui.title = el("span", "replay-title", head);
  const svg = sv("svg", { class: "replay-svg", viewBox: `0 0 ${SIDE} ${SIDE}`, role: "img", "aria-label": "주행 기록 그림" }, fig);
  const foot = el("div", "replay-corners", fig);
  ui.hint = el("span", "replay-hint", foot);
  const read = el("span", "replay-read", foot);
  for (const name of ["time", "dist", "pos", "deg"]) ui[name] = el("span", "", read);
  const legend = el("div", "replay-legend", ui.body), keys = el("span", "replay-keys", legend);
  for (const [label, draw] of KEYS) {
    const key = el("span", "replay-key", keys);
    draw(sv("svg", { class: "replay-mark", viewBox: "0 0 16 10", "aria-hidden": "true" }, key));
    el("span", "", key, label);
  }
  ui.caption = el("span", "replay-caption", legend);
  const ctl = el("div", "replay-ctl", ui.body);
  ui.play = el("button", "replay-btn", ctl, "재생");
  const lab = el("label", "replay-time", ctl);
  el("span", "", lab, "시간");
  ui.slider = el("input", "", lab);
  ui.slider.type = "range";
  ui.slider.min = 0;
  ui.marks = el("datalist", "", lab); // 슬라이더의 1 s 눈금 = 바닥의 가로대
  ui.marks.id = `replay-marks-${++seq}`;
  ui.slider.setAttribute("list", ui.marks.id);
  const st = { root, ui, svg, view: "top", zoom: 1, size: [SIDE, SIDE], shapes: [], idx: 0, step: 0.1, token: 0, key: null, sig: null, sel: null, data: null, playing: false };

  ui.runs.addEventListener("change", () => {
    const r = st.replays[+ui.runs.value];
    pick(st, { run: r.run, seed: r.seed, scenario: r.scenarios[0].scenario });
    renderEps(st);
  });
  for (const v in ui.views) ui.views[v].addEventListener("click", () => { st.view = v; markViews(st); if (st.data) drawScene(st); });
  ui.zooms.forEach((b, i) => b.addEventListener("click", () => { st.zoom = ZOOMS[i]; markZooms(st); if (st.data) place(st, st.idx); }));
  ui.play.addEventListener("click", () => st.data && togglePlay(st));
  ui.slider.addEventListener("input", () => { if (!st.data) return; stop(st); place(st, +ui.slider.value); });
  markViews(st);
  markZooms(st);
  return st;
}

const markViews = (st) => { for (const v in st.ui.views) st.ui.views[v].setAttribute("aria-pressed", String(v === st.view)); };
const markZooms = (st) => st.ui.zooms.forEach((b, i) => b.setAttribute("aria-pressed", String(ZOOMS[i] === st.zoom)));

function renderRuns(st) {
  const { runs } = st.ui;
  runs.textContent = "";
  st.replays.forEach((r, i) => el("option", "", runs, `${r.run} · 시드 ${r.seed}`).value = i);
}

// 슬라이더의 눈금을 1 s마다 둔다. 40개를 넘으면 몇 초씩 건너뛴다
function renderMarks(st, count) {
  const { marks } = st.ui, per = 1 / st.step, every = Math.max(1, Math.ceil(count / per / 40));
  marks.textContent = "";
  for (let k = every, i; (i = Math.round(k * per)) < count; k += every) el("option", "", marks).value = i;
}

function epText(st, e) {
  const name = (st.endNames && st.endNames[e.end]) || e.end;
  const dur = st.known ? `${(e.length * st.step).toFixed(1)} s` : `${e.length}스텝`;
  return `#${e.scenario} · ${name} · ${dur}`;
}

function renderEps(st) {
  const { eps } = st.ui, r = st.replays.find((x) => x.run === st.sel.run && x.seed === st.sel.seed);
  eps.textContent = "";
  for (const e of r.scenarios) {
    const b = el("button", `replay-ep ${e.success ? "ok" : "fail"}`, eps, epText(st, e));
    b.title = e.success ? "성공" : "실패";
    b.dataset.scenario = e.scenario;
    b.addEventListener("click", () => { if (st.err) st.key = null; pick(st, { ...st.sel, scenario: e.scenario }); });
  }
  markEps(st);
}
function markEps(st) {
  for (const b of st.ui.eps.children) b.setAttribute("aria-pressed", String(+b.dataset.scenario === st.sel.scenario));
}
function markRuns(st) {
  st.ui.runs.value = st.replays.findIndex((r) => r.run === st.sel.run && r.seed === st.sel.seed);
}

function pick(st, sel) {
  st.sel = sel;
  markEps(st);
  return refresh(st);
}

// 고른 것이 목록에 아직 있으면 지킨다. 없으면 첫 항목
function fixSelection(st) {
  const old = st.sel || {};
  const r = st.replays.find((x) => x.run === old.run && x.seed === old.seed) || st.replays[0];
  if (!r || !r.scenarios.length) return (st.sel = null);
  const s = r.scenarios.find((x) => x.scenario === old.scenario) || r.scenarios[0];
  st.sel = { run: r.run, seed: r.seed, scenario: s.scenario };
}

function showError(st, e) {
  st.err = true;
  st.data = null;
  st.ui.msg.textContent = "주행 기록을 읽지 못했어요";
  st.ui.err.textContent = String((e && e.message) || e); // 남의 글이므로 따로 보인다
  st.ui.body.hidden = false;
  st.svg.textContent = "";
  st.svg.setAttribute("viewBox", `0 0 ${SIDE} ${SIDE}`);
  st.ui.slider.disabled = st.ui.play.disabled = true;
}

function refresh(st) {
  const { msg, err, body } = st.ui, s = st.sel;
  if (!s) {
    stop(st);
    ++st.token; // 늦게 온 앞 응답이 그리지 않게 한다
    st.key = null;
    st.data = null;
    err.textContent = "";
    msg.textContent = "이 반복에는 주행 기록이 없어요";
    body.hidden = true;
    return Promise.resolve();
  }
  body.hidden = false;
  const key = `${s.run}|${s.seed}|${s.scenario}`;
  if (key === st.key) return st.pending || Promise.resolve();
  st.key = key;
  stop(st);
  st.data = null; // 읽는 중에 보기·확대를 눌러도 지난 자료를 그리지 않는다
  st.err = false;
  err.textContent = "";
  msg.textContent = "불러오는 중이에요";
  const token = ++st.token;
  st.pending = Promise.resolve()
    .then(() => st.load(s.run, s.seed, s.scenario))
    .then((d) => {
      if (token !== st.token) return;
      const poses = d && d.trajectory && d.trajectory.poses;
      if (!Array.isArray(poses) || !poses.length) throw new Error("poses가 없어요");
      if (!poses.every((q) => Array.isArray(q) && q.length >= 3 && Number.isFinite(q[0]) && Number.isFinite(q[1]) && Number.isFinite(q[2]))) throw new Error("poses의 값이 숫자 3개가 아니에요"); // 하나라도 틀리면 모든 선이 NaN이 되어 빈 그림이 된다
      const step = d.trajectory.step_sec > 0 ? d.trajectory.step_sec : 0.1;
      const stepChanged = !st.known || step !== st.step;
      st.data = d;
      st.odo = odometryOf(poses, agentSize(d.scene)[1] / 2);
      st.step = step;
      st.known = true;
      msg.textContent = "";
      const n = poses.length;
      st.ui.slider.max = n - 1;
      st.ui.slider.disabled = st.ui.play.disabled = n < 2;
      renderMarks(st, n);
      st.idx = n - 1; // 처음 화면 = 경로 전체, 에이전트는 마지막 점
      drawScene(st);
      if (stepChanged) renderEps(st);
    })
    .catch((e) => { if (token === st.token) showError(st, e); });
  return st.pending;
}

// box 안에 모두 그린다. 같은 box에 다시 불러도 상태를 지킨다. 읽기가 끝나면 이행되는 Promise를 돌려준다.
function mount(box, opts) {
  opts = opts || {};
  let st = states.get(box);
  if (!st || !box.contains(st.root)) {
    if (st) stop(st);
    st = build(box);
    states.set(box, st);
  }
  st.load = opts.load;
  st.endNames = opts.endNames;
  // 시나리오가 없는 시드는 고를 수 없으므로 목록에서 뺀다
  const replays = (opts.replays || []).filter((r) => r.scenarios && r.scenarios.length);
  const sig = JSON.stringify(replays);
  const changed = sig !== st.sig;
  st.replays = replays;
  st.sig = sig;
  fixSelection(st);
  if (changed && st.sel) renderRuns(st);
  if (st.sel) {
    markRuns(st);
    if (changed) renderEps(st);
  }
  return refresh(st);
}

window.AurajiReplay = { mount, toScreen, heading };
})();
