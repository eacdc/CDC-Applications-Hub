import { Link } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import type { EmailRecord } from '@/types';
import StatusBadge from './StatusBadge';
import { cn, formatConfidence, formatDateCompact, shortModelName } from '@/lib/utils';

interface EmailTableProps {
  emails: EmailRecord[];
  onRowClick?: (email: EmailRecord) => void;
  onDelete?: (email: EmailRecord) => void;
}

export default function EmailTable({ emails, onRowClick, onDelete }: EmailTableProps) {
  if (emails.length === 0) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-6 py-12 text-center text-sm text-slate-500">
        No emails match the current filters.
      </div>
    );
  }

  return (
    <>
      <div className="space-y-2 lg:hidden">
        {emails.map((email) => (
          <EmailMobileCard
            key={email._id}
            email={email}
            onRowClick={onRowClick}
            onDelete={onDelete}
          />
        ))}
      </div>

      <div className="hidden rounded-xl border border-slate-800 bg-slate-950/40 lg:block">
        <table className="mail-table">
          <colgroup>
            <col className="w-[7%]" />
            <col className="w-[11%]" />
            <col className="w-[18%]" />
            <col className="w-[9%]" />
            <col className="w-[12%]" />
            <col className="w-[9%]" />
            <col className="w-[5%]" />
            <col className="w-[5%]" />
            <col className="w-[8%]" />
            <col className="w-[11%]" />
            {onDelete && <col className="w-[3%]" />}
          </colgroup>
          <thead className="bg-slate-900/80 text-left text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              <th>Inbox</th>
              <th>From</th>
              <th>Subject</th>
              <th>Dept</th>
              <th>Mail type</th>
              <th>Sales</th>
              <th>Conf</th>
              <th>Model</th>
              <th>Status</th>
              <th>Sent</th>
              {onDelete && <th aria-label="Actions" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/80">
            {emails.map((email) => (
              <tr
                key={email._id}
                className="cursor-pointer transition hover:bg-slate-900/60"
                onClick={() => onRowClick?.(email)}
              >
                <td className="text-slate-400">{email.inbox ?? '—'}</td>
                <td>
                  <div className="truncate font-medium text-slate-200">
                    {email.fromName || email.fromEmail || '—'}
                  </div>
                  {email.fromName && email.fromEmail && (
                    <div className="truncate text-[10px] text-slate-500">{email.fromEmail}</div>
                  )}
                </td>
                <td>
                  <Link
                    to={`/email/${email._id}`}
                    className="line-clamp-2 text-brand-300 hover:underline"
                    title={email.subject || '(no subject)'}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {email.subject || '(no subject)'}
                  </Link>
                </td>
                <td className="text-slate-300">{email.department || '—'}</td>
                <td className="text-slate-300" title={email.mailType ?? undefined}>
                  {email.mailType || '—'}
                </td>
                <td className="text-slate-300" title={email.salesPersonSource ?? undefined}>
                  {email.salesPerson || '—'}
                </td>
                <td className="tabular-nums text-slate-300">{formatConfidence(email.confidence)}</td>
                <td className="text-slate-400">{shortModelName(email.classifier)}</td>
                <td>
                  <StatusBadge
                    compact
                    needsReview={email.needsReview}
                    reviewed={email.reviewed}
                    confidence={email.confidence}
                  />
                </td>
                <td className="whitespace-nowrap text-[10px] text-slate-500">
                  {formatDateCompact(email.sentDate)}
                </td>
                {onDelete && (
                  <td className="text-right">
                    <button
                      type="button"
                      className="rounded-md p-1 text-slate-500 transition hover:bg-red-950/40 hover:text-red-300"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(email);
                      }}
                      aria-label="Delete email"
                      title="Delete email"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function EmailMobileCard({
  email,
  onRowClick,
  onDelete,
}: {
  email: EmailRecord;
  onRowClick?: (email: EmailRecord) => void;
  onDelete?: (email: EmailRecord) => void;
}) {
  return (
    <article
      className="rounded-xl border border-slate-800 bg-slate-900/40 p-3 active:bg-slate-900/70"
      onClick={() => onRowClick?.(email)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onRowClick?.(email);
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <Link
            to={`/email/${email._id}`}
            className="line-clamp-2 text-sm font-medium text-brand-300"
            onClick={(e) => e.stopPropagation()}
          >
            {email.subject || '(no subject)'}
          </Link>
          <p className="mt-1 truncate text-xs text-slate-400">
            {email.fromName || email.fromEmail}
            {email.fromName && email.fromEmail ? ` · ${email.fromEmail}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-start gap-1">
          <StatusBadge
            needsReview={email.needsReview}
            reviewed={email.reviewed}
            confidence={email.confidence}
          />
          {onDelete && (
            <button
              type="button"
              className="rounded-md p-1.5 text-slate-500 hover:bg-red-950/40 hover:text-red-300"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(email);
              }}
              aria-label="Delete email"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[11px] sm:grid-cols-3">
        <Meta label="Inbox" value={email.inbox} />
        <Meta label="Dept" value={email.department} />
        <Meta label="Type" value={email.mailType} />
        <Meta label="Sales" value={email.salesPerson} />
        <Meta label="Conf" value={formatConfidence(email.confidence)} />
        <Meta label="Model" value={shortModelName(email.classifier)} />
        <Meta label="Sent" value={formatDateCompact(email.sentDate)} className="col-span-2 sm:col-span-1" />
      </dl>
    </article>
  );
}

function Meta({
  label,
  value,
  className,
}: {
  label: string;
  value?: string | null;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="text-[10px] uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="truncate text-slate-300">{value || '—'}</dd>
    </div>
  );
}
