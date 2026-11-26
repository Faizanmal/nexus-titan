import Link from "next/link";

export default function OfflinePage() {
  return <main className="mx-auto max-w-3xl space-y-3 p-8"><h1 className="text-3xl font-semibold">Offline session</h1><p>This prepared app shell is available. Sign in and tenant authorization must have been established before disconnecting.</p><Link className="underline" href="/fieldrelay">Open FieldRelay</Link></main>;
}
