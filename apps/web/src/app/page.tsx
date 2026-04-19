'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const apiUrl: string =
      ((globalThis as any)['process']?.env?.['NEXT_PUBLIC_API_URL'] as string | undefined) ?? 'http://localhost:3001';

    async function createSession() {
      try {
        const res = await fetch(`${apiUrl}/api/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        if (!res.ok) {
          throw new Error(`Failed to create session: ${res.status}`);
        }
        const data = (await res.json()) as { id: string };
        router.push(`/${data.id}`);
      } catch (err) {
        console.error('[ArielCharts] Failed to create session:', err);
        // Show inline error rather than crashing
      }
    }

    void createSession();
  }, [router]);

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0d1117',
        color: '#8b949e',
        fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace",
        fontSize: '13px',
      }}
    >
      Creating session…
    </div>
  );
}
