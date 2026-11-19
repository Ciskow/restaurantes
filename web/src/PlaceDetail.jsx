import React, { useState } from 'react';
import { ArrowLeft, Globe, Heart, Instagram, MapPin, Pencil, Settings, Trash2 } from 'lucide-react';
import { PEOPLE, api } from './api.js';
import { dayKey } from './draw.js';
import { formatKm } from './filters.js';
import { DAYS } from './hours.js';
import { Modal, Photo, Price, Stars } from './ui.jsx';
import { NOTE_MAX, brDate, validDate, weekday } from './visits.js';

const SHOWN_VISITS = 5;
export const VISITED_LOCKED = 'Este lugar tem visitas registradas. Apague as visitas para desmarcar “Já fomos”.';

/** Date and note of one visit, used both to register a new one and to change an old one. */
function VisitForm({ visit, onSave, onCancel }) {
  const today = dayKey();
  const [date, setDate] = useState(visit?.date || today);
  const [note, setNote] = useState(visit?.note || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!validDate(date, today)) return setError('Escolha uma data de hoje ou do passado.');
    setError('');
    setBusy(true);
    // false when the server refused; the reason already went to the toast.
    const ok = await onSave({ date, note: note.trim() });
    if (!ok) setBusy(false);
  }

  return (
    <form className="visit-form" onSubmit={submit} noValidate>
      <label className="field-inline">
        <span>Data</span>
        <input type="date" value={date} max={today} required autoFocus onChange={(e) => { setDate(e.target.value); setError(''); }} />
      </label>
      <label className="field">
        <span>Observação (opcional)</span>
        <textarea
          rows={2} maxLength={NOTE_MAX} value={note} placeholder="O que pedimos, com quem fomos…"
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="visit-form-actions">
        <button type="button" className="btn btn-small" onClick={onCancel}>Cancelar</button>
        <button type="submit" className="btn btn-small btn-primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</button>
      </div>
    </form>
  );
}

