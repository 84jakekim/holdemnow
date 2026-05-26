/**
 * /platform/seed-youtubers — 1회성 한국 홀덤 인기 유튜버 시드 등록.
 *
 * PM 큐레이션 결과(2026-05-26 기준 활성도+규모 검증):
 *   1. 어수홀덤TV          (16.1만)  — 압도적 1위, 실시간 홀덤
 *   2. 윤슬 홀덤 TV          (3.71만)  — 한국 합법 강조 라이브
 *   3. WPL TV : e것이 홀덤이다 (2.21만)  — 토너먼트 방송
 *   4. 쩡이홀덤(JDEUCE)      (1.37만)  — 시청자 친화 라이브
 *   5. 홀덤파이터 하호성       (8.87k)  — 실전 플레이어
 *
 * 사용법: platform_admin 로그인 후 이 페이지 방문 → '시드 실행' 버튼 클릭.
 * 이미 같은 channelId가 있으면 skip (중복 등록 방지).
 */

'use client';

import { useState } from 'react';
import {
  collection,
  getDocs,
  query,
  where,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { httpsCallable, getFunctions } from 'firebase/functions';
import { db, app } from '@/lib/firebase';

interface SeedChannel {
  channelId: string;
  channelName: string;
  channelUrl: string;
  description: string;
  order: number;
}

const SEED_CHANNELS: SeedChannel[] = [
  {
    channelId: 'UCg7Z47vL_8PJV9IGNAlH9JA',
    channelName: '어수홀덤TV',
    channelUrl: 'https://www.youtube.com/@eosootv',
    description: '16.1만 구독 — 한국 실시간 홀덤 콘텐츠 1위 채널',
    order: 1,
  },
  {
    channelId: 'UC1AwVs42MORzG44MTtKcYOQ',
    channelName: '윤슬 홀덤 TV',
    channelUrl: 'https://www.youtube.com/channel/UC1AwVs42MORzG44MTtKcYOQ',
    description: '3.7만 구독 — 한국 합법 라이브 홀덤 방송',
    order: 2,
  },
  {
    channelId: 'UC2gX_7N442lhjeLi9w5aqEw',
    channelName: 'WPL TV : e것이 홀덤이다',
    channelUrl: 'https://www.youtube.com/@wpltv_official',
    description: '2.2만 구독 — WPL 토너먼트 공식 방송',
    order: 3,
  },
  {
    channelId: 'UCTIqeGJqL3EJBBY4si011dg',
    channelName: '쩡이홀덤(JDEUCE)',
    channelUrl: 'https://www.youtube.com/@jdeucetv',
    description: '1.3만 구독 — 시청자와 함께하는 라이브/쇼츠',
    order: 4,
  },
  {
    channelId: 'UCDlvK9xOY-R0HqxeX35GiPQ',
    channelName: '홀덤파이터 하호성',
    channelUrl: 'https://www.youtube.com/@hahoseong',
    description: '8.8k 구독 — 실전 홀덤 플레이어 채널',
    order: 5,
  },
];

interface ResultRow {
  channelName: string;
  status: 'inserted' | 'skipped' | 'error';
  message: string;
}

export default function SeedYoutubersPage() {
  const [seeding, setSeeding] = useState(false);
  const [results, setResults] = useState<ResultRow[] | null>(null);
  const [triggerMsg, setTriggerMsg] = useState<string | null>(null);
  const [triggering, setTriggering] = useState(false);

  const handleSeed = async () => {
    if (!window.confirm('한국 홀덤 인기 유튜버 5개 채널을 등록합니다. 진행할까요?')) return;
    setSeeding(true);
    setResults(null);
    const out: ResultRow[] = [];
    for (const ch of SEED_CHANNELS) {
      try {
        // 중복 검사 — channelId 기준
        const dupSnap = await getDocs(
          query(collection(db, 'hotYoutubers'), where('channelId', '==', ch.channelId)),
        );
        if (!dupSnap.empty) {
          out.push({
            channelName: ch.channelName,
            status: 'skipped',
            message: `이미 등록됨 (doc: ${dupSnap.docs[0].id})`,
          });
          continue;
        }
        const docRef = await addDoc(collection(db, 'hotYoutubers'), {
          channelId: ch.channelId,
          channelName: ch.channelName,
          channelUrl: ch.channelUrl,
          avatarUrl: '',
          description: ch.description,
          order: ch.order,
          isActive: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        out.push({
          channelName: ch.channelName,
          status: 'inserted',
          message: `doc: ${docRef.id}`,
        });
      } catch (e: unknown) {
        out.push({
          channelName: ch.channelName,
          status: 'error',
          message: (e as Error).message,
        });
      }
    }
    setResults(out);
    setSeeding(false);
  };

  const handleTrigger = async () => {
    if (!window.confirm('전체 슬롯 큐레이션을 지금 실행할까요? YouTube API 쿼터를 소모합니다.')) return;
    setTriggering(true);
    setTriggerMsg(null);
    try {
      const functions = getFunctions(app, 'asia-northeast3');
      const fn = httpsCallable<
        { slot?: 1 | 2 | 3 },
        {
          upserted: number;
          expiredDeleted: number;
          durationMs: number;
          slots?: Array<{ slot: number; upserted: number; pickedTitle?: string | null; message?: string | null }>;
        }
      >(functions, 'triggerYoutubeCurationNow');
      const res = await fn({});
      const d = res.data;
      const summary = (d.slots ?? [])
        .map((s) => `슬롯${s.slot}: ${s.upserted > 0 ? '✓ ' + (s.pickedTitle ?? '갱신') : (s.message ?? '갱신 없음')}`)
        .join(' | ');
      setTriggerMsg(`완료 — upserted=${d.upserted}, deleted=${d.expiredDeleted}, ${d.durationMs}ms\n${summary}`);
    } catch (e: unknown) {
      setTriggerMsg(`에러: ${(e as Error).message}`);
    } finally {
      setTriggering(false);
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto" style={{ color: 'var(--text-1)' }}>
      <h1 className="text-xl font-bold mb-2">한국 홀덤 유튜버 시드 등록</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text-3)' }}>
        2026-05-26 기준 활성도·규모를 검증한 5개 채널을 hotYoutubers 컬렉션에 일괄 등록합니다.
        중복(channelId 일치)은 자동 skip.
      </p>

      <div className="space-y-2 mb-6">
        {SEED_CHANNELS.map((ch) => (
          <div
            key={ch.channelId}
            className="p-3 rounded-xl border text-sm"
            style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
          >
            <div className="font-bold">{ch.order}. {ch.channelName}</div>
            <div className="text-xs" style={{ color: 'var(--text-3)' }}>{ch.description}</div>
            <div className="text-xs mt-1" style={{ color: 'var(--text-4)' }}>
              {ch.channelUrl} · {ch.channelId}
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-3 mb-6">
        <button
          onClick={handleSeed}
          disabled={seeding}
          className="px-4 py-2.5 bg-amber-500 text-white rounded-xl text-sm font-bold hover:bg-amber-600 disabled:opacity-40"
        >
          {seeding ? '등록 중…' : '1) 시드 실행 (5개 등록)'}
        </button>
        <button
          onClick={handleTrigger}
          disabled={triggering}
          className="px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 disabled:opacity-40"
        >
          {triggering ? '실행 중…' : '2) 첫 큐레이션 트리거'}
        </button>
      </div>

      {results && (
        <div className="mb-4 p-4 rounded-xl border" style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}>
          <div className="font-bold mb-2 text-sm">등록 결과</div>
          {results.map((r, i) => (
            <div key={i} className="text-xs mb-1">
              {r.status === 'inserted' && <span className="text-green-500">[추가]</span>}
              {r.status === 'skipped' && <span className="text-amber-500">[스킵]</span>}
              {r.status === 'error' && <span className="text-red-500">[에러]</span>}
              {' '}
              {r.channelName} — {r.message}
            </div>
          ))}
        </div>
      )}

      {triggerMsg && (
        <div className="p-4 rounded-xl border whitespace-pre-wrap text-xs" style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}>
          {triggerMsg}
        </div>
      )}
    </div>
  );
}
