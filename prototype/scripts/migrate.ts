// npm run db:migrate — DATABASE_PATH(기본 .data/gwamegi.db)에 마이그레이션을 적용한다.
// systemd 유닛의 ExecStartPre 에서도 이 스크립트를 부른다.
import { getConfig } from '../src/config.ts';
import { migrate, openDb } from '../src/db/index.ts';

const config = getConfig();
const db = openDb(config.databasePath);
const applied = migrate(db, config.migrationsDir);
db.close();
console.log(applied.length ? `적용: ${applied.join(', ')}` : '적용할 마이그레이션 없음', `(${config.databasePath})`);
