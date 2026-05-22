'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  createReservation,
  MAX_PARTICIPATING_GAME_LEN,
  MAX_PARTY_SIZE,
  MAX_RESERVATION_NOTE_LEN,
  MIN_PARTY_SIZE,
} from '@/lib/reservations';
import { checkWriteRateLimit, moderateText } from '@/lib/moderation';

/**
 * 매장 예약 작성 바텀시트.
 *
 * 필드 순서:
 *   1. 참가 닉네임 * (user.displayName 기본, 별칭 가능, 30자 이내)
 *   2. 방문 예정 시간 * (datetime-local, 현재 + 30분 이후 권장)
 *   3. 참가 인원 * (1~20, 기본 2명)
 *   4. 참가 게임 (선택, 200자 이내)
 *   5. 연락처 (선택)
 *   6. 요청 사항 (선택, 200자 이내)
 *
 * 저장: createReservation(...) 호출 → 성공 시 alert + onClose.
 * 디자인: 핫핑크 #FF1F8F, ReviewWriteSheet/LogoutConfirmSheet 패턴 일치.
 */

const MAX_DISPLAY_NAME_LEN = 30;

interface Props {
  storeId: string;
  storeName: string;
  authorUid: string;
  authorName: string;
  defaultPhone?: string;
  onClose: () => void;
}

