import { addSource, archiveSource, assignSourceCollector, collectAllSources, collectBookmarks, collectSelectedSources, collectSource, purgeSource, restoreSource, toggleSource, updateSourceCaptionSettings, updateSourceLimit } from "../actions";
import { ActionForm, CollectionButton, CollectionProgress, ConfirmSubmitButton, SubmitButton } from "../controls";
import { getRuntimeSettings, getSources } from "../lib/data";
import { formatInTimeZone } from "../lib/schedule";
import { Badge, Empty, FlashNotice, Shell } from "../ui";

export const dynamic = "force-dynamic";

export default async function SourcesPage({ searchParams }: { searchParams: Promise<{ bookmarkInserted?: string; bookmarkDuplicates?: string; bookmarkError?: string }> }) {
  const params = await searchParams;
  const [sources, settings] = await Promise.all([getSources(), getRuntimeSettings()]);
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
          <label>Collector identity<select name="collectorIdentityId" required>{enabledCollectors.map((identity) => <option key={identity.id} value={identity.id}>{identity.label}{identity.expectedUsername ? ` (@${identity.expectedUsername})` : ""}</option>)}</select></label>
          <SubmitButton className="button primary" pending="Adding…">Add source <span>＋</span></SubmitButton>
        </ActionForm>
        <p className="form-note">The collector skips previously stored post IDs and continues until this many new posts are found or X history/safety limits are reached. The global cap is {settings.postsPerSource}.</p>
        <div className="bookmark-collector"><p className="eyebrow">Collector account</p><h3>Saved bookmarks</h3><p className="form-note">Bookmark access belongs to the selected isolated Collector identity.</p><ActionForm action={collectBookmarks} className="stack-form"><label>Collector identity<select name="collectorIdentityId" required>{enabledCollectors.map((identity) => <option key={identity.id} value={identity.id}>{identity.label}{identity.expectedUsername ? ` (@${identity.expectedUsername})` : ""}</option>)}</select></label><label>New bookmarked videos requested<input name="bookmarkLimit" type="number" min="1" max="100" defaultValue={settings.postsPerSource} required /></label><SubmitButton className="button primary" pending="Scanning bookmarks…">Collect bookmarks <span>↓</span></SubmitButton></ActionForm>{params.bookmarkError && <FlashNotice notice={params.bookmarkError} tone="error" />}{params.bookmarkInserted !== undefined && <FlashNotice>Added {Number(params.bookmarkInserted)} new video{Number(params.bookmarkInserted) === 1 ? "" : "s"}. Skipped {Number(params.bookmarkDuplicates ?? 0)} duplicate{Number(params.bookmarkDuplicates ?? 0) === 1 ? "" : "s"}.</FlashNotice>}</div>
      </section>

      <section className="panel">
        <div className="panel-head"><div><p className="eyebrow">Configured accounts</p><h3>{active.length} active source{active.length === 1 ? "" : "s"}</h3></div><div className="actions"><span className="count-chip">max {settings.sourceAccountLimit} enabled</span><ActionForm action={collectAllSources}><CollectionButton className="small-button accent-button">Collect all enabled</CollectionButton></ActionForm></div></div><CollectionProgress />
        {active.length === 0 ? <Empty>Add or restore a source account to begin collecting.</Empty> : <div className="source-list">{active.map((source) =>
            <div className="source-row" key={source.id}>
            {source.enabled && <input form="collect-selected" type="checkbox" name="sourceId" value={source.id} aria-label={`Select @${source.username} for collection`} />}
            <div className="avatar">{source.username[0].toUpperCase()}</div>
            <div className="source-main"><strong><a className="text-link" href={source.profileUrl} target="_blank" rel="noreferrer">@{source.username} ↗</a></strong><small>{source._count.posts} posts · Collector: {source.collectorIdentity?.label ?? "Unassigned"} · effective limit {Math.min(source.collectLimit, Number(settings.postsPerSource))} · last run {source.lastCollectedAt ? formatInTimeZone(source.lastCollectedAt, settings.timezone) : "never"}</small>{source.lastCollectionError && <p className="error-line">{source.lastCollectionError}</p>}</div>
            <Badge value={source.enabled ? "ENABLED" : "DISABLED"} />
            <div className="source-actions">
              <ActionForm action={toggleSource}><input type="hidden" name="sourceId" value={source.id} /><SubmitButton className="icon-button" pending="…">{source.enabled ? "Disable" : "Enable"}</SubmitButton></ActionForm>
              {source.enabled && <ActionForm action={collectSource}><input type="hidden" name="sourceId" value={source.id} /><CollectionButton>Collect</CollectionButton></ActionForm>}
            </div>
            <details className="manage-panel"><summary>Manage source</summary><div className="manage-grid">
              <ActionForm action={updateSourceLimit} className="stack-form"><label>New posts per run<input name="collectLimit" type="number" defaultValue={source.collectLimit} min="1" max="100" required /></label><input type="hidden" name="sourceId" value={source.id} /><SubmitButton>Save limit</SubmitButton></ActionForm>
              <ActionForm action={assignSourceCollector} className="stack-form"><label>Collector identity<select name="collectorIdentityId" defaultValue={source.collectorIdentityId ?? ""}><option value="">Unassigned</option>{collectors.map((identity) => <option key={identity.id} value={identity.id}>{identity.label}{identity.enabled ? "" : " (paused)"}</option>)}</select></label><input type="hidden" name="sourceId" value={source.id} /><SubmitButton>Assign collector</SubmitButton></ActionForm>
              <ActionForm action={updateSourceCaptionSettings} className="stack-form"><label>Caption template<textarea name="captionTemplate" maxLength={2000} defaultValue={source.captionTemplate ?? ""} placeholder="Uses global rotation when empty" /></label><label>Attribution<textarea name="attributionTemplate" maxLength={1000} defaultValue={source.attributionTemplate ?? ""} placeholder="Source: {sourceUsername}" /></label><label>Hashtags<input name="hashtagRules" maxLength={1000} defaultValue={source.hashtagRules ?? ""} placeholder="video, repost" /></label><input type="hidden" name="sourceId" value={source.id} /><SubmitButton>Save caption rules</SubmitButton></ActionForm>
              <ActionForm action={archiveSource} className="stack-form"><p className="form-note">Archiving preserves post history and local media. Restore the source later from the preserved list.</p><input type="hidden" name="sourceId" value={source.id} /><ConfirmSubmitButton message={`Archive @${source.username}? Its history and media will be preserved.`}>Archive source</ConfirmSubmitButton></ActionForm>
            </div></details>
          </div>)}</div>}
        <ActionForm id="collect-selected" action={collectSelectedSources} className="bulk-source-actions"><CollectionButton>Collect selected</CollectionButton></ActionForm></section>
    </div>

    {archived.length > 0 && <section className="panel">
      <div className="panel-head"><div><p className="eyebrow">Preserved history</p><h3>{archived.length} archived source{archived.length === 1 ? "" : "s"}</h3></div></div>
      <div className="source-list">{archived.map((source) => <div className="source-row" key={source.id}>
        <div className="avatar">{source.username[0].toUpperCase()}</div>
        <div className="source-main"><strong><a className="text-link" href={source.profileUrl} target="_blank" rel="noreferrer">@{source.username} ↗</a></strong><small>{source._count.posts} posts preserved · archived {formatInTimeZone(source.archivedAt!, settings.timezone)}</small></div>
        <Badge value="ARCHIVED" />
        <div className="source-actions"><ActionForm action={restoreSource}><input type="hidden" name="sourceId" value={source.id} /><SubmitButton>Restore</SubmitButton></ActionForm></div>
        <details className="manage-panel"><summary>Permanent removal</summary><ActionForm action={purgeSource} className="stack-form"><input type="hidden" name="sourceId" value={source.id} /><label>Type @{source.username} to confirm<input name="confirmedUsername" placeholder={source.username} required pattern={source.username} /></label><ConfirmSubmitButton message={`Permanently purge @${source.username}, all related records, videos, and thumbnails? This cannot be undone.`}>Purge permanently</ConfirmSubmitButton></ActionForm></details>
      </div>)}</div>
    </section>}
  </Shell>;
}
