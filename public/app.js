const ST = ['Nyomtatva','Feldolgozás alatt','Elpakolható','Elpakolva','Kiadva'];
const SC = ['s0','s1','s2','s3','s4'];
let invoices = [], suppliers = [], activeFilter = 'Összes', activeSupplier = '';

// --- Eseménykezelők ---
document.getElementById('lPass').addEventListener('keydown', e => { if(e.key==='Enter') doLogin(); });
document.getElementById('btnLogin').addEventListener('click', doLogin);
document.getElementById('btnLogout').addEventListener('click', doLogout);
document.getElementById('btnOpenPw').addEventListener('click', openPw);
document.getElementById('btnClosePw').addEventListener('click', closePw);
document.getElementById('btnChangePw').addEventListener('click', changePw);
document.getElementById('search').addEventListener('input', render);
document.getElementById('pwModal').addEventListener('click', e => { if(e.target===e.currentTarget) closePw(); });
document.getElementById('supplierModal').addEventListener('click', e => { if(e.target===e.currentTarget) closeSupplierMgr(); });
document.getElementById('btnCloseSupplierMgr').addEventListener('click', closeSupplierMgr);
document.getElementById('btnAddSupplier').addEventListener('click', () => openSupplierEdit(null));
document.getElementById('btnSaveSupplier').addEventListener('click', saveSupplier);
document.getElementById('btnCancelSupplierEdit').addEventListener('click', closeSupplierEdit);
document.getElementById('supplierImgFile').addEventListener('change', onImgFileChange);
document.getElementById('btnOpenSupplierMgr').addEventListener('click', openSupplierMgr);

document.getElementById('statsRow').addEventListener('click', e => {
  const el = e.target.closest('.stat');
  if (el) setFilter(el.dataset.filter);
});

document.getElementById('tBody').addEventListener('change', e => {
  if (e.target.classList.contains('sel'))
    changeStatus(parseInt(e.target.dataset.id), e.target.value);
});

document.getElementById('tBody').addEventListener('click', e => {
  const btn = e.target.closest('.btn-danger');
  if (btn && btn.dataset.id) delInv(parseInt(btn.dataset.id), btn.dataset.num);
});

// --- Szállító chip drag-scroll ---
const chipsEl = document.getElementById('supplierChips');
let _chipDragging = false, _chipStartX = 0, _chipScrollLeft = 0;

chipsEl.addEventListener('mousedown', e => {
  _chipDragging = false;
  _chipStartX = e.clientX;
  _chipScrollLeft = chipsEl.scrollLeft;
});
window.addEventListener('mousemove', e => {
  if (!e.buttons || !chipsEl.matches(':hover') && !_chipDragging) return;
  if (e.buttons && _chipStartX) {
    const dx = e.clientX - _chipStartX;
    if (Math.abs(dx) > 5) {
      _chipDragging = true;
      chipsEl.scrollLeft = _chipScrollLeft - dx;
    }
  }
});
window.addEventListener('mouseup', () => { setTimeout(() => { _chipStartX = 0; }, 50); });

let _touchMoved = false, _touchStartX = 0;
chipsEl.addEventListener('touchstart', e => { _touchMoved=false; _touchStartX=e.touches[0].clientX; }, {passive:true});
chipsEl.addEventListener('touchmove', e => { if(Math.abs(e.touches[0].clientX-_touchStartX)>8) _touchMoved=true; }, {passive:true});

chipsEl.addEventListener('click', e => {
  if (_chipDragging || _touchMoved) return;
  const chip = e.target.closest('.chip[data-sup]');
  if (chip) setSupplierFilter(chip.dataset.sup);
});

// --- Auth ---
async function doLogin() {
  const u = document.getElementById('lUser').value;
  const p = document.getElementById('lPass').value;
  const errEl = document.getElementById('lErr');
  errEl.style.display = 'none';
  const r = await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})});
  const d = await r.json();
  if (r.ok) { document.getElementById('hUser').textContent = d.username; showDash(); }
  else errEl.style.display = 'block';
}

