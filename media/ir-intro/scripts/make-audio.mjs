// 영상 음악과 효과음을 직접 합성해 public/audio/*.wav 로 쓴다 (외부 음원 없음, 저작권 문제 없음).
//   node scripts/make-audio.mjs
// 3판 음악: 135BPM 인디 일렉트로 팝 (아날로그 신스 베이스, 옛 드럼머신, 탬버린, 뮤트 기타, 숨 섞인 목소리 화음, 유리 벨).
// 화음 하나(실제 약 5.3초)가 3마디라 src/timeline.ts 의 장면 경계가 박 위에 온다 (운영자와 근로자 장면만 마디 머리에서
// 한 박 뒤). 화면에서 일이 일어나는 순간
// (글자, 문제 세 줄, 로고, 메뉴 짚기, 장 제목, 칩 도착)에 맞춰 치고, 앱이 타이핑하는 동안은 물러난다.
// 악기와 섞기는 scripts/synth.mjs.
import { mkdirSync, writeFileSync } from 'node:fs';
import * as S from './synth.mjs';

const SR = S.SR;
const out = new URL('../public/audio/', import.meta.url);
mkdirSync(out, { recursive: true });

function writeWav(name, left, right = left) {
  const n = left.length;
  const buffer = Buffer.alloc(44 + n * 4);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + n * 4, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(SR, 24);
  buffer.writeUInt32LE(SR * 4, 28);
  buffer.writeUInt16LE(4, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, left[i])) * 32767), 44 + i * 4);
    buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, right[i])) * 32767), 46 + i * 4);
  }
  writeFileSync(new URL(name, out), buffer);
}

// 고정 시드 난수 (다시 만들어도 같은 소리)
let seed = 7;
const random = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
const noise = () => random() * 2 - 1;

/** RBJ 바이쿼드 필터 */
function biquad(type, freq, q) {
  const w = (2 * Math.PI * freq) / SR;
  const alpha = Math.sin(w) / (2 * q);
  const cos = Math.cos(w);
  let b0, b1, b2;
  if (type === 'band') [b0, b1, b2] = [alpha, 0, -alpha];
  else if (type === 'low') [b0, b1, b2] = [(1 - cos) / 2, 1 - cos, (1 - cos) / 2];
  else [b0, b1, b2] = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
  const a0 = 1 + alpha;
  const a1 = -2 * cos;
  const a2 = 1 - alpha;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x) => {
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  };
}

// ── 음악 ──
/** src/timeline.ts 의 SPEED 와 같은 값. 장면 시각(설계 초) ÷ SPEED = 실제 초 */
const SPEED = 0.9;
const LENGTH = 78 / SPEED;
const mix = S.createMix(LENGTH);
const { put, putSt, drums, music, fx } = mix;
S.reseed(23);

const BEAT = 60 / 135, BAR = BEAT * 4, S16 = BEAT / 4;
const at = (bar, step = 0) => bar * BAR + step * S16;
/** 신스 베이스 음량 (3판 평가에서 줄여 달라고 해 처음 견본보다 약 5dB 낮다) */
const BASS = 0.2;

// 화면 사건 (실제 초 = 장면 시작 + 장면 안 설계 프레임 ÷ 30 ÷ SPEED)
const EV = {
  words: 0.59, ask: 4.89, ask2: 5.56,
  logo: 14.4 / SPEED, tagline: 17.78, taps: [23.33, 24.0, 24.67, 25.33],
  record: 24 / SPEED, now: 33.6 / SPEED, exchange: 42 / SPEED, insight: 57.6 / SPEED, statement: 67.2 / SPEED, end: 72 / SPEED,
};
const stops = [];

const pick = (list) => list[Math.floor(S.random() * list.length)];
const KICK = [S.machineKick()];
const SNARE = [S.machineSnare(), S.machineSnare()];
const HANDS = [1150, 1300, 1450, 1250].map((c) => S.handclap(c));
const HAT = [S.softHat(0.022), S.softHat(0.025), S.softHat(0.02)];
const TAMB = [S.tambourine(), S.tambourine()];
const RIM = [S.rim()];
const SCRATCH = [S.guitarScratch(), S.guitarScratch()];

