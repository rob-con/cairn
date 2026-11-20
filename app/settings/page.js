'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';
import { useVault } from '../../lib/VaultContext';
import { useVaultRow } from '../../lib/useVaultRow';
import { changePassphrase, replaceRecoveryKey, passphraseStrength } from '../../lib/crypto';
import AppHeader from '../../components/AppHeader';
import RecoveryKeySheet from '../../components/RecoveryKeySheet';
import Toast, { useToast } from '../../components/Toast';

const fmt = (d) => (d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : '');

export default function Settings() {
  const { vault, user, ready } = useVaultRow('owner');
  const { setVault } = useVault();
  const [toast, show] = useToast();

  async function refresh() {
    const { data } = await supabase.from('vaults').select('*').eq('id', vault.id).single();
    if (data) setVault(data);
  }

  if (!ready || !vault) return null;

  return (
    <>
      <AppHeader role="owner" />
      <main className="wide" style={{ maxWidth: 820 }}>
        <h1>Settings</h1>
        <p className="lead">Your executor, reminders and the keys that protect your vault.</p>
        <Executor vault={vault} user={user} refresh={refresh} show={show} />
        <Reminders vault={vault} refresh={refresh} show={show} />
        <Passphrase vault={vault} refresh={refresh} show={show} />
        <Recovery vault={vault} refresh={refresh} show={show} />
        <TwoFactor show={show} />
        <Danger vault={vault} />
      </main>
      <Toast text={toast} />
    </>
  );
}

function Executor({ vault, user, refresh, show }) {
  const [email, setEmail] = useState('');
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function invite(e) {
    e.preventDefault();
    setMessage('');
    if (email.trim().toLowerCase() === (user?.email || '').toLowerCase()) {
      return setMessage('Your executor needs to be someone else, with their own email address.');
    }
    setBusy(true);
    const res = await fetch('/api/executor', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!d.ok) return setMessage(d.error || 'Something went wrong. Please try again.');
    setEditing(false);
    setEmail('');
    await refresh();
    show('Invitation sent');
  }

  async function removeExecutor() {
    if (!window.confirm('Remove your executor? They will no longer be able to open your vault, even with the recovery key.')) return;
    const res = await fetch('/api/executor', { method: 'DELETE' });
    if (res.ok) { await refresh(); show('Executor removed'); }
  }

  const status = !vault.executor_email ? null
    : vault.executor_id ? 'Account set up and ready'
    : `Invited on ${fmt(vault.executor_invited_at)}, account not set up yet`;

  return (
    <section className="card" aria-labelledby="exec-h">
      <h2 id="exec-h">Your executor</h2>
      <p className="quiet">The person who will look after these services. They create their own Cairn account now, and open your vault later with the recovery key you give them. You can choose one executor, and change them at any time.</p>
      {vault.executor_email && !editing && (
        <>
          <p style={{ margin: '0 0 4px' }}><strong>{vault.executor_email}</strong></p>
          <p className="quiet" style={{ margin: 0 }}>{status}</p>
          {!vault.executor_id && <p className="quiet small-text">We will send them a gentle reminder if they have not finished setting up.</p>}
          {vault.executor_opened_at && (
            <p className="note warn">They opened your vault on {fmt(vault.executor_opened_at)}. If you did not expect this, make a new recovery key below.</p>
          )}
          <div className="actions">
            <button className="secondary small" onClick={() => setEditing(true)}>Choose someone else</button>
            <button className="danger small" onClick={removeExecutor}>Remove</button>
          </div>
        </>
      )}
      {(!vault.executor_email || editing) && (
        <form onSubmit={invite}>
          <label>
            Their email address
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="off" />
          </label>
          <div className="actions" style={{ marginTop: 0 }}>
            <button className="primary" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send invitation'}</button>
            {editing && <button type="button" className="secondary" onClick={() => setEditing(false)}>Cancel</button>}
          </div>
          {editing && <p className="quiet small-text">Your current executor will no longer be able to open the vault.</p>}
        </form>
      )}
      {message && <p className="note warn" role="alert">{message}</p>}
    </section>
  );
}

