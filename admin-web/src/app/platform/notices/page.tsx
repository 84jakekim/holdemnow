'use client';

import { useEffect, useRef, useState } from 'react';
import {
  type Notice,
  type NoticeSize,
  subscribeAllNotices,
  createNotice,
  updateNotice,
  deleteNotice,
  uploadNoticeImage,
  deleteNoticeImageByUrl,
} from '@/lib/notices';
import { Timestamp } from 'firebase/firestore';

/** Timestamp → datetime-local input value (YYYY-MM-DDTHH:mm). */
function toLocalInput(t?: Timestamp | null): string {
  if (!t || typeof t.toDate !== 'function') return '';
  const d = t.toDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function PlatformNoticesPage() {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Notice | 'new' | null>(null);

  useEffect(() => {
    const unsub = subscribeAllNotices(
      (items) => {
        setNotices(items);
        setLoading(false);
      },
      (e) => {
        setError(e.message);
        setLoading(false);
      },
    );
    return unsub;
  }, []);

  const activeCount = notices.filter((n) => n.active).length;

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">📢 팝업 공지</h1>
          <p className="text-sm text-gray-500 mt-1">
            모바일 앱 진입 시 팝업으로 노출. 활성 {activeCount}건이 현재 사용자에게 보임.
          </p>
        </div>
        <button
          onClick={() => setEditing('new')}
          className="bg-black text-white px-4 py-2.5 rounded-xl font-bold text-sm"
        >
          + 새 공지
        </button>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-gray-500">로딩 중…</div>
      ) : notices.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-gray-200 rounded-xl p-12 text-center">
          <div className="text-4xl mb-3">📢</div>
          <div className="font-bold text-gray-900 mb-2">등록된 공지가 없습니다</div>
          <div className="text-xs text-gray-500">
            오른쪽 위 &quot;+ 새 공지&quot;로 첫 팝업 공지를 만들어 보세요.
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {notices.map((n) => (
            <NoticeRow key={n.id} notice={n} onEdit={() => setEditing(n)} />
          ))}
        </div>
      )}

      {editing && (
        <NoticeEditModal
          notice={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}

      <div className="mt-8 bg-gray-50 border border-gray-200 rounded-xl p-5 text-xs text-gray-600 leading-relaxed">
        <div className="font-bold text-gray-900 mb-2">💡 노출 규칙</div>
        <ul className="list-disc list-inside space-y-1.5">
          <li>모바일 사용자가 앱 진입 시 활성 공지가 자동으로 팝업으로 표시됨</li>
          <li>여러 개 활성 공지는 가로 슬라이드로 넘김 (priority 높은 순)</li>
          <li>한 공지 안에 이미지 여러 장이면 공지 내부에서 다시 가로 슬라이드</li>
          <li>사용자가 &quot;오늘 그만 보기&quot; 선택 시 24시간 동안 동일 공지 안 노출</li>
        </ul>
      </div>
    </div>
  );
}

