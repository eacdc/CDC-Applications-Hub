import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchEmails, fetchInboxes } from '@/lib/api';
import type { EmailFilters, EmailRecord } from '@/types';
import FilterBar from '@/components/FilterBar';
import EmailTable from '@/components/EmailTable';

export default function EmailsPage() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<EmailFilters>({ page: 1, limit: 25 });
  const [emails, setEmails] = useState<EmailRecord[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [inboxLabels, setInboxLabels] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchInboxes()
      .then((inboxes) => setInboxLabels(inboxes.map((i) => i.label ?? i.emailAddress ?? '').filter(Boolean)))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchEmails(filters);
      setEmails(data.emails);
      setTotalPages(data.pagination.pages);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load emails');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    const timer = setTimeout(load, filters.search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, filters.search]);

  const page = filters.page ?? 1;

  const inboxOptions = useMemo(() => {
    const fromEmails = emails.map((e) => e.inbox).filter(Boolean) as string[];
    return [...new Set([...inboxLabels, ...fromEmails])].sort();
  }, [emails, inboxLabels]);

  return (
    <div className="page-shell space-y-4">
      <h1 className="text-xl font-semibold">Mail</h1>

      <FilterBar filters={filters} inboxes={inboxOptions} onChange={setFilters} />

      {error && <div className="text-sm text-red-400">{error}</div>}
      {loading ? (
        <div className="text-sm text-slate-500">Loading…</div>
      ) : (
        <>
          <EmailTable
            emails={emails}
            onRowClick={(email) => navigate(`/email/${email._id}`)}
          />

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                type="button"
                className="btn-secondary"
                disabled={page <= 1}
                onClick={() => setFilters((f) => ({ ...f, page: page - 1 }))}
              >
                Previous
              </button>
              <span className="text-sm text-slate-500">
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                className="btn-secondary"
                disabled={page >= totalPages}
                onClick={() => setFilters((f) => ({ ...f, page: page + 1 }))}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
