import { addSource, archiveSource, assignSourceCollector, collectAllSources, collectBookmarks, collectSelectedSources, collectSource, purgeSource, restoreSource, toggleSource, updateSourceCaptionSettings, updateSourceLimit } from "../actions";
import { ActionForm, CollectionButton, CollectionProgress, ConfirmSubmitButton, SubmitButton } from "../controls";
import { getSettings, getSources } from "../lib/data";
import { Badge, Empty, Shell } from "../ui";

export const dynamic = "force-dynamic";

export default async function SourcesPage({ searchParams }: { searchParams: Promise<{ bookmarkInserted?: string; bookmarkDuplicates?: string; bookmarkError?: string }> }) {
  const params = await searchParams;
  const [sources, settings] = await Promise.all([getSources(), getSettings()]);
  const active = sources.filter((source) => !source.archivedAt);
  const archived = sources.filter((source) => source.archivedAt);
  const collectors = settings.identities.filter((identity) => identity.role === "COLLECTOR");
  const enabledCollectors = collectors.filter((identity) => identity.enabled);

  return <Shell title="Sources" eyebrow="Cenblue / source accounts">
    <div className="page-grid">
      <section className="panel form-panel">
        <div className="panel-head"><div><p className="eyebrow">New source</p><h3>Add an account</h3></div></div>
        <ActionForm action={addSource} className="stack-form">
          <label>Username<input name="username" placeholder="account_name" required pattern="[A-Za-z0-9_]{1,15}" /></label>
          <label>New posts requested per run<input name="collectLimit" type="number" defaultValue="5" min="1" max="100" required /></label>
          <label>Collector identity<select name="collectorIdentityId" required>{enabledCollectors.map((identity) => <option key={identity.id} value={identity.id}>{identity.label} (@{identity.expectedUsername})</option>)}</select></label>
          <SubmitButton className="button primary" pending="Adding…">Add source <span>＋</span></SubmitButton>
        </ActionForm>
        <p className="form-note">The collector skips previously stored post IDs and continues until this many new posts are found or X history/safety limits are reached. The global cap is {settings.postsPerSource}.</p>
        <div className="bookmark-collector"><p className="eyebrow">Collector account</p><h3>Saved bookmarks</h3><p className="form-note">Bookmark access belongs to the selected isolated Collector identity.</p><ActionForm action={collectBookmarks} className="stack-form"><label>Collector identity<select name="collectorIdentityId" required>{enabledCollectors.map((identity) => <option key={identity.id} value={identity.id}>{identity.label} (@{identity.expectedUsername})</option>)}</select></label><label>New bookmarked videos requested<input name="bookmarkLimit" type="number" min="1" max="100" defaultValue={settings.postsPerSource} required /></label><SubmitButton className="button primary" pending="Scanning bookmarks…">Collect bookmarks <span>↓</span></SubmitButton></ActionForm>{params.bookmarkError && <div className="toast error" role="alert">{params.bookmarkError}</div>}{params.bookmarkInserted !== undefined && <div className="toast bookmark-success" role="status">Added {Number(params.bookmarkInserted)} new video{Number(params.bookmarkInserted) === 1 ? "" : "s"}. Skipped {Number(params.bookmarkDuplicates ?? 0)} duplicate{Number(params.bookmarkDuplicates ?? 0) === 1 ? "" : "s"}.</div>}</div>
      </section>

      <section className="panel">
        <div className="panel-head"><div><p className="eyebrow">Configured accounts</p><h3>{active.length} active source{active.length === 1 ? "" : "s"}</h3></div><div className="actions"><span className="count-chip">max {settings.sourceAccountLimit} enabled</span><ActionForm action={collectAllSources}><CollectionButton className="small-button accent-button">Collect all enabled</CollectionButton></ActionForm></div></div><CollectionProgress />
        {active.length === 0 ? <Empty>Add or restore a source account to begin collecting.</Empty> : <div className="source-list">{active.map((source) =>
            <div className="source-row" key={source.id}>
            {source.enabled && <input form="collect-selected" type="checkbox" name="sourceId" value={source.id} aria-label={`Select @${source.username} for collection`} />}
            <div className="avatar">{source.username[0].toUpperCase()}</div>
            <div className="source-main"><strong><a className="text-link" href={source.profileUrl} target="_blank" rel="noreferrer">@{source.username} ↗</a></strong><small>{source._count.posts} posts · Collector: {source.collectorIdentity?.label ?? "Unassigned"} · effective limit {Math.min(source.collectLimit, Number(settings.postsPerSource))} · last run {source.lastCollectedAt ? new Date(source.lastCollectedAt).toLocaleString() : "never"}</small>{source.lastCollectionError && <p className="error-line">{source.lastCollectionError}</p>}</div>
            <Badge value={source.enabled ? "ENABLED" : "DISABLED"} />
            <ActionForm action={toggleSource}><input type="hidden" name="sourceId" value={source.id} /><SubmitButton className="icon-button" pending="…">{source.enabled ? "Disable source" : "Enable source"}</SubmitButton></ActionForm>
            <ActionForm action={updateSourceLimit} className="inline-form"><input type="hidden" name="sourceId" value={source.id} /><input name="collectLimit" type="number" defaultValue={source.collectLimit} min="1" max="100" required aria-label="Collection limit" /><SubmitButton>Save</SubmitButton></ActionForm>
            <ActionForm action={assignSourceCollector} className="inline-form"><input type="hidden" name="sourceId" value={source.id} /><select name="collectorIdentityId" defaultValue={source.collectorIdentityId ?? ""} aria-label="Collector identity"><option value="">Unassigned</option>{collectors.map((identity) => <option key={identity.id} value={identity.id}>{identity.label}{identity.enabled ? "" : " (paused)"}</option>)}</select><SubmitButton>Assign</SubmitButton></ActionForm>
            {source.enabled && <ActionForm action={collectSource}><input type="hidden" name="sourceId" value={source.id} /><CollectionButton>Collect</CollectionButton></ActionForm>}
            <ActionForm action={archiveSource}><input type="hidden" name="sourceId" value={source.id} /><ConfirmSubmitButton message={`Archive @${source.username}? Its history and media will be preserved.`}>Archive</ConfirmSubmitButton></ActionForm>
            <details><summary>Caption rules</summary><ActionForm action={updateSourceCaptionSettings} className="stack-form"><input type="hidden" name="sourceId" value={source.id} /><label>Template<textarea name="captionTemplate" maxLength={2000} defaultValue={source.captionTemplate ?? ""} placeholder="Uses global rotation when empty" /></label><label>Attribution<textarea name="attributionTemplate" maxLength={1000} defaultValue={source.attributionTemplate ?? ""} placeholder="Source: {sourceUsername}" /></label><label>Hashtags<input name="hashtagRules" maxLength={1000} defaultValue={source.hashtagRules ?? ""} placeholder="video, repost" /></label><SubmitButton>Save rules</SubmitButton></ActionForm></details>
          </div>)}</div>}
        <ActionForm id="collect-selected" action={collectSelectedSources} className="bulk-source-actions"><CollectionButton>Collect selected</CollectionButton></ActionForm></section>
    </div>

    {archived.length > 0 && <section className="panel">
      <div className="panel-head"><div><p className="eyebrow">Preserved history</p><h3>{archived.length} archived source{archived.length === 1 ? "" : "s"}</h3></div></div>
      <div className="source-list">{archived.map((source) => <div className="source-row" key={source.id}>
        <div className="avatar">{source.username[0].toUpperCase()}</div>
        <div className="source-main"><strong><a className="text-link" href={source.profileUrl} target="_blank" rel="noreferrer">@{source.username} ↗</a></strong><small>{source._count.posts} posts preserved · archived {new Date(source.archivedAt!).toLocaleString()}</small></div>
        <Badge value="ARCHIVED" />
        <ActionForm action={restoreSource}><input type="hidden" name="sourceId" value={source.id} /><SubmitButton>Restore</SubmitButton></ActionForm>
        <ActionForm action={purgeSource} className="inline-form"><input type="hidden" name="sourceId" value={source.id} /><input name="confirmedUsername" placeholder={source.username} aria-label={`Type ${source.username} to confirm purge`} required pattern={source.username} /><ConfirmSubmitButton message={`Permanently purge @${source.username}, all related records, videos, and thumbnails? This cannot be undone.`}>Purge permanently</ConfirmSubmitButton></ActionForm>
      </div>)}</div>
    </section>}
  </Shell>;
}
