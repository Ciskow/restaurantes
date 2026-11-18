import React, { useEffect, useId, useRef, useState } from 'react';
import { Utensils } from 'lucide-react';

/** An on/off row: label on the left, switch on the right. */
export function Switch({ checked, onChange, children }) {
  return (
    <button type="button" role="switch" aria-checked={!!checked} className="switch" onClick={() => onChange(!checked)}>
      <span>{children}</span>
      <span className="switch-track" aria-hidden="true" />
    </button>
  );
}

/** Native <dialog>: gives focus trapping, Esc to close and a backdrop for free. */
export function Modal({ onClose, className = '', label, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el.open) el.showModal();
    el.querySelector('[data-autofocus]')?.focus();
    return () => el.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${className}`}
      aria-label={label}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onMouseDown={(e) => { if (e.target === ref.current) onClose(); }}
    >
      {children}
    </dialog>
  );
}

export function Chip({ active, onClick, children, count, title }) {
  return (
    <button type="button" className="chip" aria-pressed={!!active} onClick={onClick} title={title}>
      {children}
      {count != null && <span className="chip-count">{count}</span>}
    </button>
  );
}

export function Price({ value }) {
  if (!value) return null;
  return (
    <span className="price" aria-label={`Preço ${value} de 5`}>
      {'$'.repeat(value)}<span className="price-off">{'$'.repeat(5 - value)}</span>
    </span>
  );
}

const STAR = 'M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5L2.6 9.4l6.5-.9z';

/** Five stars. With onChange it is editable; tapping the current value clears it. */
export function Stars({ value, onChange, who, size = 22, label }) {
  const stars = [1, 2, 3, 4, 5].map((n) => {
    const on = value != null && n <= Math.round(value);
    const svg = (
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
        <path d={STAR} className={on ? 'star-on' : 'star-off'} />
      </svg>
    );
    if (!onChange) return <span key={n} className="star">{svg}</span>;
    return (
      <button
        key={n}
        type="button"
        className="star-btn"
        aria-label={`${n} ${n === 1 ? 'estrela' : 'estrelas'}${value === n ? ' (toque para limpar)' : ''}`}
        aria-pressed={value === n}
        onClick={() => onChange(value === n ? null : n)}
      >
        {svg}
      </button>
    );
  });
  return (
    <span
      className={`stars stars-${who || 'plain'}`}
      role={onChange ? 'group' : 'img'}
      aria-label={label || (value != null ? `${value} de 5 estrelas` : 'Sem nota')}
    >
      {stars}
    </span>
  );
}

export function Photo({ src, alt = '', className = '' }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) {
    return <div className={`photo photo-empty ${className}`} aria-hidden="true"><Utensils size={22} /></div>;
  }
  return (
    <img
      className={`photo ${className}`}
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

export function TagInput({ value, onChange, suggestions = [], placeholder, id }) {
  const [text, setText] = useState('');
  const listId = useId();
  const add = (raw) => {
    const tags = raw.split(',').map((t) => t.trim()).filter(Boolean);
    if (tags.length) onChange([...new Set([...value, ...tags])]);
    setText('');
  };
  return (
    <div className="tag-input">
      {value.map((t) => (
        <span key={t} className="tag">
          {t}
          <button type="button" aria-label={`Remover ${t}`} onClick={() => onChange(value.filter((x) => x !== t))}>×</button>
        </span>
      ))}
      <input
        id={id}
        value={text}
        list={listId}
        placeholder={placeholder}
        onChange={(e) => {
          const v = e.target.value;
          // Picking a suggestion from the list fills the whole value at once.
          if (suggestions.includes(v) || v.endsWith(',')) add(v);
          else setText(v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && text.trim()) { e.preventDefault(); add(text); }
          if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => text.trim() && add(text)}
      />
      <datalist id={listId}>
        {suggestions.filter((s) => !value.includes(s)).map((s) => <option key={s} value={s} />)}
      </datalist>
    </div>
  );
}