/** Timestamp를 "MM/DD HH:mm" 한 줄로. */
function fmtTs(t?: Timestamp | null): string {
  if (!t || typeof t.toDate !== 'function') return '';
  const d = t.toDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function NoticeRow({ notice, onEdit }: { notice: Notice; onEdit: () => void }) {
  const [busy, setBusy] = useState(false);
  const now = Date.now();
  const isFuture = notice.startAt && notice.startAt.toMillis() > now;
  const isExpired = notice.endAt && notice.endAt.toMillis() < now;

  const toggle = async () => {
    setBusy(true);
    try {
      await updateNotice(notice.id, { active: !notice.active });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`"${notice.title}" 공지를 삭제할까요? 첨부 이미지도 같이 삭제됩니다.`)) return;
    setBusy(true);
    try {
      await deleteNotice(notice.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`bg-white border rounded-xl p-4 flex items-center gap-3 ${
        notice.active ? 'border-emerald-200' : 'border-gray-200 opacity-60'
      }`}
    >
      {notice.imageUrls.length > 0 ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={notice.imageUrls[0]}
          alt={notice.title}
          className="w-16 h-16 rounded-lg object-cover flex-shrink-0"
        />
      ) : (
        <div className="w-16 h-16 rounded-lg bg-gray-100 flex items-center justify-center text-xl flex-shrink-0">
          📢
        </div>
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <div className="font-bold text-gray-900 truncate">
            {notice.title || <span className="italic text-gray-400">(제목 없음 — 이미지만)</span>}
          </div>
          <span
            className={`text-[10px] font-extrabold tracking-wider px-2 py-0.5 rounded ${
              notice.active ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-500'
            }`}
          >
            {notice.active ? 'ACTIVE' : 'HIDDEN'}
          </span>
          {notice.priority > 0 && (
            <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
              우선 {notice.priority}
            </span>
          )}
          {isFuture && (
            <span className="text-[10px] font-bold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">
              ⏳ 예약됨
            </span>
          )}
          {isExpired && (
            <span className="text-[10px] font-bold text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded">
              기간 만료
            </span>
          )}
        </div>
        {notice.body && (
          <div className="text-xs text-gray-500 line-clamp-2">{notice.body}</div>
        )}
        <div className="text-[11px] text-gray-400 mt-1">
          이미지 {notice.imageUrls.length}장
          {notice.linkUrl ? ' · 🔗 외부링크' : ''}
          {notice.size && notice.size !== 'md' ? ` · 사이즈 ${notice.size}` : ''}
          {(notice.startAt || notice.endAt) && (
            <span>
              {' · 🗓 '}
              {notice.startAt ? fmtTs(notice.startAt) : '즉시'} ~ {notice.endAt ? fmtTs(notice.endAt) : '무기한'}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <button
          onClick={toggle}
          disabled={busy}
          className="text-[11px] font-bold px-3 py-1.5 rounded-md border border-gray-200 disabled:opacity-40"
        >
          {notice.active ? '숨김' : '활성'}
        </button>
        <button
          onClick={onEdit}
          className="text-[11px] font-bold px-3 py-1.5 rounded-md border border-gray-200"
        >
          수정
        </button>
        <button
          onClick={remove}
          disabled={busy}
          className="text-[11px] font-bold px-3 py-1.5 rounded-md border border-red-200 text-red-600 disabled:opacity-40"
        >
          삭제
        </button>
      </div>
    </div>
  );
}

function NoticeEditModal({
  notice,
  onClose,
}: {
  notice: Notice | null;
  onClose: () => void;
}) {
  const isNew = notice === null;
  // 'choose': 새 공지 진입 직후 모드 선택. 'poster': 이미지만, 'full': 제목+본문 포함.
  // 기존 공지 수정 시: 제목·본문 비어있고 이미지 있으면 자동 poster, 그 외 full.
  const initialMode: 'choose' | 'poster' | 'full' = isNew
    ? 'choose'
    : (!notice?.title && !notice?.body && (notice?.imageUrls?.length ?? 0) > 0)
      ? 'poster'
      : 'full';
  const [mode, setMode] = useState<'choose' | 'poster' | 'full'>(initialMode);
  const [title, setTitle] = useState(notice?.title ?? '');
  const [body, setBody] = useState(notice?.body ?? '');
  const [active, setActive] = useState(notice?.active ?? true);
  const [priority, setPriority] = useState(notice?.priority ?? 0);
  const [linkUrl, setLinkUrl] = useState(notice?.linkUrl ?? '');
  const [imageUrls, setImageUrls] = useState<string[]>(notice?.imageUrls ?? []);
  const [startAt, setStartAt] = useState<string>(toLocalInput(notice?.startAt));
  const [endAt, setEndAt] = useState<string>(toLocalInput(notice?.endAt));
  const [size, setSize] = useState<NoticeSize>(notice?.size ?? 'md');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 새 공지인 경우 업로드 전 임시 ID 발급 (Storage 경로용)
  const tempIdRef = useRef<string>(
    notice?.id ?? `temp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
  );

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setError(null);
    setBusy(true);
    try {
      const uploaded: string[] = [];
      for (const f of files) {
        const url = await uploadNoticeImage(tempIdRef.current, f);
        uploaded.push(url);
      }
      setImageUrls((prev) => [...prev, ...uploaded]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeImage = async (url: string) => {
    setImageUrls((prev) => prev.filter((u) => u !== url));
    deleteNoticeImageByUrl(url).catch(() => {});
  };

  const moveImage = (idx: number, dir: -1 | 1) => {
    setImageUrls((prev) => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };

  const save = async () => {
    // 모드별 검증.
    if (mode === 'poster') {
      if (imageUrls.length === 0) {
        setError('포스터 모드는 이미지를 1장 이상 업로드해야 합니다');
        return;
      }
    } else if (mode === 'full') {
      if (!title.trim() && !body.trim() && imageUrls.length === 0) {
        setError('제목·본문·이미지 중 최소 하나는 입력해야 합니다');
        return;
      }
    } else {
      // 'choose' — 모드 선택 단계에선 저장 불가
      return;
    }
    // 포스터 모드 저장 시 title/body는 빈 문자열로 강제 (사용자가 모드 전환했어도 안전).
    const finalTitle = mode === 'poster' ? '' : title.trim();
    const finalBody = mode === 'poster' ? '' : body.trim();
    const startDate = startAt ? new Date(startAt) : null;
    const endDate = endAt ? new Date(endAt) : null;
    if (startDate && endDate && endDate.getTime() <= startDate.getTime()) {
      setError('종료일은 시작일보다 이후여야 합니다');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      if (isNew) {
        await createNotice({
          title: finalTitle,
          body: finalBody,
          imageUrls,
          active,
          priority,
          linkUrl: linkUrl.trim(),
          startAt: startDate,
          endAt: endDate,
          size,
        });
      } else {
        await updateNotice(notice!.id, {
          title: finalTitle,
          body: finalBody,
          imageUrls,
          active,
          priority,
          linkUrl: linkUrl.trim(),
          startAt: startDate ? Timestamp.fromDate(startDate) : null,
          endAt: endDate ? Timestamp.fromDate(endDate) : null,
          size,
        });
      }
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
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col"
      >
        <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
          <div className="font-extrabold text-gray-900 flex-1">
            {isNew ? '새 공지' : '공지 수정'}
            {mode !== 'choose' && (
              <span className="ml-2 text-[10px] font-bold tracking-wider px-2 py-0.5 rounded bg-gray-100 text-gray-600 align-middle">
                {mode === 'poster' ? '포스터' : '내용 포함'}
              </span>
            )}
          </div>
          {/* 모드 변경 — 새 공지 작성 중에도 위쪽에서 다시 선택 가능 */}
          {mode !== 'choose' && isNew && (
            <button
              type="button"
              onClick={() => { setMode('choose'); setError(null); }}
              className="text-[11px] font-bold text-gray-500 underline"
            >
              모드 변경
            </button>
          )}
        </div>

        {/* ───── choose 단계 ───── */}
        {mode === 'choose' && (
          <div className="flex-1 overflow-y-auto px-6 py-6">
            <div className="text-sm font-bold text-gray-700 mb-3">어떤 형식으로 등록할까요?</div>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setMode('poster')}
                className="border-2 border-gray-200 hover:border-emerald-400 hover:bg-emerald-50 rounded-2xl p-5 text-left transition"
              >
                <div className="text-3xl mb-2">🖼️</div>
                <div className="font-extrabold text-gray-900 mb-1">포스터만</div>
                <div className="text-[11px] text-gray-500 leading-relaxed">
                  포스터 이미지 1장 이상만 업로드. 제목·본문 없이 이미지로 메시지 전달.
                </div>
              </button>
              <button
                type="button"
                onClick={() => setMode('full')}
                className="border-2 border-gray-200 hover:border-emerald-400 hover:bg-emerald-50 rounded-2xl p-5 text-left transition"
              >
                <div className="text-3xl mb-2">📝</div>
                <div className="font-extrabold text-gray-900 mb-1">내용 포함</div>
                <div className="text-[11px] text-gray-500 leading-relaxed">
                  제목·본문 + 이미지(선택). 상세 안내가 필요한 공지.
                </div>
              </button>
            </div>
          </div>
        )}

        {/* ───── poster / full 폼 ───── */}
        {mode !== 'choose' && (
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {mode === 'full' && (
            <>
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1.5">제목 (선택)</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm"
                  placeholder="예: Pink Rabbit 베타 OPEN"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1.5">본문</label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={4}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm resize-none"
                  placeholder="공지 내용 (선택). 이미지만으로 충분하면 비워두세요."
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1.5">
              {mode === 'poster' ? '포스터 이미지' : '이미지'} ({imageUrls.length}장)
              {mode === 'poster' && <span className="text-red-500 ml-1">*</span>}
            </label>
            <div className="grid grid-cols-3 gap-2 mb-2">
              {imageUrls.map((url, i) => (
                <div key={url} className="relative aspect-square rounded-lg overflow-hidden border border-gray-200">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" className="w-full h-full object-cover" />
                  <div className="absolute top-1 right-1 flex flex-col gap-1">
                    <button
                      onClick={() => removeImage(url)}
                      className="w-6 h-6 bg-black/70 text-white rounded-full text-xs font-bold"
                      title="삭제"
                    >
                      ×
                    </button>
                  </div>
                  <div className="absolute bottom-1 left-1 flex gap-1">
                    <button
                      onClick={() => moveImage(i, -1)}
                      disabled={i === 0}
                      className="w-6 h-6 bg-black/70 text-white rounded text-xs disabled:opacity-30"
                      title="앞으로"
                    >
                      ‹
                    </button>
                    <button
                      onClick={() => moveImage(i, 1)}
                      disabled={i === imageUrls.length - 1}
                      className="w-6 h-6 bg-black/70 text-white rounded text-xs disabled:opacity-30"
                      title="뒤로"
                    >
                      ›
                    </button>
                  </div>
                  <div className="absolute top-1 left-1 bg-black/70 text-white text-[10px] font-bold rounded px-1.5">
                    {i + 1}
                  </div>
                </div>
              ))}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleFileSelect}
              disabled={busy}
              className="block w-full text-xs text-gray-500 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border file:border-gray-200 file:bg-white file:text-xs file:font-bold file:cursor-pointer disabled:opacity-40"
            />
            <div className="text-[11px] text-gray-400 mt-1">최대 5MB, 여러 장 동시 업로드 가능</div>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1.5">외부 링크 (선택)</label>
            <input
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm"
              placeholder="https://..."
            />
            <div className="text-[11px] text-gray-400 mt-1">팝업 클릭 시 새 창으로 열림</div>
          </div>

          {/* 노출 기간 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1.5">노출 시작</label>
              <input
                type="datetime-local"
                value={startAt}
                onChange={(e) => setStartAt(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
              />
              <div className="text-[11px] text-gray-400 mt-1">비워두면 즉시 시작</div>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1.5">노출 종료</label>
              <input
                type="datetime-local"
                value={endAt}
                onChange={(e) => setEndAt(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
              />
              <div className="text-[11px] text-gray-400 mt-1">비워두면 무기한</div>
            </div>
          </div>

          {/* 팝업 사이즈 */}
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1.5">팝업 사이즈</label>
            <div className="flex gap-2">
              {(['sm', 'md', 'lg'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSize(s)}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold border ${
                    size === s
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                      : 'border-gray-200 text-gray-700'
                  }`}
                >
                  {s === 'sm' ? '작게 (320)' : s === 'md' ? '보통 (384)' : '크게 (448)'}
                </button>
              ))}
            </div>
            <div className="text-[11px] text-gray-400 mt-1">모바일 팝업의 최대 가로 너비 (px)</div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
                className="w-4 h-4"
              />
              <span className="text-sm font-bold text-gray-700">활성</span>
            </label>
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">우선순위</label>
              <input
                type="number"
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value) || 0)}
                className="w-full px-3 py-1.5 border border-gray-200 rounded text-sm"
              />
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 text-xs text-red-700">
              {error}
            </div>
          )}
        </div>
        )}

        {/* 푸터 — choose 단계에선 취소만, 그 외 취소+저장 */}
        <div className="px-6 py-4 border-t border-gray-100 flex gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="flex-1 py-2.5 rounded-lg border border-gray-200 font-bold text-sm disabled:opacity-40"
          >
            취소
          </button>
          {mode !== 'choose' && (
            <button
              onClick={save}
              disabled={busy}
              className="flex-1 py-2.5 rounded-lg bg-black text-white font-bold text-sm disabled:opacity-40"
            >
              {busy ? '저장 중…' : '저장'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
