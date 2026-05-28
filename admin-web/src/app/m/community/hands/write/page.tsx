'use client';

/**
 * /m/community/hands/write — 핸드분석 작성 / 수정 v0.5
 *
 * ?edit=postId 파라미터가 있으면 수정 모드로 동작
 */

import { useState, useRef, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { useAuth, useUserDoc } from '@/lib/hooks';
import {
  createHandAnalysisPost,
  updateHandAnalysisPost,
  uploadHandAnalysisImage,
  subscribeHandAnalysisPost,
  MAX_IMAGES,
  type CreateHandAnalysisPostInput,
} from '@/lib/handAnalysis';

const POSITION_OPTIONS = ['BTN', 'CO', 'HJ', 'LJ', 'UTG', 'BB', 'SB', 'MP', 'EP'];

const MAX_TAGS = 5;
const MAX_TITLE = 100;
const MAX_BODY = 3000;

// ── 메인 래퍼 (Suspense) ─────────────────────────────────────
export default function HandWritePage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <HandWriteInner />
    </Suspense>
  );
}

function HandWriteInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get('edit');
  const authState = useAuth();
  const userDoc = useUserDoc(authState.status === 'authenticated' ? authState.user.uid : null);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [position, setPosition] = useState('');
  const [stakeLevel, setStakeLevel] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [loadingEdit, setLoadingEdit] = useState(!!editId);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // 수정 모드 — 기존 데이터 로드
  useEffect(() => {
    if (!editId) return;
    const unsub = subscribeHandAnalysisPost(editId, (post) => {
      if (!post) { setLoadingEdit(false); return; }
      setTitle(post.title);
      setBody(post.body);
      setPosition(post.position ?? '');
      setStakeLevel(post.stakeLevel ?? '');
      setTags(post.tags);
      setImageUrls(post.imageUrls);
      setLoadingEdit(false);
    });
    return unsub;
  }, [editId]);

  // 비로그인 리다이렉트
  useEffect(() => {
    if (authState.status === 'anonymous') router.replace('/login');
  }, [authState, router]);

  const uid = authState.status === 'authenticated' ? authState.user.uid : '';
  const displayName =
    userDoc?.nickname ?? userDoc?.displayName ?? authState.status === 'authenticated'
      ? (authState as { user: { displayName?: string | null } }).user?.displayName ?? '익명'
      : '익명';
  const avatarUrl = authState.status === 'authenticated'
    ? ((authState as { user: { photoURL?: string | null } }).user?.photoURL ?? '')
    : '';

  // ── 이미지 추가 ──────────────────────────────────────────
  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    if (imageUrls.length + files.length > MAX_IMAGES) {
      setError(`이미지는 최대 ${MAX_IMAGES}장까지 첨부할 수 있어요`);
      return;
    }
    const idx = imageUrls.length;
    setUploadingIdx(idx);
    setError('');
    try {
      const urls: string[] = [];
      for (const file of files.slice(0, MAX_IMAGES - imageUrls.length)) {
        const url = await uploadHandAnalysisImage(uid, file);
        urls.push(url);
      }
      setImageUrls((prev) => [...prev, ...urls]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '업로드 실패');
    } finally {
      setUploadingIdx(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeImage = (idx: number) => {
    setImageUrls((prev) => prev.filter((_, i) => i !== idx));
  };

  // ── 태그 처리 ────────────────────────────────────────────
  const addTag = () => {
    const t = tagInput.trim().replace(/^#/, '');
    if (!t || tags.length >= MAX_TAGS || tags.includes(t)) { setTagInput(''); return; }
    setTags((prev) => [...prev, t]);
    setTagInput('');
  };
  const removeTag = (t: string) => setTags((prev) => prev.filter((x) => x !== t));

  // ── 제출 ─────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!title.trim()) { setError('제목을 입력해 주세요'); return; }
    if (!body.trim()) { setError('내용을 입력해 주세요'); return; }
    setError('');
    setSubmitting(true);
    try {
      if (editId) {
        await updateHandAnalysisPost(editId, {
          title, body, imageUrls, position, stakeLevel, tags,
        });
        router.replace(`/m/community/hands/${editId}`);
      } else {
        const input: CreateHandAnalysisPostInput = {
          authorUid: uid,
          authorName: typeof displayName === 'string' ? displayName : '익명',
          authorAvatarUrl: avatarUrl,
          title, body, imageUrls, position, stakeLevel, tags,
        };
        const newId = await createHandAnalysisPost(input);
        router.replace(`/m/community/hands/${newId}`);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '저장에 실패했어요. 다시 시도해 주세요.');
      setSubmitting(false);
    }
  };

  if (loadingEdit) return <PageSkeleton />;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg)' }}>

      {/* ── 헤더 ─────────────────────────────────────── */}
      <header
        className="sticky top-0 z-30 flex items-center gap-2 px-3"
        style={{ height: 52, background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}
      >
        <button
          onClick={() => router.back()}
          aria-label="취소"
          className="tap"
          style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', color: 'var(--text-1)', cursor: 'pointer' }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
        <div style={{ flex: 1, fontSize: 16, fontWeight: 900, letterSpacing: '-0.015em', color: 'var(--text-1)' }}>
          {editId ? '핸드분석 수정' : '핸드분석 작성'}
        </div>
        <button
          onClick={handleSubmit}
          disabled={submitting || !title.trim() || !body.trim()}
          className="tap"
          style={{
            padding: '7px 16px', borderRadius: 10, fontSize: 13, fontWeight: 800,
            background: title.trim() && body.trim() ? 'var(--brand)' : 'var(--surface-2)',
            color: title.trim() && body.trim() ? '#fff' : 'var(--text-3)',
            border: 'none', cursor: title.trim() && body.trim() ? 'pointer' : 'default',
          }}
        >
          {submitting ? '저장 중…' : '등록'}
        </button>
      </header>

      {/* ── 폼 ───────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto pb-8" style={{ padding: '16px 16px 32px' }}>

        {/* 에러 배너 */}
        {error && (
          <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 10, background: '#FFF0F7', border: '1px solid rgba(255,31,143,0.2)', fontSize: 12, color: '#C2185B', fontWeight: 600 }}>
            {error}
          </div>
        )}

        {/* 제목 */}
        <FieldLabel required>제목</FieldLabel>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={MAX_TITLE}
          placeholder="예) BTN에서 오버페어 콜 or 폴드?"
          style={{
            width: '100%', padding: '11px 12px', borderRadius: 10, fontSize: 14,
            border: '1.5px solid var(--border)', background: 'var(--bg)',
            color: 'var(--text-1)', fontFamily: 'inherit', boxSizing: 'border-box',
            outline: 'none', marginBottom: 16,
          }}
        />

        {/* 포지션 + 블라인드 */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
          <div>
            <FieldLabel>포지션</FieldLabel>
            <div
              className="no-scrollbar"
              style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}
            >
              {POSITION_OPTIONS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPosition(position === p ? '' : p)}
                  className="tap"
                  style={{
                    flexShrink: 0, padding: '5px 10px', borderRadius: 8, fontSize: 11, fontWeight: 800,
                    border: position === p ? 'none' : '1px solid var(--border)',
                    background: position === p ? 'var(--brand)' : 'var(--bg)',
                    color: position === p ? '#fff' : 'var(--text-1)',
                    cursor: 'pointer',
                  }}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div>
            <FieldLabel>블라인드 (예: 1/2)</FieldLabel>
            <input
              value={stakeLevel}
              onChange={(e) => setStakeLevel(e.target.value)}
              placeholder="1/2, 2/5…"
              style={{
                width: '100%', padding: '8px 10px', borderRadius: 8, fontSize: 13,
                border: '1.5px solid var(--border)', background: 'var(--bg)',
                color: 'var(--text-1)', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none',
              }}
            />
          </div>
        </div>

        {/* 본문 */}
        <FieldLabel required>핸드 설명</FieldLabel>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={MAX_BODY}
          rows={7}
          placeholder={`핸드 상황을 설명해 주세요.\n\n예)\n스택 100BB. BTN에서 AKo 오픈 2.5bb.\nBB 콜. 플롭 K72r.\nBB 체크, 나 1/3 벳, BB 콜.\n턴 3. BB 도동 체크, 나 2/3 벳…`}
          style={{
            width: '100%', padding: '11px 12px', borderRadius: 10, fontSize: 13,
            border: '1.5px solid var(--border)', background: 'var(--bg)',
            color: 'var(--text-1)', fontFamily: 'inherit', boxSizing: 'border-box',
            outline: 'none', resize: 'vertical', lineHeight: 1.6, marginBottom: 4,
          }}
        />
        <div style={{ fontSize: 10, color: 'var(--text-3)', textAlign: 'right', marginBottom: 16 }}>
          {body.length} / {MAX_BODY}
        </div>

        {/* 이미지 첨부 */}
        <FieldLabel>이미지 (최대 {MAX_IMAGES}장, 5MB 이하)</FieldLabel>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          {imageUrls.map((url, idx) => (
            <div key={url} style={{ position: 'relative', width: 80, height: 80, borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)', flexShrink: 0 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={`첨부 이미지 ${idx + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              <button
                type="button"
                onClick={() => removeImage(idx)}
                aria-label={`이미지 ${idx + 1} 삭제`}
                style={{
                  position: 'absolute', top: 3, right: 3, width: 20, height: 20, borderRadius: 99,
                  background: 'rgba(0,0,0,0.55)', border: 'none', color: '#fff',
                  fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </div>
          ))}
          {uploadingIdx !== null && (
            <div style={{ width: 80, height: 80, borderRadius: 10, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <div style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 700 }}>업로드 중…</div>
            </div>
          )}
          {imageUrls.length < MAX_IMAGES && uploadingIdx === null && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              aria-label="이미지 추가"
              style={{
                width: 80, height: 80, borderRadius: 10, border: '1.5px dashed var(--border)',
                background: 'var(--surface-2)', display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 4,
                cursor: 'pointer', color: 'var(--text-2)', flexShrink: 0,
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
              <span style={{ fontSize: 9, fontWeight: 700 }}>사진 추가</span>
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleImageSelect}
            style={{ display: 'none' }}
            aria-hidden="true"
          />
        </div>

        {/* 태그 */}
        <FieldLabel>태그 (최대 {MAX_TAGS}개)</FieldLabel>
        <div className="flex items-center gap-2 flex-wrap mb-2">
          {tags.map((t) => (
            <span
              key={t}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '4px 10px', borderRadius: 99, fontSize: 12, fontWeight: 700,
                background: 'rgba(255,31,143,0.1)', color: '#FF1F8F',
              }}
            >
              #{t}
              <button type="button" onClick={() => removeTag(t)} aria-label={`태그 ${t} 삭제`} style={{ background: 'transparent', border: 'none', color: '#FF1F8F', cursor: 'pointer', fontSize: 12, lineHeight: 1, padding: 0, marginLeft: 2 }}>✕</button>
            </span>
          ))}
        </div>
        {tags.length < MAX_TAGS && (
          <div className="flex items-center gap-2">
            <input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
              placeholder="태그 입력 후 엔터 또는 + (예: 블러프)"
              maxLength={20}
              style={{
                flex: 1, padding: '8px 10px', borderRadius: 8, fontSize: 13,
                border: '1.5px solid var(--border)', background: 'var(--bg)',
                color: 'var(--text-1)', fontFamily: 'inherit', outline: 'none',
              }}
            />
            <button type="button" onClick={addTag} className="tap" style={{ padding: '8px 14px', borderRadius: 8, background: 'var(--surface-2)', border: 'none', fontSize: 13, fontWeight: 700, color: 'var(--text-1)', cursor: 'pointer' }}>
              +
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── 공통 ─────────────────────────────────────────────────────
function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-2)', marginBottom: 6, letterSpacing: '-0.01em' }}>
      {children}{required && <span style={{ color: '#FF1F8F', marginLeft: 2 }}>*</span>}
    </div>
  );
}

function PageSkeleton() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '60px 16px 32px' }}>
      {[100, 40, 200, 80, 60].map((w, i) => (
        <div key={i} style={{ height: 14, width: `${w}%`, maxWidth: `${w}%`, borderRadius: 6, background: 'var(--surface-2)', marginBottom: 14 }} />
      ))}
    </div>
  );
}
