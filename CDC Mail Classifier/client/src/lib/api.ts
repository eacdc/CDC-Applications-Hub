import type {
  EmailFilters,
  EmailListResponse,
  EmailRecord,
  EmailUpdatePayload,
  InboxRecord,
  StatsResponse,
} from '@/types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }

  return res.json() as Promise<T>;
}

function toQuery(filters: EmailFilters): string {
  const params = new URLSearchParams();
  if (filters.department) params.set('department', filters.department);
  if (filters.mailType) params.set('mailType', filters.mailType);
  if (filters.needsReview !== undefined) params.set('needsReview', String(filters.needsReview));
  if (filters.inbox) params.set('inbox', filters.inbox);
  if (filters.search) params.set('search', filters.search);
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) params.set('dateTo', filters.dateTo);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.limit) params.set('limit', String(filters.limit));
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function fetchEmails(filters: EmailFilters = {}): Promise<EmailListResponse> {
  return request<EmailListResponse>(`/api/emails${toQuery(filters)}`);
}

export function fetchEmail(id: string): Promise<EmailRecord> {
  return request<EmailRecord>(`/api/emails/${id}`);
}

export function updateEmail(id: string, payload: EmailUpdatePayload): Promise<EmailRecord> {
  return request<EmailRecord>(`/api/emails/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function reclassifyEmail(id: string): Promise<EmailRecord> {
  return request<EmailRecord>(`/api/reclassify/${id}`, { method: 'POST' });
}

export function fetchStats(): Promise<StatsResponse> {
  return request<StatsResponse>('/api/stats');
}

export function fetchInboxes(): Promise<InboxRecord[]> {
  return request<InboxRecord[]>('/api/inboxes');
}

export function createInbox(label: string, emailAddress: string): Promise<InboxRecord> {
  return request<InboxRecord>('/api/inboxes', {
    method: 'POST',
    body: JSON.stringify({ label, emailAddress }),
  });
}

export function getGoogleAuthUrl(label: string, emailAddress: string): string {
  const params = new URLSearchParams({ label, emailAddress });
  return `/api/auth/google?${params.toString()}`;
}
