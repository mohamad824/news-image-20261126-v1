import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = process.env.MAKEFUN_OUTPUT_DIR || "/output";
const W = 1024, H = 1024;
const PAPER = [247, 242, 231];
const NAVY = [20, 38, 74];
const INK = [26, 26, 34];
const TEAL = [14, 124, 123];
const CORAL = [226, 59, 46];
const AMBER = [217, 138, 0];
const VIOLET = [109, 40, 217];
const PINK = [214, 51, 108];
const BLUE = [29, 78, 216];
const GREEN = [26, 122, 58];
const WHITE = [255, 255, 255];
const DARKTEAL = [11, 94, 93];
const DARKCORAL = [194, 46, 34];
const DARKVIOLET = [91, 33, 182];

// ---------- PNG decode (atlas, RGBA) ----------
function crc32(buf) {
  let table = crc32.t;
  if (!table) {
    table = crc32.t = new Int32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c; }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ table[(c ^ buf[i]) & 255];
  return (c ^ -1) >>> 0;
}
function decodePng(buf) {
  let pos = 8, w = 0, h = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos); const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) throw new Error("unsupported atlas png");
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const ch = colorType === 6 ? 4 : 3;
  const stride = w * ch;
  const out = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0;
      const b = prev[x];
      const c = x >= ch ? prev[x - ch] : 0;
      let v = row[x];
      if (f === 1) v = (v + a) & 255;
      else if (f === 2) v = (v + b) & 255;
      else if (f === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (f === 4) { const p = a + b - c; const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255; }
      cur[x] = v;
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4, s = x * ch;
      out[o] = cur[s]; out[o + 1] = cur[s + 1]; out[o + 2] = cur[s + 2];
      out[o + 3] = ch === 4 ? cur[s + 3] : 255;
    }
    prev = cur;
  }
  return { w, h, data: out };
}
function encodePng(rgb, w, h) {
  const stride = w * 3;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) { raw[y * (stride + 1)] = 0; rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride); }
  const comp = zlib.deflateSync(raw, { level: 9 });
  function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", comp), chunk("IEND", Buffer.alloc(0))]);
}

// ---------- canvas ----------
const px = Buffer.alloc(W * H * 3);
function fill(c) { for (let i = 0; i < W * H; i++) { px[i * 3] = c[0]; px[i * 3 + 1] = c[1]; px[i * 3 + 2] = c[2]; } }
function setPx(x, y, c, a) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const o = (y * W + x) * 3;
  if (a >= 255) { px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; }
  else if (a > 0) { px[o] = (c[0] * a + px[o] * (255 - a)) / 255 | 0; px[o + 1] = (c[1] * a + px[o + 1] * (255 - a)) / 255 | 0; px[o + 2] = (c[2] * a + px[o + 2] * (255 - a)) / 255 | 0; }
}
function rect(x, y, w, h, c) { x |= 0; y |= 0; w |= 0; h |= 0; for (let j = Math.max(0, y); j < Math.min(H, y + h); j++) for (let i = Math.max(0, x); i < Math.min(W, x + w); i++) setPx(i, j, c, 255); }
function rrect(x, y, w, h, r, c) {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
    const cx = Math.max(x + r, Math.min(x + w - r - 1, i)), cy = Math.max(y + r, Math.min(y + h - r - 1, j));
    const dx = i - cx, dy = j - cy;
    if (dx * dx + dy * dy <= r * r) setPx(i, j, c, 255);
  }
}
function circle(cx, cy, r, c) { for (let j = cy - r; j <= cy + r; j++) for (let i = cx - r; i <= cx + r; i++) { const dx = i - cx, dy = j - cy; if (dx * dx + dy * dy <= r * r) setPx(i, j, c, 255); } }
function ring(cx, cy, r, c) { for (let a = 0; a < 360; a += 2) { const t = a * Math.PI / 180; setPx(Math.round(cx + r * Math.cos(t)), Math.round(cy + r * Math.sin(t)), c, 255); setPx(Math.round(cx + (r - 1) * Math.cos(t)), Math.round(cy + (r - 1) * Math.sin(t)), c, 255); } }
function line(x0, y0, x1, y1, c, th) {
  const dx = x1 - x0, dy = y1 - y0, n = Math.max(Math.abs(dx), Math.abs(dy), 1);
  for (let s = 0; s <= n; s++) { const x = Math.round(x0 + dx * s / n), y = Math.round(y0 + dy * s / n); for (let a = -th; a <= th; a++) for (let b = -th; b <= th; b++) setPx(x + a, y + b, c, 255); }
}
function tri(x0, y0, x1, y1, x2, y2, c) {
  const minx = Math.min(x0, x1, x2), maxx = Math.max(x0, x1, x2), miny = Math.min(y0, y1, y2), maxy = Math.max(y0, y1, y2);
  const d = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
  for (let y = miny; y <= maxy; y++) for (let x = minx; x <= maxx; x++) {
    const a = ((y1 - y2) * (x - x2) + (x2 - x1) * (y - y2)) / d, b = ((y2 - y0) * (x - x2) + (x0 - x2) * (y - y2)) / d, cc = 1 - a - b;
    if (a >= 0 && b >= 0 && cc >= 0) setPx(x, y, c, 255);
  }
}

