import React, { useState } from 'react';
import {
  Briefcase, Dumbbell, GraduationCap, House, MapPin, Pencil, ShoppingBag, Star, TrainFront, Trees, Users, X,
} from 'lucide-react';
import { api } from './api.js';
import { Modal } from './ui.jsx';

// Our own landmarks (homes, malls, work...). They only appear on the map and as a distance origin,
// never in the list. The server keeps the same ids in POI_ICONS.
export const POI_ICONS = [
  { id: 'casa', label: 'Casa', Icon: House },
  { id: 'familia', label: 'Família', Icon: Users },
  { id: 'shopping', label: 'Shopping', Icon: ShoppingBag },
  { id: 'trabalho', label: 'Trabalho', Icon: Briefcase },
  { id: 'estudo', label: 'Estudo', Icon: GraduationCap },
  { id: 'academia', label: 'Academia', Icon: Dumbbell },
  { id: 'parque', label: 'Parque', Icon: Trees },
  { id: 'estacao', label: 'Estação', Icon: TrainFront },
  { id: 'outro', label: 'Outro', Icon: Star },
];
export const poiIcon = (id) => POI_ICONS.find((i) => i.id === id) || POI_ICONS[POI_ICONS.length - 1];

export const BLANK_POI = { name: '', icon: 'casa', lat: null, lng: null };

const fmt = (n) => Number(n).toFixed(5);

/**
 * The "Meus pontos" dialog: the list of saved points, or the form for one of them.
 * `draft` reopens the form where it was left (after picking a spot on the map).
 */
export default function Pois({ pois, auth, draft, onSave, onDelete, onPick, onLocate, onClose }) {
  const [d, setD] = useState(draft || null);
  const [query, setQuery] = useState('');
  const [msg, setMsg] = useState(draft?.picked ? 'Local marcado no mapa.' : '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const set = (patch) => setD((old) => ({ ...old, ...patch }));

  const edit = (p) => { setD(p ? { ...p } : { ...BLANK_POI }); setQuery(''); setMsg(''); setError(''); };

  async function find() {
    const q = query.trim();
    if (!q) return setMsg('Digite um endereço ou cole um link do Google Maps.');
    setBusy('find');
    setMsg('Buscando…');
    try {
      if (/^https?:\/\//i.test(q)) {
        const found = await api.importLink(q, auth.token);
        if (found.lat == null) throw new Error('Esse link não trouxe a localização. Tente o endereço.');
        set({ lat: found.lat, lng: found.lng, ...(!d.name.trim() && found.name ? { name: found.name.slice(0, 60) } : {}) });
        setMsg(`Encontrado: ${found.name || found.address || 'local do link'}.`);
      } else {
        const hit = await api.geocode(q, auth.token);
        set({ lat: hit.lat, lng: hit.lng });
        setMsg(`Encontrado: ${hit.label}.`);
      }
      setQuery('');
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy('');
    }
  }

  async function here() {
    setBusy('here');
    setMsg('Pegando sua localização…');
    const pos = await onLocate();
    setBusy('');
    if (pos) { set({ lat: pos.lat, lng: pos.lng }); setMsg('Usando onde você está agora.'); } else setMsg('');
  }

  async function submit(e) {
    e.preventDefault();
    if (!d.name.trim()) return setError('Dê um nome ao ponto.');
    if (d.lat == null) return setError('Escolha onde fica o ponto.');
    setBusy('save');
    setError('');
    try {
      await onSave(d);
      setD(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  async function remove() {
    if (!window.confirm(`Apagar o ponto "${d.name}"?`)) return;
    setBusy('save');
    try {
      await onDelete(d.id);
      setD(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  if (!d) {
    return (
      <Modal onClose={onClose} className="form-modal pois-modal" label="Meus pontos">
        <div className="pois-sheet">
          <header className="form-head">
            <h2>Meus pontos</h2>
            <button type="button" className="icon-btn" aria-label="Fechar" onClick={onClose}><X size={18} /></button>
          </header>
          <div className="form-body">
            <p className="hint">
              Casas, shoppings, trabalho: referências que aparecem só no mapa e servem para achar lugares perto
              delas. Só quem tem o PIN vê os pontos.
            </p>
            {pois.length ? (
              <ul className="poi-list">
                {pois.map((p) => {
                  const { Icon, label } = poiIcon(p.icon);
                  return (
                    <li key={p.id}>
                      <span className="poi-mark" title={label}><Icon size={16} aria-hidden="true" /></span>
                      <span className="poi-name">{p.name}</span>
                      <button type="button" className="btn btn-small" onClick={() => edit(p)} aria-label={`Editar ${p.name}`}>
                        <Pencil size={14} aria-hidden="true" /> Editar
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="empty-note">Nenhum ponto salvo ainda.</p>
            )}
          </div>
          <footer className="form-foot">
            <button type="button" className="btn" onClick={onClose}>Fechar</button>
            <button type="button" className="btn btn-primary" data-autofocus onClick={() => edit(null)}>Novo ponto</button>
          </footer>
        </div>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose} className="form-modal pois-modal" label={d.id ? `Editar ${d.name}` : 'Novo ponto'}>
      <form onSubmit={submit} noValidate>
        <header className="form-head">
          <h2>{d.id ? 'Editar ponto' : 'Novo ponto'}</h2>
          <button type="button" className="icon-btn" aria-label="Fechar" onClick={onClose}><X size={18} /></button>
        </header>
        <div className="form-body">
          <label className="field">
            <span>Nome</span>
            <input
              value={d.name} maxLength={60} placeholder="Ex.: Casa da Andkiwii" data-autofocus={!d.picked || undefined}
              onChange={(e) => set({ name: e.target.value })}
            />
          </label>

          <fieldset className="field">
            <legend>Ícone</legend>
            <div className="poi-icons" role="radiogroup" aria-label="Ícone">
              {POI_ICONS.map(({ id, label, Icon }) => (
                <button
                  key={id} type="button" role="radio" aria-checked={d.icon === id} className="poi-icon"
                  onClick={() => set({ icon: id })}
                >
                  <Icon size={18} aria-hidden="true" />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="field">
            <legend>Onde fica</legend>
            <div className="input-row">
              <input
                value={query} placeholder="Endereço ou link do Google Maps" aria-label="Endereço ou link do Google Maps"
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); find(); } }}
              />
              <button type="button" className="btn" disabled={!!busy} onClick={find}>Buscar</button>
            </div>
            <div className="poi-where">
              <button type="button" className="btn btn-small" disabled={!!busy} onClick={here}>Onde estou agora</button>
              <button
                type="button" className="btn btn-small" disabled={!!busy}
                data-autofocus={d.picked || undefined} onClick={() => onPick(d)}
              >
                <MapPin size={15} aria-hidden="true" /> Marcar no mapa
              </button>
            </div>
            <p className={`poi-spot ${d.lat == null ? 'poi-spot-none' : ''}`} role="status">
              {d.lat == null ? 'Ainda sem local.' : <>Local: <span className="num">{fmt(d.lat)}, {fmt(d.lng)}</span></>}
              {msg && <> · {msg}</>}
            </p>
          </fieldset>
        </div>
        <footer className="form-foot">
          {error && <p className="error" role="alert">{error}</p>}
          {d.id && <button type="button" className="btn btn-danger" disabled={!!busy} onClick={remove}>Apagar</button>}
          <button type="button" className="btn" disabled={!!busy} onClick={() => setD(null)}>Voltar</button>
          <button type="submit" className="btn btn-primary" disabled={!!busy}>Salvar</button>
        </footer>
      </form>
    </Modal>
  );
}
