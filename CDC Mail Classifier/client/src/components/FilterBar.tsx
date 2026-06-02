import type { EmailFilters } from '@/types';
import { DEPARTMENTS, MAIL_TYPES } from '@/types';

interface FilterBarProps {
  filters: EmailFilters;
  inboxes: string[];
  onChange: (filters: EmailFilters) => void;
}

export default function FilterBar({ filters, inboxes, onChange }: FilterBarProps) {
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <label className="flex flex-col gap-1 text-xs text-slate-400">
        Search
        <input
          type="search"
          value={filters.search ?? ''}
          onChange={(e) => onChange({ ...filters, search: e.target.value, page: 1 })}
          placeholder="Subject, sender, job…"
          className="min-w-[12rem] rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600"
        />
      </label>

      <label className="flex flex-col gap-1 text-xs text-slate-400">
        Department
        <select
          value={filters.department ?? ''}
          onChange={(e) => onChange({ ...filters, department: e.target.value || undefined, page: 1 })}
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
        >
          <option value="">All</option>
          {DEPARTMENTS.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs text-slate-400">
        Mail type
        <select
          value={filters.mailType ?? ''}
          onChange={(e) => onChange({ ...filters, mailType: e.target.value || undefined, page: 1 })}
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
        >
          <option value="">All</option>
          {MAIL_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs text-slate-400">
        Inbox
        <select
          value={filters.inbox ?? ''}
          onChange={(e) => onChange({ ...filters, inbox: e.target.value || undefined, page: 1 })}
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
        >
          <option value="">All</option>
          {inboxes.map((inbox) => (
            <option key={inbox} value={inbox}>{inbox}</option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs text-slate-400">
        Review
        <select
          value={filters.needsReview === undefined ? '' : String(filters.needsReview)}
          onChange={(e) => {
            const val = e.target.value;
            onChange({
              ...filters,
              needsReview: val === '' ? undefined : val === 'true',
              page: 1,
            });
          }}
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
        >
          <option value="">All</option>
          <option value="true">Needs review</option>
          <option value="false">No review</option>
        </select>
      </label>
    </div>
  );
}
