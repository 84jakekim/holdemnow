'use client';

/**
 * /platform/prereg — 사전등록 현황 (본사 총괄)
 *
 * 랜딩페이지(/landing)로 유입되는 사전등록을 한 곳에서 관리·분석:
 *   - 매장 사전등록: stores 컬렉션(데모 제외 = 실제 신청). 매장명·주소·대표자·연락처·사업자번호·상태
 *   - 출시알림 신청: preRegLeads 컬렉션(랜딩 "출시 알림" 폼). 매장명·연락처
 *
 * 구성:
 *   1) 대시보드 — KPI 4종 + 일별 신규 추이 + 매장 심사 상태 분포 + 유저 대기 매장 TOP + 지역 분포
 *   2) DB 테이블 — 탭(매장 / 유저), CSV 내보내기
 *
 * 사이드이펙트: 로드 시 meta/landingStats에 실제 카운트 동기화
 *   → 랜딩 TrustStrip "사전등록 매장 / 출시 대기 유저" 숫자가 실데이터로 실시간 갱신됨.
 *
 * 보안: /platform/* 레이아웃이 platform_admin 게이팅. preRegLeads read·meta write는 rules에서 본사만 허용.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { collection, onSnapshot, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';

// 매장 사장에게 배포할 사전등록 랜딩 공개 URL.
// 본사 어드민은 별도 호스트(holdemnow-admin)라 window.origin이 랜딩(메인 백엔드)과 다름 → 상수로 고정.
const LANDING_URL = 'https://holdemnow--holdemnow-prod.us-east4.hosted.app/landing';

interface StoreRow {
  id: string;
  name?: string;
  address?: string;
  roadAddress?: string;
  representativeName?: string;
  representativePhone?: string;
  phone?: string;
  businessRegistrationNumber?: string;
  status?: 'pending' | 'active' | 'rejected' | 'suspended' | 'paused' | 'closed';
  isDemo?: boolean;
  regionCode?: string;
  createdAt?: { toDate: () => Date };
}
interface LeadRow {
  id: string;
  storeName?: string;
  phone?: string;
  source?: string;
  createdAt?: { toDate: () => Date };
}

function fmtDate(d?: { toDate: () => Date }): string {
  if (!d?.toDate) return '—';
  const x = d.toDate();
  return `${x.getFullYear()}.${String(x.getMonth() + 1).padStart(2, '0')}.${String(x.getDate()).padStart(2, '0')}`;
}
function dayKey(d: Date): string {
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtDayLabel(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  const wd = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  return `${m}/${d} (${wd})`;
}
// 상대시간 — "방금", "N분 전", "N시간 전", "어제", 그 이상은 날짜
function relTime(d: Date, now: number): string {
  const diff = Math.max(0, now - d.getTime());
  const sec = Math.floor(diff / 1000);
  if (sec < 10) return '방금';
  if (sec < 60) return `${sec}초 전`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  // 같은 달력일 기준으로 "어제" 판별
  const a = new Date(now); const b = new Date(d);
  const dayDelta = Math.round((new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime()
    - new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime()) / 86400000);
  if (dayDelta === 0 && hr < 24) return `${hr}시간 전`;
  if (dayDelta === 1) return '어제';
  if (dayDelta < 7) return `${dayDelta}일 전`;
  return `${b.getMonth() + 1}/${b.getDate()}`;
}

// 연락처 마스킹 — 표시 피드 전용 (원본 테이블·CSV는 풀 노출 유지)
function maskPhone(raw?: string): string {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 7) return raw;
  const head = digits.slice(0, 3);
  const tail = digits.slice(-4);
  return `${head}-****-${tail}`;
}

function downloadCsv(filename: string, rows: (string | number)[][]) {
  const esc = (v: string | number) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export default function PreRegPage() {
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [tab, setTab] = useState<'stores' | 'leads'>('stores');
  const [loaded, setLoaded] = useState({ s: false, l: false });

  // 랜딩 표시 기준값(오프셋) — 표시 = 기준 + 실제
  const [baseStore, setBaseStore] = useState('');
  const [baseLead, setBaseLead] = useState('');
  const [baseSaved, setBaseSaved] = useState({ s: 0, l: 0 });
  const [savingBase, setSavingBase] = useState(false);
  const baseInit = useRef(false);
  const [copied, setCopied] = useState(false);

  // 실시간성 — 마지막 스냅샷 수신 시각 + 1초 틱(상대시간 표시용)
  const [lastUpdate, setLastUpdate] = useState<number>(Date.now());
  const [nowTick, setNowTick] = useState<number>(Date.now());
  // 직전 스냅샷에 존재하던 피드 항목 id 집합 — 신규 도착 감지(플래시)용
  const seenIds = useRef<Set<string> | null>(null);
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(LANDING_URL);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard 권한 거부 등 — 사용자가 직접 입력란을 선택/복사할 수 있게 fallback (no-op)
    }
  };

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'meta', 'landingStats'), (snap) => {
      const d = snap.exists() ? snap.data() : {};
      const s = Number(d.baseStoreCount ?? 0);
      const l = Number(d.baseLeadCount ?? 0);
      setBaseSaved({ s, l });
      if (!baseInit.current) { setBaseStore(String(s)); setBaseLead(String(l)); baseInit.current = true; }
    }, () => {});
    return unsub;
  }, []);

  const saveBase = async () => {
    setSavingBase(true);
    try {
      await setDoc(doc(db, 'meta', 'landingStats'), {
        baseStoreCount: Math.max(0, parseInt(baseStore || '0', 10) || 0),
        baseLeadCount: Math.max(0, parseInt(baseLead || '0', 10) || 0),
        updatedAt: serverTimestamp(),
      }, { merge: true });
    } finally {
      setSavingBase(false);
    }
  };

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'stores'), (snap) => {
      setStores(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<StoreRow, 'id'>) })));
      setLoaded((p) => ({ ...p, s: true }));
      setLastUpdate(Date.now());
    }, () => setLoaded((p) => ({ ...p, s: true })));
    const u2 = onSnapshot(collection(db, 'preRegLeads'), (snap) => {
      setLeads(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<LeadRow, 'id'>) })));
      setLoaded((p) => ({ ...p, l: true }));
      setLastUpdate(Date.now());
    }, () => setLoaded((p) => ({ ...p, l: true })));
    return () => { u1(); u2(); };
  }, []);

  // 실제 사전등록 매장 = 데모 제외
  const apps = useMemo(() => stores.filter((s) => !s.isDemo), [stores]);

  const stat = useMemo(() => {
    const pending = apps.filter((s) => s.status === 'pending').length;
    const active = apps.filter((s) => s.status === 'active').length;
    const rejected = apps.filter((s) => s.status === 'rejected').length;
    const suspended = apps.filter((s) => (s.status === 'suspended' || s.status === 'paused' || s.status === 'closed')).length;
    return { total: apps.length, pending, active, rejected, suspended };
  }, [apps]);

  // meta/landingStats 동기화 — 랜딩 실시간 카운터 소스
  useEffect(() => {
    if (!loaded.s || !loaded.l) return;
    setDoc(doc(db, 'meta', 'landingStats'), {
      storeCount: apps.length,
      leadCount: leads.length,
      updatedAt: serverTimestamp(),
    }, { merge: true }).catch(() => {});
  }, [loaded.s, loaded.l, apps.length, leads.length]);

  // 일별 신규 추이 (최근 14일)
  const trend = useMemo(() => {
    const days: { key: string; store: number; lead: number }[] = [];
    const idx = new Map<string, number>();
    const now = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now); d.setDate(now.getDate() - i);
      const k = dayKey(d);
      idx.set(k, days.length);
      days.push({ key: k, store: 0, lead: 0 });
    }
    apps.forEach((s) => { const t = s.createdAt?.toDate?.(); if (t) { const i = idx.get(dayKey(t)); if (i != null) days[i].store++; } });
    leads.forEach((l) => { const t = l.createdAt?.toDate?.(); if (t) { const i = idx.get(dayKey(t)); if (i != null) days[i].lead++; } });
    const max = Math.max(1, ...days.map((d) => d.store + d.lead));
    return { days, max };
  }, [apps, leads]);

  // 일자별 가입 신청 집계 (실시간) — 날짜별 매장/유저 건수 + 누적
  const daily = useMemo(() => {
    const map = new Map<string, { store: number; lead: number; ts: number }>();
    const bump = (t: Date | undefined, k: 'store' | 'lead') => {
      if (!t) return;
      const key = ymd(t);
      if (!map.has(key)) map.set(key, { store: 0, lead: 0, ts: new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime() });
      map.get(key)![k]++;
    };
    apps.forEach((s) => bump(s.createdAt?.toDate?.(), 'store'));
    leads.forEach((l) => bump(l.createdAt?.toDate?.(), 'lead'));
    // 오늘은 0건이라도 항상 표시
    const now = new Date();
    const todayKey = ymd(now);
    if (!map.has(todayKey)) map.set(todayKey, { store: 0, lead: 0, ts: new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() });
    // 오름차순 누적 계산 후 최신순 정렬
    const asc = [...map.entries()].sort((a, b) => a[1].ts - b[1].ts);
    const withCum: { key: string; store: number; lead: number; total: number; cum: number }[] = [];
    let running = 0;
    for (const [key, v] of asc) {
      running += v.store + v.lead;
      withCum.push({ key, store: v.store, lead: v.lead, total: v.store + v.lead, cum: running });
    }
    const rows = withCum.reverse();
    const todayRow = rows.find((r) => r.key === todayKey);
    return { rows, todayKey, todayTotal: todayRow ? todayRow.total : 0, grandTotal: running };
  }, [apps, leads]);

  // 유저 대기 매장 TOP (출시알림에서 매장명 빈도)
  const topWanted = useMemo(() => {
    const m = new Map<string, number>();
    leads.forEach((l) => { const n = (l.storeName ?? '').trim(); if (n) m.set(n, (m.get(n) ?? 0) + 1); });
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [leads]);

  // 지역 분포 (매장 regionCode)
  const regions = useMemo(() => {
    const m = new Map<string, number>();
    apps.forEach((s) => { const r = (s.regionCode ?? '기타').trim() || '기타'; m.set(r, (m.get(r) ?? 0) + 1); });
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [apps]);

  // 실시간 접수 피드 — 매장 + 리드 병합, createdAt 역순, 최근 20건
  type FeedItem = { id: string; kind: 'store' | 'lead'; name: string; sub: string; ts: number };
  const feed = useMemo<FeedItem[]>(() => {
    const items: FeedItem[] = [];
    apps.forEach((s) => {
      const t = s.createdAt?.toDate?.();
      if (!t) return;
      const region = (s.regionCode ?? '').trim();
      const ph = maskPhone(s.representativePhone || s.phone);
      const sub = [region, ph].filter(Boolean).join(' · ') || '매장 사전등록';
      items.push({ id: `s_${s.id}`, kind: 'store', name: s.name || '이름 없는 매장', sub, ts: t.getTime() });
    });
    leads.forEach((l) => {
      const t = l.createdAt?.toDate?.();
      if (!t) return;
      const ph = maskPhone(l.phone);
      const sub = ph ? `출시알림 · ${ph}` : '출시알림 신청';
      items.push({ id: `l_${l.id}`, kind: 'lead', name: l.storeName || '관심 매장 미입력', sub, ts: t.getTime() });
    });
    items.sort((a, b) => b.ts - a.ts);
    return items.slice(0, 20);
  }, [apps, leads]);

  // 신규 도착 감지 — 직전 스냅샷에 없던 id를 잠깐 하이라이트(플래시)
  useEffect(() => {
    const currentIds = new Set(feed.map((f) => f.id));
    if (seenIds.current === null) {
      // 최초 마운트분은 플래시하지 않음(전부 신규로 번쩍이는 것 방지)
      seenIds.current = currentIds;
      return;
    }
    const fresh: string[] = [];
    for (const f of feed) if (!seenIds.current.has(f.id)) fresh.push(f.id);
    seenIds.current = currentIds;
    if (fresh.length === 0) return;
    setFlashIds((prev) => {
      const next = new Set(prev);
      fresh.forEach((id) => next.add(id));
      return next;
    });
    const timer = setTimeout(() => {
      setFlashIds((prev) => {
        const next = new Set(prev);
        fresh.forEach((id) => next.delete(id));
        return next;
      });
    }, 2600);
    return () => clearTimeout(timer);
  }, [feed]);

  // 오늘 집중 뷰 — 시간대(0~23시)별 매장/리드 누적 + 어제 같은 시각까지 대비
  const today = useMemo(() => {
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startYesterday = startToday - 86400000;
    const curHour = now.getHours();
    const curMin = now.getMinutes();
    const hours = Array.from({ length: 24 }, () => ({ store: 0, lead: 0 }));
    let todayStore = 0, todayLead = 0;
    let yToNowStore = 0, yToNowLead = 0; // 어제 같은 시각(현재 시:분)까지 누적
    const yCutoff = startYesterday + (curHour * 60 + curMin) * 60000;
    const bump = (t: Date | undefined, k: 'store' | 'lead') => {
      if (!t) return;
      const ms = t.getTime();
      if (ms >= startToday) {
        hours[t.getHours()][k]++;
        if (k === 'store') todayStore++; else todayLead++;
      } else if (ms >= startYesterday && ms <= yCutoff) {
        if (k === 'store') yToNowStore++; else yToNowLead++;
      }
    };
    apps.forEach((s) => bump(s.createdAt?.toDate?.(), 'store'));
    leads.forEach((l) => bump(l.createdAt?.toDate?.(), 'lead'));
    const todayTotal = todayStore + todayLead;
    const yTotal = yToNowStore + yToNowLead;
    const max = Math.max(1, ...hours.map((h) => h.store + h.lead));
    // 증감: 어제 동시각 0건이면 비교 불가 처리
    let deltaPct: number | null = null;
    if (yTotal > 0) deltaPct = Math.round(((todayTotal - yTotal) / yTotal) * 100);
    else if (todayTotal > 0) deltaPct = null; // 어제 0 → %계산 불가, "신규"로 표현
    return { hours, curHour, todayStore, todayLead, todayTotal, yTotal, deltaPct, max };
  }, [apps, leads, nowTick]);

  const exportStores = () => {
    downloadCsv(`사전등록_매장_${Date.now()}.csv`, [
      ['매장명', '주소', '대표자', '연락처', '매장전화', '사업자번호', '상태', '신청일'],
      ...apps.map((s) => [s.name ?? '', s.roadAddress ?? s.address ?? '', s.representativeName ?? '', s.representativePhone ?? '', s.phone ?? '', s.businessRegistrationNumber ?? '', s.status ?? '', fmtDate(s.createdAt)]),
    ]);
  };
  const exportLeads = () => {
    downloadCsv(`출시알림_신청_${Date.now()}.csv`, [
      ['매장명', '연락처', '유입', '신청일'],
      ...leads.map((l) => [l.storeName ?? '', l.phone ?? '', l.source ?? '', fmtDate(l.createdAt)]),
    ]);
  };

  const sortedApps = useMemo(() => [...apps].sort((a, b) => (b.createdAt?.toDate?.()?.getTime() ?? 0) - (a.createdAt?.toDate?.()?.getTime() ?? 0)), [apps]);
  const sortedLeads = useMemo(() => [...leads].sort((a, b) => (b.createdAt?.toDate?.()?.getTime() ?? 0) - (a.createdAt?.toDate?.()?.getTime() ?? 0)), [leads]);

  return (
    <div>
      {/* 라이브 인디케이터 + 상대 갱신시간 애니메이션 (전역 keyframes 1회 주입) */}
      <style>{`
        @keyframes prereg-pulse { 0%{transform:scale(1);opacity:1} 70%{transform:scale(2.6);opacity:0} 100%{transform:scale(2.6);opacity:0} }
        @keyframes prereg-flash { 0%{background:rgba(245,158,11,0.28)} 100%{background:transparent} }
        @keyframes prereg-countpulse { 0%{transform:scale(1)} 35%{transform:scale(1.18)} 100%{transform:scale(1)} }
      `}</style>

      <div className="mb-6 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="section-title" style={{ color: 'var(--gold)' }}>PRE-REGISTRATION</div>
          <h1 className="h2" style={{ color: 'var(--text-1)' }}>📝 사전등록 현황</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-2)' }}>랜딩페이지 유입 — 매장 사전등록 · 출시알림 신청 통합 관리</p>
        </div>
        <div className="flex items-center gap-2 rounded-full px-3 py-1.5"
          style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
          <span style={{ position: 'relative', display: 'inline-flex', width: 9, height: 9 }}>
            <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: '#10B981', animation: 'prereg-pulse 1.8s ease-out infinite' }} />
            <span style={{ position: 'relative', width: 9, height: 9, borderRadius: '50%', background: '#10B981' }} />
          </span>
          <span className="text-[11px] font-extrabold tracking-wider" style={{ color: '#10B981' }}>LIVE</span>
          <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>· 마지막 갱신 {relTime(new Date(lastUpdate), nowTick)}</span>
        </div>
      </div>

      {/* 사전등록 링크 — 매장 사장에게 배포 */}
      <div className="rounded-xl p-4 mb-6" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
        <div className="text-xs font-extrabold" style={{ color: 'var(--text-2)' }}>🔗 사전등록 링크</div>
        <div className="text-[11px] mt-1 mb-3" style={{ color: 'var(--text-3)' }}>
          매장 사장님께 이 링크를 보내 사전등록을 받으세요. (카톡·문자 등에 붙여넣기)
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            readOnly
            value={LANDING_URL}
            onFocus={(e) => e.currentTarget.select()}
            className="mono"
            style={{ flex: 1, minWidth: 240, padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-1)', fontSize: 12.5 }}
          />
          <button
            onClick={copyLink}
            className="px-4 py-2 rounded-lg text-sm font-extrabold transition"
            style={{ background: copied ? '#10B981' : 'var(--gold)', color: '#0F1419' }}
          >
            {copied ? '✓ 복사됨' : '📋 링크 복사'}
          </button>
          <a
            href={LANDING_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 rounded-lg text-sm font-bold"
            style={{ background: 'var(--surface-2)', color: 'var(--text-1)', border: '1px solid var(--border)' }}
          >
            열기 ↗
          </a>
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Kpi label="사전등록 매장" value={stat.total} tone="var(--gold)" />
        <Kpi label="심사 대기" value={stat.pending} tone="#F59E0B" />
        <Kpi label="승인 완료" value={stat.active} tone="#10B981" />
        <Kpi label="출시알림 신청" value={leads.length} tone="#FF1F8F" />
      </div>

      {/* 실시간 2열: 오늘 집중 뷰 + 실시간 접수 피드 */}
      <div className="grid lg:grid-cols-2 gap-4 mb-6">
        {/* 오늘 집중 뷰 — 시간대별 막대 + 어제 동시각 대비 */}
        <div className="rounded-xl p-4" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
          <div className="flex items-end justify-between mb-3 flex-wrap gap-2">
            <div>
              <div className="text-xs font-extrabold" style={{ color: 'var(--text-2)' }}>⏱️ 오늘 접수 (시간대별)</div>
              <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>0~23시 매장·출시알림 누적</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] font-bold" style={{ color: 'var(--text-3)' }}>오늘 합계</div>
              <div className="flex items-baseline gap-2 justify-end">
                <span key={today.todayTotal} className="text-2xl font-extrabold mono"
                  style={{ color: 'var(--gold)', display: 'inline-block', animation: 'prereg-countpulse 0.5s ease-out' }}>
                  {today.todayTotal}
                </span>
                <DeltaBadge todayTotal={today.todayTotal} yTotal={today.yTotal} deltaPct={today.deltaPct} />
              </div>
            </div>
          </div>
          {today.todayTotal === 0 ? (
            <div className="flex flex-col items-center justify-center text-center" style={{ height: 132 }}>
              <div style={{ fontSize: 26, opacity: 0.5 }}>🌱</div>
              <div className="text-xs font-bold mt-1" style={{ color: 'var(--text-2)' }}>오늘 첫 접수를 기다리는 중</div>
              <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>접수가 들어오면 실시간으로 표시됩니다</div>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 120, marginTop: 6 }}>
                {today.hours.map((h, i) => {
                  const total = h.store + h.lead;
                  const ht = (total / today.max) * 100;
                  const isCur = i === today.curHour;
                  return (
                    <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}
                      title={`${i}시 · 매장 ${h.store} · 출시알림 ${h.lead}`}>
                      <div style={{ width: '100%', height: `${ht}%`, minHeight: total > 0 ? 4 : 0, borderRadius: 3, overflow: 'hidden', display: 'flex', flexDirection: 'column-reverse', background: 'var(--surface-2)', outline: isCur ? '1px solid var(--gold)' : 'none' }}>
                        <div style={{ height: `${total ? (h.store / total) * 100 : 0}%`, background: 'var(--gold)' }} />
                        <div style={{ height: `${total ? (h.lead / total) * 100 : 0}%`, background: '#FF1F8F' }} />
                      </div>
                      {i % 6 === 0 && <div style={{ fontSize: 8, color: 'var(--text-3)' }}>{i}시</div>}
                    </div>
                  );
                })}
              </div>
              <Legend items={[{ c: 'var(--gold)', l: `매장 ${today.todayStore}` }, { c: '#FF1F8F', l: `출시알림 ${today.todayLead}` }]} />
            </>
          )}
        </div>

        {/* 실시간 접수 피드 */}
        <div className="rounded-xl p-4" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2 mb-3">
            <div className="text-xs font-extrabold" style={{ color: 'var(--text-2)' }}>📡 실시간 접수 피드</div>
            <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>최근 {feed.length}건</span>
          </div>
          {feed.length === 0 ? (
            <Empty label="아직 접수된 신청이 없습니다" />
          ) : (
            <div style={{ maxHeight: 340, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {feed.map((f) => {
                const flash = flashIds.has(f.id);
                const accent = f.kind === 'store' ? 'var(--gold)' : '#FF1F8F';
                return (
                  <div key={f.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 9,
                    background: 'var(--surface-2)', borderLeft: `3px solid ${flash ? accent : 'transparent'}`,
                    animation: flash ? 'prereg-flash 2.6s ease-out' : 'none',
                  }}>
                    <span className="text-[9px] font-extrabold rounded px-1.5 py-0.5 shrink-0"
                      style={{ background: f.kind === 'store' ? 'rgba(245,158,11,0.15)' : 'rgba(255,31,143,0.15)', color: accent }}>
                      {f.kind === 'store' ? '매장' : '출시알림'}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.sub}</div>
                    </div>
                    <span className="mono shrink-0" style={{ fontSize: 11, color: flash ? accent : 'var(--text-3)', fontWeight: flash ? 800 : 500 }}>
                      {relTime(new Date(f.ts), nowTick)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 일자별 가입 신청 현황 — 하루하루 실시간 카운트 */}
      <div className="rounded-xl p-4 mb-6" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
        <div className="flex items-end justify-between mb-3 flex-wrap gap-2">
          <div>
            <div className="text-xs font-extrabold" style={{ color: 'var(--text-2)' }}>📅 일자별 가입 신청 현황</div>
            <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>매장 사전등록 · 출시알림을 날짜별로 집계 (실시간 갱신)</div>
          </div>
          <div className="flex gap-4">
            <div className="text-right">
              <div className="text-[10px] font-bold" style={{ color: 'var(--text-3)' }}>오늘 신규</div>
              <div key={daily.todayTotal} className="text-2xl font-extrabold mono" style={{ color: 'var(--gold)', display: 'inline-block', animation: 'prereg-countpulse 0.5s ease-out' }}>{daily.todayTotal}</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] font-bold" style={{ color: 'var(--text-3)' }}>누적 합계</div>
              <div className="text-2xl font-extrabold mono" style={{ color: 'var(--text-1)' }}>{daily.grandTotal}</div>
            </div>
          </div>
        </div>
        <div style={{ maxHeight: 340, overflowY: 'auto' }} className="rounded-lg" >
          <table className="w-full text-sm">
            <thead style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--surface-1)' }}>
              <tr>
                <Th>날짜</Th>
                <th className="text-right p-2.5 text-[10px] font-bold tracking-wider" style={{ color: 'var(--text-3)' }}>매장</th>
                <th className="text-right p-2.5 text-[10px] font-bold tracking-wider" style={{ color: 'var(--text-3)' }}>출시알림</th>
                <th className="text-right p-2.5 text-[10px] font-bold tracking-wider" style={{ color: 'var(--text-3)' }}>합계</th>
                <th className="text-right p-2.5 text-[10px] font-bold tracking-wider" style={{ color: 'var(--text-3)' }}>누적</th>
              </tr>
            </thead>
            <tbody>
              {daily.rows.map((r) => {
                const isToday = r.key === daily.todayKey;
                return (
                  <tr key={r.key} style={{ borderTop: '1px solid var(--border)', background: isToday ? 'rgba(245,158,11,0.10)' : 'transparent' }}>
                    <td className="p-2.5" style={{ fontSize: 12.5, color: 'var(--text-1)', fontWeight: isToday ? 800 : 500 }}>
                      {fmtDayLabel(r.key)}
                      {isToday && <span className="ml-2 text-[9px] font-extrabold rounded px-1.5 py-0.5" style={{ background: 'var(--gold)', color: '#0F1419' }}>오늘</span>}
                    </td>
                    <td className="p-2.5 text-right mono" style={{ fontSize: 12.5, color: r.store ? 'var(--gold)' : 'var(--text-3)', fontWeight: 700 }}>{r.store}</td>
                    <td className="p-2.5 text-right mono" style={{ fontSize: 12.5, color: r.lead ? '#FF1F8F' : 'var(--text-3)', fontWeight: 700 }}>{r.lead}</td>
                    <td className="p-2.5 text-right mono" style={{ fontSize: 13, color: 'var(--text-1)', fontWeight: 800 }}>{r.total}</td>
                    <td className="p-2.5 text-right mono" style={{ fontSize: 12.5, color: 'var(--text-2)' }}>{r.cum}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 랜딩 표시 기준값 (사회적 증거 오프셋) */}
      <div className="rounded-xl p-4 mb-6" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
        <div className="text-xs font-extrabold" style={{ color: 'var(--text-2)' }}>🎚️ 랜딩 표시 기준값 (오프셋)</div>
        <div className="text-[11px] mt-1 mb-3" style={{ color: 'var(--text-3)' }}>
          랜딩 표시 = <b>기준값 + 실제</b>. 초반 숫자가 약해 보이지 않도록 기준값을 깔아둡니다. (0이면 순수 실데이터)
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold" style={{ color: 'var(--text-3)' }}>기준 매장 수</span>
            <input value={baseStore} onChange={(e) => setBaseStore(e.target.value.replace(/\D/g, ''))} inputMode="numeric"
              className="mono" style={{ width: 110, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-1)', fontSize: 13 }} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold" style={{ color: 'var(--text-3)' }}>기준 대기 유저</span>
            <input value={baseLead} onChange={(e) => setBaseLead(e.target.value.replace(/\D/g, ''))} inputMode="numeric"
              className="mono" style={{ width: 110, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-1)', fontSize: 13 }} />
          </label>
          <button onClick={saveBase} disabled={savingBase} className="px-4 py-2 rounded-lg text-sm font-bold disabled:opacity-40"
            style={{ background: 'var(--gold)', color: '#0F1419' }}>
            {savingBase ? '저장 중…' : '저장'}
          </button>
        </div>
        <div className="text-[11px] mt-3" style={{ color: 'var(--text-2)' }}>
          현재 랜딩 표시 예상: 매장 <b style={{ color: 'var(--gold)' }}>{(baseSaved.s + stat.total).toLocaleString()}</b>곳 · 대기 유저 <b style={{ color: '#FF1F8F' }}>{(baseSaved.l + leads.length).toLocaleString()}</b>명
          <span style={{ color: 'var(--text-3)' }}> (기준 {baseSaved.s}/{baseSaved.l} + 실제 {stat.total}/{leads.length})</span>
        </div>
      </div>

      {/* 차트 2열 */}
      <div className="grid md:grid-cols-2 gap-4 mb-6">
        {/* 일별 추이 */}
        <Panel title="일별 신규 신청 (최근 14일)">
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 120, marginTop: 6 }}>
            {trend.days.map((d) => {
              const total = d.store + d.lead;
              const h = (total / trend.max) * 100;
              return (
                <div key={d.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }} title={`${d.key} · 매장 ${d.store} · 유저 ${d.lead}`}>
                  <div style={{ width: '100%', maxWidth: 18, height: `${h}%`, minHeight: total > 0 ? 4 : 0, borderRadius: 4, overflow: 'hidden', display: 'flex', flexDirection: 'column-reverse', background: 'var(--surface-2)' }}>
                    <div style={{ height: `${total ? (d.store / total) * 100 : 0}%`, background: 'var(--gold)' }} />
                    <div style={{ height: `${total ? (d.lead / total) * 100 : 0}%`, background: '#FF1F8F' }} />
                  </div>
                  <div style={{ fontSize: 8, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{d.key}</div>
                </div>
              );
            })}
          </div>
          <Legend items={[{ c: 'var(--gold)', l: '매장' }, { c: '#FF1F8F', l: '유저' }]} />
        </Panel>

        {/* 심사 상태 분포 */}
        <Panel title="매장 심사 상태 분포">
          <BarList items={[
            { l: '심사 대기', v: stat.pending, c: '#F59E0B' },
            { l: '승인 완료', v: stat.active, c: '#10B981' },
            { l: '반려', v: stat.rejected, c: '#EF4444' },
            { l: '정지·종료', v: stat.suspended, c: '#9CA3AF' },
          ]} total={Math.max(1, stat.total)} />
        </Panel>

        {/* 유저 대기 매장 TOP */}
        <Panel title="유저가 기다리는 매장 TOP">
          {topWanted.length === 0 ? (
            <Empty label="아직 출시알림 신청이 없습니다" />
          ) : (
            <BarList items={topWanted.map(([name, n], i) => ({ l: `${i + 1}. ${name}`, v: n, c: i === 0 ? '#FF1F8F' : 'var(--brand, #FF6BAA)' }))} total={Math.max(1, topWanted[0][1])} suffix="명" />
          )}
        </Panel>

        {/* 지역 분포 */}
        <Panel title="매장 지역 분포">
          {regions.length === 0 ? (
            <Empty label="등록된 매장이 없습니다" />
          ) : (
            <BarList items={regions.map(([r, n]) => ({ l: r, v: n, c: '#06B6D4' }))} total={Math.max(1, stat.total)} suffix="곳" />
          )}
        </Panel>
      </div>

      {/* 테이블 */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {([['stores', `매장 사전등록 (${apps.length})`], ['leads', `출시알림 신청 (${leads.length})`]] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className="px-4 py-2 rounded-lg text-sm font-bold transition"
            style={tab === id ? { background: 'var(--gold)', color: '#0F1419' } : { background: 'var(--surface-2)', color: 'var(--text-2)', border: '1px solid var(--border)' }}>
            {label}
          </button>
        ))}
        <button onClick={tab === 'stores' ? exportStores : exportLeads} className="ml-auto px-3 py-2 rounded-lg text-xs font-bold"
          style={{ background: 'var(--surface-2)', color: 'var(--text-1)', border: '1px solid var(--border)' }}>
          ⬇ CSV 내보내기
        </button>
      </div>

      {tab === 'stores' ? (
        <TableWrap empty={sortedApps.length === 0} emptyLabel="사전등록된 매장이 없습니다">
          <thead>
            <tr>{['매장명', '주소', '대표자', '연락처', '사업자번호', '상태', '신청일'].map((h) => <Th key={h}>{h}</Th>)}</tr>
          </thead>
          <tbody>
            {sortedApps.map((s) => (
              <tr key={s.id} style={{ borderTop: '1px solid var(--border)' }}>
                <Td><b style={{ color: 'var(--text-1)' }}>{s.name || '—'}</b></Td>
                <Td>{s.roadAddress || s.address || '—'}</Td>
                <Td>{s.representativeName || '—'}</Td>
                <Td mono>{s.representativePhone || s.phone || '—'}</Td>
                <Td mono>{s.businessRegistrationNumber || '—'}</Td>
                <Td><StatusPill status={s.status ?? 'pending'} /></Td>
                <Td>{fmtDate(s.createdAt)}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      ) : (
        <TableWrap empty={sortedLeads.length === 0} emptyLabel="출시알림 신청이 없습니다">
          <thead>
            <tr>{['매장명', '연락처', '유입', '신청일'].map((h) => <Th key={h}>{h}</Th>)}</tr>
          </thead>
          <tbody>
            {sortedLeads.map((l) => (
              <tr key={l.id} style={{ borderTop: '1px solid var(--border)' }}>
                <Td><b style={{ color: 'var(--text-1)' }}>{l.storeName || '—'}</b></Td>
                <Td mono>{l.phone || '—'}</Td>
                <Td>{l.source || 'landing'}</Td>
                <Td>{fmtDate(l.createdAt)}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </div>
  );
}

// ── 서브 컴포넌트 ──────────────────────────────────────────
function Kpi({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
      <div className="text-[11px] font-bold" style={{ color: 'var(--text-3)' }}>{label}</div>
      <div className="text-3xl font-extrabold mt-1" style={{ color: tone }}>{value.toLocaleString()}</div>
    </div>
  );
}
// 어제 같은 시각까지 대비 증감 뱃지
function DeltaBadge({ todayTotal, yTotal, deltaPct }: { todayTotal: number; yTotal: number; deltaPct: number | null }) {
  // 어제 동시각 0건 + 오늘 신규 발생 → "NEW"
  if (yTotal === 0 && todayTotal > 0) {
    return <span className="text-[10px] font-extrabold rounded px-1.5 py-0.5" style={{ background: 'rgba(16,185,129,0.16)', color: '#10B981' }}>NEW</span>;
  }
  if (deltaPct === null) {
    return <span className="text-[10px] font-bold" style={{ color: 'var(--text-3)' }}>—</span>;
  }
  const up = deltaPct >= 0;
  const color = deltaPct === 0 ? 'var(--text-3)' : up ? '#10B981' : '#EF4444';
  const arrow = deltaPct === 0 ? '·' : up ? '▲' : '▼';
  return (
    <span className="text-[11px] font-extrabold" style={{ color }} title="어제 같은 시각까지 누적 대비">
      {arrow} {Math.abs(deltaPct)}%
    </span>
  );
}
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
      <div className="text-xs font-extrabold mb-2" style={{ color: 'var(--text-2)' }}>{title}</div>
      {children}
    </div>
  );
}
function BarList({ items, total, suffix = '' }: { items: { l: string; v: number; c: string }[]; total: number; suffix?: string }) {
  return (
    <div className="flex flex-col gap-2 mt-1">
      {items.map((it) => (
        <div key={it.l} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 96, fontSize: 11, fontWeight: 600, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.l}</div>
          <div style={{ flex: 1, height: 16, borderRadius: 5, background: 'var(--surface-2)', overflow: 'hidden' }}>
            <div style={{ width: `${Math.min(100, (it.v / total) * 100)}%`, height: '100%', background: it.c, borderRadius: 5, minWidth: it.v > 0 ? 4 : 0 }} />
          </div>
          <div className="mono" style={{ width: 40, textAlign: 'right', fontSize: 12, fontWeight: 800, color: 'var(--text-1)' }}>{it.v}{suffix}</div>
        </div>
      ))}
    </div>
  );
}
function Legend({ items }: { items: { c: string; l: string }[] }) {
  return (
    <div style={{ display: 'flex', gap: 14, marginTop: 10, justifyContent: 'center' }}>
      {items.map((it) => (
        <div key={it.l} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-2)' }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: it.c }} />{it.l}
        </div>
      ))}
    </div>
  );
}
function Empty({ label }: { label: string }) {
  return <div className="text-xs py-6 text-center" style={{ color: 'var(--text-3)' }}>{label}</div>;
}
function TableWrap({ children, empty, emptyLabel }: { children: React.ReactNode; empty: boolean; emptyLabel: string }) {
  if (empty) {
    return <div className="rounded-xl p-10 text-center text-sm" style={{ background: 'var(--surface-1)', border: '1px dashed var(--border)', color: 'var(--text-3)' }}>{emptyLabel}</div>;
  }
  return (
    <div className="rounded-xl overflow-x-auto" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
      <table className="w-full text-sm" style={{ minWidth: 640 }}>{children}</table>
    </div>
  );
}
function Th({ children }: { children: React.ReactNode }) {
  return <th className="text-left p-3 text-[10px] font-bold tracking-wider" style={{ color: 'var(--text-3)' }}>{children}</th>;
}
function Td({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return <td className={`p-3 ${mono ? 'mono' : ''}`} style={{ color: 'var(--text-2)', fontSize: 12.5 }}>{children}</td>;
}
function StatusPill({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    pending: { bg: 'rgba(245,158,11,.15)', fg: '#F59E0B', label: '심사 대기' },
    active: { bg: 'rgba(16,185,129,.15)', fg: '#10B981', label: '활성' },
    rejected: { bg: 'rgba(239,68,68,.15)', fg: '#EF4444', label: '반려' },
    suspended: { bg: 'rgba(156,163,175,.18)', fg: '#9CA3AF', label: '정지' },
    paused: { bg: 'rgba(156,163,175,.18)', fg: '#9CA3AF', label: '중단' },
    closed: { bg: 'rgba(239,68,68,.15)', fg: '#EF4444', label: '종료' },
  };
  const s = map[status] ?? { bg: 'var(--surface-2)', fg: 'var(--text-2)', label: status };
  return <span className="text-[10px] font-extrabold rounded px-2 py-0.5" style={{ background: s.bg, color: s.fg }}>{s.label}</span>;
}
