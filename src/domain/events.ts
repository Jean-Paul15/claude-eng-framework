/** Journal d'événements (observabilité). Jamais de contenu de fichier ni de secret. */

export const EVENT_TYPES = [
  'session.start', 'session.end', 'session.interrupted', 'compaction',
  'route.decided', 'plan.computed',
  'task.created', 'task.started', 'task.status', 'task.done', 'task.failed', 'task.blocked',
  'agent.spawn', 'agent.stop', 'agent.report-missing',
  'file.edited', 'guard.verdict',
  'gate.result', 'checkpoint', 'rollback',
  'escalation.opened', 'escalation.resolved',
  'decision.recorded', 'learning.recorded', 'adaptation.applied', 'conflict.detected', 'skill.used',
  'team.chartered',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export interface FrameworkEvent {
  ts: string;
  type: EventType;
  taskId?: string;
  sessionId?: string;
  agentId?: string;
  agentType?: string;
  model?: string;
  data?: Record<string, unknown>;
}
