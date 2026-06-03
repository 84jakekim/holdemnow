/**
 * community.ts — 커뮤니티 (구인/구직) 데이터 + CRUD
 *
 * 정책 (memory: project_holdemnow_community):
 * - 통합 `community/{itemId}` + type 분기 + authorType (SNS 호환)
 * - v0.1: jobOffer만 활성. 구직은 v0.2~
 * - 만료: jobOffer 30일, dealerProfile 무기한
 * - 모더레이션: flagCount ≥ 3 자동 hidden
 */
'use client';

import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  setDoc,
  Timestamp,
  getCountFromServer,
} from 'firebase/firestore';
import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from 'firebase/storage';
import { db, storage } from './firebase';
import { compressImageForUpload } from './imageCompress';
import { stripUndefined } from './firestoreUtil';

export type CommunityItemType = 'jobOffer' | 'dealerProfile';

export type JobRole = 'dealer' | 'floor' | 'manager' | 'parttime';

export interface WageInfo {
  /** 'hourly' | 'monthly' | 'negotiable' */
  type: 'hourly' | 'monthly' | 'negotiable';
  amount?: number;
  currency: 'KRW';
}

export type ShiftType = 'weekday' | 'weekend' | 'fulltime' | 'parttime';

export type CommunityItemStatus = 'active' | 'closed' | 'expired' | 'hidden';

/** Firestore: community/{itemId} */
export interface CommunityItem {
  id: string;
  type: CommunityItemType;
  title: string;
  body: string;
  images?: string[];
  region?: string;           // 예: "부산 해운대구"
  contact?: {
    phone?: string;
    kakaoOpenChat?: string;
  };
  status: CommunityItemStatus;
  flagCount?: number;
  createdAt: Date | string;
  updatedAt?: Date | string;
  expiresAt?: Date | string;
  /** 'store' | 'user' */
  authorType: 'store' | 'user';
  authorUid: string;
  storeId?: string;
  storeName?: string;
  storePhotoUrl?: string;
}

/** jobOffer 전용 확장 필드 — CommunityItem & JobOffer 형태로 사용 */
export interface JobOffer extends CommunityItem {
  type: 'jobOffer';
  role: JobRole;
  wage: WageInfo;
  shift: ShiftType[];
}

// ── dealerProfile ────────────────────────────────────────────

/** 가능분야 (복수 선택) */
export type DealerAbility = 'tournament' | 'tournamentExp' | 'managerExp' | 'etc';

/** 경력 단계 (단일 선택) */
export type ExperienceLevel =
  | 'beginner'
  | 'm3to6'
  | 'm6to12'
  | 'y1to2'
  | 'y2to3'
  | 'y3to5'
  | 'y5plus';

/** 가용시간 (복수 선택) */
export type AvailableShift =
  | 'weekday'
  | 'weekend'
  | 'w1to2'
  | 'w3to4'
  | 'w5to6'
  | 'negotiable';

/** 성별 */
export type DealerGender = 'male' | 'female' | 'other';

/** dealerProfile — 일반 사용자 본인 1프로필 (authorType: 'user') */
export interface DealerProfile extends CommunityItem {
  type: 'dealerProfile';
  displayName: string;
  /** 가능분야 (복수) */
  abilities: DealerAbility[];
  /** 경력 단계 (단일) */
  experienceLevel: ExperienceLevel;
  /** 가용시간 (복수) */
  availableShifts: AvailableShift[];
  /** 자기소개 */
  bio: string;
  /** 경력사항 — 자유 텍스트, 줄바꿈으로 여러 경력 */
  careerHistory?: string;
  /** 활동 가능 지역 — 자유 수기 입력 */
  // region은 CommunityItem 공통 필드 재사용
  profileImageUrl?: string;
  /** 나이 (선택, 매장 owner에게만 공개) */
  age?: number;
  /** 성별 (선택, 매장 owner에게만 공개) */
  gender?: DealerGender;
  /** 거주지 (선택, 매장 owner에게만 공개) */
  residence?: string;
  /** 개인정보 수집·이용 동의 여부 */
  privacyConsent?: boolean;
  /**
   * 공개 토글 (2026-05-26 절충안).
   * - true: 일반 사용자(/m/community/dealers)에게도 노출. 본인이 명시적으로 켰을 때만.
   * - false 또는 undefined: 매장 owner 전용 (기존 v0.3 정책 유지) — 어드민 딜러 풀에서만 노출.
   *
   * 정책 (memory: project_dealer_profile_v03 절충안):
   *   본인이 토글을 켜야만 사용자 열람 허용. 매장 owner 수익 모델은 publicProfile=false
   *   상태에서도 어드민에서 전체 접근 가능하므로 보호됨. 딜러 본인이 적극 노출을 원할 때만 v1.0
   *   유료 매칭 시장에 영향 없이 사용자 접점 확장.
   */
  publicProfile?: boolean;
  // contact는 CommunityItem 공통 필드 재사용
}

