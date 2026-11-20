'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';
import { Wordmark } from '../../components/Mark';

export default function Reset() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (password.length < 10) return setMessage('Please choose a password of at least 10 characters.');
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return setMessage('That did not work. The link may have expired; please ask for a new one.');
    router.replace('/home');
  }

  return (
    <main className="narrow">
      <Wordmark />
      <h1 style={{ marginTop: 32 }}>Choose a new password</h1>
      <p className="quiet">This is the password you sign in with. Your vault passphrase and recovery key stay exactly as they were.</p>
      <form onSubmit={submit}>
        <label>New password<input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus /></label>
        <button className="primary" type="submit">Save new password</button>
      </form>
      {message && <p className="note warn" role="alert">{message}</p>}
    </main>
  );
}
