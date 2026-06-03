'use client';

/**
 * imageCompress.ts — 업로드 직전 이미지 압축 (브라우저 전용)
 *
 * 정책:
 *   - 미리보기는 항상 "원본" 파일을 보여준다(반드시 렌더됨 → 엑박스 방지).
 *   - 압축은 이 함수로 "업로드 직전"에만 수행한다.
 *   - 디코드/인코드 실패(일부 HEIC, 메모리 제약 등)는 조용히 원본을 반환(폴백).
 *     → 압축 실패가 가입 자체를 깨뜨리지 않는다.
 *
 * 목적: 실제 폰 사진(3~8MB)을 ~1600px / JPEG로 줄여 최종 제출 업로드를 즉시 끝나게 함.
 */

export async function compressImageForUpload(
  file: File,
  maxDim = 1920,
  quality = 0.88,
): Promise<File> {
  // 브라우저 외(서버) 또는 미지원 환경 → 원본
  if (typeof document === 'undefined' || typeof createImageBitmap === 'undefined') return file;
  if (!file.type.startsWith('image/')) return file;

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
    // 압축이 실패했거나(빈 blob) 더 커졌으면 원본 유지
    if (!blob || blob.size === 0 || blob.size >= file.size) return file;
    const base = file.name.replace(/\.[^.]+$/, '') || 'signage';
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg' });
  } catch {
    return file; // 디코드 실패 → 원본 그대로 (업로드는 진행)
  } finally {
    bitmap?.close?.();
  }
}