export const DEALER_ABILITY_LABELS: Record<DealerAbility, string> = {
  tournament: '토너먼트',
  tournamentExp: '대회경험',
  managerExp: '매니저경험',
  etc: '기타',
};

export const EXPERIENCE_LEVEL_LABELS: Record<ExperienceLevel, string> = {
  beginner: '초보',
  m3to6: '3~6개월',
  m6to12: '6개월~1년',
  y1to2: '1~2년',
  y2to3: '2~3년',
  y3to5: '3~5년',
  y5plus: '5년 이상',
};

export const AVAILABLE_SHIFT_LABELS: Record<AvailableShift, string> = {
  weekday: '평일',
  weekend: '주말',
  w1to2: '주 1~2회',
  w3to4: '주 3~4회',
  w5to6: '주 5~6회',
  negotiable: '협의 가능',
};

export const JOB_ROLE_LABELS: Record<JobRole, string> = {
  dealer: '딜러',
  floor: '플로어',
  manager: '매니저',
  parttime: '파트타임',
};

export const SHIFT_LABELS: Record<ShiftType, string> = {
  weekday: '평일',
  weekend: '주말',
  fulltime: '풀타임',
  parttime: '파트타임',
};

export function formatWage(wage: WageInfo): string {
  if (wage.type === 'negotiable') return '급여 협의';
  if (!wage.amount) return '협의';
  const formatted = wage.amount.toLocaleString('ko-KR');
  if (wage.type === 'hourly') return `시급 ₩${formatted}`;
  return `월급 ₩${formatted}`;
}

export function formatRelativeTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const diff = Date.now() - d.getTime();
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (minutes < 1) return '방금 전';
  if (minutes < 60) return `${minutes}분 전`;
  if (hours < 24) return `${hours}시간 전`;
  if (days < 7) return `${days}일 전`;
  return d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
}

// ─────────────────────────────────────────────────────────────
// Firestore CRUD (v0.1: jobOffer만)
// ─────────────────────────────────────────────────────────────

const COMMUNITY = 'community';
const JOB_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 구인 30일
export const MAX_JOB_IMAGES = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Firestore 문서를 클라이언트 형식으로 변환 — Timestamp → ISO 문자열 */
function fromDoc(id: string, data: Record<string, unknown>): CommunityItem {
  const toIso = (t: unknown): string | undefined => {
    if (!t) return undefined;
    if (t instanceof Timestamp) return t.toDate().toISOString();
    return undefined;
  };
  return {
    ...(data as Omit<CommunityItem, 'id' | 'createdAt' | 'updatedAt' | 'expiresAt'>),
    id,
    createdAt: toIso(data.createdAt) ?? new Date().toISOString(),
    updatedAt: toIso(data.updatedAt),
    expiresAt: toIso(data.expiresAt),
  } as CommunityItem;
}

