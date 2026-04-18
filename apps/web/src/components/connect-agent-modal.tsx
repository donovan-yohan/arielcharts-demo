'use client';

import { useState } from 'react';
import { X, Copy, CheckCircle } from 'lucide-react';

interface ConnectAgentModalProps {
  sessionId: string;
  onClose: () => void;
}

export function ConnectAgentModal({ sessionId, onClose }: ConnectAgentModalProps) {
  const [copied, setCopied] = useState(false);

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://arielcharts-server.fly.dev';

  const promptText = `Connect to my ArielCharts session "${sessionId}" using the MCP server at ${origin}/mcp. You can read and write Mermaid diagrams collaboratively in real-time. Look up your docs for how to add an MCP server globally.`;

  const handleCopy = () => {
    navigator.clipboard.writeText(promptText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      className="modal-backdrop"
      onClick={handleBackdropClick}
    >
      <div className="modal-content">
        <div className="modal-header">
          <h2 className="modal-title">Connect your agent</h2>
          <button
            onClick={onClose}
            className="modal-close"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-sm text-[#8b949e] mb-4">
          Share this prompt with your AI agent to enable collaborative diagram editing:
        </p>

        <div className="code-block">
          <pre className="whitespace-pre-wrap break-words pr-20">{promptText}</pre>
          <button
            onClick={handleCopy}
            className="code-block-copy"
          >
            {copied ? (
              <>
                <CheckCircle className="w-3.5 h-3.5 text-green-400" />
                <span className="text-green-400">Copied!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>

        <div className="mt-4 text-xs text-[#8b949e]">
          <p className="mb-2">Agent configuration example:</p>
          <div className="code-block !p-3 !text-xs">
            <pre>{`{
  "mcpServers": {
    "arielcharts": {
      "type": "streamable-http",
      "url": "${origin}/mcp"
    }
  }
}`}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}
