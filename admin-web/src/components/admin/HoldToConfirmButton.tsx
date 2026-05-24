'use client';

/**
 * HoldToConfirmButton — 3초 길게 누르기 확인 버튼.
 *
 * 사용자 보고 (2026-05-24): 토너 타이머가 진행 중에 의도와 다르게 종료됨.
 *   audit 분석 결과 caller='user-button' 다중 호출 패턴 (0.187초 간격) 발견.
 *   가설: 모바일 ghost click / 키보드 race / 우발적 single tap.
 *
 * 해결: 단일 click + window.confirm 대신 3초 길게 눌러야만 fire되는 버튼.
 *   - mouseDown/touchStart 시작
 *   - mouseUp/touchEnd/touchCancel/mouseLeave 취소
 *   - 3초 holding 완료 → onConfirm 호출
 *   - 진행도 게이지 시각 피드백
 *   - 우발 클릭 100% 차단 (single tap으론 절대 fire 안 됨)
 */

import { useCallback, useEffect, useRef, useState } from 'react';

type Props = {
  onConfirm: () => void;
  label: string;
  holdMs?: number;
  className?: string;
  /** 비활성화 (예: 이미 진행 중) */
  disabled?: boolean;
};

export default function HoldToConfirmButton({
  onConfirm,
  label,
  holdMs = 3000,
  className = '',
  disabled = false,
}: Props) {
  const [progress, setProgress] = useState(0);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const firedRef = useRef(false);

  const cancel = useCallback(() => {
    startRef.current = null;
    firedRef.current = false;
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setProgress(0);
  }, []);

  const start = useCallback(() => {
    if (disabled) return;
    if (startRef.current != null) return; // 이미 누르는 중
    firedRef.current = false;
    startRef.current = Date.now();
    const tick = () => {
      if (startRef.current == null) return;
      const elapsed = Date.now() - startRef.current;
      const p = Math.min(1, elapsed / holdMs);
      setProgress(p);
      if (p >= 1) {
        if (!firedRef.current) {
          firedRef.current = true;
          startRef.current = null;
          rafRef.current = null;
          setProgress(0);
          onConfirm();
        }
      } else {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [disabled, holdMs, onConfirm]);

  useEffect(() => () => cancel(), [cancel]);

  const remainSec = Math.max(0, Math.ceil((1 - progress) * (holdMs / 1000)));
  const holding = progress > 0;

  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={(e) => e.preventDefault()}
      aria-label={`${label} (3초간 길게 누르세요)`}
      className={`relative overflow-hidden select-none ${className}`}
      style={{
        background: holding
          ? `linear-gradient(to right, rgba(239,68,68,0.85) ${progress * 100}%, rgba(239,68,68,0.10) ${progress * 100}%)`
          : 'rgba(239,68,68,0.10)',
        color: holding ? '#fff' : '#B91C1C',
        border: '1.5px solid rgba(239,68,68,0.40)',
        opacity: disabled ? 0.4 : 1,
        transition: holding ? 'none' : 'background 0.2s ease, color 0.2s ease',
        WebkitTapHighlightColor: 'transparent',
        touchAction: 'manipulation',
      }}
    >
      <span className="relative z-10">
        {holding ? `${remainSec}초 더 누르세요...` : label}
      </span>
    </button>
  );
}
