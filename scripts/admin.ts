import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import {
  emptyWorkspaceDocument,
  openWorkspaceStore,
  passwordHash,
  validWorkspaceDocument,
} from '../server/workspace.ts';
import { isStrongPassword } from '../src/lib/workspace.ts';

// 운영자용 관리 명령. 서버와 같은 저장소(잠금·schema 확인·저장 전 검증)를 거치므로
// 서버가 켜져 있어도 된다.
//   DATABASE_PATH=/srv/haepung/db/haepung.db node scripts/admin.ts <명령>

const USAGE = `사용법: DATABASE_PATH=<db> node scripts/admin.ts <명령>
  users                          계정 목록 (id, 이름, 이메일, 소속 덕장과 역할)
  reset-password <email>         임시 비밀번호를 만들어 한 번만 보여 준다
  import-json <path> [--force]   workspace.json 가져오기 (DB 가 비어 있을 때만, --force 면 덮어쓴다)
  export-json <path>             workspace 문서를 새 JSON 파일로 내보낸다`;

async function main([command, ...args]: string[]): Promise<string> {
  const databasePath = process.env.DATABASE_PATH?.trim();
  if (!databasePath) throw new Error(`DATABASE_PATH 를 지정해 주세요.\n${USAGE}`);
  const store = openWorkspaceStore({ databasePath });
  const force = args.includes('--force');
  const [target] = args.filter((arg) => arg !== '--force');

  if (command === 'users') {
    return store.read(
      (doc) =>
        doc.users
          .map((user) => {
            const sites = doc.memberships
              .filter((m) => m.userId === user.id)
              .map(
                (m) => `${doc.sites.find((s) => s.id === m.siteId)?.name}(${m.siteId}):${m.role}`,
              );
            return [user.id, user.name, user.email, sites.join(', ') || '-'].join('\t');
          })
          .join('\n') || '(계정 없음)',
    );
  }
  if (command === 'reset-password' && target) {
    const email = target.trim().toLowerCase();
    // 새 비밀번호 규칙(문자·숫자 포함)에 맞을 때까지 다시 뽑는다. 16자에 숫자가 없을 때가 약 7% 있다.
    let password = '';
    while (!isStrongPassword(password)) password = randomBytes(12).toString('base64url');
    const salt = randomBytes(16).toString('hex');
    const derived = await passwordHash(password, salt);
    await store.write((doc) => {
      const user = doc.users.find((u) => u.email === email);
      if (!user) throw new Error(`계정을 찾을 수 없어요: ${email}`);
      user.salt = salt;
      user.passwordHash = derived;
      // 탈취가 의심돼 바꾸는 경우도 있으므로 기존 로그인도 끊는다.
      doc.sessions = doc.sessions.filter((s) => s.userId !== user.id);
    });
    return `${email} 임시 비밀번호 (다시 볼 수 없어요): ${password}`;
  }
  if (command === 'import-json' && target) {
    const parsed: unknown = JSON.parse(await readFile(target, 'utf8'));
    if (!validWorkspaceDocument(parsed))
      throw new Error(`workspace 문서 형식이 아니에요: ${target}`);
    await store.write((doc) => {
      if (!force && !isDeepStrictEqual(doc, emptyWorkspaceDocument()))
        throw new Error('DB 에 이미 workspace 자료가 있어요. 덮어쓰려면 --force 를 붙이세요.');
      for (const name of Object.keys(doc)) delete (doc as Record<string, unknown>)[name];
      Object.assign(doc, parsed);
    });
    return `가져옴: 계정 ${parsed.users.length}, 덕장 ${parsed.sites.length}`;
  }
  if (command === 'export-json' && target) {
    const doc = await store.read((current) => current);
    // 비밀번호 해시가 들어 있으므로 새 파일만, 본인만 읽게 만든다.
    await writeFile(target, JSON.stringify(doc), { flag: 'wx', mode: 0o600 });
    return `내보냄: ${target}`;
  }
  throw new Error(USAGE);
}

try {
  console.log(await main(process.argv.slice(2)));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
