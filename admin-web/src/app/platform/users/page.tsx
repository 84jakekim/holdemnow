'use client';

/**
 * /platform/users — 본사 사용자 관리
 *
 * 목적: 비밀번호 분실 사용자에게 재설정 메일을 발송하거나,
 *       소셜 로그인 사용자에겐 적절한 안내 문구를 본사가 카톡으로 즉시 전달.
 *
 * 보안 정책:
 *   - 본사는 사용자 비밀번호를 직접 볼 수 없음
 *   - 재설정 메일 발송 → 사용자가 직접 새 비밀번호 설정
 *   - 모든 작업은 감사 로그에 기록 (sendPasswordResetByAdmin 내부에서 처리)
 *
 * UX:
 *   - 상단 검색 input (200ms debounce)
 *   - 빈 키워드면 최근 가입 50명
 *   - 카드별 인증 방식 배지 (우선: Firestore doc 기반 추정, 정확: 클릭 시 fetch)
 *   - 인증 방식별 액션 분기:
 *       Email/비번 → [🔑 비번 재설정 메일]
 *       Google     → [안내 메시지 복사] (myaccount.google.com)
 *       Kakao      → [안내 메시지 복사] (카카오 설정)
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  sendPasswordResetByAdmin,
  searchUsers,
  getUserAuthInfo,
  type UserSearchResult,
  type UserAuthInfo,
  type SendPasswordResetResult,
} from '@/lib/userAdmin';

type AuthKind = 'email' | 'google' | 'kakao' | 'unknown';

interface CardState {
  loading: boolean;
  success: boolean;
  error: string | null;
  socialBlocked?: { providers: string[] } | null; // sendPasswordReset 응답 reason=no_password
  copied?: 'google' | 'kakao' | null;
  authInfo?: UserAuthInfo | null; // 클릭 시 정확히 fetch한 결과
  authInfoLoading?: boolean;
}

const GOOGLE_NOTICE = `안녕하세요, Pink Rabbit입니다.
Google 계정으로 가입하신 분이라 우리 앱에서 비밀번호 재설정을 도와드릴 수 없습니다.
Google 계정 비밀번호 분실 시 아래 페이지에서 재설정 가능합니다:
https://accounts.google.com/signin/recovery`;

const KAKAO_NOTICE = `안녕하세요, Pink Rabbit입니다.
카카오 계정으로 가입하신 분이라 우리 앱에서 비밀번호 재설정을 도와드릴 수 없습니다.
카카오 계정 비밀번호 분실 시 카카오톡 → 더보기 → 설정 → 카카오계정 → 비밀번호 변경에서 가능합니다.`;

/** Firestore users doc · uid 접두사 기반으로 가입 방식 추정 */
function inferAuthKind(u: UserSearchResult): AuthKind {
  if (u.uid?.startsWith('kakao:')) return 'kakao';
  const providers = (u.providers ?? []).map((p) => p.toLowerCase());
  if (providers.includes('google') || providers.includes('google.com')) return 'google';
  if (providers.includes('kakao') || providers.includes('oidc.kakao')) return 'kakao';
  if (providers.includes('password')) return 'email';
  // 그 외 — 이메일 있으면 비번 추정
  if (u.email) return 'email';
  return 'unknown';
}

