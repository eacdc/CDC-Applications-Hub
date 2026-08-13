import { useState } from 'react';
import { Loader2, Trash2, X } from 'lucide-react';
import { deleteEmail } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import type { EmailRecord } from '@/types';

interface Props {
  email: Pick<EmailRecord, '_id' | 'subject' | 'fromName' | 'fromEmail' | 'sentDate'>;
  onClose: () => void;
  onDeleted: (deletedId: string) => void;
}

export default function DeleteEmailDialog({ email, onClose, onDeleted }: Props) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      await deleteEmail(email._id);
      onDeleted(email._id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4"
      onClick={() => !deleting && onClose()}
      role="presentation"
    >
      <div
        className="card w-full max-w-sm rounded-t-2xl border border-slate-600 p-5 sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-email-title"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <Trash2 className="h-5 w-5 shrink-0 text-red-400" />
            <h3 id="delete-email-title" className="font-bold text-white">Delete email?</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={deleting}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
            aria-label="Cancel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-4 rounded-lg bg-slate-800/60 px-3 py-2 text-sm">
          <div className="font-medium text-slate-100">
            {email.subject || <span className="italic text-slate-400">(no subject)</span>}
          </div>
          <div className="text-slate-400">
            From {email.fromName || email.fromEmail || 'unknown'} · {formatDate(email.sentDate)}
          </div>
        </div>

        <p className="mb-4 text-sm text-slate-400">
          This will permanently remove the classified email record from the database. The original
          message in Gmail will not be affected. This cannot be undone.
        </p>

        {error && (
          <div className="mb-3 rounded-lg border border-red-500/40 bg-red-950/30 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            className="btn-secondary w-full sm:w-auto"
            onClick={onClose}
            disabled={deleting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary w-full bg-red-600 hover:bg-red-500 sm:w-auto"
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Delete permanently
          </button>
        </div>
      </div>
    </div>
  );
}
