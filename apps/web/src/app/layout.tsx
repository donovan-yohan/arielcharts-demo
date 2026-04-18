import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ArielCharts - Collaborative Mermaid Diagram Editor',
  description: 'Real-time collaborative Mermaid diagram editor for humans and AI agents',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
