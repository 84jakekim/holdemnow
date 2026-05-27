'use client';

/**
 * 사용자 ↔ 본사 1:1 문의 시스템 (2026-05-27 신설)
 *
 * 데이터 모델:
 *   inquiries/{id}
 *     uid, userEmail, userDisplayName
 *     category, title, body, status
 *     adminReply (답변)
 *     createdAt, updatedAt
 *
 * 권한:
 *   - create: 본인만
 *   - read: 본인 + platform_admin
 *   - update: platform_admin만 (adminReply 작성)
 */

import {
  collection,
  doc,
  setDoc,
  updateDoc,
  serverTimestamp,
  query,
  where,
  orderBy,
  onSnapshot,
  type Timestamp,
} from 'firebase/firestore';
import { db } from './firebase';

export type InquiryCategory = 'account' | 'reservation' | 'live' | 'community' | 'bug' | 'feature' | 'etc';

export const INQUIRY_CATEGORY_LABEL: Record<InquiryCategory, string> = {
  account: '계정·로그인',
  reservation: '예약',
  live: 'LIVE / 토너',
  community: '커뮤니티',
  bug: '오류 신고',
  feature: '기능 제안',
  etc: '기타',
};

export type InquiryStatus = 'pending' | 'answered' | 'closed';

export interface AdminReply {
  body: string;
  repliedBy: string;
  repliedByName: string;
  repliedAt: Timestamp;
}

export interface Inquiry {
  id: string;
  uid: string;
  userEmail: string;
  userDisplayName: string;
  category: InquiryCategory;
  title: string;
  body: string;
  status: InquiryStatus;
  adminReply?: AdminReply;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

const COLL = 'inquiries';

/** 새 문의 생성 (사용자) */
export async function createInquiry(input: {
  uid: string;
  userEmail: string;
  userDisplayName: string;
  category: InquiryCategory;
  title: string;
  body: string;
}): Promise<string> {
  const id = doc(collection(db, COLL)).id;
  await setDoc(doc(db, COLL, id), {
    uid: input.uid,
    userEmail: input.userEmail || '',
    userDisplayName: input.userDisplayName || '',
    category: input.category,
    title: input.title.slice(0, 80),
    body: input.body.slice(0, 2000),
    status: 'pending' as InquiryStatus,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return id;
}

/** 본인 문의 목록 구독 */
export function subscribeMyInquiries(
  uid: string,
  cb: (items: Inquiry[]) => void,
  onError?: (e: Error) => void,
): () => void {
  const q = query(collection(db, COLL), where('uid', '==', uid), orderBy('createdAt', 'desc'));
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Inquiry, 'id'>) }))),
    (e) => onError?.(e),
  );
}

/** 전체 문의 목록 구독 (본사 어드민) */
export function subscribeAllInquiries(
  cb: (items: Inquiry[]) => void,
  onError?: (e: Error) => void,
  filter?: { status?: InquiryStatus },
): () => void {
  const constraints = [];
  if (filter?.status) constraints.push(where('status', '==', filter.status));
  constraints.push(orderBy('createdAt', 'desc'));
  const q = query(collection(db, COLL), ...constraints);
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Inquiry, 'id'>) }))),
    (e) => onError?.(e),
  );
}

/** 본사 답변 작성 + 상태 'answered'로 변경 */
export async function replyToInquiry(
  inquiryId: string,
  reply: { body: string; repliedBy: string; repliedByName: string },
): Promise<void> {
  await updateDoc(doc(db, COLL, inquiryId), {
    adminReply: {
      body: reply.body.slice(0, 4000),
      repliedBy: reply.repliedBy,
      repliedByName: reply.repliedByName,
      repliedAt: serverTimestamp(),
    },
    status: 'answered',
    updatedAt: serverTimestamp(),
  });
}

/** 상태 변경 (close 등) */
export async function setInquiryStatus(
  inquiryId: string,
  status: InquiryStatus,
): Promise<void> {
  await updateDoc(doc(db, COLL, inquiryId), {
    status,
    updatedAt: serverTimestamp(),
  });
}

// ──────────────────────────────────────────────────────
// FAQ (정적 — v0.5에 Firestore 이관 검토)
// ──────────────────────────────────────────────────────

export interface FaqItem {
  id: string;
  category: InquiryCategory;
  question: string;
  answer: string;
}

