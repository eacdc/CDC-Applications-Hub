import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { AgentStepLogRecord, AgentStepReason } from '@/types';
import { cn, formatDate, shortModelName } from '@/lib/utils';

interface AgentLogPanelProps {
  logs: AgentStepLogRecord[];
  loading?: boolean;
  error?: string | null;
}

const REASON_LABELS: Record<AgentStepReason, string> = {
  initial: 'Initial pass',
  escalation_cheap_error: 'Escalation — cheap model error',
  escalation_parse_failure: 'Escalation — parse failure',
  escalation_low_confidence: 'Escalation — low confidence',
};

export default function AgentLogPanel({ logs, loading, error }: AgentLogPanelProps) {
  const runs = useMemo(() => groupLogsByRun(logs), [logs]);
  const [expandedRuns, setExpandedRuns] = useState<Set<string>>(() => new Set());
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (runs.length > 0) {
      setExpandedRuns((prev) => {
        if (prev.size > 0) return prev;
        return new Set([runs[0].runId]);
      });
    }
  }, [runs]);

  if (loading) {
    return <div className="text-sm text-slate-500">Loading agent logs…</div>;
  }

  if (error) {
    return <div className="text-sm text-red-400">{error}</div>;
  }

  if (runs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-800 px-4 py-8 text-center text-sm text-slate-500">
        No agent logs yet. Logs appear after the first classification and are kept for 30 days.
      </div>
    );
  }

  function toggleRun(runId: string) {
    setExpandedRuns((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  }

  function toggleStep(stepKey: string) {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(stepKey)) next.delete(stepKey);
      else next.add(stepKey);
      return next;
    });
  }

  return (
    <div className="space-y-3">
      {runs.map((run) => {
        const runOpen = expandedRuns.has(run.runId);
        return (
          <div key={run.runId} className="overflow-hidden rounded-lg border border-slate-800 bg-slate-950/50">
            <button
              type="button"
              className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm hover:bg-slate-900/60"
              onClick={() => toggleRun(run.runId)}
            >
              {runOpen ? (
                <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
              ) : (
                <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" />
              )}
              <span className="font-medium text-slate-200">
                {run.trigger === 'reclassify' ? 'Reclassify' : 'Poll'} run
              </span>
              <span className="text-xs text-slate-500">{formatDate(run.createdAt)}</span>
              <span className="ml-auto text-xs text-slate-500">
                {run.steps.length} step{run.steps.length === 1 ? '' : 's'}
              </span>
            </button>

            {runOpen && (
              <div className="space-y-2 border-t border-slate-800 px-4 py-3">
                {run.steps[0] && (
                  <EmailMetaBlock
                    messageId={run.steps[0].messageId}
                    meta={run.steps[0].emailMeta}
                  />
                )}
                {run.steps.map((step) => {
                  const stepKey = `${run.runId}-${step.step}`;
                  const stepOpen = expandedSteps.has(stepKey);
                  return (
                    <div
                      key={step._id}
                      className={cn(
                        'rounded-lg border',
                        step.selectedAsFinal
                          ? 'border-brand-700/50 bg-brand-950/20'
                          : 'border-slate-800 bg-slate-900/40',
                      )}
                    >
                      <button
                        type="button"
                        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left text-sm"
                        onClick={() => toggleStep(stepKey)}
                      >
                        {stepOpen ? (
                          <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
                        ) : (
                          <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" />
                        )}
                        <span className="font-medium">Step {step.step}</span>
                        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-300">
                          {shortModelName(step.model)}
                        </span>
                        <span className="text-xs text-slate-500">{REASON_LABELS[step.reason]}</span>
                        {step.selectedAsFinal && (
                          <span className="rounded bg-brand-900/60 px-1.5 py-0.5 text-xs text-brand-200">
                            Final
                          </span>
                        )}
                        {step.output.parseSuccess ? (
                          <span className="text-xs text-emerald-400">Parsed OK</span>
                        ) : (
                          <span className="text-xs text-amber-400">Parse failed</span>
                        )}
                        {step.output.error && (
                          <span className="text-xs text-red-400">API error</span>
                        )}
                      </button>

                      {stepOpen && (
                        <div className="space-y-3 border-t border-slate-800 px-3 py-3 text-xs">
                          <LogBlock title="System prompt" content={step.input.systemPrompt} />
                          <LogBlock title="User prompt" content={step.input.userPrompt} />
                          <LogBlock title="Raw output" content={step.output.raw || '(empty)'} mono />
                          {step.output.parsed && (
                            <LogBlock
                              title="Parsed output"
                              content={JSON.stringify(step.output.parsed, null, 2)}
                              mono
                            />
                          )}
                          {step.output.error && (
                            <LogBlock title="Error" content={step.output.error} error />
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function LogBlock({
  title,
  content,
  mono,
  error,
}: {
  title: string;
  content: string;
  mono?: boolean;
  error?: boolean;
}) {
  return (
    <div>
      <div className="mb-1 font-medium text-slate-500">{title}</div>
      <pre
        className={cn(
          'max-h-64 overflow-auto rounded-md p-3 text-slate-300',
          mono ? 'font-mono text-[11px] leading-relaxed' : 'whitespace-pre-wrap text-xs leading-relaxed',
          error ? 'bg-red-950/30 text-red-300' : 'bg-slate-950',
        )}
      >
        {content}
      </pre>
    </div>
  );
}

function EmailMetaBlock({
  messageId,
  meta,
}: {
  messageId: string;
  meta?: AgentStepLogRecord['emailMeta'];
}) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3 text-xs">
      <div className="mb-2 font-medium text-slate-400">Mail headers (snapshot)</div>
      <dl className="grid gap-2 sm:grid-cols-2">
        <MetaRow label="From">
          {meta?.fromName ? `${meta.fromName} <${meta.fromEmail}>` : (meta?.fromEmail || '—')}
        </MetaRow>
        <MetaRow label="To">{meta?.toField || '—'}</MetaRow>
        <MetaRow label="CC">{meta?.ccField || '—'}</MetaRow>
        <MetaRow label="Subject">{meta?.subject || '—'}</MetaRow>
        <MetaRow label="Gmail message ID">
          <code className="break-all text-[11px]">{messageId}</code>
        </MetaRow>
        <MetaRow label="Gmail thread ID">
          <code className="break-all text-[11px]">{meta?.threadId || '—'}</code>
        </MetaRow>
      </dl>
    </div>
  );
}

function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-slate-300">{children}</dd>
    </div>
  );
}

function groupLogsByRun(logs: AgentStepLogRecord[]) {
  const map = new Map<string, { runId: string; trigger: AgentStepLogRecord['trigger']; createdAt: string; steps: AgentStepLogRecord[] }>();

  for (const log of logs) {
    const existing = map.get(log.runId);
    if (existing) {
      existing.steps.push(log);
    } else {
      map.set(log.runId, {
        runId: log.runId,
        trigger: log.trigger,
        createdAt: log.createdAt,
        steps: [log],
      });
    }
  }

  return [...map.values()]
    .map((run) => ({
      ...run,
      steps: [...run.steps].sort((a, b) => a.step - b.step),
    }))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}
