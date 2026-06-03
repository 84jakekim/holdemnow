import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

interface Input {
  /** true면 실제 수정. 기본 false = DRY-RUN(변경 예정만 집계). */
  apply?: boolean;
}

export interface BackfillUserProvidersResult {
  scanned: number;
  /** DRY-RUN이면 wouldChange, apply=true면 changed에 값이 들어간다. */
  wouldChange?: number;
  changed?: number;
  /** Auth에 사용자가 없어 skip한 건수. */
  skippedNoAuth: number;
  /** 최대 20건 샘플 — 어떤 uid가 어떻게 바뀌는지. */
  samples: Array<{ uid: string; from: string[]; to: string[] }>;
}

/**
 * Firebase Auth providerData → providers 배열 매핑.
 * - 'google.com' → 'google'
 * - 'password'   → 'password'
 * - 그 외 providerId는 그대로 유지.
 * - uid가 `kakao:` 접두사면 'kakao' 추가(카카오는 custom token이라 providerData에 안 잡힘).
 */
function deriveProviders(uid: string, providerData: admin.auth.UserInfo[]): string[] {
  const out: string[] = [];
  for (const p of providerData) {
    if (p.providerId === 'google.com') out.push('google');
    else if (p.providerId === 'password') out.push('password');
    else out.push(p.providerId);
  }
  if (uid.startsWith('kakao:') && !out.includes('kakao')) out.push('kakao');
  // 중복 제거 (안전)
  return Array.from(new Set(out));
}

/** 정렬 후 비교 — 순서 차이를 변경으로 오판하지 않도록. */
function sameProviders(a: string[] | undefined, b: string[]): boolean {
  if (!a) return false;
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

/**
 * 로그인 fallback이 providers를 잘못(['google'] 등) 박은 문서를 실제 Auth providerData 기준으로 교정.
 * - platform_admin 권한 검증.
 * - Firestore `users` 전체를 페이지 단위(500)로 순회.
 * - 각 uid에 대해 admin.auth().getUser로 providerData 조회 → 올바른 providers 산출.
 *   - Auth에 사용자가 없으면 skip(skippedNoAuth 카운트).
 * - 기존 doc.providers와 다르면 교정 대상.
 *   - apply=true면 { providers, providersBackfilledAt } merge 업데이트.
 *   - apply=false(DRY-RUN)면 변경 예정만 집계.
 * - signupSource 안전장치: 기존 signupSource가 'oauth'인데 실제로는 password가 포함되면
 *   signupSource는 건드리지 않고 로그로만 표시(데이터 파괴 방지).
 *
 * 대량 작업: getUser는 페이지 내에서 소량 병렬(동시 10)로 처리해 rate limit를 피한다.
 */
export const backfillUserProviders = onCall(
  { region: 'asia-northeast3', timeoutSeconds: 540, memory: '512MiB' },
  async (req): Promise<BackfillUserProvidersResult> => {
    if (!req.auth?.uid) throw new HttpsError('unauthenticated', 'login required');

    const callerSnap = await admin.firestore().collection('users').doc(req.auth.uid).get();
    const callerData = callerSnap.data() as { role?: string; roles?: string[] } | undefined;
    const isAdmin = callerData?.role === 'platform_admin' || callerData?.roles?.includes('platform_admin');
    if (!isAdmin) throw new HttpsError('permission-denied', 'platform_admin only');

    const apply = ((req.data ?? {}) as Input).apply === true;

    const db = admin.firestore();
    const PAGE = 500;
    const CONCURRENCY = 10;

    let scanned = 0;
    let mutated = 0; // wouldChange 또는 changed
    let skippedNoAuth = 0;
    const samples: Array<{ uid: string; from: string[]; to: string[] }> = [];

    let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;

    // 페이지 단위 순회
    // eslint-disable-next-line no-constant-condition
    while (true) {
      let q = db.collection('users').orderBy(admin.firestore.FieldPath.documentId()).limit(PAGE);
      if (lastDoc) q = q.startAfter(lastDoc);
      const snap = await q.get();
      if (snap.empty) break;

      lastDoc = snap.docs[snap.docs.length - 1];

      // 페이지 내 문서를 동시 CONCURRENCY개씩 청크 처리
      for (let i = 0; i < snap.docs.length; i += CONCURRENCY) {
        const chunk = snap.docs.slice(i, i + CONCURRENCY);
        const results = await Promise.all(
          chunk.map(async (doc) => {
            scanned++;
            const uid = doc.id;
            const data = doc.data() as { providers?: string[]; signupSource?: string } | undefined;

            let authUser: admin.auth.UserRecord;
            try {
              authUser = await admin.auth().getUser(uid);
            } catch (e) {
              const code = (e as { code?: string }).code;
              if (code === 'auth/user-not-found') {
                skippedNoAuth++;
                return null;
              }
              throw e;
            }

            const correct = deriveProviders(uid, authUser.providerData);
            const current = data?.providers;

            if (sameProviders(current, correct)) return null;

            // signupSource 안전 체크: 'oauth'인데 실제 password 포함이면 로그만, signupSource는 미변경
            if (data?.signupSource === 'oauth' && correct.includes('password')) {
              console.log(
                `[backfillUserProviders] WARN uid=${uid} signupSource='oauth' but providers include 'password' — leaving signupSource untouched`,
              );
            }

            return { uid, from: current ?? [], to: correct };
          }),
        );

        for (const r of results) {
          if (!r) continue;
          mutated++;
          if (samples.length < 20) samples.push(r);

          if (apply) {
            await db.collection('users').doc(r.uid).set(
              {
                providers: r.to,
                providersBackfilledAt: admin.firestore.FieldValue.serverTimestamp(),
              },
              { merge: true },
            );
          }
        }
      }

      if (snap.size < PAGE) break;
    }

    const result: BackfillUserProvidersResult = apply
      ? { scanned, changed: mutated, skippedNoAuth, samples }
      : { scanned, wouldChange: mutated, skippedNoAuth, samples };

    console.log(
      `[backfillUserProviders] caller=${req.auth.uid} apply=${apply} scanned=${scanned} ${
        apply ? 'changed' : 'wouldChange'
      }=${mutated} skippedNoAuth=${skippedNoAuth} samples=${samples.length}`,
    );

    return result;
  },
);
