import React, { useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { RADII, STATUS, WHO, activeCount } from './filters.js';
import { Chip, Stars, Switch } from './ui.jsx';

const SHOWN = 10;

function toggle(list, value) {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/** A group of choices. Long groups show the most common ones first, with the rest behind "+ N". */
function Facet({ title, selected, options, onChange, render = (v) => v, open }) {
  const [all, setAll] = useState(false);
  if (!options.length) return null;
  const long = options.length > SHOWN + 2;
  const shown = !long || all
    ? options
    : options.filter(([value], i) => i < SHOWN || selected.includes(value));
  return (
    <details className="facet" open={open || selected.length > 0}>
      <summary>
        {title}
        {selected.length > 0 && <span className="facet-n">{selected.length}</span>}
        <ChevronDown size={16} aria-hidden="true" />
      </summary>
      <div className="chips">
        {shown.map(([value, count]) => (
          <Chip key={value} active={selected.includes(value)} count={count} onClick={() => onChange(toggle(selected, value))}>
            {render(value)}
          </Chip>
        ))}
        {long && (
          <button type="button" className="chip" onClick={() => setAll(!all)}>
            {all ? 'Mostrar menos' : `+ ${options.length - shown.length}`}
          </button>
        )}
      </div>
    </details>
  );
}

export default function FilterPanel({
  f, set, facets, gps, onLocate, originReady, total, onClear, onClose, openCount, withHours, all,
}) {
  const nearBairro = f.near.startsWith('b:') ? f.near.slice(2) : '';
  const prices = new Map(facets.prices);
  return (
    <aside className="panel" aria-label="Filtros">
      <header className="panel-head">
        <h2>Filtros</h2>
        {activeCount(f) > 0 && <button type="button" className="link" onClick={onClear}>Limpar</button>}
        <button type="button" className="icon-btn panel-close" aria-label="Fechar filtros" onClick={onClose}><X size={18} /></button>
      </header>

      <div className="panel-body">
        <section className="facet-static">
          <Switch checked={f.open} onChange={(open) => set({ open })}>
            Aberto agora <span className="chip-count">{openCount}</span>
          </Switch>
          {f.open && <p className="hint">Só entram lugares com horário cadastrado ({withHours} de {all}).</p>}
          <Switch checked={f.fav} onChange={(fav) => set({ fav })}>Só favoritos</Switch>
        </section>

        <section className="facet-static">
          <h3>Distância</h3>
          <div className="chips">
            <Chip active={f.near === 'me'} onClick={() => (f.near === 'me' ? set({ near: '', radius: 0 }) : onLocate())}>
              Perto de mim
            </Chip>
          </div>
          {f.near === 'me' && gps.state === 'loading' && <p className="hint">Pegando sua localização…</p>}
          {gps.msg && <p className="hint hint-warn" role="status">{gps.msg}</p>}
          <label className="field-inline">
            <span>ou a partir de</span>
            <select
              value={nearBairro}
              onChange={(e) => set(e.target.value ? { near: `b:${e.target.value}` } : { near: '', radius: 0 })}
            >
              <option value="">escolha um bairro</option>
              {facets.origins.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </label>
          {originReady && (
            <div className="chips" role="group" aria-label="Raio">
              <Chip active={!f.radius} onClick={() => set({ radius: 0 })}>Qualquer</Chip>
              {RADII.map((r) => (
                <Chip key={r} active={f.radius === r} onClick={() => set({ radius: r })}>{r} km</Chip>
              ))}
            </div>
          )}
        </section>

        <Facet title="Tipo de comida" open selected={f.cats} options={facets.cats} onChange={(cats) => set({ cats })} />

        <section className="facet-static">
          <h3>Preço</h3>
          <div className="seg seg-fill" role="group" aria-label="Preço">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n} type="button" aria-pressed={f.prices.includes(n)}
                title={`${prices.get(n) || 0} ${prices.get(n) === 1 ? 'lugar' : 'lugares'}`}
                onClick={() => set({ prices: toggle(f.prices, n) })}
              >
                {'$'.repeat(n)}
              </button>
            ))}
          </div>
        </section>

        <section className="facet-static">
          <h3>Já fomos?</h3>
          <div className="chips">
            {STATUS.map((s) => (
              <Chip key={s.id} active={f.status === s.id} onClick={() => set({ status: s.id })}>{s.label}</Chip>
            ))}
          </div>
        </section>

        <section className="facet-static">
          <h3>Nota mínima</h3>
          <div className="rating-filter">
            <Stars value={f.min || null} onChange={(n) => set({ min: n || 0 })} size={24} label="Nota mínima" />
            <span className="hint">{f.min ? `${f.min}+ estrelas` : 'qualquer nota'}</span>
          </div>
          {f.min > 0 && (
            <label className="field-inline">
              <span>na nota de</span>
              <select value={f.who} onChange={(e) => set({ who: e.target.value })}>
                {WHO.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
              </select>
            </label>
          )}
        </section>

        <Facet title="Cidade" selected={f.cities} options={facets.cities} onChange={(cities) => set({ cities })} />
        <Facet title="Região" selected={f.regions} options={facets.regions} onChange={(regions) => set({ regions })} />
        <Facet title="Bairro" selected={f.bairros} options={facets.bairros} onChange={(bairros) => set({ bairros })} />
        <Facet title="Palavras-chave" selected={f.kws} options={facets.kws} onChange={(kws) => set({ kws })} />
      </div>

      <footer className="panel-foot">
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Ver {total} {total === 1 ? 'lugar' : 'lugares'}
        </button>
      </footer>
    </aside>
  );
}
