'use client';

import { useEffect, useRef, useState } from 'react';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  type StorePost,
  type PostCardColor,
  subscribeStorePostsAll,
  createStorePost,
  updateStorePost,
  deleteStorePost,
  repostStorePost,
  uploadPostImage,
  deletePostImageByUrl,
  MAX_POST_IMAGES,
  HEADLINE_MAX_LENGTH,
  POST_CARD_COLORS,
  POST_CARD_EMOJI_GROUPS,
  POST_CARD_EMOJIS_MAX,
  PostGuardError,
  graphemeLength,
  truncateGraphemes,
} from '@/lib/posts';
import { CARD_STYLES, resolveCardVisual } from '@/lib/postCardStyle';
import { formatRelativeKo } from '@/lib/relativeTime';
import { useAuth, useStoreDoc } from '@/lib/hooks';
import { EmptyState } from '@/components/ui';
import { primeModerationKeywordsCache } from '@/lib/moderationKeywords';

interface Props {
  storeId: string;
  storeName: string;
  isPlatformAdmin?: boolean;
}

/**
 * 매장 어드민 — "오늘의 소식" 패널.
 * 1일 1글 권장(데일리), 24h 자동 만료. 자유 텍스트 + 이미지 4장 + 자유 태그.
 */
export default function PostsPanel({ storeId, storeName, isPlatformAdmin = false }: Props) {
  const authState = useAuth();
  const store = useStoreDoc(storeId);
  const [posts, setPosts] = useState<StorePost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<StorePost | 'new' | null>(null);
  const [activating, setActivating] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);

  const showToast = (msg: string, type: 'ok' | 'err' = 'ok') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  useEffect(() => {
    // 금지어 캐시 prime — 첫 글 작성도 즉시 새 사전 적용
    primeModerationKeywordsCache();
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
  // 새 정책(rules 동기화 2026-05-21): owner/member/platform_admin이면 매장 status 무관하게
  // 글 작성 가능. pending 매장은 어차피 사용자에게 노출 안 되므로 미리 작성해두고 활성화
  // 후 자동 노출되는 게 사장 친화적.
  const canWrite = isPlatformAdmin || isOwner || isDemo || storeStatus === 'active';

  const activateStore = async () => {
    if (!isPlatformAdmin) return;
    if (!window.confirm(`"${storeName}" 매장을 즉시 활성(active)으로 전환할까요?`)) return;
    setActivating(true);
    try {
      await updateDoc(doc(db, 'stores', storeId), {
        status: 'active',
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActivating(false);
    }
  };

  // 상태별 안내 메시지
  const statusBanner = (() => {
    if (!store) return null;
    // owner/platform_admin이 pending 매장에 글을 쓸 수 있도록 풀어주되, 일반 사용자에게는 아직 노출되지 않음을 명시.
    if ((isOwner || isPlatformAdmin) && storeStatus === 'pending') {
      return {
        tone: 'amber' as const,
        icon: isPlatformAdmin ? '👑' : '✍️',
        title: isPlatformAdmin
          ? '본사 권한 — 작성 가능 (사용자에겐 아직 노출 안 됨)'
          : '승인 대기 중 — 미리 작성 가능 (활성화 후 자동 노출)',
        msg: '이 매장은 status=pending이라 일반 사용자에게 매장·소식이 보이지 않습니다. 활성화되는 순간 즉시 노출됩니다.',
      };
    }
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
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <div className="section-title" style={{ color: 'var(--brand)' }}>STORE POSTS</div>
          <h1 className="h2" style={{ color: 'var(--text-1)' }}>📢 오늘의 소식</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-2)' }}>
            매일 새 글을 올려 단골에게 오늘 운영 정보를 전달하세요. 24시간 자동 만료.
            현재 활성 <b style={{ color: 'var(--brand)' }}>{activeCount}</b>건.
          </p>
        </div>
        <button
          onClick={() => setEditing('new')}
          disabled={!canWrite}
          title={!canWrite ? '매장 활성 상태에서만 글을 작성할 수 있습니다' : undefined}
          className="btn-brand px-4 py-2.5 text-sm tap disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ borderRadius: 'var(--r-md)' }}
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

      {/* 진단 정보 — 사장님이 즉시 원인 파악 가능. 작성 불가 상태에선 자동 펼침 */}
      <details
        className="mb-4 text-[11px] text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2"
        open={!canWrite}
      >
        <summary className="cursor-pointer select-none font-bold text-gray-700">🔍 매장 상태 진단</summary>
        <div className="mt-2 font-mono space-y-0.5">
          <div>매장 ID: {storeId}</div>
          <div>매장 status: {store === undefined ? 'loading…' : (store?.status ?? '(필드 없음 → active로 간주)')}</div>
          <div>isDemo: {String(isDemo)}</div>
          <div>매장 ownerUid: {storeOwnerUid ?? '(없음 — 본사 승인 필요)'}</div>
          <div>내 uid: {myUid}</div>
          <div>owner 일치: {isOwner ? '✓' : '✗'}</div>
          <div>platform_admin: {isPlatformAdmin ? '✓' : '✗'}</div>
          <div>글 작성 가능: {canWrite ? '✓' : '✗ — 본사 승인 또는 isDemo=true 필요'}</div>
        </div>
        {isPlatformAdmin && storeStatus === 'pending' && (
          <button
            onClick={activateStore}
            disabled={activating}
            className="mt-3 inline-flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-[11px] font-extrabold px-3 py-1.5 rounded-md"
          >
            {activating ? '활성화 중…' : '⚡ 이 매장 즉시 활성화 (status=active)'}
          </button>
        )}
      </details>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">{error}</div>
      )}

      {loading ? (
        <div className="text-sm text-gray-500">로딩 중…</div>
      ) : posts.length === 0 ? (
        <EmptyState
          icon="📢"
          title="아직 소식이 없습니다"
          desc="카톡방에 올리던 홍보글을 그대로 붙여넣어 시작해보세요."
        />
      ) : (
        <div className="space-y-2">
          {posts.map((p) => (
            <PostRow
              key={p.id}
              post={p}
              storeId={storeId}
              authorUid={authState.user.uid}
              now={now}
              onEdit={() => setEditing(p)}
              onRepostResult={(ok, msg) => showToast(msg, ok ? 'ok' : 'err')}
            />
          ))}
        </div>
      )}

      {/* 토스트 알림 */}
      {toast && (
        <div
          className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl text-sm font-bold shadow-lg transition-all ${
            toast.type === 'ok'
              ? 'bg-emerald-600 text-white'
              : 'bg-red-600 text-white'
          }`}
          role="alert"
          aria-live="polite"
        >
          {toast.msg}
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
        <div className="font-bold text-gray-900 mt-4 mb-2">⚠️ 자동 거부 규정</div>
        <ul className="list-disc list-inside space-y-1.5">
          <li>도박/환금/현금화/캐시게임/베팅/사다리/사설 등 키워드 자동 거부</li>
          <li>외부 링크는 <code>open.kakao.com</code> / <code>pf.kakao.com</code>만 허용 (tel: 가능)</li>
          <li>매장당 하루 1글만 가능 — 두 번째 작성은 기존 글 수정으로 대체</li>
          <li>같은 글자 30회 연속, 욕설/비속어/혐오 표현 등은 자동 거부</li>
          <li>사용자 신고가 누적되면 자동 숨김 처리됩니다</li>
        </ul>
      </div>
    </div>
  );
}

function LivePreviewCard({
  headline,
  cardColor,
  cardEmojis,
  storeName,
}: {
  headline: string;
  cardColor: PostCardColor;
  cardEmojis: string[];
  storeName: string;
}) {
  const { style, emojis } = resolveCardVisual({ cardColor, cardEmojis });
  const oneLiner = headline.trim() || '카드에 노출될 한 줄을 입력해주세요';
  return (
    <div
      className="rounded-2xl"
      style={{
        background: style.surface,
        border: `1px solid ${style.border}`,
        padding: '14px 14px 12px',
        maxWidth: 280,
      }}
    >
      <div className="flex items-start gap-2 mb-2.5">
        {emojis.length > 0 && (
          <div className="flex-shrink-0 flex items-center gap-1">
            {emojis.map((e, i) => (
              <div
                key={`${e}_${i}`}
                className="flex items-center justify-center rounded-lg"
                style={{
                  width: 28,
                  height: 28,
                  background: style.accent,
                  fontSize: 15,
                }}
              >
                <span>{e}</span>
              </div>
            ))}
          </div>
        )}
        <div
          className="text-[14px] font-extrabold leading-[1.4] flex-1"
          style={{
            color: style.textPrimary,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            minHeight: 40,
          }}
        >
          {oneLiner}
        </div>
      </div>
      <div
        className="pt-2 mt-1 flex items-center justify-between gap-1.5"
        style={{ borderTop: `1px solid ${style.border}` }}
      >
        <div className="text-[11px] font-semibold truncate" style={{ color: style.textSecondary }}>
          📍 {storeName}
        </div>
        <div className="text-[10px] font-medium" style={{ color: style.textSecondary, opacity: 0.85 }}>
          방금 전
        </div>
      </div>
    </div>
  );
}

function PostRow({
  post,
  storeId,
  authorUid,
  now,
  onEdit,
  onRepostResult,
}: {
  post: StorePost;
  storeId: string;
  authorUid: string;
  now: number;
  onEdit: () => void;
  onRepostResult: (ok: boolean, msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const expMs = post.expiresAt?.toMillis() ?? 0;
  const isExpired = expMs > 0 && expMs <= now;
  const isHidden = post.status === 'hidden';
  const isActive = !isExpired && !isHidden;
  const hoursLeft = isActive && expMs > now ? Math.max(0, Math.floor((expMs - now) / (60 * 60 * 1000))) : 0;
  const relative = formatRelativeKo(post.createdAt, now);
  const { style: rowStyle, emojis: rowEmojis } = resolveCardVisual(post);
  const rowEmojiHead = rowEmojis[0] ?? '';
  const displayHeadline = (post.headline ?? '').trim() || (post.body || '').split('\n')[0]?.trim() || '(제목 없음)';

  const remove = async () => {
    if (!window.confirm('이 소식을 삭제할까요? 첨부 이미지도 같이 삭제됩니다.')) return;
    setBusy(true);
    try { await deleteStorePost(storeId, post.id); } finally { setBusy(false); }
  };

  const repost = async () => {
    setBusy(true);
    try {
      await repostStorePost(storeId, post.id, authorUid);
      onRepostResult(true, '재등록 완료! 24시간 활성화됩니다.');
    } catch (e: unknown) {
      const msg = e instanceof PostGuardError
        ? e.message
        : (e instanceof Error ? e.message : '재등록에 실패했습니다');
      onRepostResult(false, msg);
    } finally {
      setBusy(false);
    }
  };

  const toggleHidden = async () => {
    setBusy(true);
    try {
      await updateStorePost(storeId, post.id, { status: isHidden ? 'published' : 'hidden' });
    } finally { setBusy(false); }
  };

  return (
    <div className={`bg-white border rounded-xl p-4 flex gap-3 lift ${isActive ? 'border-emerald-200' : 'border-gray-200 opacity-60'}`} style={{ boxShadow: 'var(--shadow-card)' }}>
      {post.imageUrls.length > 0 ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={post.imageUrls[0]} alt="" className="w-16 h-16 rounded-lg object-cover flex-shrink-0" />
      ) : (
        <div
          className="w-16 h-16 rounded-lg flex items-center justify-center text-xl flex-shrink-0"
          style={{ background: rowStyle.surface, border: `1px solid ${rowStyle.border}` }}
        >
          {rowEmojiHead || '📝'}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className={`text-[10px] font-extrabold tracking-wider px-2 py-0.5 rounded ${isActive ? 'bg-emerald-100 text-emerald-800' : isExpired ? 'bg-gray-200 text-gray-600' : 'bg-amber-100 text-amber-800'}`}>
            {isActive ? `노출 중 · ${hoursLeft}h 남음` : isExpired ? '만료' : '숨김'}
          </span>
          {relative && (
            <span className="text-[10px] font-semibold text-gray-500">· {relative}</span>
          )}
          {post.eventTags.slice(0, 4).map((t) => (
            <span key={t} className="text-[10px] font-bold bg-pink-50 text-pink-700 px-1.5 py-0.5 rounded">#{t}</span>
          ))}
        </div>
        <div className="text-sm font-extrabold text-gray-900 line-clamp-1 leading-snug">{displayHeadline}</div>
        <div className="text-[12px] text-gray-600 line-clamp-2 whitespace-pre-wrap leading-relaxed mt-0.5">{post.body}</div>
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
        <button
          onClick={repost}
          disabled={busy}
          title="같은 내용으로 새 글 생성 (24h 활성). 하루 3건 한도 적용."
          className="text-[11px] font-bold px-3 py-1.5 rounded-md border border-pink-300 text-pink-700 bg-pink-50 hover:bg-pink-100 disabled:opacity-40"
        >
          재등록
        </button>
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
  // headline 우선, 없으면 body 첫 줄을 초기값으로 (백워드 호환).
  const initialHeadline = post?.headline ?? (post?.body ?? '').split('\n')[0]?.trim() ?? '';
  const [headline, setHeadline] = useState(truncateGraphemes(initialHeadline, HEADLINE_MAX_LENGTH));
  const [body, setBody] = useState(post?.body ?? '');
  const [cardColor, setCardColor] = useState<PostCardColor>((post?.cardColor as PostCardColor) ?? 'white');
  // 다중 이모지 (2026-05-22 신설). 레거시 단일 cardEmoji는 1개짜리 배열로 자동 승격.
  const [cardEmojis, setCardEmojis] = useState<string[]>(() => {
    if (Array.isArray(post?.cardEmojis) && post!.cardEmojis!.length > 0) {
      return post!.cardEmojis!.slice(0, POST_CARD_EMOJIS_MAX);
    }
    if (post?.cardEmoji) return [post.cardEmoji];
    return [];
  });
  const [emojiTab, setEmojiTab] = useState<keyof typeof POST_CARD_EMOJI_GROUPS>('포커');
  const toggleEmoji = (e: string) => {
    setCardEmojis((prev) => {
      if (prev.includes(e)) return prev.filter((x) => x !== e);
      if (prev.length >= POST_CARD_EMOJIS_MAX) return prev; // 캡 도달 시 추가 무시
      return [...prev, e];
    });
  };
  const clearEmojis = () => setCardEmojis([]);
  const [imageUrls, setImageUrls] = useState<string[]>(post?.imageUrls ?? []);
  const [tagsInput, setTagsInput] = useState((post?.eventTags ?? []).join(', '));
  const [ctaUrl, setCtaUrl] = useState(post?.ctaUrl ?? '');
  const [ctaLabel, setCtaLabel] = useState(post?.ctaLabel ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const tempIdRef = useRef<string>(post?.id ?? `temp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);

  // 헤드라인 grapheme 카운트
  const headlineLen = graphemeLength(headline);
  const headlineOver = headlineLen > HEADLINE_MAX_LENGTH;

  // 입력 갱신: grapheme 단위로 자동 자르기 (Over 시 시각적 경고만 추가, 차단은 가드에서)
  const onHeadlineChange = (raw: string) => {
    setHeadline(truncateGraphemes(raw, HEADLINE_MAX_LENGTH));
  };

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
    if (!headline.trim()) { setError('카드에 노출될 한 줄을 입력해주세요'); return; }
    if (!body.trim()) { setError('상세 본문을 입력해주세요'); return; }
    setError(null); setBusy(true);
    const eventTags = tagsInput.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean).slice(0, 8);
    try {
      if (isNew) {
        await createStorePost({
          storeId, storeName,
          headline: headline.trim(),
          body: body.trim(),
          cardColor, cardEmojis,
          imageUrls, eventTags,
          ctaUrl: ctaUrl.trim(), ctaLabel: ctaLabel.trim(), authorUid,
        });
      } else {
        await updateStorePost(storeId, post!.id, {
          headline: headline.trim(),
          body: body.trim(),
          cardColor, cardEmojis,
          imageUrls, eventTags, ctaUrl: ctaUrl.trim(), ctaLabel: ctaLabel.trim(),
        });
      }
      onClose();
    } catch (e: unknown) {
      const raw = e instanceof Error ? e.message : String(e);
      // PostGuardError (Phase E 가드) — 메시지 그대로 노출 (이미 한국어 친화).
      // PERMISSION_DENIED → 매장 상태 진단 패널 안내.
      const friendly = /insufficient permissions|PERMISSION_DENIED/i.test(raw)
        ? '저장 권한이 없습니다. 매장 상태가 active이거나 본사(platform_admin) 권한이 필요합니다. 상단 "🔍 매장 상태 진단" 패널을 확인해 주세요.'
        : raw;
      setError(friendly);
    } finally { setBusy(false); }
  };

  return (
    <div onClick={onClose} className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl w-full max-w-lg max-h-[92vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100">
          <div className="font-extrabold text-gray-900">{isNew ? '새 소식' : '소식 수정'}</div>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* 노출 미리보기 박스 — Phase F (2026-05-22): 실시간 카드 프리뷰 */}
          <div className="rounded-lg p-3 text-[11.5px] leading-relaxed" style={{ background: 'linear-gradient(135deg, #FFF1F8 0%, #FFFAFC 100%)', border: '1px solid #FFC1DE' }}>
            <div className="font-extrabold text-pink-700 mb-2">👀 홈 노출 미리보기</div>
            <LivePreviewCard
              headline={headline}
              cardColor={cardColor}
              cardEmojis={cardEmojis}
              storeName={storeName}
            />
            <div className="text-gray-500 mt-2 leading-snug">
              · 홈 “오늘의 매장 소식” 카드 / 매장찾기 섹션에 자동 노출<br />
              · 24시간 후 자동 만료 · 매장 주변 사용자에게 우선 노출
            </div>
          </div>

          {/* 카드 노출 한 줄 (headline) — Phase F */}
          <div>
            <div className="flex items-baseline justify-between mb-1.5">
              <label className="block text-xs font-bold text-gray-700">🎯 카드 노출 한 줄 *</label>
              <span className={`text-[10px] font-mono ${headlineOver ? 'text-red-600' : headlineLen > HEADLINE_MAX_LENGTH * 0.85 ? 'text-amber-600' : 'text-gray-400'}`}>
                {headlineLen} / {HEADLINE_MAX_LENGTH}
              </span>
            </div>
            <input
              value={headline}
              onChange={(e) => onHeadlineChange(e.target.value)}
              maxLength={HEADLINE_MAX_LENGTH * 4} /* HTML maxLength는 코드포인트라 여유 곱하기 */
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm"
              placeholder="예: 오늘 9시 5T 토너 시작! 🃏"
            />
            <div className="text-[11px] text-gray-400 mt-1">홈 카드에 그대로 노출 · 이모지 OK · 최대 {HEADLINE_MAX_LENGTH}자</div>
          </div>

          {/* 카드 색상 (cardColor) */}
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1.5">🎨 카드 색상</label>
            <div className="grid grid-cols-3 gap-1.5">
              {POST_CARD_COLORS.map((c) => {
                const s = CARD_STYLES[c];
                const selected = cardColor === c;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCardColor(c)}
                    className="rounded-lg px-2 py-2 text-[11px] font-bold transition active:scale-95"
                    style={{
                      background: s.surface,
                      color: s.textPrimary,
                      border: selected ? `2px solid ${s.accent}` : `1px solid ${s.border}`,
                      boxShadow: selected ? `0 2px 8px -3px ${s.accent}` : 'none',
                    }}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 카드 이모지 (cardEmojis) — 카테고리 탭 + 다중 선택 (최대 N개) */}
          <div>
            <div className="flex items-baseline justify-between mb-1.5">
              <label className="block text-xs font-bold text-gray-700">✨ 카드 이모지 (다중 선택)</label>
              <span className="text-[10px] font-mono text-gray-400">
                {cardEmojis.length} / {POST_CARD_EMOJIS_MAX}
              </span>
            </div>

            {/* 선택된 이모지 칩 — 클릭하면 해제 */}
            <div className="mb-2 flex flex-wrap gap-1.5 min-h-[28px]">
              {cardEmojis.length === 0 ? (
                <span className="text-[11px] text-gray-400 italic self-center">미선택 시 색상 톤에 맞는 기본 이모지가 자동 적용됩니다</span>
              ) : (
                <>
                  {cardEmojis.map((e, i) => (
                    <button
                      key={`${e}_${i}`}
                      type="button"
                      onClick={() => toggleEmoji(e)}
                      className="text-[15px] px-2 py-1 rounded-md border border-black bg-black/5 ring-2 ring-black active:scale-95"
                      aria-label={`이모지 ${e} 제거`}
                      title="클릭해서 제거"
                    >
                      {e}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={clearEmojis}
                    className="text-[10px] font-bold px-2 py-1 rounded-md border border-gray-200 text-gray-500 hover:bg-gray-50"
                  >
                    모두 해제
                  </button>
                </>
              )}
            </div>

            {/* 카테고리 탭 */}
            <div className="flex gap-1 mb-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
              {(Object.keys(POST_CARD_EMOJI_GROUPS) as Array<keyof typeof POST_CARD_EMOJI_GROUPS>).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setEmojiTab(tab)}
                  className={`flex-shrink-0 text-[11px] font-bold px-3 py-1.5 rounded-md transition active:scale-95 ${
                    emojiTab === tab
                      ? 'bg-black text-white border border-black'
                      : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* 활성 카테고리의 이모지 그리드 */}
            <div className="flex flex-wrap gap-1.5 p-2 rounded-lg bg-gray-50 border border-gray-200">
              {POST_CARD_EMOJI_GROUPS[emojiTab].map((e) => {
                const selected = cardEmojis.includes(e);
                const capReached = !selected && cardEmojis.length >= POST_CARD_EMOJIS_MAX;
                return (
                  <button
                    key={e}
                    type="button"
                    onClick={() => toggleEmoji(e)}
                    disabled={capReached}
                    title={capReached ? `최대 ${POST_CARD_EMOJIS_MAX}개까지 선택 가능` : selected ? '해제' : '추가'}
                    className={`text-[16px] px-2 py-1.5 rounded-md border active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed ${
                      selected
                        ? 'border-black bg-black/10 ring-2 ring-black'
                        : 'border-gray-200 bg-white hover:bg-white'
                    }`}
                    aria-label={`이모지 ${e}${selected ? ' 선택됨' : ''}`}
                    aria-pressed={selected}
                  >
                    {e}
                  </button>
                );
              })}
            </div>
            <div className="text-[11px] text-gray-400 mt-1.5">
              카테고리를 바꿔가며 최대 {POST_CARD_EMOJIS_MAX}개까지 선택할 수 있어요 · 칩 클릭으로 해제
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1.5">📝 상세 본문 *</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm resize-none font-mono"
              placeholder={'예) 오늘 8시 5T 프리롤 토너 시작!\n     수요일 정기 50T 모집중\n     신규 딜러 OPEN 안내\n\n카톡방에 올리던 글 그대로 붙여넣어도 OK'}
            />
            <div className="text-[11px] text-gray-400 mt-1">매장 상세/매장찾기 카드에서 노출 · 이모지 5개까지 자동 적용 · 외부 링크는 open.kakao.com / pf.kakao.com만 허용</div>
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
            <label className="block text-xs font-bold text-gray-700 mb-1">대표 이미지 ({imageUrls.length}/{MAX_POST_IMAGES}장)</label>
            {/* 세로 포스터 비율 안내 — 사용자 카드가 세로형(원본비율 유지)으로 노출됨 */}
            <div className="text-[11px] text-gray-600 leading-relaxed mb-2 bg-pink-50/70 border border-pink-100 rounded-lg px-2.5 py-2">
              📐 <b className="text-gray-800">세로형(포스터) 사진을 권장합니다</b> — 사용자 화면에 세로 카드로 노출돼요.<br />
              추천 비율 <b>4:5</b> 또는 <b>3:4</b> · 예: <span className="font-mono">1080×1350</span> / <span className="font-mono">1080×1440</span>px<br />
              가로 사진은 작게 보입니다. 글자가 들어간 포스터는 이 비율로 만들면 딱 맞아요.
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mb-2">
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
