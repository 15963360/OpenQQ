import { memo, useMemo, type ReactNode } from 'react';
import { Copy } from 'lucide-react';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { copyText } from './ui/toast';
import { Tooltip } from './ui/overlay';

const token = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

function highlight(text: string): ReactNode[] {
  if (text.length > 200_000) return [text];
  const parts: ReactNode[] = [];
  let last = 0, index = 0;
  for (const match of text.matchAll(token)) {
    const start = match.index ?? 0;
    if (start > last) parts.push(text.slice(last, start));
    const [value, string, colon, literal] = match;
    if (string) {
      parts.push(<span key={index++} className={colon ? 'json-key' : 'json-string'}>{string}</span>);
      if (colon) parts.push(colon);
    } else parts.push(<span key={index++} className={literal ? 'json-literal' : 'json-number'}>{value}</span>);
    last = start + value.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

interface JsonViewProps { value: unknown; className?: string; maxHeight?: string; copyLabel?: string; bare?: boolean }

/** Read-only, syntax-highlighted JSON. Text is rendered as React text nodes, never as HTML. */
export const JsonView = memo(function JsonView({ value, className, maxHeight = '28rem', copyLabel = '复制 JSON', bare }: JsonViewProps) {
  const text = useMemo(() => typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? 'undefined', [value]);
  const content = useMemo(() => highlight(text), [text]);
  return <div className={cn('group relative min-w-0', !bare && 'rounded-lg border bg-muted/50', className)}>
    <pre className="overflow-auto p-3.5 font-mono text-xs leading-5 text-foreground [overflow-wrap:anywhere] whitespace-pre-wrap" style={{ maxHeight }} tabIndex={0} aria-label="JSON 内容">{content}</pre>
    <Tooltip content={copyLabel}>
      <Button variant="outline" size="icon-xs" className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100" aria-label={copyLabel} onClick={() => copyText(text)}><Copy /></Button>
    </Tooltip>
  </div>;
});
