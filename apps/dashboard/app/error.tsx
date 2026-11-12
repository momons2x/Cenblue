"use client";

import Link from "next/link";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="route-error">
      <p className="eyebrow">Cenblue / runtime error</p>
      <h1>Something went wrong<span aria-hidden="true">.</span></h1>
      <p className="page-description">The dashboard could not complete that request. Try again, then check Logs if the problem keeps happening.</p>
      {error.digest && <p className="error-line">Digest {error.digest}</p>}
      <div className="actions">
        <button className="button primary" onClick={reset}>Try again</button>
        <Link className="button" href="/">Back to overview</Link>
        <Link className="button" href="/logs">Open logs</Link>
      </div>
    </main>
  );
}
