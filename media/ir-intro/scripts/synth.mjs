// 3판 음악의 악기와 섞기 (외부 음원 없이 직접 합성). 악보는 make-audio.mjs.

export const SR = 44100;

const hz = (m) => 440 * 2 ** ((m - 69) / 12);

let seed = 11;

export const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0), seed / 4294967296);

const noise = () => random() * 2 - 1;

export const reseed = (s) => { seed = s; };

function svf(type) {
  let ic1 = 0, ic2 = 0;
  return (x, cutoff, q = 0.707) => {
    const g = Math.tan((Math.PI * Math.min(cutoff, SR * 0.45)) / SR);
    const k = 1 / q;
    const a1 = 1 / (1 + g * (g + k));
    const a2 = g * a1;
    const a3 = g * a2;
    const v3 = x - ic2;
    const v1 = a1 * ic1 + a2 * v3;
    const v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1;
    ic2 = 2 * v2 - ic2;
    if (type === 'low') return v2;
    if (type === 'band') return v1 * k;
    return x - k * v1 - v2;
  };
}

const blep = (t, dt) => {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
};

function saw(f) {
  let ph = random();
  const dt = f / SR;
  return () => { ph += dt; if (ph >= 1) ph -= 1; return 2 * ph - 1 - blep(ph, dt); };
}

function square(f) {
  let ph = random();
  const dt = f / SR;
  return () => {
    ph += dt; if (ph >= 1) ph -= 1;
    return (ph < 0.5 ? 1 : -1) + blep(ph, dt) - blep((ph + 0.5) % 1, dt);
  };
}

const buf = (sec) => new Float32Array(Math.max(1, Math.round(sec * SR)));

const norm = (v, to = 1) => {
  let m = 0;
  for (const x of v) m = Math.max(m, Math.abs(x));
  if (m > 0) for (let i = 0; i < v.length; i++) v[i] *= to / m;
  return v;
};


/** 사람 손뼉 한 번 (여럿이 치는 박수는 이것을 몇 개 겹친다) */
export function handclap(center = 1300) {
  const v = buf(0.25);
  const bp = svf('band'), lp = svf('low');
  for (let i = 0; i < v.length; i++) {
    const t = i / SR;
    const env = Math.exp(-t / 0.018) + 0.25 * Math.exp(-t / 0.07);
    v[i] = lp(bp(noise(), center, 1.6), 6000) * env * Math.min(1, t / 0.0008);
  }
  return norm(v);
}

/** 어두운 하이햇 (금속성 줄이고 고역을 덜어 냄) */
export function softHat(decay = 0.03) {
  const v = buf(decay * 7 + 0.01);
  const hp = svf('high'), lp = svf('low');
  for (let i = 0; i < v.length; i++) {
    const t = i / SR;
    v[i] = lp(hp(noise(), 5500, 0.7), 10500, 0.7) * Math.exp(-t / decay) * Math.min(1, t / 0.0008);
  }
  return norm(v);
}

export function tambourine() {
  const v = buf(0.3);
  const bp = svf('band'), hp = svf('high');
  for (let i = 0; i < v.length; i++) {
    const t = i / SR;
    let env = 0;
    for (const o of [0, 0.012, 0.03]) if (t >= o) env = Math.max(env, Math.exp(-(t - o) / 0.05));
    v[i] = hp(bp(noise(), 8500, 2), 5000) * env;
  }
  return norm(v);
}

export function rim() {
  const v = buf(0.12);
  const bp = svf('band');
  for (let i = 0; i < v.length; i++) {
    const t = i / SR;
    v[i] = (Math.sin(2 * Math.PI * 1650 * t) * 0.6 + bp(noise(), 3200, 3) * 0.6) * Math.exp(-t / 0.012);
  }
  return norm(v);
}

/** 깊은 저음 한 방 (위에서 미끄러져 내려온다) */
export function subBoom(m, len = 1.2, glide = 12) {
  const v = buf(len + 0.1);
  let ph = 0;
  for (let i = 0; i < v.length; i++) {
    const t = i / SR;
    ph += (2 * Math.PI * hz(m + glide * Math.exp(-t / 0.04))) / SR;
    const amp = Math.min(1, t / 0.004) * Math.exp(-t / (len * 0.45));
    v[i] = Math.tanh(Math.sin(ph) * 1.6) * amp;
  }
  return norm(v);
}

export function reverseSwell(sec) {
  const v = buf(sec);
  const hp = svf('high');
  for (let i = 0; i < v.length; i++) v[i] = hp(noise(), 4500) * (i / v.length) ** 3;
  return norm(v);
}


