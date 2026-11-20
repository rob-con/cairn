'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '../lib/supabase';
import { Wordmark } from '../components/Mark';

const COPY = {
  signin: { title: 'Welcome back', button: 'Sign in' },
  signup: { title: 'Create your account', button: 'Create account' },
  forgot: { title: 'Reset your password', button: 'Send reset link' },
  mfa: { title: 'One more step', button: 'Continue' },
  sent: { title: 'Check your email' },
};

function SignInInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [message, setMessage] = useState(params.get('link') === 'expired' ? 'That link has expired or was already used. Please sign in, or ask for a new one.' : '');
  const [sentText, setSentText] = useState('');
  const [busy, setBusy] = useState(false);

  // Already signed in? Go straight on.
  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data?.user) return;
      if (await needsSecondStep()) setMode('mfa');
      else router.replace('/home');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function needsSecondStep() {
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    return data && data.nextLevel === 'aal2' && data.currentLevel !== 'aal2';
  }

  function switchTo(next) {
    setMode(next);
    setMessage('');
  }

  async function submit(e) {
    e.preventDefault();
    setMessage('');
    setBusy(true);
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          setMessage(error.message === 'Email not confirmed'
            ? 'Please confirm your email address first. The link is in your inbox.'
            : 'That email and password did not match. Please check and try again.');
          return;
        }
        if (await needsSecondStep()) { setMode('mfa'); return; }
        router.replace('/home');
      } else if (mode === 'signup') {
        if (password.length < 10) { setMessage('Please choose a password of at least 10 characters.'); return; }
        const { data, error } = await supabase.auth.signUp({
          email, password,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
        });
        if (error) { setMessage(error.message); return; }
        if (data.session) { router.replace('/home'); return; }
        setSentText(`We have sent a confirmation link to ${email}. Open it on this device to finish creating your account.`);
        setMode('sent');
      } else if (mode === 'forgot') {
        await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/auth/callback?next=/reset` });
        setSentText(`If there is an account for ${email}, a link to choose a new password is on its way. Your vault passphrase is not affected.`);
        setMode('sent');
      } else if (mode === 'mfa') {
        const { data: factors } = await supabase.auth.mfa.listFactors();
        const factor = factors?.totp?.[0];
        if (!factor) { router.replace('/home'); return; }
        const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.replace(/\s/g, '') });
        if (error) { setMessage('That code did not work. Codes change every 30 seconds, so please try the newest one.'); return; }
        router.replace('/home');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="welcome">
      <div className="welcome-side">
        <div>
          <Wordmark size={40} />
          <div style={{ marginTop: '18vh' }}>
            <h2>A calm place to leave things in order.</h2>
            <p>Record the everyday accounts your household relies on, so the person you trust can look after each one when the time comes.</p>
            <ul>
              <li>Everything you add is locked on your own device before it is saved. We cannot read it.</li>
              <li>Your executor opens it later with a recovery key that only you hand over.</li>
              <li>Clear, current steps for each service: keep it, transfer it, or close it.</li>
            </ul>
          </div>
        </div>
        <p className="small-text" style={{ marginTop: 32 }}>Cairn is for streaming, home and everyday logins. Please keep bank and crypto details somewhere else.</p>
      </div>

      <div className="welcome-main">
        <div>
          <h1>{COPY[mode].title}</h1>

          {mode === 'sent' && (
            <>
              <p className="lead">{sentText}</p>
              <button className="link" onClick={() => switchTo('signin')}>Back to sign in</button>
            </>
          )}

          {mode !== 'sent' && (
            <form onSubmit={submit}>
              {mode === 'mfa' ? (
                <label>
                  Code from your authenticator app
                  <input className="code-input" inputMode="numeric" autoComplete="one-time-code" value={code}
                    onChange={(e) => setCode(e.target.value)} required autoFocus maxLength={8} />
                </label>
              ) : (
                <label>
                  Email
                  <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
                </label>
              )}
              {(mode === 'signin' || mode === 'signup') && (
                <label>
                  Password
                  {mode === 'signup' && <span className="hint">At least 10 characters. This signs you in; your vault gets its own passphrase next.</span>}
                  <input type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                    value={password} onChange={(e) => setPassword(e.target.value)} required minLength={mode === 'signup' ? 10 : 1} />
                </label>
              )}
              <button className="primary full" type="submit" disabled={busy}>{busy ? 'One moment…' : COPY[mode].button}</button>
            </form>
          )}

          {message && <p className="note warn" role="alert">{message}</p>}

          <div style={{ marginTop: 24, display: 'grid', gap: 4, justifyItems: 'start' }}>
            {mode === 'signin' && (
              <>
                <button className="link" onClick={() => switchTo('signup')}>New here? Create an account</button>
                <button className="link" onClick={() => switchTo('forgot')}>Forgotten your password?</button>
              </>
            )}
            {(mode === 'signup' || mode === 'forgot') && (
              <button className="link" onClick={() => switchTo('signin')}>Already have an account? Sign in</button>
            )}
            {mode === 'mfa' && (
              <button className="link" onClick={async () => { await supabase.auth.signOut(); switchTo('signin'); }}>Use a different account</button>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

export default function SignIn() {
  return (
    <Suspense fallback={null}>
      <SignInInner />
    </Suspense>
  );
}
