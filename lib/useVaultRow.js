'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from './supabase';
import { useVault } from './VaultContext';

// Finds the vault this page is about: the user's own ('owner') or the one they
// look after ('executor'). Falls back to /home if there is none.
export function useVaultRow(role) {
  const router = useRouter();
  const { vault, setVault } = useVault();
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: { user: u } } = await supabase.auth.getUser();
      if (!alive) return;
      if (!u) { router.replace('/'); return; }
      setUser(u);
      const matches = (v) => v && (role === 'owner' ? v.owner_id === u.id : v.executor_id === u.id);
      if (matches(vault)) { setReady(true); return; }
      const { data, error } = await supabase.from('vaults').select('*');
      if (!alive) return;
      if (error) { router.replace('/home'); return; }
      const found = (data || []).find(matches);
      if (!found) { router.replace('/home'); return; }
      setVault(found);
      setReady(true);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  return { vault: ready ? vault : null, user, ready };
}