export const FAQ_LIST: FaqItem[] = [
  {
    id: 'login-kakao',
    category: 'account',
    question: '카카오 로그인이 안 되는데 어떻게 해야 하나요?',
    answer:
      '카카오 앱이 설치되어 있고 최신 버전인지 확인하세요. 그래도 안 되면 브라우저 시크릿창에서 다시 시도해보세요. 카카오 측 일시적 오류일 수 있어 1~2분 후 재시도를 권장드립니다.',
  },
  {
    id: 'change-phone',
    category: 'account',
    question: '전화번호를 변경하고 싶어요',
    answer:
      '내 정보 페이지 상단의 프로필 카드를 누르면 정보 수정 시트가 열립니다. 거기서 전화번호를 변경할 수 있어요. 같은 번호로 가입된 다른 계정이 있으면 변경이 차단됩니다.',
  },
  {
    id: 'reservation-cancel',
    category: 'reservation',
    question: '예약 확정 후 취소하려면 어떻게 하나요?',
    answer:
      '확정 전(pending)이면 본인이 직접 취소 가능합니다. 매장이 확정한 후에는 내 예약 페이지에서 "📝 취소 신청"을 누르면 매장에 알림이 가고, 매장이 승인하면 취소 완료됩니다. 사유는 매장이 거절할 수도 있어요.',
  },
  {
    id: 'reservation-multiple',
    category: 'reservation',
    question: '여러 매장을 동시에 예약할 수 있나요?',
    answer:
      '아니요. 노쇼 방지를 위해 1인 1매장 1예약 정책을 운영합니다. 한 매장에 예약이 active 상태(pending 또는 confirmed)면 다른 매장 예약이 자동 차단됩니다. 입장시간 + 2시간 경과 또는 체크인 완료 시 자동 해제됩니다.',
  },
  {
    id: 'live-notification',
    category: 'live',
    question: '즐겨찾기 매장에서 LIVE가 시작되면 알림이 오나요?',
    answer:
      '네. 매장을 즐겨찾기에 추가하면 그 매장이 LIVE를 시작할 때 자동으로 푸시 알림이 옵니다. 내 정보 > 알림 설정에서 "즐겨찾기 매장 LIVE 시작" 토글이 ON인지 확인하세요.',
  },
  {
    id: 'live-late-reg',
    category: 'live',
    question: '관심 토너의 늦은 등록 마감 알림은 언제 와요?',
    answer:
      '관심 토너로 등록한 토너의 늦은 등록(Late Reg)이 30분 남았을 때 자동 푸시가 옵니다. 토너 시작 1시간 전에도 별도 알림이 오니, 미리 출발 준비에 활용하세요.',
  },
  {
    id: 'checkin',
    category: 'live',
    question: '매장에 도착해서 체크인하면 어떤 효과가 있나요?',
    answer:
      '체크인하면 홈의 "지금 다녀온 사람들" 섹션에 본인 카드가 24시간 노출됩니다. 한 줄 후기를 적으면 다른 사용자에게도 보입니다. 같은 매장 예약이 active면 체크인 시 예약이 자동 완료 처리되어 다른 매장 예약을 다시 할 수 있게 됩니다.',
  },
  {
    id: 'community-jobs',
    category: 'community',
    question: '구인 공고에 지원하려면 어떻게 하나요?',
    answer:
      '커뮤니티 > 구인 탭에서 공고를 누르면 상세 페이지로 이동합니다. 지원 버튼은 매장 사장님이 등록한 연락처(전화/카카오톡 오픈채팅)로 직접 연락하는 방식입니다. 본인 이력서를 미리 등록해두면 매장에서 먼저 연락드릴 수도 있어요.',
  },
  {
    id: 'community-dealer-resume',
    category: 'community',
    question: '제 이력서가 다른 사용자에게도 보이나요?',
    answer:
      '아니요. 구직 이력서는 사용자 앱에는 공개되지 않습니다. 매장 어드민과 본사 어드민에서만 열람 가능하며, 매장이 직접 연락드립니다. 전화번호 등 개인정보는 매장이 "연락" 요청 시에만 본사 승인 후 전달됩니다 (v0.5+).',
  },
  {
    id: 'app-update',
    category: 'bug',
    question: '앱이 이상하게 동작하거나 화면이 멈춰요',
    answer:
      '먼저 브라우저를 강제 새로고침(Ctrl+Shift+R 또는 손가락 2번 새로고침)해보세요. 그래도 안 되면 시크릿창에서 접속해보시고, 그래도 문제가 지속되면 이 페이지 하단의 1:1 문의로 상황을 보내주세요. 어떤 페이지에서 어떤 버튼을 눌렀을 때 발생했는지 적어주시면 빠르게 확인됩니다.',
  },
  {
    id: 'feature-request',
    category: 'feature',
    question: '새로운 기능을 제안하고 싶어요',
    answer:
      '환영합니다! 하단 1:1 문의에 카테고리 "기능 제안"으로 보내주세요. 본사가 모든 제안을 검토하고 필요한 경우 답변드립니다. 출시 임박이라 즉시 반영이 어려울 수 있지만 v0.5+ 로드맵에 우선 포함됩니다.',
  },
  {
    id: 'notification-permission',
    category: 'account',
    question: '푸시 알림이 안 와요',
    answer:
      '내 정보 > 알림 설정에서 알림 권한을 확인하세요. 브라우저 차단 상태이면 주소창 좌측 자물쇠 아이콘 → 알림 → 허용으로 변경하세요. iOS는 홈 화면 추가 후 PWA로 실행해야 푸시가 도착합니다.',
  },
];
