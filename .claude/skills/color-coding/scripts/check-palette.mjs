#!/usr/bin/env node
/**
 * check-palette.mjs — 色分けが色覚タイプを越えて成立するかを実測で判定する。
 *
 * 使い方:
 *   node check-palette.mjs "#0F5EA8,#C86A00"                 # 線・アイコン・小面積（既定）
 *   node check-palette.mjs --role tint "#DCEBFA,#FDEBC8"      # 広い塗り（上に文字が載る）
 *   node check-palette.mjs --role tint --on "#1A1A1A" "#DCEBFA,#FDEBC8"
 *   node check-palette.mjs --text "#0F5EA8" "#0F5EA8,#C86A00" # 文字色としても使う色を追加検査
 *   node check-palette.mjs --preset mark4
 *   node check-palette.mjs --json "#0F5EA8,#C86A00"
 *
 * 判定するもの:
 *   1. 一般色覚 / 1型(P) / 2型(D) / 3型(T) の各シミュレーション下での色差 ΔE2000
 *   2. 色相を無視した明度差（WCAGコントラスト比）— 色が潰れても残る手がかり
 *   3. 役割ごとの必要コントラスト
 *      role=mark : 各色 vs 背景 >= 3.0（WCAG 1.4.11 非文字コントラスト）
 *      role=tint : 各色 vs 載せる文字 >= 4.5、かつ 各色 vs 背景 >= 1.15（帯として見えるか）
 *      --text 指定色 : vs 背景 >= 4.5（WCAG 1.4.3 本文）
 *
 * シミュレーションは Viénot, Brettel & Mollon (1999) の2色覚モデル。
 * 強度は「強度（dichromacy）」固定。弱度はこれより見分けやすいので、
 * 強度で通れば弱度でも通る（安全側）。
 */

// ---------- 色空間 ----------
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

