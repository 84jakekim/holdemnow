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
 * 사장 요청(2026-05-27 정정#4, PM 단독):
 *  · 한국 사장이 알아듣게 한국어로
 *  · 오락기처럼 명확·흥분된 톤
 *  · 0초 도달 즉시 발사 (지연 X)
 *  · TTS가 차임에 묻혀 안 들리던 버그 제거 — 둘 다 명확히 들리게
 *
 * 흐름 (재설계):
 *   t=0ms      : 차임 시작 (C5 → G5, sine, gain 0.6, 0.36초)
 *   t=0ms      : TTS "블라인드 업!" speak() 즉시 호출 (cancel() X, queue 대기 X)
 *                → 브라우저 음성 엔진이 차임과 병렬 발화. 음역대 분리되어 둘 다 명확.
 *
 * 사용자 보고("TTS가 안 들리고 톤만") 핵심 원인:
 *  1) ❌ setTimeout(120ms) 안에서 speak — user gesture 컨텍스트 손실(일부 브라우저)
 *  2) ❌ synth.cancel() — 직전 발화/큐 모두 취소 → 본 발화도 queue race로 무효화
 *  3) ❌ pitch 1.5 — 일부 voice는 무성/매우 작게 발화
 *
 * Fix:
 *  · setTimeout 제거. 호출처에서 직접 speak 호출 (사용자 click → 트리거 useEffect 내 호출 동일 task tick).
 *  · cancel() 제거. 블라인드업은 5분에 한 번이라 큐 충돌 사실상 없음.
 *  · pitch 1.0 (자연스러운 음성 + 볼륨 보장).
 *
 * 한국어 보이스 fallback:
 *  1. ko-KR 보이스 사용 가능 → 그 보이스 선택
 *  2. 사용 불가 → lang='ko-KR'만 지정 (브라우저 기본)
 *  3. 둘 다 실패 → silent (차임만 발사)
 */
// Cross-tab + module-level cooldown
// 2026-05-28 #2 사용자 보고: cooldown 3초 + module dedup도 1→2레벨 2중 발화.
//   원인 = 같은 기기에서 TV/매장 컨트롤/LIVE 풀스크린 여러 페이지가 동시 열림
//   → 각 페이지가 별도 JS 컨텍스트라 module-level cooldown 격리.
// Fix: localStorage 기반 cross-tab dedup 5초.
const BLIND_UP_COOLDOWN_MS = 5000;
const LS_KEY = 'pr:blindUp:lastFiredAt';

function getLastFired(): number {
  if (typeof window === 'undefined') return 0;
  try { return Number(window.localStorage.getItem(LS_KEY) || 0); } catch { return 0; }
}
function setLastFired(t: number) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(LS_KEY, String(t)); } catch { /* private mode */ }
}
let lastBlindUpFiredAt = 0; // module-level (cross-tab과 함께 이중 안전)

export function playBlindUp(): void {
  if (typeof window === 'undefined') return;

  // Cross-tab + module-level dedup
  const now = Date.now();
  if (now - lastBlindUpFiredAt < BLIND_UP_COOLDOWN_MS) return;
  if (now - getLastFired() < BLIND_UP_COOLDOWN_MS) return;
  lastBlindUpFiredAt = now;
  setLastFired(now);

  // 2026-05-28 #12 (사용자 테스트 요청): TTS 제거 → 단순 레벨체인지 비프 1회.
  //   "TTS 넣고나서 타이머가 이상해진 것 같다" — TTS speechSynthesis가 메인스레드를
  //   잡아 React render 지연시켜 타이머 정체 유발 가능성. TTS 빠지면 정상화되는지 검증.
  const ctx = getCtx();
  if (!ctx) return;
  tryResume(ctx);
  try {
    const t0 = ctx.currentTime;
    // 명확하고 짧은 단음 — 1320Hz(E6) 0.35초 + 약간 강조 (gain 0.8)
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 1320;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(0.8, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.36);
  } catch {
    /* ignore */
  }
}

/**
 * 한국어 TTS "블라인드 업!" 단독 발화.
 *
 * playBlindUp()이 내부에서 호출하지만, 매장 사장이 TTS만 트리거 테스트하고 싶거나
 * 사운드 설정에서 "음성만" 모드를 만들 때 사용. 차임 없이 깔끔.
 *
 * iOS Safari 호환:
 *  · 첫 사용자 터치 후 unlockAudio()가 호출돼야 동작 (이미 TV/LIVE 페이지 첫 click 핸들러에서 처리).
 *  · synth.cancel() 절대 호출 X — 일부 iOS Safari 버전에서 cancel 직후 speak가 묵음 처리됨.
 */
export function speakBlindUp(): void {
  if (typeof window === 'undefined') return;
  const synth = window.speechSynthesis;
  if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return;
  // 큐에 같은 발화가 이미 대기/진행 중이면 skip (iOS Safari race 추가 보호)
  if (synth.speaking || synth.pending) return;
  try {
    const utter = new SpeechSynthesisUtterance('블라인드 업!');
    utter.lang = 'ko-KR';
    utter.rate = 1.0;
    utter.pitch = 1.0;
    utter.volume = 1.0;
    // 한국어 보이스 명시 선택 — 일부 브라우저는 lang만으론 ko-KR 보이스 못 찾음
    const voices = synth.getVoices();
    const ko = voices.find((v) => v.lang === 'ko-KR') ?? voices.find((v) => v.lang.startsWith('ko'));
    if (ko) utter.voice = ko;
    synth.speak(utter);
  } catch {
    /* ignore — silent fallback */
  }
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
 *
 * 추가 (2026-05-27 정정#4):
 *  · SpeechSynthesis도 같이 prime — 첫 user gesture 안에서 무음 utterance 발화로
 *    iOS Safari/Chrome의 speech engine을 깨워둠. voices 비동기 로딩도 트리거.
 *  · 이걸 안 하면 첫 playBlindUp() 호출 시 voices가 빈 배열이라 ko-KR 보이스 못 찾음 →
 *    영어 default voice로 발화 → 한국어 텍스트가 알아들을 수 없게 들림.
 */
export function unlockAudio(): void {
  const ctx = getCtx();
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});

  // SpeechSynthesis prime — 무음 utterance로 engine 깨움 + voices 강제 로드 트리거
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    try {
      // getVoices() 호출만으로 일부 브라우저는 비동기 로드 시작
      window.speechSynthesis.getVoices();
      // 무음 utterance — volume=0이라 실제 소리 없음. engine 워밍업만.
      if (typeof SpeechSynthesisUtterance !== 'undefined') {
        const warmup = new SpeechSynthesisUtterance(' ');
        warmup.volume = 0;
        warmup.rate = 10; // 빠르게 종료
        warmup.lang = 'ko-KR';
        window.speechSynthesis.speak(warmup);
      }
    } catch {
      /* ignore */
    }
  }
}
