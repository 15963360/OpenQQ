import type { Entry, Segment } from './lib/types';

export type EntryKind = 'message' | 'notice' | 'request' | 'action' | 'diagnostic';
export interface EntryDescription { kind: EntryKind; title: string; text: string; source: string; failed?: boolean }
export type LogLevel = 'error' | 'warn' | 'info' | 'success' | 'debug';

export function segmentText(message: Segment[] | string | unknown): string;
export function describeEntry(entry: Pick<Entry, 'kind' | 'data'>): EntryDescription;
export function describeLog(entry: Pick<Entry, 'data'>): { level: LogLevel; message: string };
export function identifier(value: unknown): number;
export function messageRequest(values: { targetType: 'private' | 'group'; target: unknown; message: string }): {
  action: 'send_private_msg' | 'send_group_msg'; params: Record<string, unknown>;
};
export function boundedHistory<T>(entries: T[]): T[];
