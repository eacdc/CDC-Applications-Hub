import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { assignSalesPerson, fetchSalesExecutives } from '@/lib/api';
import type { EmailRecord } from '@/types';
import { isSalesTagMailType } from '@/types';

interface SalesPersonPickerProps {
  email: EmailRecord;
  onAssigned: (updated: EmailRecord) => void;
}

export default function SalesPersonPicker({ email, onAssigned }: SalesPersonPickerProps) {
  const [names, setNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const needsSelection =
    isSalesTagMailType(email.mailType) && !email.salesPerson?.trim();

  useEffect(() => {
    if (!needsSelection) return;

    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    fetchSalesExecutives()
      .then((res) => {
        if (!cancelled) setNames(res.names);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Failed to load sales executives');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [needsSelection, email._id]);

  if (!needsSelection) {
    return (
      <span>
        {email.salesPerson || '—'}
        {email.salesPersonSource && (
          <span className="ml-2 text-xs text-slate-500">({email.salesPersonSource})</span>
        )}
      </span>
    );
  }

  async function handleChange(value: string) {
    if (!value) return;
    try {
      setSaving(true);
      setSaveError(null);
      const updated = await assignSalesPerson(email._id, value);
      onAssigned(updated);
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Failed to assign sales person');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-1">
      {loading ? (
        <span className="inline-flex items-center gap-2 text-sm text-slate-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading sales executives…
        </span>
      ) : (
        <select
          className="input-field max-w-md"
          value=""
          disabled={saving || names.length === 0}
          onChange={(e) => handleChange(e.target.value)}
        >
          <option value="">Select sales person…</option>
          {names.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      )}
      {loadError && <p className="text-xs text-red-400">{loadError}</p>}
      {saveError && <p className="text-xs text-red-400">{saveError}</p>}
      {!loading && !loadError && names.length === 0 && (
        <p className="text-xs text-slate-500">No sales executives found.</p>
      )}
    </div>
  );
}
