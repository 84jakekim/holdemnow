'use client';

/**
 * BusinessHoursPicker
 * 매장 영업시간 입력 UI — 시간 select 기반.
 *
 * - 상위 컴포넌트와의 인터페이스는 `value: string`, `onChange: (next: string) => void`.
 * - 저장은 사람이 읽기 쉬운 한 줄 문자열로 조립 (Firestore stores/{}.hours 호환).
 *   예: "매일 18:00 - 익일 05:00" / "매일 24시간"
 *       "평일 18:00 - 익일 04:00, 주말 19:00 - 익일 06:00"
 *       "매주 화요일 휴무 / 매일 18:00 - 익일 05:00"
 *
 * 모드:
 *  - daily   : 매일 동일 (기본). 시작·종료 시간 2개.
 *  - split   : 평일/주말 다름. 각각 시작·종료 시간.
 *  - allDay  : 24시간 영업.
 *
 * 옵션:
 *  - 휴무 요일 (없음 또는 1개) — "매주 X요일 휴무" 한 줄 추가.
 *
 * 종료 시간 < 시작 시간이면 "익일 HH:MM"으로 자동 라벨.
 *
 * 외부 라이브러리 없이 native select 사용. 모바일 native picker 활용.
 */

import { useEffect, useMemo, useState } from 'react';

// =====================================================================
// 타입
// =====================================================================

export interface BusinessHoursPickerProps {
  value: string;
  onChange: (next: string) => void;
}

type Mode = 'daily' | 'split' | 'allDay';

interface InternalState {
  mode: Mode;
  dailyStart: string;
  dailyEnd: string;
  weekdayStart: string;
  weekdayEnd: string;
  weekendStart: string;
  weekendEnd: string;
  closedDay: '' | '월' | '화' | '수' | '목' | '금' | '토' | '일';
}

// =====================================================================
// 상수
// =====================================================================

const TIME_OPTIONS: string[] = (() => {
  const out: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 30) {
      out.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  }
  return out;
})();

const DAY_OPTIONS = ['월', '화', '수', '목', '금', '토', '일'] as const;

// =====================================================================
// 파싱·조립 헬퍼
// =====================================================================

/** "HH:MM"인지 빠른 검사 */
function isHHMM(s: string): boolean {
  return /^\d{2}:\d{2}$/.test(s) && TIME_OPTIONS.includes(s);
}

/** 종료 < 시작이면 "익일 HH:MM" 라벨, 아니면 "HH:MM" */
function fmtEnd(start: string, end: string): string {
  if (!isHHMM(start) || !isHHMM(end)) return end;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  return endMin <= startMin ? `익일 ${end}` : end;
}

/** state → 저장용 한 줄 문자열 */
function buildString(s: InternalState): string {
  const closedPrefix = s.closedDay ? `매주 ${s.closedDay}요일 휴무 / ` : '';
  if (s.mode === 'allDay') {
    return `${closedPrefix}매일 24시간`.trim();
  }
  if (s.mode === 'split') {
    const wd = `평일 ${s.weekdayStart} - ${fmtEnd(s.weekdayStart, s.weekdayEnd)}`;
    const we = `주말 ${s.weekendStart} - ${fmtEnd(s.weekendStart, s.weekendEnd)}`;
    return `${closedPrefix}${wd}, ${we}`;
  }
  // daily
  return `${closedPrefix}매일 ${s.dailyStart} - ${fmtEnd(s.dailyStart, s.dailyEnd)}`;
}

/** value 문자열 → state 추측 파싱 (best-effort). 실패 시 기본값. */
function parseString(value: string): InternalState {
  const init: InternalState = {
    mode: 'daily',
    dailyStart: '18:00',
    dailyEnd: '05:00',
    weekdayStart: '18:00',
    weekdayEnd: '04:00',
    weekendStart: '19:00',
    weekendEnd: '06:00',
    closedDay: '',
  };
  if (!value || !value.trim()) return init;

  let rest = value.trim();

  // 휴무 요일 prefix
  const closedMatch = rest.match(/매주\s*([월화수목금토일])요일\s*휴무\s*\/\s*/);
  if (closedMatch) {
    init.closedDay = closedMatch[1] as InternalState['closedDay'];
    rest = rest.slice(closedMatch[0].length);
  }

  if (/24\s*시간/.test(rest)) {
    init.mode = 'allDay';
    return init;
  }

  // 시간 추출 헬퍼
  const extractTimes = (segment: string): [string, string] | null => {
    const m = segment.match(/(\d{2}:\d{2})\s*-\s*(?:익일\s*)?(\d{2}:\d{2})/);
    if (!m) return null;
    return [m[1], m[2]];
  };

  // 평일/주말 분리?
  if (/평일/.test(rest) && /주말/.test(rest)) {
    init.mode = 'split';
    const wdSeg = rest.split(',')[0] ?? '';
    const weSeg = rest.split(',')[1] ?? '';
    const wd = extractTimes(wdSeg);
    const we = extractTimes(weSeg);
    if (wd) {
      init.weekdayStart = wd[0];
      init.weekdayEnd = wd[1];
    }
    if (we) {
      init.weekendStart = we[0];
      init.weekendEnd = we[1];
    }
    return init;
  }

  // 기본: 매일
  const times = extractTimes(rest);
  if (times) {
    init.dailyStart = times[0];
    init.dailyEnd = times[1];
  }
  return init;
}

