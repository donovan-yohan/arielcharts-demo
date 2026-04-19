import { NextRequest, NextResponse } from 'next/server';

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? 'http://localhost:3001';

export async function POST(_req: NextRequest) {
  const res = await fetch(`${SERVER_URL}/sessions`, { method: 'POST' });
  const data = await res.json();
  return NextResponse.json(data);
}

export async function GET() {
  const res = await fetch(`${SERVER_URL}/sessions`);
  const data = await res.json();
  return NextResponse.json(data);
}
