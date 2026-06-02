export type Department =
  | 'Prepress'
  | 'Packprepress'
  | 'Packagingcrm'
  | 'Production';

export type MailType =
  | 'File received'
  | 'Correction received'
  | 'Approval received'
  | 'Production query'
  | 'Request for quote received';

export interface EmailRecord {
  _id: string;
  messageId: string;
  threadId?: string;
  inbox?: string;
  fromName?: string;
  fromEmail?: string;
  toField?: string;
  ccField?: string;
  subject?: string;
  sentDate?: string;
  gmailLink?: string;
  body?: string;
  attachments?: string[];
  department?: string;
  mailType?: string;
  confidence?: number;
  needsReview?: boolean;
  classifier?: string;
  jobNumber?: string;
  clientName?: string;
  isbn?: string;
  title?: string;
  quantity?: string;
  dueDate?: string;
  summary?: string;
  actionRequired?: string;
  typeSpecific?: Record<string, unknown>;
  reviewed?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface EmailListResponse {
  emails: EmailRecord[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

export interface StatsResponse {
  totalToday: number;
  needsReview: number;
  byDepartment: Record<string, number>;
  byMailType: Record<string, number>;
  reviewPercent: number;
  classifierSplit: { nano: number; mini: number };
}

export interface InboxRecord {
  _id: string;
  label?: string;
  emailAddress?: string;
  active?: boolean;
  createdAt?: string;
}

export interface EmailFilters {
  department?: string;
  mailType?: string;
  needsReview?: boolean;
  inbox?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
}

export interface EmailUpdatePayload {
  department?: string;
  mailType?: string;
  jobNumber?: string;
  clientName?: string;
  isbn?: string;
  title?: string;
  quantity?: string;
  dueDate?: string;
  summary?: string;
  actionRequired?: string;
  typeSpecific?: Record<string, unknown>;
}

export const DEPARTMENTS: Department[] = [
  'Prepress',
  'Packprepress',
  'Packagingcrm',
  'Production',
];

export const MAIL_TYPES: MailType[] = [
  'File received',
  'Correction received',
  'Approval received',
  'Production query',
  'Request for quote received',
];
