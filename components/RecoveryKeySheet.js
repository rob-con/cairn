'use client';
import { useState } from 'react';

// Shows a freshly made recovery key once, with ways to keep it. When printed,
// the page becomes a one-sheet letter the planner can hand to their executor.
export default function RecoveryKeySheet({ recoveryKey, ownerName }) {
  const [copied, setCopied] = useState(false);
  const site = typeof window !== 'undefined' ? window.location.origin : '';
  const today = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  const who = ownerName || 'the vault owner';

  const letter = [
    'CAIRN RECOVERY KEY',
    '',
    `For the Cairn vault of ${who}. Created ${today}.`,
    '',
    recoveryKey,
    '',
    'What this is: the key that opens a vault of household logins and instructions.',
    'When the time comes:',
    `  1. Go to ${site} and sign in with the account you created when you were invited.`,
    '  2. Choose "Open the vault" and type this key exactly as shown.',
    '  3. Work through each service at your own pace. Your progress is saved.',
    '',
    'Keep this somewhere safe. Anyone with this key and your Cairn sign-in can open the vault.',
  ].join('\n');

  async function copy() {
    try {
      await navigator.clipboard.writeText(recoveryKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  }

  function download() {
    const blob = new Blob([letter], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'cairn-recovery-key.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  return (
    <div>
      <div className="print-only">
        <h1>Cairn recovery key</h1>
        <p>For the Cairn vault of <strong>{who}</strong>. Created {today}.</p>
      </div>
      <div className="keybox" data-testid="recovery-key">
        {recoveryKey.split('-').map((g, i, all) => (
          <span className="grp" key={i}>{g}{i < all.length - 1 ? '-' : ''}</span>
        ))}
      </div>
      <div className="actions no-print" style={{ marginTop: 0 }}>
        <button type="button" className="secondary" onClick={() => window.print()}>Print it</button>
        <button type="button" className="secondary" onClick={download}>Save as a file</button>
        <button type="button" className="secondary" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
      <div className="print-only">
        <h3>When the time comes</h3>
        <ol>
          <li>Go to <strong>{site}</strong> and sign in with the account you created when you were invited.</li>
          <li>Choose &ldquo;Open the vault&rdquo; and type this key exactly as shown.</li>
          <li>Work through each service at your own pace. Your progress is saved.</li>
        </ol>
        <p>Keep this sheet somewhere safe. Anyone with this key and your Cairn sign-in can open the vault.</p>
      </div>
    </div>
  );
}
