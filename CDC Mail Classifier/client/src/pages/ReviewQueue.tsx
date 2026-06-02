import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchEmails } from '@/lib/api';
import type { EmailRecord } from '@/types';
import EmailTable from '@/components/EmailTable';

export default function ReviewQueuePage() {
  const navigate = useNavigate();
  const [emails, setEmails] = useState<EmailRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        const data = await fetchEmails({
          needsReview: true,
          limit: 100,
        });
        const sorted = [...data.emails].sort((a, b) => {
          const da = a.sentDate ? new Date(a.sentDate).getTime() : 0;
          const db = b.sentDate ? new Date(b.sentDate).getTime() : 0;
          return da - db;
        });
        if (!cancelled) {
          setEmails(sorted);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load review queue');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const interval = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="page-shell space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Review queue</h1>
        <p className="mt-1 text-sm text-slate-500">
          Low-confidence classifications, oldest first.
        </p>
      </div>

      {error && <div className="text-sm text-red-400">{error}</div>}
      {loading ? (
        <div className="text-sm text-slate-500">Loading…</div>
      ) : (
        <>
          <div className="text-sm text-slate-400">{emails.length} email(s) awaiting review</div>
          <EmailTable
            emails={emails}
            onRowClick={(email) => navigate(`/email/${email._id}`)}
          />
        </>
      )}
    </div>
  );
}
