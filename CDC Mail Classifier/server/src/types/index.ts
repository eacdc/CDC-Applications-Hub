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

export interface ClassificationResult {
  department: Department | '';
  mail_type: MailType | '';
  confidence: number;
  job_number: string;
  client_name: string;
  isbn: string;
  title: string;
  quantity: string;
  due_date: string;
  summary: string;
  action_required: string;
  type_specific: Record<string, unknown>;
}

export interface NormalizedEmail {
  messageId: string;
  threadId: string;
  inbox: string;
  fromName: string;
  fromEmail: string;
  toField: string;
  ccField: string;
  subject: string;
  sentDate: Date;
  body: string;
  attachments: string[];
  gmailLink: string;
}

export interface EmailListFilters {
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

export interface StatsResponse {
  totalToday: number;
  needsReview: number;
  byDepartment: Record<string, number>;
  byMailType: Record<string, number>;
  reviewPercent: number;
  classifierSplit: { nano: number; mini: number };
}
