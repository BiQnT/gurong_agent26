// 확인용 정지 화면 여러 장을 한 번에 뽑는다 (번들 한 번).
//   node scripts/stills.mjs 120 480 900 ...   → out/stills/f00120.png ...
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const frames = process.argv.slice(2).map(Number);
const scale = Number(process.env.SCALE ?? 0.5);
mkdirSync(path.join(root, 'out/stills'), { recursive: true });
const serveUrl = await bundle({ entryPoint: path.join(root, 'src/index.ts') });
const composition = await selectComposition({ serveUrl, id: 'HaepungIntro' });
for (const frame of frames) {
  const output = path.join(root, `out/stills/f${String(frame).padStart(5, '0')}.png`);
  await renderStill({ serveUrl, composition, frame, output, scale });
  console.log(output);
}
