import { lazy, Suspense, useId, useRef, useState, type FormEvent } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, Check, MapPin, Radio, Users } from 'lucide-react';
import { workspaceApi, type Site } from '../../lib/workspace';
import { BrandMark } from '../BrandMark';
import type { SiteLocation } from './LocationPicker';
import { BusyIcon, errorMessage, FormError } from './shared';

const LocationPicker = lazy(() =>
  import('./LocationPicker').then((module) => ({ default: module.LocationPicker })),
);

export function SiteSetup({
  onSaved,
  onCancel,
  initialSite,
  userName,
  onBusyChange,
}: {
  onSaved: (site: Site) => void;
  onCancel?: () => void;
  initialSite?: Site | null;
  userName?: string;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [name, setName] = useState(initialSite?.name ?? '');
  const [address, setAddress] = useState(initialSite?.address ?? '');
  const [location, setLocation] = useState<SiteLocation | null>(
    initialSite ? { latitude: initialSite.latitude, longitude: initialSite.longitude } : null,
  );
  const [confirmed, setConfirmed] = useState(Boolean(initialSite));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const id = useId();
  const reducedMotion = useReducedMotion();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    if (!location || !confirmed) {
      setError('실제 덕장 위치를 선택하고 확인해 주세요.');
      return;
    }
    submitting.current = true;
    setBusy(true);
    onBusyChange?.(true);
    setError(null);
    try {
      const input = {
        name: name.trim(),
        address: address.trim().replace(/\s+/g, ' '),
        ...location,
      };
      const site = initialSite
        ? await workspaceApi.updateSite(initialSite.id, input)
        : await workspaceApi.createSite(input);
      onSaved(site);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      submitting.current = false;
      setBusy(false);
      onBusyChange?.(false);
    }
  }

  return (
    <motion.section
      className={`ws-setup${initialSite ? ' ws-setup--editing' : ''}`}
      initial={{ opacity: 0, y: reducedMotion ? 0 : 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reducedMotion ? 0 : 0.35 }}
      aria-labelledby={`${id}-title`}
    >
      {!initialSite && (
        <>
          <div className="ws-setup-brand">
            <div className="ws-wordmark">
              <BrandMark />
              <span>해풍</span>
            </div>
            <span>우리 덕장, 처음 연결하기</span>
          </div>
          <ol className="ws-steps" aria-label="시작 단계">
            <li className="is-complete">
              <span>
                <Check size={13} />
              </span>
              계정 만들기
            </li>
            <li className="is-current" aria-current="step">
              <span>2</span>덕장 등록
            </li>
            <li>
              <span>3</span>동료와 함께<small>나중에 가능</small>
            </li>
          </ol>
        </>
      )}
      <div className="ws-setup-heading">
        <span className="ws-eyebrow">
          {initialSite
            ? '우리 덕장 정보'
            : `${userName ? `${userName}님, ` : ''}이제 우리 덕장을 알려 주세요`}
        </span>
        <h1 id={`${id}-title`}>{initialSite ? '덕장 정보 수정' : '어디에서 함께할까요?'}</h1>
        <p>덕장 위치를 기준으로 주변의 실제 관측 정보를 연결해요.</p>
      </div>
      <form onSubmit={submit} className="ws-setup-form" aria-busy={busy}>
        <div className="ws-setup-grid">
          <div className="ws-setup-details">
            <div className="ws-section-label">
              <span>01</span>덕장 정보
            </div>
            <label className="ws-field" htmlFor={`${id}-name`}>
              <span>덕장 이름</span>
              <input
                id={`${id}-name`}
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                maxLength={80}
                placeholder="예: 바다마을 덕장"
                autoComplete="organization"
                disabled={busy}
              />
            </label>
            <label className="ws-field" htmlFor={`${id}-address`}>
              <span>주소</span>
              <textarea
                id={`${id}-address`}
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                required
                maxLength={240}
                placeholder="덕장을 찾을 수 있는 주소를 입력해 주세요"
                autoComplete="street-address"
                rows={3}
                disabled={busy}
              />
              <small>주소 입력 후, 지도에서 정확한 위치를 선택해 주세요.</small>
            </label>
            <div className="ws-setup-note">
              <Radio size={19} />
              <div>
                <strong>가까운 관측 정보를 더 정확하게</strong>
                <p>지도에 표시한 위치로 관측기와 덕장 사이의 거리를 확인해요.</p>
              </div>
            </div>
          </div>
          <div className="ws-setup-location">
            <div className="ws-section-label">
              <span>02</span>지도에서 위치 확인
            </div>
            <Suspense
              fallback={
                <div className="ws-map-loading" role="status">
                  <BusyIcon />
                  지도를 준비하고 있어요.
                </div>
              }
            >
              <LocationPicker
                value={location}
                confirmed={confirmed}
                disabled={busy}
                onChange={(next) => {
                  setLocation(next);
                  setConfirmed(false);
                  setError(null);
                }}
                onConfirm={setConfirmed}
              />
            </Suspense>
          </div>
        </div>
        <div className="ws-setup-footer">
          <div className="ws-setup-footer-note">
            <Users size={17} />
            <span>
              등록 후 동료를 초대할 수 있어요.
              <br />
              <small>먼저 혼자 시작해도 괜찮아요.</small>
            </span>
          </div>
          <div className="ws-actions">
            {onCancel && (
              <button
                className="ws-button ws-button--secondary"
                type="button"
                onClick={onCancel}
                disabled={busy}
              >
                취소
              </button>
            )}
            <button
              className="ws-button ws-button--primary"
              type="submit"
              disabled={busy || !name.trim() || !address.trim() || !location || !confirmed}
            >
              {busy ? (
                <>
                  <BusyIcon />
                  저장 중
                </>
              ) : (
                <>
                  {initialSite ? '변경 사항 저장' : '덕장 등록하고 시작'}
                  {initialSite ? <Check size={16} /> : <ArrowRight size={16} />}
                </>
              )}
            </button>
          </div>
        </div>
        <FormError>{error}</FormError>
      </form>
      {!initialSite && (
        <p className="ws-setup-bottom">
          <MapPin size={13} />
          덕장 정보와 위치는 등록 후에도 수정할 수 있어요.
        </p>
      )}
    </motion.section>
  );
}
