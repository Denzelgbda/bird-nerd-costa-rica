// Bird Nerd · Costa Rica
// - 2-column grid
// - Sticky search
// - Infinite scroll + lazy images
// - iNaturalist -> Wikipedia image fallback
// - Local photo uploads + 'seen' with date
const DATA_URL = './data/birds.json';

const $ = (sel, el=document) => el.querySelector(sel);
const $$ = (sel, el=document) => Array.from(el.querySelectorAll(sel));

const toast = (msg) => {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'), 1800);
};

// Local storage helpers
const seenKey = (id) => `seen:${id}`;
const photoKey = (id) => `photo:${id}`;
const imgKey   = (id) => `img:${id}`;

const getSeen = (id) => {
  const raw = localStorage.getItem(seenKey(id));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
};
const setSeen = (id, when = new Date()) => {
  localStorage.setItem(seenKey(id), JSON.stringify({ date: when.toISOString().slice(0,10) }));
};
const clearSeen = (id) => localStorage.removeItem(seenKey(id));

const getUserPhoto = (id) => localStorage.getItem(photoKey(id));
const setUserPhoto = (id, dataUrl) => localStorage.setItem(photoKey(id), dataUrl);

const getCachedImg = (id) => localStorage.getItem(imgKey(id));
const setCachedImg = (id, url) => localStorage.setItem(imgKey(id), url || 'none');

// Resize image before storing to save space
const resizeImage = (file, maxSize=1024) => new Promise((resolve, reject) => {
  const img = new Image();
  const reader = new FileReader();
  reader.onload = () => { img.src = reader.result; };
  reader.onerror = reject;
  img.onload = () => {
    const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    resolve(canvas.toDataURL('image/jpeg', 0.8));
  };
  reader.readAsDataURL(file);
});

// Image resolution from APIs
async function resolveImageFor(bird){
  const id = bird.id;
  // 1) User photo
  const userPhoto = getUserPhoto(id);
  if (userPhoto) return userPhoto;

  // 2) Cached result
  const cached = getCachedImg(id);
  if (cached && cached !== 'none') return cached;
  if (cached === 'none') return null;

  // 3) Try iNaturalist (latin -> english -> dutch -> spanish)
  const qnames = [bird.latin_name, bird.english_name, bird.dutch_name, bird.spanish_name]
    .filter(Boolean);
  for (const q of qnames){
    try {
      const url = `https://api.inaturalist.org/v1/taxa?q=${encodeURIComponent(q)}&rank=species&per_page=1`;
      const r = await fetch(url);
      if (r.ok){
        const j = await r.json();
        const t = j.results && j.results[0];
        const img = t && t.default_photo && (t.default_photo.medium_url || t.default_photo.url);
        if (img){
          setCachedImg(id, img);
          return img;
        }
      }
    } catch(e){ /* ignore */ }
  }

  // 4) Wikipedia (english, then latin)
  const wikiTries = [bird.english_name, bird.latin_name].filter(Boolean);
  for (const title of wikiTries){
    try{
      const api = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
      const r = await fetch(api);
      if (r.ok){
        const j = await r.json();
        const img = j.thumbnail && j.thumbnail.source;
        if (img){ setCachedImg(id, img); return img; }
      }
    }catch(e){}
  }

  setCachedImg(id, 'none');
  return null;
}

// Placeholder SVG data URL (no network)
const placeholder = (name) => {
  const initials = (name||'??').split(/\s+/).map(s=>s[0]).slice(0,2).join('').toUpperCase();
  const bg = '#0f1b16';
  const fg = '#35c48d';
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='800' height='800'>
    <rect width='100%' height='100%' fill='${bg}'/>
    <text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' 
      font-family='Arial' font-size='120' fill='${fg}'>${initials}</text>
  </svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
};

// Lazy image loader with IntersectionObserver
const io = new IntersectionObserver(entries => {
  entries.forEach(async entry => {
    const el = entry.target;
    if (entry.isIntersecting){
      io.unobserve(el);
      const id = el.dataset.id;
      const name = el.dataset.name;
      const url = await resolveImageFor(window.BIRDS_BY_ID[id]);
      el.src = url || placeholder(name);
      el.previousElementSibling?.remove(); // remove skeleton
    }
  });
}, { rootMargin: '400px 0px' });

// Infinite scroll
let LIMIT = 40;
const STEP = 40;
let filtered = [];
let birds = [];

function applyFilters(){
  const query = $('#q').value.trim().toLowerCase();
  const fam = $('#family').value;
  const spottedOnly = $('#filter-spotted').getAttribute('aria-pressed') === 'true';

  filtered = birds.filter(b => {
    if (fam && b.family !== fam) return false;
    if (spottedOnly && !getSeen(b.id)) return false;
    if (!query) return true;
    const hay = `${b.dutch_name} ${b.english_name} ${b.spanish_name} ${b.latin_name} ${b.family} ${b.order}`.toLowerCase();
    return hay.includes(query);
  });

  LIMIT = Math.max(STEP, Math.min(LIMIT, filtered.length));
  renderGrid(true);
  $('#counts').textContent = `${filtered.length} soorten gevonden — ${birds.length} totaal`;
}

