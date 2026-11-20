import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PEOPLE, api, loadAuth, saveAuth } from './api.js';
import { REST_DAYS, drawPool, loadDrawOpts, loadVetoes, pick, saveDrawOpts, saveVetoes } from './draw.js';
import {
  Heart, History as HistoryIcon, List, Map as MapIcon, Plus, Search, Settings, SlidersHorizontal, Star, X,
} from 'lucide-react';
import { nowSP, openStatus } from './hours.js';
import {
  EMPTY, SORTS, STATUS, WHO, activeCount, avgRating, effectiveSort, facetCounts, formatKm, fromQuery, km,
  matches, sortPlaces, toQuery, viewFromQuery,
} from './filters.js';
import FilterPanel from './FilterPanel.jsx';
import History from './History.jsx';
import PlaceDetail, { VISITED_LOCKED } from './PlaceDetail.jsx';
import PlaceForm from './PlaceForm.jsx';
import { Chip, Modal, Photo, Price } from './ui.jsx';

// The map library is only downloaded when the map is first opened.
const MapView = lazy(() => import('./MapView.jsx'));

function getPosition() {
  return new Promise((resolve, reject) => {
    if (!window.isSecureContext || !navigator.geolocation) return reject(new Error('insecure'));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      reject,
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    );
  });
}
const gpsMessage = (err) => {
  if (err.message === 'insecure') return 'O GPS só funciona pelo endereço HTTPS. Por enquanto, escolha um bairro.';
  if (err.code === 1) return 'Permissão de localização negada. Libere nas configurações do navegador ou escolha um bairro.';
  return 'Não consegui pegar sua localização. Tente de novo ou escolha um bairro.';
};

function DrawOptions({ opts, onChange, vetoed, onClearVetoes, pool, total, onClose }) {
  return (
    <Modal onClose={onClose} className="account" label="Opções do sorteio">
      <div className="draw-opts">
        <h2>Opções do sorteio</h2>
        <label className="check">
          <input type="checkbox" checked={opts.fresh} onChange={(e) => onChange({ ...opts, fresh: e.target.checked })} />
          <span>
            <strong>Preferir lugares novos</strong>
            <small>Onde ainda não fomos tem 3× mais chance; se está em “Queremos ir”, 4×.</small>
          </span>
        </label>
        <label className="check">
          <input type="checkbox" checked={opts.rest} onChange={(e) => onChange({ ...opts, rest: e.target.checked })} />
          <span>
            <strong>Pular onde fomos há pouco</strong>
            <small>Tira do sorteio os lugares visitados nos últimos {REST_DAYS} dias.</small>
          </span>
        </label>
        <p className="hint" role="status">
          {pool} de {total} {total === 1 ? 'lugar filtrado está' : 'lugares filtrados estão'} no sorteio.
          {vetoed.length > 0 && ` ${vetoed.length} ${vetoed.length === 1 ? 'vetado' : 'vetados'} hoje: ${vetoed.join(', ')}.`}
        </p>
        <div className="account-actions">
          {vetoed.length > 0 && <button type="button" className="btn" onClick={onClearVetoes}>Limpar vetos</button>}
          <button type="button" className="btn btn-primary" data-autofocus onClick={onClose}>Pronto</button>
        </div>
      </div>
    </Modal>
  );
}

const openLabel = (n) => (n === 0 ? 'Nenhum lugar aberto agora' : n === 1 ? '1 lugar aberto agora' : `${n} lugares abertos agora`);

const byCountThenName = (a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), 'pt-BR');
const byName = (a, b) => String(a[0]).localeCompare(String(b[0]), 'pt-BR');
const uniq = (values) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));

