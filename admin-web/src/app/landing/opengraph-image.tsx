import { ImageResponse } from 'next/og';

/**
 * /landing 링크 공유 시 미리보기 카드 이미지 (Open Graph).
 * 카카오톡·문자·SNS가 이 1200×630 이미지를 미리보기 썸네일로 사용한다.
 *
 * Satori(next/og)는 기본 폰트가 한글을 렌더하지 못하므로 — 빌드/런타임 폰트 의존 없이
 * 안전하게 라틴+카드무늬만 이미지에 넣고, 한글 카피는 og:title/og:description(텍스트)로 전달.
 * (메신저 카드의 제목·설명은 이미지가 아니라 텍스트 메타에서 렌더되므로 한글 정상 노출)
 */

export const alt = 'HoldemNow — 전국 홀덤펍 실시간 디스커버리';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function LandingOgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '0 90px',
          background: 'linear-gradient(135deg, #0E1525 0%, #1A0A1E 55%, #2A0E1F 100%)',
          position: 'relative',
        }}
      >
        <div style={{ position: 'absolute', top: -140, right: -120, width: 560, height: 560, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,31,143,0.45), transparent 64%)', display: 'flex' }} />
        <div style={{ position: 'absolute', bottom: -160, left: -120, width: 460, height: 460, borderRadius: '50%', background: 'radial-gradient(circle, rgba(124,58,237,0.32), transparent 66%)', display: 'flex' }} />

        <div style={{ display: 'flex', marginBottom: 34 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 24px', borderRadius: 999, background: 'rgba(229,62,62,0.20)', border: '2px solid rgba(229,62,62,0.55)' }}>
            <div style={{ width: 14, height: 14, borderRadius: 999, background: '#E53E3E', display: 'flex' }} />
            <div style={{ color: '#fff', fontSize: 28, fontWeight: 800, letterSpacing: 2 }}>PRE-REGISTRATION OPEN</div>
          </div>
        </div>

        <div style={{ display: 'flex', fontSize: 124, fontWeight: 900, letterSpacing: -4, lineHeight: 1 }}>
          <span style={{ color: '#ffffff' }}>Holdem</span>
          <span style={{ color: '#FF1F8F' }}>Now</span>
        </div>

        <div style={{ display: 'flex', color: 'rgba(255,255,255,0.74)', fontSize: 42, fontWeight: 600, marginTop: 30 }}>
          Find LIVE Hold&apos;em pubs near you — in real time.
        </div>

        <div style={{ display: 'flex', gap: 26, marginTop: 46, fontSize: 60 }}>
          <span style={{ color: '#ffffff', display: 'flex' }}>♠</span>
          <span style={{ color: '#FF1F8F', display: 'flex' }}>♥</span>
          <span style={{ color: '#FF1F8F', display: 'flex' }}>♦</span>
          <span style={{ color: '#ffffff', display: 'flex' }}>♣</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
