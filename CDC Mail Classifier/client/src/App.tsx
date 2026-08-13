import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
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
  const { pathname } = useLocation();
  const onEmailDetail = pathname.startsWith('/email/');

  return (
    <div className="flex min-h-[100dvh] min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/90 backdrop-blur">
        <div className="page-shell-wide flex items-center justify-between gap-3 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white">
              <Mail className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-bold">CDC Mail Classifier</div>
              <div className="hidden truncate text-xs text-slate-500 sm:block">
                Prepress · Production · Packaging
              </div>
            </div>
          </div>

          <nav className="hidden items-center gap-1 lg:flex">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  clsx(
                    'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition',
                    isActive || (onEmailDetail && item.to === '/emails')
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

      <main
        className={clsx(
          'flex-1 py-4 sm:py-6',
          'pb-[calc(4.5rem+env(safe-area-inset-bottom,0px))] lg:pb-6',
        )}
      >
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/emails" element={<EmailsPage />} />
          <Route path="/email/:id" element={<EmailDetailPage />} />
          <Route path="/review-queue" element={<ReviewQueuePage />} />
          <Route path="/inboxes" element={<InboxesPage />} />
        </Routes>
      </main>

      <nav
        className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-800 bg-slate-950/95 backdrop-blur lg:hidden"
        style={{ paddingBottom: 'max(0.35rem, env(safe-area-inset-bottom))' }}
      >
        <div className="mx-auto grid max-w-lg grid-cols-4 gap-0.5 px-1 pt-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                clsx(
                  'flex flex-col items-center justify-center gap-0.5 rounded-lg py-2 text-[10px] font-medium leading-tight',
                  isActive || (onEmailDetail && item.to === '/emails')
                    ? 'text-brand-300'
                    : 'text-slate-500 hover:text-slate-300',
                )
              }
            >
              <item.icon className="h-5 w-5 shrink-0" />
              <span className="max-w-[4.5rem] truncate text-center">{item.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
