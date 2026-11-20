'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { ACTIONS } from '../../lib/services';
import AppHeader from '../../components/AppHeader';
import StepEditor from '../../components/StepEditor';
import Toast, { useToast } from '../../components/Toast';

const fmt = (d) => (d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const norm = (s) => String(s).trim().toLowerCase().replace(/\s+/g, ' ');

export default function Review() {
  const [data, setData] = useState(null);
  const [edits, setEdits] = useState({});
  const [message, setMessage] = useState('');
  const [running, setRunning] = useState(null);
  const [role, setRole] = useState('owner');
  const [toast, show] = useToast();

  async function load() {
    const res = await fetch('/api/admin/guides');
    if (res.status === 403) return setMessage('This page is only for the Cairn administrator.');
    if (!res.ok) return setMessage('We could not load the guides just now.');
    const d = await res.json();
    const priority = Object.fromEntries(d.guides.map((g) => [g.service_key, g.priority]));
    d.drafts.sort((a, b) => (priority[a.service_key] ?? 999) - (priority[b.service_key] ?? 999));
    setData(d);
    // Keep any edits already in progress on drafts that are still waiting.
    setEdits((prev) => {
      const e = {};
      d.drafts.forEach((x) => {
        e[x.id] = prev[x.id] || { keep: x.steps_keep || [], transfer: x.steps_transfer || [], close: x.steps_close || [], help_url: x.help_url || '' };
      });
      return e;
    });
  }

  useEffect(() => {
    load();
    supabase.auth.getUser().then(async ({ data: u }) => {
      if (!u?.user) return;
      const { data: v } = await supabase.from('vaults').select('owner_id');
      if (v && !v.some((x) => x.owner_id === u.user.id) && v.length) setRole('executor');
    });
  }, []);

  async function act(draft, action) {
    const e = edits[draft.id];
    const res = await fetch('/api/admin/guides', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ draftId: draft.id, action, keep: e.keep, transfer: e.transfer, close: e.close, help_url: e.help_url }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return show(d.error || 'That did not work.');
    show(action === 'approve' ? 'Approved. Executors now see these steps.' : 'Rejected. The published steps stay as they are.');
    load();
  }

  async function run(service) {
    setRunning(service || 'all');
    const res = await fetch('/api/admin/guides/run', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ service }),
    });
    const d = await res.json().catch(() => ({}));
    setRunning(null);
    if (!res.ok) return show(d.error || 'The check did not run.');
    show(d.results.map((r) => `${r.service}: ${r.result}`).join(' · '));
    load();
  }

  if (message) {
    return (<><AppHeader role={role} /><main className="narrow"><p className="note">{message}</p></main></>);
  }
  if (!data) return (<><AppHeader role={role} /><main className="narrow"><p className="quiet">One moment.</p></main></>);

  const pendingFor = (key) => data.drafts.find((d) => d.service_key === key);

  return (
    <>
      <AppHeader role={role} />
      <main className="wide">
        <h1>Guide review</h1>
        <p className="lead">Each month, Cairn checks every service&apos;s official steps. Changes wait here until you approve them. Until then, executors keep seeing the last approved version.</p>

        <h2>Waiting for review</h2>
        {data.drafts.length === 0 && <p className="note good">Nothing is waiting. Every guide is up to date.</p>}
        {data.drafts.map((d) => {
          const live = data.guides.find((g) => g.service_key === d.service_key) || {};
          const e = edits[d.id] || {};
          return (
            <section className="card" key={d.id} aria-label={`${live.service_name} draft`}>
              <div className="detail-head">
                <div>
                  <h2 style={{ margin: 0 }}>{live.service_name || d.service_key}</h2>
                  <p className="quiet small-text" style={{ margin: '4px 0 0' }}>
                    Found {fmt(d.created_at)} · {live.approved_at ? `published version approved ${fmt(live.approved_at)}` : 'not yet published'}
                  </p>
                </div>
              </div>
              {(d.sources || []).length > 0 && (
                <p className="small-text">Sources: {(d.sources || []).map((s, i) => (
                  <span key={s}>{i > 0 && ' · '}<a href={s} target="_blank" rel="noreferrer">{new URL(s).hostname}{new URL(s).pathname.slice(0, 40)}</a></span>
                ))}</p>
              )}
              {Object.entries(ACTIONS).map(([k, a]) => {
                const was = live[`steps_${k}`] || [];
                const now = e[k] || [];
                const wasSet = new Set(was.map(norm));
                const nowSet = new Set(now.map(norm));
                return (
                  <div className="compare" key={k}>
                    <div>
                      <h4>Published: {a.short}</h4>
                      <div className="was">
                        {was.length === 0 ? <span className="quiet">Nothing published</span> : (
                          <ol>{was.map((s, i) => <li key={i} className={nowSet.has(norm(s)) ? '' : 'gone'}>{s}</li>)}</ol>
                        )}
                      </div>
                    </div>
                    <div>
                      <h4>New draft: {a.short} {now.some((s) => !wasSet.has(norm(s))) && <span className="changed">changed</span>}</h4>
                      <StepEditor steps={now} onChange={(steps) => setEdits({ ...edits, [d.id]: { ...e, [k]: steps } })} />
                    </div>
                  </div>
                );
              })}
              <label>
                Official help page shown to executors
                <input value={e.help_url || ''} onChange={(ev) => setEdits({ ...edits, [d.id]: { ...e, help_url: ev.target.value } })} placeholder="https://" />
              </label>
              <div className="actions">
                <button className="primary" onClick={() => act(d, 'approve')}>Approve and publish</button>
                <button className="secondary" onClick={() => act(d, 'reject')}>Reject</button>
              </div>
            </section>
          );
        })}

        <h2>The library</h2>
        <div className="card">
          <table className="library">
            <thead><tr><th>Service</th><th>Status</th><th>Last checked</th><th /></tr></thead>
            <tbody>
              {data.guides.map((g) => (
                <tr key={g.service_key}>
                  <td><strong>{g.service_name}</strong></td>
                  <td>{pendingFor(g.service_key) ? <span className="pill transfer">Draft waiting</span> : g.approved_at ? <span className="pill done">Published</span> : <span className="pill">Not yet published</span>}</td>
                  <td>{fmt(g.checked_at)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="secondary small" disabled={!!running} onClick={() => run(g.service_key)}>
                      {running === g.service_key ? 'Checking…' : 'Check now'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="actions">
            <button className="secondary" disabled={!!running} onClick={() => run()}>{running === 'all' ? 'Checking every service… this can take a few minutes' : 'Check every service now'}</button>
          </div>
        </div>
      </main>
      <Toast text={toast} />
    </>
  );
}
