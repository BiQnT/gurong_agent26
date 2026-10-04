import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import test, { after } from 'node:test';
import {
  buildClaudeArgs,
  buildPrompt,
  ClaudeCliError,
  claudeEnv,
  createClaudeAgent,
  readClaudeResult,
  type ClaudeConfig,
  type ClaudeFailure,
} from './claude-cli.ts';
import { cleanupFakes, makeFakeClaude, readFixture } from './fixtures/fake-claude.ts';

// fixtures/claude-result-*.json 중 error-during-execution 만 손으로 만들었고,
// 나머지(success, not-logged-in, max-budget)는 실제 `claude -p --output-format json` 출력이다.

after(cleanupFakes);

const baseConfig: ClaudeConfig = {
  bin: 'claude',
  workdir: '/unused',
  authMode: 'subscription',
  maxBudgetUsd: 0.5,
  dailyBudgetUsd: 10,
  timeoutMs: 1000,
  maxConcurrency: 2,
};
const live = () => new AbortController().signal;

async function failure(promise: Promise<unknown>): Promise<ClaudeCliError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof ClaudeCliError, `ClaudeCliError expected, got ${String(error)}`);
    return error;
  }
  throw new assert.AssertionError({ message: 'promise resolved but rejection was expected' });
}

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

test('buildClaudeArgs keeps every lockdown flag and only adds --bare for api keys', () => {
  const args = buildClaudeArgs(baseConfig, 'SYSTEM');
  assert.equal(args[0], '-p');
  assert.equal(valueAfter(args, '--output-format'), 'json');
  assert.equal(valueAfter(args, '--tools'), '');
  assert.equal(valueAfter(args, '--setting-sources'), '');
  assert.equal(valueAfter(args, '--system-prompt'), 'SYSTEM');
  assert.equal(valueAfter(args, '--max-budget-usd'), '0.5');
  for (const flag of [
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--no-session-persistence',
  ])
    assert.ok(args.includes(flag), flag);
  for (const flag of ['--bare', '--model', '--effort']) assert.ok(!args.includes(flag), flag);

  const tuned = buildClaudeArgs(
    { ...baseConfig, authMode: 'api_key', model: 'sonnet', effort: 'medium', maxBudgetUsd: 0.25 },
    'S',
  );
  assert.ok(tuned.includes('--bare'));
  assert.equal(valueAfter(tuned, '--model'), 'sonnet');
  assert.equal(valueAfter(tuned, '--effort'), 'medium');
  assert.equal(valueAfter(tuned, '--max-budget-usd'), '0.25');
  // 잠금 플래그는 api_key 모드에서도 그대로여야 한다.
  assert.equal(valueAfter(tuned, '--tools'), '');
  assert.ok(tuned.includes('--strict-mcp-config') && tuned.includes('--no-session-persistence'));
});

