import { redirect } from "next/navigation";
import { login } from "../actions";
import { ActionForm, SubmitButton } from "../controls";
import { authPassword, safeNext } from "../lib/auth";
import { FlashNotice, Shell } from "../ui";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ notice?: string; tone?: string; next?: string }> }) {
  const params = await searchParams;
  if (!authPassword()) redirect("/");
  const next = safeNext(params.next);
  return <Shell title="Sign in" eyebrow="Cenblue / access">
    <section className="panel form-panel login-panel">
      <div className="panel-head"><div><p className="eyebrow">Protected workspace</p><h3>Enter the dashboard password</h3></div></div>
      <FlashNotice notice={params.notice} tone={params.tone} />
      <p className="form-note">This dashboard is locked with the <code>DASHBOARD_PASSWORD</code> from your environment. Publishing, deleting, and resetting actions also ask you to confirm the password every 15 minutes.</p>
      <ActionForm action={login} id="login-form" className="form-panel">
        <input type="hidden" name="next" value={next} />
        <label>Password<input name="password" type="password" autoComplete="current-password" required autoFocus /></label>
        <SubmitButton className="button primary" pending="Signing in…">Sign in</SubmitButton>
      </ActionForm>
    </section>
  </Shell>;
}
