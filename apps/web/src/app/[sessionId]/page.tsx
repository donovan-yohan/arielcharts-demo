import SessionWorkspace from '../../components/session-workspace';

interface PageProps {
  params: { sessionId: string };
}

export default function SessionPage({ params }: PageProps) {
  return <SessionWorkspace sessionId={params.sessionId} />;
}
