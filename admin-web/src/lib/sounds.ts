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

/** 짧은 비프 — 카운트다운 (10~2초). 700Hz 150ms. 볼륨 3배 (0.3→0.9). */
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
    gain.gain.linearRampToValueAtTime(0.9, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.16);
  } catch {
    /* AudioContext가 닫혀있거나 비정상 — 무시 */
  }
}

/** 1초/0초 마지막 비프 — 더 높고 길게. 900Hz 250ms. 볼륨 3배 (0.4→1.0 max). */
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
    gain.gain.linearRampToValueAtTime(1.0, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.26);
  } catch {
    /* ignore */
  }
}

/**
 * 블라인드 업! 알림 — 오락기 톤 차임(2음 상승) + 한국어 TTS "블라인드 업!".
 *
 * 사장 요청(2026-05-23 정정3):
 *  · 한국 사장이 알아듣게 한국어로
 *  · 오락기처럼 명확·흥분된 톤
 *  · 카운트다운 비프 직후 즉시 발사
 *
 * 흐름:
 *   t=0ms      : 차임 시작 (C5 → G5, sine, gain 0.6, 0.3초)
 *   t=120ms    : 한국어 TTS "블라인드 업!" 발화 (rate 0.95 / pitch 1.5)
 *
 * 차임은 카운트다운 마지막 비프와 자연스럽게 이어지면서 청각 주의를 끌고,
 * TTS는 100ms만 늦춰 양쪽 사운드가 겹치지 않도록 분리.
 *
 * 한국어 보이스 fallback:
 *  1. ko-KR 보이스 사용 가능 → 그 보이스 선택
 *  2. 사용 불가 → lang='ko-KR'만 지정 (브라우저 기본)
 *  3. 둘 다 실패 → silent (차임만 발사)
 */
export function playBlindUp(): void {
  if (typeof window === 'undefined') return;

  // 1) 오락기 차임 prefix (C5 → G5 상승 2음, sine + gain 0.6)
  const ctx = getCtx();
  if (ctx) {
    tryResume(ctx);
    try {
      const t0 = ctx.currentTime;
      playArcadeNote(ctx, 523, t0, 0.16);          // C5
      playArcadeNote(ctx, 784, t0 + 0.13, 0.20);   // G5 (길게 강조)
    } catch {
      /* ignore */
    }
  }

  // 2) 한국어 TTS — 120ms 후 발화 (차임과 분리)
  const synth = window.speechSynthesis;
  if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return;
  setTimeout(() => {
    try {
      synth.cancel();
      const utter = new SpeechSynthesisUtterance('블라인드 업!');
      utter.lang = 'ko-KR';
      utter.rate = 0.95;
      utter.pitch = 1.5;
      utter.volume = 1.0;
      // 한국어 보이스 명시 선택 — 일부 브라우저는 lang만으론 ko-KR 보이스 못 찾음
      const voices = synth.getVoices();
      const ko = voices.find((v) => v.lang === 'ko-KR') ?? voices.find((v) => v.lang.startsWith('ko'));
      if (ko) utter.voice = ko;
      synth.speak(utter);
    } catch {
      /* ignore — silent fallback */
    }
  }, 120);
}

/** 오락기 톤 차임 — sine wave + 빠른 attack + 자연 decay. */
function playArcadeNote(ctx: AudioContext, freq: number, startAt: number, duration: number): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(0.6, startAt + 0.008);
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
