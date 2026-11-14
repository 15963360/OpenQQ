import { useMemo, useState } from 'react';
import { setSearchParam, useSearchParam } from './router';
import { useStream } from './stream';
import type { Entry } from './types';

/** Pause / clear / detail state shared by the event and log viewers. Clearing only hides entries in this view. */
export function useStreamView() {
  const entries = useStream(state => state.entries);
  const [paused, setPaused] = useState<Entry[] | null>(null);
  const [cutoff, setCutoff] = useState(0);
  const detailId = Number(useSearchParam('e')) || null;
  const source = paused ?? entries;
  const visible = useMemo(() => source.filter(entry => entry.id > cutoff), [source, cutoff]);
  const detail = detailId ? entries.find(entry => entry.id === detailId) ?? null : null;
  const pending = paused ? entries.filter(entry => entry.id > (paused.at(-1)?.id ?? 0)).length : 0;
  return {
    entries: visible, paused: Boolean(paused), pending, detail, detailMissing: Boolean(detailId && !detail),
    togglePause: () => setPaused(current => current ? null : entries.slice()),
    clear: () => { setCutoff(entries.at(-1)?.id ?? 0); setPaused(null); },
    open: (entry: Entry) => setSearchParam('e', String(entry.id)),
    close: () => setSearchParam('e', null),
  };
}
