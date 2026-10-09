// 저장소 README 이미지를 뽑는다 (번들 한 번) → out/readme/*.png
//   node scripts/readme-images.mjs
// 운영자·근로자 장면은 영상의 한 프레임(안내 칩이 베트남어로 바뀌며 날아가는 때)을 그대로 쓴다.
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const out = path.join(root, 'out/readme');
mkdirSync(out, { recursive: true });
const serveUrl = await bundle({ entryPoint: path.join(root, 'src/index.ts') });
const jobs = [
  ['ReadmeHero', 0, 'hero.png'],
  ['ReadmeNow', 0, 'now.png'],
  ['ReadmeHistory', 0, 'history.png'],
  // 설계 프레임 1260 + 108 을 0.9배 속도로 → 실제 1520
  ['HaepungIntro', 1520, 'exchange.png'],
];
for (const [id, frame, file] of jobs) {
  const composition = await selectComposition({ serveUrl, id });
  await renderStill({ serveUrl, composition, frame, output: path.join(out, file) });
  console.log(path.join(out, file));
}
