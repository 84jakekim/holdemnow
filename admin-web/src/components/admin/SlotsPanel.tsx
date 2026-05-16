'use client';

import { useEffect, useState } from 'react';
import {
  type DisplaySlot,
  subscribeSlots,
  setSlotSession,
  addSlot,
  removeSlot,
  renameSlot,
} from '@/lib/slots';
import { subscribeStoreLiveSessions, type LiveSession, fmtTime } from '@/lib/live';

interface Props {
  storeId: string;
}

export default function SlotsPanel({ storeId }: Props) {
  const [slots, setSlots] = useState<DisplaySlot[]>([]);
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<number | null>(null);

  useEffect(() => {
    const unsubSlots = subscribeSlots(
      storeId,
      (items) => {
        setSlots(items);
        setLoading(false);
      },
      (e) => {
        setError(e.message);
        setLoading(false);
      },
    );
    const unsubSessions = subscribeStoreLiveSessions(storeId, setSessions, () => {});
    return () => {
      unsubSlots();
      unsubSessions();
    };
  }, [storeId]);

  const openDisplay = (slotNum: number) => {
    const url = `/display/${storeId}/${slotNum}`;
    window.open(url, '_blank', 'noopener');
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">📺 디스플레이 슬롯</h1>
        <p className="text-sm text-gray-500 mt-1">매장 TV별 슬롯 — 각 슬롯에 진행 중 세션을 매핑</p>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded p-3 text-xs text-red-700">
          {error}
        </div>
      )}

      <button
        onClick={() => addSlot(storeId)}
        className="mb-4 bg-black text-white px-4 py-2.5 rounded-xl font-bold text-sm hover:bg-gray-900"
      >
        + 슬롯 추가
      </button>

      {loading ? (
        <div className="text-sm text-gray-500">로딩 중…</div>
      ) : slots.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-gray-200 rounded-xl p-10 text-center">
          <div className="text-4xl mb-3">📺</div>
          <div className="font-bold text-gray-900 mb-2">디스플레이 슬롯이 없습니다</div>
          <div className="text-xs text-gray-500 leading-relaxed">
            "+ 슬롯 추가"로 매장 TV 슬롯을 만드세요.<br />
            각 슬롯은 고유 URL을 가져 TV 브라우저에서 열 수 있습니다.
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {slots.map((s) => {
            const matched = sessions.find((ss) => ss.id === s.sessionId);
            return (
              <SlotCard
                key={s.slotNum}
                slot={s}
                matched={matched}
                sessions={sessions}
                onChangeName={(name) => renameSlot(storeId, s.slotNum, name)}
                onAssign={(sessionId) => setSlotSession(storeId, s.slotNum, sessionId)}
                onRemove={() => {
                  if (window.confirm(`슬롯 ${s.slotNum} 삭제?`)) removeSlot(storeId, s.slotNum);
                }}
                onCast={() => openDisplay(s.slotNum)}
                menuOpen={menuFor === s.slotNum}
                onToggleMenu={() => setMenuFor(menuFor === s.slotNum ? null : s.slotNum)}
                onCloseMenu={() => setMenuFor(null)}
                displayUrl={`${typeof window !== 'undefined' ? window.location.origin : ''}/display/${storeId}/${s.slotNum}`}
              />
            );
          })}
        </div>
      )}

      <div className="mt-6 bg-blue-50 border border-blue-100 rounded-xl p-4 text-xs text-blue-900 leading-relaxed">
        💡 <b>사용 방법</b>: 매장 TV의 브라우저로 슬롯 URL을 열어 F11(풀스크린). 어드민에서 슬롯에 세션을 할당하면 그 TV에 즉시 송출됩니다.
      </div>
    </div>
  );
}

interface SlotCardProps {
  slot: DisplaySlot;
  matched: LiveSession | undefined;
  sessions: LiveSession[];
  onChangeName: (name: string) => void;
  onAssign: (sessionId: string | null) => void;
  onRemove: () => void;
  onCast: () => void;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  displayUrl: string;
}

