import { FormEvent, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, Link2, Loader2, Plus, RefreshCw, Trash2, Unplug, X } from 'lucide-react';
import { createInbox, deleteInbox, disconnectInbox, fetchInboxes, getGoogleAuthUrl } from '@/lib/api';
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
  const [pendingDisconnect, setPendingDisconnect] = useState<InboxRecord | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<InboxRecord | null>(null);
  const [deletingInbox, setDeletingInbox] = useState(false);

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

  async function handleDisconnect() {
    if (!pendingDisconnect) return;
    setDisconnecting(true);
    setError(null);
    try {
      await disconnectInbox(pendingDisconnect._id);
      setInboxes((prev) =>
        prev.map((i) =>
          i._id === pendingDisconnect._id ? { ...i, connected: false } : i,
        ),
      );
      setSuccess(`Disconnected ${pendingDisconnect.emailAddress ?? pendingDisconnect.label ?? 'inbox'}`);
      setPendingDisconnect(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Disconnect failed');
    } finally {
      setDisconnecting(false);
    }
  }

  async function handleDeleteInbox() {
    if (!pendingDelete) return;
    setDeletingInbox(true);
    setError(null);
    try {
      await deleteInbox(pendingDelete._id);
      setInboxes((prev) => prev.filter((i) => i._id !== pendingDelete._id));
      setSuccess(`Removed ${pendingDelete.emailAddress ?? pendingDelete.label ?? 'inbox'}`);
      setPendingDelete(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeletingInbox(false);
    }
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
                    {inbox.connected ? (
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="flex items-center gap-1.5 text-sm text-emerald-400">
                          <CheckCircle2 className="h-4 w-4" /> Connected
                        </span>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => handleConnect(inbox)}
                          title="Re-authorise this inbox (e.g. after token expiry)"
                        >
                          <RefreshCw className="h-4 w-4" /> Reconnect
                        </button>
                        <button
                          type="button"
                          className="btn-secondary text-red-300 hover:bg-red-950/40 hover:text-red-200"
                          onClick={() => setPendingDisconnect(inbox)}
                          title="Remove the stored refresh token; polling will stop"
                        >
                          <Unplug className="h-4 w-4" /> Disconnect
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <button type="button" className="btn-secondary" onClick={() => handleConnect(inbox)}>
                          <Link2 className="h-4 w-4" /> Connect Gmail
                        </button>
                        <button
                          type="button"
                          className="btn-secondary text-red-300 hover:bg-red-950/40 hover:text-red-200"
                          onClick={() => setPendingDelete(inbox)}
                          title="Remove this inbox record permanently"
                        >
                          <Trash2 className="h-4 w-4" /> Delete
                        </button>
                      </div>
                    )}
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

      {pendingDelete && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4"
          onClick={() => !deletingInbox && setPendingDelete(null)}
          role="presentation"
        >
          <div
            className="card w-full max-w-sm rounded-t-2xl border border-slate-600 p-5 sm:rounded-xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-inbox-title"
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <Trash2 className="h-5 w-5 shrink-0 text-red-400" />
                <h3 id="delete-inbox-title" className="font-bold text-white">Delete inbox?</h3>
              </div>
              <button
                type="button"
                onClick={() => setPendingDelete(null)}
                disabled={deletingInbox}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
                aria-label="Cancel"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mb-4 rounded-lg bg-slate-800/60 px-3 py-2 text-sm">
              <div className="font-medium text-slate-100">{pendingDelete.label || '—'}</div>
              <div className="text-slate-400">{pendingDelete.emailAddress || ''}</div>
            </div>

            <p className="mb-4 text-sm text-slate-400">
              This removes the inbox record from the database. Previously classified emails are
              kept (they live in the separate <code>emails</code> collection). The Gmail mailbox
              itself is not affected.
            </p>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                className="btn-secondary w-full sm:w-auto"
                onClick={() => setPendingDelete(null)}
                disabled={deletingInbox}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary w-full bg-red-600 hover:bg-red-500 sm:w-auto"
                onClick={handleDeleteInbox}
                disabled={deletingInbox}
              >
                {deletingInbox ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Delete permanently
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingDisconnect && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4"
          onClick={() => !disconnecting && setPendingDisconnect(null)}
          role="presentation"
        >
          <div
            className="card w-full max-w-sm rounded-t-2xl border border-slate-600 p-5 sm:rounded-xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="disconnect-title"
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <Unplug className="h-5 w-5 shrink-0 text-red-400" />
                <h3 id="disconnect-title" className="font-bold text-white">Disconnect inbox?</h3>
              </div>
              <button
                type="button"
                onClick={() => setPendingDisconnect(null)}
                disabled={disconnecting}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
                aria-label="Cancel"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mb-4 rounded-lg bg-slate-800/60 px-3 py-2 text-sm">
              <div className="font-medium text-slate-100">{pendingDisconnect.label || '—'}</div>
              <div className="text-slate-400">{pendingDisconnect.emailAddress || ''}</div>
            </div>

            <p className="mb-4 text-sm text-slate-400">
              This removes the stored Gmail refresh token, so the background poller will stop
              fetching new mails for this inbox. The inbox record and all previously classified
              emails are preserved. You can reconnect any time by clicking <em>Connect Gmail</em> again.
            </p>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                className="btn-secondary w-full sm:w-auto"
                onClick={() => setPendingDisconnect(null)}
                disabled={disconnecting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary w-full bg-red-600 hover:bg-red-500 sm:w-auto"
                onClick={handleDisconnect}
                disabled={disconnecting}
              >
                {disconnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unplug className="h-4 w-4" />}
                Disconnect
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
