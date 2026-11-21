import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPinned, X } from 'lucide-react';
import { POI_ICONS, poiIcon } from './Pois.jsx';

export const statusOf = (p) => (p.visited ? 'fomos' : p.want ? 'quero' : 'novo');
const GLYPH = { fomos: '✓', quero: '♡', novo: '' };
const LEGEND = [['fomos', 'Já fomos'], ['quero', 'Queremos ir'], ['novo', 'Ainda não fomos']];

const FIT = { padding: [36, 36], maxZoom: 16 };

const pin = (status) => L.divIcon({
  className: '',
  html: `<span class="pin pin-${status}">${GLYPH[status]}</span>`,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
  popupAnchor: [0, -14],
});

function popup(p, onOpen) {
  const el = document.createElement('div');
  el.className = 'map-pop';
  const add = (tag, text, cls) => {
    const node = document.createElement(tag);
    node.textContent = text;
    if (cls) node.className = cls;
    el.append(node);
    return node;
  };
  add('strong', p.name);
  const meta = [p.categories.slice(0, 2).join(', '), p.bairro || p.city].filter(Boolean).join(' · ');
  if (meta) add('span', meta);
  if (p.status) add('span', p.status.text);
  if (p.geo_approx) add('span', 'Localização aproximada', 'map-pop-note');
  add('button', 'Ver detalhes', 'btn btn-small btn-primary').addEventListener('click', () => onOpen(p.id));
  return el;
}

// Our own points: square markers with an icon, so they never read as a restaurant pin.
const poiMarker = (glyph) => L.divIcon({
  className: '',
  html: `<span class="poi-mark poi-pin">${glyph}</span>`,
  iconSize: [30, 30],
  iconAnchor: [15, 15],
  popupAnchor: [0, -15],
});

function poiPopup(p, near, edit) {
  const el = document.createElement('div');
  el.className = 'map-pop';
  const add = (tag, text, cls, parent = el) => {
    const node = document.createElement(tag);
    node.textContent = text;
    if (cls) node.className = cls;
    parent.append(node);
    return node;
  };
  add('strong', p.name);
  add('span', `Ponto salvo · ${poiIcon(p.icon).label}`);
  const row = add('div', '', 'map-pop-actions');
  add('button', 'Lugares perto daqui', 'btn btn-small btn-primary', row).addEventListener('click', () => near(p.id));
  add('button', 'Editar', 'btn btn-small', row).addEventListener('click', () => edit(p));
  return el;
}

