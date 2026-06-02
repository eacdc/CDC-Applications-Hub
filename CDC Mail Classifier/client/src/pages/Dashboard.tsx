import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, Brain, Mail, TrendingUp } from 'lucide-react';
import { fetchEmails, fetchStats } from '@/lib/api';
import type { EmailRecord, StatsResponse } from '@/types';
import EmailTable from '@/components/EmailTable';

export default function DashboardPage() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [recent, setRecent] = useState<EmailRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        const [statsData, emailsData] = await Promise.all([
          fetchStats(),
          fetchEmails({ limit: 10 }),
        ]);
        if (!cancelled) {
          setStats(statsData);
          setRecent(emailsData.emails);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load dashboard');
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

  if (loading && !stats) {
    return <div className="page-shell text-slate-500">Loading dashboard…</div>;
  }

  if (error) {
    return <div className="page-shell text-red-400">{error}</div>;
  }

  const deptEntries = Object.entries(stats?.byDepartment ?? {}).sort((a, b) => b[1] - a[1]);

  return (
    <div className="page-shell space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <Link to="/review-queue" className="text-sm text-brand-300 hover:underline">
          Open review queue →
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Mail}
          label="Today"
          value={String(stats?.totalToday ?? 0)}
          sub="emails received"
        />
        <StatCard
          icon={AlertCircle}
          label="Needs review"
          value={String(stats?.needsReview ?? 0)}
          sub={`${stats?.reviewPercent ?? 0}% of all mail`}
          highlight={!!stats?.needsReview}
        />
        <StatCard
          icon={Brain}
          label="Classifier split"
          value={`${stats?.classifierSplit.nano ?? 0} / ${stats?.classifierSplit.mini ?? 0}`}
          sub="nano vs mini"
        />
        <StatCard
          icon={TrendingUp}
          label="Departments"
          value={String(deptEntries.length)}
          sub="active categories"
        />
      </div>

      {deptEntries.length > 0 && (
        <div className="card">
          <h2 className="mb-3 text-sm font-medium text-slate-400">By department</h2>
          <div className="flex flex-wrap gap-2">
            {deptEntries.map(([dept, count]) => (
              <span
                key={dept}
                className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm"
              >
                {dept} <span className="ml-1 tabular-nums text-slate-400">{count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-slate-400">Recent mail</h2>
          <Link to="/emails" className="text-xs text-brand-300 hover:underline">View all</Link>
        </div>
        <EmailTable emails={recent} />
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  highlight,
}: {
  icon: typeof Mail;
  label: string;
  value: string;
  sub: string;
  highlight?: boolean;
}) {
  return (
    <div className={cnCard(highlight)}>
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <Icon className="h-4 w-4" />
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{sub}</div>
    </div>
  );
}

function cnCard(highlight?: boolean) {
  return highlight
    ? 'card ring-1 ring-amber-700/40'
    : 'card';
}
