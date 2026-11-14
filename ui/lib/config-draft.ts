import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from './api';
import { cleanConfig, validateDraft } from './config';
import { useConfig } from './hooks';
import type { ConfigResponse, OpenQQConfig } from './types';

/** Editable copy of the saved configuration; pages edit slices of it and save the whole object. */
export function useConfigDraft() {
  const query = useConfig();
  const client = useQueryClient();
  const [draft, setDraft] = useState<OpenQQConfig | null>(null);
  useEffect(() => { if (query.data && !draft) setDraft(structuredClone(query.data.config)); }, [query.data, draft]);
  const saved = query.data?.config;
  const dirty = useMemo(() => Boolean(draft && saved && JSON.stringify(cleanConfig(draft)) !== JSON.stringify(cleanConfig(saved))), [draft, saved]);
  const issues = useMemo(() => draft ? validateDraft(draft) : {}, [draft]);
  const mutation = useMutation({
    mutationFn: (value: OpenQQConfig) => request<{ config: OpenQQConfig; restartRequired: boolean; message: string }>('/api/config', cleanConfig(value)),
    onSuccess: result => {
      client.setQueryData<ConfigResponse>(['config'], previous => previous ? { ...previous, config: result.config, initialized: true } : previous);
      setDraft(structuredClone(result.config));
    },
  });
  return {
    query, draft, saved, dirty, issues, valid: Object.keys(issues).length === 0,
    update(change: (value: OpenQQConfig) => void) { setDraft(current => { if (!current) return current; const next = structuredClone(current); change(next); return next; }); },
    reset() { if (saved) setDraft(structuredClone(saved)); mutation.reset(); },
    save: () => draft ? mutation.mutateAsync(draft) : Promise.reject(new Error('配置尚未加载')),
    saving: mutation.isPending,
    running: query.data?.running ?? false,
  };
}