function renderGrid(reset=false){
  const grid = $('#grid');
  if (reset) grid.innerHTML = '';

  const nowCount = Math.min(LIMIT, filtered.length);
  const existing = grid.children.length;
  for (let i = existing; i < nowCount; i++){
    const b = filtered[i];
    const card = document.createElement('article');
    card.className = 'card';
    card.innerHTML = `
      <div class="thumb-wrap">
        <div class="skeleton"></div>
        <img class="thumb" data-id="${b.id}" data-name="${b.english_name || b.dutch_name || b.spanish_name || b.latin_name}" alt="Foto van ${b.english_name || b.dutch_name || b.spanish_name || b.latin_name}" />
        <span class="badge">${b.family || b.order || '—'}</span>
        ${getSeen(b.id) ? `<span class="checkmark">✓ ${getSeen(b.id).date}</span>` : ''}
      </div>
      <div class="meta">
        <div class="name">${b.dutch_name || b.english_name || b.spanish_name || b.latin_name}</div>
        <div class="latin">${b.latin_name}</div>
        <div class="row">
          <button class="btn" data-action="details" data-id="${b.id}">Details</button>
          <button class="btn primary" data-action="toggle" data-id="${b.id}">${getSeen(b.id)?'Gezien':'Markeer gezien'}</button>
        </div>
      </div>
    `;
    const img = card.querySelector('img.thumb');
    io.observe(img);
    grid.appendChild(card);
  }
}

// Sentinel for infinite scroll
const sentinel = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (e.isIntersecting){
      const before = LIMIT;
      LIMIT = Math.min(filtered.length, LIMIT + STEP);
      if (LIMIT > before) renderGrid(false);
    }
  });
});


function populateFamilies(){
  const set = new Set(birds.map(b => b.family).filter(Boolean));
  const list = Array.from(set).sort();
  const sel = $('#family');
  for (const f of list){
    const opt = document.createElement('option');
    opt.value = f; opt.textContent = f;
    sel.appendChild(opt);
  }
}

// Detail sheet logic
let currentId = null;
function openSheet(id){
  const b = window.BIRDS_BY_ID[id];
  currentId = id;
  $('#detail-name').textContent = b.dutch_name || b.english_name || b.spanish_name || b.latin_name;
  $('#detail-latin').textContent = b.latin_name || '—';
  $('#detail-es').textContent = b.spanish_name || '—';
  $('#detail-family').textContent = b.family || b.order || '—';
  $('#detail-status').textContent = b.conservation_status || '—';
  const seen = getSeen(id);
  $('#detail-seen').textContent = seen ? seen.date : '—';
  $('#btn-toggle').textContent = seen ? 'Markeer on-gezien' : 'Markeer gezien';

  const hero = $('#detail-img');
  hero.src = placeholder(b.english_name || b.dutch_name || b.spanish_name || b.latin_name);
  // Prefer user photo if present
  const up = getUserPhoto(id);
  if (up) hero.src = up; else resolveImageFor(b).then(u => hero.src = u || placeholder(b.english_name));

  $('#sheet').classList.add('open');
  $('#sheet').setAttribute('aria-hidden', 'false');
}
function closeSheet(){
  $('#sheet').classList.remove('open');
  $('#sheet').setAttribute('aria-hidden', 'true');
  currentId = null;
}

// Event delegation
document.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (btn && btn.dataset.action){
    const id = btn.dataset.id;
    if (btn.dataset.action === 'details'){
      openSheet(id);
    } else if (btn.dataset.action === 'toggle'){
      const seen = getSeen(id);
      if (seen){ clearSeen(id); toast('Gemarkeerd als niet gezien'); }
      else { setSeen(id); toast('Gemarkeerd als gezien'); }
      // Rerender affected card minimalistically
      $('#grid').innerHTML = '';
      renderGrid(true);
      if (currentId === id){
        $('#detail-seen').textContent = getSeen(id)?.date || '—';
        $('#btn-toggle').textContent = getSeen(id) ? 'Markeer on-gezien' : 'Markeer gezien';
      }
    }
  }
  if (e.target.matches('[data-close]')){
    closeSheet();
  }
  if (btn && btn.id === 'btn-upload'){
    $('#upload').click();
  }
  if (btn && btn.id === 'filter-spotted'){
    const pressed = btn.getAttribute('aria-pressed') === 'true';
    btn.setAttribute('aria-pressed', String(!pressed));
    btn.textContent = pressed ? 'Alle soorten' : 'Alleen gezien';
    applyFilters();
  }
});

// Photo upload
$('#upload').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file || !currentId) return;
  const dataUrl = await resizeImage(file, 1200);
  setUserPhoto(currentId, dataUrl);
  $('#detail-img').src = dataUrl;
  // update card
  $('#grid').innerHTML = '';
  renderGrid(true);
  toast('Foto opgeslagen op dit toestel');
  e.target.value = '';
});

// Search / filters
$('#q').addEventListener('input', () => { applyFilters(); });
$('#family').addEventListener('change', () => { applyFilters(); });

async function main(){
  const r = await fetch(DATA_URL);
  birds = await r.json();

  window.BIRDS_BY_ID = Object.fromEntries(birds.map(b => [b.id, b]));

  populateFamilies();
  filtered = birds.slice();
  renderGrid(true);
  $('#counts').textContent = `${filtered.length} soorten gevonden — ${birds.length} totaal`;

  const sent = $('#sentinel');
  sentinel.observe(sent);
}
main();
