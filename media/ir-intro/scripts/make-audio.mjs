// 영상 음악과 효과음을 직접 합성해 public/audio/*.wav 로 쓴다 (외부 음원 없음, 저작권 문제 없음).
//   node scripts/make-audio.mjs
// 음악 구성은 src/timeline.ts 의 장면 시각과 맞춘다 (100BPM, 화음 하나 4.8초): 0~14.4초 어두운 도입(패드·성긴 음),
// 14.4초 로고와 함께 본편(아르페지오·부드러운 킥), 67.2~72초 쉼(패드와 성긴 음), 72초 마지막 화음.
import { mkdirSync, writeFileSync } from 'node:fs';

const SR = 44100;
const out = new URL('../public/audio/', import.meta.url);
mkdirSync(out, { recursive: true });

const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

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

/** 슈뢰더 잔향 (빗살 4 + 전역통과 2) */
function reverb(input, offset) {
  const combs = [1557, 1617, 1491, 1422].map((d) => ({ buf: new Float32Array(d + offset), i: 0, low: 0 }));
  const alls = [225, 556].map((d) => ({ buf: new Float32Array(d + offset), i: 0 }));
  const output = new Float32Array(input.length);
  for (let n = 0; n < input.length; n++) {
    let sum = 0;
    for (const c of combs) {
      const y = c.buf[c.i];
      c.low = y * 0.6 + c.low * 0.4;
      c.buf[c.i] = input[n] + c.low * 0.82;
      c.i = (c.i + 1) % c.buf.length;
      sum += y;
    }
    let y = sum / 4;
    for (const a of alls) {
      const b = a.buf[a.i];
      const v = y + b * 0.5;
      a.buf[a.i] = v;
      a.i = (a.i + 1) % a.buf.length;
      y = b - v * 0.5;
    }
    output[n] = y;
  }
  return output;
}

// ── 음악 ──
const LENGTH = 78;
const N = SR * LENGTH;
const dryL = new Float32Array(N);
const dryR = new Float32Array(N);
const sendL = new Float32Array(N);
const sendR = new Float32Array(N);
const MAIN = 14.4;
const BREAK = [67.2, 72];
const BEAT = 0.6;

function add(t, values, gain, pan = 0, send = 0.3) {
  const start = Math.round(t * SR);
  const l = gain * Math.cos(((pan + 1) * Math.PI) / 4);
  const r = gain * Math.sin(((pan + 1) * Math.PI) / 4);
  for (let i = 0; i < values.length && start + i < N; i++) {
    if (start + i < 0) continue;
    dryL[start + i] += values[i] * l;
    dryR[start + i] += values[i] * r;
    sendL[start + i] += values[i] * l * send;
    sendR[start + i] += values[i] * r * send;
  }
}

function pad(midi, duration) {
  const length = Math.round((duration + 2.2) * SR);
  const values = new Float32Array(length);
  const f = hz(midi);
  for (let i = 0; i < length; i++) {
    const t = i / SR;
    const env = Math.min(1, t / 1.4) * (t > duration ? Math.exp(-(t - duration) / 0.7) : 1);
    let v = 0;
    for (let h = 1; h <= 6; h++) v += Math.sin(2 * Math.PI * f * h * t * (1 + 0.0007 * (h % 2 ? 1 : -1))) / h ** 1.7;
    values[i] = v * env * (0.88 + 0.12 * Math.sin(2 * Math.PI * 0.21 * t + midi));
  }
  return values;
}

function pluck(midi, length = 2.4) {
  const values = new Float32Array(Math.round(length * SR));
  const f = hz(midi);
  const partials = [
    [1, 1, 1.1],
    [2, 0.42, 0.6],
    [3, 0.18, 0.35],
    [4, 0.09, 0.22],
  ];
  for (let i = 0; i < values.length; i++) {
    const t = i / SR;
    let v = 0;
    for (const [h, a, d] of partials) v += a * Math.sin(2 * Math.PI * f * h * t * (1 + 0.0004 * h * h)) * Math.exp(-t / d);
    values[i] = v * Math.min(1, t / 0.004);
  }
  return values;
}

function kick() {
  const values = new Float32Array(Math.round(0.45 * SR));
  let phase = 0;
  for (let i = 0; i < values.length; i++) {
    const t = i / SR;
    phase += (2 * Math.PI * (44 + 70 * Math.exp(-t / 0.035))) / SR;
    values[i] = Math.sin(phase) * Math.exp(-t / 0.16);
  }
  return values;
}

function shaker() {
  const values = new Float32Array(Math.round(0.07 * SR));
  const high = biquad('high', 6000, 0.7);
  for (let i = 0; i < values.length; i++) values[i] = high(noise()) * Math.exp(-(i / SR) / 0.018);
  return values;
}