function Reminders({ vault, refresh, show }) {
  async function change(e) {
    const reminder_months = Number(e.target.value);
    const { error } = await supabase.from('vaults').update({ reminder_months, updated_at: new Date().toISOString() }).eq('id', vault.id);
    if (error) return show('That did not save. Please try again.');
    await refresh();
    show('Reminder setting saved');
  }
  return (
    <section className="card" aria-labelledby="rem-h">
      <h2 id="rem-h">Reminders</h2>
      <p className="quiet">We can email you now and then to check that your logins and notes are still current.</p>
      <label style={{ maxWidth: 320 }}>
        Remind me
        <select value={vault.reminder_months} onChange={change}>
          <option value={3}>Every 3 months</option>
          <option value={6}>Every 6 months</option>
          <option value={12}>Once a year</option>
          <option value={0}>Never</option>
        </select>
      </label>
    </section>
  );
}

function Passphrase({ vault, refresh, show }) {
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setMessage('');
    if (next.length < 12) return setMessage('Please choose a passphrase of at least 12 characters.');
    if (next !== again) return setMessage('The two new passphrases do not match.');
    setBusy(true);
    try {
      const update = await changePassphrase(vault, cur, next);
      const { error } = await supabase.from('vaults').update({ ...update, updated_at: new Date().toISOString() }).eq('id', vault.id);
      if (error) throw new Error('save');
      await refresh();
      setOpen(false); setCur(''); setNext(''); setAgain('');
      show('Passphrase changed');
    } catch (err) {
      setMessage(err.message === 'save' ? 'That did not save. Please try again.' : 'Your current passphrase did not match. Please check and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-labelledby="pp-h">
      <h2 id="pp-h">Vault passphrase</h2>
      <p className="quiet">The passphrase you use to open your vault. Changing it does not affect your recovery key.</p>
      {!open ? <button className="secondary" onClick={() => setOpen(true)}>Change passphrase</button> : (
        <form onSubmit={submit}>
          <label>Current passphrase<input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required /></label>
          <label>
            New passphrase
            <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
            {next && <div className={`meter s${passphraseStrength(next)}`} aria-hidden="true"><span /><span /><span /></div>}
          </label>
          <label>Type the new one again<input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required /></label>
          <div className="actions">
            <button className="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Change passphrase'}</button>
            <button type="button" className="secondary" onClick={() => setOpen(false)}>Cancel</button>
          </div>
          {message && <p className="note warn" role="alert">{message}</p>}
        </form>
      )}
    </section>
  );
}

function Recovery({ vault, refresh, show }) {
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState('');
  const [fresh, setFresh] = useState(null);
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function make(e) {
    e.preventDefault();
    setMessage('');
    setBusy(true);
    try {
      setFresh(await replaceRecoveryKey(vault, cur));
      setCur('');
    } catch {
      setMessage('Your passphrase did not match. Please check and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    const { recoveryKey, ...update } = fresh;
    const now = new Date().toISOString();
    const { error } = await supabase.from('vaults').update({ ...update, recovery_created_at: now, updated_at: now }).eq('id', vault.id);
    setBusy(false);
    if (error) return setMessage('That did not save. Your old recovery key still works. Please try again.');
    await refresh();
    setFresh(null); setOpen(false); setSaved(false);
    show('New recovery key saved');
  }

  return (
    <section className="card" aria-labelledby="rk-h">
      <h2 id="rk-h">Recovery key</h2>
      <p className="quiet">The key your executor uses to open your vault. Made on {fmt(vault.recovery_created_at)}. If a copy has been lost or you are worried someone else has it, make a new one. The old key stops working straight away, so give your executor the new copy.</p>
      {!open && <button className="secondary" onClick={() => setOpen(true)}>Make a new recovery key</button>}
      {open && !fresh && (
        <form onSubmit={make}>
          <label>Your passphrase<input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required /></label>
          <div className="actions">
            <button className="primary" type="submit" disabled={busy}>{busy ? 'Making…' : 'Make the new key'}</button>
            <button type="button" className="secondary" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </form>
      )}
      {fresh && (
        <>
          <RecoveryKeySheet recoveryKey={fresh.recoveryKey} ownerName={vault.owner_name} />
          <label className="check no-print">
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
            <span>I have saved the new key and will give my executor a copy.</span>
          </label>
          <div className="actions no-print">
            <button className="primary" disabled={!saved || busy} onClick={confirm}>Use the new key</button>
            <button className="secondary" onClick={() => { setFresh(null); setOpen(false); }}>Cancel and keep the old one</button>
          </div>
        </>
      )}
      {message && <p className="note warn" role="alert">{message}</p>}
    </section>
  );
}

function TwoFactor({ show }) {
  const [factor, setFactor] = useState(undefined);
  const [enrolling, setEnrolling] = useState(null);
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');

  async function load() {
    const { data } = await supabase.auth.mfa.listFactors();
    setFactor(data?.totp?.[0] || null);
  }
  useEffect(() => { load(); }, []);

  async function start() {
    setMessage('');
    // Clear any half-finished attempt first.
    const { data: all } = await supabase.auth.mfa.listFactors();
    for (const f of all?.all || []) if (f.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: f.id });
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Cairn ${Date.now()}` });
    if (error) return setMessage('We could not start this just now. Please try again.');
    setEnrolling(data);
  }

  async function verify(e) {
    e.preventDefault();
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: enrolling.id, code: code.replace(/\s/g, '') });
    if (error) return setMessage('That code did not work. Please try the newest code in your app.');
    setEnrolling(null); setCode('');
    await load();
    show('Two-step sign-in is on');
  }

  async function turnOff() {
    if (!window.confirm('Turn off two-step sign-in?')) return;
    const { error } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
    if (error) return setMessage('We could not turn it off just now. Please sign out and in again, then try once more.');
    await load();
    show('Two-step sign-in is off');
  }

  return (
    <section className="card" aria-labelledby="tf-h">
      <h2 id="tf-h">Two-step sign-in</h2>
      <p className="quiet">Adds a six-digit code from an authenticator app (such as Google Authenticator or 1Password) when you sign in.</p>
      {factor === undefined ? null : factor ? (
        <>
          <p className="note good" style={{ marginTop: 0 }}>On. You will be asked for a code each time you sign in.</p>
          <button className="danger small" onClick={turnOff}>Turn off</button>
        </>
      ) : enrolling ? (
        <form onSubmit={verify}>
          <p>Scan this with your authenticator app, then type the code it shows.</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enrolling.totp.qr_code} alt="QR code for your authenticator app" width={180} height={180} style={{ background: '#fff', borderRadius: 8, padding: 8 }} />
          <p className="quiet small-text">Cannot scan it? Enter this key by hand: <code>{enrolling.totp.secret}</code></p>
          <label style={{ maxWidth: 240 }}>Code<input className="code-input" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} required autoComplete="one-time-code" /></label>
          <div className="actions">
            <button className="primary" type="submit">Turn on</button>
            <button type="button" className="secondary" onClick={() => setEnrolling(null)}>Cancel</button>
          </div>
        </form>
      ) : (
        <button className="secondary" onClick={start}>Set up two-step sign-in</button>
      )}
      {message && <p className="note warn" role="alert">{message}</p>}
    </section>
  );
}

function Danger({ vault }) {
  const router = useRouter();
  const { setVault, lock } = useVault();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');

  async function destroy(e) {
    e.preventDefault();
    const { error } = await supabase.from('vaults').delete().eq('id', vault.id);
    if (error) return;
    lock();
    setVault(null);
    router.replace('/home');
  }

  return (
    <section className="card" aria-labelledby="del-h">
      <h2 id="del-h">Delete your vault</h2>
      <p className="quiet">Removes every service and note, and your executor will no longer have anything to open. This cannot be undone.</p>
      {!open ? <button className="danger" onClick={() => setOpen(true)}>Delete my vault</button> : (
        <form onSubmit={destroy}>
          <label style={{ maxWidth: 360 }}>Type DELETE to confirm<input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" /></label>
          <div className="actions">
            <button className="danger" type="submit" disabled={typed !== 'DELETE'}>Delete everything</button>
            <button type="button" className="secondary" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </form>
      )}
    </section>
  );
}