/** 카플러스-스트롱 줄 뜯기 (기타) */
function pluckString(m, vel = 0.8, len = 1.2, bright = 0.5, sustain = 0.996) {
  const f = hz(m);
  const P = Math.max(2, Math.round(SR / f));
  const line = new Float32Array(P);
  let lpState = 0;
  for (let i = 0; i < P; i++) {
    lpState = lpState + bright * (noise() - lpState);
    line[i] = lpState;
  }
  const v = buf(len);
  let idx = 0, prev = 0;
  for (let i = 0; i < v.length; i++) {
    const cur = line[idx];
    const next = sustain * (0.5 * (cur + prev));
    prev = cur;
    line[idx] = next;
    idx = (idx + 1) % P;
    v[i] = cur;
  }
  const fadeN = Math.round(0.01 * SR);
  for (let i = v.length - fadeN; i < v.length; i++) v[i] *= (v.length - i) / fadeN;
  return norm(v, vel);
}

/** 옛 드럼머신 킥: 짧고 단단하게 */
export function machineKick() {
  const v = buf(0.45);
  const hp = svf('high');
  let ph = 0;
  for (let i = 0; i < v.length; i++) {
    const t = i / SR;
    ph += (2 * Math.PI * (52 + 90 * Math.exp(-t / 0.018))) / SR;
    v[i] = Math.tanh((Math.sin(ph) * Math.exp(-t / 0.14) + hp(noise(), 3000) * Math.exp(-t / 0.002) * 0.3) * 2);
  }
  return norm(v);
}

/** 옛 드럼머신 스네어: 짧은 몸통 + 잡음, 방 울림은 잔향 보내기로 */
export function machineSnare() {
  const v = buf(0.35);
  const bp = svf('band'), hp = svf('high');
  for (let i = 0; i < v.length; i++) {
    const t = i / SR;
    const body = (Math.sin(2 * Math.PI * 205 * t) + 0.4 * Math.sin(2 * Math.PI * 340 * t)) * Math.exp(-t / 0.04);
    v[i] = body * 0.6 + hp(bp(noise(), 3500, 0.6), 900) * Math.exp(-t / 0.09);
  }
  return norm(v);
}

/** 아날로그 신스 베이스: 톱니파 + 한 옥타브 아래 사각파, 공명 저역 통과를 짧게 열었다 닫는다 */
export function analogBass(m, gate, vel = 0.9) {
  const v = buf(gate + 0.12);
  const f = hz(m);
  const a = saw(f), b = square(f / 2), lp = svf('low');
  for (let i = 0; i < v.length; i++) {
    const t = i / SR;
    const amp = (t < gate ? 1 : Math.exp(-(t - gate) / 0.025)) * Math.min(1, t / 0.002);
    const cut = 160 + 1300 * vel * Math.exp(-t / 0.09);
    v[i] = Math.tanh(lp(a() * 0.7 + b() * 0.5, cut, 1.8) * 1.6) * amp;
  }
  return norm(v, vel);
}

/** 뮤트 기타 화음 한 번 (줄을 몇 ms 씩 어긋나게 뜯는다). down=false 면 위에서 아래로 */
export function guitarChop(notes, gate = 0.12, vel = 0.7, down = true) {
  const order = down ? notes : [...notes].reverse();
  const len = gate + 0.12;
  const v = buf(len + 0.05);
  order.forEach((m, k) => {
    const s = pluckString(m, 1, len, 0.75, 0.985);
    const off = Math.round(k * 0.009 * SR);
    for (let i = 0; i < s.length && off + i < v.length; i++) {
      const t = i / SR;
      v[off + i] += s[i] * (t < gate ? 1 : Math.exp(-(t - gate) / 0.015));
    }
  });
  const lp = svf('low');
  for (let i = 0; i < v.length; i++) v[i] = lp(v[i], 3800, 0.8);
  return norm(v, vel);
}

/** 기타 줄을 손으로 막고 긁는 소리 (치크) */
export function guitarScratch(vel = 0.5) {
  const v = buf(0.06);
  const bp = svf('band');
  for (let i = 0; i < v.length; i++) {
    const t = i / SR;
    v[i] = bp(noise(), 1800, 1.4) * Math.exp(-t / 0.012);
  }
  return norm(v, vel);
}

const VOWEL = {
  a: [[800, 1], [1150, 0.5], [2900, 0.25]],
  o: [[450, 1], [800, 0.5], [2830, 0.15]],
  u: [[325, 1], [700, 0.25], [2530, 0.08]],
  e: [[400, 1], [1600, 0.4], [2700, 0.25]],
};

