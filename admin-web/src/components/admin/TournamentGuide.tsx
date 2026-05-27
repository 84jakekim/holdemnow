'use client';

/**
 * 매장 어드민 — 예정 토너 활용 가이드 카드 (2026-05-27 사용자 요청)
 *
 * "이 기능을 활용하면 매장 영업에 어떤 이점이 있고 어떻게 작동하는지"
 *  → 사장님이 첫 진입 시 자동 안내 + dismiss 가능 + 다시 보기 가능.
 */

import { useEffect, useState } from 'react';

const GUIDE_DISMISS_KEY = 'hn:admin:tournaments-guide-dismissed';

export default function TournamentGuide() {
  const [open, setOpen] = useState(true);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage.getItem(GUIDE_DISMISS_KEY) === '1') {
        setDismissed(true);
      }
    } catch {
      /* noop */
    }
  }, []);

  const handleDismiss = () => {
    try {
      window.localStorage.setItem(GUIDE_DISMISS_KEY, '1');
    } catch {
      /* noop */
    }
    setDismissed(true);
  };

  if (dismissed) {
    return (
      <button
        onClick={() => {
          try {
            window.localStorage.removeItem(GUIDE_DISMISS_KEY);
          } catch {
            /* noop */
          }
          setDismissed(false);
          setOpen(true);
        }}
        className="mb-4 tap"
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: 'var(--brand)',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
        }}
      >
        💡 활용 가이드 다시 보기
      </button>
    );
  }

  return (
    <div
      className="mb-5 lift"
      style={{
        background: 'var(--bg)',
        border: '1px solid rgba(255,31,143,0.20)',
        borderRadius: 'var(--r-xl)',
        boxShadow: 'var(--shadow-card)',
        overflow: 'hidden',
      }}
    >
      {/* 헤더 */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 tap"
        style={{
          background:
            'linear-gradient(135deg, rgba(255,31,143,0.06) 0%, rgba(255,31,143,0.02) 100%)',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <div className="flex items-center gap-2">
          <span style={{ fontSize: 16 }}>💡</span>
          <span style={{ fontSize: 13, fontWeight: 900, color: 'var(--text-1)' }}>
            예정 토너 활용 가이드 — 영업 이점 + 작동 방식
          </span>
        </div>
        <span style={{ color: 'var(--text-2)', fontSize: 14 }}>{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className="px-4 py-4 space-y-5">
          {/* 1. 영업 이점 */}
          <section>
            <div
              className="text-[11px] font-extrabold tracking-wider mb-2"
              style={{ color: 'var(--brand)' }}
            >
              🎯 매장 영업에 어떤 이점이?
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {[
                {
                  icon: '🔍',
                  title: '새 손님 발견 증가',
                  desc: '사용자 위치 기반으로 가까운 매장 캘린더에 자동 노출. 단골 외 신규 유입 가능.',
                },
                {
                  icon: '🔁',
                  title: '재방문 유도',
                  desc: '매장 즐겨찾기 한 사용자에게 토너 시작 1시간 전 푸시 알림 자동 발송.',
                },
                {
                  icon: '✅',
                  title: '참가율 향상·노쇼 감소',
                  desc: '관심 토너 등록한 사용자에게 시작 1h 전 + 늦은 등록 30분 전 알림 → 잊지 않고 출발.',
                },
                {
                  icon: '🔴',
                  title: 'LIVE 시인성 증가',
                  desc: 'scheduled → live 전환 시 매장 즐겨찾기 사용자 전원에게 푸시 + 홈 LIVE 카드 노출.',
                },
              ].map((it) => (
                <div
                  key={it.title}
                  className="p-3"
                  style={{
                    background: 'var(--surface-2)',
                    borderRadius: 'var(--r-md)',
                    border: '1px solid var(--border)',
                  }}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <span style={{ fontSize: 14 }}>{it.icon}</span>
                    <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-1)' }}>
                      {it.title}
                    </span>
                  </div>
                  <div className="text-[11px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
                    {it.desc}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* 2. 작동 방식 */}
          <section>
            <div
              className="text-[11px] font-extrabold tracking-wider mb-2"
              style={{ color: 'var(--brand)' }}
            >
              ⚙️ 등록 1회 = 5곳 자동 노출 + 4종 푸시
            </div>
            <div
              className="p-3 space-y-1.5"
              style={{
                background: 'var(--surface-2)',
                borderRadius: 'var(--r-md)',
                border: '1px solid var(--border)',
              }}
            >
              {[
                { n: 1, where: '🗓 캘린더 탭', what: '모든 사용자가 보는 통합 캘린더 (지역별 정렬)' },
                { n: 2, where: '🏬 매장 상세 페이지', what: '매장 페이지에 "예정 토너" 섹션 자동' },
                { n: 3, where: '🔎 검색 결과', what: '토너명·매장명·바이인으로 검색 시 노출' },
                { n: 4, where: '⭐ 관심 토너 등록 가능', what: '사용자가 ★로 본인 모음에 추가' },
                { n: 5, where: '📺 LIVE 풀스크린 + TV 디스플레이', what: 'scheduled → live 전환 시' },
              ].map((it) => (
                <div key={it.n} className="flex items-start gap-2 text-[11.5px]">
                  <span
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 99,
                      background: 'var(--brand)',
                      color: '#fff',
                      fontSize: 10,
                      fontWeight: 800,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    {it.n}
                  </span>
                  <div className="flex-1">
                    <span style={{ fontWeight: 800, color: 'var(--text-1)' }}>{it.where}</span>
                    <span style={{ color: 'var(--text-2)', marginLeft: 4 }}>— {it.what}</span>
                  </div>
                </div>
              ))}
            </div>

            <div
              className="mt-2 p-3 text-[11px] leading-relaxed"
              style={{
                background: 'rgba(255,31,143,0.06)',
                border: '1px solid rgba(255,31,143,0.20)',
                borderRadius: 'var(--r-md)',
                color: 'var(--text-2)',
              }}
            >
              <div style={{ fontWeight: 800, marginBottom: 4, color: 'var(--text-1)' }}>
                🔔 자동 푸시 알림 4종 (FCM + 인앱 종)
              </div>
              <div>
                · 토너 시작 1h 전 — 관심 토너 등록자
                <br />
                · 늦은 등록 마감 30분 전 — 관심 등록자
                <br />
                · 시리즈 D-7 / D-3 / D-1 — 시리즈 구독자
                <br />
                · 즐겨찾기 매장 LIVE 시작 — 즐겨찾기 사용자
              </div>
            </div>
          </section>

          {/* 3. 권장 운영 팁 */}
          <section>
            <div
              className="text-[11px] font-extrabold tracking-wider mb-2"
              style={{ color: 'var(--brand)' }}
            >
              📋 사장님께 권장하는 운영 패턴
            </div>
            <ul className="text-[11.5px] space-y-1.5 leading-relaxed" style={{ color: 'var(--text-2)' }}>
              <li>
                <b style={{ color: 'var(--text-1)' }}>1주~2주치 미리 등록</b> — 정기 데일리·시리즈는
                일괄 등록. 사용자가 미리 일정 잡고 관심 등록함.
              </li>
              <li>
                <b style={{ color: 'var(--text-1)' }}>🏬 매장 정보 충실</b> — 사진·소개·운영시간 정확히
                채우면 매장 즐겨찾기 증가 → 푸시 효과 증가.
              </li>
              <li>
                <b style={{ color: 'var(--text-1)' }}>📢 "오늘의 매장소식"과 병행</b> — 같은 토너를
                채팅방 톤 카드로도 홍보 → 홈에서 이중 노출.
              </li>
              <li>
                <b style={{ color: 'var(--text-1)' }}>▶ LIVE 즉시 전환</b> — 시작 시각이 오면 같은
                패널에서 ▶ 새 LIVE 시작 클릭 → 즐겨찾기 사용자 푸시 + TV 자동.
              </li>
              <li>
                <b style={{ color: 'var(--text-1)' }}>📊 통계 확인</b> — 좌측 <i>📊 통계</i> 메뉴에서
                노출·클릭·전화 등 효과 측정.
              </li>
            </ul>
          </section>

          {/* 닫기 */}
          <div
            className="pt-2 flex items-center justify-end gap-3 border-t"
            style={{ borderColor: 'var(--border)' }}
          >
            <button
              onClick={() => setOpen(false)}
              className="tap"
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: 'var(--text-3)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              접기
            </button>
            <button
              onClick={handleDismiss}
              className="tap"
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: 'var(--text-2)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              다시 보지 않기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
