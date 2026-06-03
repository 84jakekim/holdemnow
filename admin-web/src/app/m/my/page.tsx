'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { updateProfile } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { useAuth } from '@/lib/hooks';
import AnonymousPrompt from '@/components/mobile/AnonymousPrompt';
import LogoutConfirmSheet from '@/components/mobile/LogoutConfirmSheet';
import RecentVisitsSection from '@/components/mobile/my/RecentVisitsSection';
import NoticeBoardSection from '@/components/mobile/my/NoticeBoardSection';
import NotificationBellButton from '@/components/mobile/NotificationBellButton';
import { doc, setDoc, onSnapshot, serverTimestamp, collection, collectionGroup, query, where } from 'firebase/firestore';
import { enableNotifications, getNotificationPermission, isMessagingSupported } from '@/lib/messaging';
import { moderateText, checkWriteRateLimit } from '@/lib/moderation';
import { normalizePhone } from '@/lib/phone';
import { setUserPhone } from '@/lib/userProfile';
import { changePassword, deleteOwnAccount, validatePassword } from '@/lib/emailAuth';

interface ProfileFields {
  displayName?: string;
  bio?: string;
  phone?: string;
}

interface NotificationPrefs {
  favLive: boolean;
  tournamentStart: boolean;
  lateRegImminent: boolean;
  marketing: boolean;
}

const DEFAULT_PREFS: NotificationPrefs = {
  favLive: true,
  tournamentStart: true,
  lateRegImminent: false,
  marketing: false,
};

const PREFS_CACHE_KEY = 'holdemnow:notifPrefs';

function loadCachedPrefs(): NotificationPrefs {
  if (typeof window === 'undefined') return DEFAULT_PREFS;
  try {
    const raw = window.localStorage.getItem(PREFS_CACHE_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<NotificationPrefs>;
    return { ...DEFAULT_PREFS, ...parsed };
  } catch {
    return DEFAULT_PREFS;
  }
}

function saveCachedPrefs(prefs: NotificationPrefs): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PREFS_CACHE_KEY, JSON.stringify(prefs));
  } catch { /* private mode */ }
}

