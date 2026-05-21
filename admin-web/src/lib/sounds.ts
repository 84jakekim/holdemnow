'use client';

/**
 * LIVE 카운트다운·블라인드업 사운드 헬퍼.
 *
 * 외부 오디오 파일 의존 없이 Web Audio API로 즉시 톤 생성.
 * - playCountdownBeep: 10~2초 짧은 비프 (700Hz · 150ms)
 * - playFinalBeep: 1초/0초 마지막 비프 (900Hz · 250ms · 더 큼)
 * - playBlindUp: 레벨 전환 알림 — C5→E5→G5 화려한 상승 톤
 * - unlockAudio: iOS Safari 첫 터치 전 AudioContext suspended 해제용
 *
 * iOS Safari는 백그라운드 → 포그라운드 복귀 시 AudioContext가 다시 suspended 되는
 * 경우가 있어, 매 재생 직전에 state 검사 + resume 비동기 트리거 + 이번 호출 skip
 * 패턴을 사용. 다음 호출부터 정상 재생됨.
 */

let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (audioCtx) return audioCtx;
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
    return audioCtx;
  } catch {
    return null;
  }
}

/** ctx가 suspended이면 resume 시도. 동기적으론 즉시 깨어나지 않을 수 있지만
 *  Web Audio API는 suspended 상태에서도 osc.start()가 큐에 들어가 깨어난 직후 재생됨.
 *  → skip하지 말고 그대로 재생 시도. */
function tryResume(ctx: AudioContext): void {
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
}

/** 짧은 비프 — 카운트다운 (10~2초). 700Hz 150ms. */
export function playCountdownBeep(): void {
  const ctx = getCtx();
  if (!ctx) return;
  tryResume(ctx);

  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 700;
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.16);
  } catch {
    /* AudioContext가 닫혀있거나 비정상 — 무시 */
  }
}

/** 1초/0초 마지막 비프 — 더 높고 길게. 900Hz 250ms. */
export function playFinalBeep(): void {
  const ctx = getCtx();
  if (!ctx) return;
  tryResume(ctx);

  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 900;
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.4, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.26);
  } catch {
    /* ignore */
  }
}

/** 블라인드업! 알림 — 세 톤 상승 (C5→E5→G5). */
export function playBlindUp(): void {
  const ctx = getCtx();
  if (!ctx) return;
  tryResume(ctx);

  try {
    const now = ctx.currentTime;
    playNote(ctx, 523, now, 0.18); // C5
    playNote(ctx, 659, now + 0.15, 0.25); // E5
    playNote(ctx, 784, now + 0.3, 0.35); // G5
  } catch {
    /* ignore */
  }
}

function playNote(ctx: AudioContext, freq: number, startAt: number, duration: number): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle'; // sine보다 살짝 풍부한 톤
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(0.35, startAt + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, startAt + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.05);
}

/**
 * 모바일 Safari/iOS는 사용자 첫 터치 이전엔 AudioContext suspended.
 * 페이지 mount 시 한 번 호출하면 ready 상태로 (단 실제 깨어남은 첫 user gesture 시).
 * 사용자 제스처 핸들러 내부에서도 호출해서 확실하게 깨움.
 */
export function unlockAudio(): void {
  const ctx = getCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
}
