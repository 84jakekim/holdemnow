'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { useAuth } from '@/lib/hooks';
import { searchPlaces, geocodeAddress } from '@/lib/kakao';

const FACILITY_OPTIONS = ['주차', '발렛', '식사', '24시간', '흡연실', '룸', '여성전용시간', 'VIP룸'];

interface AddrCandidate {
  main: string;      // 도로명 또는 지번 주소
  sub: string;       // 보조 설명 (장소명 또는 동/번지)
  lat: number;
  lng: number;
}

export default function SignupPage() {
  const router = useRouter();
  const authState = useAuth();
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: '',
    addressQuery: '',
    addressSelected: null as AddrCandidate | null,
    addressDetail: '',
    phone: '',
    hours: '매일 18:00 - 익일 05:00',
    description: '',
    facilities: [] as string[],
    agree: false,
  });
  const [addrResults, setAddrResults] = useState<AddrCandidate[]>([]);
  const [addrSearching, setAddrSearching] = useState(false);
  const addrSeqRef = useRef(0);

  // 카카오 키워드/주소 검색 — 디바운스 300ms.
  // ⚠️ 반드시 모든 useEffect/useState/useRef는 early return 위에 — Rules of Hooks.
  useEffect(() => {
    const q = form.addressQuery.trim();
    if (q.length < 2) {
      setAddrResults([]);
      setAddrSearching(false);
      return;
    }
    const seq = ++addrSeqRef.current;
    setAddrSearching(true);
    const t = setTimeout(async () => {
      try {
        const places = await searchPlaces(q);
        if (seq !== addrSeqRef.current) return; // 더 최신 쿼리가 있음
        const list: AddrCandidate[] = places.slice(0, 8).map((p) => ({
          main: p.roadAddress || p.address,
          sub: p.name + (p.address && p.roadAddress ? ` · ${p.address}` : ''),
          lat: p.lat,
          lng: p.lng,
        }));
        // 장소 검색 결과 없으면 주소 직접 geocoding 폴백
        if (list.length === 0) {
          const coords = await geocodeAddress(q);
          if (seq !== addrSeqRef.current) return;
          if (coords) {
            list.push({ main: q, sub: '주소 직접 입력', lat: coords.lat, lng: coords.lng });
          }
        }
        setAddrResults(list);
      } finally {
        if (seq === addrSeqRef.current) setAddrSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [form.addressQuery]);

  // 비로그인 → 메인 (effect로)
  useEffect(() => {
    if (authState.status === 'anonymous') router.replace('/');
  }, [authState.status, router]);

  if (authState.status === 'loading') {
    return <main className="min-h-screen flex items-center justify-center text-sm text-gray-500">로딩 중…</main>;
  }
  if (authState.status === 'anonymous') {
    return null;
  }

  const update = <K extends keyof typeof form>(k: K, v: typeof form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const canProceed = (() => {
    if (step === 1) return form.name.trim() && form.addressSelected && form.phone.trim();
    if (step === 2) return form.hours.trim() && form.description.trim();
    if (step === 3) return form.agree;
    return true;
  })();

  const submit = async () => {
    if (!canProceed) return;
    setSubmitting(true);
    setError(null);
    try {
      const uid = authState.user.uid;
      const storeId = `store_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const storeRef = doc(db, 'stores', storeId);
      await setDoc(storeRef, {
        id: storeId,
        ownerUid: uid,
        name: form.name.trim(),
        address: form.addressSelected!.main,
        addressDetail: form.addressDetail.trim(),
        addressSub: form.addressSelected!.sub,
        lat: form.addressSelected!.lat,
        lng: form.addressSelected!.lng,
        phone: form.phone.trim(),
        hours: form.hours.trim(),
        description: form.description.trim(),
        facilities: form.facilities,
        photoUrls: [],
        status: 'pending', // v0.1 — 자동 'pending', 운영팀 승인 후 'active'
        tier: 'free',
        reviewCount: 0,
        liveSessionCount: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // users/{uid}에 storeId 매핑 저장 (자기 자신 doc은 자유 write)
      await setDoc(
        doc(db, 'users', uid),
        {
          uid,
          storeId,
          role: 'store_master',
          email: authState.user.email ?? null,
          displayName: authState.user.displayName ?? null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      setStep(5); // 완료 화면
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6">
      {/* 매장 사장 아닌 경우 빠져나가기 */}
      <div className="w-full max-w-md mb-3 flex items-center justify-between text-xs">
        <button
          onClick={() => router.replace('/m')}
          className="text-gray-500 hover:text-gray-900 underline-offset-2 hover:underline"
        >
          ← 일반 사용자로 둘러보기
        </button>
        <button
          onClick={async () => {
            await signOut(auth);
            router.replace('/');
          }}
          className="text-gray-500 hover:text-gray-900 underline-offset-2 hover:underline"
        >
          다른 계정으로 로그인 →
        </button>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 w-full max-w-md overflow-hidden">
        {/* 진행 막대 */}
        <div className="p-5 border-b border-gray-100">
          <div className="flex gap-1 mb-3">
            {[1, 2, 3, 4].map((n) => (
              <div
                key={n}
                className={`flex-1 h-1 rounded ${
                  step === n ? 'bg-red-500' : step > n ? 'bg-black' : 'bg-gray-200'
                }`}
              />
            ))}
          </div>
          <div className="text-[10px] font-bold text-gray-500 tracking-wider">
            STEP {Math.min(step, 4)} / 4 · 매장 가입
          </div>
          <div className="text-base font-extrabold text-gray-900 mt-1">
            {['', '기본 정보', '운영 정보', '약관 동의', '완료', '신청 완료'][step]}
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            {['', '매장명·주소·전화', '영업시간·시설·소개', '이용약관 동의', '', '심사 후 활성화'][step]}
          </div>
        </div>

        {/* 본문 */}
        <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto">
          {step === 1 && (
            <>
              <Field label="매장명">
                <input
                  className="form-input"
                  value={form.name}
                  onChange={(e) => update('name', e.target.value)}
                  placeholder="예: 광안리 카드클럽"
                />
              </Field>
              <Field label="주소 (검색)">
                {form.addressSelected ? (
                  <div className="bg-green-50 border-2 border-green-600 rounded-lg p-3">
                    <div className="text-sm font-bold text-gray-900">{form.addressSelected.main}</div>
                    <div className="text-xs text-green-700 mt-0.5">✓ {form.addressSelected.sub}</div>
                    <button
                      onClick={() => update('addressSelected', null)}
                      className="text-xs text-gray-500 underline mt-2"
                    >
                      다시 검색
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      className="form-input"
                      value={form.addressQuery}
                      onChange={(e) => update('addressQuery', e.target.value)}
                      placeholder="🔍 매장명·도로명·건물명 (카카오 지도 검색)"
                    />
                    {addrSearching && (
                      <div className="mt-2 text-[11px] text-gray-500 px-1">검색 중…</div>
                    )}
                    {!addrSearching && form.addressQuery.trim().length >= 2 && addrResults.length === 0 && (
                      <div className="mt-2 text-[11px] text-gray-500 px-1">
                        결과 없음 · 다른 키워드로 시도해보세요
                      </div>
                    )}
                    {addrResults.length > 0 && (
                      <div className="mt-2 space-y-1 max-h-64 overflow-y-auto">
                        {addrResults.map((r, i) => (
                          <div
                            key={i}
                            onClick={() => {
                              update('addressSelected', r);
                              update('addressQuery', '');
                              setAddrResults([]);
                            }}
                            className="bg-white border border-gray-200 rounded-lg px-3 py-2 cursor-pointer hover:bg-gray-50"
                          >
                            <div className="text-sm font-bold text-gray-900">{r.main}</div>
                            <div className="text-xs text-gray-500 mt-0.5">{r.sub}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="상세 주소 (선택)">
                  <input
                    className="form-input"
                    value={form.addressDetail}
                    onChange={(e) => update('addressDetail', e.target.value)}
                    placeholder="2층 / B1"
                  />
                </Field>
                <Field label="전화">
                  <input
                    className="form-input font-mono"
                    value={form.phone}
                    onChange={(e) => update('phone', e.target.value)}
                    placeholder="051-000-0000"
                  />
                </Field>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <Field label="영업시간">
                <input
                  className="form-input"
                  value={form.hours}
                  onChange={(e) => update('hours', e.target.value)}
                />
              </Field>
              <Field label="매장 소개 (최대 500자)">
                <textarea
                  className="form-input min-h-[80px]"
                  value={form.description}
                  onChange={(e) => update('description', e.target.value)}
                  placeholder="매장의 특징·분위기·운영 스타일"
                />
              </Field>
              <Field label={`시설 (${form.facilities.length}개 선택)`}>
                <div className="flex flex-wrap gap-1.5">
                  {FACILITY_OPTIONS.map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() =>
                        update(
                          'facilities',
                          form.facilities.includes(f)
                            ? form.facilities.filter((x) => x !== f)
                            : [...form.facilities, f],
                        )
                      }
                      className={`px-3 py-1.5 rounded-full text-xs font-bold border-[1.5px] transition ${
                        form.facilities.includes(f)
                          ? 'bg-black text-white border-black'
                          : 'bg-white text-gray-900 border-gray-200'
                      }`}
                    >
                      {form.facilities.includes(f) ? '✓ ' : ''}{f}
                    </button>
                  ))}
                </div>
              </Field>
            </>
          )}

          {step === 3 && (
            <>
              <label
                className={`flex items-start gap-2 p-3 rounded-lg cursor-pointer ${
                  form.agree ? 'bg-green-50' : 'bg-gray-50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={form.agree}
                  onChange={(e) => update('agree', e.target.checked)}
                  className="mt-0.5"
                />
                <div className="text-xs leading-relaxed">
                  <b className="text-sm">이용약관 및 개인정보 수집 동의</b>
                  <br />
                  <span className="text-[10px] text-gray-500">
                    본 서비스는 정보 제공 플랫폼이며, 베팅·환금 매개를 절대 하지 않음.
                    매장은 사행성 규제를 준수합니다.
                  </span>
                </div>
              </label>
              <div className="text-[10px] text-gray-400 leading-relaxed">
                💡 v0.1 데모이므로 약관 전문은 v0.2에서 추가. 사진 업로드는 가입 후 어드민에서.
              </div>
            </>
          )}

          {step === 4 && (
            <div className="text-center py-8">
              <div className="text-2xl mb-3">✅</div>
              <div className="text-sm font-bold text-gray-900 mb-2">제출 준비 완료</div>
              <div className="text-xs text-gray-500 leading-relaxed">
                매장명: <b className="text-gray-900">{form.name}</b>
                <br />
                주소: {form.addressSelected?.main}
                <br />
                시설: {form.facilities.length}개
              </div>
              {error && (
                <div className="mt-4 bg-red-50 border border-red-200 rounded p-3 text-xs text-red-700 text-left">
                  {error}
                </div>
              )}
            </div>
          )}

          {step === 5 && (
            <div className="text-center py-8">
              <div className="text-5xl mb-3">🎉</div>
              <div className="text-base font-extrabold text-gray-900 mb-2">매장 신청 완료!</div>
              <div className="text-xs text-gray-500 leading-relaxed mb-4">
                <b className="text-gray-900">{form.name}</b>
                <br />
                {form.addressSelected?.main}
                <br />
                Firestore에 저장됨 · status: <code className="bg-gray-100 px-1 rounded">pending</code>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-[11px] text-amber-800 leading-relaxed text-left">
                💡 <b>심사 안내</b>: v0.2부터 플랫폼 운영팀이 매장 확인 후 승인합니다. 지금은 즉시 어드민 진입.
              </div>
            </div>
          )}
        </div>

        {/* 액션 */}
        <div className="p-4 border-t border-gray-100 flex gap-2">
          {step > 1 && step < 4 && (
            <button
              onClick={() => setStep(step - 1)}
              className="flex-1 py-2.5 rounded-lg border-[1.5px] border-gray-200 font-bold text-sm"
            >
              이전
            </button>
          )}
          {step < 4 && (
            <button
              onClick={() => setStep(step + 1)}
              disabled={!canProceed}
              className="flex-1 py-2.5 rounded-lg bg-black text-white font-bold text-sm disabled:opacity-40"
            >
              다음
            </button>
          )}
          {step === 4 && (
            <button
              onClick={submit}
              disabled={submitting}
              className="flex-1 py-2.5 rounded-lg bg-red-500 text-white font-bold text-sm disabled:opacity-40"
            >
              {submitting ? '제출 중…' : '신청 제출'}
            </button>
          )}
          {step === 5 && (
            <button
              onClick={() => router.replace('/')}
              className="flex-1 py-2.5 rounded-lg bg-black text-white font-bold text-sm"
            >
              매장 어드민으로 →
            </button>
          )}
        </div>
      </div>

      <style jsx global>{`
        .form-input {
          background: #fff;
          border: 1.5px solid #eaeaea;
          border-radius: 8px;
          padding: 8px 12px;
          font-size: 13px;
          color: #111;
          width: 100%;
          box-sizing: border-box;
          outline: none;
        }
        .form-input:focus { border-color: #111; }
      `}</style>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-bold text-gray-500 tracking-wider mb-1.5">{label}</div>
      {children}
    </div>
  );
}
