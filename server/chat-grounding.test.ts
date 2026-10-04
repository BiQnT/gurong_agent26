import assert from 'node:assert/strict';
import test from 'node:test';
import { createLiveChat, hasUnsupportedVerdict, readChatRequest } from './chat.ts';
import type { BridgeConfig } from './eum.ts';
import type { LiveSnapshot } from '../src/lib/live.ts';

test('request roles must be strings and client scenarios cannot influence actual observations', () => {
  assert.throws(() =>
    readChatRequest({
      message: '관측 확인',
      siteId: 'unconfigured',
      history: [{ role: ['user'], content: '질문' }],
    }),
  );
  const request = readChatRequest({
    message: '관측 확인',
    siteId: 'unconfigured',
    scenario: 'unsuitable',
    history: [],
  });
  assert.equal(request.scenario, undefined);
});

test('explicit unsupported drying verdicts are rejected while honest uncertainty is allowed', () => {
  for (const text of [
    '건조에 적합합니다.',
    '건조가 가능합니다.',
    '지금 널어도 괜찮아요.',
    '건조 등급: 주의',
    '안전한 환경입니다.',
  ]) {
    assert.equal(hasUnsupportedVerdict(text), true, text);
  }
  for (const text of [
    '건조 적합 여부는 판정할 수 없습니다.',
    '식품 안전을 확인할 수 없어요.',
    '현재 자료로는 건조 가능 여부를 알 수 없습니다.',
    '보관된 과거 실측 자료이며 현재 날씨가 아닙니다.',
  ]) {
    assert.equal(hasUnsupportedVerdict(text), false, text);
  }
});

test('a model verdict falls back transparently without presenting an AI grade', async () => {
  const config: BridgeConfig = {
    eumServiceKey: '',
    openaiApiKey: 'test-key',
    openaiModel: 'test-model',
    llmBaseUrl: 'https://api.openai.com/v1',
    timezoneOffset: '+09:00',
    staleAfterMinutes: 30,
    projectRoot: process.cwd(),
  };
  const snapshot: LiveSnapshot = {
    fetchedAt: '2026-10-03T00:00:00Z',
    source: 'E-UM 보관된 실측',
    sourceUrl: 'https://pohang-eum.kr',
    devices: [],
    observations: [],
    selected: null,
    warnings: ['현재 날씨가 아님'],
    status: 'archived',
    archiveSourceDate: '2026-08-06',
    llm: { configured: true, model: 'test-model' },
  };
  const fakeFetch: typeof fetch = async () =>
    Response.json({
      choices: [{ message: { role: 'assistant', content: '지금 건조에 적합합니다.' } }],
    });
  const reply = await createLiveChat(config, fakeFetch)(
    { message: '널어도 될까요?', siteId: 'unconfigured', history: [] },
    snapshot,
    new AbortController().signal,
  );
  assert.equal(reply.provider, 'local');
  assert.equal(reply.assessment, undefined);
  assert.match(reply.providerNotice ?? '', /확인되지 않은 판정/);
  assert.match(reply.content, /현재 날씨가 아니에요/);
});
