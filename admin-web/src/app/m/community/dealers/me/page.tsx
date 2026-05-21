'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  type DealerProfile,
  type DealerAbility,
  type ExperienceLevel,
  type AvailableShift,
  type DealerGender,
  DEALER_ABILITY_LABELS,
  EXPERIENCE_LEVEL_LABELS,
  AVAILABLE_SHIFT_LABELS,
  loadOwnDealerProfile,
  createDealerProfile,
  updateDealerProfile,
  uploadDealerImage,
  hasBannedKeyword,
} from '@/lib/community';
import { useAuth } from '@/lib/hooks';
import AnonymousPrompt from '@/components/mobile/AnonymousPrompt';

/* ============================================================
 * /m/community/dealers/me — 본인 딜러 프로필 등록/수정 v0.3
 *
 * 권한: 일반 사용자 누구나 (본인 1프로필)
 * 필드: 7가지 개편 + 나이·성별·거주지 선택 입력
 * 열람: 매장 owner 전용 (어드민 딜러 풀에서만)
 * ========================================================== */

interface DealerForm {
  displayName: string;
  abilities: DealerAbility[];
  experienceLevel: ExperienceLevel | '';
  availableShifts: AvailableShift[];
  region: string;
  bio: string;
  careerHistory: string;
  phone: string;
  kakaoOpenChat: string;
  profileImageUrl: string;
  age: string;
  gender: DealerGender | '';
  residence: string;
  privacyConsent: boolean;
}

function defaultForm(displayName = ''): DealerForm {
  return {
    displayName,
    abilities: [],
    experienceLevel: '',
    availableShifts: [],
    region: '',
    bio: '',
    careerHistory: '',
    phone: '',
    kakaoOpenChat: '',
    profileImageUrl: '',
    age: '',
    gender: '',
    residence: '',
    privacyConsent: false,
  };
}

/** 인적사항 선택 필드 중 하나라도 입력했는가 */
function hasPersonalInfo(form: DealerForm): boolean {
  return !!(form.age || form.gender || form.residence);
}

/** 닉네임 이니셜 + 핑크 그라데이션 아바타 */
function AvatarPreview({ url, name }: { url: string; name: string }) {
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt="프로필 사진"
        className="w-20 h-20 rounded-full object-cover"
        style={{ boxShadow: '0 4px 16px rgba(255,31,143,0.25)' }}
      />
    );
  }
  const initial = (name?.[0] ?? '?').toUpperCase();
  return (
    <div
      className="w-20 h-20 rounded-full flex items-center justify-center font-extrabold text-white text-3xl"
      style={{
        background: 'linear-gradient(135deg, #FF1F8F 0%, #FF6BB5 100%)',
        boxShadow: '0 4px 16px rgba(255,31,143,0.30)',
      }}
      aria-hidden="true"
    >
      {initial}
    </div>
  );
}

