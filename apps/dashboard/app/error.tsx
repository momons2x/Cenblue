"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="route-error"><h1>Something went wrong</h1><p>The dashboard could not complete that request. Check Logs if this keeps happening.</p><button className="button primary" onClick={reset}>Try again</button></main>;
}
