'use client';

/**
 * /platform/users — 본사 사용자 관리
 *
 * 목적: 비밀번호 분실 사용자에게 재설정 메일을 발송하는 도구.
 *
 * 보안 정책:
 *   - 본사는 사용자 비밀번호를 직접 볼 수 없음
 *   - 재설정 메일 발송 → 사용자가 직접 새 비밀번호 설정
 *   - 모든 작업은 감사 로그에 기록 (sendPasswordResetByAdmin 내부에서 처리)
 *
 * UX:
 *   - 상단 검색 input (200ms debounce)
 *   - 빈 키워드면 최근 가입 50명
 *   - 카드별 [🔑 비번 재설정 메일] 버튼
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  sendPasswordResetByAdmin,
  searchUsers,
  type UserSearchResult,
} from '@/lib/userAdmin';

interface CardState {
  loading: boolean;
  success: boolean;
  error: string | null;
}

export default function PlatformUsersPage() {
  const [keyword, setKeyword] = useState('');
  const [debounced, setDebounced] = useState('');
  const [users, setUsers] = useState<UserSearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  // 카드별 상태 (uid → CardState)
  const [cardState, setCardState] = useState<Record<string, CardState>>({});
  // 성공 메시지 자동 사라짐 타이머
  const successTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // 디바운스 (200ms)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(keyword.trim()), 200);
    return () => clearTimeout(t);
  }, [keyword]);

  // 검색
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setListError(null);
    searchUsers(debounced)
      .then((rows) => {
        if (!alive) return;
        setUsers(rows);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setListError(e instanceof Error ? e.message : '검색 실패');
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [debounced]);

  // 언마운트 시 타이머 정리
  useEffect(() => {
    const timers = successTimers.current;
    return () => {
      Object.values(timers).forEach((t) => clearTimeout(t));
    };
  }, []);

  const handleReset = async (u: UserSearchResult) => {
    const ok = window.confirm(
      `${u.email ?? u.uid} 에게 비밀번호 재설정 메일을 보낼까요?`,
    );
    if (!ok) return;

    setCardState((s) => ({
      ...s,
      [u.uid]: { loading: true, success: false, error: null },
    }));

    try {
      await sendPasswordResetByAdmin({ targetUid: u.uid });
      setCardState((s) => ({
        ...s,
        [u.uid]: { loading: false, success: true, error: null },
      }));
      // 15초 후 성공 표시 제거
      if (successTimers.current[u.uid]) {
        clearTimeout(successTimers.current[u.uid]);
      }
      successTimers.current[u.uid] = setTimeout(() => {
        setCardState((s) => {
          const next = { ...s };
          delete next[u.uid];
          return next;
        });
      }, 15_000);
    } catch (e: unknown) {
      setCardState((s) => ({
        ...s,
        [u.uid]: {
          loading: false,
          success: false,
          error: e instanceof Error ? e.message : '메일 발송 실패',
        },
      }));
    }
  };

  const total = users.length;
  const hasKeyword = debounced.length > 0;

  return (
    <div>
      {/* 상단 타이틀 */}
      <div className="mb-5">
        <h1
          className="text-2xl font-extrabold tracking-tight"
          style={{ color: 'var(--text-1)' }}
        >
          👥 사용자 관리
        </h1>
        <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
          비밀번호 분실 사용자에게 재설정 메일을 발송합니다.
        </p>
      </div>

      {/* 안내 박스 (노란 톤) */}
      <div
        className="mb-5 rounded-xl px-4 py-3 text-xs leading-relaxed"
        style={{
          background: 'rgba(245, 158, 11, 0.08)',
          border: '1px solid var(--gold)',
          color: 'var(--text-2)',
        }}
      >
        <div
          className="font-extrabold mb-1.5"
          style={{ color: 'var(--gold)', fontSize: 12 }}
        >
          ℹ️ 비밀번호 분실 사용자 도움 도구
        </div>
        <div>
          본사는 사용자 비밀번호를 직접 볼 수 없습니다 (보안 정책).
          <br />
          재설정 메일을 보내면 사용자가 직접 새 비밀번호를 설정합니다.
          <br />
          이 작업은 감사 로그에 기록됩니다.
        </div>
      </div>

      {/* 검색 input */}
      <div className="mb-4">
        <input
          type="text"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="🔍 검색: 이메일 · 닉네임"
          className="platform-users-search w-full rounded-lg px-3.5 py-2.5 text-sm outline-none"
          style={{
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            color: 'var(--text-1)',
          }}
        />
      </div>

      {/* 결과 헤더 */}
      <div
        className="mb-2 text-xs font-bold"
        style={{ color: 'var(--text-3)' }}
      >
        {loading
          ? '검색 중…'
          : hasKeyword
            ? `검색 결과 (${total}명)`
            : `최근 가입 사용자 (${total}명)`}
      </div>

      {/* 리스트 에러 */}
      {listError && (
        <div
          className="mb-3 rounded-lg px-3 py-2 text-xs"
          style={{
            background: 'rgba(239,68,68,0.10)',
            border: '1px solid rgba(239,68,68,0.45)',
            color: '#fca5a5',
          }}
        >
          {listError}
        </div>
      )}

      {/* 빈 상태 */}
      {!loading && users.length === 0 && !listError && (
        <div
          className="rounded-xl p-10 text-center text-sm"
          style={{
            background: 'var(--surface-1)',
            border: '1px dashed var(--border)',
            color: 'var(--text-3)',
          }}
        >
          {hasKeyword
            ? '검색 결과가 없습니다.'
            : '표시할 사용자가 없습니다.'}
        </div>
      )}

      {/* 카드 리스트 */}
      <div className="flex flex-col gap-2">
        {users.map((u) => {
          const state = cardState[u.uid];
          return (
            <div
              key={u.uid}
              className="platform-user-card rounded-xl px-4 py-3.5 flex flex-col sm:flex-row sm:items-center gap-3"
              style={{
                background: 'var(--surface-1)',
                border: '1px solid var(--border)',
                color: 'var(--text-1)',
              }}
            >
              {/* 사용자 정보 */}
              <div className="flex-1 min-w-0">
                <div
                  className="font-bold text-sm truncate"
                  style={{ color: 'var(--text-1)' }}
                >
                  {u.displayName ?? '(닉네임 없음)'}
                </div>
                <div
                  className="text-xs truncate mt-0.5"
                  style={{ color: 'var(--text-2)' }}
                >
                  {u.email ?? '(이메일 없음)'}
                </div>
                <div
                  className="text-[11px] mt-1 flex items-center gap-2 flex-wrap"
                  style={{ color: 'var(--text-3)' }}
                >
                  <span>
                    Role:{' '}
                    <span style={{ color: 'var(--text-2)', fontWeight: 600 }}>
                      {u.role ?? 'player'}
                    </span>
                  </span>
                  <span>·</span>
                  <span>가입: {formatDate(u.createdAt)}</span>
                </div>

                {/* 성공/에러 메시지 */}
                {state?.success && (
                  <div
                    className="mt-2 rounded-md px-2.5 py-1.5 text-[11px] font-bold inline-flex items-center gap-1.5"
                    style={{
                      background: 'rgba(34,197,94,0.12)',
                      border: '1px solid var(--success, #22c55e)',
                      color: 'var(--success, #22c55e)',
                    }}
                  >
                    ✅ 메일 발송됨 — 사용자가 메일 링크로 새 비밀번호 설정
                  </div>
                )}
                {state?.error && (
                  <div
                    className="mt-2 rounded-md px-2.5 py-1.5 text-[11px]"
                    style={{
                      background: 'rgba(239,68,68,0.10)',
                      border: '1px solid rgba(239,68,68,0.45)',
                      color: '#fca5a5',
                    }}
                  >
                    {state.error}
                  </div>
                )}
              </div>

              {/* 액션 버튼 */}
              <div className="flex-shrink-0">
                <button
                  type="button"
                  onClick={() => handleReset(u)}
                  disabled={state?.loading}
                  className="rounded-lg px-3.5 py-2 text-xs font-extrabold transition disabled:opacity-50"
                  style={{
                    background: 'var(--hotpink, #ec4899)',
                    color: '#fff',
                    border: '1px solid var(--hotpink, #ec4899)',
                    minWidth: 132,
                  }}
                >
                  {state?.loading ? '발송 중…' : '🔑 비번 재설정 메일'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* 페이지 전용 스타일 */}
      <style jsx global>{`
        .platform-users-search:focus {
          border-color: var(--hotpink, #ec4899) !important;
          box-shadow: 0 0 0 3px rgba(236, 72, 153, 0.18);
        }
        .platform-user-card:hover {
          background: var(--surface-2) !important;
        }
      `}</style>
    </div>
  );
}

function formatDate(input: UserSearchResult['createdAt']): string {
  if (!input) return '—';
  try {
    const d =
      typeof input.toDate === 'function' ? input.toDate() : null;
    if (!d || Number.isNaN(d.getTime())) return '—';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  } catch {
    return '—';
  }
}
