"use client";

import Link from "next/link";
import { useState } from "react";
import { LEVEL_LABEL, LEVEL_STYLE, SCENARIO_OPTIONS, type AgentResponse } from "./types";

/**
 * 사용자용 화면.
 *
 * 현장 담당자가 자연어로 묻고 판정 근거와 방송 문안을 받는다.
 * 관제용 지도는 /monitor 에 있다.
 */

const EXAMPLES = [
  "지금 방파제 방송 내보내야 하나?",
  "북방파제 상황이 어때?",
  "지금 관광객이 방파제에 올라가도 되나?",
];

export default function ChatPage() {
  const [q, setQ] = useState("");
  const [scenario, setScenario] = useState("");
  const [result, setResult] = useState<AgentResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = async (question: string) => {
    if (!question.trim() || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: question, scenario: scenario || undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setResult(json as AgentResponse);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="mx-auto max-w-3xl p-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">구룡포 방파제 안내방송 에이전트</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            E-UM 디지털트윈 실시간 데이터로 위험을 판정하고 방송 문안을 만듭니다
          </p>
        </div>
        <Link
          href="/monitor"
          className="rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700"
        >
          관제 화면
        </Link>
      </header>

      <div className="mb-4 flex flex-wrap gap-2">
        {EXAMPLES.map((e) => (
          <button
            key={e}
            onClick={() => {
              setQ(e);
              void ask(e);
            }}
            disabled={loading}
            className="rounded-full border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            {e}
          </button>
        ))}
      </div>

      <form
        onSubmit={(ev) => {
          ev.preventDefault();
          void ask(q);
        }}
        className="mb-4 flex gap-2"
      >
        <input
          value={q}
          onChange={(ev) => setQ(ev.target.value)}
          placeholder="방파제 상황을 물어보세요"
          className="flex-1 rounded-md border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
        />
        <select
          value={scenario}
          onChange={(ev) => setScenario(ev.target.value)}
          className="rounded-md border border-slate-300 px-2 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
        >
          {SCENARIO_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={loading || !q.trim()}
          className="rounded-md bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "…" : "질문"}
        </button>
      </form>

      {loading && (
        <div className="rounded-lg border border-slate-200 p-6 text-center text-sm text-slate-500 dark:border-slate-800">
          E-UM 데이터를 불러와 판정하는 중…
        </div>
      )}

      {error && (
        <div className="rounded-lg bg-red-100 p-4 text-sm text-red-900 dark:bg-red-950 dark:text-red-200">
          오류: {error}
        </div>
      )}

      {result && (
        <div className="space-y-4">
          {result.simulation && (
            <div className="rounded-lg border-2 border-dashed border-amber-500 bg-amber-50 p-3 text-sm dark:bg-amber-950/40">
              <strong className="text-amber-900 dark:text-amber-200">
                시연 모드 — {result.simulation.label}
              </strong>
              <p className="mt-1 text-amber-800 dark:text-amber-300">{result.simulation.notice}</p>
            </div>
          )}

          <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-3 py-1 text-sm font-bold ring-1 ${LEVEL_STYLE[result.assessment.level]}`}
              >
                {LEVEL_LABEL[result.assessment.level]}
              </span>
              {result.fallback && (
                <span className="rounded bg-slate-200 px-2 py-0.5 text-xs dark:bg-slate-700">
                  규칙 폴백 ({result.fallbackReason})
                </span>
              )}
              {result.modelUsed && <span className="text-xs text-slate-500">{result.modelUsed}</span>}
            </div>
            <p className="whitespace-pre-wrap text-sm">{result.answer}</p>
          </div>

          {result.assessment.reasons.length > 0 && (
            <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
              <h2 className="mb-2 font-semibold">판정 근거</h2>
              <ul className="space-y-2">
                {result.assessment.reasons.map((r, i) => (
                  <li key={i} className="rounded bg-slate-50 p-2 text-sm dark:bg-slate-900">
                    <div>{r.message}</div>
                    <div className="mt-1 text-xs text-slate-500">기준 출처: {r.source}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.broadcast && (
            <div className="rounded-lg border-2 border-red-300 p-4 dark:border-red-800">
              <h2 className="mb-1 font-semibold">
                방송 문안 — 대상 스피커 {result.broadcast.targetSpeakers.length}대
              </h2>
              <p className="mb-2 text-xs text-slate-500">
                {result.broadcast.targetSpeakers.map((s) => s.name).join(", ")}
              </p>
              <div className="space-y-2 text-sm">
                <p className="rounded bg-slate-50 p-3 dark:bg-slate-900">{result.broadcast.korean}</p>
                <p className="rounded bg-slate-50 p-3 text-slate-700 dark:bg-slate-900 dark:text-slate-300">
                  {result.broadcast.english}
                </p>
              </div>
              {result.broadcast.speakersWithoutCoords.length > 0 && (
                <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                  좌표 결손: {result.broadcast.speakersWithoutCoords.join(", ")}
                </p>
              )}
            </div>
          )}

          {result.assessment.limitations.length > 0 && (
            <details className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
              <summary className="cursor-pointer font-semibold">이 판정이 못 보는 것</summary>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-600 dark:text-slate-400">
                {result.assessment.limitations.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </main>
  );
}