export default function MyPage() {
  const authState = useAuth();
  const router = useRouter();
  // 2026-05-29: localStorage 캐시로 초기화 — 매 mount마다 DEFAULT(off)로 깜빡이는 현상 차단
  const [prefs, setPrefs] = useState<NotificationPrefs>(() => loadCachedPrefs());
  const [profile, setProfile] = useState<ProfileFields>({});
  const [loading, setLoading] = useState(true);
  const [favCount, setFavCount] = useState(0);
  const [seriesSubCount, setSeriesSubCount] = useState(0);
  const [interestCount, setInterestCount] = useState(0);
  const [reservationActiveCount, setReservationActiveCount] = useState(0);
  const [logoutSheetOpen, setLogoutSheetOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [pushTokenCount, setPushTokenCount] = useState<number | null>(null);
  const [pushPermission, setPushPermission] = useState<NotificationPermission | 'unsupported' | 'unknown'>('unknown');
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);

  useEffect(() => {
    if (authState.status !== 'authenticated') return;
    const uid = authState.user.uid;
    const u1 = onSnapshot(collection(db, 'users', uid, 'favorites'), (s) => setFavCount(s.size));
    const u2 = onSnapshot(collection(db, 'users', uid, 'seriesSubscriptions'), (s) => setSeriesSubCount(s.size));
    const u3 = onSnapshot(collection(db, 'users', uid, 'interests'), (s) => setInterestCount(s.size));
    const u4 = onSnapshot(collection(db, 'users', uid, 'fcmTokens'), (s) => setPushTokenCount(s.size));
    // 활성 예약(pending·confirmed) 카운트 — collectionGroup
    const u5 = onSnapshot(
      query(
        collectionGroup(db, 'reservations'),
        where('authorUid', '==', uid),
        where('status', 'in', ['pending', 'confirmed']),
      ),
      (s) => setReservationActiveCount(s.size),
      () => setReservationActiveCount(0),
    );
    return () => { u1(); u2(); u3(); u4(); u5(); };
  }, [authState]);

  // 브라우저 알림 권한·지원 여부 확인 (브라우저별 동적)
  useEffect(() => {
    (async () => {
      const supported = await isMessagingSupported();
      if (!supported) {
        setPushPermission('unsupported');
        return;
      }
      setPushPermission(getNotificationPermission());
    })();
  }, []);

  const handleEnableNotifications = async () => {
    if (authState.status !== 'authenticated') return;
    setPushBusy(true);
    setPushError(null);
    try {
      const token = await enableNotifications(authState.user.uid);
      if (token) {
        setPushPermission('granted');
      } else {
        setPushPermission(getNotificationPermission());
        setPushError(
          getNotificationPermission() === 'denied'
            ? '브라우저 설정에서 알림을 허용해 주세요'
            : '알림 활성화 실패 — 브라우저가 지원하지 않거나 권한이 거부되었습니다',
        );
      }
    } catch (e: unknown) {
      setPushError(e instanceof Error ? e.message : String(e));
    } finally {
      setPushBusy(false);
    }
  };

  useEffect(() => {
    if (authState.status !== 'authenticated') { setLoading(false); return; }
    const uid = authState.user.uid;
    const unsub = onSnapshot(
      doc(db, 'users', uid),
      (snap) => {
        const data = snap.data() as
          | { notificationPrefs?: NotificationPrefs; displayName?: string; bio?: string; phone?: string }
          | undefined;
        if (data?.notificationPrefs) {
          setPrefs(data.notificationPrefs);
          saveCachedPrefs(data.notificationPrefs);
        }
        setProfile({ displayName: data?.displayName, bio: data?.bio, phone: data?.phone });
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsub;
  }, [authState]);

  const togglePref = async (key: keyof NotificationPrefs) => {
    if (authState.status !== 'authenticated') return;
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    saveCachedPrefs(next);
    await setDoc(
      doc(db, 'users', authState.user.uid),
      { notificationPrefs: next, updatedAt: serverTimestamp() },
      { merge: true },
    );
  };

  if (authState.status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg)' }}>
        <div className="text-sm" style={{ color: 'var(--text-3)' }}>로딩 중…</div>
      </div>
    );
  }
  if (authState.status === 'anonymous') {
    return <AnonymousPrompt title="내정보" icon="👤" desc="관심 토너 · 즐겨찾기 · 알림 설정을 위해 로그인하세요." />;
  }

  const user = authState.user;
  // 이메일/비밀번호 가입자만 비밀번호 변경 노출 (소셜 로그인은 해당 제공자에서 관리)
  const isPasswordUser = user.providerData.some((p) => p.providerId === 'password');
  // Firestore profile.displayName이 가장 신뢰 가능한 최신값. fallback: auth displayName.
  const displayName = profile.displayName ?? user.displayName ?? '플레이어';
  const initials = (displayName?.[0] ?? user.email?.[0] ?? '?').toUpperCase();

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>

      {/* ── 헤더 ── */}
      <header
        className="px-5 h-14 flex items-center justify-between"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <span className="text-xl font-extrabold tracking-tight font-serif" style={{ color: 'var(--text-1)' }}>
          내정보
        </span>
        <NotificationBellButton variant="light" ariaLabel="알림" />
      </header>

      {/* ── 프로필 카드 — 핑크 hero 그라데이션 (handoff ScreenMy 패턴) ── */}
      <div className="px-4 pt-4 pb-3">
        <div
          className="relative overflow-hidden lift"
          style={{
            background: 'linear-gradient(135deg, #FF1F8F 0%, #FF6BAA 100%)',
            borderRadius: 22,
            padding: '18px 16px',
            color: '#fff',
            boxShadow: 'var(--shadow-hero)',
          }}
        >
          {/* 우상단 흰 글로우 */}
          <div
            style={{
              position: 'absolute', top: -28, right: -28,
              width: 160, height: 160, borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0) 65%)',
              pointerEvents: 'none',
            }}
          />

          <div className="relative flex items-center gap-3">
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center text-white text-2xl font-black flex-shrink-0"
              style={{ background: 'rgba(255,255,255,0.25)', border: '2px solid rgba(255,255,255,0.35)' }}
            >
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="text-[17px] font-black tracking-tight truncate" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.15)' }}>
                  {displayName}
                </div>
                <button
                  onClick={() => setEditOpen(true)}
                  className="text-[10px] font-extrabold px-2 py-0.5 rounded-full transition active:scale-95"
                  style={{
                    background: 'rgba(255,255,255,0.25)',
                    color: '#fff',
                    border: '1px solid rgba(255,255,255,0.35)',
                  }}
                >
                  ✎ 정보변경
                </button>
              </div>
              <div className="text-[11px] mt-1 truncate" style={{ color: 'rgba(255,255,255,0.85)' }}>{user.email}</div>
              {profile.bio && (
                <div className="text-[11px] mt-1 line-clamp-2" style={{ color: 'rgba(255,255,255,0.95)' }}>{profile.bio}</div>
              )}
            </div>
          </div>

          {/* 통계 4종 — hero 내부 grid */}
          <div className="relative grid grid-cols-4 gap-1.5 mt-3">
            {[
              { label: '즐겨찾기', value: favCount, go: '/m/favorites' },
              { label: '관심 토너', value: interestCount, go: '/m/interests' },
              { label: '내 예약', value: reservationActiveCount, go: '/m/reservations' },
              { label: '시리즈 구독', value: seriesSubCount, go: '/m/subscriptions' },
            ].map((k) => (
              <button
                key={k.label}
                onClick={() => router.push(k.go)}
                className="tap"
                style={{
                  background: 'rgba(255,255,255,0.18)',
                  borderRadius: 12,
                  padding: '8px 0',
                  textAlign: 'center',
                  border: '1px solid rgba(255,255,255,0.12)',
                }}
              >
                <div className="mono text-[18px] font-extrabold" style={{ color: '#fff' }}>{k.value}</div>
                <div className="text-[9px] mt-0.5" style={{ color: 'rgba(255,255,255,0.85)', fontWeight: 700 }}>{k.label}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
      <div style={{ borderBottom: '6px solid var(--surface-2)' }} />

      {/* ── 공지사항 게시판 (본사 고정 공지 모아보기) — 프로필 바로 아래 상단 배치 ── */}
      <NoticeBoardSection />

      {/* ── 메뉴 (2026-05-27 핸드오프 톤) ── */}
      <div className="px-5 py-4" style={{ borderBottom: '6px solid var(--surface-2)' }}>
        <div
          style={{
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: 14,
            overflow: 'hidden',
          }}
        >
          {([
            { label: '즐겨찾기 매장', go: '/m/favorites', emoji: '⭐' },
            { label: '관심 토너', go: '/m/interests', emoji: '🏆' },
            { label: '내 예약', go: '/m/reservations', emoji: '📅' },
            { label: '시리즈 구독', go: '/m/subscriptions', emoji: '📊' },
            { label: '내가 쓴 리뷰', go: '/m/my/reviews', emoji: '✍️' },
            { label: '도움말·문의', go: '/m/help', emoji: '💬' },
          ] as { label: string; go: string | null; emoji: string }[]).map((m, i, arr) => (
            <button
              key={m.label}
              onClick={() => m.go && router.push(m.go)}
              className="w-full tap"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '12px 14px',
                borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none',
                cursor: 'pointer',
                background: 'transparent',
                border: 'none',
                textAlign: 'left',
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: 'var(--brand-pale, #FFF0F7)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 18,
                  flexShrink: 0,
                }}
                aria-hidden="true"
              >
                {m.emoji}
              </div>
              <span
                style={{
                  flex: 1,
                  fontSize: 13,
                  fontWeight: 700,
                  letterSpacing: '-0.01em',
                  color: 'var(--text-1)',
                }}
              >
                {m.label}
              </span>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ color: 'var(--text-3)', flexShrink: 0 }}
                aria-hidden="true"
              >
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          ))}
        </div>
      </div>

      {/* ── 알림 설정 ── */}
      <div className="px-5 py-5" style={{ borderBottom: '6px solid var(--surface-2)' }}>
        <div className="text-base font-extrabold mb-4" style={{ color: 'var(--text-1)' }}>알림 설정</div>

        {/* 알림 권한 진단 카드 — 권한 + 토큰 상태 표시 + 활성화 버튼 */}
        <NotificationStatusCard
          permission={pushPermission}
          tokenCount={pushTokenCount}
          busy={pushBusy}
          error={pushError}
          onEnable={handleEnableNotifications}
        />

        {loading ? (
          <div className="text-sm" style={{ color: 'var(--text-3)' }}>로딩…</div>
        ) : (
          <div
            style={{
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: 14,
              overflow: 'hidden',
            }}
          >
            <PrefRow icon="🔴" label="즐겨찾기 매장 LIVE 시작" desc="실시간 즉시 알림" value={prefs.favLive} onToggle={() => togglePref('favLive')} />
            <PrefRow icon="⏰" label="관심 토너 시작 1시간 전" desc="시작 1시간 전 미리 알려드려요" value={prefs.tournamentStart} onToggle={() => togglePref('tournamentStart')} />
            <PrefRow icon="⏳" label="참가 마감 임박" desc="관심 토너 참가 마감 30분 전" value={prefs.lateRegImminent} onToggle={() => togglePref('lateRegImminent')} />
            <PrefRow icon="📢" label="매장 대회 마케팅" desc="광고성 알림 (선택)" value={prefs.marketing} onToggle={() => togglePref('marketing')} isLast />
          </div>
        )}
      </div>

      {/* ── 최근 방문 매장 ── */}
      <RecentVisitsSection />

      {/* ── 설정 그룹 (2026-05-27 핸드오프 톤) ── */}
      <div className="px-5 pt-4 pb-6">
        <div
          style={{
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: 14,
            overflow: 'hidden',
          }}
        >
          {([
            ...(isPasswordUser
              ? [{ label: '비밀번호 변경', emoji: '🔑', action: 'changePw' as const }]
              : []),
            { label: '약관 및 정책', emoji: '📜', go: '/legal' as const },
            { label: '로그아웃', emoji: '🚪', action: 'logout' as const },
          ] as Array<{ label: string; emoji: string; go?: '/legal'; action?: 'logout' | 'changePw' }>).map((it, i, arr) => (
            <button
              key={it.label}
              onClick={() => {
                if (it.action === 'logout') setLogoutSheetOpen(true);
                else if (it.action === 'changePw') setPwOpen(true);
                else if (it.go) router.push(it.go);
              }}
              className="w-full tap"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '12px 14px',
                borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none',
                cursor: 'pointer',
                background: 'transparent',
                border: 'none',
                textAlign: 'left',
              }}
            >
              <div
                style={{
                  width: 32,
                  fontSize: 16,
                  textAlign: 'center',
                  flexShrink: 0,
                }}
                aria-hidden="true"
              >
                {it.emoji}
              </div>
              <span
                style={{
                  flex: 1,
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--text-1)',
                }}
              >
                {it.label}
              </span>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ color: 'var(--text-3)', flexShrink: 0 }}
                aria-hidden="true"
              >
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          ))}
        </div>

        {/* 회원 탈퇴 — 눈에 띄지 않게 하단에 배치 */}
        <div style={{ textAlign: 'center', marginTop: 18 }}>
          <button
            onClick={() => setWithdrawOpen(true)}
            className="text-[11px] underline underline-offset-2"
            style={{ color: 'var(--text-3)' }}
          >
            회원 탈퇴
          </button>
        </div>

        <div
          className="mono"
          style={{
            textAlign: 'center',
            marginTop: 12,
            fontSize: 10,
            color: 'var(--text-3)',
          }}
        >
          Pink Rabbit BETA · HoldemNow v0.4
        </div>
      </div>

      {/* 로그아웃 확인 바텀시트 */}
      <LogoutConfirmSheet
        open={logoutSheetOpen}
        onClose={() => setLogoutSheetOpen(false)}
      />

      {/* 정보변경 시트 */}
      {editOpen && (
        <EditProfileSheet
          initial={{
            displayName: profile.displayName ?? user.displayName ?? '',
            bio: profile.bio ?? '',
            phone: profile.phone ?? '',
          }}
          uid={user.uid}
          onClose={() => setEditOpen(false)}
        />
      )}

      {/* 비밀번호 변경 시트 */}
      {pwOpen && <ChangePasswordSheet onClose={() => setPwOpen(false)} />}

      {/* 회원 탈퇴 시트 */}
      {withdrawOpen && (
        <WithdrawSheet
          isPasswordUser={isPasswordUser}
          onClose={() => setWithdrawOpen(false)}
          onDone={() => router.replace('/m')}
        />
      )}
    </div>
  );
}