/** 목소리 한 음: 성대 소리(톱니파+숨) 를 모음 공명 셋에 통과시킨다 */
export function vox(m, gate, vowel = 'a', vel = 0.7, breath = 0.15) {
  const v = buf(gate + 0.15);
  const f = hz(m);
  let ph = random();
  const filters = VOWEL[vowel].map(([fc, g]) => ({ f: svf('band'), fc, g }));
  for (let i = 0; i < v.length; i++) {
    const t = i / SR;
    const vib = 1 + 0.006 * Math.sin(2 * Math.PI * 5.2 * t) * Math.min(1, t / 0.2);
    ph += (f * vib) / SR;
    if (ph >= 1) ph -= 1;
    const src = (2 * ph - 1) * 0.8 + noise() * breath;
    let s = 0;
    for (const x of filters) s += x.f(src, x.fc, x.fc / 90) * x.g;
    const amp = (t < gate ? 1 : Math.exp(-(t - gate) / 0.06)) * Math.min(1, t / 0.012);
    v[i] = s * amp;
  }
  return norm(v, vel);
}

/** 유리 같은 FM 벨 */
export function glassBell(m, vel = 0.6, len = 2.2) {
  const v = buf(len);
  const f = hz(m);
  for (let i = 0; i < v.length; i++) {
    const t = i / SR;
    const idx = 2.2 * vel * Math.exp(-t / 0.25);
    const mod = Math.sin(2 * Math.PI * f * 3.5 * t) * idx;
    v[i] = Math.sin(2 * Math.PI * f * t + mod) * Math.exp(-t / (len * 0.35)) * Math.min(1, t / 0.001)
      + 0.15 * Math.sin(2 * Math.PI * f * 2 * t) * Math.exp(-t / 0.4);
  }
  return norm(v, vel);
}

/** 따뜻한 화음: 음마다 톱니파 둘(조금만 어긋나게), 저역 통과 */
export function warmStab(notes, gate, vel = 0.8, cutoff = 1800) {
  const L = buf(gate + 0.4), R = buf(gate + 0.4);
  const vl = notes.map((m) => saw(hz(m) * 1.0025)), vr = notes.map((m) => saw(hz(m) * 0.9975));
  const fl = svf('low'), fr = svf('low');
  for (let i = 0; i < L.length; i++) {
    const t = i / SR;
    const amp = (t < gate ? 1 : Math.exp(-(t - gate) / 0.06)) * Math.min(1, t / 0.004);
    const cut = cutoff * (0.6 + 0.8 * vel * Math.exp(-t / 0.08));
    let l = 0, r = 0;
    for (const o of vl) l += o();
    for (const o of vr) r += o();
    L[i] = fl(l, cut, 0.8) * amp;
    R[i] = fr(r, cut, 0.8) * amp;
  }
  const s = 0.8 / Math.sqrt(notes.length);
  for (let i = 0; i < L.length; i++) { L[i] *= s; R[i] *= s; }
  return [L, R];
}

function freeverb(inL, inR, room, damp) {
  const combT = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  const allT = [556, 441, 341, 225];
  const side = (input, spread) => {
    const combs = combT.map((d) => ({ b: new Float32Array(d + spread), i: 0, s: 0 }));
    const alls = allT.map((d) => ({ b: new Float32Array(d + spread), i: 0 }));
    const out = new Float32Array(input.length);
    for (let n = 0; n < input.length; n++) {
      const x = input[n] * 0.015;
      let y = 0;
      for (const c of combs) {
        const o = c.b[c.i];
        c.s = o * (1 - damp) + c.s * damp;
        c.b[c.i] = x + c.s * room;
        c.i = (c.i + 1) % c.b.length;
        y += o;
      }
      for (const a of alls) {
        const o = a.b[a.i];
        a.b[a.i] = y + o * 0.5;
        a.i = (a.i + 1) % a.b.length;
        y = o - y;
      }
      out[n] = y;
    }
    return out;
  };
  return { L: side(inL, 0), R: side(inR, 23) };
}

function pingpong(inL, inR, N, time, fb) {
  const d = Math.round(time * SR);
  const bl = new Float32Array(d), br = new Float32Array(d);
  const L = new Float32Array(N), R = new Float32Array(N);
  const lp = svf('low');
  for (let n = 0, i = 0; n < N; n++, i = (i + 1) % d) {
    const l = bl[i], r = br[i];
    L[n] = l;
    R[n] = r;
    bl[i] = lp((inL[n] + inR[n]) * 0.5 + r * fb, 4000);
    br[i] = l * fb;
  }
  return { L, R };
}

