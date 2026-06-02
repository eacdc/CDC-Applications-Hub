import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatConfidence(value?: number): string {
  if (value === undefined || value === null) return '—';
  return `${Math.round(value * 100)}%`;
}

export function formatDate(value?: string): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function shortModelName(classifier?: string): string {
  if (!classifier) return '—';
  if (classifier.includes('nano')) return 'nano';
  if (classifier.includes('mini')) return 'mini';
  return classifier;
}