// =====================================================================
// 컴포넌트
// =====================================================================

export default function BusinessHoursPicker({ value, onChange }: BusinessHoursPickerProps) {
  const [state, setState] = useState<InternalState>(() => parseString(value));

  // 외부에서 value가 (예: 폼 리셋으로) 의미있게 바뀌면 한번 동기화
  useEffect(() => {
    const parsed = parseString(value);
    const rebuilt = buildString(parsed);
    if (value && rebuilt !== buildString(state)) {
      setState(parsed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const preview = useMemo(() => buildString(state), [state]);

  // 상태가 바뀌면 부모로 전파
  useEffect(() => {
    onChange(preview);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview]);

  const setMode = (mode: Mode) => setState((s) => ({ ...s, mode }));
  const patch = (p: Partial<InternalState>) => setState((s) => ({ ...s, ...p }));

  return (
    <div className="bhp-root">
      {/* 모드 탭 */}
      <div className="bhp-tabs" role="tablist" aria-label="영업시간 모드">
        <ModeTab active={state.mode === 'daily'} onClick={() => setMode('daily')}>
          매일 동일
        </ModeTab>
        <ModeTab active={state.mode === 'split'} onClick={() => setMode('split')}>
          평일/주말
        </ModeTab>
        <ModeTab active={state.mode === 'allDay'} onClick={() => setMode('allDay')}>
          24시간
        </ModeTab>
      </div>

      {/* 시간 선택 영역 */}
      {state.mode === 'daily' && (
        <div className="bhp-row">
          <TimeSelect
            label="시작"
            value={state.dailyStart}
            onChange={(v) => patch({ dailyStart: v })}
          />
          <span className="bhp-dash">—</span>
          <TimeSelect
            label="종료"
            value={state.dailyEnd}
            onChange={(v) => patch({ dailyEnd: v })}
            nextDay={isNextDay(state.dailyStart, state.dailyEnd)}
          />
        </div>
      )}

      {state.mode === 'split' && (
        <div className="bhp-split">
          <div className="bhp-split-block">
            <div className="bhp-split-label">평일 (월~금)</div>
            <div className="bhp-row">
              <TimeSelect
                label="시작"
                value={state.weekdayStart}
                onChange={(v) => patch({ weekdayStart: v })}
              />
              <span className="bhp-dash">—</span>
              <TimeSelect
                label="종료"
                value={state.weekdayEnd}
                onChange={(v) => patch({ weekdayEnd: v })}
                nextDay={isNextDay(state.weekdayStart, state.weekdayEnd)}
              />
            </div>
          </div>
          <div className="bhp-split-block">
            <div className="bhp-split-label">주말 (토·일)</div>
            <div className="bhp-row">
              <TimeSelect
                label="시작"
                value={state.weekendStart}
                onChange={(v) => patch({ weekendStart: v })}
              />
              <span className="bhp-dash">—</span>
              <TimeSelect
                label="종료"
                value={state.weekendEnd}
                onChange={(v) => patch({ weekendEnd: v })}
                nextDay={isNextDay(state.weekendStart, state.weekendEnd)}
              />
            </div>
          </div>
        </div>
      )}

      {state.mode === 'allDay' && (
        <div className="bhp-allday">언제든 영업 중 — 24시간 운영</div>
      )}

      {/* 휴무일 */}
      <div className="bhp-closed">
        <span className="bhp-closed-label">정기 휴무</span>
        <div className="bhp-closed-row">
          <ClosedChip active={state.closedDay === ''} onClick={() => patch({ closedDay: '' })}>
            없음
          </ClosedChip>
          {DAY_OPTIONS.map((d) => (
            <ClosedChip
              key={d}
              active={state.closedDay === d}
              onClick={() => patch({ closedDay: d })}
            >
              {d}
            </ClosedChip>
          ))}
        </div>
      </div>

      {/* 미리보기 */}
      <div className="bhp-preview">
        <span className="bhp-preview-tag">미리보기</span>
        <span className="bhp-preview-text">{preview}</span>
      </div>

      <style jsx>{`
        .bhp-root {
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding: 12px;
          border: 1.5px solid #e5e7eb;
          border-radius: 12px;
          background: #fff;
        }
        .bhp-tabs {
          display: flex;
          gap: 4px;
          background: var(--surface-2, #f3f4f6);
          padding: 3px;
          border-radius: 9px;
        }
        .bhp-row {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .bhp-dash {
          color: #9ca3af;
          font-weight: 700;
          padding: 0 2px;
        }
        .bhp-split {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .bhp-split-block {
          padding: 10px;
          border-radius: 10px;
          background: var(--surface-2, #f9fafb);
        }
        .bhp-split-label {
          font-size: 11px;
          font-weight: 700;
          color: #6b7280;
          letter-spacing: 0.04em;
          margin-bottom: 6px;
        }
        .bhp-allday {
          padding: 14px;
          text-align: center;
          font-size: 13px;
          font-weight: 700;
          color: var(--brand, #ff1f8f);
          background: var(--brand-pale, #fff0f7);
          border-radius: 10px;
        }
        .bhp-closed {
          display: flex;
          flex-direction: column;
          gap: 6px;
          padding-top: 4px;
          border-top: 1px dashed #e5e7eb;
        }
        .bhp-closed-label {
          font-size: 11px;
          font-weight: 700;
          color: #6b7280;
          letter-spacing: 0.04em;
        }
        .bhp-closed-row {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
        }
        .bhp-preview {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 12px;
          background: var(--brand-pale, #fff0f7);
          border-radius: 10px;
          border: 1px solid rgba(255, 31, 143, 0.18);
        }
        .bhp-preview-tag {
          font-size: 10px;
          font-weight: 800;
          color: var(--brand, #ff1f8f);
          letter-spacing: 0.08em;
          background: #fff;
          padding: 2px 7px;
          border-radius: 999px;
          flex-shrink: 0;
        }
        .bhp-preview-text {
          font-size: 13px;
          font-weight: 600;
          color: #111;
          word-break: keep-all;
        }
      `}</style>
    </div>
  );
}

// =====================================================================
// 하위 컴포넌트
// =====================================================================

function ModeTab({
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
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className="bhp-tab"
    >
      {children}
      <style jsx>{`
        .bhp-tab {
          flex: 1;
          padding: 8px 6px;
          font-size: 12px;
          font-weight: 700;
          border: none;
          background: ${active ? 'var(--brand, #ff1f8f)' : 'transparent'};
          color: ${active ? '#fff' : '#6b7280'};
          border-radius: 7px;
          cursor: pointer;
          transition: background 0.15s, color 0.15s;
          min-height: 36px;
        }
        .bhp-tab:hover {
          color: ${active ? '#fff' : '#111'};
        }
      `}</style>
    </button>
  );
}

function TimeSelect({
  label,
  value,
  onChange,
  nextDay,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  nextDay?: boolean;
}) {
  return (
    <label className="bhp-time-wrap">
      <span className="bhp-time-label">
        {label}
        {nextDay && <span className="bhp-nd-badge">익일</span>}
      </span>
      <select
        className="bhp-time-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {TIME_OPTIONS.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <style jsx>{`
        .bhp-time-wrap {
          display: flex;
          flex-direction: column;
          gap: 4px;
          flex: 1;
          min-width: 110px;
        }
        .bhp-time-label {
          font-size: 10px;
          font-weight: 700;
          color: #6b7280;
          letter-spacing: 0.04em;
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .bhp-nd-badge {
          background: var(--brand, #ff1f8f);
          color: #fff;
          font-size: 9px;
          font-weight: 800;
          padding: 1px 5px;
          border-radius: 999px;
          letter-spacing: 0;
        }
        .bhp-time-select {
          appearance: none;
          -webkit-appearance: none;
          background: #fff
            url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12"><path d="M3 4.5L6 7.5L9 4.5" stroke="%236b7280" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>')
            no-repeat right 10px center;
          border: 1.5px solid #e5e7eb;
          border-radius: 9px;
          padding: 10px 30px 10px 12px;
          font-size: 14px;
          font-weight: 600;
          color: #111;
          outline: none;
          cursor: pointer;
          min-height: 42px;
          transition: border-color 0.15s;
        }
        .bhp-time-select:focus {
          border-color: var(--brand, #ff1f8f);
        }
      `}</style>
    </label>
  );
}

function ClosedChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} className="bhp-chip">
      {children}
      <style jsx>{`
        .bhp-chip {
          min-width: 38px;
          min-height: 32px;
          padding: 6px 10px;
          font-size: 12px;
          font-weight: 700;
          border-radius: 999px;
          border: 1.5px solid ${active ? 'var(--brand, #ff1f8f)' : '#e5e7eb'};
          background: ${active ? 'var(--brand, #ff1f8f)' : '#fff'};
          color: ${active ? '#fff' : '#6b7280'};
          cursor: pointer;
          transition: border-color 0.15s, background 0.15s, color 0.15s;
        }
        .bhp-chip:hover {
          border-color: ${active ? 'var(--brand-dim, #e01077)' : '#9ca3af'};
        }
      `}</style>
    </button>
  );
}

// =====================================================================
// 유틸
// =====================================================================

function isNextDay(start: string, end: string): boolean {
  if (!isHHMM(start) || !isHHMM(end)) return false;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return eh * 60 + em <= sh * 60 + sm;
}
