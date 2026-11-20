'use client';
import { useCallback, useRef, useState } from 'react';

export function useToast() {
  const [text, setText] = useState('');
  const t = useRef(null);
  const show = useCallback((msg) => {
    setText(msg);
    clearTimeout(t.current);
    t.current = setTimeout(() => setText(''), 2800);
  }, []);
  return [text, show];
}

export default function Toast({ text }) {
  return text ? <div className="toast" role="status">{text}</div> : null;
}
