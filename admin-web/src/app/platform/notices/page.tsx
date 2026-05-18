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
          <div className="font-bold text-gray-900 truncate">{notice.title}</div>
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
    if (!title.trim()) {
      setError('제목을 입력해주세요');
      return;
    }
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
          title: title.trim(),
          body: body.trim(),
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
          title: title.trim(),
          body: body.trim(),
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
        <div className="px-6 py-4 border-b border-gray-100">
          <div className="font-extrabold text-gray-900">{isNew ? '새 공지' : '공지 수정'}</div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1.5">제목 *</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm"
              placeholder="예: HoldemNow 베타 OPEN"
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

          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1.5">
              이미지 ({imageUrls.length}장)
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

        <div className="px-6 py-4 border-t border-gray-100 flex gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="flex-1 py-2.5 rounded-lg border border-gray-200 font-bold text-sm disabled:opacity-40"
          >
            취소
          </button>
          <button
            onClick={save}
            disabled={busy}
            className="flex-1 py-2.5 rounded-lg bg-black text-white font-bold text-sm disabled:opacity-40"
          >
            {busy ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