export default function MyDealerProfilePage() {
  const authState = useAuth();
  const router = useRouter();
  const [existing, setExisting] = useState<DealerProfile | null | undefined>(undefined);
  const [form, setForm] = useState<DealerForm>(defaultForm());
  const [saving, setSaving] = useState(false);
  const [uploadingImg, setUploadingImg] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* ── 기존 프로필 로드 ── */
  useEffect(() => {
    if (authState.status !== 'authenticated') return;
    loadOwnDealerProfile(authState.user.uid).then((profile) => {
      if (profile) {
        setExisting(profile);
        setForm({
          displayName: profile.displayName ?? '',
          abilities: profile.abilities ?? [],
          experienceLevel: profile.experienceLevel ?? '',
          availableShifts: profile.availableShifts ?? [],
          region: profile.region ?? '',
          bio: profile.bio ?? '',
          careerHistory: profile.careerHistory ?? '',
          phone: profile.contact?.phone ?? '',
          kakaoOpenChat: profile.contact?.kakaoOpenChat ?? '',
          profileImageUrl: profile.profileImageUrl ?? '',
          age: profile.age !== undefined ? String(profile.age) : '',
          gender: profile.gender ?? '',
          residence: profile.residence ?? '',
          privacyConsent: profile.privacyConsent ?? false,
        });
      } else {
        setExisting(null);
        if (authState.status === 'authenticated') {
          setForm(defaultForm(authState.user.displayName ?? ''));
        }
      }
    });
  }, [authState]);

  const toggleAbility = (a: DealerAbility) =>
    setForm((f) => ({
      ...f,
      abilities: f.abilities.includes(a)
        ? f.abilities.filter((x) => x !== a)
        : [...f.abilities, a],
    }));

  const toggleShift = (s: AvailableShift) =>
    setForm((f) => ({
      ...f,
      availableShifts: f.availableShifts.includes(s)
        ? f.availableShifts.filter((x) => x !== s)
        : [...f.availableShifts, s],
    }));

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || authState.status !== 'authenticated') return;
    setUploadingImg(true);
    try {
      const url = await uploadDealerImage(authState.user.uid, file);
      setForm((f) => ({ ...f, profileImageUrl: url }));
    } catch (err) {
      alert(err instanceof Error ? err.message : '이미지 업로드 실패');
    } finally {
      setUploadingImg(false);
    }
  };

  const validate = (): string | null => {
    if (!form.displayName.trim()) return '이름(닉네임)을 입력해주세요';
    if (!form.phone.trim() && !form.kakaoOpenChat.trim())
      return '전화 또는 카카오 오픈채팅 URL을 하나 이상 입력해주세요';
    if (form.kakaoOpenChat && !form.kakaoOpenChat.startsWith('https://open.kakao.com/'))
      return '카카오 오픈채팅 URL은 https://open.kakao.com/ 으로 시작해야 합니다';
    if (form.age && (isNaN(Number(form.age)) || Number(form.age) < 19 || Number(form.age) > 70))
      return '나이는 19~70 사이로 입력해주세요';
    if (hasPersonalInfo(form) && !form.privacyConsent)
      return '개인정보 수집·이용에 동의해주세요';
    if (hasBannedKeyword(form.bio)) return '도박 관련 표현은 등록할 수 없어요';
    if (hasBannedKeyword(form.displayName)) return '도박 관련 표현은 등록할 수 없어요';
    return null;
  };

  const handleSave = async () => {
    const err = validate();
    if (err) { alert(err); return; }
    if (authState.status !== 'authenticated') { alert('로그인이 필요합니다'); return; }
    setSaving(true);
    try {
      const ageNum = form.age ? Number(form.age) : undefined;
      const input = {
        authorUid: authState.user.uid,
        displayName: form.displayName,
        abilities: form.abilities,
        experienceLevel: (form.experienceLevel || 'beginner') as ExperienceLevel,
        availableShifts: form.availableShifts,
        bio: form.bio,
        careerHistory: form.careerHistory || undefined,
        region: form.region || undefined,
        contact: {
          phone: form.phone || undefined,
          kakaoOpenChat: form.kakaoOpenChat || undefined,
        },
        profileImageUrl: form.profileImageUrl || undefined,
        ...(ageNum !== undefined ? { age: ageNum } : {}),
        ...(form.gender ? { gender: form.gender as DealerGender } : {}),
        ...(form.residence ? { residence: form.residence } : {}),
        privacyConsent: form.privacyConsent,
      };
      if (existing?.id) {
        await updateDealerProfile(existing.id, input);
      } else {
        await createDealerProfile(input);
      }
      router.push('/m/community');
    } catch (e) {
      alert(`저장 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  /* ── 로딩 ── */
  if (authState.status === 'loading' || existing === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg)' }}>
        <div className="text-[12px]" style={{ color: 'var(--text-3)' }}>불러오는 중…</div>
      </div>
    );
  }

  /* ── 비로그인 ── */
  if (authState.status === 'anonymous') {
    return (
      <AnonymousPrompt
        title="딜러 프로필"
        icon="🃏"
        desc="로그인 후 딜러 프로필을 등록하면 매장이 먼저 연락해 올 수 있어요."
      />
    );
  }

  const isEdit = !!existing;
  const personalInfoActive = hasPersonalInfo(form);

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      {/* ── 헤더 ── */}
      <header
        className="sticky top-0 z-30 flex items-center h-14 px-4 gap-3"
        style={{
          background: 'rgba(255,255,255,0.94)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <button
          onClick={() => router.back()}
          aria-label="뒤로"
          className="w-9 h-9 flex items-center justify-center rounded-full transition active:bg-[var(--surface-2)] flex-shrink-0"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-1)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6"/>
          </svg>
        </button>
        <h1 className="flex-1 text-center text-[17px] font-extrabold tracking-tight" style={{ color: 'var(--text-1)' }}>
          {isEdit ? '내 딜러 프로필 수정' : '딜러 프로필 등록'}
        </h1>
        <div className="w-9 h-9 flex-shrink-0" aria-hidden="true" />
      </header>

      <div style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 110px)' }}>

        {/* ── 매장 owner 공개 안내 박스 ── */}
        <div className="mx-4 mt-5 px-4 py-3.5 rounded-2xl flex items-start gap-3"
          style={{ background: 'rgba(255,31,143,0.07)', border: '1px solid rgba(255,31,143,0.20)' }}
        >
          <svg className="flex-shrink-0 mt-0.5" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FF1F8F" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <p className="text-[12px] leading-relaxed font-medium" style={{ color: '#FF1F8F' }}>
            이 프로필은 <strong>매장 대표(승인된 매장 사장)에게만 공개</strong>됩니다. 일반 사용자에게는 노출되지 않습니다.
          </p>
        </div>

        {/* ── 사진 업로드 ── */}
        <div className="flex flex-col items-center pt-6 pb-6 mt-4" style={{ borderBottom: '6px solid var(--surface-2)' }}>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="relative transition active:opacity-80"
            aria-label="프로필 사진 변경"
            disabled={uploadingImg}
          >
            <AvatarPreview url={form.profileImageUrl} name={form.displayName} />
            <span
              className="absolute bottom-0 right-0 w-7 h-7 rounded-full flex items-center justify-center"
              style={{ background: '#FF1F8F', border: '2px solid #fff' }}
              aria-hidden="true"
            >
              {uploadingImg ? (
                <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/>
                  <line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
              )}
            </span>
          </button>
          <p className="mt-2 text-[11px]" style={{ color: 'var(--text-3)' }}>
            사진 없으면 익명 아바타로 표시돼요 (선택)
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleImageUpload}
          />
        </div>

        {/* ── 폼 ── */}
        <div className="px-4 pt-5 flex flex-col gap-7">

          {/* 이름 */}
          <FormField label="이름 (닉네임)" required>
            <input
              type="text"
              value={form.displayName}
              onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
              placeholder="예: 김지훈"
              className="w-full h-12 rounded-xl px-4 text-[16px] font-medium focus:outline-none"
              style={{
                border: '1.5px solid var(--border)',
                color: 'var(--text-1)',
                background: 'var(--surface-1)',
              }}
              maxLength={20}
            />
          </FormField>

          {/* 가능 분야 (복수) */}
          <FormField label="가능 분야 (복수 선택)">
            <div className="flex gap-2 flex-wrap">
              {(Object.keys(DEALER_ABILITY_LABELS) as DealerAbility[]).map((a) => {
                const active = form.abilities.includes(a);
                return (
                  <ChipButton
                    key={a}
                    active={active}
                    onClick={() => toggleAbility(a)}
                  >
                    {DEALER_ABILITY_LABELS[a]}
                  </ChipButton>
                );
              })}
            </div>
          </FormField>

          {/* 경력 단계 (단일) */}
          <FormField label="경력">
            <div className="flex gap-2 flex-wrap">
              {(Object.keys(EXPERIENCE_LEVEL_LABELS) as ExperienceLevel[]).map((lvl) => {
                const active = form.experienceLevel === lvl;
                return (
                  <ChipButton
                    key={lvl}
                    active={active}
                    onClick={() => setForm((f) => ({ ...f, experienceLevel: lvl }))}
                  >
                    {EXPERIENCE_LEVEL_LABELS[lvl]}
                  </ChipButton>
                );
              })}
            </div>
          </FormField>

          {/* 가용시간 (복수) */}
          <FormField label="가용시간 (복수 선택)">
            <div className="flex gap-2 flex-wrap">
              {(Object.keys(AVAILABLE_SHIFT_LABELS) as AvailableShift[]).map((s) => {
                const active = form.availableShifts.includes(s);
                return (
                  <ChipButton
                    key={s}
                    active={active}
                    onClick={() => toggleShift(s)}
                  >
                    {AVAILABLE_SHIFT_LABELS[s]}
                  </ChipButton>
                );
              })}
            </div>
          </FormField>

          {/* 활동 가능 지역 (자유 수기 입력) */}
          <FormField label="활동 가능 지역">
            <input
              type="text"
              value={form.region}
              onChange={(e) => setForm((f) => ({ ...f, region: e.target.value }))}
              placeholder="예: 부산 해운대, 양산, 김해 일대"
              className="w-full h-12 rounded-xl px-4 text-[15px] focus:outline-none"
              style={{
                border: '1.5px solid var(--border)',
                color: 'var(--text-1)',
                background: 'var(--surface-1)',
              }}
              maxLength={60}
            />
            <p className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>
              여러 지역은 쉼표로 구분해 입력하세요
            </p>
          </FormField>

          {/* 자기소개 */}
          <FormField label="자기소개">
            <textarea
              value={form.bio}
              onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
              placeholder="간단히 자기소개를 적어주세요"
              rows={4}
              className="w-full rounded-xl px-4 py-3 text-[15px] leading-relaxed resize-none focus:outline-none"
              style={{
                border: '1.5px solid var(--border)',
                color: 'var(--text-1)',
                background: 'var(--surface-1)',
                whiteSpace: 'pre-wrap',
              }}
            />
          </FormField>

          {/* 경력사항 (자유 다수 입력, 줄바꿈으로 여러 경력) */}
          <FormField label="경력사항 (선택)">
            <textarea
              value={form.careerHistory}
              onChange={(e) => setForm((f) => ({ ...f, careerHistory: e.target.value }))}
              placeholder={'예:\n에이스클럽 해운대 (2022~2024)\n로얄홀덤 서면 (2020~2022)'}
              rows={5}
              className="w-full rounded-xl px-4 py-3 text-[14px] leading-relaxed resize-none focus:outline-none"
              style={{
                border: '1.5px solid var(--border)',
                color: 'var(--text-1)',
                background: 'var(--surface-1)',
                whiteSpace: 'pre-wrap',
              }}
            />
            <p className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>
              한 줄에 경력 하나씩 자유롭게 입력하세요
            </p>
          </FormField>

          {/* 연락처 */}
          <FormField label="연락처 (1개 이상 필수)" required>
            <div className="flex flex-col gap-2">
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="전화번호 (예: 010-1234-5678)"
                className="w-full h-12 rounded-xl px-4 text-[15px] focus:outline-none"
                style={{
                  border: '1.5px solid var(--border)',
                  color: 'var(--text-1)',
                  background: 'var(--surface-1)',
                }}
              />
              <input
                type="url"
                value={form.kakaoOpenChat}
                onChange={(e) => setForm((f) => ({ ...f, kakaoOpenChat: e.target.value }))}
                placeholder="카카오 오픈채팅 URL (https://open.kakao.com/...)"
                className="w-full h-12 rounded-xl px-4 text-[15px] focus:outline-none"
                style={{
                  border: '1.5px solid var(--border)',
                  color: 'var(--text-1)',
                  background: 'var(--surface-1)',
                }}
              />
            </div>
          </FormField>

          {/* 구분선 — 인적사항 섹션 */}
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
              <span className="text-[11px] font-bold tracking-wider" style={{ color: 'var(--text-3)' }}>
                인적사항 (선택 — 매장 대표에게만 공개)
              </span>
              <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
            </div>

            <div className="flex flex-col gap-5">
              {/* 나이 */}
              <FormField label="나이 (선택)">
                <input
                  type="number"
                  inputMode="numeric"
                  value={form.age}
                  onChange={(e) => setForm((f) => ({ ...f, age: e.target.value }))}
                  placeholder="예: 28"
                  min={19}
                  max={70}
                  className="w-full h-12 rounded-xl px-4 text-[16px] focus:outline-none"
                  style={{
                    border: '1.5px solid var(--border)',
                    color: 'var(--text-1)',
                    background: 'var(--surface-1)',
                  }}
                />
              </FormField>

              {/* 성별 */}
              <FormField label="성별 (선택)">
                <div className="flex gap-2">
                  {([['male', '남성'], ['female', '여성'], ['other', '기타']] as const).map(([val, label]) => {
                    const active = form.gender === val;
                    return (
                      <ChipButton
                        key={val}
                        active={active}
                        onClick={() => setForm((f) => ({ ...f, gender: active ? '' : val }))}
                      >
                        {label}
                      </ChipButton>
                    );
                  })}
                </div>
              </FormField>

              {/* 거주지 */}
              <FormField label="거주지 (선택)">
                <input
                  type="text"
                  value={form.residence}
                  onChange={(e) => setForm((f) => ({ ...f, residence: e.target.value }))}
                  placeholder="예: 부산 해운대구"
                  className="w-full h-12 rounded-xl px-4 text-[15px] focus:outline-none"
                  style={{
                    border: '1.5px solid var(--border)',
                    color: 'var(--text-1)',
                    background: 'var(--surface-1)',
                  }}
                  maxLength={40}
                />
              </FormField>
            </div>
          </div>

          {/* 개인정보 동의 체크박스 — 인적사항 입력 시 활성 */}
          {personalInfoActive && (
            <label
              className="flex items-start gap-3 px-4 py-3.5 rounded-2xl cursor-pointer"
              style={{
                background: form.privacyConsent
                  ? 'rgba(255,31,143,0.06)'
                  : 'var(--surface-2)',
                border: `1.5px solid ${form.privacyConsent ? 'rgba(255,31,143,0.30)' : 'var(--border)'}`,
              }}
            >
              <input
                type="checkbox"
                checked={form.privacyConsent}
                onChange={(e) => setForm((f) => ({ ...f, privacyConsent: e.target.checked }))}
                className="mt-0.5 flex-shrink-0 w-4 h-4 accent-[#FF1F8F]"
                aria-label="개인정보 수집·이용 동의"
              />
              <span className="text-[12px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
                위 개인정보(나이·성별·거주지·연락처) 수집·이용에 동의합니다.{' '}
                <strong>매장 대표에게만 열람 형태로 제공</strong>됩니다.
              </span>
            </label>
          )}

        </div>
      </div>

      {/* ── 하단 CTA ── 탭바보다 위 + iOS safe-area 반영 */}
      <div
        className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md z-50 px-4 pt-3"
        style={{
          background: 'linear-gradient(to top, var(--bg) 80%, transparent 100%)',
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
        }}
      >
        <button
          onClick={handleSave}
          disabled={saving || uploadingImg}
          className="w-full rounded-2xl text-[15px] font-extrabold text-white transition hover:opacity-90 active:opacity-75 disabled:opacity-40"
          style={{ background: '#FF1F8F', height: 52 }}
        >
          {saving ? '저장 중…' : isEdit ? '프로필 수정 완료' : '프로필 등록하기'}
        </button>
      </div>
    </div>
  );
}

/* ── 공통 컴포넌트 ── */

function FormField({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[13px] font-extrabold" style={{ color: 'var(--text-2)' }}>
        {label}
        {required && <span className="ml-1 text-[#FF1F8F]">*</span>}
      </span>
      {children}
    </div>
  );
}

function ChipButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="px-3 h-9 rounded-full text-[13px] font-bold transition active:scale-95 flex-shrink-0"
      style={{
        background: active ? '#FF1F8F' : 'var(--surface-2)',
        color: active ? '#fff' : 'var(--text-2)',
      }}
    >
      {children}
    </button>
  );
}