test('claudeEnv passes only the whitelist and the one auth variable of the mode', () => {
  const source = {
    PATH: '/usr/bin',
    HOME: '/home/x',
    USER: 'x',
    LOGNAME: 'x',
    LANG: 'ko_KR.UTF-8',
    LC_ALL: 'ko_KR.UTF-8',
    TZ: 'Asia/Seoul',
    TMPDIR: '/tmp',
    CLAUDE_CONFIG_DIR: '/cfg',
    CLAUDE_CODE_OAUTH_TOKEN: 'oauth-token',
    ANTHROPIC_API_KEY: 'api-key',
    EUM_SERVICE_KEY: 'eum',
    KMA_AUTH_KEY: 'kma',
    DATA_GO_KR_KEY: 'datago',
    OPENAI_API_KEY: 'openai',
    LLM_API_KEY: 'llm',
    DATABASE_PATH: '/db',
  };
  const common = [
    'CLAUDE_CODE_DISABLE_AUTO_MEMORY',
    'CLAUDE_CONFIG_DIR',
    'DISABLE_AUTOUPDATER',
    'HOME',
    'LANG',
    'LC_ALL',
    'LOGNAME',
    'PATH',
    'TMPDIR',
    'TZ',
    'USER',
  ];
  const subscription = claudeEnv(baseConfig, source);
  assert.deepEqual(Object.keys(subscription).sort(), [...common, 'CLAUDE_CODE_OAUTH_TOKEN'].sort());
  assert.equal(subscription.CLAUDE_CODE_OAUTH_TOKEN, 'oauth-token');
  const apiKey = claudeEnv({ ...baseConfig, authMode: 'api_key' }, source);
  assert.deepEqual(Object.keys(apiKey).sort(), [...common, 'ANTHROPIC_API_KEY'].sort());
  assert.equal(apiKey.ANTHROPIC_API_KEY, 'api-key');
  for (const env of [subscription, apiKey]) {
    assert.equal(env.DISABLE_AUTOUPDATER, '1');
    assert.equal(env.CLAUDE_CODE_DISABLE_AUTO_MEMORY, '1');
  }
  // 비어 있는 값은 넘기지 않는다.
  assert.deepEqual(Object.keys(claudeEnv(baseConfig, {})).sort(), [
    'CLAUDE_CODE_DISABLE_AUTO_MEMORY',
    'DISABLE_AUTOUPDATER',
  ]);
});

test('buildPrompt joins history as text and leaves a lone message untouched', () => {
  assert.equal(buildPrompt([], '--help 질문'), '--help 질문');
  assert.equal(
    buildPrompt(
      [
        { role: 'user', content: '안녕' },
        { role: 'assistant', content: '네' },
      ],
      '다음',
    ),
    '이전 대화:\n[사용자] 안녕\n[도우미] 네\n\n지금 질문:\n다음',
  );
});

test('readClaudeResult reads success and classifies every failure shape', () => {
  assert.deepEqual(readClaudeResult(readFixture('claude-result-success.json')), {
    text: '안녕하세요!',
    costUsd: 0.000978,
  });
  // 메시지 목록(배열) 형태여도 마지막 result 를 쓴다.
  const list = JSON.stringify([
    { type: 'system', subtype: 'init' },
    JSON.parse(readFixture('claude-result-success.json')),
  ]);
  assert.equal(readClaudeResult(list).text, '안녕하세요!');

  // is_error 인데 subtype 이 success 로 오는 로그인 실패
  const auth = (() => {
    try {
      return readClaudeResult(readFixture('claude-result-not-logged-in.json'));
    } catch (error) {
      return error as ClaudeCliError;
    }
  })();
  assert.ok(auth instanceof ClaudeCliError);
  assert.equal(auth.kind, 'auth');
  assert.match(auth.message, /Not logged in/);

  // 메시지당 비용 상한. 실제 비용이 오류에 실려 온다.
  assert.throws(
    () => readClaudeResult(readFixture('claude-result-max-budget.json')),
    (error: ClaudeCliError) =>
      error.kind === 'limit' && error.costUsd === 0.003812 && /maximum budget/.test(error.message),
  );

  // result 없이 errors 배열만 있는 실행 오류
  assert.throws(
    () => readClaudeResult(readFixture('claude-result-error-during-execution.json')),
    (error: ClaudeCliError) => error.kind === 'failed' && /내부 오류/.test(error.message),
  );

  // is_error 가 false 라도 subtype 이 오류면 성공으로 보지 않는다.
  assert.throws(
    () =>
      readClaudeResult(
        JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: false }),
      ),
    (error: ClaudeCliError) => error.kind === 'failed' && /error_max_turns/.test(error.message),
  );
  assert.throws(
    () =>
      readClaudeResult(
        JSON.stringify({
          type: 'result',
          subtype: 'success',
          is_error: true,
          result: 'Usage limit',
        }),
      ),
    (error: ClaudeCliError) => error.kind === 'limit',
  );

  const cases: [string, ClaudeFailure][] = [
    ['', 'failed'],
    ['   \n', 'failed'],
    ['not json at all', 'failed'],
    ['null', 'failed'],
    ['123', 'failed'],
    ['[]', 'failed'],
    ['{"type":"assistant"}', 'failed'],
    // 오래된 버전은 JSON 없이 글로만 인증 오류를 내보낸다.
    ['Invalid API key · Fix external API key', 'auth'],
    ['Credit balance is too low', 'limit'],
  ];
  for (const [stdout, kind] of cases)
    assert.throws(
      () => readClaudeResult(stdout),
      (error: ClaudeCliError) => error instanceof ClaudeCliError && error.kind === kind,
      JSON.stringify(stdout),
    );
});

