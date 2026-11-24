'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '../../lib/supabase';
import { useVault } from '../../lib/VaultContext';
import { Wordmark } from '../../components/Mark';
import Mark from '../../components/Mark';

// Decides where each person goes: planners to their vault (or setup), executors
// to the executor area, and people who are both get a choice.
export default function Home() {
  const router = useRouter();
  const { setVault, signOut } = useVault();
  const [choice, setChoice] = useState(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return router.replace('/signin');
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal && aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') return router.replace('/signin');

      // Link this account to any vault that invited this email address.
      await fetch('/api/claim', { method: 'POST' }).catch(() => {});

      const { data: vaults } = await supabase.from('vaults').select('*');
      const mine = (vaults || []).find((v) => v.owner_id === user.id);
      const theirs = (vaults || []).filter((v) => v.executor_id === user.id);
      if (mine && theirs.length === 0) { setVault(mine); return router.replace('/vault'); }
      if (!mine && theirs.length === 1) { setVault(theirs[0]); return router.replace('/executor'); }
      if (!mine && theirs.length === 0) return router.replace('/setup');
      setChoice({ mine, theirs });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!choice) {
    return (
      <main className="narrow center" style={{ paddingTop: '22vh' }}>
        <Mark size={48} />
        <p className="quiet" style={{ marginTop: 16 }}>One moment.</p>
      </main>
    );
  }

  return (
    <main className="narrow">
      <Wordmark />
      <h1 style={{ marginTop: 36 }}>Where would you like to go?</h1>
      {choice.mine && (
        <div className="card">
          <h3>Your own vault</h3>
          <p className="quiet">Add or update the services you are leaving instructions for.</p>
          <button className="primary" onClick={() => { setVault(choice.mine); router.push('/vault'); }}>Open my vault</button>
        </div>
      )}
      {choice.theirs.map((v) => (
        <div className="card" key={v.id}>
          <h3>{v.owner_name ? `${v.owner_name}'s vault` : 'A vault you look after'}</h3>
          <p className="quiet">You were asked to be the executor for this vault.</p>
          <button className="secondary" onClick={() => { setVault(v); router.push('/executor'); }}>Go to the executor area</button>
        </div>
      ))}
      {!choice.mine && (
        <p><Link href="/setup">Set up a vault of my own</Link></p>
      )}
      <button className="link" onClick={async () => { await signOut(); router.replace('/'); }}>Sign out</button>
    </main>
  );
}
