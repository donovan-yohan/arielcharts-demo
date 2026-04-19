'use client';
import { useEffect, useState } from 'react';
import { SessionWorkspace } from '@/components/session-workspace';

export default function HomePage() {
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    const hash = window.location.hash.replace('#', '');
    if (hash && /^[a-z0-9_-]{6,32}$/.test(hash)) {
      setSessionId(hash);
    } else {
      fetch('/api/sessions', { method: 'POST' })
        .then(r => r.json())
        .then(({ id }) => {
          window.location.hash = id;
          setSessionId(id);
        });
    }
  }, []);

  if (!sessionId) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--text-secondary)' }}>
        Loading…
      </div>
    );
  }

  return <SessionWorkspace sessionId={sessionId} />;
}
