import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const timeFormat = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const dateTimeFormat = new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

export const formatTime = (value: string | number | Date) => timeFormat.format(new Date(value));
export const formatDateTime = (value: string | number | Date) => dateTimeFormat.format(new Date(value));
export function formatTimeMs(value: string | number | Date) {
  const date = new Date(value);
  return timeFormat.format(date) + '.' + String(date.getMilliseconds()).padStart(3, '0');
}

export function formatRelative(value: string | number | Date, now = Date.now()) {
  const seconds = Math.round((now - new Date(value).getTime()) / 1000);
  if (seconds < 5) return '刚刚';
  if (seconds < 60) return seconds + ' 秒前';
  if (seconds < 3600) return Math.floor(seconds / 60) + ' 分钟前';
  if (seconds < 86400) return Math.floor(seconds / 3600) + ' 小时前';
  return formatDateTime(value);
}

export function formatDuration(totalSeconds: number) {
  const days = Math.floor(totalSeconds / 86400), hours = Math.floor(totalSeconds % 86400 / 3600);
  const minutes = Math.floor(totalSeconds % 3600 / 60), seconds = Math.floor(totalSeconds % 60);
  if (days) return `${days} 天 ${hours} 小时`;
  if (hours) return `${hours} 小时 ${minutes} 分`;
  if (minutes) return `${minutes} 分 ${seconds} 秒`;
  return `${seconds} 秒`;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return bytes + ' B';
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024, unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return value.toFixed(value >= 100 ? 0 : 1) + ' ' + units[unit];
}

export const formatNumber = (value: number) => value.toLocaleString('zh-CN');

export function formatMs(value: number | null | undefined) {
  if (value == null) return '—';
  return value >= 1000 ? (value / 1000).toFixed(2) + ' s' : Math.round(value) + ' ms';
}

export function randomHex(bytes = 32) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
}

export function isEditableTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  return Boolean(element && (element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)));
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const modKey = isMac ? '⌘' : 'Ctrl';