const hit = {
  kick: (t, g = 1) => { put(drums, t, KICK[0], 0.7 * g, 0, 0.02); mix.kicks.push(t); },
  snare: (t, g = 1) => { put(drums, t, pick(SNARE), 0.3 * g, 0.05, 0.28); for (let k = 0; k < 2; k++) put(drums, t + S.random() * 0.006, pick(HANDS), 0.16 * g, k ? 0.35 : -0.35, 0.25); },
  claps: (t, g = 1) => { for (let k = 0; k < 3; k++) put(drums, t + (S.random() - 0.3) * 0.01, pick(HANDS), 0.18 * g, (k - 1) * 0.45, 0.3); },
  hat: (t, g = 1) => put(drums, t + (S.random() - 0.5) * 0.004, pick(HAT), 0.1 * g * (0.8 + S.random() * 0.2), 0.25, 0.03),
  tamb: (t, g = 1) => put(drums, t + (S.random() - 0.5) * 0.004, pick(TAMB), 0.07 * g, 0.45, 0.06),
  rim: (t, g = 1) => put(drums, t, RIM[0], 0.1 * g, 0.15, 0.1),
  boom: (t, m, g = 1, len = 1.2) => put(fx, t, S.subBoom(m, len), 0.4 * g, 0, 0.05),
  swell: (t0, t1, g = 0.05) => put(fx, t0, S.reverseSwell(t1 - t0), g, 0, 0.3),
};
const bell = (t, m, vel = 0.5, g = 1, pan = 0.2) => put(music, t, S.glassBell(m, vel), 0.13 * g, pan, 0.35, 0.22);

const CH = {
  G: { root: 43, stab: [59, 62, 66, 69], gtr: [55, 59, 62, 66], voices: [59, 62, 66] },
  D: { root: 38, stab: [57, 61, 64, 66], gtr: [57, 62, 66, 69], voices: [57, 62, 66] },
  A: { root: 45, stab: [61, 64, 66, 69], gtr: [57, 61, 64, 69], voices: [57, 61, 64] },
  Bm: { root: 47, stab: [57, 61, 62, 66], gtr: [59, 62, 66, 69], voices: [59, 62, 66] },
  Asus: { root: 45, stab: [62, 64, 67, 69], gtr: [57, 62, 64, 67], voices: [57, 62, 64] },
  Dend: { root: 38, stab: [57, 62, 64, 66, 69], gtr: [57, 62, 66, 69], voices: [57, 62, 66] },
};
const LOOP = ['G', 'D', 'A', 'Bm'];
// 화음 순환은 9·21·27·36마디(로고, 지금 판단, 운영자와 근로자 다음 마디, 예보와 과거 분석)에서 처음부터.
// 한 줄 정리는 G → Asus, 맺음은 처음으로 으뜸화음 D
const LOOP_START = [9, 21, 27, 36];
const chordOf = (bar) => {
  if (bar >= 45) return CH.Dend;
  if (bar === 42) return CH.G;
  if (bar === 43 || bar === 44) return CH.Asus;
  const s = Math.max(...LOOP_START.filter((x) => x <= bar));
  return CH[LOOP[(bar - s) % 4]];
};

const bass = (bar, g = 1, pattern = [0, 2, 4, 6, 8, 10, 12, 14]) => {
  const r = chordOf(bar).root;
  for (const s of pattern) put(music, at(bar, s), S.analogBass(r - 12 + (s % 4 === 2 ? 12 : 0), S16 * 1.3, s % 4 ? 0.7 : 0.95), BASS * g, 0, 0);
};
const guitar = (bar, g = 1, steps = [2, 6, 10, 14]) => {
  for (const s of steps) put(music, at(bar, s), S.guitarChop(chordOf(bar).gtr, S16 * 0.7, 0.75, s % 4 === 2), 0.22 * g, 0.4, 0.08);
  for (const s of [3, 7, 11, 15]) if (S.random() < 0.6) put(music, at(bar, s), pick(SCRATCH), 0.06 * g, 0.4, 0.02);
};
const stab = (t, notes, gate, vel = 0.8, g = 1, cutoff = 1800) => putSt(music, t, S.warmStab(notes, gate, vel, cutoff), 0.16 * g, 0.2, 0.08);
/** 숨 섞인 낮은 "오" 화음: 마디 첫 박에 길게, 셋째 박 엇박에 짧게 부풀었다 사라진다 (높은 목소리 훅은 유치하다는 평으로 뺐다) */
const voices = (bar, g = 1) => {
  for (const m of chordOf(bar).voices) {
    put(music, at(bar), S.vox(m, 6 * S16, 'o', 0.5, 0.35), 0.05 * g, (m - 62) * 0.08, 0.5);
    put(music, at(bar, 10), S.vox(m, 4 * S16, 'o', 0.45, 0.35), 0.04 * g, (62 - m) * 0.08, 0.5);
  }
};
const groove = (bar, { kick = true, g = 1 } = {}) => {
  if (kick) { hit.kick(at(bar, 0), g); hit.kick(at(bar, 8), 0.85 * g); if (bar % 2) hit.kick(at(bar, 10), 0.5 * g); }
  for (const s of [4, 12]) hit.snare(at(bar, s), g);
  for (let s = 0; s < 16; s += 2) hit.hat(at(bar, s), (s % 4 ? 0.9 : 0.5) * g);
  for (let s = 0; s < 16; s++) hit.tamb(at(bar, s), (s % 2 ? 0.9 : 0.35) * g);
};
/** 앱이 말할 때(타이핑·답 도착): 베이스·하이햇·기타만 조용히 */
const recede = (bar) => {
  bass(bar, 0.7, [0, 8]);
  for (let s = 2; s < 16; s += 4) hit.hat(at(bar, s), 0.6);
  guitar(bar, 0.55, [6, 14]);
};
/** 장 제목: 직전 한 박을 비우고 한 방 */
const chapter = (t, c, stopFrom = t - BEAT) => {
  stops.push([stopFrom, t]);
  hit.boom(t, c.root - 12, 0.55, 0.9);
  stab(t, c.stab, 0.6, 1, 1.1, 2600);
};

