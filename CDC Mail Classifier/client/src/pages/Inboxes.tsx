import { FormEvent, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, Link2, Plus } from 'lucide-react';
import { createInbox, fetchInboxes, getGoogleAuthUrl } from '@/lib/api';
import type { InboxRecord } from '@/types';
import { formatDate } from '@/lib/utils';

export default function InboxesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const connected = searchParams.get('connected');

  const [inboxes, setInboxes] = useState<InboxRecord[]>([]);
  const [label, setLabel] = useState('');
  const [emailAddress, setEmailAddress] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function load() {
    try {
      setLoading(true);
      const data = await fetchInboxes();
      setInboxes(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load inboxes');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (connected) {
      setSuccess(`Connected ${connected}`);
      setSearchParams({}, { replace: true });
      load();
    }
  }, [connected, setSearchParams]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!emailAddress.trim()) return;
    try {
      await createInbox(label.trim() || emailAddress.split('@')[0], emailAddress.trim());
      setLabel('');
      setEmailAddress('');
      await load();
      setSuccess('Inbox record created — now connect Gmail OAuth');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create inbox');
    }
  }

  function handleConnect(inbox: InboxRecord) {
    const addr = inbox.emailAddress ?? '';
    const lbl = inbox.label ?? addr.split('@')[0];
    window.location.href = getGoogleAuthUrl(lbl, addr);
  }

  return (
    <div className="page-shell space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Inboxes</h1>
        <p className="mt-1 text-sm text-slate-500">
          Register an inbox, then authorize Gmail OAuth to store a refresh token.
        </p>
      </div>

      {error && <div className="text-sm text-red-400">{error}</div>}
      {success && (
        <div className="flex items-center gap-2 text-sm text-emerald-400">
          <CheckCircle2 className="h-4 w-4" /> {success}
        </div>
      )}

      <form onSubmit={handleCreate} className="card flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          Label
          <input
            className="input-field min-w-[10rem]"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="prepress"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          Email address
          <input
            className="input-field min-w-[16rem]"
            type="email"
            required
            value={emailAddress}
            onChange={(e) => setEmailAddress(e.target.value)}
            placeholder="prepress@cdcprinters.com"
          />
        </label>
        <button type="submit" className="btn-primary">
          <Plus className="h-4 w-4" /> Add inbox
        </button>
      </form>

      {loading ? (
        <div className="text-sm text-slate-500">Loading…</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="min-w-full divide-y divide-slate-800 text-sm">
            <thead className="bg-slate-900/80 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Label</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Active</th>
                <th className="px-4 py-3">Added</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {inboxes.map((inbox) => (
                <tr key={inbox._id}>
                  <td className="px-4 py-3 font-medium">{inbox.label}</td>
                  <td className="px-4 py-3 text-slate-300">{inbox.emailAddress}</td>
                  <td className="px-4 py-3">{inbox.active ? 'Yes' : 'No'}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{formatDate(inbox.createdAt)}</td>
                  <td className="px-4 py-3">
                    <button type="button" className="btn-secondary" onClick={() => handleConnect(inbox)}>
                      <Link2 className="h-4 w-4" /> Connect Gmail
                    </button>
                  </td>
                </tr>
              ))}
              {inboxes.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    No inboxes configured yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
