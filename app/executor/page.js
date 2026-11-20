'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useVault } from '../../lib/VaultContext';
import { useVaultRow } from '../../lib/useVaultRow';
import { unlockWithRecoveryKey, decryptRows, looksLikeRecoveryKey } from '../../lib/crypto';
import { ACTIONS } from '../../lib/services';
import AppHeader from '../../components/AppHeader';
import Mark from '../../components/Mark';
import SecretField from '../../components/SecretField';

export default function ExecutorPage() {
  const { vault, ready } = useVaultRow('executor');
  const { vaultKey, setVaultKey, lockedByTimer } = useVault();
  const [recovery, setRecovery] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [entries, setEntries] = useState(null);
  const [done, setDone] = useState([]);
  const [guides, setGuides] = useState({});
  const [current, setCurrent] = useState(-1); // -1 = the "before you begin" page

  const owner = vault?.owner_name || 'Their';
  const ownerPossessive = vault?.owner_name ? `${vault.owner_name}'s` : 'This';

  async function unlock(e) {
    e.preventDefault();
    setMessage('');
    if (!looksLikeRecoveryKey(recovery)) {
      return setMessage('That does not look quite like a recovery key. It has 24 letters and numbers in groups of four, like ABCD-EFGH-… Please check and try again.');
    }
    setBusy(true);
    try {
      const key = await unlockWithRecoveryKey(vault, recovery);
      setVaultKey(key);
      setRecovery('');
      fetch('/api/executor/opened', { method: 'POST' }).catch(() => {});
    } catch {
      setMessage('That did not work. Please check the key and try again, taking your time. If it was replaced recently, you may need the newer copy.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!vaultKey || !vault) return;
    (async () => {
      const { data } = await supabase.from('entries').select('*').eq('vault_id', vault.id).order('created_at');
      setEntries(await decryptRows(vaultKey, data));
      const ids = (data || []).map((r) => r.id);
      if (ids.length) {
        const { data: prog } = await supabase.from('executor_progress').select('entry_id').in('entry_id', ids);
        setDone((prog || []).map((p) => p.entry_id));
      }
      const { data: g } = await supabase.from('guides').select('*');
      setGuides(Object.fromEntries((g || []).map((x) => [x.service_key, x])));
    })();
  }, [vaultKey, vault]);

  async function toggle(id) {
    if (done.includes(id)) {
      const { error } = await supabase.from('executor_progress').delete().eq('entry_id', id);
      if (!error) setDone(done.filter((d) => d !== id));
    } else {
      const { error } = await supabase.from('executor_progress').insert({ entry_id: id });
      if (!error) setDone([...done, id]);
      if (!error && current < entries.length - 1) setTimeout(() => setCurrent(current + 1), 350);
    }
  }

  if (!ready) return null;

  if (!vaultKey) {
    return (
      <>
        <AppHeader role="executor" />
        <main className="narrow">
          <div className="center"><Mark size={56} /></div>
          <h1 className="center" style={{ marginTop: 18 }}>{ownerPossessive} vault</h1>
          {lockedByTimer && <p className="note center">We locked the vault after a quiet spell, to keep it safe. Your progress is saved.</p>}
          {!showForm ? (
            <>
              <p className="lead center">You have been trusted to look after {vault.owner_name ? `${vault.owner_name}'s` : 'their'} everyday accounts.</p>
              <div className="card">
                <h3>If you are setting up</h3>
                <p className="quiet" style={{ marginBottom: 0 }}>There is nothing else to do for now. Your account is ready. Keep the recovery key {vault.owner_name || 'they'} gave you somewhere safe.</p>
              </div>
              <div className="card">
                <h3>If the time has come</h3>
                <p className="quiet">We are very sorry for your loss. There is no rush. When you are ready, you can open the vault with the recovery key.</p>
                <button className="primary" onClick={() => setShowForm(true)}>Open the vault</button>
              </div>
            </>
          ) : (
            <>
              <p className="lead center">Take your time. When you are ready, type the recovery key you were given.</p>
              <form onSubmit={unlock} className="card">
                <label style={{ marginTop: 0 }}>
                  Recovery key
                  <span className="hint">Capital letters and spaces do not matter.</span>
                  <input className="code-input" value={recovery} onChange={(e) => setRecovery(e.target.value)}
                    placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" required autoFocus autoComplete="off" spellCheck={false} />
                </label>
                <button className="primary full" type="submit" disabled={busy}>{busy ? 'Opening… this takes a moment' : 'Open'}</button>
              </form>
              {message && <p className="note warn" role="alert">{message}</p>}
              <p className="quiet small-text center">For safety, {vault.owner_name ? `${vault.owner_name}'s` : 'the owner’s'} email address is sent a short note whenever the vault is opened.</p>
              <p className="center"><button className="link" onClick={() => { setShowForm(false); setMessage(''); }}>Go back</button></p>
            </>
          )}
        </main>
      </>
    );
  }

  const list = entries || [];
  const pct = list.length ? Math.round((done.length / list.length) * 100) : 0;
  const allDone = list.length > 0 && list.every((x) => done.includes(x.id));
  const en = current >= 0 ? list[current] : null;

  return (
    <>
      <AppHeader role="executor" />
      <div className="split">
        <aside aria-label="Services">
          <div className="progress-line">
            <p data-testid="progress">{done.length} of {list.length} services done</p>
            <div className="progress-bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>
          </div>
          <button className={'side' + (current === -1 ? ' on' : '')} onClick={() => setCurrent(-1)}>
            <span className="side-name"><span>Before you begin</span></span>
          </button>
          {list.map((x, i) => (
            <button key={x.id} className={'side' + (i === current ? ' on' : '')} onClick={() => setCurrent(i)}
              aria-label={`${x.name}${done.includes(x.id) ? ', done' : ''}`}>
              <span className="side-name">
                <span className={'tick' + (done.includes(x.id) ? ' done' : '')} aria-hidden="true">{done.includes(x.id) ? '✓' : ''}</span>
                <span>{x.name}</span>
              </span>
            </button>
          ))}
        </aside>

        <section className="detail">
          {!entries && <p className="quiet">Opening the vault…</p>}
          {entries && current === -1 && (
            <Intro owner={owner} count={list.length} allDone={allDone} onStart={() => setCurrent(Math.max(0, list.findIndex((x) => !done.includes(x.id))))} />
          )}
          {en && (
            <Service key={en.id} entry={en} owner={owner} guide={en.service ? guides[en.service] : null}
              isDone={done.includes(en.id)} onToggle={() => toggle(en.id)}
              onPrev={current > 0 ? () => setCurrent(current - 1) : null}
              onNext={current < list.length - 1 ? () => setCurrent(current + 1) : null}
              position={`${current + 1} of ${list.length}`} />
          )}
        </section>
      </div>
    </>
  );
}

function Intro({ owner, count, allDone, onStart }) {
  if (count === 0) {
    return (
      <div className="empty-state">
        <Mark size={60} />
        <h1>There is nothing in this vault yet</h1>
        <p className="lead">{owner === 'Their' ? 'They have' : `${owner} has`} not added any services.</p>
      </div>
    );
  }
  if (allDone) {
    return (
      <div className="empty-state">
        <Mark size={64} />
        <h1>Every service is done</h1>
        <p className="lead">Thank you for taking care of this. It is a kind thing to do.</p>
        <p className="quiet">You can come back and look at anything again whenever you need to.</p>
      </div>
    );
  }
  return (
    <div>
      <h1>Before you begin</h1>
      <p className="lead">There {count === 1 ? 'is 1 service' : `are ${count} services`} here. You do not need to do them all at once.</p>
      <div className="card">
        <p>For each one you will see, in this order:</p>
        <ol className="steps">
          <li>{owner === 'Their' ? 'A note they' : `A note ${owner}`} left for you, if there is one.</li>
          <li>What {owner === 'Their' ? 'they' : owner} wanted to happen: keep it going, transfer it, or close it.</li>
          <li>The login details, hidden until you choose to see them.</li>
          <li>Clear steps to follow.</li>
        </ol>
        <p style={{ marginBottom: 0 }}>Mark each one as done when you have finished. Your progress is saved, so you can stop and come back at any time.</p>
      </div>
      <div className="actions"><button className="primary" onClick={onStart}>Begin</button></div>
    </div>
  );
}

function Service({ entry, owner, guide, isDone, onToggle, onPrev, onNext, position }) {
  const [view, setView] = useState(entry.action || 'close');
  if (entry.unreadable) {
    return <p className="note warn">This entry could not be read. It may have been saved with an older key.</p>;
  }
  const guideSteps = guide ? guide[`steps_${view}`] || [] : [];
  const own = entry.steps || [];
  const who = owner === 'Their' ? 'They' : owner;

  return (
    <article>
      <p className="quiet small-text" style={{ margin: '0 0 6px' }}>Service {position}</p>
      <div className="detail-head">
        <div>
          <h1>{entry.name}</h1>
          <p className="wish">{who === 'They' ? 'Their' : `${owner}'s`} wish: <strong>{ACTIONS[entry.action]?.label}</strong></p>
        </div>
        {isDone && <span className="pill done">Done</span>}
      </div>

      {entry.note && (
        <div className="notebox"><span className="label">A note left for you</span><p>{entry.note}</p></div>
      )}

      <div className="card">
        <SecretField label="Username or email" value={entry.username} />
        <SecretField label="Password or code" value={entry.secret} secret />
        {entry.website && <SecretField label="Website or where to find it" value={entry.website} />}
      </div>

      <h2>Steps</h2>
      {guide && (
        <>
          <div className="tabs" role="group" aria-label="Which steps to show">
            {Object.entries(ACTIONS).map(([k, a]) => (
              <button key={k} className={view === k ? 'on' : ''} aria-pressed={view === k} onClick={() => setView(k)}>
                {a.short}{k === entry.action ? ' (their wish)' : ''}
              </button>
            ))}
          </div>
          {guideSteps.length > 0
            ? <ol className="steps">{guideSteps.map((s, i) => <li key={i}>{s}</li>)}</ol>
            : <p className="quiet">{guide.service_name} does not offer a way to do this. Try one of the other options, or contact them directly.</p>}
        </>
      )}
      {own.length > 0 && (
        <>
          {guide && <h3>{who === 'They' ? 'Their' : `${owner}'s`} own steps</h3>}
          <ol className="steps">{own.map((s, i) => <li key={i}>{s}</li>)}</ol>
        </>
      )}
      {!guide && own.length === 0 && (
        <p className="quiet">No steps were left for this one. The company&apos;s own help pages are the best place to start: search for &ldquo;{entry.name} account of someone who has died&rdquo;.</p>
      )}
      {guide && (
        <p className="source-line">
          Last checked {guide.checked_at ? new Date(guide.checked_at).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : 'recently'}.{' '}
          Companies change their processes, so if anything looks different{guide.help_url ? <>, <a href={guide.help_url} target="_blank" rel="noreferrer">{guide.service_name}&apos;s own help page</a> has the final word</> : ', their own help pages have the final word'}.
        </p>
      )}

      <div className="actions" style={{ marginTop: 32 }}>
        <button className={isDone ? 'secondary' : 'primary'} onClick={onToggle}>{isDone ? 'Mark as not done' : 'Mark this as done'}</button>
        {onPrev && <button className="ghost" onClick={onPrev}>Previous</button>}
        {onNext && <button className="ghost" onClick={onNext}>Next service</button>}
      </div>
    </article>
  );
}
