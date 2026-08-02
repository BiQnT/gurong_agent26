"use client";

import { useCallback, useEffect, useState } from "react";
import MapView from "./MapView";
import {
  LEVEL_LABEL,
  LEVEL_STYLE,
  SCENARIO_OPTIONS,
  type AgentResponse,
  type AssessResponse,
} from "../types";
import { hasCoordsClient } from "../util";

/**
 * 지자체 모니터링 화면.
 *
 * 담당 공무원이 보는 관제 화면이다. 지도 위에 실제 스피커·CCTV 위치를 찍고,
 * 규칙 판정 등급과 근거를 띄우고, 방송이 필요하면 문안을 생성해 대상 스피커를
 * 강조한다. 판정의 한계도 숨기지 않고 그대로 노출한다.
 */
export default function MonitorPage() {
  const [scenario, setScenario] = useState("");
  const [assess, setAssess] = useState<AssessResponse | null>(null);
  const [agent, setAgent] = useState<AgentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (s: string) => {
    setLoading(true);
    setError(null);
    setAgent(null);
    try {
      const res = await fetch(`/api/assess${s ? `?scenario=${s}` : ""}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setAssess(json as AssessResponse);
    } catch (e) {
      setError((e as Error).message);
      setAssess(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(scenario);
  }, [scenario, load]);

  const draft = async () => {
    setDrafting(true);
    setError(null);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          q: "지금 방파제에 방송을 내보내야 하나? 필요하면 문안을 작성해줘.",
          scenario: scenario || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setAgent(json as AgentResponse);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDrafting(false);
    }
  };

  const devices = assess?.snapshot.devices;
  const speakers = (devices?.speakers ?? []).filter(hasCoordsClient);
  const missingCoords = (devices?.speakers ?? []).filter((d) => !hasCoordsClient(d));
  const cctvs = (devices?.ai_cctvs ?? []).filter(hasCoordsClient);
  const uvSensors = (devices?.uv_devices ?? []).filter(hasCoordsClient);
  const targetIds = agent?.broadcast?.targetSpeakers.map((s) => s.id) ?? [];
  const air = assess?.snapshot.air;
  const uv = assess?.snapshot.uv;
  const abnormal = assess?.snapshot.abnormal;

  return (
    <main className="mx-auto max-w-7xl p-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">구룡포 방파제 안전 관제</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            E-UM 디지털트윈 실시간 데이터 · 지자체 모니터링
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={scenario}
            onChange={(e) => setScenario(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
          >
            {SCENARIO_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => void load(scenario)}
            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
          >
            새로고침
          </button>
          <a
            href="/"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700"
          >
            사용자 화면
          </a>
        </div>
      </header>

      {assess?.simulation && (
        <div className="mb-4 rounded-lg border-2 border-dashed border-amber-500 bg-amber-50 p-4 text-sm dark:bg-amber-950/40">
          <strong className="text-amber-900 dark:text-amber-200">
            시연 모드 — {assess.simulation.label}
          </strong>
          <p className="mt-1 text-amber-800 dark:text-amber-300">{assess.simulation.notice}</p>
          <p className="mt-1 text-amber-700 dark:text-amber-400">
            {assess.simulation.description}
          </p>
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-lg bg-red-100 p-4 text-sm text-red-900 dark:bg-red-950 dark:text-red-200">
          오류: {error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <section className="h-[540px] overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-500">
              불러오는 중…
            </div>
          ) : (
            <MapView
              speakers={speakers}
              cctvs={cctvs}
              uvSensors={uvSensors}
              targetSpeakerIds={targetIds}
            />
          )}
        </section>

        <section className="space-y-4">
          <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">현재 위험도</h2>
              {assess && (
                <span
                  className={`rounded-full px-3 py-1 text-sm font-bold ring-1 ${LEVEL_STYLE[assess.level]}`}
                >
                  {LEVEL_LABEL[assess.level]}
                </span>
              )}
            </div>

            {air && !("error" in air) && (
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <dt className="text-slate-500">기온</dt>
                <dd>{air.temp}℃</dd>
                <dt className="text-slate-500">풍속</dt>
                <dd>{air.winsp} m/s</dd>
                <dt className="text-slate-500">풍향</dt>
                <dd>{air.windir}°</dd>
                <dt className="text-slate-500">습도</dt>
                <dd>{air.humi}%</dd>
                <dt className="text-slate-500">자외선</dt>
                <dd>{uv && !("error" in uv) ? uv.uvIndex : "—"}</dd>
                <dt className="text-slate-500">측정 시각</dt>
                <dd className="text-xs">{air.logDateTime}</dd>
              </dl>
            )}

            {assess && assess.reasons.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {assess.reasons.map((r, i) => (
                  <li key={i} className="rounded bg-slate-50 p-2 text-sm dark:bg-slate-900">
                    <div>{r.message}</div>
                    <div className="mt-1 text-xs text-slate-500">기준 출처: {r.source}</div>
                  </li>
                ))}
              </ul>
            ) : (
              assess && (
                <p className="mt-3 text-sm text-slate-500">임계값을 넘어선 지표가 없습니다.</p>
              )
            )}

            <button
              onClick={() => void draft()}
              disabled={drafting || loading}
              className="mt-4 w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {drafting ? "생성 중…" : "방송 문안 생성"}
            </button>
          </div>

          {agent && (
            <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
              <h2 className="font-semibold">
                방송 {agent.broadcast ? "권고" : "불필요"}
                {agent.fallback && (
                  <span className="ml-2 rounded bg-slate-200 px-2 py-0.5 text-xs font-normal dark:bg-slate-700">
                    규칙 폴백 ({agent.fallbackReason})
                  </span>
                )}
              </h2>

              {agent.broadcast ? (
                <>
                  <p className="mt-2 text-xs text-slate-500">
                    대상 스피커 {agent.broadcast.targetSpeakers.length}대 — 지도에 빨간색으로 표시
                  </p>
                  <div className="mt-2 space-y-2 text-sm">
                    <p className="rounded bg-slate-50 p-3 dark:bg-slate-900">
                      {agent.broadcast.korean}
                    </p>
                    <p className="rounded bg-slate-50 p-3 text-slate-700 dark:bg-slate-900 dark:text-slate-300">
                      {agent.broadcast.english}
                    </p>
                  </div>
                  {agent.broadcast.speakersWithoutCoords.length > 0 && (
                    <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                      좌표 결손으로 지도에 표시 못 한 대상:{" "}
                      {agent.broadcast.speakersWithoutCoords.join(", ")}
                    </p>
                  )}
                </>
              ) : (
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                  현재 등급에서는 방송하지 않습니다.
                </p>
              )}

              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-slate-500">
                  에이전트 응답 전문 {agent.modelUsed ? `(${agent.modelUsed})` : ""}
                </summary>
                <pre className="mt-2 whitespace-pre-wrap text-xs text-slate-600 dark:text-slate-400">
                  {agent.answer}
                </pre>
              </details>
            </div>
          )}

          <div className="rounded-lg border border-slate-200 p-4 text-sm dark:border-slate-800">
            <h2 className="font-semibold">장비 현황</h2>
            <ul className="mt-2 space-y-1 text-slate-600 dark:text-slate-400">
              <li>
                스피커 {devices?.speakers.length ?? 0}대 (지도 표시 {speakers.length}대)
                {missingCoords.length > 0 && (
                  <span className="text-amber-700 dark:text-amber-400">
                    {" "}
                    · 좌표 결손 {missingCoords.map((d) => d.name).join(", ")}
                  </span>
                )}
              </li>
              <li>AI CCTV {devices?.ai_cctvs.length ?? 0}대</li>
              <li>자외선 측정기 {devices?.uv_devices.length ?? 0}대</li>
              <li>
                이상행동 검출:{" "}
                {abnormal && !("error" in abnormal) ? (
                  abnormal.detectorLive ? (
                    <span className="text-emerald-700">가동 중 (누적 {abnormal.total}건)</span>
                  ) : (
                    <span className="text-red-700 dark:text-red-400">
                      미가동 — 검출 0건. 지금 방파제에 사람이 있는지 알 수 없음
                    </span>
                  )
                ) : (
                  "조회 실패"
                )}
              </li>
            </ul>
          </div>

          {assess && assess.limitations.length > 0 && (
            <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
              <h2 className="font-semibold">이 판정이 못 보는 것</h2>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-600 dark:text-slate-400">
                {assess.limitations.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
