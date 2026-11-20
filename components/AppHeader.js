'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Wordmark } from './Mark';
import { useVault } from '../lib/VaultContext';

export default function AppHeader({ role = 'owner' }) {
  const pathname = usePathname();
  const router = useRouter();
  const { vaultKey, lock, signOut } = useVault();
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    fetch('/api/admin/whoami').then((r) => r.json()).then((d) => setIsAdmin(!!d.admin)).catch(() => {});
  }, []);

  const links = role === 'owner'
    ? [{ href: '/vault', label: 'Your vault' }, { href: '/settings', label: 'Settings' }]
    : [{ href: '/executor', label: 'The vault' }];
  if (isAdmin) links.push({ href: '/review', label: 'Guide review' });

  async function out() {
    await signOut();
    router.replace('/');
  }

  return (
    <header className="appbar">
      <Link href="/home" className="appbar-brand" aria-label="Cairn home"><Wordmark size={30} /></Link>
      <nav aria-label="Main">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className={pathname === l.href ? 'on' : ''}>{l.label}</Link>
        ))}
      </nav>
      <div className="appbar-actions">
        {vaultKey && <button className="ghost" onClick={() => lock(false)}>Lock</button>}
        <button className="ghost" onClick={out}>Sign out</button>
      </div>
    </header>
  );
}
