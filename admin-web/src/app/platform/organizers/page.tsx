'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/hooks';
import {
  type Organizer,
  subscribeAllOrganizers,
  createOrganizer,
  updateOrganizer,
  deleteOrganizer,
} from '@/lib/organizers';

export default function PlatformOrganizersPage() {
  const authState = useAuth();
  const [organizers, setOrganizers] = useState<Organizer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    const unsub = subscribeAllOrganizers(
      (items) => {
        setOrganizers(items);
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsub;
  }, []);

  if (authState.status !== 'authenticated') return null;

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">🏆 대회사 관리</h1>
          <p className="text-sm text-gray-500 mt-1">시리즈 운영사 등록·심사·관리</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="bg-gray-900 text-white px-4 py-2.5 rounded-xl font-bold text-sm hover:bg-black"
        >
          + 대회사 등록
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-gray-500">로딩 중…</div>
      ) : organizers.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-gray-200 rounded-xl p-10 text-center">
          <div className="text-4xl mb-3">🏆</div>
          <div className="font-bold text-gray-900 mb-2">등록된 대회사가 없습니다</div>
          <div className="text-xs text-gray-500">
            "+ 대회사 등록"으로 시리즈 운영사를 추가하세요.<br />
            대회사 운영자는 별도 어드민(/organizer/...)에서 시리즈를 관리합니다.
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {organizers.map((o) => (
            <OrganizerRow
              key={o.id}
              org={o}
              onToggle={async () => {
                await updateOrganizer(o.id, {
                  status: o.status === 'active' ? 'paused' : 'active',
                });
              }}
              onRemove={async () => {
                if (!window.confirm(`"${o.name}" 삭제? (복구 불가)`)) return;
                await deleteOrganizer(o.id);
              }}
            />
          ))}
        </div>
      )}

      {showModal && (
        <NewOrganizerModal
          ownerUid={authState.user.uid}
          onCreated={() => setShowModal(false)}
          onCancel={() => setShowModal(false)}
        />
      )}
    </div>
  );
}

function OrganizerRow({
  org,
  onToggle,
  onRemove,
}: {
  org: Organizer;
  onToggle: () => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-4">
      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-100 to-amber-200 flex items-center justify-center text-xl flex-shrink-0">
        🏆
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <div className="font-bold text-gray-900">{org.name}</div>
          <span
            className={`text-[10px] font-extrabold rounded px-2 py-0.5 ${
              org.status === 'active'
                ? 'bg-green-100 text-green-700'
                : 'bg-gray-200 text-gray-700'
            }`}
          >
            {org.status === 'active' ? '활성' : '중단'}
          </span>
        </div>
        <div className="text-xs text-gray-500 truncate">{org.tagline}</div>
        {org.contactEmail && (
          <div className="text-[11px] text-gray-400 mt-0.5 font-mono">{org.contactEmail}</div>
        )}
      </div>
      <div className="flex gap-1 flex-shrink-0">
        <a
          href={`/organizer/${org.id}`}
          target="_blank"
          rel="noopener"
          className="text-[10px] font-bold border border-gray-200 rounded px-2.5 py-1 hover:bg-gray-50"
        >
          ↗ 어드민
        </a>
        <button
          onClick={onToggle}
          className="text-[10px] font-bold border border-gray-200 rounded px-2.5 py-1 hover:bg-gray-50"
        >
          {org.status === 'active' ? '중단' : '재개'}
        </button>
        <button
          onClick={onRemove}
          className="text-[10px] font-bold border border-red-200 text-red-600 rounded px-2.5 py-1 hover:bg-red-50"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

function NewOrganizerModal({
  ownerUid,
  onCreated,
  onCancel,
}: {
  ownerUid: string;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [tagline, setTagline] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await createOrganizer(ownerUid, {
        name: name.trim(),
        tagline: tagline.trim(),
        contactEmail: contactEmail.trim() || undefined,
      });
      onCreated();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div onClick={onCancel} className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-6">
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl p-6 max-w-md w-full">
        <h3 className="font-extrabold text-gray-900 mb-1">+ 대회사 등록</h3>
        <p className="text-xs text-gray-500 mb-4">
          데모 단계 — 현재 계정(본사 관리자)을 대회사 owner로 등록. 운영 단계는 별도 가입·심사.
        </p>

        {error && <div className="mb-3 bg-red-50 border border-red-200 rounded p-2 text-xs text-red-700">{error}</div>}

        <div className="space-y-3">
          <Field label="대회사 이름">
            <input
              className="form-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: ABC Holdem Series"
            />
          </Field>
          <Field label="태그라인">
            <input
              className="form-input"
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              placeholder="예: 대한민국 No.1 시리즈 토너 운영사"
            />
          </Field>
          <Field label="연락처 이메일">
            <input
              className="form-input"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder="contact@example.com"
            />
          </Field>
        </div>

        <div className="flex gap-2 mt-6">
          <button onClick={onCancel} className="flex-1 py-2.5 rounded-lg border-[1.5px] border-gray-200 font-bold text-sm">
            취소
          </button>
          <button
            onClick={handleCreate}
            disabled={!name.trim() || saving}
            className="flex-1 py-2.5 rounded-lg bg-gray-900 text-white font-bold text-sm disabled:opacity-40"
          >
            {saving ? '등록 중…' : '등록'}
          </button>
        </div>

        <style jsx global>{`
          .form-input {
            background: #fff;
            border: 1.5px solid #eaeaea;
            border-radius: 8px;
            padding: 8px 12px;
            font-size: 13px;
            color: #111;
            width: 100%;
            box-sizing: border-box;
            outline: none;
          }
          .form-input:focus { border-color: #111; }
        `}</style>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-bold text-gray-500 tracking-wider mb-1.5">{label}</div>
      {children}
    </div>
  );
}
