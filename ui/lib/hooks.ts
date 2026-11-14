import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { request } from './api';
import type { ConfigResponse, Metrics } from './types';

/** Re-renders on an interval so relative times and uptimes stay current. */
export function useNow(interval = 1000) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), interval); return () => clearInterval(timer); }, [interval]);
  return now;
}

export const useMetrics = () => useQuery({ queryKey: ['metrics'], queryFn: () => request<Metrics>('/api/metrics'), refetchInterval: 5000 });

export const useConfig = () => useQuery({ queryKey: ['config'], queryFn: () => request<ConfigResponse>('/api/config'), staleTime: 30_000 });
