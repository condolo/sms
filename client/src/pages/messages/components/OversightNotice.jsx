/* Shown to everyone who can message, only in a school that has given someone
   "Read All Messages (Oversight)" — people should know before they write. */
import { useQuery } from '@tanstack/react-query';
import { Eye } from 'lucide-react';
import { messages as msgsApi } from '@/api/client.js';

export function useOversightStatus() {
  const { data } = useQuery({
    queryKey: ['message-oversight', 'status'],
    queryFn: () => msgsApi.oversight.status(),
    staleTime: 5 * 60_000,
    retry: false,
  });
  return { enabled: !!data?.data?.enabled, canRead: !!data?.data?.canRead };
}

export default function OversightNotice({ className = '' }) {
  const { enabled } = useOversightStatus();
  if (!enabled) return null;
  return (
    <p className={`flex items-start gap-1.5 text-[11px] leading-snug text-slate-500 ${className}`}>
      <Eye size={12} className="mt-px shrink-0" />
      Messages between families and staff can be read by staff the school has authorised.
    </p>
  );
}