// ── 여는 말 (0~8.9초): 숨소리 같은 "우" 화음과 유리 벨이 글자에 답한다 ──
put(music, EV.words, S.vox(62, 2.6, 'u', 0.5, 0.3), 0.08, -0.3, 0.5);
put(music, EV.words, S.vox(66, 2.6, 'u', 0.5, 0.3), 0.07, 0.3, 0.5);
bell(EV.words, 86, 0.35);
[[at(0, 12), 78], [at(1, 0), 81], [at(1, 4), 83]].forEach(([t, m], k) => bell(t, m, 0.45 - k * 0.04));
for (let k = 0; k < 13; k++) put(music, EV.ask + k * 2 * S16, S.analogBass(35, S16 * 1.2, 0.35 + k * 0.03), BASS * 0.85, 0, 0);
stab(EV.ask2, CH.G.stab, 0.9, 0.9, 1.1, 2400);
bell(EV.ask2, 78, 0.5);
put(music, EV.ask2, S.vox(74, 0.6, 'a', 0.6), 0.1, 0, 0.45, 0.2);

// ── 문제 (8.9~16초): 조용한 시계 소리, 세 줄마다 한 방씩 세게, 로고 직전 한 박 멈춤 ──
for (let t = at(5); t < at(8, 12) - 0.01; t += 2 * S16) hit.rim(t, 0.3 + 0.35 * ((t - at(5)) / (at(8, 12) - at(5))));
[[at(5), CH.Bm, 0.6], [at(6, 6), CH.A, 0.75], [at(7, 12), CH.G, 0.9]].forEach(([t, c, v], k) => {
  hit.kick(t, v);
  stab(t, c.stab, 0.5, v, 1, 1500 + k * 400);
  put(music, t, S.analogBass(c.root - 12, 0.5, v), BASS * 0.85, 0, 0);
  if (k > 0) hit.claps(t, v);
  if (k === 2) bell(t, 81, 0.45);
});
for (let s = 4; s < 12; s++) hit.tamb(at(8, s), 0.5 + s * 0.08);
hit.swell(at(8), EV.logo, 0.05);
stops.push([at(8, 12), EV.logo]);

// ── 로고와 앱 전체 (16~26.7초): 밝은 화음과 목소리로 열고, 킥 없이 반쯤 → 앱이 올라오면 전부 ──
stab(EV.logo, [55, 59, 62, 66, 69, 74], 1.4, 1, 1.1, 3000);
for (const m of [62, 66, 71]) put(music, EV.logo, S.vox(m, 1.6, 'a', 0.55, 0.2), 0.06, (m - 66) * 0.08, 0.5);
bell(EV.logo, 78, 0.55); bell(EV.logo + 2 * S16, 81, 0.45); bell(EV.tagline, 86, 0.35);
hit.boom(EV.logo, 31, 0.8, 1.6);
for (let bar = 9; bar < 12; bar++) {
  bass(bar, 0.8, [0, 6, 8, 14]);
  for (const s of [4, 12]) hit.claps(at(bar, s), 0.7);
  for (let s = 2; s < 16; s += 4) hit.hat(at(bar, s), 0.7);
  guitar(bar, 0.8);
  if (bar === 11) voices(bar, 0.7);
}
for (let bar = 12; bar < 15; bar++) { groove(bar, { g: bar === 12 ? 0.85 : 1 }); bass(bar); guitar(bar); voices(bar); }
EV.taps.forEach((t, k) => bell(t, [74, 78, 81, 86][k], 0.5 + k * 0.05, 1.1));

