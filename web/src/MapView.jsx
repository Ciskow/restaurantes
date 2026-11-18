import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import { LocateFixed } from 'lucide-react';
import 'leaflet/dist/leaflet.css';
import { avgRating, formatKm } from './filters.js';

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
  const avg = avgRating(p);
  const meta = [
    p.categories.join(' · '),
    p.bairro || p.city,
    p.price ? '$'.repeat(p.price) : '',
    avg != null ? `★ ${avg.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}` : '',
    p.dist != null ? formatKm(p.dist) : '',
    p.status ? p.status.text : '',
  ].filter(Boolean).join(' · ');
  if (meta) add('span', meta);
  if (p.geo_approx) add('span', 'Localização aproximada', 'map-pop-note');
  add('button', 'Ver detalhes', 'btn btn-small btn-primary').addEventListener('click', () => onOpen(p.id));
  return el;
}

export default function MapView({ places, me, onOpen, onLocate, openOnly, onOpenOnly, unknownHours }) {
  const box = useRef(null);
  const map = useRef(null);
  const layer = useRef(null);
  const meLayer = useRef(null);
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
    map.current = m;
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
    const key = shown.map((p) => p.id).join(',');
    if (key !== fitted.current && shown.length) {
      fitted.current = key;
      const bounds = L.latLngBounds(shown.map((p) => [p.lat, p.lng]));
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

  const goToMe = async () => {
    const pos = me || await onLocate();
    if (pos) map.current.setView([pos.lat, pos.lng], 15);
  };

  return (
    <div className="map-wrap">
      <div className="map-box">
        <div ref={box} className="map" role="application" aria-label="Mapa dos lugares filtrados" />
        <label className="map-open">
          <input type="checkbox" checked={openOnly} onChange={(e) => onOpenOnly(e.target.checked)} />
          Só abertos agora
        </label>
        <button type="button" className="btn btn-small map-me" onClick={goToMe}><LocateFixed size={15} aria-hidden="true" /> Onde estou</button>
      </div>
      {openOnly && unknownHours > 0 && (
        <p className="hint">
          {unknownHours} {unknownHours === 1 ? 'lugar ficou de fora por não ter' : 'lugares ficaram de fora por não terem'} horário cadastrado.
        </p>
      )}
      <ul className="map-legend" aria-label="Legenda">
        {LEGEND.map(([id, label]) => (
          <li key={id}><span className={`pin pin-${id}`} aria-hidden="true">{GLYPH[id]}</span> {label}</li>
        ))}
      </ul>
      {shown.length < places.length && (
        <p className="hint map-missing">
          {places.length - shown.length} {places.length - shown.length === 1 ? 'lugar sem coordenadas não aparece' : 'lugares sem coordenadas não aparecem'} no mapa.
        </p>
      )}
    </div>
  );
}
