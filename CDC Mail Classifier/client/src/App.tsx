import { NavLink, Route, Routes } from 'react-router-dom';
import { Inbox, LayoutDashboard, ListChecks, Mail } from 'lucide-react';
import { clsx } from 'clsx';
import DashboardPage from './pages/Dashboard';
import EmailsPage from './pages/Emails';
import EmailDetailPage from './pages/EmailDetail';
import ReviewQueuePage from './pages/ReviewQueue';
import InboxesPage from './pages/Inboxes';

const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/emails', label: 'Mail', icon: Mail },
  { to: '/review-queue', label: 'Review', icon: ListChecks },
  { to: '/inboxes', label: 'Inboxes', icon: Inbox },
];

export default function App() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/90 backdrop-blur">
        <div className="page-shell flex items-center justify-between gap-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white">
              <Mail className="h-4 w-4" />
            </div>
            <div>
              <div className="text-sm font-bold">CDC Mail Classifier</div>
              <div className="text-xs text-slate-500">Prepress · Production · Packaging</div>
            </div>
          </div>

          <nav className="flex items-center gap-1">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  clsx(
                    'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition',
                    isActive
                      ? 'bg-brand-600/20 text-brand-200 ring-1 ring-brand-500/40'
                      : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200',
                  )
                }
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className="flex-1 py-6">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/emails" element={<EmailsPage />} />
          <Route path="/email/:id" element={<EmailDetailPage />} />
          <Route path="/review-queue" element={<ReviewQueuePage />} />
          <Route path="/inboxes" element={<InboxesPage />} />
        </Routes>
      </main>
    </div>
  );
}