// ── 말하면 기록 (26.7~37.3초) ──
chapter(EV.record, chordOf(15));
groove(15); bass(15); guitar(15); voices(15);
recede(16); recede(17);
bell(at(17, 10), 81, 0.45); // 답 도착
for (let bar = 18; bar < 21; bar++) { groove(bar, { g: 0.9 }); bass(bar); guitar(bar, 0.9); if (bar > 18) voices(bar, 0.9); }
bell(at(19, 14), 86, 0.4); // 기록 시작 알림

// ── 지금 판단 (37.3~46.7초) ──
chapter(EV.now, chordOf(21));
groove(21); bass(21); guitar(21); voices(21);
recede(22); recede(23);
bell(at(23, 7), 81, 0.45); // 답 도착
for (let bar = 24; bar < 26; bar++) { groove(bar); bass(bar); guitar(bar); voices(bar); }

// ── 운영자와 근로자 (46.7~64초): 킥을 빼고 가볍게. 칩이 도착할 때마다 벨, 끝에서 다시 쌓는다 ──
chapter(EV.exchange, CH.G, at(26));
for (let bar = 27; bar < 34; bar++) {
  bass(bar, 0.75, [0, 6, 8, 14]);
  for (let s = 2; s < 16; s += 4) hit.hat(at(bar, s), 0.6);
  if (bar >= 29) for (const s of [4, 12]) hit.claps(at(bar, s), 0.55);
  guitar(bar, 0.6, [6, 14]);
  if (bar >= 31) voices(bar, 0.55);
}
[[at(28, 12), 78], [at(31, 7), 81], [at(34, 9), 86]].forEach(([t, m]) => bell(t, m, 0.5));
groove(34, { g: 0.8 }); bass(34); guitar(34, 0.8); voices(34, 0.7);
groove(35); bass(35); guitar(35); voices(35);
for (let s = 8; s < 12; s++) hit.tamb(at(35, s), 0.6 + s * 0.05);
hit.swell(at(35), EV.insight, 0.04);

// ── 예보와 과거 분석 (64~74.7초): 가장 꽉 찬 구간. 타이핑 마디만 목소리 화음을 쉰다 ──
chapter(EV.insight, chordOf(36), at(35, 12));
bell(EV.insight, 86, 0.45);
for (let bar = 36; bar < 42; bar++) {
  groove(bar); bass(bar); guitar(bar);
  if (bar !== 37 && bar !== 39) voices(bar);
  if (bar % 2 === 0) bell(at(bar, 14), 90, 0.25, 0.8, -0.3);
}
bell(at(37, 12), 81, 0.45); bell(at(40, 2), 83, 0.45); // 답 도착 두 번

// ── 한 줄 정리 (74.7~80초): 한 번 치고 비운다. 글자마다 벨, 끝에서 다시 쌓고 한 박 멈춤 ──
hit.kick(EV.statement); hit.boom(EV.statement, 31, 0.6, 1.2);
stab(EV.statement, CH.G.stab, 0.5, 1, 1.1, 2600);
for (const [bar, m] of [[42, 62], [42, 66], [43, 64], [43, 69]]) put(music, at(bar), S.vox(m, BAR * 0.95, 'u', 0.45, 0.3), 0.07, (m - 65) * 0.08, 0.5);
bell(at(42, 4), 78, 0.5); bell(at(42, 14), 81, 0.5);
for (let s = 0; s < 14; s += 2) put(music, at(44, s), S.analogBass(33, S16 * 1.2, 0.4 + s * 0.03), BASS * 0.85, 0, 0);
for (let s = 8; s < 14; s++) hit.tamb(at(44, s), 0.4 + s * 0.05);
hit.swell(at(44), EV.end, 0.05);
stops.push([at(44, 14), EV.end]);

// ── 맺음 (80초~): 처음으로 으뜸화음. 두 마디 그루브와 목소리 화음, 마지막 한 방 뒤 울림만 ──
stab(EV.end, [50, 57, 62, 64, 66, 69, 74], 1.6, 1, 1.15, 3200);
for (const m of [62, 66, 69]) put(music, EV.end, S.vox(m, 1.6, 'a', 0.55, 0.2), 0.06, (m - 66) * 0.08, 0.5);
bell(EV.end, 78, 0.55); bell(EV.end + 2 * S16, 81, 0.45);
hit.boom(EV.end, 26, 0.85, 1.6);
for (const bar of [45, 46]) { groove(bar, { g: 0.9 }); bass(bar); guitar(bar); voices(bar); }
bell(at(46), 86, 0.4); // 맺음 문구
hit.kick(at(47)); hit.boom(at(47), 26, 0.7, 2);
stab(at(47), CH.Dend.stab, 1.2, 0.95, 1.1, 2800);
for (const m of [62, 66, 69, 74]) put(music, at(47), S.vox(m, 2.2, 'u', 0.5, 0.25), 0.05, (m - 68) * 0.08, 0.55);
bell(at(47), 86, 0.5); bell(at(47, 2), 90, 0.35);