async function doLogout() {
  disconnectSSE();
  await fetch('/api/logout',{method:'POST'});
  document.getElementById('dashboard').style.display = 'none';
  document.getElementById('loginPage').style.display = 'flex';
}

function showDash() {
  document.getElementById('loginPage').style.display = 'none';
  document.getElementById('dashboard').style.display = 'block';
  loadData();
  connectSSE();
}

async function checkAuth() {
  const r = await fetch('/api/me');
  const d = await r.json();
  if (d.loggedIn) { document.getElementById('hUser').textContent = d.username; showDash(); }
}

// --- Adatok betöltése ---
async function loadData() {
  const [rInv, rSup] = await Promise.all([fetch('/api/invoices'), fetch('/api/suppliers')]);
  if (rInv.ok) invoices = await rInv.json();
  if (rSup.ok) suppliers = await rSup.json();
  renderChips();
  renderStats();
  render();
}

// --- Szállító chipek ---
function renderChips() {
  const el = chipsEl;
  const allChip = `<button class="chip${activeSupplier===''?' chip-active':''}" data-sup="">Összes</button>`;
  const supChips = suppliers.map(s => {
    const active = activeSupplier === s.name ? ' chip-active' : '';
    let inner = '';
    if (s.display_mode === 'image' && s.image) {
      inner = `<img src="${s.image}" alt="${esc(s.name)}" class="chip-img">`;
    } else if (s.display_mode === 'both' && s.image) {
      inner = `<img src="${s.image}" alt="" class="chip-img">${esc(s.name)}`;
    } else {
      inner = esc(s.name);
    }
    return `<button class="chip${active}" data-sup="${esc(s.name)}">${inner}</button>`;
  }).join('');
  el.innerHTML = allChip + supChips;
}

function setSupplierFilter(name) {
  activeSupplier = name;
  renderChips();
  render();
}

// --- Stats ---
function renderStats() {
  const counts = {'Összes': invoices.length};
  ST.forEach(s => counts[s] = 0);
  invoices.forEach(i => { if(counts[i.status]!==undefined) counts[i.status]++; });
  const all = ['Összes', ...ST];
  document.getElementById('statsRow').innerHTML = all.map(s =>
    `<div class="stat ${s===activeFilter?'active':''}" data-filter="${esc(s)}" title="${s}">
       <div class="lbl">${s}</div><div class="val">${counts[s]}</div>
     </div>`).join('');
}

function setFilter(s) { activeFilter = s; renderStats(); render(); }

// --- Táblázat ---
function render() {
  const q = document.getElementById('search').value.toLowerCase().trim();
  const tbody = document.getElementById('tBody');
  const list = invoices.filter(i => {
    if (activeFilter !== 'Összes' && i.status !== activeFilter) return false;
    if (activeSupplier && i.supplier !== activeSupplier) return false;
    if (q && !i.invoice_number.toLowerCase().includes(q)) return false;
    return true;
  });
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty"><p>Nincs találat</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML = list.map(i => {
    const si = ST.indexOf(i.status);
    const cls = si>=0 ? SC[si] : 's0';
    const opts = ST.map(s=>`<option value="${esc(s)}"${s===i.status?' selected':''}>${s}</option>`).join('');
    return `<tr>
      <td data-label="Számlaszám"><span class="inum">${esc(i.invoice_number)}</span></td>
      <td data-label="Státusz"><span class="badge ${cls}">${esc(i.status)}</span></td>
      <td data-label="Szállító">${renderSupplierCell(i.supplier)}</td>
      <td data-label="Rögzítve" class="dcell">${fmtDate(i.created_at)}</td>
      <td data-label="Módosítva" class="dcell">${fmtDate(i.updated_at)}</td>
      <td data-label="Műveletek"><div class="acts">
        <select class="sel" data-id="${i.id}">${opts}</select>
        <button class="btn btn-danger btn-sm" data-id="${i.id}" data-num="${esc(i.invoice_number)}">Töröl</button>
      </div></td>
    </tr>`;
  }).join('');
}

