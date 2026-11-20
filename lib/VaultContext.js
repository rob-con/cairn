'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';

const Ctx = createContext(null);
const IDLE_MINUTES = 15;

// Holds the unlocked vault key in memory only. It is never written to storage,
// so it disappears when the tab closes, after 15 quiet minutes, or on sign out.
export function VaultProvider({ children }) {
  const [vaultKey, setVaultKeyState] = useState(null);
  const [vault, setVault] = useState(null);
  const [lockedByTimer, setLockedByTimer] = useState(false);
  const timer = useRef(null);

  const lock = useCallback((byTimer = false) => {
    setVaultKeyState(null);
    setLockedByTimer(byTimer);
  }, []);

  const setVaultKey = useCallback((key) => {
    setVaultKeyState(key);
    if (key) setLockedByTimer(false);
  }, []);

  useEffect(() => {
    if (!vaultKey) return undefined;
    const reset = () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => lock(true), IDLE_MINUTES * 60 * 1000);
    };
    const events = ['pointerdown', 'keydown', 'scroll', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      clearTimeout(timer.current);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [vaultKey, lock]);

  const signOut = useCallback(async () => {
    lock();
    setVault(null);
    await supabase.auth.signOut();
  }, [lock]);

  return (
    <Ctx.Provider value={{ vaultKey, setVaultKey, vault, setVault, lock, lockedByTimer, signOut }}>
      {children}
    </Ctx.Provider>
  );
}

export const useVault = () => useContext(Ctx);
