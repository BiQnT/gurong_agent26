import { lazy, Suspense, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, Check, MapPin, Radio, Search, Users } from 'lucide-react';
import { workspaceApi, type GeocodeHit, type Site } from '../../lib/workspace';
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
  // 주소와 핀은 서로를 채운다. 사용자가 직접 쓴 주소·직접 놓은 핀은 덮어쓰지 않고 바꿀지 묻는다.
  const addressFrom = useRef<'empty' | 'typed' | 'map'>(initialSite ? 'typed' : 'empty');
  const pinFrom = useRef<'none' | 'map' | 'address'>(initialSite ? 'map' : 'none');
  const lastSearched = useRef(initialSite?.address.trim() ?? '');
  const reverseRequest = useRef<AbortController | null>(null);
  const searchRequest = useRef<AbortController | null>(null);
  const [searching, setSearching] = useState(false);
  const [reversing, setReversing] = useState(false);
  // 응답이 늦게 와도 그때의 주소칸 값과 비교한다.
  const addressNow = useRef(address);
  addressNow.current = address;
  const [geoNote, setGeoNote] = useState<string | null>(null);
  const [addressSuggestion, setAddressSuggestion] = useState<string | null>(null);
  const [pinSuggestion, setPinSuggestion] = useState<GeocodeHit | null>(null);
  const submitting = useRef(false);
  const id = useId();
  const reducedMotion = useReducedMotion();

  useEffect(
    () => () => {
      reverseRequest.current?.abort();
      searchRequest.current?.abort();
    },
    [],
  );

  function placePin(next: { latitude: number; longitude: number }, from: 'map' | 'address') {
    setLocation(next);
    setConfirmed(false);
    setError(null);
    pinFrom.current = from;
    setPinSuggestion(null);
  }

  /** 지도에서 핀을 놓으면 그 위치의 주소를 찾아 주소칸을 채운다. */
  async function pinMoved(next: { latitude: number; longitude: number }) {
    // 지도를 직접 누른 것이 마지막 동작이다. 늦게 오는 주소 검색 결과가 핀을 다시 옮기지 않게 끊는다.
    searchRequest.current?.abort();
    searchRequest.current = null;
    setSearching(false);
    placePin(next, 'map');
    setAddressSuggestion(null);
    reverseRequest.current?.abort();
    const controller = new AbortController();
    reverseRequest.current = controller;
    setReversing(true);
    setGeoNote(null);
    try {
      const { address: found } = await workspaceApi.reverseGeocode(next, controller.signal);
      if (controller.signal.aborted) return;
      if (!found) {
        setGeoNote('이 위치의 주소를 찾지 못했어요. 주소는 직접 입력해 주세요.');
      } else if (addressFrom.current === 'typed') {
        if (found !== addressNow.current.trim()) setAddressSuggestion(found);
      } else {
        setAddress(found);
        addressFrom.current = 'map';
        lastSearched.current = found;
        setGeoNote('지도 위치로 주소를 채웠어요. 번지·동은 직접 고쳐 주세요.');
      }
    } catch {
      if (!controller.signal.aborted)
        setGeoNote('주소를 찾지 못했어요. 주소는 직접 입력해 주세요.');
    } finally {
      if (reverseRequest.current === controller) setReversing(false);
    }
  }

  /** 입력한 주소로 위치를 찾는다. force 는 버튼으로 직접 요청한 경우 (직접 놓은 핀도 옮긴다). */
  async function searchAddress(force: boolean) {
    const query = address.trim().replace(/\s+/g, ' ');
    if (query.length < 2 || (!force && query === lastSearched.current)) return;
    lastSearched.current = query;
    // 주소로 찾는 것이 마지막 동작이다. 진행 중인 핀 주소 찾기가 주소칸을 덮지 않게 끊는다.
    reverseRequest.current?.abort();
    reverseRequest.current = null;
    setReversing(false);
    searchRequest.current?.abort();
    const controller = new AbortController();
    searchRequest.current = controller;
    setSearching(true);
    setGeoNote(null);
    setPinSuggestion(null);
    try {
      const { results } = await workspaceApi.geocode(query, controller.signal);
      if (controller.signal.aborted) return;
      const hit = results[0];
      if (!hit) {
        setGeoNote('주소로 위치를 찾지 못했어요. 지도에서 덕장을 직접 눌러 주세요.');
      } else if (force || pinFrom.current !== 'map') {
        placePin(hit, 'address');
        setGeoNote(
          `‘${hit.label}’ 근처로 옮겼어요. 번지까지는 찾지 못하니 핀을 실제 덕장 위치로 옮겨 주세요.`,
        );
      } else {
        setPinSuggestion(hit);
      }
    } catch {
      if (!controller.signal.aborted)
        setGeoNote('주소로 위치를 찾지 못했어요. 지도에서 덕장을 직접 눌러 주세요.');
    } finally {
      if (searchRequest.current === controller) setSearching(false);
    }
  }

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
                onChange={(event) => {
                  setAddress(event.target.value);
                  addressFrom.current = event.target.value.trim() ? 'typed' : 'empty';
                  setAddressSuggestion(null);
                  // 고치는 중이면 이전 주소로 찾던 결과는 버린다.
                  searchRequest.current?.abort();
                  searchRequest.current = null;
                  setSearching(false);
                }}
                onBlur={() => {
                  if (addressFrom.current === 'typed') void searchAddress(false);
                }}
                required
                maxLength={240}
                placeholder="덕장을 찾을 수 있는 주소를 입력해 주세요"
                autoComplete="street-address"
                rows={3}
                disabled={busy}
              />
              <small>주소를 쓰면 지도가 그 근처로, 지도를 누르면 주소가 채워져요.</small>
            </label>
            <div className="ws-geo" aria-live="polite">
              <button
                type="button"
                className="ws-text-button"
                onClick={() => void searchAddress(true)}
                // 칸을 벗어나며 시작한 검색 중에도 누를 수 있다 (누르면 다시 찾아 핀을 옮긴다).
                disabled={busy || address.trim().length < 2}
              >
                {searching ? <BusyIcon /> : <Search size={14} />}
                {searching ? '주소 찾는 중' : '주소로 지도에서 찾기'}
              </button>
              {reversing && (
                <p className="ws-field-note">
                  <BusyIcon /> 핀 위치의 주소를 찾고 있어요.
                </p>
              )}
              {geoNote && <p className="ws-field-note">{geoNote}</p>}
              {addressSuggestion && (
                <div className="ws-geo-suggestion">
                  <span>
                    지도 위치 주소: <strong>{addressSuggestion}</strong>
                  </span>
                  <button
                    type="button"
                    className="ws-text-button"
                    onClick={() => {
                      setAddress(addressSuggestion);
                      addressFrom.current = 'map';
                      lastSearched.current = addressSuggestion;
                      setAddressSuggestion(null);
                    }}
                  >
                    주소 바꾸기
                  </button>
                </div>
              )}
              {pinSuggestion && (
                <div className="ws-geo-suggestion">
                  <span>
                    입력한 주소 위치: <strong>{pinSuggestion.label}</strong>
                  </span>
                  <button
                    type="button"
                    className="ws-text-button"
                    onClick={() => placePin(pinSuggestion, 'address')}
                  >
                    핀 옮기기
                  </button>
                </div>
              )}
            </div>
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
                onChange={(next) => void pinMoved(next)}
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
