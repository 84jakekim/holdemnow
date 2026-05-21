'use client';

/**
 * 기존 매장에 regionCode 필드 백필 — 1회성 유틸.
 *
 * 대상: regionCode 미존재 OR '미분류' 상태의 모든 매장 (status 무관).
 * 입력: address 또는 roadAddress → regionCodeFromAddress
 * 출력: { scanned, updated, unmatched }
 *
 * 호출:
 *   - /platform/audit 페이지에 버튼으로 노출 (platform_admin only).
 *   - 또는 /platform/demo 등 본사 운영 페이지에서 1회 실행.
 *
 * 정책 (Sprint 1 Phase B):
 *   - 한 번에 모든 매장 스캔 — v0.1 데모 규모(<1000개) 한정. 대규모 시 batched.
 *   - status='active'와 'pending' 모두 backfill (pending도 승인 시 광역 키 필요).
 *   - regionCode 이미 정상값(=KNOWN_REGION_CODES 중 하나)이면 skip.
 */

import { collection, getDocs, doc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import { regionCodeFromAddress, KNOWN_REGION_CODES, type RegionCode } from './geo';
import { stripUndefined } from './firestoreUtil';

export interface BackfillResult {
  scanned: number;
  updated: number;
  unmatched: number;     // regionCode='미분류'로 갱신된 건 (검토 필요)
  skipped: number;       // 이미 정상값
  errors: number;
  byRegion: Record<string, number>;
}

const VALID_SET = new Set<string>(KNOWN_REGION_CODES);

export async function backfillRegionCodeForAllStores(): Promise<BackfillResult> {
  const result: BackfillResult = {
    scanned: 0,
    updated: 0,
    unmatched: 0,
    skipped: 0,
    errors: 0,
    byRegion: {},
  };

  const snap = await getDocs(collection(db, 'stores'));
  result.scanned = snap.size;

  // Firestore batch 캡=500 — 안전하게 400으로
  const BATCH_SIZE = 400;
  let batch = writeBatch(db);
  let inBatch = 0;

  for (const d of snap.docs) {
    const data = d.data() as {
      address?: string;
      roadAddress?: string;
      jibunAddress?: string;
      regionCode?: string;
    };
    const existing = (data.regionCode ?? '').trim();
    if (existing && VALID_SET.has(existing)) {
      result.skipped += 1;
      continue;
    }

    const src = data.roadAddress || data.address || data.jibunAddress || '';
    const code: RegionCode = regionCodeFromAddress(src);

    try {
      batch.update(doc(db, 'stores', d.id), stripUndefined({
        regionCode: code,
        regionCodeBackfilledAt: serverTimestamp(),
      }));
      inBatch += 1;
      result.updated += 1;
      if (code === '미분류') result.unmatched += 1;
      result.byRegion[code] = (result.byRegion[code] ?? 0) + 1;

      if (inBatch >= BATCH_SIZE) {
        await batch.commit();
        batch = writeBatch(db);
        inBatch = 0;
      }
    } catch {
      result.errors += 1;
    }
  }

  if (inBatch > 0) {
    try {
      await batch.commit();
    } catch {
      result.errors += inBatch;
    }
  }

  return result;
}