// ---------- text via atlas ----------
const metrics = JSON.parse(fs.readFileSync(path.join(HERE, "metrics.json"), "utf8")).metrics;
const atlas = decodePng(fs.readFileSync(path.join(HERE, "atlas.png")));
function glyph(weight, size, ch) {
  const m = metrics[weight + "_" + size + "_" + ch.codePointAt(0)];
  if (!m) return metrics[weight + "_" + size + "_" + 63] || [0, 0, 0, 0, size * 0.6, 0, 0, size];
  return m;
}
function textWidth(s, weight, size) { let w = 0; for (const ch of s) w += glyph(weight, size, ch)[4]; return w; }
function drawText(x, yBaseline, s, weight, size, color) {
  let pen = x;
  for (const ch of s) {
    const m = glyph(weight, size, ch);
    const [gx, gy, gw, gh, adv, dx, dy, asc] = m;
    if (gw > 0) {
      const top = Math.round(yBaseline - asc + dy), left = Math.round(pen + dx);
      for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
        const a = atlas.data[((gy + j) * atlas.w + (gx + i)) * 4 + 3];
        if (a) setPx(left + i, top + j, color, a);
      }
    }
    pen += adv;
  }
  return pen;
}
function drawTextC(cx, yBaseline, s, weight, size, color) { drawText(cx - textWidth(s, weight, size) / 2, yBaseline, s, weight, size, color); }
function drawTextR(xRight, yBaseline, s, weight, size, color) { drawText(xRight - textWidth(s, weight, size), yBaseline, s, weight, size, color); }
function wrap(s, weight, size, maxW) {
  const words = s.split(" ");
  const lines = []; let cur = "";
  for (const wd of words) {
    const t = cur ? cur + " " + wd : wd;
    if (textWidth(t, weight, size) <= maxW) cur = t;
    else { if (cur) lines.push(cur); cur = wd; }
  }
  if (cur) lines.push(cur);
  return lines;
}
function drawWrapped(x, yTop, s, weight, size, color, maxW, lh) {
  const lines = wrap(s, weight, size, maxW);
  const asc = glyph(weight, size, "A")[7] || size;
  lines.forEach((ln, i) => drawText(x, yTop + asc + i * lh, ln, weight, size, color));
  return lines.length;
}
function chip(x, y, label, bg, size) {
  const w = Math.ceil(textWidth(label, "B", size)) + 14;
  rrect(x, y, w, size + 9, (size + 9) / 2, bg);
  drawText(x + 7, y + size + 2, label, "B", size, WHITE);
  return w;
}
function statusChip(x, y, label) { // dark pill, white text, returns width
  const size = 8;
  const w = Math.ceil(textWidth(label, "B", size)) + 12;
  rrect(x, y, w, 16, 8, NAVY);
  drawText(x + 6, y + 11, label, "B", size, WHITE);
  return w;
}