writeWav('music.wav', ...mix.render({ duck: 0.18, room: 0.68, revGain: 0.8, delay: BEAT * 0.75, dlyGain: 0.25, thr: -14, ratio: 2, drive: 1.05, stops, fadeOut: 2 }));

// ── 효과음 ──
function make(length, fn) {
  const values = new Float32Array(Math.round(length * SR));
  for (let i = 0; i < values.length; i++) values[i] = fn(i / SR, i);
  let max = 0;
  for (const v of values) max = Math.max(max, Math.abs(v));
  for (let i = 0; i < values.length; i++) values[i] *= 0.8 / max;
  return values;
}

{
  const band = biquad('band', 2800, 1.2);
  writeWav('click.wav', make(0.09, (t) => band(noise()) * Math.exp(-t / 0.006) * 1.5 + Math.sin(2 * Math.PI * 1700 * t) * Math.exp(-t / 0.012) * 0.5 + Math.sin(2 * Math.PI * 170 * t) * Math.exp(-t / 0.02) * 0.4));
}
{
  const high = biquad('high', 3500, 0.8);
  writeWav('key.wav', make(0.05, (t) => high(noise()) * Math.exp(-t / 0.005) + Math.sin(2 * Math.PI * 2400 * t) * Math.exp(-t / 0.004) * 0.3));
}
{
  const length = 0.75;
  let band = biquad('band', 400, 1.4);
  writeWav('whoosh.wav', make(length, (t, i) => {
    const p = t / length;
    if (i % 64 === 0) band = biquad('band', 300 + 2600 * Math.sin(Math.PI * p) ** 1.5, 1.4);
    return band(noise()) * Math.sin(Math.PI * p) ** 2;
  }));
}
{
  let phase = 0;
  writeWav('send.wav', make(0.2, (t) => {
    phase += (2 * Math.PI * (520 + 900 * (t / 0.2))) / SR;
    return Math.sin(phase) * Math.exp(-t / 0.05) * Math.min(1, t / 0.003);
  }));
}
{
  const tone = (t, f) => (t < 0 ? 0 : (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(2 * Math.PI * f * 2 * t)) * Math.exp(-t / 0.35) * Math.min(1, t / 0.004));
  writeWav('chime.wav', make(1, (t) => tone(t, 1318.5) * 0.8 + tone(t - 0.09, 1975.5)));
}
{
  const low = biquad('low', 900, 0.7);
  writeWav('tap.wav', make(0.07, (t) => low(noise()) * Math.exp(-t / 0.01) + Math.sin(2 * Math.PI * 820 * t) * Math.exp(-t / 0.015) * 0.6));
}
{
  // 타이핑 소리 3초 (길이는 영상에서 자른다)
  const length = 3;
  const values = new Float32Array(length * SR);
  const high = biquad('high', 3000, 0.8);
  for (let t = 0.02; t < length - 0.05; t += 0.055 + random() * 0.05) {
    const start = Math.round(t * SR);
    const pitch = 1900 + random() * 900;
    const gain = 0.55 + random() * 0.45;
    for (let i = 0; i < 0.03 * SR; i++) {
      const u = i / SR;
      values[start + i] += gain * (high(noise()) * Math.exp(-u / 0.004) + Math.sin(2 * Math.PI * pitch * u) * Math.exp(-u / 0.003) * 0.3);
    }
  }
  let max = 0;
  for (const v of values) max = Math.max(max, Math.abs(v));
  for (let i = 0; i < values.length; i++) values[i] *= 0.8 / max;
  writeWav('typing.wav', values);
}
{
  const tone = (t, f) => (t < 0 ? 0 : Math.sin(2 * Math.PI * f * t) * Math.exp(-t / 0.12) * Math.min(1, t / 0.003));
  writeWav('receive.wav', make(0.5, (t) => tone(t, 880) * 0.7 + tone(t - 0.07, 1174.7)));
}
console.log('written: music, click, key, whoosh, send, chime, tap, typing, receive');