export function createMix(length) {
  const N = Math.ceil(length * SR);
  const bus = () => ({ L: new Float32Array(N), R: new Float32Array(N) });
  const mix = { N, length, drums: bus(), music: bus(), fx: bus(), rev: bus(), dly: bus(), kicks: [] };
  const TAIL = Math.round(0.01 * SR);
  mix.put = (target, t, v, gain, pan = 0, revSend = 0, dlySend = 0) => {
    const start = Math.round(t * SR);
    const l = gain * Math.cos(((pan + 1) * Math.PI) / 4);
    const r = gain * Math.sin(((pan + 1) * Math.PI) / 4);
    for (let i = 0; i < v.length; i++) {
      const n = start + i;
      if (n < 0 || n >= N) continue;
      const x = v[i] * Math.min(1, (v.length - i) / TAIL);
      target.L[n] += x * l;
      target.R[n] += x * r;
      mix.rev.L[n] += x * l * revSend;
      mix.rev.R[n] += x * r * revSend;
      mix.dly.L[n] += x * l * dlySend;
      mix.dly.R[n] += x * r * dlySend;
    }
  };
  mix.putSt = (target, t, [vl, vr], gain, revSend = 0, dlySend = 0) => {
    const start = Math.round(t * SR);
    for (let i = 0; i < vl.length; i++) {
      const n = start + i;
      if (n < 0 || n >= N) continue;
      const k = Math.min(1, (vl.length - i) / TAIL) * gain;
      target.L[n] += vl[i] * k;
      target.R[n] += vr[i] * k;
      mix.rev.L[n] += vl[i] * k * revSend;
      mix.rev.R[n] += vr[i] * k * revSend;
      mix.dly.L[n] += vl[i] * k * dlySend;
      mix.dly.R[n] += vr[i] * k * dlySend;
    }
  };
  /** 버스를 섞어 [L, R] 로 낸다: 킥에 맞춰 music 버스를 살짝 누르고, 잔향·메아리를 더하고, 멈춤 구간을 비우고, 가볍게 압축한다 */
  mix.render = ({ duck = 0, duckRel = 0.1, room = 0.7, damp = 0.45, revGain = 0.8, delay = 0.25, dlyGain = 0.3, fb = 0.3, thr = -12, ratio = 2, drive = 1.1, stops = [], fadeOut = 1 }) => {
    const g = new Float32Array(N).fill(1);
    if (duck > 0)
      for (const t of mix.kicks) {
        const s = Math.round(t * SR);
        for (let i = 0; i < duckRel * 5 * SR && s + i < N; i++) {
          const u = i / SR;
          const d = 1 - duck * Math.min(1, u / 0.004) * Math.exp(-u / duckRel);
          if (d < g[s + i]) g[s + i] = d;
        }
      }
    const wet = freeverb(mix.rev.L, mix.rev.R, room, damp);
    const echo = pingpong(mix.dly.L, mix.dly.R, N, delay, fb);
    const L = new Float32Array(N), R = new Float32Array(N);
    for (let n = 0; n < N; n++) {
      L[n] = mix.drums.L[n] + mix.music.L[n] * g[n] + wet.L[n] * revGain + echo.L[n] * dlyGain;
      R[n] = mix.drums.R[n] + mix.music.R[n] * g[n] + wet.R[n] * revGain + echo.R[n] * dlyGain;
    }
    for (const [a, b] of stops) {
      const s = Math.round(a * SR), e = Math.round(b * SR), f = Math.round(0.015 * SR);
      for (let n = s - f; n < e && n < N; n++) {
        if (n < 0) continue;
        const k = n < s ? (s - n) / f : 0;
        L[n] *= k;
        R[n] *= k;
      }
    }
    let env = 0;
    const att = Math.exp(-1 / (0.006 * SR)), rel = Math.exp(-1 / (0.2 * SR));
    for (let n = 0; n < N; n++) {
      const l = L[n] + mix.fx.L[n], r = R[n] + mix.fx.R[n];
      const x = Math.max(Math.abs(l), Math.abs(r));
      env = x > env ? att * env + (1 - att) * x : rel * env + (1 - rel) * x;
      const over = 20 * Math.log10(env + 1e-9) - thr;
      const gain = over > 0 ? 10 ** ((-over * (1 - 1 / ratio)) / 20) : 1;
      const t = n / SR;
      const fade = Math.min(1, t / 0.05) * Math.min(1, (length - t) / fadeOut);
      L[n] = Math.tanh(l * gain * drive) * fade;
      R[n] = Math.tanh(r * gain * drive) * fade;
    }
    let peak = 0;
    for (let n = 0; n < N; n++) peak = Math.max(peak, Math.abs(L[n]), Math.abs(R[n]));
    for (let n = 0; n < N; n++) { L[n] *= 0.89 / peak; R[n] *= 0.89 / peak; }
    return [L, R];
  };
  return mix;
}