function sub(midi, duration) {
  const length = Math.round((duration + 0.6) * SR);
  const values = new Float32Array(length);
  const f = hz(midi - 12);
  for (let i = 0; i < length; i++) {
    const t = i / SR;
    values[i] = Math.sin(2 * Math.PI * f * t) * Math.min(1, t / 0.25) * (t > duration ? Math.exp(-(t - duration) / 0.25) : 1);
  }
  return values;
}

function riser(duration) {
  const values = new Float32Array(Math.round(duration * SR));
  const band = biquad('band', 1200, 0.8);
  let phase = 0;
  for (let i = 0; i < values.length; i++) {
    const p = i / values.length;
    phase += (2 * Math.PI * (220 + 660 * p * p)) / SR;
    values[i] = (band(noise()) * 0.8 + Math.sin(phase) * 0.15) * p ** 2.2;
  }
  return values;
}

const CHORDS = [
  [50, 57, 61, 64, 66], // Dmaj9
  [47, 54, 57, 61, 62], // Bm9
  [43, 50, 54, 57, 59], // Gmaj9
  [45, 52, 54, 59, 61], // A6/9
];
const SPAN = 4.8;
const ARP = [0, 2, 1, 3, 2, 4, 3, 1];

for (let start = 0, k = 0; start < LENGTH - 4; start += SPAN, k++) {
  const chord = CHORDS[k % 4];
  const inBreak = start >= BREAK[0] - 0.1 && start < BREAK[1];
  const ending = start >= BREAK[1];
  const quiet = start < MAIN - 0.1 || inBreak;
  // 패드 (계속). 도입·쉼은 아르페지오가 없어 패드를 조금 키운다
  for (const [index, note] of chord.entries())
    add(start, pad(note, ending ? LENGTH - start - 3 : SPAN), quiet ? 0.055 : 0.035, index % 2 ? 0.35 : -0.35, 0.5);
  if (ending) break;
  if (quiet) {
    // 도입·쉼: 반박자마다가 아니라 1.2초에 한 음, 높은 음역
    for (let b = 0; b < SPAN / 1.2; b++) {
      const note = chord[ARP[(b + k) % ARP.length]] + 24;
      add(start + b * 1.2 + 0.3, pluck(note, 2.6), 0.08, b % 2 ? 0.4 : -0.4, 0.6);
    }
    continue;
  }
  // 본편: 8분음표 아르페지오, 1·3박 킥, 엇박 셰이커, 베이스
  add(start, sub(chord[0], SPAN), 0.16, 0, 0.05);
  for (let s = 0; s < SPAN / (BEAT / 2); s++) {
    const t = start + s * (BEAT / 2);
    const note = chord[ARP[s % ARP.length]] + 12;
    add(t, pluck(note, 1.4), s % 4 === 0 ? 0.06 : 0.042, s % 2 ? 0.45 : -0.45, 0.35);
    if (s % 4 === 0) add(t, kick(), 0.38, 0, 0.02);
    if (s % 2 === 1) add(t, shaker(), 0.022, s % 4 === 1 ? 0.3 : -0.3, 0.1);
  }
}
// 로고가 뜰 때의 첫 박과 그 앞의 상승음, 마지막 화음
add(MAIN - 2.4, riser(2.4), 0.09, 0, 0.4);
for (const note of CHORDS[0]) add(MAIN, pluck(note + 12, 3), 0.07, 0, 0.6);
add(MAIN, kick(), 0.5, 0, 0.05);
add(MAIN, sub(50, 2.4), 0.2, 0, 0);
add(BREAK[1] - 2, riser(2), 0.06, 0, 0.4);
for (const note of CHORDS[0]) add(BREAK[1], pluck(note + 12, 4.5), 0.08, 0, 0.7);
add(BREAK[1], sub(50, 4), 0.2, 0, 0);

const wetL = reverb(sendL, 0);
const wetR = reverb(sendR, 23);
const musicL = new Float32Array(N);
const musicR = new Float32Array(N);
let peak = 0;
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const fade = Math.min(1, t / 0.4) * Math.min(1, (LENGTH - t) / 3.5);
  musicL[i] = Math.tanh((dryL[i] + wetL[i] * 0.9) * 1.4) * fade;
  musicR[i] = Math.tanh((dryR[i] + wetR[i] * 0.9) * 1.4) * fade;
  peak = Math.max(peak, Math.abs(musicL[i]), Math.abs(musicR[i]));
}
for (let i = 0; i < N; i++) {
  musicL[i] *= 0.85 / peak;
  musicR[i] *= 0.85 / peak;
}
writeWav('music.wav', musicL, musicR);

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