function Account({ auth, preset, onDone, onLogout, onClose }) {
  const [pin, setPin] = useState('');
  const [who, setWho] = useState(auth.who || preset || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const radios = useRef({});

  // The two names are one choice: a radio group, where the arrow keys move and select.
  const step = (dir) => {
    const i = Math.max(0, PEOPLE.findIndex((p) => p.id === who));
    const next = PEOPLE[(i + dir + PEOPLE.length) % PEOPLE.length];
    setWho(next.id);
    radios.current[next.id]?.focus();
  };

  async function submit(e) {
    e.preventDefault();
    if (!who) return setError('Escolha quem está usando.');
    if (auth.token) return onDone({ token: auth.token, who });
    setBusy(true);
    setError('');
    try {
      const { token } = await api.login(pin);
      onDone({ token, who });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} className="account" label="Entrar para editar">
      <form onSubmit={submit}>
        <h2>{auth.token ? 'Quem está usando?' : 'Entrar para editar'}</h2>
        {!auth.token && <p className="hint">Dar nota, adicionar e editar lugares pede o PIN uma vez neste aparelho.</p>}
        <div className="chips" role="radiogroup" aria-label="Quem está usando">
          {PEOPLE.map((p, i) => (
            <button
              key={p.id} ref={(el) => { radios.current[p.id] = el; }}
              type="button" role="radio" aria-checked={who === p.id} className={`chip chip-who who-${p.id}`}
              tabIndex={(who ? who === p.id : i === 0) ? 0 : -1}
              // With nobody chosen yet, the choice comes first; otherwise straight to the PIN.
              data-autofocus={!who && i === 0 ? '' : undefined}
              onClick={() => setWho(p.id)}
              onKeyDown={(e) => {
                const dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
                if (dir) { e.preventDefault(); step(dir); }
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        {!auth.token && (
          <label className="field">
            <span>PIN</span>
            <input
              type="password" inputMode="numeric" autoComplete="current-password" data-autofocus={who ? '' : undefined}
              value={pin} onChange={(e) => setPin(e.target.value)}
            />
          </label>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="account-actions">
          {auth.token && <button type="button" className="btn" onClick={onLogout}>Sair</button>}
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{auth.token ? 'Confirmar' : 'Entrar'}</button>
        </div>
      </form>
    </Modal>
  );
}

/** Shown as a popover so it sits above any open dialog. */
function Toast({ msg }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    try { el.hidePopover(); } catch { /* not open yet */ }
    try { el.showPopover(); } catch { /* popover unsupported: stays in normal flow */ }
  }, [msg]);
  return <div ref={ref} popover="manual" className="toast" role="status">{msg}</div>;
}

/**
 * One place in the list: photo, name, what and where, open/distance, and the two ratings.
 * The name is a heading holding the button, so screen readers can jump from place to place;
 * the button's ::after stretches over the whole row, so a tap anywhere still opens it.
 */
function Row({ p, onOpen }) {
  const rated = avgRating(p) != null;
  const visits = p.visits?.length || 0;
  const meta = [p.categories.slice(0, 2).join(', '), p.bairro || p.city].filter(Boolean).join(' · ');
  return (
    <li className="row">
      <div className="row-photo"><Photo src={p.photos[0]} /></div>
      <div className="row-main">
        <h3>
          <button type="button" className="row-open" onClick={() => onOpen(p.id)}>{p.name}</button>
          {p.favorite && <Heart className="fav-mark" size={13} fill="currentColor" role="img" aria-label="Favorito" />}
        </h3>
        <p className="row-meta">
          {meta}
          {meta && p.price ? ' · ' : ''}
          <Price value={p.price} scale={false} />
          {!meta && !p.price && 'Sem categoria'}
        </p>
        {(p.status || p.dist != null || visits > 1) && (
          <p className="row-status">
            {p.status && <span className={p.status.open ? 'open-yes' : 'open-no'}>{p.status.text}</span>}
            {p.dist != null && <span>{p.geo_approx ? '≈ ' : ''}{formatKm(p.dist)}</span>}
            {visits > 1 && <span>{visits} visitas</span>}
          </p>
        )}
      </div>
      <div className="row-side">
        {rated && PEOPLE.map((person) => p[person.field] != null && (
          <span key={person.id} className={`score who-${person.id}`} title={`Nota de ${person.label}`}>
            <span className="sr-only">Nota de {person.label}: </span>
            <span className="score-who" aria-hidden="true">{person.label[0]}</span>
            {p[person.field].toLocaleString('pt-BR')}
            <span className="sr-only"> de 5</span> <Star size={12} fill="currentColor" aria-hidden="true" />
          </span>
        ))}
        {!rated && p.visited && <span className="flag">já fomos</span>}
        {!rated && !p.visited && p.want && <span className="flag">queremos ir</span>}
      </div>
    </li>
  );
}

export default function App() {
  const [places, setPlaces] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [f, setF] = useState(() => fromQuery(window.location.search));
  const [openId, setOpenId] = useState(() => Number(new URLSearchParams(window.location.search).get('p')) || null);
  const [gps, setGps] = useState({ state: 'idle', pos: null, msg: '' });
  const [auth, setAuth] = useState(loadAuth);
  const [account, setAccount] = useState(null); // { then?, preset? }
  const [form, setForm] = useState(null); // { place } | { place: null }
  const [drawn, setDrawn] = useState(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [toast, setToast] = useState('');
  const toastTimer = useRef(0);
  const [view, setView] = useState(() => viewFromQuery(window.location.search)); // 'lista' | 'mapa' | 'historico'
  const [now, setNow] = useState(nowSP);
  const [drawOpts, setDrawOpts] = useState(loadDrawOpts);
  const [vetoes, setVetoes] = useState(loadVetoes);
  const [drawDlg, setDrawDlg] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const filtersBtn = useRef(null);
  const panelWasOpen = useRef(false);

  // On the phone the filter panel covers the whole screen: everything behind it is made inert, so
  // Tab and screen reader swipes stay inside it, and closing it puts focus back on the Filtros button.
  useEffect(() => {
    const phone = window.matchMedia('(max-width: 899px)');
    const apply = () => {
      const on = panelOpen && phone.matches;
      document.querySelectorAll('.skip, .ribbon, .masthead, .top, .offline, main, .tabbar, .fab')
        .forEach((el) => { el.inert = on; });
    };
    apply();
    if (panelWasOpen.current && !panelOpen) filtersBtn.current?.focus({ preventScroll: true });
    panelWasOpen.current = panelOpen;
    phone.addEventListener('change', apply);
    return () => phone.removeEventListener('change', apply);
  }, [panelOpen]);

  useEffect(() => {
    const tick = setInterval(() => setNow(nowSP()), 60_000);
    const net = () => setOnline(navigator.onLine);
    window.addEventListener('online', net);
    window.addEventListener('offline', net);
    return () => {
      clearInterval(tick);
      window.removeEventListener('online', net);
      window.removeEventListener('offline', net);
    };
  }, []);

  const set = useCallback((patch) => setF((old) => ({ ...old, ...patch })), []);
  const notify = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 4000);
  }, []);

  const load = useCallback(() => {
    setLoadError('');
    api.places().then(setPlaces).catch((e) => setLoadError(e.message));
  }, []);
  useEffect(load, [load]);

  // ---- the phone's back button ----
  // Every screen that opens on top of the list (map or history, filters, a place, the form, a dialog) adds
  // one step to the browser history, so "back" closes the top one instead of leaving the app.
  // Map and history share one step: switching between them and then pressing back lands on the list.
  const layers = [view !== 'lista', panelOpen, !!openId, !!form, !!account, drawDlg];
  const depth = layers.filter(Boolean).length;
  const back = useRef({ depth: 0, fromBack: false, ignore: false, closeTop: () => {} });
  back.current.closeTop = () => {
    if (drawDlg) setDrawDlg(false);
    else if (account) { account.onCancel?.(); setAccount(null); }
    else if (form) setForm(null);
    else if (openId) { setOpenId(null); setDrawn(null); }
    else if (panelOpen) setPanelOpen(false);
    else if (view !== 'lista') setView('lista');
  };
  useEffect(() => {
    const onBack = () => {
      const b = back.current;
      if (b.ignore) { b.ignore = false; return; } // caused by our own history.go() below
      if (b.depth > 0) { b.fromBack = true; b.closeTop(); }
    };
    window.addEventListener('popstate', onBack);
    return () => window.removeEventListener('popstate', onBack);
  }, []);
  useEffect(() => {
    const b = back.current;
    if (depth > b.depth) {
      for (let i = b.depth; i < depth; i++) window.history.pushState({ layer: i + 1 }, '');
    } else if (depth < b.depth && !b.fromBack) {
      // Closed with a button on screen: drop the matching history steps so "back" stays in sync.
      b.ignore = true;
      window.history.go(depth - b.depth);
    }
    b.fromBack = false;
    b.depth = depth;
  }, [depth]);

  // Keeps the address bar in step with the filters. It has to run after the history steps above,
  // so the list's own entry keeps the list's address and only the top entry names the open place.
  useEffect(() => {
    window.history.replaceState(window.history.state, '', window.location.pathname + toQuery(f, openId, view));
  }, [f, openId, view]);

  // ---- where am I ----
  const locate = useCallback(() => {
    set({ near: 'me' });
    setGps((g) => ({ ...g, state: 'loading', msg: '' }));
    getPosition().then(
      (pos) => setGps({ state: 'ok', pos, msg: '' }),
      (err) => setGps({ state: 'error', pos: null, msg: gpsMessage(err) }),
    );
  }, [set]);

  // The map's "where am I" button: shows the dot without turning on the distance filter.
  const locateForMap = useCallback(() => getPosition().then(
    (pos) => { setGps({ state: 'ok', pos, msg: '' }); return pos; },
    (err) => { notify(gpsMessage(err)); return null; },
  ), [notify]);

  useEffect(() => {
    if (f.near === 'me' && gps.state === 'idle') locate();
    if (f.near !== 'me' && gps.msg) setGps((g) => ({ ...g, msg: '' }));
  }, [f.near, gps.state, gps.msg, locate]);

  const origin = useMemo(() => {
    if (f.near === 'me') return gps.pos;
    if (f.near.startsWith('b:') && places) {
      const inBairro = places.filter((p) => p.bairro === f.near.slice(2) && p.lat != null);
      if (!inBairro.length) return null;
      return {
        lat: inBairro.reduce((s, p) => s + p.lat, 0) / inBairro.length,
        lng: inBairro.reduce((s, p) => s + p.lng, 0) / inBairro.length,
      };
    }
    return null;
  }, [f.near, gps.pos, places]);

  const withDist = useMemo(
    () => (places || []).map((p) => ({
      ...p,
      dist: origin && p.lat != null ? km(origin, p) : null,
      ...(() => {
        const status = openStatus(p.hours, now);
        return { status, openNow: status ? status.open : null };
      })(),
    })),
    [places, origin, now],
  );

  // Without a known origin the radius cannot be applied yet, so it is ignored instead of hiding everything.
  const fx = useMemo(() => (origin ? f : { ...f, radius: 0 }), [f, origin]);
  const list = useMemo(() => sortPlaces(withDist.filter((p) => matches(p, fx)), fx), [withDist, fx]);

  const facets = useMemo(() => {
    const count = (key, valuesOf, order = byCountThenName, selected = []) => {
      const counts = facetCounts(withDist, fx, key, valuesOf);
      for (const s of selected) if (!counts.has(s)) counts.set(s, 0);
      return [...counts].sort(order);
    };
    return {
      cats: count('cats', (p) => p.categories, byCountThenName, f.cats),
      prices: count('prices', (p) => [p.price], (a, b) => a[0] - b[0], f.prices),
      cities: count('cities', (p) => [p.city], byCountThenName, f.cities),
      regions: count('regions', (p) => [p.region], byName, f.regions),
      bairros: count('bairros', (p) => [p.bairro], byName, f.bairros),
      kws: count('kws', (p) => p.keywords, byCountThenName, f.kws),
      origins: uniq(withDist.filter((p) => p.lat != null).map((p) => p.bairro)),
    };
  }, [withDist, fx, f.cats, f.prices, f.cities, f.regions, f.bairros, f.kws]);

  const options = useMemo(() => ({
    cats: uniq(withDist.flatMap((p) => p.categories)),
    kws: uniq(withDist.flatMap((p) => p.keywords)),
    cities: uniq(withDist.map((p) => p.city)),
    regions: uniq(withDist.map((p) => p.region)),
    bairros: uniq(withDist.map((p) => p.bairro)),
  }), [withDist]);

  const open = withDist.find((p) => p.id === openId) || null;

  // ---- editing (asks for the PIN the first time) ----
  const guard = (action, preset, onCancel) => {
    if (auth.token && auth.who) action(auth);
    else setAccount({ then: action, preset, onCancel });
  };

  const fail = (e) => {
    if (e.status === 401) {
      const cleared = { token: '', who: '' };
      saveAuth(cleared);
      setAuth(cleared);
      notify('O PIN mudou. Entre de novo para editar.');
    } else notify(e.message);
  };

  const replace = (p) => setPlaces((ps) => ps.map((x) => (x.id === p.id ? p : x)));

  const patch = (id, data, preset) => guard((a) => {
    // People only change their own stars.
    const mine = PEOPLE.find((p) => p.id === a.who)?.field;
    const other = PEOPLE.find((p) => p.id !== a.who)?.field;
    if (other in data && !(mine in data)) return notify(`Você entrou como ${PEOPLE.find((p) => p.id === a.who).label}.`);
    api.update(id, data, a.token).then(replace).catch(fail);
  }, preset);

  // Adding, changing or removing a visit: op(token) calls the server, which answers with the whole place.
  // Resolves true once saved, false when refused or when the PIN dialog was closed, so forms can react.
  const visitOp = (op) => new Promise((resolve) => guard(
    (a) => op(a.token).then((p) => { replace(p); resolve(true); }, (e) => { fail(e); resolve(false); }),
    undefined,
    () => resolve(false),
  ));

  const save = async (data) => {
    const editing = form.place;
    try {
      const saved = editing ? await api.update(editing.id, data, auth.token) : await api.create(data, auth.token);
      if (editing) replace(saved);
      else setPlaces((ps) => [...ps, saved]);
      setForm(null);
      setOpenId(saved.id);
      notify(editing ? 'Alterações salvas.' : `${saved.name} adicionado.`);
    } catch (e) {
      if (e.status === 401) { fail(e); setForm(null); } else throw e;
    }
  };

  const remove = (id) => api.remove(id, auth.token).then(() => {
    setPlaces((ps) => ps.filter((p) => p.id !== id));
    setForm(null);
    setOpenId(null);
    notify('Lugar apagado.');
  }).catch(fail);

  // ---- random ----
  const pool = useMemo(() => drawPool(list, drawOpts, vetoes), [list, drawOpts, vetoes]);

  const draw = (from = pool) => {
    const chosen = pick(from, drawOpts, openId);
    if (!chosen) {
      setOpenId(null);
      setDrawn(null);
      return notify(list.length ? 'Nada sobrou para sortear com essas regras e vetos.' : 'Nenhum lugar para sortear.');
    }
    setOpenId(chosen.id);
    setDrawn({ count: from.length });
  };

  const veto = (id) => {
    const next = [...new Set([...vetoes, id])];
    saveVetoes(next);
    setVetoes(next);
    draw(drawPool(list, drawOpts, next));
  };

  const changeDrawOpts = (opts) => { saveDrawOpts(opts); setDrawOpts(opts); };
  const openStats = useMemo(() => ({
    open: withDist.filter((p) => p.openNow === true && matches(p, fx, 'open')).length,
    known: withDist.filter((p) => p.openNow != null).length,
    // Places the other filters would show, but "open now" drops because nobody typed their hours.
    unknown: withDist.filter((p) => p.openNow == null && matches(p, fx, 'open')).length,
  }), [withDist, fx]);

  const closeDetail = () => { setOpenId(null); setDrawn(null); };
  const clear = () => setF({ ...EMPTY, q: f.q, sort: f.sort });
  const nActive = activeCount(f);

  // Removable summary of what is filtering the list right now.
  const active = [
    ...f.cats.map((v) => [v, () => set({ cats: f.cats.filter((x) => x !== v) })]),
    ...f.prices.map((v) => ['$'.repeat(v), () => set({ prices: f.prices.filter((x) => x !== v) }), `preço ${v} de 5`]),
    ...f.cities.map((v) => [v, () => set({ cities: f.cities.filter((x) => x !== v) })]),
    ...f.regions.map((v) => [v, () => set({ regions: f.regions.filter((x) => x !== v) })]),
    ...f.bairros.map((v) => [v, () => set({ bairros: f.bairros.filter((x) => x !== v) })]),
    ...f.kws.map((v) => [`#${v}`, () => set({ kws: f.kws.filter((x) => x !== v) })]),
    // "Aberto agora", "Perto de mim" and "Queremos ir" have their own chips above the list.
    ...(f.status && f.status !== 'quero' ? [[STATUS.find((s) => s.id === f.status).label, () => set({ status: '' })]] : []),
    ...(f.min ? [[`${f.min}+ estrelas (${WHO.find((w) => w.id === f.who).label})`, () => set({ min: 0 })]] : []),
    ...(f.near.startsWith('b:') ? [[`Perto de ${f.near.slice(2)}`, () => set({ near: '', radius: 0 })]] : []),
    ...(f.near && f.radius ? [[`até ${f.radius} km`, () => set({ radius: 0 })]] : []),
  ];
  const drawTuned = drawOpts.fresh || drawOpts.rest || vetoes.length > 0;
  const openPlace = (id) => { setDrawn(null); setOpenId(id); };

  const whoLabel = PEOPLE.find((p) => p.id === auth.who)?.label;

  return (
    <div className={`app ${panelOpen ? 'panel-open' : ''}`}>
      {/* A real link would add a history step and confuse the back-button handling above. */}
      <a
        className="skip" href="#conteudo"
        onClick={(e) => { e.preventDefault(); document.getElementById('conteudo')?.focus(); }}
      >
        Pular os filtros
      </a>
      <p className="ribbon">{places ? openLabel(withDist.filter((p) => p.openNow).length) : '\u00a0'}</p>
      <div className="masthead">
        <a className="wordmark" href="/">Bora Comer</a>
      </div>
      <header className="top">
        <label className="search">
          <span className="sr-only">Buscar</span>
          <Search size={16} aria-hidden="true" />
          <input
            type="search" placeholder="Buscar lugares" value={f.q}
            onChange={(e) => set({ q: e.target.value })}
          />
        </label>
        <button
          type="button" className="btn btn-small top-add" aria-label="Novo lugar"
          onClick={() => guard(() => setForm({ place: null }))}
        >
          <Plus size={17} aria-hidden="true" /> <span className="wide-only">Novo lugar</span>
        </button>
        <button
          type="button"
          className={`btn btn-small top-who ${auth.who ? `who-${auth.who}` : ''}`}
          onClick={() => setAccount({})}
        >
          {whoLabel || 'Entrar'}
        </button>
      </header>

      {!online && (
        <p className="offline" role="status">Sem conexão: mostrando a lista salva neste aparelho. Edições ficam indisponíveis.</p>
      )}

      <div className="layout">
        <FilterPanel
          f={f} set={set} facets={facets} gps={gps} onLocate={locate} originReady={!!origin}
          total={list.length} onClear={clear} open={panelOpen} onClose={() => setPanelOpen(false)}
          openCount={openStats.open} withHours={openStats.known} all={withDist.length}
        />

        <main id="conteudo" tabIndex={-1}>
          <div className="toolbar">
            <div className="quick" role="group" aria-label="Filtros rápidos">
              <button
                ref={filtersBtn} type="button" className="chip filters-btn"
                aria-expanded={panelOpen} aria-controls="filtros" onClick={() => setPanelOpen(true)}
              >
                <SlidersHorizontal size={15} aria-hidden="true" /> Filtros
                {nActive > 0 && <span className="facet-n">{nActive}</span>}
              </button>
              <Chip active={f.open} onClick={() => set({ open: !f.open })}>Aberto agora</Chip>
              <Chip active={f.near === 'me'} onClick={() => (f.near === 'me' ? set({ near: '', radius: 0 }) : locate())}>
                Perto de mim
              </Chip>
              <Chip active={f.fav} onClick={() => set({ fav: !f.fav })}>
                Favoritos
              </Chip>
              <Chip active={f.status === 'quero'} onClick={() => set({ status: f.status === 'quero' ? '' : 'quero' })}>
                Queremos ir
              </Chip>
            </div>
            <div className="seg desktop-only" role="group" aria-label="Como ver">
              <button type="button" aria-pressed={view === 'lista'} onClick={() => setView('lista')}>Lista</button>
              <button type="button" aria-pressed={view === 'mapa'} onClick={() => setView('mapa')}>Mapa</button>
              <button type="button" aria-pressed={view === 'historico'} onClick={() => setView('historico')}>Histórico</button>
            </div>
            <div className="draw-group desktop-only">
              <button type="button" className="btn btn-small btn-primary draw" onClick={() => draw()} disabled={!list.length}>
                Sortear
              </button>
              <button
                type="button" className="btn btn-small btn-primary draw-more" aria-label="Opções do sorteio" title="Opções do sorteio"
                onClick={() => setDrawDlg(true)}
              >
                <Settings size={15} aria-hidden="true" />
                {drawTuned && <span className="dot" />}
              </button>
            </div>
          </div>

          {/* The history counts visits, not places, so this count would compete with its own totals there. */}
          {view !== 'historico' && (
            <div className="summary">
              <p className="count" role="status">
                {places && <><strong>{list.length}</strong> {list.length === 1 ? 'lugar' : 'lugares'}</>}
                {places && list.length !== places.length && <> de {places.length}</>}
              </p>
              {/* Only the list has an order; the map and the history would ignore it. */}
              {view === 'lista' && (
                <label className="sort">
                  <span className="sr-only">Ordenar por</span>
                  <select value={effectiveSort(f)} onChange={(e) => set({ sort: e.target.value })}>
                    {SORTS.filter((s) => s.id !== 'dist' || f.near).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                </label>
              )}
            </div>
          )}

          {f.near === 'me' && gps.msg && <p className="hint hint-warn" role="status">{gps.msg}</p>}
          {active.length > 0 && (
            <div className="actives">
              {active.map(([label, off, spoken]) => (
                <button key={label} type="button" className="active-chip" onClick={off} aria-label={`Remover filtro ${spoken || label}`}>
                  {label} <X size={13} aria-hidden="true" />
                </button>
              ))}
              {nActive > 1 && <button type="button" className="link" onClick={clear}>Limpar filtros</button>}
            </div>
          )}

          {loadError && (
            <div className="empty">
              <p>{loadError}</p>
              <button type="button" className="btn" onClick={load}>Tentar de novo</button>
            </div>
          )}
          {!places && !loadError && <p className="empty">Carregando…</p>}
          {places && !list.length && (
            <div className="empty">
              <p>Nenhum lugar combina com esses filtros.</p>
              <button type="button" className="btn" onClick={() => setF({ ...EMPTY, sort: f.sort })}>Limpar filtros e busca</button>
            </div>
          )}

          {view === 'mapa' && places && (list.length > 0 || f.open) && (
            <Suspense fallback={<p className="empty">Abrindo o mapa…</p>}>
              <MapView
                places={list} me={gps.pos} onLocate={locateForMap}
                openOnly={f.open} onOpenOnly={(open) => set({ open })} unknownHours={openStats.unknown}
                onOpen={openPlace}
              />
            </Suspense>
          )}
          {view === 'historico' && places && list.length > 0 && (
            <History places={list} filtered={list.length !== places.length} onOpen={openPlace} />
          )}
          {view === 'lista' && (
            <ul className="list">
              {list.map((p) => <Row key={p.id} p={p} onOpen={openPlace} />)}
            </ul>
          )}
        </main>
      </div>

      <nav className="tabbar" aria-label="Navegação">
        <button type="button" aria-pressed={view === 'lista'} onClick={() => setView('lista')}>
          <List size={20} aria-hidden="true" /> Lista
        </button>
        <button type="button" aria-pressed={view === 'mapa'} onClick={() => setView('mapa')}>
          <MapIcon size={20} aria-hidden="true" /> Mapa
        </button>
        <button type="button" aria-pressed={view === 'historico'} onClick={() => setView('historico')}>
          <HistoryIcon size={20} aria-hidden="true" /> Histórico
        </button>
      </nav>
      {/* The history looks back, not ahead: no Sortear button over it on the phone. */}
      {view !== 'historico' && (
        <button type="button" className="fab" onClick={() => draw()} disabled={!list.length}>
          Sortear
        </button>
      )}

      {open && (
        <PlaceDetail
          key={open.id} place={open} auth={auth} drawn={drawn} today={now.day}
          onDrawAgain={() => draw()} onVeto={veto} onDrawOptions={() => setDrawDlg(true)} onPatch={patch}
          onVisit={visitOp} onNotify={notify}
          onEdit={(p) => guard(() => setForm({ place: p }))} onClose={closeDetail}
        />
      )}
      {form && (
        <PlaceForm
          place={form.place} auth={auth} options={options} onSave={save} onDelete={remove}
          onVisitedLocked={() => notify(VISITED_LOCKED)} onClose={() => setForm(null)}
        />
      )}
      {account && (
        <Account
          auth={auth}
          preset={account.preset}
          onClose={() => { account.onCancel?.(); setAccount(null); }}
          onLogout={() => { const a = { token: '', who: '' }; saveAuth(a); setAuth(a); setAccount(null); }}
          onDone={(a) => {
            saveAuth(a);
            setAuth(a);
            const then = account.then;
            setAccount(null);
            then?.(a);
          }}
        />
      )}
      {drawDlg && (
        <DrawOptions
          opts={drawOpts} onChange={changeDrawOpts} pool={pool.length} total={list.length}
          vetoed={vetoes.map((id) => places?.find((p) => p.id === id)?.name).filter(Boolean)}
          onClearVetoes={() => { saveVetoes([]); setVetoes([]); }}
          onClose={() => setDrawDlg(false)}
        />
      )}
      {toast && <Toast msg={toast} />}
    </div>
  );
}