test('a successful run returns the text and cost, sends the prompt over stdin, and locks down', async () => {
  const fake = makeFakeClaude({ stdout: readFixture('claude-result-success.json') });
  const ask = createClaudeAgent({ ...fake.config, model: 'sonnet', effort: 'medium' });
  const result = await ask({
    system: '시스템 지침',
    history: [{ role: 'user', content: '앞선 질문' }],
    message: '--help 라고 시작하는 질문',
    signal: live(),
  });
  assert.deepEqual(result, { text: '안녕하세요!', costUsd: 0.000978 });

  const [call] = fake.calls();
  assert.equal(fake.calls().length, 1);
  assert.equal(
    call.stdin,
    '이전 대화:\n[사용자] 앞선 질문\n\n지금 질문:\n--help 라고 시작하는 질문',
  );
  // 프롬프트는 인자에 없고 stdin 으로만 간다.
  assert.ok(!call.argv.some((arg) => arg.includes('--help 라고')));
  // 실제로 받은 인자에 잠금 플래그가 모두 있다.
  assert.equal(call.argv[0], '-p');
  assert.equal(valueAfter(call.argv, '--output-format'), 'json');
  assert.equal(valueAfter(call.argv, '--tools'), '');
  assert.equal(valueAfter(call.argv, '--setting-sources'), '');
  assert.equal(valueAfter(call.argv, '--system-prompt'), '시스템 지침');
  assert.equal(valueAfter(call.argv, '--max-budget-usd'), '0.5');
  assert.equal(valueAfter(call.argv, '--model'), 'sonnet');
  assert.equal(valueAfter(call.argv, '--effort'), 'medium');
  for (const flag of [
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--no-session-persistence',
  ])
    assert.ok(call.argv.includes(flag), flag);
  assert.ok(!call.argv.includes('--bare'));
  // 저장소가 아닌 지정한 빈 작업 폴더에서 실행한다.
  assert.equal(call.cwd, realpathSync(fake.config.workdir));
});

test('api_key mode adds --bare to the real invocation', async () => {
  const fake = makeFakeClaude(
    { stdout: readFixture('claude-result-success.json') },
    { authMode: 'api_key' },
  );
  await createClaudeAgent(fake.config)({
    system: 's',
    history: [],
    message: 'm',
    signal: live(),
  });
  assert.ok(fake.calls()[0].argv.includes('--bare'));
});

