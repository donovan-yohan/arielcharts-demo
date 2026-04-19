import { redirect } from 'next/navigation';

export default function Home() {
  redirect(`/s/${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`);
}
