'use client';

/**
 * /m/community/hands/[postId] — 핸드분석 상세 v0.5
 *
 * - 이미지 캐러셀
 * - 좋아요 토글
 * - 댓글 + 대댓글 1단
 * - 작성자 본인: 수정/삭제
 */

import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth, useUserDoc } from '@/lib/hooks';
import {
  type HandAnalysisPost,
  type HandComment,
  subscribeHandAnalysisPost,
  subscribeComments,
  addComment,
  deleteComment,
  deleteHandAnalysisPost,
  togglePostLike,
  getIsLiked,
  bumpViewCount,
} from '@/lib/handAnalysis';
import { formatRelativeTime } from '@/lib/community';
import NotificationBellButton from '@/components/mobile/NotificationBellButton';

const POSITION_COLORS: Record<string, string> = {
  BTN: '#2563EB', CO: '#7C3AED', HJ: '#0891B2', LJ: '#065F46',
  UTG: '#B45309', BB: '#DC2626', SB: '#BE185D', MP: '#6B7280', EP: '#374151',
};
function positionColor(pos: string) {
  return POSITION_COLORS[pos.toUpperCase()] ?? '#6B7280';
}

export default function HandDetailPage() {
  const router = useRouter();
  const { postId } = useParams<{ postId: string }>();
  const authState = useAuth();
  const userDoc = useUserDoc(authState.status === 'authenticated' ? authState.user.uid : null);

  const [post, setPost] = useState<HandAnalysisPost | null>(null);
  const [comments, setComments] = useState<HandComment[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [isLiked, setIsLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [likeLoading, setLikeLoading] = useState(false);

  const [carouselIdx, setCarouselIdx] = useState(0);
  const [replyTarget, setReplyTarget] = useState<HandComment | null>(null);
  const [commentBody, setCommentBody] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const commentInputRef = useRef<HTMLTextAreaElement>(null);

  const uid = authState.status === 'authenticated' ? authState.user.uid : '';
  const isAuthor = !!uid && post?.authorUid === uid;

  // 게시글 구독
  useEffect(() => {
    if (!postId) return;
    const unsub = subscribeHandAnalysisPost(postId, (p) => {
      setPost(p);
      if (p) setLikeCount(p.likeCount);
      setLoaded(true);
    });
    return unsub;
  }, [postId]);

  // 조회수 증가 (1회)
  useEffect(() => {
    if (!postId) return;
    bumpViewCount(postId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId]);

  // 댓글 구독
  useEffect(() => {
    if (!postId) return;
    const unsub = subscribeComments(postId, setComments);
    return unsub;
  }, [postId]);

  // 좋아요 상태 로드
  useEffect(() => {
    if (!uid || !postId) return;
    getIsLiked(postId, uid).then(setIsLiked);
  }, [uid, postId]);

  const handleLike = async () => {
    if (!uid) { router.push('/login'); return; }
    if (likeLoading) return;
    setLikeLoading(true);
    // 낙관적 업데이트
    setIsLiked((prev) => !prev);
    setLikeCount((prev) => prev + (isLiked ? -1 : 1));
    try {
      const liked = await togglePostLike(postId, uid);
      setIsLiked(liked);
    } catch {
      // 롤백
      setIsLiked((prev) => !prev);
      setLikeCount((prev) => prev + (isLiked ? 1 : -1));
    } finally {
      setLikeLoading(false);
    }
  };

  const handleSubmitComment = async () => {
    if (!uid) { router.push('/login'); return; }
    if (!commentBody.trim()) return;
    setSubmittingComment(true);
    try {
      const displayName =
        userDoc?.nickname ?? userDoc?.displayName ??
        (authState.status === 'authenticated' ? authState.user.displayName ?? '익명' : '익명');
      const avatarUrl =
        authState.status === 'authenticated' ? authState.user.photoURL ?? '' : '';

      await addComment({
        postId,
        authorUid: uid,
        authorName: displayName,
        authorAvatarUrl: avatarUrl,
        body: commentBody.trim(),
        parentCommentId: replyTarget?.id,
      });
      setCommentBody('');
      setReplyTarget(null);
    } catch {
      // ignore
    } finally {
      setSubmittingComment(false);
    }
  };

  const handleDeletePost = async () => {
    if (!isAuthor) return;
    try {
      await deleteHandAnalysisPost(postId);
      router.replace('/m/community?tab=hand');
    } catch {
      // ignore
    }
  };

  if (!loaded) return <DetailSkeleton />;
  if (!post || post.status === 'deleted') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4" style={{ background: 'var(--bg)' }}>
        <div style={{ fontSize: 44 }} aria-hidden="true">🃏</div>
        <div style={{ fontSize: 14, fontWeight: 800 }}>삭제된 게시글이에요</div>
        <button onClick={() => router.back()} style={{ fontSize: 13, color: 'var(--brand)', fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer' }}>
          목록으로 돌아가기
        </button>
      </div>
    );
  }

  // 댓글 트리 (루트 + 대댓글 그룹)
  const rootComments = comments.filter((c) => !c.parentCommentId);
  const replyMap = new Map<string, HandComment[]>();
  comments.forEach((c) => {
    if (c.parentCommentId) {
      if (!replyMap.has(c.parentCommentId)) replyMap.set(c.parentCommentId, []);
      replyMap.get(c.parentCommentId)!.push(c);
    }
  });

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg)' }}>

      {/* ── 헤더 ─────────────────────────────────────── */}
      <header
        className="sticky top-0 z-30 flex items-center gap-2 px-3"
        style={{ height: 52, background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}
      >
        <button onClick={() => router.back()} aria-label="뒤로" className="tap" style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', color: 'var(--text-1)', cursor: 'pointer' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <div style={{ flex: 1, fontSize: 15, fontWeight: 900, letterSpacing: '-0.015em', color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          핸드분석
        </div>
        {isAuthor && (
          <div className="flex items-center gap-1">
            <Link
              href={`/m/community/hands/write?edit=${postId}`}
              aria-label="수정"
              className="tap"
              style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-2)', textDecoration: 'none' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </Link>
            <button
              onClick={() => setConfirmDelete(true)}
              aria-label="삭제"
              className="tap"
              style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', color: 'var(--text-3)', cursor: 'pointer' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4h6v2" />
              </svg>
            </button>
          </div>
        )}
        <NotificationBellButton ariaLabel="알림" />
      </header>

      {/* ── 본문 스크롤 영역 ─────────────────────────── */}
      <div className="flex-1 overflow-y-auto no-scrollbar pb-32">

        {/* 이미지 캐러셀 */}
        {post.imageUrls.length > 0 && (
          <div style={{ position: 'relative', background: '#000', aspectRatio: '16/9', overflow: 'hidden' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={post.imageUrls[carouselIdx]}
              alt={`핸드 이미지 ${carouselIdx + 1}`}
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            />
            {post.imageUrls.length > 1 && (
              <>
                <button
                  onClick={() => setCarouselIdx((i) => Math.max(0, i - 1))}
                  aria-label="이전 이미지"
                  style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', width: 32, height: 32, borderRadius: 99, background: 'rgba(0,0,0,0.5)', border: 'none', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: carouselIdx === 0 ? 'default' : 'pointer', opacity: carouselIdx === 0 ? 0.3 : 1 }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
                </button>
                <button
                  onClick={() => setCarouselIdx((i) => Math.min(post.imageUrls.length - 1, i + 1))}
                  aria-label="다음 이미지"
                  style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', width: 32, height: 32, borderRadius: 99, background: 'rgba(0,0,0,0.5)', border: 'none', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: carouselIdx === post.imageUrls.length - 1 ? 'default' : 'pointer', opacity: carouselIdx === post.imageUrls.length - 1 ? 0.3 : 1 }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6" /></svg>
                </button>
                {/* 도트 인디케이터 */}
                <div style={{ position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 5 }}>
                  {post.imageUrls.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setCarouselIdx(i)}
                      aria-label={`이미지 ${i + 1}`}
                      style={{ width: i === carouselIdx ? 16 : 6, height: 6, borderRadius: 99, background: i === carouselIdx ? '#fff' : 'rgba(255,255,255,0.45)', border: 'none', padding: 0, cursor: 'pointer', transition: 'width 0.2s' }}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        <div style={{ padding: '16px 16px 0' }}>

          {/* 메타 배지 */}
          <div className="flex items-center gap-1.5 flex-wrap mb-3">
            {post.position && (
              <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 6, background: `${positionColor(post.position)}18`, color: positionColor(post.position) }}>
                {post.position.toUpperCase()}
              </span>
            )}
            {post.stakeLevel && (
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-2)', padding: '2px 7px', borderRadius: 6, background: 'var(--surface-2)' }}>
                {post.stakeLevel}
              </span>
            )}
            {post.tags.map((tag) => (
              <span key={tag} style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 99, background: 'var(--surface-2)', color: 'var(--text-2)' }}>
                #{tag}
              </span>
            ))}
          </div>

          {/* 제목 */}
          <h1 style={{ fontSize: 18, fontWeight: 900, lineHeight: 1.35, letterSpacing: '-0.025em', marginBottom: 12, color: 'var(--text-1)' }}>
            {post.title}
          </h1>

          {/* 작성자 + 시간 */}
          <div className="flex items-center gap-2 mb-4" style={{ paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
            <div style={{ width: 28, height: 28, borderRadius: 99, background: 'linear-gradient(135deg,#FF1F8F,#FF6BAA)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
              {post.authorAvatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={post.authorAvatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <span style={{ fontSize: 12, color: '#fff', fontWeight: 800 }} aria-hidden="true">🃏</span>
              )}
            </div>
            <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-1)' }}>{post.authorName}</span>
            <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{formatRelativeTime(post.createdAt)}</span>
            <div className="flex items-center gap-2 ml-auto" style={{ fontSize: 10, color: 'var(--text-3)' }}>
              <span className="flex items-center gap-0.5">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                {post.viewCount}
              </span>
            </div>
          </div>

          {/* 본문 */}
          <div
            style={{ fontSize: 14, color: 'var(--text-1)', lineHeight: 1.75, letterSpacing: '-0.01em', whiteSpace: 'pre-wrap', wordBreak: 'break-all', marginBottom: 20 }}
          >
            {post.body}
          </div>

          {/* 좋아요 버튼 */}
          <div style={{ display: 'flex', justifyContent: 'center', paddingBottom: 20, borderBottom: '1px solid var(--border)', marginBottom: 20 }}>
            <button
              onClick={handleLike}
              disabled={likeLoading}
              aria-pressed={isLiked}
              aria-label={isLiked ? '좋아요 취소' : '좋아요'}
              className="tap"
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '10px 24px', borderRadius: 99,
                background: isLiked ? 'rgba(255,31,143,0.1)' : 'var(--surface-2)',
                border: isLiked ? '1.5px solid rgba(255,31,143,0.35)' : '1.5px solid var(--border)',
                cursor: 'pointer', transition: 'all 0.15s',
              }}
            >
              <svg
                width="18" height="18" viewBox="0 0 24 24"
                fill={isLiked ? '#FF1F8F' : 'none'}
                stroke={isLiked ? '#FF1F8F' : 'var(--text-3)'}
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
              >
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
              <span style={{ fontSize: 14, fontWeight: 800, color: isLiked ? '#FF1F8F' : 'var(--text-2)' }}>
                {likeCount}
              </span>
            </button>
          </div>

          {/* 댓글 섹션 */}
          <div>
            <div style={{ fontSize: 13, fontWeight: 900, letterSpacing: '-0.015em', marginBottom: 14 }}>
              댓글 {comments.length}
            </div>

            {/* 루트 댓글 + 대댓글 */}
            {rootComments.length === 0 ? (
              <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 12, color: 'var(--text-3)' }}>
                첫 번째 분석을 남겨보세요
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {rootComments.map((c) => {
                  const replies = replyMap.get(c.id) ?? [];
                  return (
                    <div key={c.id}>
                      <CommentItem
                        comment={c}
                        currentUid={uid}
                        onReply={() => {
                          setReplyTarget(c);
                          commentInputRef.current?.focus();
                        }}
                        onDelete={() => deleteComment(postId, c.id)}
                      />
                      {/* 대댓글 */}
                      {replies.map((r) => (
                        <div key={r.id} style={{ paddingLeft: 20, borderLeft: '2px solid var(--border)', marginLeft: 20 }}>
                          <CommentItem
                            comment={r}
                            currentUid={uid}
                            isReply
                            onDelete={() => deleteComment(postId, r.id)}
                          />
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── 댓글 입력 바 ─────────────────────────────── */}
      <div
        style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 30,
          background: 'var(--bg)', borderTop: '1px solid var(--border)',
          padding: '8px 12px 12px',
        }}
      >
        {replyTarget && (
          <div className="flex items-center gap-2 mb-2" style={{ fontSize: 11, color: 'var(--brand)', fontWeight: 700 }}>
            <span>{replyTarget.authorName}에게 답글</span>
            <button onClick={() => setReplyTarget(null)} style={{ background: 'transparent', border: 'none', color: 'var(--text-3)', cursor: 'pointer', fontSize: 12 }}>✕</button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            ref={commentInputRef}
            value={commentBody}
            onChange={(e) => setCommentBody(e.target.value)}
            placeholder={uid ? '분석을 남겨보세요…' : '로그인 후 댓글을 달 수 있어요'}
            disabled={!uid}
            rows={1}
            style={{
              flex: 1, padding: '9px 12px', borderRadius: 10, fontSize: 13,
              border: '1.5px solid var(--border)', background: 'var(--surface-2)',
              color: 'var(--text-1)', fontFamily: 'inherit', outline: 'none',
              resize: 'none', lineHeight: 1.5, maxHeight: 100,
            }}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = `${el.scrollHeight}px`;
            }}
          />
          <button
            onClick={handleSubmitComment}
            disabled={submittingComment || !commentBody.trim() || !uid}
            aria-label="댓글 등록"
            className="tap"
            style={{
              width: 38, height: 38, borderRadius: 10, flexShrink: 0,
              background: commentBody.trim() && uid ? 'var(--brand)' : 'var(--surface-2)',
              border: 'none', color: commentBody.trim() && uid ? '#fff' : 'var(--text-3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── 삭제 확인 모달 ─────────────────────────── */}
      {confirmDelete && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 50,
            background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end',
          }}
          onClick={() => setConfirmDelete(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%', background: 'var(--bg)', borderRadius: '20px 20px 0 0',
              padding: '24px 20px 32px',
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 900, marginBottom: 8 }}>게시글 삭제</div>
            <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 24, lineHeight: 1.6 }}>
              삭제한 게시글은 복구할 수 없어요. 정말 삭제할까요?
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setConfirmDelete(false)}
                style={{ flex: 1, padding: '13px 0', borderRadius: 12, background: 'var(--surface-2)', border: 'none', fontSize: 14, fontWeight: 800, cursor: 'pointer', color: 'var(--text-1)' }}
              >
                취소
              </button>
              <button
                onClick={handleDeletePost}
                style={{ flex: 1, padding: '13px 0', borderRadius: 12, background: '#FF1F8F', border: 'none', fontSize: 14, fontWeight: 800, cursor: 'pointer', color: '#fff' }}
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 댓글 아이템 ───────────────────────────────────────────────
function CommentItem({
  comment,
  currentUid,
  isReply = false,
  onReply,
  onDelete,
}: {
  comment: HandComment;
  currentUid: string;
  isReply?: boolean;
  onReply?: () => void;
  onDelete?: () => void;
}) {
  const isOwn = !!currentUid && comment.authorUid === currentUid;
  return (
    <div style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
      <div className="flex items-center gap-2 mb-1.5">
        <div style={{ width: 22, height: 22, borderRadius: 99, background: 'linear-gradient(135deg,#FF1F8F,#FF6BAA)', flexShrink: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {comment.authorAvatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={comment.authorAvatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <span style={{ fontSize: 10, color: '#fff' }} aria-hidden="true">🃏</span>
          )}
        </div>
        <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-1)' }}>{comment.authorName}</span>
        <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{formatRelativeTime(comment.createdAt)}</span>
        <div className="flex items-center gap-2 ml-auto">
          {!isReply && onReply && (
            <button onClick={onReply} style={{ background: 'transparent', border: 'none', fontSize: 10, color: 'var(--text-3)', cursor: 'pointer', fontWeight: 700, padding: '2px 4px' }}>
              답글
            </button>
          )}
          {isOwn && onDelete && (
            <button onClick={onDelete} style={{ background: 'transparent', border: 'none', fontSize: 10, color: 'var(--text-3)', cursor: 'pointer', fontWeight: 700, padding: '2px 4px' }}>
              삭제
            </button>
          )}
        </div>
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-1)', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-all', paddingLeft: 30 }}>
        {comment.body}
      </div>
    </div>
  );
}

// ── 스켈레톤 ─────────────────────────────────────────────────
function DetailSkeleton() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <div style={{ height: 52, background: 'var(--bg)', borderBottom: '1px solid var(--border)' }} />
      <div style={{ height: 200, background: 'var(--surface-2)' }} />
      <div style={{ padding: '16px 16px 0' }}>
        {[60, 90, 40, 100, 75, 55].map((w, i) => (
          <div key={i} style={{ height: 14, width: `${w}%`, borderRadius: 6, background: 'var(--surface-2)', marginBottom: 12 }} />
        ))}
      </div>
    </div>
  );
}
