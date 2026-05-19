'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { updateProfile } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { useAuth } from '@/lib/hooks';
import AnonymousPrompt from '@/components/mobile/AnonymousPrompt';
import LogoutConfirmSheet from '@/components/mobile/LogoutConfirmSheet';
import { doc, setDoc, onSnapshot, serverTimestamp, collection } from 'firebase/firestore';

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

export default function MyPage() {
  const authState = useAuth();
  const router = useRouter();
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS);
  const [profile, setProfile] = useState<ProfileFields>({});
  const [loading, setLoading] = useState(true);
  const [favCount, setFavCount] = useState(0);
  const [seriesSubCount, setSeriesSubCount] = useState(0);
  const [interestCount, setInterestCount] = useState(0);
  const [logoutSheetOpen, setLogoutSheetOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  useEffect(() => {
    if (authState.status !== 'authenticated') return;
    const uid = authState.user.uid;
    const u1 = onSnapshot(collection(db, 'users', uid, 'favorites'), (s) => setFavCount(s.size));
    const u2 = onSnapshot(collection(db, 'users', uid, 'seriesSubscriptions'), (s) => setSeriesSubCount(s.size));
    const u3 = onSnapshot(collection(db, 'users', uid, 'interests'), (s) => setInterestCount(s.size));
    return () => { u1(); u2(); u3(); };
  }, [authState]);

  useEffect(() => {
    if (authState.status !== 'authenticated') { setLoading(false); return; }
    const uid = authState.user.uid;
    const unsub = onSnapshot(
      doc(db, 'users', uid),
      (snap) => {
        const data = snap.data() as
          | { notificationPrefs?: NotificationPrefs; displayName?: string; bio?: string; phone?: string }
          | undefined;
        if (data?.notificationPrefs) setPrefs(data.notificationPrefs);
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
        <button
          aria-label="알림 설정"
          className="w-9 h-9 flex items-center justify-center rounded-xl"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-2)' }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0"/>
          </svg>
        </button>
      </header>

      {/* ── 프로필 ── */}
      <div className="px-5 py-6 flex items-start gap-4" style={{ borderBottom: '6px solid var(--surface-2)' }}>
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center text-white text-2xl font-bold flex-shrink-0"
          style={{ background: 'linear-gradient(135deg, var(--brand) 0%, var(--brand-dim) 100%)', boxShadow: 'var(--shadow-brand)' }}
        >
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="text-lg font-bold truncate" style={{ color: 'var(--text-1)' }}>
              {displayName}
            </div>
            <button
              onClick={() => setEditOpen(true)}
              className="text-[10px] font-extrabold px-2 py-0.5 rounded-full transition active:scale-95"
              style={{
                background: 'var(--brand)',
                color: '#fff',
                boxShadow: 'var(--shadow-brand)',
              }}
            >
              ✎ 정보변경
            </button>
          </div>
          <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-3)' }}>{user.email}</div>
          {profile.bio && (
            <div className="text-xs mt-1 line-clamp-2" style={{ color: 'var(--text-2)' }}>{profile.bio}</div>
          )}
          <div
            className="inline-flex items-center text-[10px] font-bold mt-1.5 px-2 py-0.5 rounded-full"
            style={{ background: 'var(--surface-3)', border: '1px solid var(--border)', color: 'var(--text-3)' }}
          >
            일반 회원
          </div>
        </div>
      </div>

      {/* ── 통계 ── */}
      <div className="px-4 py-5 grid grid-cols-3 gap-2" style={{ borderBottom: '6px solid var(--surface-2)' }}>
        {[
          { label: '즐겨찾기', value: favCount, go: '/m/favorites' },
          { label: '관심 토너', value: interestCount, go: '/m/interests' },
          { label: '시리즈 구독', value: seriesSubCount, go: '/m/subscriptions' },
        ].map((k) => (
          <button
            key={k.label}
            onClick={() => router.push(k.go)}
            className="rounded-xl py-4 text-center transition active:scale-[0.97]"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
          >
            <div className="font-mono text-xl font-extrabold" style={{ color: 'var(--brand)' }}>{k.value}</div>
            <div className="text-[10px] mt-1" style={{ color: 'var(--text-3)' }}>{k.label}</div>
          </button>
        ))}
      </div>

      {/* ── 알림 설정 ── */}
      <div className="px-5 py-5" style={{ borderBottom: '6px solid var(--surface-2)' }}>
        <div className="text-base font-extrabold mb-4" style={{ color: 'var(--text-1)' }}>알림 설정</div>
        {loading ? (
          <div className="text-sm" style={{ color: 'var(--text-3)' }}>로딩…</div>
        ) : (
          <div>
            <PrefRow label="즐겨찾기 매장 LIVE 시작" desc="실시간 즉시 알림" value={prefs.favLive} onToggle={() => togglePref('favLive')} />
            <PrefRow label="관심 토너 시작 1시간 전" desc="미리 알려드려요" value={prefs.tournamentStart} onToggle={() => togglePref('tournamentStart')} />
            <PrefRow label="늦은 등록 마감 임박" desc="관심 토너 등록 30분 전" value={prefs.lateRegImminent} onToggle={() => togglePref('lateRegImminent')} />
            <PrefRow label="매장·시리즈 마케팅" desc="광고성 알림 (선택)" value={prefs.marketing} onToggle={() => togglePref('marketing')} />
          </div>
        )}
      </div>

      {/* ── 딜러 프로필 카드 ── */}
      <div className="px-5 py-4" style={{ borderBottom: '6px solid var(--surface-2)' }}>
        <div className="text-base font-extrabold mb-3" style={{ color: 'var(--text-1)' }}>딜러 활동</div>
        <button
          onClick={() => router.push('/m/community/dealers/me')}
          className="w-full rounded-2xl p-4 flex items-center gap-3 text-left transition active:scale-[0.99]"
          style={{
            background: 'linear-gradient(135deg, rgba(255,31,143,0.07) 0%, rgba(255,31,143,0.03) 100%)',
            border: '1px solid rgba(255,31,143,0.18)',
          }}
        >
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center font-extrabold text-white flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #FF1F8F 0%, #FF6BB5 100%)' }}
            aria-hidden="true"
          >
            🃏
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[14px] font-bold" style={{ color: 'var(--text-1)' }}>내 딜러 프로필</div>
            <div className="text-[12px] mt-0.5" style={{ color: 'var(--text-3)' }}>프로필 등록 시 매장이 먼저 연락해요</div>
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 18l6-6-6-6"/>
          </svg>
        </button>
      </div>

      {/* ── 메뉴 ── */}
      <div className="px-5 py-4" style={{ borderBottom: '6px solid var(--surface-2)' }}>
        {[
          { label: '즐겨찾기 매장', go: '/m/favorites', icon: '♡' },
          { label: '관심 토너', go: '/m/interests', icon: '★' },
          { label: '시리즈 구독', go: '/m/subscriptions', icon: '◎' },
          { label: '내가 쓴 리뷰', tag: 'v0.2', icon: '✎' },
          { label: '도움말·문의', tag: '', icon: '?' },
        ].map((m, i) => (
          <button
            key={i}
            onClick={() => m.go && router.push(m.go)}
            className="w-full px-1 py-4 flex items-center justify-between transition"
            style={{ borderBottom: '1px solid var(--border)' }}
          >
            <div className="flex items-center gap-3">
              <span
                className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold"
                style={{ background: 'var(--surface-3)', color: 'var(--text-2)' }}
              >
                {m.icon}
              </span>
              <span className="text-sm" style={{ color: 'var(--text-1)' }}>{m.label}</span>
            </div>
            {m.tag ? (
              <span
                className="text-[10px] font-bold rounded px-2 py-0.5"
                style={{ background: 'var(--surface-3)', color: 'var(--text-3)', border: '1px solid var(--border)' }}
              >
                {m.tag}
              </span>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-3)', flexShrink: 0 }} aria-hidden="true">
                <path d="M9 18l6-6-6-6"/>
              </svg>
            )}
          </button>
        ))}
      </div>

      {/* ── 로그아웃 ── */}
      <div className="px-5 py-8">
        <button
          onClick={() => setLogoutSheetOpen(true)}
          className="w-full py-3 text-sm transition"
          style={{ color: 'var(--text-3)', borderRadius: 'var(--r-md)', border: '1px solid var(--border)' }}
        >
          로그아웃
        </button>
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
    if (!trimmedName) {
      setError('닉네임을 입력하세요');
      return;
    }
    if (trimmedName.length > 30) {
      setError('닉네임은 30자 이하로 입력하세요');
      return;
    }
    if (bio.length > 200) {
      setError('한 줄 소개는 200자 이하로 입력하세요');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      // Firebase Auth + Firestore 양쪽 동기화. Auth는 다른 클라이언트에 즉시 반영,
      // Firestore는 이 페이지의 onSnapshot이 즉시 잡아 UI에 반영.
      if (auth.currentUser) {
        await updateProfile(auth.currentUser, { displayName: trimmedName });
      }
      await setDoc(
        doc(db, 'users', uid),
        {
          displayName: trimmedName,
          bio: bio.trim(),
          phone: phone.trim(),
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

function PrefRow({ label, desc, value, onToggle }: {
  label: string; desc: string; value: boolean; onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between py-3.5" style={{ borderBottom: '1px solid var(--border)' }}>
      <div className="flex-1 min-w-0 pr-3">
        <div className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>{label}</div>
        <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>{desc}</div>
      </div>
      <button
        onClick={onToggle}
        role="switch"
        aria-checked={value}
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