// ---------- content ----------
const STATS = [
  ["$90.47", "BRENT CRUDE (+1.9%)", CORAL],
  ["15%", "TAIWAN TARIFF — LOWEST TIER", TEAL],
  ["€45bn", "UKRAINE FUNDING PROGRAMME", VIOLET],
  ["€1.582tn", "COSTA'S MFF DRAFT TOTAL", AMBER],
  ["4.2%", "JAPAN SERVICES PPI — FASTEST SINCE 1990", BLUE],
  ["1,220", "IPL 2027 AUCTION REGISTRATIONS", PINK],
];
const TIMELINE = [
  ["19:00 UTC 25 NOV", "Fed Beige Book: modest growth, prices persist.", CORAL],
  ["22:00 UTC 25 NOV", "Asia open calls: Hang Seng +0.9%, Nikkei +0.4%.", TEAL],
  ["23:00 UTC 25 NOV", "Brent tops $90 as Gulf fallout spreads.", AMBER],
  ["00:00 UTC 26 NOV", "Taiwan: US proposes 15% tariff, lowest tier.", VIOLET],
  ["00:39 UTC 26 NOV", "Oil rises after Houthi refinery claim.", BLUE],
  ["01:30 UTC 26 NOV", "Thanksgiving Day begins; US markets closed.", PINK],
];
const LEADS = [
  { tint: [230, 242, 242], head: TEAL, dark: DARKTEAL, kicker: "BRUSSELS — EU SUMMIT", kcol: TEAL, status: "CONFIRMED",
    title: "EU summit opens in Brussels", body: "Special European Council opens today (26–27 Nov). Costa's draft: €1.582tn after €40bn cuts, plus a 3% digital tax. €45bn Ukraine programme as a grant; ECB chief search under way.", src: "Consilium · TASS · Reuters — CONFIRMED" },
  { tint: [253, 232, 230], head: CORAL, dark: DARKCORAL, kicker: "GULF — OIL", kcol: CORAL, status: "REPORTED",
    title: "Oil climbs past $90 on Houthi fallout", body: "Brent ~$90.47 (+1.9%), WTI ~$83.61, after the Houthis claimed a drone hit on Ras Tanura refinery — CLAIM, NOT CONFIRMED; coalition says 4 drones intercepted. Coalition struck Hodeidah port in response.", src: "Reuters · The Star · Ada Derana — REPORTED" },
  { tint: [237, 231, 251], head: VIOLET, dark: DARKVIOLET, kicker: "TAIPEI — TRADE", kcol: VIOLET, status: "REPORTED",
    title: "Taiwan wins lowest 15% tariff tier", body: "Executive Yuan, 26 Nov: the US proposed rate for Taiwan is 15% in the Section 301 probe — not stacked on MFN — the lowest tier, alongside Japan, South Korea, the EU and Switzerland.", src: "Taiwan Executive Yuan — REPORTED" },
];
const GRID = [
  { n: "4", kick: "SEOUL / TOKYO — MARKETS", kc: TEAL, title: "Asia steadies after Wednesday rout", body: "Hang Seng +0.9%, Nikkei +0.4% projected; Wed: Kospi −6.16%.", src: "WSJ", st: "CONFIRMED" },
  { n: "5", kick: "SEOUL — BANK OF KOREA", kc: AMBER, title: "BOK hike expected Thursday", body: "Hike expected Thu despite chip selloff, won pressure.", src: "fxstreet", st: "FORECAST" },
  { n: "6", kick: "TOKYO — ECONOMY", kc: CORAL, title: "Japan services PPI +4.2%", body: "Fastest since 1990; ocean freight +120.4% on Iran war.", src: "investingLive", st: "CONFIRMED" },
  { n: "7", kick: "CANBERRA — INFLATION", kc: VIOLET, title: "Australia CPI 3.8%", body: "Trimmed mean 3.8% y/y; Dec likely hold, hikes on table.", src: "investingLive", st: "CONFIRMED" },
  { n: "8", kick: "NEW DELHI — INDIA", kc: PINK, title: "Constitution Day + Nepal package", body: "India marks Samvidhan Divas; ₹15,000 cr package for Nepal.", src: "selfstudys", st: "CONFIRMED" },
  { n: "9", kick: "PYONGYANG — DIPLOMACY", kc: BLUE, title: "N. Korea orders Swiss office shut", body: "Pyongyang told Switzerland to close its new office.", src: "selfstudys", st: "REPORTED" },
  { n: "10", kick: "OSLO — ENERGY", kc: GREEN, title: "Norway court voids oil licences", body: "Supreme court: climate-disputed licences invalid.", src: "c54news", st: "CONFIRMED" },
  { n: "11", kick: "NAIROBI / KINSHASA — HEALTH", kc: CORAL, title: "Ebola: Kenya clears last patient", body: "DRC toll passes 5,300; Tshisekedi enacts reform law.", src: "c54news", st: "REPORTED" },
  { n: "12", kick: "ACCRA / SÃO TOMÉ — AFRICA", kc: AMBER, title: "Ghana Heritage banknotes", body: "Notes honour Nkrumah, Annan, traders; Ramos reappointed.", src: "c54news", st: "CONFIRMED" },
  { n: "13", kick: "WASHINGTON / OKINAWA — DEFENCE", kc: NAVY, title: "F-15EX debut at Kadena", body: "USAF unveils F-15EX in Okinawa; confidence near 2-yr high.", src: "simplelife", st: "CONFIRMED" },
];
const WIRES = [
  "Washington — Fed Beige Book: modest growth, wage gains, persistent price pressure.",
  "Brussels — EU–Western Balkans summit held Wed 25 Nov; Serbia absent; Montenegro close to accession treaty by June.",
  "Brussels — Costa's budget plan: €40bn cuts fall mainly on Competitiveness Fund, defence and external spending.",
  "Moscow — Russia's military budget surges; Russia reports nearly 500,000 military deaths in Ukraine (as reported).",
  "Kyiv — Ukraine and Hungary pursue renewed economic cooperation.",
  "Gaza — Israeli strike kills Hamas official (25 Nov).",
  "Paris — France seeks greater independence in critical mineral supplies.",
  "London — Britain investigates the human legacy of nuclear-weapons testing.",
  "Warsaw — Poland raises security concerns after renewed airspace violations.",
  "Brasília — Petrobras unveils US$122 billion investment strategy.",
  "Caracas — Venezuela reveals US$237.5 billion public debt; historic restructuring prepared.",
  "El Salvador — US$860 million in debt financing to cover year-end government expenditure.",
  "Barbados — February deadline for Caribbean AI framework as UN calls for global safety standards.",
  "Bogotá — Colombia marks ten years since historic peace agreement; UN warns of unfinished commitments.",
  "Beijing — China–Pakistan spaceflight: first Pakistani astronaut aboard Tiangong (25 Nov).",
  "Darmstadt / Tokyo — Joint Japanese-European mission reaches Mercury after an eight-year journey.",
  "Canberra / Honiara — Australia and Solomon Islands establish landmark security partnership.",
  "Hanoi — Vietnam advances sustainable agriculture.",
  "Seoul — South Korea prepares to reinforce its electric vehicle industry.",
  "Addis Ababa — Ethiopia champions healthcare independence.",
  "Cairo — Egypt celebrates gradual recovery of Suez Canal revenues.",
  "Tehran — Iran confronts deepening financial hardship.",
  "Space — ESA's Hera spacecraft to investigate asteroid impact (Didymos).",
];
const PINS = [
  // [num, name, lat, lon, nudgeDx, nudgeDy] — nudges in px, only where true
  // positions would overlap at r=6 (see map block); all other pins sit on
  // their true projected position.
  ["1", "Brussels", 50.85, 4.35, -2, 1], ["2", "Ras Tanura", 26.65, 50.05, -1, -4], ["3", "Riyadh", 24.71, 46.68, -6, 4],
  ["4", "Hormuz", 26.6, 56.25, 6, -2], ["5", "Taipei", 25.03, 121.57, -5, 2], ["6", "Seoul", 37.57, 126.98, 1, 5],
  ["7", "Tokyo", 35.68, 139.69, 5, -5], ["8", "New Delhi", 28.61, 77.21, 0, 0], ["9", "Pyongyang", 39.04, 125.75, -2, -7],
  ["10", "Oslo", 59.91, 10.75, 2, -1], ["11", "Kinshasa", -4.32, 15.31, 0, 0], ["12", "Accra", 5.60, -0.19, 0, 0], ["13", "Kadena", 26.36, 127.77, 6, 5],
];
const PINCOL = [CORAL, TEAL, VIOLET, AMBER, BLUE, PINK, GREEN, CORAL, TEAL, VIOLET, AMBER, BLUE, PINK];