function renderSupplierCell(name) {
  if (!name) return '<span class="sup-empty">—</span>';
  const s = suppliers.find(x => x.name === name);
  if (!s) return `<span class="sup-name">${esc(name)}</span>`;
  if (s.display_mode === 'image' && s.image)
    return `<img src="${s.image}" alt="${esc(name)}" class="sup-img" title="${esc(name)}">`;
  if (s.display_mode === 'both' && s.image)
    return `<span class="sup-both"><img src="${s.image}" alt="" class="sup-img">${esc(name)}</span>`;
  return `<span class="sup-name">${esc(name)}</span>`;
}

async function changeStatus(id, status) {
  const r = await fetch(`/api/invoices/${id}/status`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({status})});
  if (r.ok) { const i=invoices.find(x=>x.id===id); if(i){i.status=status;} renderStats(); render(); }
}

async function delInv(id, num) {
  if (!confirm(`Biztosan törli?\n${num}`)) return;
  const r = await fetch(`/api/invoices/${id}`,{method:'DELETE'});
  if (r.ok) { invoices=invoices.filter(i=>i.id!==id); renderStats(); render(); }
}

// --- Szállító kezelő modal ---
function openSupplierMgr() {
  renderSupplierList();
  closeSupplierEdit();
  document.getElementById('supplierModal').classList.add('open');
}
function closeSupplierMgr() {
  document.getElementById('supplierModal').classList.remove('open');
}

function renderSupplierList() {
  const el = document.getElementById('supplierList');
  if (!suppliers.length) { el.innerHTML = '<p style="color:#aaa;padding:8px 0">Még nincs szállító.</p>'; return; }
  el.innerHTML = suppliers.map(s => {
    let preview = '';
    if (s.image) preview = `<img src="${s.image}" alt="" style="height:28px;width:28px;object-fit:contain;border-radius:4px;margin-right:8px;vertical-align:middle">`;
    const dm = {text:'Szöveg',both:'Szöveg+kép',image:'Csak kép'}[s.display_mode]||'Szöveg';
    return `<div class="sup-row">
      <span class="sup-row-info">${preview}<span>${esc(s.name)}</span><small>${dm}</small></span>
      <div class="sup-row-btns">
        <button class="btn btn-secondary btn-sm" onclick="openSupplierEdit(${s.id})">Szerkeszt</button>
        <button class="btn btn-danger btn-sm" onclick="deleteSupplier(${s.id},'${esc(s.name)}')">Töröl</button>
      </div>
    </div>`;
  }).join('');
}

let _editingSupId = null;
function openSupplierEdit(id) {
  _editingSupId = id;
  const s = id ? suppliers.find(x=>x.id===id) : null;
  document.getElementById('supEditTitle').textContent = id ? 'Szállító szerkesztése' : 'Új szállító';
  document.getElementById('supName').value = s ? s.name : '';
  document.getElementById('supImgPreview').src = s?.image || '';
  document.getElementById('supImgPreview').style.display = s?.image ? 'block' : 'none';
  document.getElementById('supplierImgFile').value = '';
  const dm = s?.display_mode || 'text';
  document.querySelectorAll('input[name="supDm"]').forEach(r => { r.checked = r.value===dm; });
  document.getElementById('supImgRemove').style.display = s?.image ? 'inline-block' : 'none';
  document.getElementById('supplierEditForm').style.display = 'block';
  document.getElementById('supplierList').style.display = 'none';
  document.getElementById('btnAddSupplier').style.display = 'none';
}

