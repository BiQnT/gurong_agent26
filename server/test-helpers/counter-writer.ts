import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { sqliteDocumentStore } from '../sqlite-store.ts';

// sqlite-store.test.ts 가 자식 프로세스로 띄운다. 준비되면 ready 를 알리고, 부모가 한 줄을 보내면
// 같은 DB 의 counter 문서를 N 번 1씩 올린다. 두 프로세스가 동시에 쓸 때 잃는 쓰기가 없는지 본다.
//   node server/test-helpers/counter-writer.ts <db> <N>

type Counter = { count: number };
const [file, times] = process.argv.slice(2);
const store = sqliteDocumentStore<Counter>(
  file,
  'counter',
  () => ({ count: 0 }),
  (value): value is Counter =>
    !!value && typeof value === 'object' && Number.isSafeInteger((value as Counter).count),
  { schemaVersion: 1 },
);
await store.read(() => undefined);
process.stdout.write('ready\n');
await once(createInterface({ input: process.stdin }), 'line');
for (let index = 0; index < Number(times); index += 1)
  await store.write((doc) => {
    doc.count += 1;
  });
// stdin 을 읽는 중이라 저절로 끝나지 않는다.
process.exit(0);