test('the child sees only whitelisted environment variables, never other secrets', async () => {
  const secrets = {
    EUM_SERVICE_KEY: 'secret-eum-1',
    KMA_AUTH_KEY: 'secret-kma-2',
    DATA_GO_KR_KEY: 'secret-datago-3',
    OPENAI_API_KEY: 'secret-openai-4',
    LLM_API_KEY: 'secret-llm-5',
    DATABASE_PATH: '/secret/db/path',
    CLAUDE_CODE_OAUTH_TOKEN: 'oauth-token-ok',
    ANTHROPIC_API_KEY: 'anthropic-key-should-not-pass',
  };
  const previous = Object.fromEntries(
    Object.keys(secrets).map((name) => [name, process.env[name]]),
  );
  Object.assign(process.env, secrets);
  try {
    const fake = makeFakeClaude({ stdout: readFixture('claude-result-success.json') });
    await createClaudeAgent(fake.config)({
      system: 's',
      history: [],
      message: 'm',
      signal: live(),
    });
    const { env } = fake.calls()[0];
    const dump = JSON.stringify(env);
    for (const [name, value] of Object.entries(secrets)) {
      if (name === 'CLAUDE_CODE_OAUTH_TOKEN') continue;
      assert.equal(env[name], undefined, name);
      assert.ok(!dump.includes(value), `${name} value leaked`);
    }
    // 구독 모드: 토큰만 넘어간다.
    assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, 'oauth-token-ok');
    assert.equal(env.DISABLE_AUTOUPDATER, '1');
    assert.equal(env.CLAUDE_CODE_DISABLE_AUTO_MEMORY, '1');
    assert.ok(env.PATH);

    // api_key 모드: 키만 넘어가고 구독 토큰은 넘어가지 않는다.
    const keyed = makeFakeClaude(
      { stdout: readFixture('claude-result-success.json') },
      { authMode: 'api_key' },
    );
    await createClaudeAgent(keyed.config)({
      system: 's',
      history: [],
      message: 'm',
      signal: live(),
    });
    const keyedEnv = keyed.calls()[0].env;
    assert.equal(keyedEnv.ANTHROPIC_API_KEY, 'anthropic-key-should-not-pass');
    assert.equal(keyedEnv.CLAUDE_CODE_OAUTH_TOKEN, undefined);
    assert.equal(keyedEnv.EUM_SERVICE_KEY, undefined);
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('authentication, limit, execution and format failures map to distinct kinds', async () => {
  const run = (stdout: string, exitCode = 1, stderr?: string) =>
    createClaudeAgent(makeFakeClaude({ stdout, exitCode, stderr }).config)({
      system: 's',
      history: [],
      message: 'm',
      signal: live(),
    });

  const auth = await failure(run(readFixture('claude-result-not-logged-in.json')));
  assert.equal(auth.kind, 'auth');

  const limit = await failure(run(readFixture('claude-result-max-budget.json')));
  assert.equal(limit.kind, 'limit');
  assert.equal(limit.costUsd, 0.003812);

  const execution = await failure(run(readFixture('claude-result-error-during-execution.json')));
  assert.equal(execution.kind, 'failed');
  assert.match(execution.message, /내부 오류/);

  const text = await failure(run('Segmentation fault, not json'));
  assert.equal(text.kind, 'failed');
  assert.match(text.message, /JSON/);

  const empty = await failure(run('', 1, 'boom on stderr'));
  assert.equal(empty.kind, 'failed');
  assert.match(empty.message, /boom on stderr/);

  // stderr 에만 인증 오류가 찍혀도 인증 실패로 본다.
  const quiet = await failure(run('', 1, 'Invalid API key · Fix external API key'));
  assert.equal(quiet.kind, 'auth');
});

test('a missing executable is reported as a failure and frees its slot', async () => {
  const ask = createClaudeAgent({
    ...baseConfig,
    bin: '/nonexistent/claude-binary',
    workdir: makeFakeClaude({}).config.workdir,
    maxConcurrency: 1,
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    const error = await failure(ask({ system: 's', history: [], message: 'm', signal: live() }));
    assert.equal(error.kind, 'failed');
    assert.match(error.message, /실행하지 못했다/);
  }
});

test('timeout terminates the child, reports timeout, and frees the concurrency slot', async () => {
  const fake = makeFakeClaude({ sleepMs: 20000 }, { timeoutMs: 300, maxConcurrency: 1 });
  const ask = createClaudeAgent(fake.config);
  const started = Date.now();
  const error = await failure(ask({ system: 's', history: [], message: 'm', signal: live() }));
  assert.equal(error.kind, 'timeout');
  assert.ok(Date.now() - started < 3000, 'child was not stopped promptly');
  // 같은 설정으로 바로 다시 실행할 수 있다 (자리가 풀렸다).
  const retry = createClaudeAgent(
    makeFakeClaude({ stdout: readFixture('claude-result-success.json') }, { maxConcurrency: 1 })
      .config,
  );
  assert.equal(
    (await retry({ system: 's', history: [], message: 'm', signal: live() })).text,
    '안녕하세요!',
  );
});

test('a child that ignores SIGTERM is killed with SIGKILL after the grace period', async () => {
  // 제한 시간은 프로세스가 뜨는 시간(수백 ms)보다 넉넉해야 SIGTERM 무시가 먼저 적용된다.
  const fake = makeFakeClaude(
    { sleepMs: 20000, ignoreSigterm: true },
    { timeoutMs: 1500, killGraceMs: 400 },
  );
  const started = Date.now();
  const error = await failure(
    createClaudeAgent(fake.config)({ system: 's', history: [], message: 'm', signal: live() }),
  );
  const elapsed = Date.now() - started;
  assert.equal(error.kind, 'timeout');
  // SIGTERM 만으로는 끝나지 않았으므로 제한 시간 + 유예 시간 뒤에야 끝난다.
  assert.ok(elapsed >= 1850, `ended too early: ${elapsed}ms`);
  assert.ok(elapsed < 5000, `ended too late: ${elapsed}ms`);
});

test('aborting also stops grandchildren that keep the output pipe open', async () => {
  const fake = makeFakeClaude({ sleepMs: 20000, grandchild: true }, { timeoutMs: 30000 });
  const controller = new AbortController();
  const pending = failure(
    createClaudeAgent(fake.config)({
      system: 's',
      history: [],
      message: 'm',
      signal: controller.signal,
    }),
  );
  await fake.waitForCall();
  // 가짜 claude 가 기록한 직후 하위 프로세스(sleep 15)를 만들 시간을 준다.
  await new Promise((resolve) => setTimeout(resolve, 150));
  const started = Date.now();
  controller.abort();
  const error = await pending;
  assert.equal(error.kind, 'aborted');
  // 하위 프로세스까지 끝내지 않으면 15초 가까이 걸린다.
  assert.ok(Date.now() - started < 4000, 'grandchild kept the pipe open');
});

test('aborting kills the child and reports aborted', async () => {
  const fake = makeFakeClaude({ sleepMs: 20000 }, { timeoutMs: 30000 });
  const controller = new AbortController();
  const pending = failure(
    createClaudeAgent(fake.config)({
      system: 's',
      history: [],
      message: 'm',
      signal: controller.signal,
    }),
  );
  await fake.waitForCall();
  const started = Date.now();
  controller.abort();
  const error = await pending;
  assert.equal(error.kind, 'aborted');
  assert.ok(Date.now() - started < 3000, 'child was not stopped promptly');
});

test('an already aborted signal never starts a process', async () => {
  const fake = makeFakeClaude({ stdout: readFixture('claude-result-success.json') });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    createClaudeAgent(fake.config)({
      system: 's',
      history: [],
      message: 'm',
      signal: controller.signal,
    }),
    { name: 'AbortError' },
  );
  assert.equal(fake.calls().length, 0);
});

test('the concurrency cap rejects extra requests as busy and releases slots afterwards', async () => {
  const fake = makeFakeClaude(
    { stdout: readFixture('claude-result-success.json'), sleepMs: 500 },
    { maxConcurrency: 2 },
  );
  const ask = createClaudeAgent(fake.config);
  const input = () => ({ system: 's', history: [], message: 'm', signal: live() });
  const first = ask(input());
  const second = ask(input());
  const third = await failure(ask(input()));
  assert.equal(third.kind, 'busy');
  assert.deepEqual(
    (await Promise.all([first, second])).map((r) => r.text),
    ['안녕하세요!', '안녕하세요!'],
  );
  // 끝난 뒤에는 다시 받는다. busy 였던 요청은 프로세스를 띄우지 않았다.
  assert.equal(fake.calls().length, 2);
  assert.equal((await ask(input())).text, '안녕하세요!');
  assert.equal(fake.calls().length, 3);
});
