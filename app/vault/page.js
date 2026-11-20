'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '../../lib/supabase';
import { useVault } from '../../lib/VaultContext';
import { useVaultRow } from '../../lib/useVaultRow';
import { unlockWithPassphrase, encryptEntry, decryptRows } from '../../lib/crypto';
import { POPULAR_SERVICES, CUSTOM_IDEAS, ACTIONS, findService, looksFinancial } from '../../lib/services';
import AppHeader from '../../components/AppHeader';
import Mark from '../../components/Mark';
import SecretField from '../../components/SecretField';
import StepEditor from '../../components/StepEditor';
import Toast, { useToast } from '../../components/Toast';

const blank = { service: 'custom', name: '', username: '', secret: '', website: '', note: '', action: 'keep', steps: [] };

export default function VaultPage() {
  const { vault, ready } = useVaultRow('owner');
  const { vaultKey, setVaultKey, lockedByTimer } = useVault();
  const [pass, setPass] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [entries, setEntries] = useState(null);
  const [guides, setGuides] = useState({});
  const [selected, setSelected] = useState(null); // entry id
  const [form, setForm] = useState(null);         // entry being added or edited
  const [picking, setPicking] = useState(false);  // choosing which service to add
  const [welcome, setWelcome] = useState(false);
  const [toast, show] = useToast();

  useEffect(() => {
    setWelcome(new URLSearchParams(window.location.search).get('welcome') === '1');
  }, []);

  async function unlock(e) {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      setVaultKey(await unlockWithPassphrase(vault, pass));
      setPass('');
    } catch {
      setMessage('That did not work. Please check your passphrase and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function load() {
    const { data, error } = await supabase.from('entries').select('*').eq('vault_id', vault.id).order('created_at');
    if (error) { setMessage('We could not load your vault just now. Please refresh the page.'); return; }
    const list = await decryptRows(vaultKey, data);
    setEntries(list);
    return list;
  }

  useEffect(() => {
    if (!vaultKey || !vault) return;
    load();
    supabase.from('guides').select('*').then(({ data }) => {
      setGuides(Object.fromEntries((data || []).map((g) => [g.service_key, g])));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultKey, vault?.id]);

  const current = useMemo(() => (entries || []).find((x) => x.id === selected) || null, [entries, selected]);

  function startAdd() {
    setForm(null);
    setSelected(null);
    setPicking(true);
  }

  function pick(service, idea) {
    const known = service ? findService(service) : null;
    setForm({ ...blank, service: known ? known.key : 'custom', name: known ? known.name : idea?.name || '' });
    setPicking(false);
  }

  async function save(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setBusy(true);
    const body = {
      service: form.service, name: form.name.trim(), username: form.username.trim(), secret: form.secret,
      website: form.website.trim(), note: form.note.trim(), action: form.action,
      steps: (form.steps || []).map((s) => s.trim()).filter(Boolean),
    };
    const payload = await encryptEntry(vaultKey, body);
    const now = new Date().toISOString();
    const res = form.id
      ? await supabase.from('entries').update({ payload, updated_at: now }).eq('id', form.id).select().single()
      : await supabase.from('entries').insert({ vault_id: vault.id, payload }).select().single();
    setBusy(false);
    if (res.error) return show('That did not save. Please try again.');
    await load();
    setSelected(res.data.id);
    setForm(null);
    setWelcome(false);
    show(form.id ? 'Changes saved' : `${body.name} added to your vault`);
  }

  async function remove(entry) {
    if (!window.confirm(`Remove ${entry.name} from your vault? This cannot be undone.`)) return;
    const { error } = await supabase.from('entries').delete().eq('id', entry.id);
    if (error) return show('That did not work. Please try again.');
    setSelected(null);
    await load();
    show(`${entry.name} removed`);
  }

  if (!ready) return null;

  if (!vaultKey) {
    return (
      <>
        <AppHeader role="owner" />
        <main className="narrow">
          <div className="center"><Mark size={52} /></div>
          <h1 className="center" style={{ marginTop: 16 }}>Open your vault</h1>
          <p className="quiet center">
            {lockedByTimer ? 'We locked your vault after a quiet spell, to keep it safe.' : 'Enter your passphrase to unlock it on this device.'}
          </p>
          <form onSubmit={unlock} className="card">
            <label style={{ marginTop: 0 }}>
              Passphrase
              <input type="password" autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} required autoFocus />
            </label>
            <button className="primary full" type="submit" disabled={busy}>{busy ? 'Unlocking…' : 'Open'}</button>
          </form>
          {message && <p className="note warn" role="alert">{message}</p>}
        </main>
      </>
    );
  }

  const guideFor = (en) => (en && guides[en.service]) || null;

  return (
    <>
      <AppHeader role="owner" />
      <div className="split">
        <aside aria-label="Your services">
          <h2>Your services</h2>
          <p className="aside-sub">{entries ? `${entries.length} ${entries.length === 1 ? 'service' : 'services'}` : 'Loading…'}</p>
          {(entries || []).map((x) => (
            <button key={x.id} className={'side' + (x.id === selected && !form ? ' on' : '')}
              onClick={() => { setSelected(x.id); setForm(null); setPicking(false); }}>
              <span className="side-name"><span>{x.name}</span></span>
              {x.action && <span className="pill">{ACTIONS[x.action]?.short}</span>}
            </button>
          ))}
          <button className="side-add" onClick={startAdd}>+ Add a service</button>
        </aside>

        <section className="detail">
          {welcome && !form && !picking && (
            <div className="note good">
              <p style={{ margin: 0 }}><strong>Your vault is ready.</strong> Add the services your household uses, then <Link href="/settings">invite your executor</Link>.</p>
            </div>
          )}

          {picking && <Picker guides={guides} onPick={pick} onCancel={() => setPicking(false)} />}

          {form && (
            <EntryForm form={form} setForm={setForm} guide={guideFor(form)} busy={busy}
              onSubmit={save} onCancel={() => setForm(null)} />
          )}

          {!form && !picking && current && (
            <EntryView entry={current} guide={guideFor(current)}
              onEdit={() => setForm({ ...blank, ...current, steps: current.steps || [] })}
              onRemove={() => remove(current)} />
          )}

          {!form && !picking && !current && entries && (
            entries.length === 0 ? (
              <div className="empty-state">
                <Mark size={64} />
                <h1>Nothing here yet</h1>
                <p className="lead">Start with the services you use most, like streaming or the home Wi-Fi.</p>
                <button className="primary" onClick={startAdd}>Add your first service</button>
                <p className="quiet small-text" style={{ marginTop: 28 }}>Financial logins and crypto wallets do not belong here. Please keep those somewhere else.</p>
              </div>
            ) : (
              <Overview entries={entries} vault={vault} onPick={(id) => setSelected(id)} onAdd={startAdd} />
            )
          )}
        </section>
      </div>
      <Toast text={toast} />
    </>
  );
}

function Overview({ entries, vault, onPick, onAdd }) {
  const counts = entries.reduce((acc, e) => ({ ...acc, [e.action]: (acc[e.action] || 0) + 1 }), {});
  const withoutNotes = entries.filter((e) => !e.note).length;
  return (
    <div>
      <h1>Your vault</h1>
      <p className="lead">{entries.length} {entries.length === 1 ? 'service is' : 'services are'} recorded. Choose one on the left to see or change it.</p>
      <div className="card">
        <h3>At a glance</h3>
        <p style={{ margin: 0 }}>
          {Object.entries(ACTIONS).map(([k, a]) => `${counts[k] || 0} to ${a.short.toLowerCase()}`).join(' · ')}
        </p>
        {withoutNotes > 0 && <p className="quiet small-text" style={{ margin: '10px 0 0' }}>{withoutNotes} without a personal note. A line or two often helps more than you expect.</p>}
      </div>
      {!vault.executor_email && (
        <div className="note warn">
          <p style={{ margin: 0 }}>You have not chosen an executor yet. <Link href="/settings">Invite them from Settings</Link> so their account is ready.</p>
        </div>
      )}
      <div className="actions">
        <button className="primary" onClick={onAdd}>Add a service</button>
        <button className="secondary" onClick={() => onPick(entries[0].id)}>Review from the top</button>
      </div>
    </div>
  );
}

function Picker({ guides, onPick, onCancel }) {
  return (
    <div>
      <h1>Add a service</h1>
      <p className="lead">Choose one of these, or add something of your own.</p>
      <p className="note small-text">Financial logins and crypto wallets do not belong here. Please keep those somewhere else.</p>
      <h3>Popular services</h3>
      <div className="picker">
        {POPULAR_SERVICES.map((s) => (
          <button key={s.key} type="button" onClick={() => onPick(s.key)}>
            <strong>{s.name}</strong>
            <small>{guides[s.key] ? 'Steps included' : s.hint}</small>
          </button>
        ))}
      </div>
      <h3>Around the home</h3>
      <div className="picker">
        {CUSTOM_IDEAS.map((i) => (
          <button key={i.name} type="button" onClick={() => onPick(null, i)}>
            <strong>{i.name}</strong>
            <small>You write the steps</small>
          </button>
        ))}
        <button type="button" className="custom" onClick={() => onPick(null)}>
          <strong>Something else</strong>
          <small>Any other account or code</small>
        </button>
      </div>
      <button className="link" onClick={onCancel}>Cancel</button>
    </div>
  );
}

function EntryForm({ form, setForm, guide, busy, onSubmit, onCancel }) {
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const known = findService(form.service);
  const financial = looksFinancial(form.name, form.secret);
  return (
    <form onSubmit={onSubmit}>
      <h1>{form.id ? `Edit ${form.name || 'service'}` : known ? `Add ${known.name}` : 'Add a service'}</h1>
      <p className="note small-text">Financial logins and crypto wallets do not belong here. Please keep those somewhere else.</p>

      {!known && (
        <label>
          Name
          <span className="hint">What your executor will call it, such as &ldquo;Home Wi-Fi router&rdquo;.</span>
          <input value={form.name} onChange={set('name')} required autoFocus={!form.name} maxLength={80} />
        </label>
      )}
      {financial && (
        <div className="note warn" role="alert">
          <p style={{ margin: 0 }}>This looks like it might be a bank, investment or crypto account. Cairn is not built for those. Please keep them with your will or a financial adviser instead.</p>
        </div>
      )}
      <label>
        Username or email
        <input value={form.username} onChange={set('username')} autoComplete="off" autoFocus={!!known} />
      </label>
      <label>
        Password or code
        <input value={form.secret} onChange={set('secret')} autoComplete="off" spellCheck={false} />
      </label>
      {!known && (
        <label>
          Website or where to find it <span className="hint">Optional. A web address, or &ldquo;sticker under the router&rdquo;.</span>
          <input value={form.website} onChange={set('website')} autoComplete="off" />
        </label>
      )}
      <label>
        A note for your executor
        <span className="hint">Anything that will help, in your own words. For example: &ldquo;This is on the family plan, cancel it last.&rdquo;</span>
        <textarea rows={3} value={form.note} onChange={set('note')} />
      </label>

      <fieldset style={{ border: 'none', padding: 0, margin: '18px 0' }}>
        <legend style={{ fontWeight: 600, color: 'var(--slate-dark)' }}>What should happen to it</legend>
        <div className="choice-group three">
          {Object.entries(ACTIONS).map(([k, a]) => (
            <label className="choice" key={k}>
              <input type="radio" name="action" value={k} checked={form.action === k} onChange={set('action')} />
              {a.label}
            </label>
          ))}
        </div>
      </fieldset>

      <h3>{known && guide ? 'Anything to add to the steps?' : 'Steps for your executor'}</h3>
      <p className="quiet small-text">
        {known && guide
          ? `Cairn already includes ${known.name}'s current steps for your executor. Add your own here if there is something specific to your household.`
          : 'One step per box, in order. Press Enter for a new step. Please do not type passwords here; they belong in the field above.'}
      </p>
      <StepEditor steps={form.steps || []} onChange={(steps) => setForm({ ...form, steps })} />

      <div className="actions">
        <button className="primary" type="submit" disabled={busy || !form.name.trim()}>{busy ? 'Saving…' : 'Save'}</button>
        <button className="secondary" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function EntryView({ entry, guide, onEdit, onRemove }) {
  if (entry.unreadable) {
    return (
      <div>
        <h1>An entry that could not be read</h1>
        <p className="quiet">This entry was saved in a way this vault key cannot open. You can remove it.</p>
        <button className="danger" onClick={onRemove}>Remove it</button>
      </div>
    );
  }
  const guideSteps = guide ? guide[`steps_${entry.action}`] || [] : [];
  return (
    <div>
      <div className="detail-head">
        <div>
          <h1>{entry.name}</h1>
          <p className="wish">Your wish: <strong>{ACTIONS[entry.action]?.label}</strong></p>
        </div>
        <div className="actions" style={{ marginTop: 0 }}>
          <button className="secondary small" onClick={onEdit}>Edit</button>
          <button className="danger small" onClick={onRemove}>Remove</button>
        </div>
      </div>
      {entry.note && (
        <div className="notebox"><span className="label">Your note</span><p>{entry.note}</p></div>
      )}
      <div className="card">
        <SecretField label="Username or email" value={entry.username} />
        <SecretField label="Password or code" value={entry.secret} secret />
        {entry.website && <SecretField label="Website" value={entry.website} />}
      </div>
      {guideSteps.length > 0 && (
        <>
          <h2>What your executor will see</h2>
          <ol className="steps">{guideSteps.map((s, i) => <li key={i}>{s}</li>)}</ol>
          <p className="source-line">Cairn keeps these steps current. Last checked {guide.checked_at ? new Date(guide.checked_at).toLocaleDateString() : 'recently'}.</p>
        </>
      )}
      {entry.steps?.length > 0 && (
        <>
          <h2>{guideSteps.length ? 'Your extra steps' : 'Your steps'}</h2>
          <ol className="steps">{entry.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
        </>
      )}
      {!guideSteps.length && !entry.steps?.length && (
        <p className="note">No steps yet. <button className="link" onClick={onEdit}>Add a few</button> so your executor knows what to do.</p>
      )}
    </div>
  );
}
