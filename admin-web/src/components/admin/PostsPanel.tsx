'use client';

import { useEffect, useRef, useState } from 'react';
import {
  type StorePost,
  subscribeStorePostsAll,
  createStorePost,
  updateStorePost,
  deleteStorePost,
  uploadPostImage,
  deletePostImageByUrl,
  MAX_POST_IMAGES,
} from '@/lib/posts';
import { useAuth, useStoreDoc } from '@/lib/hooks';

interface Props {
  storeId: string;
  storeName: string;
}

/**
 * 매장 어드민 — "오늘의 소식" 패널.
 * 1일 1글 권장(데일리), 24h 자동 만료. 자유 텍스트 + 이미지 4장 + 자유 태그.
 */
export default function PostsPanel({ storeId, storeName }: Props) {
  const authState = useAuth();
  const store = useStoreDoc(storeId);
  const [posts, setPosts] = useState<StorePost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<StorePost | 'new' | null>(null);

  useEffect(() => {
    const unsub = subscribeStorePostsAll(
      storeId,
      (items) => { setPosts(items); setLoading(false); },
      (e) => { setError(e.message); setLoading(false); },
    );
    return unsub;
  }, [storeId]);

  if (authState.status !== 'authenticated') {
    return <div className="text-sm text-gray-500">로그인 필요</div>;
  }

  const now = Date.now();
  const activeCount = posts.filter((p) => p.status === 'published' && (p.expiresAt?.toMillis() ?? 0) > now).length;

  // 매장 상태 진단 — Firestore rules가 글 작성을 허용하는 조건과 동일하게 계산
  const storeStatus = store?.status ?? 'active'; // status 필드 없는 레거시는 'active'로 간주
  const storeOwnerUid = store?.ownerUid;
  // StoreDoc 타입엔 isDemo 없지만 Firestore 문서엔 존재할 수 있음 — 런타임에서 접근
  const isDemo = (store as unknown as { isDemo?: boolean } | null | undefined)?.isDemo === true;
  const myUid = authState.user.uid;
  const isOwner = storeOwnerUid != null && storeOwnerUid === myUid;
  // rules 통과 조건: (active || isDemo) && (isStoreOwner || isStoreMember)
  // 본 페이지는 이미 owner/platform_admin 검증을 통과한 상태에서 진입함
  const canWrite = isDemo || storeStatus === 'active';

  // 상태별 안내 메시지
  const statusBanner = (() => {
    if (!store) return null;
    if (canWrite) return null;
    if (storeStatus === 'pending') {
      return {
        tone: 'amber' as const,
        icon: '🕐',
        title: '매장 승인 대기 중',
        msg: '본사 승인 완료 후 글 작성이 가능합니다. 지금은 화면을 미리 둘러볼 수 있어요.',
      };
    }
    if (storeStatus === 'paused') {
      return {
        tone: 'red' as const,
        icon: '⛔',
        title: '매장이 일시 정지되었습니다',
        msg: '본사에 문의해 정지 사유 확인 후 활성화 요청을 진행해주세요.',
      };
    }
    if (storeStatus === 'closed') {
      return {
        tone: 'red' as const,
        icon: '🚫',
        title: '폐업/종료된 매장입니다',
        msg: '글 작성이 차단되어 있습니다.',
      };
    }
    return {
      tone: 'red' as const,
      icon: '⚠️',
      title: `알 수 없는 매장 상태 (${storeStatus})`,
      msg: '본사에 문의해주세요.',
    };
  })();

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">📢 오늘의 소식</h1>
          <p className="text-sm text-gray-500 mt-1">
            매일 새 글을 올려 단골에게 오늘 운영 정보를 전달하세요. 24시간 자동 만료.
            현재 활성 {activeCount}건.
          </p>
        </div>
        <button
          onClick={() => setEditing('new')}
          disabled={!canWrite}
          title={!canWrite ? '매장 활성 상태에서만 글을 작성할 수 있습니다' : undefined}
          className="bg-black text-white px-4 py-2.5 rounded-xl font-bold text-sm hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          + 새 소식
        </button>
      </div>

      {statusBanner && (
        <div
          className={`mb-4 rounded-xl p-4 flex items-start gap-3 ${
            statusBanner.tone === 'amber'
              ? 'bg-amber-50 border border-amber-200'
              : 'bg-red-50 border border-red-200'
          }`}
        >
          <div className="text-xl flex-shrink-0">{statusBanner.icon}</div>
          <div>
            <div className={`font-bold text-sm ${statusBanner.tone === 'amber' ? 'text-amber-800' : 'text-red-700'}`}>
              {statusBanner.title}
            </div>
            <div className={`text-xs mt-1 leading-relaxed ${statusBanner.tone === 'amber' ? 'text-amber-700' : 'text-red-600'}`}>
              {statusBanner.msg}
            </div>
          </div>
        </div>
      )}

      {/* 진단 정보 — 사장님이 즉시 원인 파악 가능 */}
      <details className="mb-4 text-[11px] text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
        <summary className="cursor-pointer select-none font-bold text-gray-700">🔍 매장 상태 진단</summary>
        <div className="mt-2 font-mono space-y-0.5">
          <div>매장 ID: {storeId}</div>
          <div>매장 status: {store === undefined ? 'loading…' : (store?.status ?? '(필드 없음 → active로 간주)')}</div>
          <div>isDemo: {String(isDemo)}</div>
          <div>매장 ownerUid: {storeOwnerUid ?? '(없음 — 본사 승인 필요)'}</div>
          <div>내 uid: {myUid}</div>
          <div>owner 일치: {isOwner ? '✓' : '✗'}</div>
          <div>글 작성 가능: {canWrite ? '✓' : '✗ — 본사 승인 또는 isDemo=true 필요'}</div>
        </div>
      </details>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">{error}</div>
      )}

      {loading ? (
        <div className="text-sm text-gray-500">로딩 중…</div>
      ) : posts.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-gray-200 rounded-xl p-10 text-center">
          <div className="text-3xl mb-2">📢</div>
          <div className="font-bold text-gray-900 mb-1">아직 소식이 없습니다</div>
          <div className="text-xs text-gray-500">
            카톡방에 올리던 홍보글을 그대로 붙여넣어 시작해보세요.
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {posts.map((p) => (
            <PostRow
              key={p.id}
              post={p}
              storeId={storeId}
              now={now}
              onEdit={() => setEditing(p)}
            />
          ))}
        </div>
      )}

      {editing && (
        <PostEditModal
          post={editing === 'new' ? null : editing}
          storeId={storeId}
          storeName={storeName}
          authorUid={authState.user.uid}
          onClose={() => setEditing(null)}
        />
      )}

      <div className="mt-8 bg-gray-50 border border-gray-200 rounded-xl p-5 text-xs text-gray-600 leading-relaxed">
        <div className="font-bold text-gray-900 mb-2">💡 작성 팁</div>
        <ul className="list-disc list-inside space-y-1.5">
          <li>카톡방 글을 그대로 붙여넣어도 됩니다 (이모지 포함)</li>
          <li>오늘 게임 종류, 이벤트, OPEN 시간을 명확히 적어주세요</li>
          <li>이벤트 태그(빙고/하이핸드/바운티 등)는 필터링/검색에 활용됩니다</li>
          <li>이미지 최대 4장, 5MB/장</li>
          <li>작성 후 24시간 뒤 자동으로 사용자 화면에서 사라집니다 — 매일 새로 올려주세요</li>
        </ul>
      </div>
    </div>
  );
}

