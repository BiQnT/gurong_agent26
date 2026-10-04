import Database from 'better-sqlite3';
import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// prod 공유 DB 를 dev 전용 DB 로 복사한다. dev 가 저장 형식을 바꾸는 작업을 할 때 이 복사본을 쓴다.
// SQLite 온라인 백업이라 prod 가 켜져 있어도 한 시점의 일관된 복사본이 나온다.
//   node scripts/copy-prod-to-dev.ts <원본.db> <대상.db> [--force]

const args = process.argv.slice(2);
const force = args.includes('--force');
const [source, target, ...extra] = args.filter((arg) => arg !== '--force');
// 링크로 같은 파일을 가리켜도 같은 DB 로 본다.
const real = (file: string) => (existsSync(file) ? realpathSync(file) : resolve(file));

function check(): string | undefined {
  if (!source || !target || extra.length)
    return '사용법: node scripts/copy-prod-to-dev.ts <원본.db> <대상.db> [--force]';
  if (!existsSync(source)) return `원본 DB 가 없어요: ${source}`;
  if (real(source) === real(target)) return '원본과 대상이 같은 파일이에요. 복사하지 않습니다.';
  // 인자 순서를 바꿔 prod 를 덮어쓰는 실수를 막는다.
  if (existsSync(target) && !force)
    return `대상 DB 가 이미 있어요: ${target}\n덮어쓰려면 --force 를 붙이세요 (순서: <원본> <대상>).`;
}

const problem = check();
if (problem) {
  console.error(problem);
  process.exit(1);
}
mkdirSync(dirname(resolve(target)), { recursive: true });
const db = new Database(source, { readonly: true, fileMustExist: true });
try {
  await db.backup(target);
} finally {
  db.close();
}
console.log(`복사함: ${source} -> ${target}`);