/** 현재 시각 + (minutes)분 후의 datetime-local 표기. 로컬 타임존 기준 */
function toLocalInputValue(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

export default function ReservationSheet({
  storeId,
  storeName,
  authorUid,
  authorName,
  defaultPhone,
  onClose,
}: Props) {
  // 기본/최소 일시는 마운트 후 useEffect에서 계산 (Date.now()는 impure — 렌더 중 호출 금지)
  const [displayName, setDisplayName] = useState<string>(authorName ?? '');
  const [reservedFor, setReservedFor] = useState<string>('');
  const [minDateTime, setMinDateTime] = useState<string>('');
  const [partySize, setPartySize] = useState<number>(2);
  const [participatingGame, setParticipatingGame] = useState<string>('');
  const [phone, setPhone] = useState<string>(defaultPhone ?? '');
  const [note, setNote] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const router = useRouter();

  useEffect(() => {
    const now = Date.now();
    const def = new Date(now + 60 * 60 * 1000);
    def.setSeconds(0, 0);
    def.setMinutes(0);
    const min = new Date(now + 30 * 60 * 1000);
    min.setSeconds(0, 0);
    setReservedFor(toLocalInputValue(def));
    setMinDateTime(toLocalInputValue(min));
  }, []);

  // ESC로 닫기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // 오픈 시 스크롤 잠금
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const submit = async () => {
    setError(null);
    if (!authorUid) {
      setError('로그인이 필요합니다.');
      return;
    }
    const trimmedName = displayName.trim();
    if (!trimmedName) {
      setError('참가 닉네임을 입력해주세요.');
      return;
    }
    if (trimmedName.length > MAX_DISPLAY_NAME_LEN) {
      setError(`참가 닉네임은 ${MAX_DISPLAY_NAME_LEN}자 이내로 입력해주세요.`);
      return;
    }
    if (!reservedFor) {
      setError('방문 예정 시간을 선택해주세요.');
      return;
    }
    const reservedDate = new Date(reservedFor);
    if (Number.isNaN(reservedDate.getTime())) {
      setError('방문 일시가 올바르지 않습니다.');
      return;
    }
    if (reservedDate.getTime() < Date.now() + 25 * 60 * 1000) {
      setError('방문 일시는 현재로부터 30분 이후로 선택해주세요.');
      return;
    }
    if (
      !Number.isInteger(partySize) ||
      partySize < MIN_PARTY_SIZE ||
      partySize > MAX_PARTY_SIZE
    ) {
      setError(`인원은 ${MIN_PARTY_SIZE}~${MAX_PARTY_SIZE}명 사이여야 합니다.`);
      return;
    }
    const trimmedNote = note.trim();
    if (trimmedNote) {
      const check = moderateText(trimmedNote, {
        allowEmpty: true,
        maxLength: MAX_RESERVATION_NOTE_LEN,
      });
      if (!check.ok) {
        setError(check.message ?? '요청 사항에 부적절한 표현이 포함되어 있습니다.');
        return;
      }
    }
    const trimmedGame = participatingGame.trim();
    if (trimmedGame) {
      if (trimmedGame.length > MAX_PARTICIPATING_GAME_LEN) {
        setError(`참가 게임은 ${MAX_PARTICIPATING_GAME_LEN}자 이내로 입력해주세요.`);
        return;
      }
      const gameCheck = moderateText(trimmedGame, {
        allowEmpty: true,
        maxLength: MAX_PARTICIPATING_GAME_LEN,
      });
      if (!gameCheck.ok) {
        setError(gameCheck.message ?? '참가 게임에 부적절한 표현이 포함되어 있습니다.');
        return;
      }
    }
    // 단시간 다수 작성 차단
    const ok = await checkWriteRateLimit(authorUid, 'reservation');
    if (!ok) {
      setError('잠시 후 다시 시도해주세요 (단시간 다수 작성 차단).');
      return;
    }

    setBusy(true);
    try {
      await createReservation({
        storeId,
        storeName,
        authorUid,
        authorName: trimmedName,
        authorPhone: phone.trim() || null,
        reservedFor: reservedDate,
        partySize,
        participatingGame: trimmedGame || null,
        note: trimmedNote || null,
      });
      alert('예약이 접수되었습니다. 매장 확인 후 알림드립니다.');
      onClose();
      // 예약 신청 후 홈으로 자동 이동 — 홈 상단 노란 banner에서 진행 상태 확인 가능.
      router.push('/m');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      role="dialog"
      aria-modal="true"
      aria-label="매장 예약 신청"
    >
      <div
        ref={sheetRef}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-t-3xl px-5 pt-3 pb-6"
        style={{
          background: 'var(--surface-1)',
          maxHeight: '92vh',
          overflowY: 'auto',
          paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 24px)',
          animation: 'slideUpRsv 0.22s ease-out',
        }}
      >
        {/* 핸들 */}
        <div className="flex justify-center mb-3">
          <div className="w-10 h-1 rounded-full" style={{ background: 'var(--border)' }} />
        </div>

        <div className="text-[18px] font-extrabold mb-0.5" style={{ color: 'var(--text-1)' }}>
          📅 예약 신청
        </div>
        <div className="text-[12px] mb-5" style={{ color: 'var(--text-3)' }}>{storeName}</div>

        {/* 1. 참가 닉네임 */}
        <div className="mb-5">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[12px] font-bold" style={{ color: 'var(--text-2)' }}>
              참가 닉네임 <span style={{ color: '#FF1F8F' }}>*</span>
            </div>
            <div
              className="text-[11px] font-mono"
              style={{
                color:
                  displayName.length > MAX_DISPLAY_NAME_LEN ? 'var(--live)' : 'var(--text-3)',
              }}
            >
              {displayName.length}/{MAX_DISPLAY_NAME_LEN}
            </div>
          </div>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={MAX_DISPLAY_NAME_LEN + 10}
            placeholder="예: 홍길동"
            className="w-full px-3 py-2.5 rounded-xl text-[14px] outline-none"
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              color: 'var(--text-1)',
            }}
          />
          <div className="text-[10px] mt-1.5" style={{ color: 'var(--text-3)' }}>
            매장에 보일 이름이에요. 별칭으로 바꿔도 됩니다.
          </div>
        </div>

        {/* 2. 방문 예정 시간 */}
        <div className="mb-5">
          <div className="text-[12px] font-bold mb-2" style={{ color: 'var(--text-2)' }}>
            방문 예정 시간 <span style={{ color: '#FF1F8F' }}>*</span>
          </div>
          <input
            type="datetime-local"
            value={reservedFor}
            min={minDateTime}
            onChange={(e) => setReservedFor(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl text-[14px] outline-none"
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              color: 'var(--text-1)',
            }}
          />
          <div className="text-[10px] mt-1.5" style={{ color: 'var(--text-3)' }}>
            현재로부터 최소 30분 이후만 선택할 수 있어요
          </div>
        </div>

        {/* 3. 참가 인원 */}
        <div className="mb-5">
          <div className="text-[12px] font-bold mb-2" style={{ color: 'var(--text-2)' }}>
            참가 인원 <span style={{ color: '#FF1F8F' }}>*</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setPartySize((n) => Math.max(MIN_PARTY_SIZE, n - 1))}
              disabled={partySize <= MIN_PARTY_SIZE}
              className="w-10 h-10 rounded-xl text-[18px] font-extrabold transition active:scale-95 disabled:opacity-40"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
              aria-label="인원 줄이기"
            >
              −
            </button>
            <div
              className="flex-1 text-center text-[16px] font-extrabold font-mono py-2 rounded-xl"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
              aria-live="polite"
            >
              {partySize}명
            </div>
            <button
              type="button"
              onClick={() => setPartySize((n) => Math.min(MAX_PARTY_SIZE, n + 1))}
              disabled={partySize >= MAX_PARTY_SIZE}
              className="w-10 h-10 rounded-xl text-[18px] font-extrabold transition active:scale-95 disabled:opacity-40"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
              aria-label="인원 늘리기"
            >
              ＋
            </button>
          </div>
          <div className="text-[10px] mt-1.5" style={{ color: 'var(--text-3)' }}>
            {MIN_PARTY_SIZE}~{MAX_PARTY_SIZE}명까지 선택 가능
          </div>
        </div>

        {/* 4. 참가 게임 (선택) */}
        <div className="mb-5">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[12px] font-bold" style={{ color: 'var(--text-2)' }}>
              참가 게임 <span style={{ color: 'var(--text-3)', fontWeight: 600 }}>(선택)</span>
            </div>
            <div
              className="text-[11px] font-mono"
              style={{
                color:
                  participatingGame.length > MAX_PARTICIPATING_GAME_LEN
                    ? 'var(--live)'
                    : 'var(--text-3)',
              }}
            >
              {participatingGame.length}/{MAX_PARTICIPATING_GAME_LEN}
            </div>
          </div>
          <input
            type="text"
            value={participatingGame}
            onChange={(e) => setParticipatingGame(e.target.value)}
            maxLength={MAX_PARTICIPATING_GAME_LEN + 10}
            placeholder="예: NL 100/200 캐시, 무료 토너"
            className="w-full px-3 py-2.5 rounded-xl text-[14px] outline-none"
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              color: 'var(--text-1)',
            }}
          />
        </div>

        {/* 5. 연락처 (선택) */}
        <div className="mb-5">
          <div className="text-[12px] font-bold mb-2" style={{ color: 'var(--text-2)' }}>
            연락처 <span style={{ color: 'var(--text-3)', fontWeight: 600 }}>(선택 · 매장이 변경 사항 안내 시 사용)</span>
          </div>
          <input
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            maxLength={20}
            placeholder="010-0000-0000"
            className="w-full px-3 py-2.5 rounded-xl text-[14px] outline-none"
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              color: 'var(--text-1)',
            }}
          />
        </div>

        {/* 6. 요청 사항 (선택) */}
        <div className="mb-5">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[12px] font-bold" style={{ color: 'var(--text-2)' }}>
              요청 사항 <span style={{ color: 'var(--text-3)', fontWeight: 600 }}>(선택)</span>
            </div>
            <div
              className="text-[11px] font-mono"
              style={{
                color:
                  note.length > MAX_RESERVATION_NOTE_LEN ? 'var(--live)' : 'var(--text-3)',
              }}
            >
              {note.length}/{MAX_RESERVATION_NOTE_LEN}
            </div>
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={MAX_RESERVATION_NOTE_LEN + 50}
            rows={3}
            placeholder="예) 주차 가능한 자리 부탁드려요 / 토너 참가 문의"
            className="w-full px-3 py-2.5 rounded-xl text-[14px] outline-none resize-none leading-relaxed"
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              color: 'var(--text-1)',
              minHeight: 80,
            }}
          />
        </div>

        {error && (
          <div
            className="mb-3 px-3 py-2 rounded-xl text-[12px] font-bold"
            style={{ background: 'rgba(229,62,62,0.10)', color: 'var(--live)' }}
          >
            {error}
          </div>
        )}

        {/* 액션 버튼 */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex-1 py-3 rounded-xl text-[14px] font-bold disabled:opacity-40 transition active:scale-[0.98]"
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              color: 'var(--text-2)',
            }}
          >
            취소
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="flex-1 py-3 rounded-xl text-[14px] font-extrabold text-white disabled:opacity-50 transition active:scale-[0.98]"
            style={{ background: '#FF1F8F', boxShadow: '0 4px 12px rgba(255,31,143,0.30)' }}
          >
            {busy ? '신청 중…' : '예약 신청'}
          </button>
        </div>

        <style>{`
          @keyframes slideUpRsv {
            from { transform: translateY(100%); }
            to { transform: translateY(0); }
          }
        `}</style>
      </div>
    </div>
  );
}