function PostRow({
  post,
  storeId,
  now,
  onEdit,
}: {
  post: StorePost;
  storeId: string;
  now: number;
  onEdit: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const expMs = post.expiresAt?.toMillis() ?? 0;
  const isExpired = expMs > 0 && expMs <= now;
  const isHidden = post.status === 'hidden';
  const isActive = !isExpired && !isHidden;
  const hoursLeft = isActive && expMs > now ? Math.max(0, Math.floor((expMs - now) / (60 * 60 * 1000))) : 0;

  const remove = async () => {
    if (!window.confirm('이 소식을 삭제할까요? 첨부 이미지도 같이 삭제됩니다.')) return;
    setBusy(true);
    try { await deleteStorePost(storeId, post.id); } finally { setBusy(false); }
  };

  const toggleHidden = async () => {
    setBusy(true);
    try {
      await updateStorePost(storeId, post.id, { status: isHidden ? 'published' : 'hidden' });
    } finally { setBusy(false); }
  };

  return (
    <div className={`bg-white border rounded-xl p-4 flex gap-3 ${isActive ? 'border-emerald-200' : 'border-gray-200 opacity-60'}`}>
      {post.imageUrls.length > 0 ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={post.imageUrls[0]} alt="" className="w-16 h-16 rounded-lg object-cover flex-shrink-0" />
      ) : (
        <div className="w-16 h-16 rounded-lg bg-gray-100 flex items-center justify-center text-xl flex-shrink-0">📝</div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className={`text-[10px] font-extrabold tracking-wider px-2 py-0.5 rounded ${isActive ? 'bg-emerald-100 text-emerald-800' : isExpired ? 'bg-gray-200 text-gray-600' : 'bg-amber-100 text-amber-800'}`}>
            {isActive ? `노출 중 · ${hoursLeft}h 남음` : isExpired ? '만료' : '숨김'}
          </span>
          {post.eventTags.slice(0, 4).map((t) => (
            <span key={t} className="text-[10px] font-bold bg-pink-50 text-pink-700 px-1.5 py-0.5 rounded">#{t}</span>
          ))}
        </div>
        <div className="text-sm text-gray-900 line-clamp-3 whitespace-pre-wrap leading-relaxed">{post.body}</div>
        <div className="text-[11px] text-gray-400 mt-1">
          이미지 {post.imageUrls.length}장
          {post.ctaUrl ? ' · 🔗 링크' : ''}
        </div>
      </div>
      <div className="flex flex-col gap-1.5 flex-shrink-0">
        {isActive && (
          <button onClick={toggleHidden} disabled={busy} className="text-[11px] font-bold px-3 py-1.5 rounded-md border border-gray-200 disabled:opacity-40">숨김</button>
        )}
        {!isActive && !isExpired && (
          <button onClick={toggleHidden} disabled={busy} className="text-[11px] font-bold px-3 py-1.5 rounded-md border border-gray-200 disabled:opacity-40">노출</button>
        )}
        <button onClick={onEdit} className="text-[11px] font-bold px-3 py-1.5 rounded-md border border-gray-200">수정</button>
        <button onClick={remove} disabled={busy} className="text-[11px] font-bold px-3 py-1.5 rounded-md border border-red-200 text-red-600 disabled:opacity-40">삭제</button>
      </div>
    </div>
  );
}

function PostEditModal({
  post,
  storeId,
  storeName,
  authorUid,
  onClose,
}: {
  post: StorePost | null;
  storeId: string;
  storeName: string;
  authorUid: string;
  onClose: () => void;
}) {
  const isNew = post === null;
  const [body, setBody] = useState(post?.body ?? '');
  const [imageUrls, setImageUrls] = useState<string[]>(post?.imageUrls ?? []);
  const [tagsInput, setTagsInput] = useState((post?.eventTags ?? []).join(', '));
  const [ctaUrl, setCtaUrl] = useState(post?.ctaUrl ?? '');
  const [ctaLabel, setCtaLabel] = useState(post?.ctaLabel ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const tempIdRef = useRef<string>(post?.id ?? `temp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);

  const onFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    if (imageUrls.length + files.length > MAX_POST_IMAGES) {
      setError(`이미지는 최대 ${MAX_POST_IMAGES}장까지 업로드 가능합니다`);
      return;
    }
    setError(null); setBusy(true);
    try {
      const uploaded: string[] = [];
      for (const f of files) {
        const url = await uploadPostImage(storeId, tempIdRef.current, f);
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
    if (!body.trim()) { setError('내용을 입력해주세요'); return; }
    setError(null); setBusy(true);
    const eventTags = tagsInput.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean).slice(0, 8);
    try {
      if (isNew) {
        await createStorePost({
          storeId, storeName, body: body.trim(), imageUrls, eventTags,
          ctaUrl: ctaUrl.trim(), ctaLabel: ctaLabel.trim(), authorUid,
        });
      } else {
        await updateStorePost(storeId, post!.id, {
          body: body.trim(), imageUrls, eventTags, ctaUrl: ctaUrl.trim(), ctaLabel: ctaLabel.trim(),
        });
      }
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  return (
    <div onClick={onClose} className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl w-full max-w-lg max-h-[92vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100">
          <div className="font-extrabold text-gray-900">{isNew ? '새 소식' : '소식 수정'}</div>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1.5">내용 *</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm resize-none font-mono"
              placeholder={`예시:\n🩵 매장 이름 🩵\n🔹 오늘의 토너 / 이벤트\n⏰ 19:30 OPEN\n📞 010-xxxx-xxxx\n오픈채팅 https://...`}
            />
            <div className="text-[11px] text-gray-400 mt-1">카톡방 글 그대로 붙여넣기 OK · 이모지 권장</div>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1.5">이벤트 태그 (쉼표/공백으로 구분, 최대 8개)</label>
            <input
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm"
              placeholder="예: 빙고, 하이핸드, 바운티, 후원대회"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1.5">이미지 ({imageUrls.length}/{MAX_POST_IMAGES}장)</label>
            <div className="grid grid-cols-4 gap-2 mb-2">
              {imageUrls.map((url) => (
                <div key={url} className="relative aspect-square rounded-lg overflow-hidden border border-gray-200">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" className="w-full h-full object-cover" />
                  <button
                    onClick={() => removeImage(url)}
                    className="absolute top-1 right-1 w-6 h-6 bg-black/70 text-white rounded-full text-xs font-bold"
                  >×</button>
                </div>
              ))}
            </div>
            {imageUrls.length < MAX_POST_IMAGES && (
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={onFileSelect}
                disabled={busy}
                className="block w-full text-xs text-gray-500 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border file:border-gray-200 file:bg-white file:text-xs file:font-bold file:cursor-pointer disabled:opacity-40"
              />
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">링크 URL (선택)</label>
              <input
                value={ctaUrl}
                onChange={(e) => setCtaUrl(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded text-sm"
                placeholder="https://open.kakao.com/..."
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">링크 버튼 라벨</label>
              <input
                value={ctaLabel}
                onChange={(e) => setCtaLabel(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded text-sm"
                placeholder="오픈채팅 참여"
              />
            </div>
          </div>
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 text-xs text-red-700">{error}</div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex gap-2">
          <button onClick={onClose} disabled={busy} className="flex-1 py-2.5 rounded-lg border border-gray-200 font-bold text-sm disabled:opacity-40">취소</button>
          <button onClick={save} disabled={busy} className="flex-1 py-2.5 rounded-lg bg-black text-white font-bold text-sm disabled:opacity-40">{busy ? '저장 중…' : '저장'}</button>
        </div>
      </div>
    </div>
  );
}