function SlotCard({
  slot,
  matched,
  sessions,
  onChangeName,
  onAssign,
  onRemove,
  onCast,
  menuOpen,
  onToggleMenu,
  onCloseMenu,
  displayUrl,
}: SlotCardProps) {
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(slot.name ?? `${slot.slotNum}번 TV`);
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 relative">
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center text-xl font-extrabold text-gray-900 flex-shrink-0">
          {slot.slotNum}
        </div>

        <div className="flex-1 min-w-0">
          {editingName ? (
            <div className="flex gap-2">
              <input
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                className="form-input text-sm flex-1"
                autoFocus
              />
              <button
                onClick={() => {
                  onChangeName(nameValue.trim() || `${slot.slotNum}번 TV`);
                  setEditingName(false);
                }}
                className="text-xs bg-black text-white px-3 rounded-md font-bold"
              >
                저장
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="text-sm font-bold text-gray-900">{slot.name ?? `${slot.slotNum}번 TV`}</div>
              <button
                onClick={() => setEditingName(true)}
                className="text-[10px] text-gray-400 underline"
              >
                이름 변경
              </button>
            </div>
          )}
          <div className="text-[11px] text-gray-500 mt-1 truncate font-mono">{displayUrl}</div>

          <div className="mt-2">
            {matched ? (
              <div className="inline-flex items-center gap-2 bg-red-50 text-red-700 rounded-lg px-2.5 py-1 text-xs">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                <span className="font-bold">{matched.tournamentName}</span>
                <span className="font-mono">{fmtTime(matched.levelSecondsLeft)}</span>
              </div>
            ) : (
              <div className="inline-flex items-center gap-2 bg-gray-100 text-gray-500 rounded-lg px-2.5 py-1 text-xs font-bold">
                비어있음 · 대기 화면 송출
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-1.5 flex-shrink-0">
          <button
            onClick={onCast}
            className="text-xs font-bold bg-black text-white px-3 py-1.5 rounded-md"
          >
            ⛶ TV 열기
          </button>
          <button
            onClick={onToggleMenu}
            className="text-xs font-bold border border-gray-200 px-3 py-1.5 rounded-md hover:bg-gray-50"
          >
            ▼ 매핑
          </button>
          <button
            onClick={onRemove}
            className="text-xs font-bold border border-red-200 text-red-600 px-3 py-1.5 rounded-md hover:bg-red-50"
          >
            ✕
          </button>
        </div>
      </div>

      {menuOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={onCloseMenu} />
          <div className="absolute right-4 top-16 bg-white border border-gray-200 rounded-lg shadow-lg p-2 z-20 w-56">
            {sessions.length === 0 ? (
              <div className="px-3 py-2 text-xs text-gray-500">진행 중 세션 없음</div>
            ) : (
              sessions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => {
                    onAssign(s.id);
                    onCloseMenu();
                  }}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 rounded font-bold text-gray-900"
                >
                  {s.id === slot.sessionId ? '✓ ' : ''}{s.tournamentName}
                  <span className="text-[10px] text-gray-500 ml-1">· Lv {s.currentLevel}</span>
                </button>
              ))
            )}
            {slot.sessionId && (
              <button
                onClick={() => {
                  onAssign(null);
                  onCloseMenu();
                }}
                className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 rounded text-gray-500 border-t border-gray-100 mt-2 pt-2"
              >
                슬롯 비우기
              </button>
            )}
          </div>
        </>
      )}

      <style jsx global>{`
        .form-input {
          background: #fff;
          border: 1.5px solid #eaeaea;
          border-radius: 8px;
          padding: 7px 11px;
          font-size: 13px;
          color: #111;
          width: 100%;
          box-sizing: border-box;
          outline: none;
        }
        .form-input:focus { border-color: #111; }
      `}</style>
    </div>
  );
}