export default function MapView({
  places, me, onOpen, onLocate, openOnly, onOpenOnly, unknownHours,
  pois = [], onPois, onPoiNear, onPoiEdit, picking, onPicked, onPickCancel, focus,
}) {
  const box = useRef(null);
  const map = useRef(null);
  const layer = useRef(null);
  const meLayer = useRef(null);
  const poiLayer = useRef(null);
  const glyphs = useRef(null); // the icons drawn once by React below, copied into the markers
  const pickRef = useRef(null);
  pickRef.current = picking ? onPicked : null;
  const poiFns = useRef({});
  poiFns.current = { near: onPoiNear, edit: onPoiEdit };
  const fitted = useRef('');
  const frame = useRef(null); // bounds waiting for the box to have a size
  const open = useRef(onOpen);
  open.current = onOpen;

  useEffect(() => {
    const m = L.map(box.current, { zoomControl: true }).setView([-23.56, -46.65], 12);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    meLayer.current = L.layerGroup().addTo(m);
    poiLayer.current = L.layerGroup().addTo(m);
    map.current = m;
    m.on('click', (e) => pickRef.current?.({ lat: e.latlng.lat, lng: e.latlng.lng }));
    // The box often gets its real size only after the first paint; re-measure and re-frame then.
    const watch = new ResizeObserver(() => {
      m.invalidateSize({ animate: false });
      if (frame.current) {
        m.fitBounds(frame.current, FIT);
        frame.current = null;
      }
    });
    watch.observe(box.current);
    return () => { watch.disconnect(); m.remove(); };
  }, []);

  const shown = places.filter((p) => p.lat != null);

  useEffect(() => {
    layer.current.clearLayers();
    for (const p of shown) {
      L.marker([p.lat, p.lng], { icon: pin(statusOf(p)), title: p.name, alt: p.name })
        .bindPopup(() => popup(p, (id) => open.current(id)), { minWidth: 200 })
        .addTo(layer.current);
    }
    // Re-frame only when the set of places changed, not when one of them was merely edited.
    // With no place left to show, our saved points frame the map instead.
    const key = shown.length ? shown.map((p) => p.id).join(',') : 'pontos';
    const framed = shown.length ? shown : pois;
    if (key !== fitted.current && framed.length) {
      fitted.current = key;
      const bounds = L.latLngBounds(framed.map((p) => [p.lat, p.lng]));
      if (box.current.clientWidth > 0) map.current.fitBounds(bounds, FIT);
      else frame.current = bounds;
    }
  }, [places]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    meLayer.current.clearLayers();
    if (!me) return;
    L.circleMarker([me.lat, me.lng], { radius: 8, color: '#fff', weight: 3, fillColor: '#1a73e8', fillOpacity: 1 })
      .bindTooltip('Você está aqui')
      .addTo(meLayer.current);
  }, [me]);

  useEffect(() => {
    poiLayer.current.clearLayers();
    for (const p of pois) {
      const glyph = glyphs.current?.querySelector(`[data-icon="${poiIcon(p.icon).id}"]`)?.innerHTML || '';
      L.marker([p.lat, p.lng], { icon: poiMarker(glyph), title: p.name, alt: p.name, zIndexOffset: 1000 })
        .bindPopup(() => poiPopup(p, (id) => poiFns.current.near(id), (x) => poiFns.current.edit(x)), { minWidth: 200 })
        .addTo(poiLayer.current);
    }
  }, [pois]);

  useEffect(() => {
    if (focus) map.current.setView([focus.lat, focus.lng], Math.max(map.current.getZoom(), 15));
  }, [focus]);

  // While choosing a spot: a crosshair cursor, and a point that already has a spot is brought into view.
  useEffect(() => {
    const m = map.current;
    m.getContainer().classList.toggle('map-picking', !!picking);
    if (picking) {
      m.closePopup();
      if (picking.lat != null) m.setView([picking.lat, picking.lng], Math.max(m.getZoom(), 15));
    }
  }, [picking]);

  const goToMe = async () => {
    const pos = me || await onLocate();
    if (pos) map.current.setView([pos.lat, pos.lng], 15);
  };

  return (
    <div className="map-wrap">
      {/* Above the map, so the phone's Sortear button never sits on top of it. */}
      <ul className="map-legend" aria-label="Legenda">
        {LEGEND.map(([id, label]) => (
          <li key={id}><span className={`pin pin-${id}`} aria-hidden="true">{GLYPH[id]}</span> {label}</li>
        ))}
        {pois.length > 0 && <li><span className="poi-mark poi-legend" aria-hidden="true" /> Meus pontos</li>}
      </ul>
      <div ref={glyphs} hidden>
        {POI_ICONS.map(({ id, Icon }) => <span key={id} data-icon={id}><Icon size={16} aria-hidden="true" /></span>)}
      </div>
      <div className="map-box">
        <div ref={box} className="map" role="application" aria-label="Mapa dos lugares filtrados" />
        <label className="map-open">
          <input type="checkbox" checked={openOnly} onChange={(e) => onOpenOnly(e.target.checked)} />
          Aberto agora
        </label>
        <button type="button" className="btn btn-small map-me" onClick={goToMe}>Onde estou</button>
        {!picking && (
          <button type="button" className="btn btn-small map-pois" onClick={onPois}>
            <MapPinned size={15} aria-hidden="true" /> Pontos
          </button>
        )}
        {picking && (
          <div className="map-pick" role="status">
            <span>Toque no mapa onde fica {picking.name.trim() || 'o ponto'}.</span>
            <button type="button" className="btn btn-small" onClick={onPickCancel}>
              <X size={14} aria-hidden="true" /> Cancelar
            </button>
          </div>
        )}
      </div>
      {openOnly && unknownHours > 0 && (
        <p className="hint">
          {unknownHours} {unknownHours === 1 ? 'lugar ficou de fora por não ter' : 'lugares ficaram de fora por não terem'} horário cadastrado.
        </p>
      )}
      {shown.length < places.length && (
        <p className="hint map-missing">
          {places.length - shown.length} {places.length - shown.length === 1 ? 'lugar sem coordenadas não aparece' : 'lugares sem coordenadas não aparecem'} no mapa.
        </p>
      )}
    </div>
  );
}