function hexToRgb(hex) {
  const h = hex.trim().replace(/^#/, '');
  const s = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (!/^[0-9a-fA-F]{6}$/.test(s)) throw new Error(`色コードが不正: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255);
}
const rgbToHex = (rgb) =>
  '#' + rgb.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();

// ---------- 2色覚シミュレーション (Viénot 1999) ----------
const RGB_TO_LMS = [
  [17.8824, 43.5161, 4.11935],
  [3.45565, 27.1554, 3.86714],
  [0.0299566, 0.184309, 1.46709],
];
const LMS_TO_RGB = [
  [0.0809444479, -0.130504409, 0.116721066],
  [-0.0102485335, 0.0540193266, -0.113614708],
  [-0.000365296938, -0.00412161469, 0.693511405],
];
const mul = (m, v) => m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);

const DICHROMAT = {
  P: (lms) => [2.02344 * lms[1] - 2.52581 * lms[2], lms[1], lms[2]],
  D: (lms) => [lms[0], 0.494207 * lms[0] + 1.24827 * lms[2], lms[2]],
  T: (lms) => [lms[0], lms[1], -0.395913 * lms[0] + 0.801109 * lms[1]],
};

function simulate(rgb, type) {
  if (type === 'C') return rgb;
  const lin = rgb.map(srgbToLinear);
  const out = mul(LMS_TO_RGB, DICHROMAT[type](mul(RGB_TO_LMS, lin)));
  return out.map((c) => linearToSrgb(Math.min(1, Math.max(0, c))));
}

// ---------- 明度・コントラスト ----------
const relLum = (rgb) => {
  const [r, g, b] = rgb.map(srgbToLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [l1, l2] = [relLum(a), relLum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};

// ---------- CIEDE2000 ----------
function rgbToLab(rgb) {
  const [r, g, b] = rgb.map(srgbToLinear);
  const X = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const Y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const Z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
  const [fx, fy, fz] = [f(X), f(Y), f(Z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function deltaE2000(lab1, lab2) {
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const ap1 = (1 + G) * a1;
  const ap2 = (1 + G) * a2;
  const Cp1 = Math.hypot(ap1, b1);
  const Cp2 = Math.hypot(ap2, b2);
  const hp = (b, ap) => {
    if (b === 0 && ap === 0) return 0;
    const h = Math.atan2(b, ap) / rad;
    return h < 0 ? h + 360 : h;
  };
  const hp1 = hp(b1, ap1);
  const hp2 = hp(b2, ap2);
  const dL = L2 - L1;
  const dC = Cp2 - Cp1;
  let dh = 0;
  if (Cp1 * Cp2 !== 0) {
    dh = hp2 - hp1;
    if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
  }
  const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin((dh * rad) / 2);
  const Lb = (L1 + L2) / 2;
  const Cpb = (Cp1 + Cp2) / 2;
  let hpb;
  if (Cp1 * Cp2 === 0) hpb = hp1 + hp2;
  else if (Math.abs(hp1 - hp2) <= 180) hpb = (hp1 + hp2) / 2;
  else hpb = hp1 + hp2 < 360 ? (hp1 + hp2 + 360) / 2 : (hp1 + hp2 - 360) / 2;
  const T =
    1 - 0.17 * Math.cos((hpb - 30) * rad) + 0.24 * Math.cos(2 * hpb * rad) +
    0.32 * Math.cos((3 * hpb + 6) * rad) - 0.2 * Math.cos((4 * hpb - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hpb - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cpb ** 7 / (Cpb ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lb - 50) ** 2) / Math.sqrt(20 + (Lb - 50) ** 2);
  const Sc = 1 + 0.045 * Cpb;
  const Sh = 1 + 0.015 * Cpb * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh));
}

// ---------- 判定 ----------
const TYPES = [
  ['C', '一般'],
  ['P', '1型'],
  ['D', '2型'],
  ['T', '3型'],
];
// 閾値の根拠は references/verify.md に記載（既知のCUD配色で較正）
const TH = { dE: 18, lumRatio: 1.25, markBg: 3.0, tintOn: 4.5, tintBg: 1.15, textBg: 4.5 };

function analysePair(hexA, hexB) {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  const dE = {};
  for (const [t] of TYPES) dE[t] = deltaE2000(rgbToLab(simulate(a, t)), rgbToLab(simulate(b, t)));
  const worstType = TYPES.map(([t]) => t).reduce((x, y) => (dE[x] <= dE[y] ? x : y));
  const lum = contrast(a, b);
  const okColor = Math.min(...Object.values(dE)) >= TH.dE;
  const okLum = lum >= TH.lumRatio;
  return { hexA, hexB, dE, worstType, worst: dE[worstType], lum, okColor, okLum, pass: okColor || okLum };
}

const PRESETS = {
  mark2: ['#0F5EA8', '#C86A00'],
  mark4: ['#0F5EA8', '#C86A00', '#6E4310', '#7A7F86'],
  tint2: ['#D7E8F8', '#FBE3B4'],
  cud: ['#E69F00', '#56B4E9', '#009E73', '#F0E442', '#0072B2', '#D55E00', '#CC79A7'],
};

function parseArgs(argv) {
  const o = { colors: [], bg: '#FFFFFF', on: '#1A1A1A', role: 'mark', text: [], json: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--bg') o.bg = argv[++i];
    else if (t === '--on') o.on = argv[++i];
    else if (t === '--role') o.role = argv[++i];
    else if (t === '--text') o.text = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (t === '--json') o.json = true;
    else if (t === '--preset') o.colors.push(...(PRESETS[argv[++i]] || []));
    else if (t.startsWith('--')) throw new Error(`未知のオプション: ${t}`);
    else o.colors.push(...t.split(',').map((s) => s.trim()).filter(Boolean));
  }
  return o;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.colors.length < 1) {
    console.error('使い方: node check-palette.mjs "#0F5EA8,#C86A00" [--role mark|tint] [--bg "#FFFFFF"] [--on "#1A1A1A"] [--text "#0F5EA8"] [--json]');
    process.exit(2);
  }
  if (!['mark', 'tint'].includes(args.role)) throw new Error(`--role は mark か tint: ${args.role}`);
  const bg = hexToRgb(args.bg);
  const on = hexToRgb(args.on);
  const pairs = [];
  for (let i = 0; i < args.colors.length; i++)
    for (let j = i + 1; j < args.colors.length; j++) pairs.push(analysePair(args.colors[i], args.colors[j]));

  const areas = args.colors.map((h) => {
    const c = hexToRgb(h);
    if (args.role === 'mark') {
      const ratio = contrast(c, bg);
      return { hex: h, role: 'mark', ratio, onRatio: null, pass: ratio >= TH.markBg, why: `vs背景 ${TH.markBg} 以上` };
    }
    const onRatio = contrast(c, on);
    const ratio = contrast(c, bg);
    return { hex: h, role: 'tint', ratio, onRatio, pass: onRatio >= TH.tintOn && ratio >= TH.tintBg, why: `vs文字 ${TH.tintOn} 以上 かつ vs背景 ${TH.tintBg} 以上` };
  });
  const texts = args.text.map((h) => ({ hex: h, ratio: contrast(hexToRgb(h), bg), pass: contrast(hexToRgb(h), bg) >= TH.textBg }));
  const sims = args.colors.map((h) => ({
    hex: h,
    P: rgbToHex(simulate(hexToRgb(h), 'P')),
    D: rgbToHex(simulate(hexToRgb(h), 'D')),
    T: rgbToHex(simulate(hexToRgb(h), 'T')),
  }));
  const failures = [...pairs.filter((p) => !p.pass), ...areas.filter((a) => !a.pass), ...texts.filter((t) => !t.pass)];

  if (args.json) {
    console.log(JSON.stringify({ bg: args.bg, on: args.on, role: args.role, thresholds: TH, pairs, areas, texts, sims, failed: failures.length }, null, 2));
    process.exit(failures.length ? 1 : 0);
  }

  const f = (n, w = 6) => n.toFixed(1).padStart(w);
  console.log(`\n背景 ${args.bg} / 役割 ${args.role}${args.role === 'tint' ? ` / 載せる文字 ${args.on}` : ''} / 見分け閾値 ΔE00>=${TH.dE} または 明度比>=${TH.lumRatio}\n`);
  console.log('■ 色の組み合わせ（全ペア）');
  console.log('  A         B         一般   1型   2型   3型  明度比  判定');
  for (const p of pairs) {
    const mark = p.pass ? (p.okColor && p.okLum ? '◎' : '○') : '✗';
    const note = p.pass ? (p.okColor ? '' : ' 明度差のみで成立（形/位置の併用必須）') : ` ${p.worstType}型で潰れる`;
    console.log(
      `  ${p.hexA.padEnd(9)} ${p.hexB.padEnd(9)}${f(p.dE.C, 6)}${f(p.dE.P, 6)}${f(p.dE.D, 6)}${f(p.dE.T, 6)}${f(p.lum, 7)}  ${mark}${note}`,
    );
  }
  if (args.role === 'mark') {
    console.log(`\n■ 線・アイコン・小面積として成立するか（vs背景 ${TH.markBg} 以上）`);
    for (const a of areas) console.log(`  ${a.hex.padEnd(9)}${f(a.ratio)}  ${a.pass ? '○' : '✗ 背景に埋もれる。塗りに回すなら --role tint で再検査'}`);
  } else {
    console.log(`\n■ 塗りとして成立するか（vs文字 ${args.on} が ${TH.tintOn} 以上 / vs背景 ${TH.tintBg} 以上）`);
    for (const a of areas)
      console.log(`  ${a.hex.padEnd(9)} vs文字${f(a.onRatio)} vs背景${f(a.ratio)}  ${a.pass ? '○' : a.onRatio < TH.tintOn ? '✗ 上の文字が読めない' : '✗ 白地から浮かない'}`);
  }
  if (texts.length) {
    console.log('\n■ 文字色のコントラスト（本文: 4.5以上）');
    for (const t of texts) console.log(`  ${t.hex.padEnd(9)}${f(t.ratio)}  ${t.pass ? '○' : '✗ 本文には使えない'}`);
  }
  console.log('\n■ 各色のシミュレーション結果（強度2色覚）');
  for (const s of sims) console.log(`  ${s.hex}  →  1型 ${s.P} / 2型 ${s.D} / 3型 ${s.T}`);
  console.log(`\n結果: ${failures.length === 0 ? '全項目クリア' : `${failures.length}件の不合格`}\n`);
  process.exit(failures.length ? 1 : 0);
}

try {
  main();
} catch (e) {
  console.error(`エラー: ${e.message}`);
  process.exit(2);
}
