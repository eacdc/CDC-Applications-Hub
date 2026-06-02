import { Link } from 'react-router-dom';
import type { EmailRecord } from '@/types';
import StatusBadge from './StatusBadge';
import { formatConfidence, formatDate, shortModelName } from '@/lib/utils';

interface EmailTableProps {
  emails: EmailRecord[];
  onRowClick?: (email: EmailRecord) => void;
}

export default function EmailTable({ emails, onRowClick }: EmailTableProps) {
  if (emails.length === 0) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-6 py-12 text-center text-sm text-slate-500">
        No emails match the current filters.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-800">
      <table className="min-w-full divide-y divide-slate-800 text-sm">
        <thead className="bg-slate-900/80 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-3">Inbox</th>
            <th className="px-4 py-3">From</th>
            <th className="px-4 py-3">Subject</th>
            <th className="px-4 py-3">Department</th>
            <th className="px-4 py-3">Mail type</th>
            <th className="px-4 py-3">Conf.</th>
            <th className="px-4 py-3">Model</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Sent</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/80 bg-slate-950/40">
          {emails.map((email) => (
            <tr
              key={email._id}
              className="cursor-pointer transition hover:bg-slate-900/60"
              onClick={() => onRowClick?.(email)}
            >
              <td className="whitespace-nowrap px-4 py-3 text-slate-400">{email.inbox ?? '—'}</td>
              <td className="max-w-[10rem] truncate px-4 py-3">
                <div className="truncate font-medium">{email.fromName || email.fromEmail}</div>
                {email.fromName && (
                  <div className="truncate text-xs text-slate-500">{email.fromEmail}</div>
                )}
              </td>
              <td className="max-w-[16rem] truncate px-4 py-3">
                <Link
                  to={`/email/${email._id}`}
                  className="text-brand-300 hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {email.subject || '(no subject)'}
                </Link>
              </td>
              <td className="whitespace-nowrap px-4 py-3">{email.department || '—'}</td>
              <td className="max-w-[10rem] truncate px-4 py-3 text-slate-300">{email.mailType || '—'}</td>
              <td className="whitespace-nowrap px-4 py-3 tabular-nums">{formatConfidence(email.confidence)}</td>
              <td className="whitespace-nowrap px-4 py-3 text-slate-400">{shortModelName(email.classifier)}</td>
              <td className="whitespace-nowrap px-4 py-3">
                <StatusBadge
                  needsReview={email.needsReview}
                  reviewed={email.reviewed}
                  confidence={email.confidence}
                />
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">{formatDate(email.sentDate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
