import React, { useMemo } from 'react';
import { dayKey } from './draw.js';
import { Photo } from './ui.jsx';
import { monthName, monthShort, visitsLabel, weekdayShort } from './visits.js';

const MONTHS = [...Array(12).keys()];
const sectionId = (ym) => `hist-${ym}`;
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const monthTitle = (ym) => `${monthName(Number(ym.slice(5)) - 1)} de ${ym.slice(0, 4)}`;

/** Fixed steps, so a month with 3 visits looks the same in any year and with any filter. */
const level = (n) => (n >= 5 ? 4 : n >= 3 ? 3 : n === 2 ? 2 : n === 1 ? 1 : 0);

function jump(ym) {
  const el = document.getElementById(sectionId(ym));
  if (!el) return;
  const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
  // Moves keyboard and screen reader focus along with the view.
  el.querySelector('h3')?.focus({ preventScroll: true });
}

/** Every visit of the places that pass the filters: totals, one strip of months per year, then the timeline. */
export default function History({ places, filtered, onOpen }) {
  const data = useMemo(() => {
    const visits = places
      .flatMap((p) => (p.visits || []).map((v) => ({ ...v, place: p })))
      .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);

    const years = new Map(); // '2026' -> twelve counts
    const months = new Map(); // '2026-03' -> visits, newest first
    const perPlace = new Map();
    for (const v of visits) {
      const y = v.date.slice(0, 4);
      if (!years.has(y)) years.set(y, Array(12).fill(0));
      years.get(y)[Number(v.date.slice(5, 7)) - 1]++;
      const ym = v.date.slice(0, 7);
      if (!months.has(ym)) months.set(ym, []);
      months.get(ym).push(v);
      perPlace.set(v.place.id, (perPlace.get(v.place.id) || 0) + 1);
    }
    // Visits are already newest first, so on a tie the place visited most recently wins.
    let top = null;
    for (const v of visits) {
      const n = perPlace.get(v.place.id);
      if (!top || n > top.n) top = { place: v.place, n };
    }
    return { visits, years: [...years], months: [...months], places: perPlace.size, top };
  }, [places]);

  const year = dayKey().slice(0, 4);
  const thisYear = data.visits.filter((v) => v.date.startsWith(year)).length;

  if (!data.visits.length) {
    return (
      <div className="empty">
        {filtered
          ? <p>Nenhuma visita registrada nos lugares filtrados.</p>
          : <p>Nenhuma visita registrada ainda. As visitas aparecem aqui quando vocês registram uma na página de um lugar.</p>}
      </div>
    );
  }

  return (
    <div className="history">
      <div className="hist-totals">
        <p>
          <strong>{thisYear}</strong> {thisYear === 1 ? 'visita' : 'visitas'} em {year}
          {' · '}
          <strong>{data.places}</strong> {data.places === 1 ? 'lugar' : 'lugares diferentes'}
        </p>
        {/* With one visit each there is no "most visited". */}
        {data.top?.n > 1 && (
          <p>
            Mais visitado:{' '}
            <button type="button" className="link" onClick={() => onOpen(data.top.place.id)}>{data.top.place.name}</button>
            {' '}({visitsLabel(data.top.n)})
          </p>
        )}
      </div>

      <div className="heat">
        {data.years.map(([y, counts]) => (
          <section key={y} className="heat-year" aria-label={`Visitas por mês em ${y}`}>
            <h3>{y}</h3>
            <ol className="heat-months">
              {MONTHS.map((m) => {
                const n = counts[m];
                const ym = `${y}-${String(m + 1).padStart(2, '0')}`;
                return (
                  <li key={m}>
                    <button
                      type="button" className="heat-cell" data-level={level(n)} disabled={!n}
                      aria-label={`${monthName(m)} de ${y}: ${n ? visitsLabel(n) : 'nenhuma visita'}`}
                      onClick={() => jump(ym)}
                    >
                      <span className="heat-box" aria-hidden="true">{n || ''}</span>
                      <span className="heat-label" aria-hidden="true">{monthShort(m)}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>

      <div className="timeline">
        {data.months.map(([ym, visits]) => (
          <section key={ym} id={sectionId(ym)} className="tl-month" aria-labelledby={`${sectionId(ym)}-h`}>
            <h3 id={`${sectionId(ym)}-h`} tabIndex={-1}>
              {capital(monthTitle(ym))} <span className="tl-count">{visitsLabel(visits.length)}</span>
            </h3>
            <ol className="tl-entries">
              {visits.map((v) => {
                const p = v.place;
                const meta = [p.categories.slice(0, 2).join(', '), p.bairro || p.city].filter(Boolean).join(' · ');
                return (
                  <li key={v.id}>
                    <button type="button" className="tl-entry" onClick={() => onOpen(p.id)}>
                      <span className="tl-date">
                        <strong>{Number(v.date.slice(8))}</strong>
                        <span>{weekdayShort(v.date)}</span>
                      </span>
                      <span className="tl-photo"><Photo src={p.photos[0]} /></span>
                      <span className="tl-main">
                        <span className="tl-name">{p.name}</span>
                        {meta && <span className="tl-meta">{meta}</span>}
                        {v.note && <span className="tl-note">{v.note}</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}
