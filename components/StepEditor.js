'use client';
import { useRef } from 'react';

// A simple step-by-step editor: add, reword, reorder and remove steps.
export default function StepEditor({ steps, onChange, placeholder = 'Describe this step' }) {
  const refs = useRef([]);
  const list = steps.length ? steps : [];

  function set(i, value) {
    const next = [...list];
    next[i] = value;
    onChange(next);
  }
  function add(at = list.length) {
    const next = [...list];
    next.splice(at, 0, '');
    onChange(next);
    setTimeout(() => refs.current[at]?.focus(), 0);
  }
  function remove(i) {
    onChange(list.filter((_, j) => j !== i));
  }
  function move(i, d) {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
    setTimeout(() => refs.current[j]?.focus(), 0);
  }

  return (
    <div className="steps-editor">
      {list.length === 0 && <p className="quiet small-text">No steps yet.</p>}
      <ol>
        {list.map((s, i) => (
          <li key={i}>
            <span className="step-num" aria-hidden="true">{i + 1}</span>
            <textarea
              ref={(el) => (refs.current[i] = el)}
              rows={2}
              value={s}
              aria-label={`Step ${i + 1}`}
              placeholder={placeholder}
              onChange={(e) => set(i, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); add(i + 1); }
              }}
            />
            <div className="step-tools">
              <button type="button" className="icon" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move step ${i + 1} up`}>↑</button>
              <button type="button" className="icon" onClick={() => move(i, 1)} disabled={i === list.length - 1} aria-label={`Move step ${i + 1} down`}>↓</button>
              <button type="button" className="icon" onClick={() => remove(i)} aria-label={`Remove step ${i + 1}`}>×</button>
            </div>
          </li>
        ))}
      </ol>
      <button type="button" className="secondary small" onClick={() => add()}>Add a step</button>
    </div>
  );
}
