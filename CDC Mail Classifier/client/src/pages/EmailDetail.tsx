import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ExternalLink, Loader2, RefreshCw, Save } from 'lucide-react';
import { fetchEmail, reclassifyEmail, updateEmail } from '@/lib/api';
import type { EmailRecord, EmailUpdatePayload } from '@/types';
import { DEPARTMENTS, MAIL_TYPES } from '@/types';
import StatusBadge from '@/components/StatusBadge';
import { formatConfidence, formatDate } from '@/lib/utils';

interface EmailDetailPageProps {
  id?: string;
}

export default function EmailDetailPage({ id: propId }: EmailDetailPageProps) {
  const { id: routeId } = useParams<{ id: string }>();
  const id = propId ?? routeId ?? '';

  return <EmailDetailInner id={id} />;
}

function EmailDetailInner({ id }: { id: string }) {
  const [email, setEmail] = useState<EmailRecord | null>(null);
  const [form, setForm] = useState<EmailUpdatePayload>({});
  const [typeSpecificJson, setTypeSpecificJson] = useState('{}');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reclassifying, setReclassifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      const data = await fetchEmail(id);
      setEmail(data);
      setForm({
        department: data.department,
        mailType: data.mailType,
        jobNumber: data.jobNumber,
        clientName: data.clientName,
        isbn: data.isbn,
        title: data.title,
        quantity: data.quantity,
        dueDate: data.dueDate,
        summary: data.summary,
        actionRequired: data.actionRequired,
      });
      setTypeSpecificJson(JSON.stringify(data.typeSpecific ?? {}, null, 2));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load email');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSave() {
    if (!id) return;
    try {
      setSaving(true);
      setMessage(null);
      let typeSpecific: Record<string, unknown> = {};
      try {
        typeSpecific = JSON.parse(typeSpecificJson) as Record<string, unknown>;
      } catch {
        setError('type_specific must be valid JSON');
        return;
      }
      const updated = await updateEmail(id, { ...form, typeSpecific });
      setEmail(updated);
      setMessage('Correction saved');
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleReclassify() {
    if (!id) return;
    try {
      setReclassifying(true);
      setMessage(null);
      const updated = await reclassifyEmail(id);
      setEmail(updated);
      setForm({
        department: updated.department,
        mailType: updated.mailType,
        jobNumber: updated.jobNumber,
        clientName: updated.clientName,
        isbn: updated.isbn,
        title: updated.title,
        quantity: updated.quantity,
        dueDate: updated.dueDate,
        summary: updated.summary,
        actionRequired: updated.actionRequired,
      });
      setTypeSpecificJson(JSON.stringify(updated.typeSpecific ?? {}, null, 2));
      setMessage('Reclassified');
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reclassify failed');
    } finally {
      setReclassifying(false);
    }
  }

  if (loading) {
    return <div className="page-shell text-slate-500">Loading email…</div>;
  }

  if (!email) {
    return <div className="page-shell text-red-400">{error ?? 'Email not found'}</div>;
  }

  return (
    <div className="page-shell space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link to="/emails" className="text-xs text-brand-300 hover:underline">← Back to mail</Link>
          <h1 className="mt-2 text-xl font-semibold">{email.subject || '(no subject)'}</h1>
          <p className="mt-1 text-sm text-slate-400">
            {email.fromName} &lt;{email.fromEmail}&gt; · {formatDate(email.sentDate)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge needsReview={email.needsReview} reviewed={email.reviewed} confidence={email.confidence} />
          {email.gmailLink && (
            <a href={email.gmailLink} target="_blank" rel="noreferrer" className="btn-secondary">
              <ExternalLink className="h-4 w-4" /> Gmail
            </a>
          )}
          <button type="button" className="btn-secondary" onClick={handleReclassify} disabled={reclassifying}>
            {reclassifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Reclassify
          </button>
          <button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save correction
          </button>
        </div>
      </div>

      {error && <div className="text-sm text-red-400">{error}</div>}
      {message && <div className="text-sm text-emerald-400">{message}</div>}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card space-y-3">
          <h2 className="text-sm font-medium text-slate-400">Email body</h2>
          <div className="max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-4 text-sm leading-relaxed text-slate-300">
            {email.body || '(empty body)'}
          </div>
          {email.attachments && email.attachments.length > 0 && (
            <div className="text-xs text-slate-500">
              Attachments: {email.attachments.join(', ')}
            </div>
          )}
        </div>

        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-slate-400">Classification</h2>
            <span className="text-xs text-slate-500">
              {formatConfidence(email.confidence)} · {email.classifier ?? '—'}
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Department">
              <select
                className="input-field"
                value={form.department ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}
              >
                <option value="">—</option>
                {DEPARTMENTS.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </Field>

            <Field label="Mail type">
              <select
                className="input-field"
                value={form.mailType ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, mailType: e.target.value }))}
              >
                <option value="">—</option>
                {MAIL_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </Field>

            <Field label="Job number">
              <input className="input-field" value={form.jobNumber ?? ''} onChange={(e) => setForm((f) => ({ ...f, jobNumber: e.target.value }))} />
            </Field>
            <Field label="Client">
              <input className="input-field" value={form.clientName ?? ''} onChange={(e) => setForm((f) => ({ ...f, clientName: e.target.value }))} />
            </Field>
            <Field label="ISBN">
              <input className="input-field" value={form.isbn ?? ''} onChange={(e) => setForm((f) => ({ ...f, isbn: e.target.value }))} />
            </Field>
            <Field label="Title">
              <input className="input-field" value={form.title ?? ''} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
            </Field>
            <Field label="Quantity">
              <input className="input-field" value={form.quantity ?? ''} onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))} />
            </Field>
            <Field label="Due date">
              <input className="input-field" type="date" value={form.dueDate ?? ''} onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))} />
            </Field>
          </div>

          <Field label="Summary">
            <textarea className="input-field min-h-[4rem]" value={form.summary ?? ''} onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))} />
          </Field>

          <Field label="Action required">
            <textarea className="input-field min-h-[4rem]" value={form.actionRequired ?? ''} onChange={(e) => setForm((f) => ({ ...f, actionRequired: e.target.value }))} />
          </Field>

          <Field label="Type-specific (JSON)">
            <textarea
              className="input-field min-h-[8rem] font-mono text-xs"
              value={typeSpecificJson}
              onChange={(e) => setTypeSpecificJson(e.target.value)}
            />
          </Field>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1 text-xs text-slate-500">
      {label}
      {children}
    </label>
  );
}
