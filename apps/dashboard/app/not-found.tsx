import Link from "next/link";

export default function NotFound() {
  return (
    <main className="route-error">
      <p className="eyebrow">Error 404</p>
      <h1>Page not found<span aria-hidden="true">.</span></h1>
      <p className="page-description">That route does not exist in this workspace. It may have moved, or the link may be out of date.</p>
      <div className="actions">
        <Link className="button primary" href="/">Back to overview</Link>
        <Link className="button" href="/logs">Open logs</Link>
      </div>
    </main>
  );
}