/** Cloud Function fetch 결과(정확)로 가입 방식 확정 */
function authKindFromInfo(info: UserAuthInfo): AuthKind {
  if (info.hasKakao) return 'kakao';
  if (info.hasGoogle) return 'google';
  if (info.hasPassword) return 'email';
  return 'unknown';
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

  // 카드 클릭 시 정확한 authInfo fetch (이미 fetch했으면 skip)
  const ensureAuthInfo = async (u: UserSearchResult) => {
    if (cardState[u.uid]?.authInfo || cardState[u.uid]?.authInfoLoading) return;
    setCardState((s) => ({
      ...s,
      [u.uid]: { ...(s[u.uid] ?? { loading: false, success: false, error: null }), authInfoLoading: true },
    }));
    try {
      const info = await getUserAuthInfo(u.uid);
      setCardState((s) => ({
        ...s,
        [u.uid]: {
          ...(s[u.uid] ?? { loading: false, success: false, error: null }),
          authInfo: info,
          authInfoLoading: false,
        },
      }));
    } catch (e: unknown) {
      setCardState((s) => ({
        ...s,
        [u.uid]: {
          ...(s[u.uid] ?? { loading: false, success: false, error: null }),
          authInfoLoading: false,
          error: e instanceof Error ? `인증 정보 조회 실패: ${e.message}` : '인증 정보 조회 실패',
        },
      }));
    }
  };

  const handleReset = async (u: UserSearchResult) => {
    const ok = window.confirm(
      `${u.email ?? u.uid} 에게 비밀번호 재설정 메일을 보낼까요?`,
    );
    if (!ok) return;

    setCardState((s) => ({
      ...s,
      [u.uid]: {
        ...(s[u.uid] ?? {}),
        loading: true,
        success: false,
        error: null,
        socialBlocked: null,
      },
    }));

    try {
      const result: SendPasswordResetResult = await sendPasswordResetByAdmin({ targetUid: u.uid });
      if (!result.success && result.reason === 'no_password') {
        // 알고 보니 소셜 로그인 사용자였음
        setCardState((s) => ({
          ...s,
          [u.uid]: {
            ...(s[u.uid] ?? {}),
            loading: false,
            success: false,
            error: null,
            socialBlocked: { providers: result.providers ?? [] },
          },
        }));
        return;
      }
      setCardState((s) => ({
        ...s,
        [u.uid]: { ...(s[u.uid] ?? {}), loading: false, success: true, error: null, socialBlocked: null },
      }));
      // 15초 후 성공 표시 제거
      if (successTimers.current[u.uid]) {
        clearTimeout(successTimers.current[u.uid]);
      }
      successTimers.current[u.uid] = setTimeout(() => {
        setCardState((s) => {
          const next = { ...s };
          if (next[u.uid]) next[u.uid] = { ...next[u.uid], success: false };
          return next;
        });
      }, 15_000);
    } catch (e: unknown) {
      setCardState((s) => ({
        ...s,
        [u.uid]: {
          ...(s[u.uid] ?? {}),
          loading: false,
          success: false,
          error: e instanceof Error ? e.message : '메일 발송 실패',
        },
      }));
    }
  };

  const handleCopyNotice = async (uid: string, kind: 'google' | 'kakao') => {
    const text = kind === 'google' ? GOOGLE_NOTICE : KAKAO_NOTICE;
    try {
      await navigator.clipboard.writeText(text);
      setCardState((s) => ({
        ...s,
        [uid]: { ...(s[uid] ?? { loading: false, success: false, error: null }), copied: kind },
      }));
      // 3초 후 복사 표시 제거
      setTimeout(() => {
        setCardState((s) => {
          if (!s[uid]) return s;
          return { ...s, [uid]: { ...s[uid], copied: null } };
        });
      }, 3000);
    } catch {
      setCardState((s) => ({
        ...s,
        [uid]: {
          ...(s[uid] ?? { loading: false, success: false, error: null }),
          error: '클립보드 복사 실패 — 브라우저 권한을 확인하세요.',
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
        <div className="section-title" style={{ color: 'var(--gold)' }}>USER MANAGEMENT</div>
        <h1 className="h2" style={{ color: 'var(--text-1)' }}>
          👥 사용자 관리
        </h1>
        <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
          비밀번호 분실 사용자에게 재설정 메일을 발송하거나, 소셜 로그인 사용자에게 안내합니다.
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
          이메일/비번 사용자는 재설정 메일을 보내면 사용자가 직접 새 비밀번호를 설정합니다.
          <br />
          Google·카카오 가입자는 안내 문구를 카톡으로 보내 해당 서비스에서 재설정하도록 안내합니다.
          <br />
          모든 작업은 감사 로그에 기록됩니다.
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
        {users.map((u) => (
          <UserCard
            key={u.uid}
            user={u}
            state={cardState[u.uid]}
            onReset={() => handleReset(u)}
            onCopyNotice={(kind) => handleCopyNotice(u.uid, kind)}
            onEnsureAuthInfo={() => ensureAuthInfo(u)}
          />
        ))}
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

// =====================================================================
// UserCard — 카드별 분기 UI
// =====================================================================

interface UserCardProps {
  user: UserSearchResult;
  state?: CardState;
  onReset: () => void;
  onCopyNotice: (kind: 'google' | 'kakao') => void;
  onEnsureAuthInfo: () => void;
}

function UserCard({ user, state, onReset, onCopyNotice, onEnsureAuthInfo }: UserCardProps) {
  // 우선 표시: Firestore doc · uid 접두사 기반
  const inferredKind = useMemo(() => inferAuthKind(user), [user]);
  // 정확: 클릭 후 fetch
  const confirmedKind = state?.authInfo ? authKindFromInfo(state.authInfo) : null;
  // socialBlocked는 sendPasswordReset 응답에서 알아낸 결과 — 가장 신뢰
  const blockedKind = state?.socialBlocked
    ? state.socialBlocked.providers.includes('kakao') || state.socialBlocked.providers.includes('oidc.kakao')
      ? 'kakao'
      : state.socialBlocked.providers.includes('google.com') || state.socialBlocked.providers.includes('google')
        ? 'google'
        : 'unknown'
    : null;

  const kind: AuthKind = (blockedKind ?? confirmedKind ?? inferredKind) as AuthKind;

  return (
    <div
      className="platform-user-card rounded-xl px-4 py-3.5 flex flex-col sm:flex-row sm:items-start gap-3"
      style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        color: 'var(--text-1)',
      }}
    >
      {/* 사용자 정보 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <div
            className="font-bold text-sm truncate"
            style={{ color: 'var(--text-1)' }}
          >
            {user.displayName ?? '(닉네임 없음)'}
          </div>
          <AuthBadge kind={kind} confirmed={!!confirmedKind || !!blockedKind} />
        </div>
        <div
          className="text-xs truncate mt-0.5"
          style={{ color: 'var(--text-2)' }}
        >
          {user.email ?? '(이메일 없음)'}
        </div>
        <div
          className="text-[11px] mt-1 flex items-center gap-2 flex-wrap"
          style={{ color: 'var(--text-3)' }}
        >
          <span>
            Role:{' '}
            <span style={{ color: 'var(--text-2)', fontWeight: 600 }}>
              {user.role ?? 'player'}
            </span>
          </span>
          <span>·</span>
          <span>가입: {formatDate(user.createdAt)}</span>
        </div>

        {/* 성공 메시지 */}
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

        {/* socialBlocked 토스트 — 클릭한 사용자가 알고 보니 소셜이었을 때 */}
        {state?.socialBlocked && (
          <div
            className="mt-2 rounded-md px-2.5 py-1.5 text-[11px]"
            style={{
              background: 'rgba(245,158,11,0.12)',
              border: '1px solid var(--gold, #f59e0b)',
              color: 'var(--gold, #f59e0b)',
            }}
          >
            ⚠️ 이 사용자는 {blockedKind === 'google' ? 'Google' : blockedKind === 'kakao' ? '카카오' : '소셜 로그인'}으로 가입했습니다. 메일 발송 불가 — 아래 안내 복사 버튼을 사용해 주세요.
          </div>
        )}

        {/* 안내 박스 (Google/Kakao) */}
        {kind === 'google' && (
          <div
            className="mt-2 rounded-md px-2.5 py-2 text-[11px] leading-relaxed"
            style={{
              background: 'rgba(59,130,246,0.08)',
              border: '1px solid rgba(59,130,246,0.45)',
              color: 'var(--text-2)',
            }}
          >
            Google 계정으로 가입한 사용자입니다. 비밀번호 재설정은 Google 계정 자체에서만 가능합니다.{' '}
            <a
              href="https://myaccount.google.com/security"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#60a5fa', fontWeight: 600 }}
            >
              myaccount.google.com/security
            </a>{' '}
            를 안내해 주세요.
          </div>
        )}
        {kind === 'kakao' && (
          <div
            className="mt-2 rounded-md px-2.5 py-2 text-[11px] leading-relaxed"
            style={{
              background: 'rgba(245,158,11,0.08)',
              border: '1px solid rgba(245,158,11,0.45)',
              color: 'var(--text-2)',
            }}
          >
            카카오 계정으로 가입한 사용자입니다. 비밀번호는 카카오에서 관리합니다.
          </div>
        )}

        {/* 복사 완료 토스트 */}
        {state?.copied && (
          <div
            className="mt-2 rounded-md px-2.5 py-1.5 text-[11px] font-bold inline-flex items-center gap-1.5"
            style={{
              background: 'rgba(34,197,94,0.12)',
              border: '1px solid var(--success, #22c55e)',
              color: 'var(--success, #22c55e)',
            }}
          >
            📋 안내 문구가 클립보드에 복사되었습니다 — 카톡에 붙여넣기
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

      {/* 액션 버튼 — 인증 방식 분기 */}
      <div className="flex-shrink-0 flex flex-col gap-1.5 items-stretch sm:items-end">
        {kind === 'email' && (
          <button
            type="button"
            onClick={() => {
              onEnsureAuthInfo();
              onReset();
            }}
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
        )}

        {kind === 'google' && (
          <>
            <div
              className="rounded-lg px-3.5 py-2 text-xs font-extrabold text-center"
              style={{
                background: 'var(--surface-2)',
                color: 'var(--text-3)',
                border: '1px solid var(--border)',
                minWidth: 132,
              }}
            >
              🔵 Google 사용자
            </div>
            <button
              type="button"
              onClick={() => onCopyNotice('google')}
              className="rounded-lg px-3.5 py-2 text-xs font-extrabold transition"
              style={{
                background: 'transparent',
                color: 'var(--text-1)',
                border: '1px solid var(--border)',
                minWidth: 132,
              }}
            >
              📋 안내 메시지 복사
            </button>
          </>
        )}

        {kind === 'kakao' && (
          <>
            <div
              className="rounded-lg px-3.5 py-2 text-xs font-extrabold text-center"
              style={{
                background: 'var(--surface-2)',
                color: 'var(--text-3)',
                border: '1px solid var(--border)',
                minWidth: 132,
              }}
            >
              🟡 카카오 사용자
            </div>
            <button
              type="button"
              onClick={() => onCopyNotice('kakao')}
              className="rounded-lg px-3.5 py-2 text-xs font-extrabold transition"
              style={{
                background: 'transparent',
                color: 'var(--text-1)',
                border: '1px solid var(--border)',
                minWidth: 132,
              }}
            >
              📋 안내 메시지 복사
            </button>
          </>
        )}

        {kind === 'unknown' && (
          <button
            type="button"
            onClick={() => {
              onEnsureAuthInfo();
              onReset();
            }}
            disabled={state?.loading || state?.authInfoLoading}
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
        )}
      </div>
    </div>
  );
}

// =====================================================================
// AuthBadge
// =====================================================================

function AuthBadge({ kind, confirmed }: { kind: AuthKind; confirmed: boolean }) {
  const config: Record<AuthKind, { label: string; bg: string; color: string; border: string }> = {
    email: {
      label: '⚪ 이메일/비번',
      bg: 'rgba(148,163,184,0.12)',
      color: '#cbd5e1',
      border: 'rgba(148,163,184,0.45)',
    },
    google: {
      label: '🔵 Google',
      bg: 'rgba(59,130,246,0.12)',
      color: '#60a5fa',
      border: 'rgba(59,130,246,0.45)',
    },
    kakao: {
      label: '🟡 카카오',
      bg: 'rgba(245,158,11,0.14)',
      color: '#fbbf24',
      border: 'rgba(245,158,11,0.55)',
    },
    unknown: {
      label: '⚪ 미확인',
      bg: 'rgba(148,163,184,0.10)',
      color: 'var(--text-3)',
      border: 'var(--border)',
    },
  };
  const c = config[kind];
  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold whitespace-nowrap"
      style={{
        background: c.bg,
        color: c.color,
        border: `1px solid ${c.border}`,
      }}
      title={confirmed ? '확정 (Cloud Function 조회 완료)' : '추정 (Firestore 문서 기반 — 메일 발송 시 확정)'}
    >
      {c.label}
      {!confirmed && <span style={{ opacity: 0.6, marginLeft: 2 }}>?</span>}
    </span>
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