/** 활성 구인 글 실시간 구독 — 모바일 리스트용. 클라이언트에서 status/만료/필터 처리. */
export function subscribeActiveJobs(
  onChange: (items: JobOffer[]) => void,
  onError: (e: Error) => void,
) {
  // 보안: status='active'만 조회 — hidden/closed 상태 글이 모바일에 노출되지 않게.
  // 자동 신고(flagCount >= 3)로 hidden 처리된 글도 여기서 차단됨.
  const q = query(
    collection(db, COMMUNITY),
    where('type', '==', 'jobOffer'),
    where('status', '==', 'active'),
    orderBy('createdAt', 'desc'),
    limit(50),
  );
  return onSnapshot(
    q,
    (snap) => {
      const now = Date.now();
      const items = snap.docs
        .map((d) => fromDoc(d.id, d.data()) as JobOffer)
        .filter((j) => {
          // 만료 글 클라이언트 차단 (서버 인덱스 비용 절감)
          if (j.expiresAt && new Date(j.expiresAt).getTime() <= now) return false;
          return true;
        });
      onChange(items);
    },
    (e) => onError(e as Error),
  );
}

/** 단일 구인 상세 구독 */
export function subscribeJobItem(
  itemId: string,
  onChange: (item: JobOffer | null) => void,
  onError: (e: Error) => void,
) {
  return onSnapshot(
    doc(db, COMMUNITY, itemId),
    (snap) => {
      if (!snap.exists()) {
        onChange(null);
        return;
      }
      onChange(fromDoc(snap.id, snap.data()) as JobOffer);
    },
    (e) => onError(e as Error),
  );
}

/** 매장 어드민 — 자기 매장의 모든 구인(만료/마감 포함). 사장이 관리. */
export function subscribeStoreJobs(
  storeId: string,
  onChange: (items: JobOffer[]) => void,
  onError: (e: Error) => void,
) {
  const q = query(
    collection(db, COMMUNITY),
    where('type', '==', 'jobOffer'),
    where('storeId', '==', storeId),
    orderBy('createdAt', 'desc'),
  );
  return onSnapshot(
    q,
    (snap) => onChange(snap.docs.map((d) => fromDoc(d.id, d.data()) as JobOffer)),
    (e) => onError(e as Error),
  );
}

/** 매장 상세 "지금 채용 중 N건" 배지용 — count만 */
export async function countActiveJobsByStore(storeId: string): Promise<number> {
  try {
    const q = query(
      collection(db, COMMUNITY),
      where('type', '==', 'jobOffer'),
      where('storeId', '==', storeId),
      where('status', '==', 'active'),
    );
    const snap = await getCountFromServer(q);
    return snap.data().count;
  } catch {
    return 0;
  }
}

export interface CreateJobInput {
  storeId: string;
  storeName: string;
  storePhotoUrl?: string;
  authorUid: string;
  title: string;
  body: string;
  role: JobRole;
  wage: WageInfo;
  shift: ShiftType[];
  region?: string;
  contact: { phone?: string; kakaoOpenChat?: string };
  images?: string[];
  expiresAt?: Date;
}

export async function createJob(input: CreateJobInput): Promise<string> {
  const expiresAt = input.expiresAt ?? new Date(Date.now() + JOB_TTL_MS);
  const ref = await addDoc(collection(db, COMMUNITY), stripUndefined({
    type: 'jobOffer',
    title: input.title,
    body: input.body,
    images: input.images ?? [],
    region: input.region ?? '',
    contact: {
      phone: input.contact.phone ?? '',
      kakaoOpenChat: input.contact.kakaoOpenChat ?? '',
    },
    status: 'active' as CommunityItemStatus,
    flagCount: 0,
    role: input.role,
    wage: input.wage,
    shift: input.shift,
    authorType: 'store',
    authorUid: input.authorUid,
    storeId: input.storeId,
    storeName: input.storeName,
    storePhotoUrl: input.storePhotoUrl ?? '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    expiresAt: Timestamp.fromDate(expiresAt),
  }));
  return ref.id;
}

export type UpdateJobInput = Partial<{
  title: string;
  body: string;
  role: JobRole;
  wage: WageInfo;
  shift: ShiftType[];
  region: string;
  contact: { phone?: string; kakaoOpenChat?: string };
  images: string[];
  status: CommunityItemStatus;
  expiresAt: Date;
}>;

export async function updateJob(itemId: string, updates: UpdateJobInput): Promise<void> {
  const patch: Record<string, unknown> = { ...updates, updatedAt: serverTimestamp() };
  if (updates.expiresAt) patch.expiresAt = Timestamp.fromDate(updates.expiresAt);
  await updateDoc(doc(db, COMMUNITY, itemId), stripUndefined(patch));
}

