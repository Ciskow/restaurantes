import React, { useEffect, useRef, useState } from 'react';
import { Camera, Clock, X } from 'lucide-react';
import { PEOPLE, api, shrinkPhoto } from './api.js';
import { DAYS, normalizeDay } from './hours.js';
import { Modal, Stars, TagInput } from './ui.jsx';

const BLANK = {
  name: '', city: 'São Paulo', region: '', bairro: '', address: '', lat: '', lng: '', geo_approx: false,
  price: null, dish: '', notes: '', instagram: '', maps_url: '', website: '', links: [], photos: [],
  categories: [], keywords: [], visited: false, want: false, favorite: false, rating_ciskow: null, rating_andkiwii: null, hours: [],
};

const toNumber = (v) => {
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

export default function PlaceForm({ place, auth, options, onSave, onDelete, onVisitedLocked, onClose }) {
  const [d, setD] = useState(() => ({
    ...BLANK,
    ...place,
    lat: place?.lat ?? '',
    lng: place?.lng ?? '',
    photos: place?.photos || [],
    hours: place?.hours?.length === 7 ? place.hours : null,
    links: place?.links?.length ? place.links : [],
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [geoMsg, setGeoMsg] = useState('');
  const [link, setLink] = useState('');
  const [linkMsg, setLinkMsg] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [photoMsg, setPhotoMsg] = useState('');
  const [working, setWorking] = useState(''); // 'link' | 'photos'
  const fileInput = useRef(null);
  const set = (patch) => setD((old) => ({ ...old, ...patch }));
  const text = (key) => ({ id: `f-${key}`, value: d[key], onChange: (e) => set({ [key]: e.target.value }) });

  async function findCoords() {
    const q = [d.address, d.address.includes(d.city) ? '' : d.city].filter(Boolean).join(', ');
    if (!d.address.trim()) return setGeoMsg('Preencha o endereço primeiro.');
    setGeoMsg('Buscando…');
    try {
      const hit = await api.geocode(q, auth.token);
      set({ lat: hit.lat.toFixed(6), lng: hit.lng.toFixed(6), geo_approx: false });
      setGeoMsg(`Encontrado: ${hit.label}`);
    } catch (e) {
      setGeoMsg(e.message);
    }
  }

  async function importLink() {
    if (!link.trim()) return setLinkMsg('Cole o link primeiro.');
    setWorking('link');
    setLinkMsg('Lendo o link…');
    try {
      const found = await api.importLink(link.trim(), auth.token);
      const patch = {};
      for (const key of ['name', 'address', 'bairro', 'city', 'instagram', 'maps_url', 'website']) {
        // Never overwrite what was already typed, except the default city of a new place.
        if (found[key] && (!d[key] || (key === 'city' && !place))) patch[key] = found[key];
      }
      if (found.lat != null) {
        Object.assign(patch, { lat: found.lat.toFixed(6), lng: found.lng.toFixed(6), geo_approx: !!found.geo_approx });
      }
      if (found.hours?.length === 7 && !d.hours) patch.hours = found.hours;
      if (found.categories?.length && !d.categories.length) patch.categories = found.categories;
      if (found.price && !d.price) patch.price = found.price;
      if (found.photo && d.photos.length < 12) patch.photos = [...d.photos, found.photo];
      const got = [
        patch.name && 'nome', patch.address && 'endereço', patch.bairro && 'bairro',
        patch.lat && 'coordenadas', patch.website && 'site', patch.hours && 'horário', patch.categories && 'tipo de comida', patch.price && 'preço', patch.photos && 'foto', patch.instagram && 'Instagram',
      ].filter(Boolean);
      const missing = [!patch.website && !d.website && 'site', !patch.hours && !d.hours && 'horário'].filter(Boolean);
      set(patch);
      const searchLink = found.kind === 'search' && !patch.lat;
      setLinkMsg(searchLink
        ? `Esse link é de uma busca do Google e só traz o nome${patch.name ? ` (${patch.name})` : ''}. Para vir endereço e localização, abra o lugar no app Google Maps e use Compartilhar de lá.`
        : got.length
        ? `Preenchi: ${got.join(', ')}${found.source ? ` (dados do ${found.source})` : ''}. Confira antes de salvar.`
          + (missing.length && found.maps_url ? ` Não achei ${missing.join(' nem ')} deste lugar.` : '')
        : 'O link abriu, mas não trouxe dados novos.');
      if (got.length) setLink('');
    } catch (e) {
      setLinkMsg(e.message);
    }
    setWorking('');
  }

  async function addFiles(files) {
    const room = 12 - d.photos.length;
    if (room <= 0) return setPhotoMsg('O limite é de 12 fotos por lugar.');
    const batch = [...files].slice(0, room);
    setWorking('photos');
    const added = [];
    let failed = 0;
    for (const [i, file] of batch.entries()) {
      setPhotoMsg(`Enviando foto ${i + 1} de ${batch.length}…`);
      try {
        added.push(await api.upload(await shrinkPhoto(file), auth.token));
      } catch { failed++; }
    }
    setD((old) => ({ ...old, photos: [...old.photos, ...added] }));
    setPhotoMsg(failed ? `${failed} ${failed === 1 ? 'foto não pôde ser enviada' : 'fotos não puderam ser enviadas'}.` : '');
    setWorking('');
  }

  // Paste (Ctrl+V or the phone's "colar") and drag-and-drop anywhere in the form add photos.
  const paste = useRef(null);
  paste.current = (e) => {
    const data = e.clipboardData || e.dataTransfer;
    if (!data) return;
    const images = [...data.files].filter((f) => f.type.startsWith('image/'));
    const typing = e.type === 'paste' && /^(INPUT|TEXTAREA)$/.test(e.target?.tagName || '');
    if (images.length) {
      e.preventDefault();
      addFiles(images);
      return;
    }
    if (e.type === 'drop') e.preventDefault();
    // A copied image address counts too, unless the cursor is in a text field (then it is just text).
    const url = (data.getData('text/uri-list') || data.getData('text/plain') || '').trim().split(/\s/)[0];
    if (!typing && /^https?:\/\/\S+$/i.test(url)) {
      e.preventDefault();
      setD((old) => (old.photos.includes(url) || old.photos.length >= 12 ? old : { ...old, photos: [...old.photos, url] }));
      setPhotoMsg('Foto adicionada pelo link colado.');
    }
  };
  useEffect(() => {
    const onPaste = (e) => paste.current(e);
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, []);

  function addPhotoUrl() {
    const u = photoUrl.trim();
    if (!/^https?:\/\//i.test(u)) return setPhotoMsg('O link da foto precisa começar com https://');
    if (!d.photos.includes(u)) set({ photos: [...d.photos, u] });
    setPhotoUrl('');
    setPhotoMsg('');
  }

  function useHere() {
    if (!window.isSecureContext || !navigator.geolocation) return setGeoMsg('O GPS só funciona em HTTPS.');
    setGeoMsg('Pegando sua localização…');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        set({ lat: pos.coords.latitude.toFixed(6), lng: pos.coords.longitude.toFixed(6), geo_approx: false });
        setGeoMsg('Coordenadas do lugar onde você está agora.');
      },
      () => setGeoMsg('Não consegui pegar sua localização.'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  async function submit(e) {
    e.preventDefault();
    if (!d.name.trim()) return setError('Dê um nome ao lugar.');
    let hours = [];
    if (d.hours) {
      hours = d.hours.map(normalizeDay);
      const bad = DAYS.find((day) => hours[day.i] === null);
      if (bad) return setError(`Não entendi o horário de ${bad.long.toLowerCase()}. Use o formato 12:00-15:00.`);
    }
    // Visits have their own section on the place's page; the server keeps last_visit from them.
    const { visits, last_visit: lastVisit, ...rest } = d;
    setBusy(true);
    setError('');
    try {
      await onSave({
        ...rest,
        hours,
        lat: toNumber(d.lat),
        lng: toNumber(d.lng),
        links: d.links.filter((l) => l.url.trim()),
      });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} className="form-modal" label={place ? `Editar ${place.name}` : 'Novo lugar'}>
      <form onSubmit={submit} noValidate onDragOver={(e) => e.preventDefault()} onDrop={(e) => paste.current(e)}>
        <header className="form-head">
          <h2>{place ? 'Editar lugar' : 'Novo lugar'}</h2>
          <button type="button" className="icon-btn" aria-label="Fechar" onClick={onClose}><X size={18} /></button>
        </header>

        <div className="form-body">
          <div className="field">
            <label htmlFor="f-import">Preencher a partir de um link</label>
            <div className="input-row">
              <input
                id="f-import" value={link} placeholder="Link do Maps ou do Instagram"
                data-autofocus={place ? undefined : ''}
                onChange={(e) => setLink(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); importLink(); } }}
              />
              <button type="button" className="btn btn-small" disabled={working === 'link'} onClick={importLink}>
                {working === 'link' ? 'Lendo…' : 'Preencher'}
              </button>
            </div>
            {linkMsg && <small role="status">{linkMsg}</small>}
          </div>

          <label className="field">
            <span>Nome</span>
            <input {...text('name')} required />
          </label>

          <div className="field">
            <label htmlFor="f-cats">Tipos de comida</label>
            <TagInput
              id="f-cats" value={d.categories} suggestions={options.cats}
              onChange={(categories) => set({ categories })} placeholder="Italiano, Pizzaria…"
            />
            <small>Um lugar pode ter vários. Enter ou vírgula para adicionar.</small>
          </div>

          <div className="field">
            <span id="f-price">Preço</span>
            <div className="chips" role="group" aria-labelledby="f-price">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n} type="button" className="chip" aria-pressed={d.price === n}
                  onClick={() => set({ price: d.price === n ? null : n })}
                >
                  {'$'.repeat(n)}
                </button>
              ))}
            </div>
          </div>

          <div className="grid-3">
            <label className="field">
              <span>Cidade</span>
              <input {...text('city')} list="opt-cities" />
            </label>
            <label className="field">
              <span>Região</span>
              <input {...text('region')} list="opt-regions" />
            </label>
            <label className="field">
              <span>Bairro</span>
              <input {...text('bairro')} list="opt-bairros" />
            </label>
            <datalist id="opt-cities">{options.cities.map((v) => <option key={v} value={v} />)}</datalist>
            <datalist id="opt-regions">{options.regions.map((v) => <option key={v} value={v} />)}</datalist>
            <datalist id="opt-bairros">{options.bairros.map((v) => <option key={v} value={v} />)}</datalist>
          </div>

          <label className="field">
            <span>Endereço</span>
            <input {...text('address')} placeholder="Rua, número" />
          </label>

          <div className="field">
            <span>Coordenadas (para o filtro de distância)</span>
            <div className="coords">
              <input aria-label="Latitude" inputMode="decimal" placeholder="Latitude" value={d.lat} onChange={(e) => set({ lat: e.target.value })} />
              <input aria-label="Longitude" inputMode="decimal" placeholder="Longitude" value={d.lng} onChange={(e) => set({ lng: e.target.value })} />
            </div>
            <div className="chips">
              <button type="button" className="btn btn-small" onClick={findCoords}>Buscar pelo endereço</button>
              <button type="button" className="btn btn-small" onClick={useHere}>Estou aqui agora</button>
            </div>
            {geoMsg && <small role="status">{geoMsg}</small>}
          </div>

          <fieldset className="field">
            <legend>Horário de funcionamento</legend>
            <div className="chips">
              <button
                type="button" className="chip" aria-pressed={!!d.hours}
                onClick={() => set({ hours: d.hours ? null : Array(7).fill('') })}
              >
                <Clock size={15} aria-hidden="true" /> {d.hours ? 'Horário informado' : 'Informar horário'}
              </button>
              {d.hours && (
                <button type="button" className="btn btn-small" onClick={() => set({ hours: Array(7).fill(d.hours[1]) })}>
                  Repetir segunda em todos os dias
                </button>
              )}
            </div>
            {d.hours && (
              <>
                {DAYS.map((day) => (
                  <label key={day.i} className="hours-row">
                    <span>{day.short}</span>
                    <input
                      aria-label={`Horário de ${day.long.toLowerCase()}`} placeholder="fechado" value={d.hours[day.i]}
                      onChange={(e) => set({ hours: d.hours.map((h, i) => (i === day.i ? e.target.value : h)) })}
                    />
                  </label>
                ))}
                <small>Ex.: 12:00-15:00, 19:00-23:00. Deixe vazio nos dias fechados. Passando da meia-noite: 18:00-02:00.</small>
              </>
            )}
          </fieldset>

          <label className="field">
            <span>Prato pra pedir</span>
            <input {...text('dish')} />
          </label>

          <label className="field">
            <span>Observações</span>
            <textarea {...text('notes')} rows={3} />
          </label>

          <div className="field">
            <label htmlFor="f-kws">Palavras-chave</label>
            <TagInput
              id="f-kws" value={d.keywords} suggestions={options.kws}
              onChange={(keywords) => set({ keywords })} placeholder="date, fila, pet friendly…"
            />
          </div>

          <div className="grid-2">
            <label className="field">
              <span>Instagram</span>
              <input {...text('instagram')} placeholder="@perfil ou link" />
            </label>
            <label className="field">
              <span>Site</span>
              <input {...text('website')} type="url" placeholder="https://" />
            </label>
          </div>

          <label className="field">
            <span>Link do Google Maps</span>
            <input {...text('maps_url')} type="url" placeholder="https://" />
          </label>

          <div className="field">
            <span>Outros links (TikTok, iFood, reservas…)</span>
            {d.links.map((l, i) => (
              <div key={i} className="link-row">
                <input
                  aria-label="Nome do link" placeholder="Nome" value={l.label}
                  onChange={(e) => set({ links: d.links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })}
                />
                <input
                  aria-label="Endereço do link" placeholder="https://" value={l.url}
                  onChange={(e) => set({ links: d.links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })}
                />
                <button type="button" className="icon-btn" aria-label="Remover link" onClick={() => set({ links: d.links.filter((_, j) => j !== i) })}>×</button>
              </div>
            ))}
            <div>
              <button type="button" className="btn btn-small" onClick={() => set({ links: [...d.links, { label: '', url: '' }] })}>
                + Adicionar link
              </button>
            </div>
          </div>

          <div className="field">
            <span>Fotos</span>
            {d.photos.length > 0 && (
              <ul className="thumbs">
                {d.photos.map((src, i) => (
                  <li key={src}>
                    <img src={src} alt={`Foto ${i + 1}`} referrerPolicy="no-referrer" loading="lazy" />
                    {i === 0
                      ? <span className="thumb-cover">Capa</span>
                      : (
                        <button
                          type="button" className="thumb-btn thumb-first" title="Usar como capa"
                          aria-label={`Usar a foto ${i + 1} como capa`}
                          onClick={() => set({ photos: [src, ...d.photos.filter((x) => x !== src)] })}
                        >
                          ★
                        </button>
                      )}
                    <button
                      type="button" className="thumb-btn thumb-x" aria-label={`Remover a foto ${i + 1}`}
                      onClick={() => set({ photos: d.photos.filter((x) => x !== src) })}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <input
              ref={fileInput} type="file" accept="image/*" multiple hidden
              onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
            />
            <div className="input-row">
              <button type="button" className="btn btn-small" disabled={working === 'photos'} onClick={() => fileInput.current.click()}>
                <Camera size={16} aria-hidden="true" /> {working === 'photos' ? 'Enviando…' : 'Enviar fotos'}
              </button>
              <input
                aria-label="Link de uma foto" placeholder="ou cole o link de uma foto" value={photoUrl}
                onChange={(e) => setPhotoUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPhotoUrl(); } }}
              />
              {photoUrl && <button type="button" className="btn btn-small" onClick={addPhotoUrl}>Adicionar</button>}
            </div>
            <small role="status">{photoMsg || 'Também dá para colar (Ctrl+V) ou arrastar uma imagem em qualquer lugar deste formulário.'}</small>
          </div>

          <fieldset className="field form-ratings">
            <legend>Nossa experiência</legend>
            {PEOPLE.map((person) => (
              <div key={person.id} className="rating-row">
                <span className={`who who-${person.id}`}>{person.label}</span>
                <Stars
                  who={person.id} value={d[person.field]} label={`Nota de ${person.label}`}
                  onChange={(n) => set({ [person.field]: n, ...(n ? { visited: true } : {}) })}
                />
              </div>
            ))}
            <div className="toggles">
              <button
                type="button" className="chip" aria-pressed={d.visited}
                onClick={() => (d.visited && place?.visits?.length ? onVisitedLocked() : set({ visited: !d.visited }))}
              >
                Já fomos
              </button>
              <button type="button" className="chip" aria-pressed={d.want} onClick={() => set({ want: !d.want })}>Queremos ir</button>
              <button type="button" className="chip" aria-pressed={d.favorite} onClick={() => set({ favorite: !d.favorite })}>Favorito</button>
            </div>
          </fieldset>
        </div>

        <footer className="form-foot">
          {error && <p className="error" role="alert">{error}</p>}
          {place && (
            <button
              type="button" className="btn btn-danger" disabled={busy}
              onClick={() => window.confirm(`Apagar "${place.name}" de vez? Não dá para desfazer.`) && onDelete(place.id)}
            >
              Apagar
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !!working}>{busy ? 'Salvando…' : 'Salvar'}</button>
        </footer>
      </form>
    </Modal>
  );
}