function Visits({ place: p, onVisit }) {
  const [editing, setEditing] = useState(null); // 'new' | visit id
  const [all, setAll] = useState(false);
  const visits = p.visits || [];
  const shown = all ? visits : visits.slice(0, SHOWN_VISITS);
  // Saving only closes the form when the server took it.
  const run = (op) => onVisit(op).then((ok) => { if (ok) setEditing(null); return ok; });

  const remove = (v) => {
    if (!window.confirm(`Apagar a visita de ${brDate(v.date)}?`)) return;
    onVisit((token) => api.removeVisit(p.id, v.id, token));
  };

  return (
    <section className="section visits" aria-labelledby="visits-title">
      <div className="section-head">
        <h3 id="visits-title">Visitas{visits.length > 0 && <span className="section-n"> · {visits.length}</span>}</h3>
        {editing !== 'new' && (
          <button type="button" className="btn btn-small" onClick={() => setEditing('new')}>
            Registrar visita
          </button>
        )}
      </div>
      {editing === 'new' && (
        <VisitForm
          onCancel={() => setEditing(null)}
          onSave={(v) => run((token) => api.addVisit(p.id, v, token))}
        />
      )}
      {!visits.length && editing !== 'new' && <p className="hint">Nenhuma visita registrada ainda.</p>}
      {visits.length > 0 && (
        <ul className="visit-list">
          {shown.map((v) => (
            <li key={v.id} className="visit">
              {editing === v.id ? (
                <VisitForm
                  visit={v}
                  onCancel={() => setEditing(null)}
                  onSave={(data) => run((token) => api.updateVisit(p.id, v.id, data, token))}
                />
              ) : (
                <>
                  <div className="visit-main">
                    <p><strong>{brDate(v.date)}</strong> <span className="visit-day">{weekday(v.date)}</span></p>
                    {v.note && <p className="visit-note">{v.note}</p>}
                  </div>
                  <span className="visit-actions">
                    <button
                      type="button" className="icon-btn" aria-label={`Editar a visita de ${brDate(v.date)}`} title="Editar"
                      onClick={() => setEditing(v.id)}
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      type="button" className="icon-btn" aria-label={`Apagar a visita de ${brDate(v.date)}`} title="Apagar"
                      onClick={() => remove(v)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {visits.length > SHOWN_VISITS && (
        <button type="button" className="link" aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? 'Mostrar só as últimas' : `Ver todas as ${visits.length} visitas`}
        </button>
      )}
    </section>
  );
}

function handle(url) {
  const m = /instagram\.com\/([^/?#]+)/i.exec(url || '');
  return m ? `@${m[1]}` : 'Instagram';
}

function mapLinks(p) {
  const text = encodeURIComponent([p.name, p.address || p.bairro, p.city].filter(Boolean).join(' '));
  const view = p.maps_url || `https://www.google.com/maps/search/?api=1&query=${text}`;
  const dest = p.lat != null && !p.geo_approx ? `${p.lat},${p.lng}` : text;
  return { view, route: `https://www.google.com/maps/dir/?api=1&destination=${dest}` };
}

export default function PlaceDetail({
  place: p, auth, drawn, today, onDrawAgain, onVeto, onDrawOptions, onPatch, onVisit, onNotify, onEdit, onClose,
}) {
  const toggleVisited = () => {
    if (p.visited && p.visits?.length) return onNotify(VISITED_LOCKED);
    onPatch(p.id, { visited: !p.visited });
  };
  const maps = mapLinks(p);
  const where = [p.bairro, p.region, p.city].filter(Boolean).join(' · ');
  return (
    <Modal onClose={onClose} className="detail" label={p.name}>
      <div className="detail-top">
        <button type="button" className="icon-btn" aria-label="Voltar" onClick={onClose}><ArrowLeft size={18} /></button>
        <span className="detail-top-right">
          <button
            type="button" className={`icon-btn ${p.favorite ? 'is-fav' : ''}`} aria-pressed={p.favorite}
            aria-label={p.favorite ? 'Tirar dos favoritos' : 'Marcar como favorito'} title="Favorito"
            onClick={() => onPatch(p.id, { favorite: !p.favorite })}
          >
            <Heart size={18} fill={p.favorite ? 'currentColor' : 'none'} />
          </button>
          <button type="button" className="icon-btn" aria-label="Editar este lugar" title="Editar" onClick={() => onEdit(p)}>
            <Pencil size={16} />
          </button>
        </span>
      </div>

      <div className="detail-hero">
        <div className={`gallery ${p.photos.length > 1 ? 'gallery-many' : ''}`}>
          {(p.photos.length ? p.photos : ['']).map((src, i) => (
            <Photo key={src || i} src={src} alt={i === 0 ? `Foto de ${p.name}` : ''} />
          ))}
        </div>
        {/* Decoration only: the banner below says the same in words. */}
        {drawn && <span className="stamp" aria-hidden="true">Sorteado</span>}
      </div>

      {drawn && (
        <div className="drawn">
          <span>Sorteado entre {drawn.count} {drawn.count === 1 ? 'lugar' : 'lugares'}</span>
          <span className="drawn-actions">
            {drawn.count > 1 && (
              <>
                <button type="button" className="btn btn-small" onClick={() => onVeto(p.id)} title="Tira este lugar dos sorteios de hoje e sorteia outro">Vetar hoje</button>
                <button type="button" className="btn btn-small" onClick={onDrawAgain}>Sortear outro</button>
              </>
            )}
            <button type="button" className="btn btn-small btn-icon" aria-label="Opções do sorteio" title="Opções do sorteio" onClick={onDrawOptions}>
              <Settings size={16} />
            </button>
          </span>
        </div>
      )}

      <div className="detail-body">
        <div className="detail-head">
          <h2>{p.name}</h2>
          <p className="detail-status detail-meta">
            {p.categories.length > 0 && <span>{p.categories.join(', ')}</span>}
            {(p.bairro || p.city) && <span>{[p.bairro, p.city !== 'São Paulo' ? p.city : ''].filter(Boolean).join(', ') || p.city}</span>}
            {p.price ? <span><Price value={p.price} /></span> : null}
          </p>
          {(p.status || p.dist != null) && (
            <p className="detail-status">
              {p.status && <span className={p.status.open ? 'open-yes' : 'open-no'}>{p.status.text}</span>}
              {p.dist != null && <span>{p.geo_approx ? '≈ ' : ''}{formatKm(p.dist)}</span>}
            </p>
          )}
        </div>

        <div className="actions">
          <a className="btn btn-primary" href={maps.route} target="_blank" rel="noreferrer">
            Como chegar
          </a>
          <a className="btn btn-icon" href={maps.view} target="_blank" rel="noreferrer" aria-label="Ver no Google Maps" title="Ver no Google Maps">
            <MapPin size={18} />
          </a>
          {p.instagram && (
            <a className="btn btn-icon" href={p.instagram} target="_blank" rel="noreferrer" aria-label={`Instagram ${handle(p.instagram)}`} title={handle(p.instagram)}>
              <Instagram size={18} />
            </a>
          )}
          {p.website && (
            <a className="btn btn-icon" href={p.website} target="_blank" rel="noreferrer" aria-label="Site" title="Site">
              <Globe size={18} />
            </a>
          )}
          {p.links.map((l) => (
            <a key={l.url} className="btn" href={l.url} target="_blank" rel="noreferrer">{l.label || 'Link'}</a>
          ))}
        </div>

        <section className="ratings" aria-label="Notas">
          {PEOPLE.map((person) => {
            const mine = !auth.token || auth.who === person.id;
            return (
              <div key={person.id} className="rating-row">
                <span className={`who who-${person.id}`}>{person.label}</span>
                <Stars
                  who={person.id}
                  value={p[person.field]}
                  size={26}
                  label={`Nota de ${person.label}`}
                  onChange={mine ? (n) => onPatch(p.id, { [person.field]: n }, person.id) : undefined}
                />
              </div>
            );
          })}
          <div className="toggles">
            <button type="button" className="chip" aria-pressed={p.visited} onClick={toggleVisited}>
              Já fomos
            </button>
            <button type="button" className="chip" aria-pressed={p.want} onClick={() => onPatch(p.id, { want: !p.want })}>
              Queremos ir
            </button>
          </div>
        </section>

        <Visits place={p} onVisit={onVisit} />

        {p.dish && (
          <section className="section">
            <h3>Prato pra pedir</h3>
            <p>{p.dish}</p>
          </section>
        )}
        {(p.notes || p.keywords.length > 0) && (
          <section className="section">
            <h3>Observações</h3>
            {p.notes && <p className="notes">{p.notes}</p>}
            {p.keywords.length > 0 && (
              <p className="tags">{p.keywords.map((k) => <span key={k} className="tag">{k}</span>)}</p>
            )}
          </section>
        )}

        <section className="section">
          <h3>Endereço</h3>
          <p>{p.address || where || 'Sem endereço cadastrado'}</p>
          {p.lat == null && <p className="hint">Sem coordenadas: este lugar não aparece no mapa nem nos filtros de distância.</p>}
          {p.lat != null && p.geo_approx && <p className="hint">Localização aproximada.</p>}
        </section>

        {p.hours.length === 7 && (
          <section className="section">
            <h3>Horário</h3>
            <dl className="hours">
              {DAYS.map((d) => (
                <div key={d.i} className={d.i === today ? 'hours-today' : ''}>
                  <dt>{d.long}</dt>
                  <dd>{p.hours[d.i] === '00:00-00:00' ? '24 horas' : p.hours[d.i] ? p.hours[d.i].replaceAll('-', '–') : 'Fechado'}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}
      </div>
    </Modal>
  );
}