export async function deleteJob(itemId: string): Promise<void> {
  try {
    const snap = await getDoc(doc(db, COMMUNITY, itemId));
    if (snap.exists()) {
      const data = snap.data() as CommunityItem;
      await Promise.all(
        (data.images ?? []).map((url) => deleteCommunityImageByUrl(url).catch(() => {})),
      );
    }
  } catch {
    // ignore
  }
  await deleteDoc(doc(db, COMMUNITY, itemId));
}

/** 이미지 업로드 — community/{itemIdOrTemp}/{filename} */
export async function uploadCommunityImage(itemIdOrTemp: string, file: File): Promise<string> {
  file = await compressImageForUpload(file);
  if (file.size > MAX_IMAGE_BYTES) throw new Error('사진 용량이 커서 업로드할 수 없습니다. 더 작은 사진(JPG 권장)으로 다시 시도해 주세요.');
  if (!file.type.startsWith('image/')) throw new Error('이미지 파일만 업로드 가능합니다');
  const id = `img_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `community/${itemIdOrTemp}/${id}.${ext}`;
  const fileRef = storageRef(storage, path);
  await uploadBytes(fileRef, file, { contentType: file.type });
  return await getDownloadURL(fileRef);
}

export async function deleteCommunityImageByUrl(url: string): Promise<void> {
  try {
    await deleteObject(storageRef(storage, url));
  } catch {
    // ignore
  }
}

/** 인덱스 페이지 카운트 — 오늘(24h 안) 등록된 활성 구인 N건. UI 뱃지용. */
export async function countTodayActiveJobs(): Promise<number> {
  try {
    const since = Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000);
    const q = query(
      collection(db, COMMUNITY),
      where('type', '==', 'jobOffer'),
      where('status', '==', 'active'),
      where('createdAt', '>=', since),
    );
    const snap = await getCountFromServer(q);
    return snap.data().count;
  } catch {
    return 0;
  }
}

// 단순 fetch — 페이지 mount 시 1회 (실시간 X), getDocs 결과만 필요한 경우용
export async function loadActiveJobsOnce(maxItems = 50): Promise<JobOffer[]> {
  const q = query(
    collection(db, COMMUNITY),
    where('type', '==', 'jobOffer'),
    orderBy('createdAt', 'desc'),
    limit(maxItems),
  );
  const snap = await getDocs(q);
  const now = Date.now();
  return snap.docs
    .map((d) => fromDoc(d.id, d.data()) as JobOffer)
    .filter((j) => {
      if (j.status === 'closed') return false;
      if (j.expiresAt && new Date(j.expiresAt).getTime() <= now) return false;
      return true;
    });
}

// ─────────────────────────────────────────────────────────────
// dealerProfile CRUD (v0.2 — 부모 에이전트가 Firestore 연결)
// ─────────────────────────────────────────────────────────────

/**
 * 활성 딜러 프로필 실시간 구독 — 모바일 리스트용.
 * PLACEHOLDER: 빈 배열 반환. 부모 에이전트가 실 Firestore 연동으로 교체.
 */
export function subscribeActiveDealerProfiles(
  _filter: { region?: string; availableShift?: AvailableShift },
  onChange: (items: DealerProfile[]) => void,
  onError: (e: Error) => void,
): () => void {
  try {
    const q = query(
      collection(db, COMMUNITY),
      where('type', '==', 'dealerProfile'),
      where('status', '==', 'active'),
      orderBy('createdAt', 'desc'),
      limit(50),
    );
    return onSnapshot(
      q,
      (snap) => onChange(snap.docs.map((d) => fromDoc(d.id, d.data()) as DealerProfile)),
      (e) => onError(e as Error),
    );
  } catch {
    onChange([]);
    return () => {};
  }
}

/**
 * 공개 딜러 프로필만 — 일반 사용자 /m/community/dealers 리스트용 (2026-05-26 절충).
 * publicProfile=true 토글한 딜러만 노출. 매장 owner는 subscribeAllDealerProfiles로 전체 조회.
 *
 * 클라이언트 사이드 필터로 처리 (publicProfile 인덱스 별도 신설 미필요 — 전체 active 100건 한도).
 */
export function subscribePublicDealerProfiles(
  filter: { region?: string; availableShift?: AvailableShift },
  onChange: (items: DealerProfile[]) => void,
  onError: (e: Error) => void,
): () => void {
  try {
    const q = query(
      collection(db, COMMUNITY),
      where('type', '==', 'dealerProfile'),
      where('status', '==', 'active'),
      orderBy('createdAt', 'desc'),
      limit(100),
    );
    return onSnapshot(
      q,
      (snap) => {
        let items = snap.docs
          .map((d) => fromDoc(d.id, d.data()) as DealerProfile)
          .filter((p) => p.publicProfile === true);
        if (filter.region) {
          const kw = filter.region.trim().toLowerCase();
          items = items.filter((p) => p.region?.toLowerCase().includes(kw));
        }
        if (filter.availableShift) {
          items = items.filter((p) => p.availableShifts?.includes(filter.availableShift!));
        }
        onChange(items);
      },
      (e) => onError(e as Error),
    );
  } catch {
    onChange([]);
    return () => {};
  }
}

/** 단일 딜러 프로필 실시간 구독 */
export function subscribeDealerProfile(
  itemId: string,
  onChange: (item: DealerProfile | null) => void,
  onError: (e: Error) => void,
): () => void {
  return onSnapshot(
    doc(db, COMMUNITY, itemId),
    (snap) => {
      if (!snap.exists()) { onChange(null); return; }
      onChange(fromDoc(snap.id, snap.data()) as DealerProfile);
    },
    (e) => onError(e as Error),
  );
}

/** 본인 딜러 프로필 1건 조회 — authorId == uid */
export async function loadOwnDealerProfile(uid: string): Promise<DealerProfile | null> {
  try {
    const q = query(
      collection(db, COMMUNITY),
      where('type', '==', 'dealerProfile'),
      where('authorUid', '==', uid),
      limit(1),
    );
    const snap = await getDocs(q);
    if (snap.empty) return null;
    return fromDoc(snap.docs[0].id, snap.docs[0].data()) as DealerProfile;
  } catch {
    return null;
  }
}

export interface CreateDealerProfileInput {
  authorUid: string;
  displayName: string;
  abilities: DealerAbility[];
  experienceLevel: ExperienceLevel;
  availableShifts: AvailableShift[];
  bio: string;
  careerHistory?: string;
  region?: string;
  contact: { phone?: string; kakaoOpenChat?: string };
  profileImageUrl?: string;
  age?: number;
  gender?: DealerGender;
  residence?: string;
  privacyConsent?: boolean;
  /** 일반 사용자 공개 여부 (디폴트 false — 매장 owner 전용) */
  publicProfile?: boolean;
}

export async function createDealerProfile(input: CreateDealerProfileInput): Promise<string> {
  const ref = await addDoc(collection(db, COMMUNITY), stripUndefined({
    type: 'dealerProfile',
    title: `${input.displayName} 딜러`,
    body: input.bio,
    displayName: input.displayName,
    abilities: input.abilities,
    experienceLevel: input.experienceLevel,
    availableShifts: input.availableShifts,
    bio: input.bio,
    careerHistory: input.careerHistory ?? '',
    region: input.region ?? '',
    contact: { phone: input.contact.phone ?? '', kakaoOpenChat: input.contact.kakaoOpenChat ?? '' },
    profileImageUrl: input.profileImageUrl ?? '',
    ...(input.age !== undefined ? { age: input.age } : {}),
    ...(input.gender ? { gender: input.gender } : {}),
    ...(input.residence ? { residence: input.residence } : {}),
    privacyConsent: input.privacyConsent ?? false,
    publicProfile: input.publicProfile ?? false,
    status: 'active' as CommunityItemStatus,
    flagCount: 0,
    authorType: 'user',
    authorUid: input.authorUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }));
  return ref.id;
}

export type UpdateDealerProfileInput = Partial<Omit<CreateDealerProfileInput, 'authorUid'>>;

export async function updateDealerProfile(itemId: string, updates: UpdateDealerProfileInput): Promise<void> {
  const patch: Record<string, unknown> = { ...updates, updatedAt: serverTimestamp() };
  if (updates.bio) patch.body = updates.bio;
  if (updates.displayName) patch.title = `${updates.displayName} 딜러`;
  await updateDoc(doc(db, COMMUNITY, itemId), stripUndefined(patch));
}

/**
 * 본인 딜러 프로필 게시 상태 토글.
 * - 'closed': 취직 완료 등으로 글 내림 (매장 어드민 active 목록에서 숨겨짐)
 * - 'active': 다시 게시
 *
 * 데이터는 보존하므로 나중에 다시 활성화 가능.
 * Firestore rules의 update 권한(작성자 본인)으로 차단됨.
 */
export async function setDealerProfileStatus(
  itemId: string,
  status: CommunityItemStatus,
): Promise<void> {
  await updateDoc(doc(db, COMMUNITY, itemId), {
    status,
    updatedAt: serverTimestamp(),
  });
}

/** 본인 딜러 프로필 완전 삭제 — 되돌릴 수 없음. */
export async function deleteDealerProfile(itemId: string): Promise<void> {
  await deleteDoc(doc(db, COMMUNITY, itemId));
}

/**
 * 매장 owner 전용 — 전체 딜러 프로필 실시간 구독.
 * 인덱스: type='dealerProfile' + status='active' + createdAt desc (이미 deploy됨)
 */
export function subscribeAllDealerProfiles(
  filter: { ability?: DealerAbility; experienceLevel?: ExperienceLevel; regionKeyword?: string },
  onChange: (items: DealerProfile[]) => void,
  onError: (e: Error) => void,
): () => void {
  try {
    const q = query(
      collection(db, COMMUNITY),
      where('type', '==', 'dealerProfile'),
      where('status', '==', 'active'),
      orderBy('createdAt', 'desc'),
      limit(100),
    );
    return onSnapshot(
      q,
      (snap) => {
        let items = snap.docs.map((d) => fromDoc(d.id, d.data()) as DealerProfile);
        if (filter.ability) {
          items = items.filter((p) => p.abilities?.includes(filter.ability!));
        }
        if (filter.experienceLevel) {
          items = items.filter((p) => p.experienceLevel === filter.experienceLevel);
        }
        if (filter.regionKeyword) {
          const kw = filter.regionKeyword.trim().toLowerCase();
          items = items.filter((p) => p.region?.toLowerCase().includes(kw));
        }
        onChange(items);
      },
      (e) => onError(e as Error),
    );
  } catch {
    onChange([]);
    return () => {};
  }
}

/** 딜러 프로필 이미지 업로드 */
export async function uploadDealerImage(uid: string, file: File): Promise<string> {
  return uploadCommunityImage(`dealer_${uid}`, file);
}

/**
 * 커뮤니티 아이템 신고 — reports/{itemId_reporterUid} 멱등.
 * Cloud Function autoHideOnReports가 동일 targetId 신고 3건 누적 시 자동 status='hidden'.
 */
export async function reportCommunityItem(
  itemId: string,
  reporterUid: string,
  reason: 'spam' | 'offensive' | 'misinformation' | 'advertising' | 'other',
  detail?: string,
): Promise<void> {
  if (!itemId || !reporterUid) throw new Error('itemId·reporterUid는 필수입니다');
  const reportId = `${itemId}_${reporterUid}`;
  const ref = doc(db, 'reports', reportId);
  const existing = await getDoc(ref);
  if (existing.exists()) return;
  const payload: Record<string, unknown> = {
    targetType: 'community',
    targetId: itemId,
    targetParentPath: `community/${itemId}`,
    reporterUid,
    reason,
    resolved: false,
    createdAt: serverTimestamp(),
  };
  if (detail && detail.trim()) payload.detail = detail.trim().slice(0, 500);
  await setDoc(ref, stripUndefined(payload), { merge: false });
}

/** 이미 신고했는가 검사 — 신고 버튼 비활성화용 */
export async function hasReportedCommunityItem(itemId: string, uid: string): Promise<boolean> {
  if (!itemId || !uid) return false;
  try {
    const snap = await getDoc(doc(db, 'reports', `${itemId}_${uid}`));
    return snap.exists();
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// 사행성 키워드 필터
// ─────────────────────────────────────────────────────────────
const BANNED_KEYWORDS = ['환금', '베팅', '도박', '현금화', '환전', '캐시게임', '시세보장', '수익보장', '투자가치'];

export function hasBannedKeyword(text: string): boolean {
  return BANNED_KEYWORDS.some((kw) => text.includes(kw));
}

/* ── Placeholder 데이터 (개발/시드용 — UI는 실 Firestore 구독을 우선) ── */
export const PLACEHOLDER_JOBS: JobOffer[] = [
  {
    id: 'job-demo-1',
    type: 'jobOffer',
    title: '해운대 에이스클럽 딜러 구인',
    body: '경력 우대, 초보도 교육 가능합니다.\n주 5일 고정 시프트, 복지 좋아요.\n카톡으로 편하게 연락 주세요!',
    region: '부산 해운대구',
    contact: { kakaoOpenChat: 'https://open.kakao.com/example', phone: '051-123-4567' },
    status: 'active',
    createdAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
    authorType: 'store',
    authorUid: 'store-owner-uid-1',
    storeId: 'store-demo-1',
    storeName: '에이스클럽 해운대',
    role: 'dealer',
    wage: { type: 'hourly', amount: 12000, currency: 'KRW' },
    shift: ['weekday', 'fulltime'],
  },
  {
    id: 'job-demo-2',
    type: 'jobOffer',
    title: '서면 로얄홀덤 플로어 구인',
    body: '나이 무관, 성실하신 분 환영합니다.\n주말 포함 주 3~4일 근무 가능하신 분.\n자세한 내용은 전화 문의 주세요.',
    region: '부산 부산진구',
    contact: { phone: '051-987-6543' },
    status: 'active',
    createdAt: new Date(Date.now() - 26 * 3_600_000).toISOString(),
    authorType: 'store',
    authorUid: 'store-owner-uid-2',
    storeId: 'store-demo-2',
    storeName: '로얄홀덤 서면',
    role: 'floor',
    wage: { type: 'negotiable', currency: 'KRW' },
    shift: ['weekend', 'parttime'],
  },
];

export const PLACEHOLDER_DEALERS: DealerProfile[] = [
  {
    id: 'dealer-demo-1',
    type: 'dealerProfile',
    title: '김지훈 딜러',
    body: '부산 홀덤 경력 5년차 딜러입니다. 토너먼트 운영 전문이며 야간 근무 가능합니다.',
    displayName: '김지훈',
    abilities: ['tournament', 'tournamentExp'],
    experienceLevel: 'y3to5',
    availableShifts: ['weekday', 'w5to6'],
    bio: '부산 홀덤 경력 5년차 딜러입니다. 토너먼트 운영 전문이며 야간 근무 가능합니다.',
    careerHistory: '에이스클럽 해운대 (2021~2024)\n로얄홀덤 서면 (2019~2021)',
    region: '부산 해운대구, 부산진구 일대',
    contact: { kakaoOpenChat: 'https://open.kakao.com/example' },
    status: 'active',
    createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    authorType: 'user',
    authorUid: 'user-demo-1',
    age: 32,
    gender: 'male',
    residence: '부산 해운대구',
    privacyConsent: true,
  },
  {
    id: 'dealer-demo-2',
    type: 'dealerProfile',
    title: '박소연 딜러',
    body: '3년 경력 딜러입니다. 대회 운영 경험 보유, 주말 상시 가능합니다.',
    displayName: '박소연',
    abilities: ['tournamentExp', 'managerExp'],
    experienceLevel: 'y2to3',
    availableShifts: ['weekend', 'w3to4'],
    bio: '3년 경력 딜러입니다. 대회 운영 경험 보유, 주말 상시 가능합니다.',
    region: '부산 부산진구, 남구 일대',
    contact: { phone: '010-0000-0000' },
    status: 'active',
    createdAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
    authorType: 'user',
    authorUid: 'user-demo-2',
    privacyConsent: false,
  },
];

