'use client';

import { useEffect, useRef, useState } from 'react';
import {
  type PinnedPost,
  subscribeAllPinnedPosts,
  createPinnedPost,
  updatePinnedPost,
  deletePinnedPost,
  uploadPinnedImage,
  deletePostImageByUrl,
} from '@/lib/posts';

/**
 * 본사 pinned 글 — 모바일 홈 "오늘의 매장 소식" 섹션 최상단 고정.
 * 팝업 공지(notices)와는 다른 영역. 팝업은 진입 시 모달, pinned는 인라인 카드.
 */
export default function PlatformPinnedPage() {
  const [posts, setPosts] = useState<PinnedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PinnedPost | 'new' | null>(null);

  useEffect(() => {
    const unsub = subscribeAllPinnedPosts(
      (items) => { setPosts(items); setLoading(false); },
      (e) => { setError(e.message); setLoading(false); },
    );
    return unsub;
  }, []);

  const activeCount = posts.filter((p) => p.active).length;

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">📌 홈 고정 공지</h1>
          <p className="text-sm text-gray-500 mt-1">
            모바일 홈 &quot;오늘의 매장 소식&quot; 섹션 최상단에 고정 노출. 활성 {activeCount}건이 사용자에게 보임.
            <br />팝업으로 띄울 공지는 좌측 메뉴 <b>📢 팝업 공지</b>에서 관리.
          </p>
        </div>
        <button
          onClick={() => setEditing('new')}
          className="bg-black text-white px-4 py-2.5 rounded-xl font-bold text-sm"
        >
          + 새 고정 공지
        </button>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">{error}</div>
      )}

      {loading ? (
        <div className="text-sm text-gray-500">로딩 중…</div>
      ) : posts.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-gray-200 rounded-xl p-12 text-center">
          <div className="text-4xl mb-3">📌</div>
          <div className="font-bold text-gray-900 mb-2">등록된 고정 공지가 없습니다</div>
          <div className="text-xs text-gray-500">
            오른쪽 위 &quot;+ 새 고정 공지&quot;로 홈 최상단 카드를 등록하세요.
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {posts.map((p) => <PinnedRow key={p.id} post={p} onEdit={() => setEditing(p)} />)}
        </div>
      )}

      {editing && (
        <PinnedEditModal post={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function PinnedRow({ post, onEdit }: { post: PinnedPost; onEdit: () => void }) {
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    setBusy(true);
    try { await updatePinnedPost(post.id, { active: !post.active }); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!window.confirm(`"${post.title}" 고정 공지를 삭제할까요? 첨부 이미지도 같이 삭제됩니다.`)) return;
    setBusy(true);
    try { await deletePinnedPost(post.id); } finally { setBusy(false); }
  };

  return (
    <div className={`bg-white border rounded-xl p-4 flex items-center gap-3 ${post.active ? 'border-emerald-200' : 'border-gray-200 opacity-60'}`}>
      {post.imageUrls.length > 0 ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={post.imageUrls[0]} alt="" className="w-16 h-16 rounded-lg object-cover flex-shrink-0" />
      ) : (
        <div className="w-16 h-16 rounded-lg bg-gray-100 flex items-center justify-center text-xl flex-shrink-0">📌</div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <div className="font-bold text-gray-900 truncate">{post.title}</div>
          <span className={`text-[10px] font-extrabold tracking-wider px-2 py-0.5 rounded ${post.active ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-500'}`}>
            {post.active ? 'ACTIVE' : 'HIDDEN'}
          </span>
          {post.priority > 0 && (
            <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">우선 {post.priority}</span>
          )}
        </div>
        {post.body && <div className="text-xs text-gray-500 line-clamp-2">{post.body}</div>}
        <div className="text-[11px] text-gray-400 mt-1">
          이미지 {post.imageUrls.length}장 {post.ctaUrl ? ' · 🔗 링크' : ''}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <button onClick={toggle} disabled={busy} className="text-[11px] font-bold px-3 py-1.5 rounded-md border border-gray-200 disabled:opacity-40">{post.active ? '숨김' : '활성'}</button>
        <button onClick={onEdit} className="text-[11px] font-bold px-3 py-1.5 rounded-md border border-gray-200">수정</button>
        <button onClick={remove} disabled={busy} className="text-[11px] font-bold px-3 py-1.5 rounded-md border border-red-200 text-red-600 disabled:opacity-40">삭제</button>
      </div>
    </div>
  );
}

function PinnedEditModal({ post, onClose }: { post: PinnedPost | null; onClose: () => void }) {
  const isNew = post === null;
  const [title, setTitle] = useState(post?.title ?? '');
  const [body, setBody] = useState(post?.body ?? '');
  const [active, setActive] = useState(post?.active ?? true);
  const [priority, setPriority] = useState(post?.priority ?? 0);
  const [ctaUrl, setCtaUrl] = useState(post?.ctaUrl ?? '');
  const [ctaLabel, setCtaLabel] = useState(post?.ctaLabel ?? '');
  const [imageUrls, setImageUrls] = useState<string[]>(post?.imageUrls ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const tempIdRef = useRef<string>(post?.id ?? `temp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);

  const onFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setError(null); setBusy(true);
    try {
      const uploaded: string[] = [];
      for (const f of files) {
        const url = await uploadPinnedImage(tempIdRef.current, f);
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

  const removeImage = (url: string) => {
    setImageUrls((prev) => prev.filter((u) => u !== url));
    deletePostImageByUrl(url).catch(() => {});
  };

  const save = async () => {
    if (!title.trim()) { setError('제목을 입력해주세요'); return; }
    setError(null); setBusy(true);
    try {
      if (isNew) {
        await createPinnedPost({ title: title.trim(), body: body.trim(), imageUrls, ctaUrl: ctaUrl.trim(), ctaLabel: ctaLabel.trim(), active, priority });
      } else {
        await updatePinnedPost(post!.id, { title: title.trim(), body: body.trim(), imageUrls, ctaUrl: ctaUrl.trim(), ctaLabel: ctaLabel.trim(), active, priority });
      }
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  return (
    <div onClick={onClose} className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100">
          <div className="font-extrabold text-gray-900">{isNew ? '새 고정 공지' : '고정 공지 수정'}</div>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1.5">제목 *</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm" placeholder="예: HoldemNow 베타 오픈" />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1.5">본문</label>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm resize-none" placeholder="간단한 요약 (선택)" />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1.5">이미지 ({imageUrls.length}장)</label>
            <div className="grid grid-cols-3 gap-2 mb-2">
              {imageUrls.map((url) => (
                <div key={url} className="relative aspect-video rounded-lg overflow-hidden border border-gray-200">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" className="w-full h-full object-cover" />
                  <button onClick={() => removeImage(url)} className="absolute top-1 right-1 w-6 h-6 bg-black/70 text-white rounded-full text-xs font-bold">×</button>
                </div>
              ))}
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={onFileSelect} disabled={busy} className="block w-full text-xs text-gray-500 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border file:border-gray-200 file:bg-white file:text-xs file:font-bold file:cursor-pointer disabled:opacity-40" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">링크 URL (선택)</label>
              <input value={ctaUrl} onChange={(e) => setCtaUrl(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded text-sm" placeholder="https://..." />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">버튼 라벨</label>
              <input value={ctaLabel} onChange={(e) => setCtaLabel(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded text-sm" placeholder="자세히 보기" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="w-4 h-4" />
              <span className="text-sm font-bold text-gray-700">활성</span>
            </label>
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">우선순위</label>
              <input type="number" value={priority} onChange={(e) => setPriority(Number(e.target.value) || 0)} className="w-full px-3 py-1.5 border border-gray-200 rounded text-sm" />
            </div>
          </div>
          {error && <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 text-xs text-red-700">{error}</div>}
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex gap-2">
          <button onClick={onClose} disabled={busy} className="flex-1 py-2.5 rounded-lg border border-gray-200 font-bold text-sm disabled:opacity-40">취소</button>
          <button onClick={save} disabled={busy} className="flex-1 py-2.5 rounded-lg bg-black text-white font-bold text-sm disabled:opacity-40">{busy ? '저장 중…' : '저장'}</button>
        </div>
      </div>
    </div>
  );
}
