export const EMPTY = {
  q: '', cats: [], cities: [], regions: [], bairros: [], prices: [], kws: [],
  status: '', min: 0, who: 'avg', near: '', radius: 0, sort: '', open: false, fav: false,
};

export const STATUS = [
  { id: '', label: 'Todos' },
  { id: 'fomos', label: 'Já fomos' },
  { id: 'novo', label: 'Ainda não fomos' },
  { id: 'quero', label: 'Queremos ir' },
];

export const WHO = [
  { id: 'avg', label: 'Média dos dois' },
  { id: 'ciskow', label: 'Ciskow' },
  { id: 'andkiwii', label: 'Andkiwii' },
  { id: 'both', label: 'Os dois' },
  { id: 'any', label: 'Qualquer um' },
];

export const SORTS = [
  { id: 'name', label: 'Nome (A–Z)' },
  { id: 'dist', label: 'Mais perto' },
  { id: 'rating', label: 'Melhor nota' },
  { id: 'price', label: 'Mais barato' },
  { id: 'price-desc', label: 'Mais caro' },
  { id: 'recent', label: 'Adicionados por último' },
];

export const RADII = [1, 2, 3, 5, 10, 20];

export const norm = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export function km(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

export function formatKm(d) {
  if (d == null) return '';
  if (d < 1) return `${Math.max(50, Math.round(d * 20) * 50)} m`;
  return `${d.toLocaleString('pt-BR', { maximumFractionDigits: d < 10 ? 1 : 0 })} km`;
}

export function avgRating(p) {
  const r = [p.rating_ciskow, p.rating_andkiwii].filter((x) => x != null);
  return r.length ? r.reduce((a, b) => a + b, 0) / r.length : null;
}

const anyOf = (selected, values) => !selected.length || values.some((v) => selected.includes(v));

// One test per facet. Inside a facet the choices are alternatives (Italiano OU Japonês);
// across facets they all have to hold.
const TESTS = {
  q(p, f) {
    if (!f.q.trim()) return true;
    const hay = norm([p.name, p.dish, p.notes, p.bairro, p.city, p.address, ...p.categories, ...p.keywords].join(' '));
    return norm(f.q).split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
  },
  cats: (p, f) => anyOf(f.cats, p.categories),
  cities: (p, f) => anyOf(f.cities, [p.city]),
  regions: (p, f) => anyOf(f.regions, [p.region]),
  bairros: (p, f) => anyOf(f.bairros, [p.bairro]),
  prices: (p, f) => anyOf(f.prices, [p.price]),
  kws: (p, f) => anyOf(f.kws, p.keywords),
  status(p, f) {
    if (f.status === 'fomos') return p.visited;
    if (f.status === 'novo') return !p.visited;
    if (f.status === 'quero') return p.want;
    return true;
  },
  min(p, f) {
    if (!f.min) return true;
    const c = p.rating_ciskow ?? 0;
    const a = p.rating_andkiwii ?? 0;
    if (f.who === 'ciskow') return c >= f.min;
    if (f.who === 'andkiwii') return a >= f.min;
    if (f.who === 'both') return c >= f.min && a >= f.min;
    if (f.who === 'any') return c >= f.min || a >= f.min;
    return (avgRating(p) ?? 0) >= f.min;
  },
  // Places without known hours are left out: "open now" should only show what is certain.
  open: (p, f) => !f.open || p.openNow === true,
  fav: (p, f) => !f.fav || p.favorite,
  radius: (p, f) => !f.radius || !f.near || (p.dist != null && p.dist <= f.radius),
};

export function matches(p, f, skip) {
  for (const key in TESTS) {
    if (key !== skip && !TESTS[key](p, f)) return false;
  }
  return true;
}

/** How many places each choice of a facet would give, keeping every other filter. */
export function facetCounts(places, f, key, valuesOf) {
  const counts = new Map();
  for (const p of places) {
    if (!matches(p, f, key)) continue;
    for (const v of valuesOf(p)) {
      if (v !== '' && v != null) counts.set(v, (counts.get(v) || 0) + 1);
    }
  }
  return counts;
}

export function effectiveSort(f) {
  if (f.sort === 'dist' && !f.near) return 'name';
  return f.sort || (f.near ? 'dist' : 'name');
}

export function sortPlaces(list, f) {
  const byName = (a, b) => a.name.localeCompare(b.name, 'pt-BR');
  const nullsLast = (get, dir = 1) => (a, b) => {
    const x = get(a), y = get(b);
    if (x == null && y == null) return byName(a, b);
    if (x == null) return 1;
    if (y == null) return -1;
    return (x - y) * dir || byName(a, b);
  };
  const sorters = {
    name: byName,
    dist: nullsLast((p) => p.dist),
    rating: nullsLast(avgRating, -1),
    price: nullsLast((p) => p.price),
    'price-desc': nullsLast((p) => p.price, -1),
    recent: (a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id,
  };
  return [...list].sort(sorters[effectiveSort(f)] || byName);
}

export function activeCount(f) {
  return f.cats.length + f.cities.length + f.regions.length + f.bairros.length + f.prices.length + f.kws.length +
    (f.status ? 1 : 0) + (f.min ? 1 : 0) + (f.near ? 1 : 0) + (f.open ? 1 : 0) + (f.fav ? 1 : 0);
}

// ---- filters <-> address bar, so any combination can be bookmarked or shared ----
export const VIEWS = ['lista', 'mapa', 'historico'];
export const viewFromQuery = (search) => {
  const v = new URLSearchParams(search).get('ver');
  return VIEWS.includes(v) ? v : 'lista';
};
const LISTS = { cats: 'tipo', cities: 'cidade', regions: 'regiao', bairros: 'bairro', kws: 'tag' };
const SEP = '|';

export function toQuery(f, placeId, view) {
  const q = new URLSearchParams();
  if (f.q.trim()) q.set('q', f.q.trim());
  for (const [key, name] of Object.entries(LISTS)) {
    if (f[key].length) q.set(name, f[key].join(SEP));
  }
  if (f.prices.length) q.set('preco', [...f.prices].sort().join(SEP));
  if (f.status) q.set('status', f.status);
  if (f.min) {
    q.set('nota', String(f.min));
    if (f.who !== 'avg') q.set('quem', f.who);
  }
  if (f.near) {
    q.set('perto', f.near);
    if (f.radius) q.set('raio', String(f.radius));
  }
  if (f.open) q.set('aberto', '1');
  if (f.fav) q.set('fav', '1');
  if (f.sort) q.set('ordem', f.sort);
  if (VIEWS.includes(view) && view !== 'lista') q.set('ver', view);
  if (placeId) q.set('p', String(placeId));
  const s = q.toString();
  return s ? `?${s}` : '';
}

export function fromQuery(search) {
  const q = new URLSearchParams(search);
  const f = { ...EMPTY, q: q.get('q') || '' };
  for (const [key, name] of Object.entries(LISTS)) {
    f[key] = (q.get(name) || '').split(SEP).filter(Boolean);
  }
  f.prices = (q.get('preco') || '').split(SEP).map(Number).filter((n) => n >= 1 && n <= 5);
  f.status = STATUS.some((s) => s.id === q.get('status')) ? q.get('status') : '';
  f.min = Math.min(5, Math.max(0, Number(q.get('nota')) || 0));
  f.who = WHO.some((w) => w.id === q.get('quem')) ? q.get('quem') : 'avg';
  f.near = q.get('perto') || '';
  f.radius = f.near ? Number(q.get('raio')) || 0 : 0;
  f.open = q.get('aberto') === '1';
  f.fav = q.get('fav') === '1';
  f.sort = SORTS.some((s) => s.id === q.get('ordem')) ? q.get('ordem') : '';
  return f;
}