function closeSupplierEdit() {
  document.getElementById('supplierEditForm').style.display = 'none';
  document.getElementById('supplierList').style.display = 'block';
  document.getElementById('btnAddSupplier').style.display = 'inline-flex';
  _editingSupId = null;
}

function onImgFileChange(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 300*1024) { alert('A kép mérete maximum 300 KB lehet!'); e.target.value=''; return; }
  const reader = new FileReader();
  reader.onload = ev => {
    document.getElementById('supImgPreview').src = ev.target.result;
    document.getElementById('supImgPreview').style.display = 'block';
    document.getElementById('supImgRemove').style.display = 'inline-block';
  };
  reader.readAsDataURL(file);
}

document.getElementById('supImgRemove').addEventListener('click', () => {
  document.getElementById('supImgPreview').src = '';
  document.getElementById('supImgPreview').style.display = 'none';
  document.getElementById('supplierImgFile').value = '';
  document.getElementById('supImgRemove').style.display = 'none';
});

async function saveSupplier() {
  const name = document.getElementById('supName').value.trim();
  if (!name) { alert('Add meg a szállító nevét!'); return; }
  const image = document.getElementById('supImgPreview').src.startsWith('data:') ? document.getElementById('supImgPreview').src : '';
  const display_mode = document.querySelector('input[name="supDm"]:checked')?.value || 'text';
  const body = { name, image, display_mode };
  const url = _editingSupId ? `/api/suppliers/${_editingSupId}` : '/api/suppliers';
  const method = _editingSupId ? 'PUT' : 'POST';
  const r = await fetch(url, {method, headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
  if (r.ok) {
    await loadData();
    closeSupplierEdit();
    renderSupplierList();
  } else {
    const d = await r.json();
    alert(d.error || 'Hiba történt');
  }
}

async function deleteSupplier(id, name) {
  if (!confirm(`Törlöd a szállítót?\n${name}`)) return;
  const r = await fetch(`/api/suppliers/${id}`,{method:'DELETE'});
  if (r.ok) { await loadData(); renderSupplierList(); }
}

// --- Jelszóváltás ---
function openPw() {
  ['pwCur','pwNew','pwNew2'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('pwErr').style.display='none';
  document.getElementById('pwModal').classList.add('open');
}
function closePw() { document.getElementById('pwModal').classList.remove('open'); }

async function changePw() {
  const cur=document.getElementById('pwCur').value, n1=document.getElementById('pwNew').value, n2=document.getElementById('pwNew2').value;
  const errEl=document.getElementById('pwErr');
  errEl.style.display='none';
  if(!cur||!n1){errEl.textContent='Töltsd ki az összes mezőt!';errEl.style.display='block';return;}
  if(n1!==n2){errEl.textContent='A két új jelszó nem egyezik!';errEl.style.display='block';return;}
  if(n1.length<4){errEl.textContent='A jelszó legalább 4 karakter legyen!';errEl.style.display='block';return;}
  const r=await fetch('/api/change-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({current:cur,newPass:n1})});
  const d=await r.json();
  if(r.ok){closePw();alert('Jelszó sikeresen megváltoztatva!');}
  else{errEl.textContent=d.error||'Hiba';errEl.style.display='block';}
}

// --- Segédfüggvények ---
function fmtDate(s) {
  if(!s) return '-';
  try {
    const d=new Date(s.replace(' ','T'));
    return d.toLocaleDateString('hu-HU')+' '+d.toLocaleTimeString('hu-HU',{hour:'2-digit',minute:'2-digit'});
  } catch { return s; }
}
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// --- SSE ---
let sseConn = null;
function connectSSE() {
  if(sseConn) sseConn.close();
  sseConn = new EventSource('/api/events');
  sseConn.onmessage = e => { if(e.data!=='connected') loadData(); };
}
function disconnectSSE() { if(sseConn){sseConn.close();sseConn=null;} }

setInterval(() => { if(document.getElementById('dashboard').style.display!=='none') loadData(); }, 120000);

checkAuth();
