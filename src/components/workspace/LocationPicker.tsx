import { useEffect, useId, useRef, useState } from 'react';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Check, ChevronDown, Crosshair, MapPin, MousePointerClick, Navigation } from 'lucide-react';
import { BusyIcon } from './shared';

export type SiteLocation = { latitude: number; longitude: number };

export function LocationPicker({
  value,
  confirmed,
  disabled,
  onChange,
  onConfirm,
}: {
  value: SiteLocation | null;
  confirmed: boolean;
  disabled?: boolean;
  onChange: (value: SiteLocation) => void;
  onConfirm: (confirmed: boolean) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.Marker | null>(null);
  const callback = useRef(onChange);
  const locked = useRef(disabled);
  const mounted = useRef(true);
  const initialValue = useRef(value);
  const [latitude, setLatitude] = useState(value?.latitude.toString() ?? '');
  const [longitude, setLongitude] = useState(value?.longitude.toString() ?? '');
  const [coordinatesDirty, setCoordinatesDirty] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [tileError, setTileError] = useState(false);
  const [locating, setLocating] = useState(false);
  const [wheelZoom, setWheelZoom] = useState(false);
  const locatingRef = useRef(false);
  const pinned = useRef(value !== null);
  // 휠 확대를 켜려고 누른 것인지. 그 누름의 click 은 핀을 옮기지 않는다.
  const activating = useRef(false);
  const id = useId();
  callback.current = onChange;
  locked.current = disabled;
  pinned.current = value !== null;

  useEffect(() => {
    mounted.current = true;
    if (!container.current) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const instance = L.map(container.current, {
      center: initialValue.current
        ? [initialValue.current.latitude, initialValue.current.longitude]
        : [35.985, 129.55],
      zoom: initialValue.current ? 16 : 14,
      scrollWheelZoom: false,
      zoomAnimation: !reducedMotion,
      fadeAnimation: !reducedMotion,
      markerZoomAnimation: !reducedMotion,
      attributionControl: true,
    });
    map.current = instance;
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
    }).addTo(instance);
    let failures = 0;
    tiles.on('tileerror', () => {
      if (++failures >= 3 && mounted.current) setTileError(true);
    });
    tiles.on('tileload', () => {
      if (mounted.current) setTileError(false);
    });
    instance.on('click', (event: L.LeafletMouseEvent) => {
      if (locked.current) return;
      if (activating.current) {
        activating.current = false;
        return;
      }
      const location = event.latlng.wrap();
      callback.current({
        latitude: Number(location.lat.toFixed(6)),
        longitude: Number(location.lng.toFixed(6)),
      });
      setLocationError(null);
    });
    // 페이지를 스크롤하다 지도가 확대되지 않게, 지도를 누르거나 키보드로 들어온 뒤에만 휠로 확대한다.
    // 포인터가 지도 밖으로 나가거나 포커스가 지도를 떠나면 다시 끈다.
    const element = container.current;
    const enableWheel = () => {
      instance.scrollWheelZoom.enable();
      if (mounted.current) setWheelZoom(true);
    };
    const disableWheel = () => {
      instance.scrollWheelZoom.disable();
      if (mounted.current) setWheelZoom(false);
    };
    // 핀이 이미 있으면 휠 확대를 켜는 첫 마우스 누름으로는 핀을 옮기지 않는다 (확인 표시와 주소가 그대로다).
    // 새 덕장의 첫 핀은 한 번에 놓인다. 터치는 두 손가락으로 확대하므로 막지 않는다.
    const press = (event: PointerEvent) => {
      activating.current =
        event.pointerType === 'mouse' && !instance.scrollWheelZoom.enabled() && pinned.current;
      enableWheel();
    };
    const leaveFocus = (event: FocusEvent) => {
      if (!element.contains(event.relatedTarget as Node | null)) disableWheel();
    };
    element.addEventListener('pointerdown', press);
    element.addEventListener('focusin', enableWheel);
    element.addEventListener('mouseleave', disableWheel);
    element.addEventListener('focusout', leaveFocus);
    const observer = new ResizeObserver(() => instance.invalidateSize());
    observer.observe(element);
    return () => {
      mounted.current = false;
      element.removeEventListener('pointerdown', press);
      element.removeEventListener('focusin', enableWheel);
      element.removeEventListener('mouseleave', disableWheel);
      element.removeEventListener('focusout', leaveFocus);
      observer.disconnect();
      instance.remove();
      map.current = null;
      marker.current = null;
    };
  }, []);

  useEffect(() => {
    if (!value || !map.current) return;
    setLatitude(value.latitude.toString());
    setLongitude(value.longitude.toString());
    setCoordinatesDirty(false);
    const coordinates: L.LatLngTuple = [value.latitude, value.longitude];
    if (!marker.current) {
      marker.current = L.marker(coordinates, {
        draggable: !disabled,
        title: '덕장 위치. 핀을 끌어 위치를 조정할 수 있어요.',
        alt: '선택한 덕장 위치',
        icon: L.divIcon({
          className: 'ws-map-pin',
          html: '<svg viewBox="0 0 36 44" width="36" height="44" aria-hidden="true"><path d="M18 42S3 26 3 18a15 15 0 1 1 30 0c0 8-15 24-15 24Z" fill="#262626" stroke="white" stroke-width="2.5"/><circle cx="18" cy="18" r="5" fill="white"/></svg>',
          iconSize: [36, 44],
          iconAnchor: [18, 43],
        }),
      }).addTo(map.current);
      marker.current.on('dragend', () => {
        if (locked.current) return;
        const location = marker.current?.getLatLng().wrap();
        if (location)
          callback.current({
            latitude: Number(location.lat.toFixed(6)),
            longitude: Number(location.lng.toFixed(6)),
          });
      });
    } else {
      marker.current.setLatLng(coordinates);
    }
    if (!map.current.getBounds().pad(-0.12).contains(coordinates)) {
      map.current.setView(coordinates, Math.max(map.current.getZoom(), 15), { animate: false });
    }
  }, [value, disabled]);

  useEffect(() => {
    if (disabled) marker.current?.dragging?.disable();
    else marker.current?.dragging?.enable();
  }, [disabled]);

  function currentLocation() {
    if (locatingRef.current || disabled) return;
    setLocationError(null);
    if (!navigator.geolocation) {
      setLocationError('이 브라우저는 현재 위치를 지원하지 않아요. 지도나 좌표로 선택해 주세요.');
      return;
    }
    locatingRef.current = true;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        locatingRef.current = false;
        if (!mounted.current) return;
        setLocating(false);
        if (locked.current) return;
        callback.current({
          latitude: Number(position.coords.latitude.toFixed(6)),
          longitude: Number(position.coords.longitude.toFixed(6)),
        });
      },
      (error) => {
        locatingRef.current = false;
        if (!mounted.current) return;
        setLocating(false);
        setLocationError(
          error.code === 1
            ? '위치 권한이 꺼져 있어요. 지도에서 선택하거나 좌표를 입력해 주세요.'
            : '현재 위치를 확인하지 못했어요. 지도에서 선택하거나 좌표를 입력해 주세요.',
        );
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  }

  function applyCoordinates() {
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (
      !latitude.trim() ||
      !longitude.trim() ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -85 ||
      lat > 85 ||
      lng < -180 ||
      lng > 180
    ) {
      setLocationError('위도 −85~85, 경도 −180~180 범위의 좌표를 입력해 주세요.');
      return;
    }
    setLocationError(null);
    onChange({ latitude: Number(lat.toFixed(6)), longitude: Number(lng.toFixed(6)) });
  }

  return (
    <div className="ws-location-picker">
      <div className="ws-location-heading">
        <div>
          <span className="ws-field-title">덕장 위치</span>
          <p>지도에서 덕장이 있는 곳을 눌러 주세요.</p>
        </div>
        <button
          type="button"
          className="ws-text-button"
          onClick={currentLocation}
          disabled={disabled || locating}
        >
          {locating ? <BusyIcon /> : <Crosshair size={15} />}
          {locating ? '확인 중' : '현재 위치'}
        </button>
      </div>
      <div className="ws-map-frame">
        <div
          ref={container}
          className="ws-location-map"
          aria-label="덕장 위치 선택 지도. 방향키로 이동할 수 있어요. 좌표 직접 입력도 가능해요."
        />
        {!value && (
          <div className="ws-map-hint">
            <MapPin size={15} />
            덕장 위치에 핀을 놓아 주세요
          </div>
        )}
        {!wheelZoom && (
          <div className="ws-map-wheel-hint" aria-hidden="true">
            <MousePointerClick size={14} />
            {value
              ? '지도를 한 번 누르면 스크롤로 확대할 수 있어요. 핀은 그다음에 누른 곳으로 옮겨져요.'
              : '지도를 누르면 핀이 놓이고 스크롤로 확대할 수 있어요.'}
          </div>
        )}
      </div>
      {tileError && (
        <p className="ws-field-note" role="status">
          지도를 불러오지 못했어요. 아래에서 좌표를 직접 입력할 수 있어요.
        </p>
      )}
      <div className={`ws-location-result${value ? ' is-selected' : ''}`} aria-live="polite">
        {confirmed ? <Check size={16} /> : <Navigation size={16} />}
        <span>
          {value
            ? `${value.latitude.toFixed(6)}, ${value.longitude.toFixed(6)}`
            : '아직 위치를 선택하지 않았어요'}
        </span>
        {value && <small>{confirmed ? '확인 완료' : '핀 위치를 확인해 주세요'}</small>}
      </div>
      <details className="ws-coordinates">
        <summary>
          좌표 직접 입력
          <ChevronDown size={14} />
        </summary>
        <div className="ws-coordinate-fields">
          <label className="ws-field" htmlFor={`${id}-latitude`}>
            <span>위도</span>
            <input
              id={`${id}-latitude`}
              type="number"
              step="any"
              min="-85"
              max="85"
              inputMode="decimal"
              value={latitude}
              onChange={(event) => {
                setLatitude(event.target.value);
                setCoordinatesDirty(true);
                onConfirm(false);
              }}
              placeholder="35.985000"
              disabled={disabled}
            />
          </label>
          <label className="ws-field" htmlFor={`${id}-longitude`}>
            <span>경도</span>
            <input
              id={`${id}-longitude`}
              type="number"
              step="any"
              min="-180"
              max="180"
              inputMode="decimal"
              value={longitude}
              onChange={(event) => {
                setLongitude(event.target.value);
                setCoordinatesDirty(true);
                onConfirm(false);
              }}
              placeholder="129.550000"
              disabled={disabled}
            />
          </label>
          <button
            type="button"
            className="ws-button ws-button--secondary ws-button--small"
            onClick={applyCoordinates}
            disabled={disabled}
          >
            좌표 적용
          </button>
        </div>
      </details>
      {locationError && (
        <p className="ws-field-error" role="alert">
          {locationError}
        </p>
      )}
      {coordinatesDirty && (
        <p className="ws-field-note">입력한 좌표를 적용한 뒤, 핀 위치를 확인해 주세요.</p>
      )}
      <label className={`ws-checkbox${!value || coordinatesDirty ? ' is-disabled' : ''}`}>
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => onConfirm(event.target.checked)}
          disabled={disabled || !value || coordinatesDirty}
        />
        <span>핀 위치가 실제 덕장 위치와 일치해요.</span>
      </label>
    </div>
  );
}
