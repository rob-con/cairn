'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';
import { createVaultKeys, passphraseStrength } from '../../lib/crypto';
import { useVault } from '../../lib/VaultContext';
import { Wordmark } from '../../components/Mark';
import RecoveryKeySheet from '../../components/RecoveryKeySheet';

const STRENGTH = ['', 'Could be stronger', 'Good', 'Strong'];

export default function Setup() {
  const router = useRouter();
  const { setVault, setVaultKey, signOut } = useVault();
  const [user, setUser] = useState(null);
  const [name, setName] = useState('');
  const [pass, setPass] = useState('');
  const [again, setAgain] = useState('');
  const [keys, setKeys] = useState(null);
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data?.user) router.replace('/signin');
      else setUser(data.user);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const strength = passphraseStrength(pass);

  async function create(e) {
    e.preventDefault();
    setMessage('');
    if (pass.length < 12) return setMessage('Please choose a passphrase of at least 12 characters. A short sentence works well.');
    if (pass !== again) return setMessage('The two passphrases do not match.');
    setBusy(true);
    try {
      setKeys(await createVaultKeys(pass));
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    setBusy(true);
    setMessage('');
    const { data, error } = await supabase.from('vaults').insert({
      owner_id: user.id,
      owner_name: name.trim(),
      wrapped_key_passphrase: keys.wrapped_key_passphrase,
      passphrase_salt: keys.passphrase_salt,
      wrapped_key_recovery: keys.wrapped_key_recovery,
      recovery_salt: keys.recovery_salt,
    }).select().single();
    setBusy(false);
    if (error) return setMessage('We could not save your vault just now. Please try again in a moment.');
    setVault(data);
    setVaultKey(keys.vaultKey);
    router.replace('/vault?welcome=1');
  }

  if (!user) return null;

  if (keys) {
    return (
      <main className="narrow">
        <div className="no-print">
          <Wordmark />
          <p className="quiet small-text" style={{ marginTop: 28 }}>Step 2 of 2</p>
          <h1>Your recovery key</h1>
          <p>This key lets your executor open your vault. <strong>It is shown only once, and we cannot recover it for you.</strong></p>
        </div>
        <RecoveryKeySheet recoveryKey={keys.recoveryKey} ownerName={name.trim()} />
        <div className="no-print">
          <div className="note">
            <p style={{ margin: 0 }}>Give one copy to your executor and keep another somewhere safe, such as with your will or your lawyer. We will never email it to anyone.</p>
          </div>
          <label className="check">
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
            <span>I have saved my recovery key somewhere safe.</span>
          </label>
          <div className="actions">
            <button className="primary" disabled={!saved || busy} onClick={finish}>{busy ? 'Saving…' : 'Continue to my vault'}</button>
          </div>
          {message && <p className="note warn" role="alert">{message}</p>}
        </div>
      </main>
    );
  }

  return (
    <main className="narrow">
      <Wordmark />
      <p className="quiet small-text" style={{ marginTop: 28 }}>Step 1 of 2</p>
      <h1>Let us set up your vault</h1>
      <p className="lead">Take your time. This only takes a few minutes.</p>

      <form onSubmit={create}>
        <label>
          Your first name
          <span className="hint">Shown to your executor, so they know whose vault this is.</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" required maxLength={60} />
        </label>
        <label>
          Choose a passphrase
          <span className="hint">Only you know this. It locks everything you add. A short sentence you will remember is ideal.</span>
          <input type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} required />
          {pass && (
            <>
              <div className={`meter s${strength}`} aria-hidden="true"><span /><span /><span /></div>
              <span className="hint">{STRENGTH[strength]}</span>
            </>
          )}
        </label>
        <label>
          Type it again
          <input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required />
        </label>

        <div className="note warn">
          <p style={{ margin: 0 }}><strong>Please read this.</strong> Your vault is locked on this device before anything is saved, so we cannot read it and we cannot reset it. If both this passphrase and the recovery key you are about to receive are lost, nobody can open the vault, including us.</p>
        </div>

        <div className="actions">
          <button className="primary" type="submit" disabled={busy}>{busy ? 'Creating your keys…' : 'Create my vault'}</button>
        </div>
        {message && <p className="note warn" role="alert">{message}</p>}
      </form>

      <hr className="divider" />
      <p className="quiet small-text">
        Were you asked to be someone&apos;s executor? You do not need a vault of your own. Ask them to invite {user.email} from their Cairn settings, then sign in again.{' '}
        <button className="link small-text" onClick={async () => { await signOut(); router.replace('/'); }}>Sign out</button>
      </p>
    </main>
  );
}
