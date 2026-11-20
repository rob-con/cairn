'use client';
import { useState } from 'react';

// Shows a login detail with a copy button; secrets stay hidden until asked.
export default function SecretField({ label, value, secret = false }) {
  const [shown, setShown] = useState(!secret);
  const [copied, setCopied] = useState(false);
  const empty = !value;

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  }

  return (
    <div className="field-row">
      <div className="field-label">{label}</div>
      <div className="field-value">
        {empty ? <span className="quiet">Not recorded</span> : (
          <code className={shown ? '' : 'masked'}>{shown ? value : '•'.repeat(Math.min(12, value.length))}</code>
        )}
      </div>
      {!empty && (
        <div className="field-tools">
          {secret && (
            <button type="button" className="secondary small" onClick={() => setShown(!shown)}>{shown ? 'Hide' : 'Show'}</button>
          )}
          <button type="button" className="secondary small" onClick={copy} aria-live="polite">{copied ? 'Copied' : 'Copy'}</button>
        </div>
      )}
    </div>
  );
}