/* ============================================================
 * 비밀번호 변경 시트 — 현재 비번 재인증 + 새 비번 설정
 * ========================================================== */
function ChangePasswordSheet({ onClose }: { onClose: () => void }) {
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newPwConfirm, setNewPwConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const save = async () => {
    setError(null);
    const v = validatePassword(newPw);
    if (v) { setError(v); return; }
    if (newPw !== newPwConfirm) { setError('새 비밀번호 확인이 일치하지 않습니다'); return; }
    setBusy(true);
    try {
      await changePassword(currentPw, newPw);
      setDone(true);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(
        /wrong-password|invalid-credential/.test(msg)
          ? '현재 비밀번호가 올바르지 않습니다'
          : msg,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div onClick={onClose} className="fixed inset-0 bg-black/55 z-50 flex items-end justify-center">
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-t-3xl px-5 pt-3 pb-6"
        style={{ background: 'var(--surface-1)' }}
      >
        <div className="flex justify-center mb-3">
          <div className="w-10 h-1 rounded-full" style={{ background: 'var(--border)' }} />
        </div>

        {done ? (
          <div className="py-4 text-center">
            <div className="text-lg font-extrabold mb-1" style={{ color: 'var(--text-1)' }}>비밀번호가 변경되었습니다</div>
            <div className="text-[12px] mb-5" style={{ color: 'var(--text-3)' }}>다음 로그인부터 새 비밀번호를 사용하세요.</div>
            <button
              onClick={onClose}
              className="w-full py-3 rounded-xl text-sm font-extrabold text-white"
              style={{ background: 'var(--brand)' }}
            >
              완료
            </button>
          </div>
        ) : (
          <>
            <div className="text-lg font-extrabold mb-1" style={{ color: 'var(--text-1)' }}>비밀번호 변경</div>
            <div className="text-[11px] mb-4" style={{ color: 'var(--text-3)' }}>보안을 위해 현재 비밀번호를 먼저 확인합니다</div>

            <div className="space-y-3.5">
              <PwInput label="현재 비밀번호" value={currentPw} onChange={setCurrentPw} placeholder="현재 비밀번호" autoComplete="current-password" />
              <PwInput label="새 비밀번호" value={newPw} onChange={setNewPw} placeholder="8자 이상, 영문+숫자" autoComplete="new-password" />
              <PwInput label="새 비밀번호 확인" value={newPwConfirm} onChange={setNewPwConfirm} placeholder="다시 입력" autoComplete="new-password" />
            </div>

            {error && (
              <div className="mt-3 px-3 py-2 rounded-lg text-[12px] font-bold" style={{ background: 'rgba(229,62,62,0.10)', color: 'var(--live)' }}>
                {error}
              </div>
            )}

            <div className="mt-5 flex gap-2">
              <button
                onClick={onClose}
                disabled={busy}
                className="flex-1 py-3 rounded-xl text-sm font-bold disabled:opacity-40"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-2)' }}
              >
                취소
              </button>
              <button
                onClick={save}
                disabled={busy}
                className="flex-1 py-3 rounded-xl text-sm font-extrabold text-white disabled:opacity-50"
                style={{ background: 'var(--brand)', boxShadow: 'var(--shadow-brand)' }}
              >
                {busy ? '변경 중…' : '변경'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PwInput({
  label, value, onChange, placeholder, autoComplete,
}: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; autoComplete?: string;
}) {
  return (
    <div>
      <label className="block text-[11px] font-bold mb-1.5" style={{ color: 'var(--text-2)' }}>{label}</label>
      <input
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
        style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
      />
    </div>
  );
}

/* ============================================================
 * 회원 탈퇴 시트 — 안내 + (이메일 가입자) 비번 확인 + 실행
 * ========================================================== */
function WithdrawSheet({
  isPasswordUser,
  onClose,
  onDone,
}: {
  isPasswordUser: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [confirmText, setConfirmText] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = confirmText.trim() === '탈퇴' && (!isPasswordUser || password.length > 0);

  const handleWithdraw = async () => {
    setError(null);
    setBusy(true);
    try {
      await deleteOwnAccount(isPasswordUser ? password : undefined);
      onDone();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(
        /requires-recent-login/.test(msg)
          ? '보안을 위해 다시 로그인한 뒤 탈퇴를 진행해 주세요'
          : msg,
      );
      setBusy(false);
    }
  };

  return (
    <div onClick={onClose} className="fixed inset-0 bg-black/55 z-50 flex items-end justify-center">
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-t-3xl px-5 pt-3 pb-6"
        style={{ background: 'var(--surface-1)' }}
      >
        <div className="flex justify-center mb-3">
          <div className="w-10 h-1 rounded-full" style={{ background: 'var(--border)' }} />
        </div>

        <div className="text-lg font-extrabold mb-1" style={{ color: 'var(--live)' }}>회원 탈퇴</div>
        <div className="rounded-xl p-3 mb-4" style={{ background: 'rgba(229,62,62,0.08)', border: '1px solid rgba(229,62,62,0.25)' }}>
          <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
            탈퇴하면 계정과 즐겨찾기·관심 토너·예약 등 개인 데이터가 삭제되며 <b>되돌릴 수 없습니다.</b>
            동일 이메일로 다시 가입할 수는 있지만 기존 데이터는 복구되지 않습니다.
          </p>
        </div>

        <div className="space-y-3.5">
          <div>
            <label className="block text-[11px] font-bold mb-1.5" style={{ color: 'var(--text-2)' }}>
              확인을 위해 <b style={{ color: 'var(--live)' }}>탈퇴</b> 라고 입력하세요
            </label>
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="탈퇴"
              className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
            />
          </div>
          {isPasswordUser && (
            <PwInput label="현재 비밀번호" value={password} onChange={setPassword} placeholder="비밀번호 확인" autoComplete="current-password" />
          )}
        </div>

        {error && (
          <div className="mt-3 px-3 py-2 rounded-lg text-[12px] font-bold" style={{ background: 'rgba(229,62,62,0.10)', color: 'var(--live)' }}>
            {error}
          </div>
        )}

        <div className="mt-5 flex gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="flex-1 py-3 rounded-xl text-sm font-bold disabled:opacity-40"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-2)' }}
          >
            취소
          </button>
          <button
            onClick={handleWithdraw}
            disabled={busy || !canSubmit}
            className="flex-1 py-3 rounded-xl text-sm font-extrabold text-white disabled:opacity-40"
            style={{ background: 'var(--live, #E53E3E)' }}
          >
            {busy ? '처리 중…' : '탈퇴하기'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
 * 정보변경 시트 — 닉네임 + 한 줄 소개 + 전화번호 수정
 * ========================================================== */
function EditProfileSheet({
  initial,
  uid,
  onClose,
}: {
  initial: { displayName: string; bio: string; phone: string };
  uid: string;
  onClose: () => void;
}) {
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [bio, setBio] = useState(initial.bio);
  const [phone, setPhone] = useState(initial.phone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const trimmedName = displayName.trim();
    // 클린봇 — 닉네임 길이·금칙어 통합 검증
    const checkName = moderateText(trimmedName, { allowEmpty: false, minLength: 1, maxLength: 30 });
    if (!checkName.ok) {
      setError(checkName.message ?? '닉네임에 부적절한 표현이 포함되어 있습니다');
      return;
    }
    if (bio) {
      const checkBio = moderateText(bio, { allowEmpty: true, maxLength: 200 });
      if (!checkBio.ok) {
        setError(checkBio.message ?? '한 줄 소개에 부적절한 표현이 포함되어 있습니다');
        return;
      }
    }
    // rate limit — 프로필 변경 잦은 시도 차단 (5회/5분)
    const ok = await checkWriteRateLimit(uid, 'profile', 5, 5 * 60_000);
    if (!ok) {
      setError('프로필 변경이 너무 잦습니다. 잠시 후 다시 시도해주세요');
      return;
    }
    // 전화번호 — 본인 기존 번호와 다르면 setUserPhone으로 중복 검사 + 인덱스 갱신
    if (phone.trim()) {
      const normalized = normalizePhone(phone);
      if (!normalized) {
        setError('유효하지 않은 전화번호 형식입니다 (예: 010-1234-5678)');
        return;
      }
      if (normalized !== normalizePhone(initial.phone)) {
        setBusy(true);
        try {
          await setUserPhone(uid, phone);
        } catch (e: unknown) {
          setError(e instanceof Error ? e.message : String(e));
          setBusy(false);
          return;
        }
      }
    }
    setError(null);
    setBusy(true);
    try {
      // Firebase Auth + Firestore 양쪽 동기화. Auth는 다른 클라이언트에 즉시 반영,
      // Firestore는 이 페이지의 onSnapshot이 즉시 잡아 UI에 반영.
      // phone은 setUserPhone에서 처리하므로 setDoc에서 제외 (중복 작업 방지).
      if (auth.currentUser) {
        await updateProfile(auth.currentUser, { displayName: trimmedName });
      }
      await setDoc(
        doc(db, 'users', uid),
        {
          displayName: trimmedName,
          bio: bio.trim(),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 bg-black/55 z-50 flex items-end justify-center"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-t-3xl px-5 pt-3 pb-6"
        style={{ background: 'var(--surface-1)' }}
      >
        {/* 핸들 */}
        <div className="flex justify-center mb-3">
          <div className="w-10 h-1 rounded-full" style={{ background: 'var(--border)' }} />
        </div>
        <div className="text-lg font-extrabold mb-1" style={{ color: 'var(--text-1)' }}>정보 변경</div>
        <div className="text-[11px] mb-4" style={{ color: 'var(--text-3)' }}>
          이메일은 변경할 수 없습니다
        </div>

        <div className="space-y-3.5">
          <div>
            <label className="block text-[11px] font-bold mb-1.5" style={{ color: 'var(--text-2)' }}>
              닉네임 <span style={{ color: 'var(--brand)' }}>*</span>
            </label>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={30}
              placeholder="다른 사용자에게 보이는 이름"
              className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold mb-1.5" style={{ color: 'var(--text-2)' }}>
              한 줄 소개
            </label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              maxLength={200}
              rows={2}
              placeholder="나를 한 줄로 소개해 주세요"
              className="w-full px-3 py-2.5 rounded-lg text-sm outline-none resize-none"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
            />
            <div className="text-[10px] text-right mt-1" style={{ color: 'var(--text-3)' }}>{bio.length}/200</div>
          </div>

          <div>
            <label className="block text-[11px] font-bold mb-1.5" style={{ color: 'var(--text-2)' }}>
              전화번호 (선택)
            </label>
            <input
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              maxLength={20}
              placeholder="010-0000-0000"
              className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
            />
            <div className="text-[10px] mt-1" style={{ color: 'var(--text-3)' }}>매장이 연락할 때 사용</div>
          </div>
        </div>

        {error && (
          <div
            className="mt-3 px-3 py-2 rounded-lg text-[12px] font-bold"
            style={{ background: 'rgba(229,62,62,0.10)', color: 'var(--live)' }}
          >
            {error}
          </div>
        )}

        <div className="mt-5 flex gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="flex-1 py-3 rounded-xl text-sm font-bold disabled:opacity-40"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-2)' }}
          >
            취소
          </button>
          <button
            onClick={save}
            disabled={busy}
            className="flex-1 py-3 rounded-xl text-sm font-extrabold text-white disabled:opacity-50"
            style={{ background: 'var(--brand)', boxShadow: 'var(--shadow-brand)' }}
          >
            {busy ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
 * 알림 권한·토큰 진단 카드 — 토글 위에 표시
 * ========================================================== */
function NotificationStatusCard({
  permission,
  tokenCount,
  busy,
  error,
  onEnable,
}: {
  permission: NotificationPermission | 'unsupported' | 'unknown';
  tokenCount: number | null;
  busy: boolean;
  error: string | null;
  onEnable: () => void;
}) {
  if (permission === 'unsupported') {
    return (
      <div className="mb-4 rounded-xl p-3.5" style={{ background: 'rgba(229,62,62,0.08)', border: '1px solid rgba(229,62,62,0.25)' }}>
        <div className="text-[12px] font-extrabold mb-1" style={{ color: 'var(--live)' }}>⚠️ 이 브라우저는 알림 미지원</div>
        <div className="text-[11px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
          Chrome·Safari·Edge 최신 버전 + iOS 16.4+ 또는 Android에서 사용해주세요. 홈 화면에 PWA 설치 시 안정성이 더 좋습니다.
        </div>
      </div>
    );
  }
  if (permission === 'granted' && (tokenCount ?? 0) > 0) {
    return (
      <div className="mb-4 rounded-xl p-3.5" style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)' }}>
        <div className="flex items-center gap-2">
          <span className="text-[14px]">✅</span>
          <div className="flex-1">
            <div className="text-[12px] font-extrabold" style={{ color: 'var(--success, #10B981)' }}>알림 받기 활성화됨</div>
            <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-3)' }}>{tokenCount}개 디바이스 등록 · 즐겨찾기·관심 토너 알림이 도착합니다</div>
          </div>
        </div>
      </div>
    );
  }
  if (permission === 'granted' && (tokenCount ?? 0) === 0) {
    return (
      <div className="mb-4 rounded-xl p-3.5" style={{ background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.30)' }}>
        <div className="flex items-start gap-2">
          <span className="text-[14px]">⚠️</span>
          <div className="flex-1">
            <div className="text-[12px] font-extrabold mb-1" style={{ color: 'var(--gold)' }}>권한은 허용됐지만 토큰 미등록</div>
            <div className="text-[11px] leading-relaxed mb-2.5" style={{ color: 'var(--text-2)' }}>
              알림 시스템 등록을 한 번 더 시도해 주세요. PWA 설치를 권장합니다.
            </div>
            <button
              onClick={onEnable}
              disabled={busy}
              className="px-4 py-2 rounded-lg text-[12px] font-extrabold text-white disabled:opacity-40"
              style={{ background: 'var(--brand)' }}
            >
              {busy ? '등록 중…' : '🔔 알림 다시 등록'}
            </button>
          </div>
        </div>
      </div>
    );
  }
  // denied / default / unknown — 권한 요청 안내
  return (
    <div className="mb-4 rounded-xl p-3.5" style={{ background: 'rgba(255,31,143,0.06)', border: '1px solid rgba(255,31,143,0.25)' }}>
      <div className="flex items-start gap-2">
        <span className="text-[18px]">🔔</span>
        <div className="flex-1">
          <div className="text-[12px] font-extrabold mb-1" style={{ color: 'var(--brand)' }}>알림을 받으려면 권한 허용이 필요해요</div>
          <div className="text-[11px] leading-relaxed mb-2.5" style={{ color: 'var(--text-2)' }}>
            {permission === 'denied'
              ? '브라우저에서 알림이 차단된 상태입니다. 브라우저 주소창 좌측 자물쇠 → 알림 → 허용으로 직접 켜주세요.'
              : '아래 버튼을 누르면 권한 요청 팝업이 떠요. 허용하면 즐겨찾기 매장 LIVE·관심 토너 시작 알림을 받습니다.'}
          </div>
          {permission !== 'denied' && (
            <button
              onClick={onEnable}
              disabled={busy}
              className="px-4 py-2 rounded-lg text-[12px] font-extrabold text-white disabled:opacity-40"
              style={{ background: 'var(--brand)' }}
            >
              {busy ? '활성화 중…' : '🔔 알림 받기 활성화'}
            </button>
          )}
          {error && (
            <div className="text-[11px] font-bold mt-2" style={{ color: 'var(--live)' }}>{error}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function PrefRow({ icon, label, desc, value, onToggle, isLast }: {
  icon: string; label: string; desc: string; value: boolean; onToggle: () => void; isLast?: boolean;
}) {
  return (
    <div
      className="flex items-center gap-3 px-3.5 py-3"
      style={{ borderBottom: isLast ? 'none' : '1px solid var(--border)' }}
    >
      {/* 아이콘 뱃지 */}
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          background: value ? 'rgba(255,31,143,0.10)' : 'var(--surface-2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 17,
          flexShrink: 0,
          transition: 'background 0.2s',
        }}
        aria-hidden="true"
      >
        {icon}
      </div>
      {/* 텍스트 */}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>{label}</div>
        <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>{desc}</div>
      </div>
      {/* 토글 */}
      <button
        onClick={onToggle}
        role="switch"
        aria-checked={value}
        aria-label={label}
        className="relative w-11 h-6 rounded-full flex-shrink-0 transition"
        style={{ background: value ? 'var(--brand)' : 'var(--surface-3)' }}
      >
        <span
          className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all"
          style={{ left: value ? '22px' : '2px' }}
        />
      </button>
    </div>
  );
}