// ---------- draw ----------
fill(PAPER);
// top strip
drawText(22, 24, "THE WORLD IN ONE DAY — MID-DAY EDITION", "B", 11, NAVY);
drawTextR(1002, 24, "36 STORIES  ·  7 REGIONS  ·  THURSDAY 26 NOVEMBER 2026", "B", 10, NAVY);
// accent bar
{ const cols = [CORAL, AMBER, TEAL, VIOLET, BLUE, PINK, GREEN]; const seg = 980 / 7; cols.forEach((c, i) => rect(22 + Math.round(i * seg), 30, Math.ceil(seg), 5, c)); }
// masthead
drawText(22, 84, "Thursday 26 November 2026", "B", 46, NAVY);
drawText(22, 106, "EU summit opens in Brussels  —  Oil climbs past $90  —  Taiwan wins lowest 15% tariff tier", "B", 13, INK);
// stats strip
rect(22, 114, 980, 1, [200, 190, 170]);
STATS.forEach((s, i) => {
  const x = 22 + i * 164;
  if (i) rect(x - 1, 120, 1, 44, [210, 200, 180]);
  drawText(x + 4, 140, s[0], "B", 21, s[2]);
  const lab = wrap(s[1], "B", 8, 152);
  lab.forEach((ln, j) => drawText(x + 4, 154 + j * 10, ln, "B", 8, INK));
});
rect(22, 170, 980, 1, [200, 190, 170]);
// timeline: 3 cols x 2 rows, one line per beat
drawText(22, 186, "UTC TIMELINE — OVERNIGHT TO 02:00 UTC", "B", 11, TEAL);
TIMELINE.forEach((t, i) => {
  const col = i % 3, row = (i / 3) | 0;
  const x = 22 + col * 328, y = 190 + row * 16;
  circle(x + 4, y + 4, 3, t[2]);
  drawText(x + 12, y + 8, t[0], "B", 9, t[2]);
  drawText(x + 12 + textWidth(t[0], "B", 9) + 6, y + 8, t[1], "R", 9, INK);
});
// leads
LEADS.forEach((L, i) => {
  const x = 22 + i * 330, y = 220, w = 320, h = 172;
  rrect(x, y, w, h, 10, L.tint);
  // illustration band
  if (i === 0) {
    rect(x, y, w, 52, [20, 38, 74]);
    // EU building bars + stars
    const bars = [[30, 26, CORAL], [52, 18, AMBER], [74, 30, TEAL], [96, 20, VIOLET], [118, 28, PINK]];
    bars.forEach(([bx, bh, c]) => rect(x + 24 + bx, y + 52 - bh, 14, bh, c));
    for (let s = 0; s < 8; s++) { const a = s * Math.PI / 4; circle(Math.round(x + 252 + 12 * Math.cos(a)), Math.round(y + 34 + 12 * Math.sin(a)), 2, [255, 210, 60]); }
    circle(x + 252, y + 34, 5, [255, 210, 60]);
  } else if (i === 1) {
    rect(x, y, w, 52, [40, 20, 16]);
    line(x + 24, y + 48, x + 90, y + 30, CORAL, 2); line(x + 90, y + 30, x + 160, y + 36, CORAL, 2); line(x + 160, y + 36, x + 240, y + 14, CORAL, 2);
    circle(x + 240, y + 14, 4, CORAL);
    tri(x + 250, y + 22, x + 242, y + 44, x + 258, y + 44, AMBER);
    circle(x + 250, y + 36, 4, [255, 255, 255]);
    rect(x + 24, y + 48, 120, 3, [120, 90, 70]);
  } else {
    rect(x, y, w, 52, [30, 16, 60]);
    rrect(x + 24, y + 12, 52, 34, 4, TEAL); rrect(x + 84, y + 12, 52, 34, 4, VIOLET); rrect(x + 144, y + 12, 52, 34, 4, PINK);
    drawText(x + 34, y + 36, "15%", "B", 16, WHITE); drawText(x + 96, y + 36, "301", "B", 16, WHITE); drawText(x + 152, y + 36, "TW", "B", 16, WHITE);
    circle(x + 248, y + 36, 12, AMBER); drawText(x + 242, y + 41, "%", "B", 14, WHITE);
  }
  statusChip(x + w - 82, y + 8, L.status);
  chip(x + 12, y + 56, L.kicker, L.kcol, 9);
  const tl = wrap(L.title, "B", 17, w - 24);
  tl.forEach((ln, j) => drawText(x + 12, y + 76 + 17 + j * 19, ln, "B", 17, L.dark));
  const bodyY = y + 76 + 17 + tl.length * 19;
  drawWrapped(x + 12, bodyY, L.body, "R", 10, INK, w - 24, 12);
  drawText(x + 12, y + h - 8, L.src, "B", 8, L.dark);
});
// MORE TOP STORIES
drawText(22, 402, "MORE TOP STORIES", "B", 13, CORAL);
rect(22, 408, 980, 2, CORAL);
GRID.forEach((g, i) => {
  const col = i % 5, row = (i / 5) | 0;
  const x = 22 + col * 198, y = 416 + row * 102, w = 188, h = 94;
  rrect(x, y, w, h, 8, WHITE);
  rect(x, y, w, 4, g.kc);
  circle(x + 14, y + 18, 9, g.kc);
  drawText(x + 11, y + 21, g.n, "B", 10, WHITE);
  drawText(x + 28, y + 21, g.kick, "B", 7, g.kc);
  const tl = wrap(g.title, "B", 12, w - 16);
  tl.forEach((ln, j) => drawText(x + 8, y + 34 + j * 13, ln, "B", 12, NAVY));
  const by = y + 34 + tl.length * 13;
  drawWrapped(x + 8, by, g.body, "R", 9, INK, w - 16, 10);
  drawText(x + 8, y + h - 7, g.src, "B", 8, g.kc);
  drawTextR(x + w - 8, y + h - 7, g.st, "B", 7, INK);
});
// ALSO IN + map
drawText(22, 628, "ALSO IN — 23 MORE STORIES", "B", 13, TEAL);
drawText(668, 628, "WHERE IT HAPPENED", "B", 13, VIOLET);
rect(22, 634, 980, 2, TEAL);
{ // wires, two columns, 8px, up to 2 lines each, 19px rows
  const colW = 306;
  WIRES.forEach((s, i) => {
    const col = i < 12 ? 0 : 1, row = i < 12 ? i : i - 12;
    const x = 22 + col * (colW + 8), y = 642 + row * 18;
    const num = String(i + 14);
    drawText(x, y + 9, num + ".", "B", 8, TEAL);
    const nx = x + (num.length === 2 ? 17 : 12);
    const lines = wrap(s, "R", 8, colW - (nx - x)).slice(0, 2);
    lines.forEach((ln, j) => drawText(nx, y + 9 + j * 9, ln, "R", 8, INK));
  });
}
// dotted map — real land mask: simplified continent polygons in [lon, lat],
// dots only where the dot's lat/lon falls inside land; pins projected from
// true lat/lon with the SAME equirectangular mapping as the dot grid.
{ const mx = 668, my = 642, mw = 334, mh = 124;
  rrect(mx, my, mw, mh, 8, WHITE);
  const SCALE = mw / 360;              // px per degree, lon and lat alike
  const LAT_TOP = 80, LAT_BOT = LAT_TOP - mh / SCALE;   // 80 .. -53.65
  const proj = (lon, lat) => [mx + (lon + 180) * SCALE, my + (LAT_TOP - lat) * SCALE];
  const unproj = (x, y) => [(x - mx) / SCALE - 180, LAT_TOP - (y - my) / SCALE];
  const LAND = [
    // North America (mainland + Central America)
    [[-168,66],[-165,60],[-158,58],[-152,60],[-145,60],[-140,60],[-135,58],[-130,54],[-126,49],[-124,42],[-121,36],[-117,32],[-112,28],[-109,24],[-106,21],[-101,18],[-96,16],[-93,15],[-90,14],[-87,13],[-83,9],[-80,8],[-78,7],[-80,9],[-82,9],[-83,10],[-80,13],[-80,20],[-82,24],[-80,26],[-76,33],[-75,38],[-73,41],[-70,42],[-68,44],[-66,45],[-62,46],[-58,47],[-55,47],[-60,49],[-64,50],[-59,51],[-55,52],[-60,55],[-64,58],[-68,58],[-73,61],[-78,62],[-83,65],[-88,66],[-93,68],[-98,69],[-108,68],[-115,68],[-125,70],[-135,69],[-145,70],[-155,71],[-162,70],[-166,68],[-168,66]],
    // Greenland
    [[-58,64],[-53,60],[-46,60],[-41,63],[-34,67],[-28,70],[-22,70],[-24,74],[-30,78],[-40,80],[-50,79],[-58,76],[-61,74],[-58,69],[-58,64]],
    // South America
    [[-80,8],[-77,5],[-79,0],[-81,-5],[-78,-10],[-74,-15],[-71,-19],[-70,-24],[-70,-30],[-72,-36],[-73,-43],[-74,-49],[-70,-54],[-66,-55],[-65,-48],[-63,-41],[-58,-35],[-53,-33],[-49,-29],[-43,-23],[-40,-20],[-38,-15],[-35,-9],[-35,-6],[-40,-3],[-44,-2],[-49,0],[-52,4],[-57,6],[-61,9],[-66,10],[-71,12],[-76,9],[-80,8]],
    // Africa
    [[-17,15],[-17,20],[-16,25],[-13,28],[-10,31],[-6,34],[-2,35],[3,37],[10,37],[11,34],[15,32],[20,32],[25,32],[30,31],[32,31],[34,28],[35,24],[36,22],[38,20],[39,18],[41,16],[43,12],[46,11],[51,11],[51,10],[47,6],[44,2],[41,-2],[40,-6],[39,-10],[37,-14],[35,-18],[33,-22],[32,-26],[28,-32],[25,-34],[20,-35],[17,-33],[15,-29],[13,-24],[13,-18],[12,-13],[12,-8],[9,-3],[9,1],[8,4],[5,6],[0,6],[-5,5],[-8,5],[-12,8],[-15,11],[-17,15]],
    // Madagascar
    [[44,-16],[47,-15],[50,-16],[50,-20],[48,-24],[45,-25],[43,-22],[43,-18],[44,-16]],
    // Eurasia (mainland; Mediterranean coast followed, so the sea stays open)
    [[-10,36],[-9,38],[-9,43],[-5,44],[-2,44],[-1,46],[-4,48],[-1,49],[1,51],[4,53],[7,54],[8,56],[8,58],[6,59],[5,61],[8,63],[11,65],[14,67],[18,69],[22,70],[26,71],[30,70],[33,69],[37,68],[42,68],[46,68],[50,69],[54,68],[58,69],[63,70],[68,70],[72,71],[76,72],[80,73],[85,74],[90,75],[95,76],[100,76],[105,77],[110,74],[115,73],[120,73],[125,72],[130,72],[135,72],[140,72],[145,72],[150,71],[155,70],[158,69],[162,66],[166,66],[170,66],[175,65],[178,65],[180,66],[179,64],[175,63],[170,61],[166,60],[162,59],[159,56],[157,53],[155,54],[152,59],[149,59],[145,59],[142,58],[141,53],[140,48],[138,45],[135,43],[132,43],[129,40],[127,38],[126,35],[124,38],[122,38],[121,35],[122,32],[120,28],[117,24],[114,22],[111,21],[108,18],[106,11],[104,9],[101,7],[99,8],[98,11],[97,15],[94,17],[92,21],[90,22],[87,21],[85,19],[82,17],[80,14],[80,10],[77,8],[75,10],[73,15],[72,19],[70,21],[68,23],[66,25],[63,25],[60,25],[57,26],[54,27],[52,26],[50,26],[48,29],[46,29],[44,29],[42,26],[40,23],[39,21],[38,19],[37,17],[35,16],[34,15],[34,18],[35,22],[36,26],[37,29],[36,31],[35,33],[34,36],[33,36],[30,36],[28,37],[27,37],[26,38],[24,37],[23,36],[23,39],[22,40],[20,42],[19,44],[18,45],[15,44],[13,45],[12,44],[10,44],[8,44],[6,43],[3,43],[1,41],[-1,39],[-2,37],[-5,36],[-8,37],[-10,36]],
    // UK, Ireland, Iceland
    [[-5,50],[-3,53],[-5,56],[-4,58],[-2,57],[0,54],[1,52],[0,51],[-3,50],[-5,50]],
    [[-10,52],[-9,54],[-8,55],[-6,55],[-6,53],[-8,51],[-10,52]],
    [[-22,64],[-19,63],[-15,64],[-14,66],[-17,66],[-21,66],[-22,64]],
    // Japan, Taiwan, Sri Lanka, Philippines
    [[130,31],[132,33],[134,34],[136,35],[138,35],[140,36],[141,39],[141,41],[143,42],[145,44],[143,44],[141,42],[140,40],[139,37],[137,36],[135,34],[133,34],[131,32],[130,31]],
    [[120,22],[120,24],[121,25],[122,25],[121,23],[120,22]],
    [[80,6],[81,7],[81,9],[80,9],[80,6]],
    [[120,18],[122,18],[122,15],[124,12],[126,8],[124,6],[122,7],[120,10],[120,14],[120,18]],
    // Indonesia / New Guinea
    [[95,5],[98,3],[100,0],[102,-2],[104,-4],[106,-6],[104,-5],[101,-1],[98,2],[95,5]],
    [[109,1],[111,3],[113,4],[116,6],[118,4],[119,1],[118,-2],[116,-4],[113,-3],[110,-1],[109,1]],
    [[105,-6],[108,-7],[111,-7],[114,-8],[114,-9],[110,-8],[106,-7],[105,-6]],
    [[131,-1],[134,-2],[137,-2],[141,-3],[144,-4],[147,-6],[150,-9],[148,-9],[145,-8],[142,-8],[139,-7],[136,-5],[133,-3],[131,-1]],
    // Australia, Tasmania, New Zealand
    [[113,-22],[114,-28],[115,-33],[117,-35],[121,-34],[124,-33],[128,-32],[131,-32],[134,-33],[136,-35],[139,-37],[141,-38],[145,-38],[147,-39],[150,-37],[152,-34],[153,-30],[153,-27],[151,-24],[149,-21],[146,-19],[144,-16],[142,-13],[142,-11],[140,-13],[137,-12],[136,-15],[134,-12],[132,-12],[130,-13],[127,-14],[124,-16],[121,-19],[118,-20],[115,-21],[113,-22]],
    [[145,-41],[147,-41],[148,-42],[147,-43],[146,-43],[145,-42],[145,-41]],
    [[167,-45],[169,-43],[171,-41],[174,-40],[176,-38],[178,-38],[176,-40],[174,-42],[172,-43],[169,-46],[167,-45]],
  ];
  // inland seas / great lakes: no dots here even though inside a land polygon
  const WATER = [
    [[47,37],[50,37],[52,38],[54,39],[54,42],[53,44],[52,46],[50,47],[49,46],[47,44],[47,40],[47,37]],       // Caspian
    [[28,41],[33,41],[36,41],[39,41],[41,43],[41,46],[38,46],[34,46],[31,46],[28,45],[28,43],[28,41]],     // Black Sea
    [[-92,47],[-88,48],[-84,46],[-82,44],[-79,43],[-76,44],[-79,46],[-84,46],[-88,47],[-92,47]],           // Great Lakes
  ];
  function inPoly(lon, lat, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function isLand(lon, lat) {
    for (const p of WATER) if (inPoly(lon, lat, p)) return false;
    for (const p of LAND) if (inPoly(lon, lat, p)) return true;
    return false;
  }
  for (let gy = my + 4; gy < my + mh - 4; gy += 4) for (let gx = mx + 4; gx < mx + mw - 4; gx += 4) {
    const [lon, lat] = unproj(gx, gy);
    if (isLand(lon, lat)) rect(gx, gy, 2, 2, [190, 185, 170]);
  }
  PINS.forEach((p, i) => {
    const [px, py] = proj(p[3], p[2]);
    const cx = Math.round(px) + p[4], cy = Math.round(py) + p[5];
    circle(cx, cy, 6, PINCOL[i]);
    ring(cx, cy, 6, WHITE);
    drawTextC(cx, cy + 3, p[0], "B", 7, WHITE);
  });
  // legend below map
  const leg = ["1 Brussels", "2 Ras Tanura", "3 Riyadh", "4 Hormuz", "5 Taipei", "6 Seoul", "7 Tokyo", "8 New Delhi", "9 Pyongyang", "10 Oslo", "11 Kinshasa", "12 Accra", "13 Kadena"];
  leg.forEach((s, i) => {
    const col = i < 7 ? 0 : 1, row = i < 7 ? i : i - 7;
    drawText(668 + col * 168, 782 + row * 11, s, "R", 9, INK);
  });
}
// DATE CHECK
rrect(22, 868, 980, 80, 10, VIOLET);
drawText(34, 886, "DATE CHECK — MID-DAY EDITION", "B", 13, WHITE);
drawTextR(990, 886, "Cut-off ~02:00 UTC, Thursday 26 November 2026", "B", 10, WHITE);
drawWrapped(34, 892, "NOW INCLUDED: the EU summit opening in Brussels, the Gulf oil climb after the Houthi refinery claim, Taiwan's 15% tariff tier, Asia steadying after Wednesday's rout, the BOK hike expected, Thanksgiving market closure.  LEFT OUT (covered in the 25 Nov editions): the Kospi −6.16% close, the Nasdaq −0.62% close, US Q3 GDP 4.3% and Oct core PCE 3.3%, the Shenzhou-24 docking, the Cartagena hostage rescue, Dell's $132.3bn backlog.  STILL TO COME (after press time): EU summit decisions (26–27 Nov), the BOK rate decision, US markets reopen Friday.", "R", 9, WHITE, 956, 12);
// sources
drawText(22, 962, "Sources: Reuters, WSJ, Consilium (EU), TASS, The Star, CGTN America, Ada Derana, Taiwan Executive Yuan. Cut-off ~02:00 UTC, Thursday 26 November 2026.", "R", 9, INK);
// footer
rect(22, 972, 980, 26, NAVY);
drawText(34, 989, "THE WORLD IN ONE DAY", "B", 11, WHITE);
drawTextR(990, 989, "THURSDAY 26 NOVEMBER 2026  ·  ONE PAGE", "B", 10, WHITE);

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, "entry.png"), encodePng(px, W, H));
