'use client';

import { useState, useEffect } from 'react';
import { SessionWorkspace } from '@/components/session-workspace';

// Generate a random session ID
function generateSessionId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export default function Home() {
  const [sessionId, setSessionId] = useState<string>('');

  useEffect(() => {
    // Get session ID from URL hash or generate a new one
    const hash = window.location.hash.slice(1);
    const id = hash || generateSessionId();
    setSessionId(id);

    // Update URL hash if needed
    if (!hash) {
      window.location.hash = id;
    }
  }, []);

  if (!sessionId) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-[#0d1117]">
        <div className="text-[#8b949e] text-sm">Initializing session...</div>
      </div>
    );
  }

  return (
    <SessionWorkspace
      sessionId={sessionId}
      websocketUrl="ws://localhost:3001"
    />
  );
}
