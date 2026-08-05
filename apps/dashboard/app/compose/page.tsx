import { publishManualPost } from "../actions";
import { ActionForm, ConfirmSubmitButton } from "../controls";
import { getSettings } from "../lib/data";
import { Badge, Shell } from "../ui";

export const dynamic = "force-dynamic";

export default async function ComposePage({ searchParams }: { searchParams: Promise<{ published?: string; url?: string; error?: string }> }) {
  const [params, settings] = await Promise.all([searchParams, getSettings()]);
  const publishers = settings.identities.filter((identity) => identity.role === "PUBLISHER" && identity.enabled);
  return <Shell title="Compose" eyebrow="Cenblue / original post">
    <div className="compose-workspace">
      <section className="panel compose-panel">
        <div className="panel-head"><div><p className="eyebrow">Manual publishers</p><h3>Write once. Choose exact identities.</h3></div><Badge value={publishers.some((identity) => identity.verified) ? "AVAILABLE" : "WARN"} /></div>
        <p className="form-note">Selected Publisher identities execute separately and verify their active X account before posting.</p>
        {params.error && <div className="toast error" role="alert">{params.error}</div>}
        {params.published === "1" && <div className="toast bookmark-success" role="status">Post published successfully.{params.url && <> <a className="text-link" href={params.url} target="_blank" rel="noreferrer">Open on X ↗</a></>}</div>}
        <ActionForm action={publishManualPost} className="stack-form manual-compose-form">
          <label>Post text <span className="input-suffix">280 characters maximum</span><textarea name="text" rows={9} maxLength={280} placeholder="What do you want to share?" required /></label>
          <label>Optional image <span className="input-suffix">JPEG, PNG, WebP, or GIF · 10 MB maximum</span><input name="image" type="file" accept="image/jpeg,image/png,image/webp,image/gif" /></label>
          <fieldset className="publisher-targets"><legend>Publish to</legend>{publishers.map((publisher) => <label key={publisher.id}><input type="checkbox" name="publisherIdentityId" value={publisher.id} /><span>{publisher.label} (@{publisher.expectedUsername}){publisher.verified ? "" : " · needs verification"}</span></label>)}</fieldset>
          <ConfirmSubmitButton className="button primary" pendingLabel="Publishing…" message="Publish this text and optional image to X now?">Review and publish</ConfirmSubmitButton>
        </ActionForm>
      </section>
      <aside className="panel compose-note"><p className="eyebrow">Before posting</p><h3>Direct means immediate.</h3><p>Manual posts bypass the video review queue and publish as soon as the browser confirms submission.</p><p className="form-note">If X accepts the post but its final URL cannot be confirmed, inspect the account before trying again to avoid duplicates.</p></aside>
    </div>
  </Shell>;
}
