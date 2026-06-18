const ST = ['Nyomtatva','Feldolgozás alatt','Elpakolható','Elpakolva','Kiadva'];
const SC = ['s0','s1','s2','s3','s4'];
let invoices = [], activeFilter = 'Összes';

document.getElementById('lPass').addEventListener('keydown', e => { if(e.key==='Enter') doLogin(); });
document.getElementById('btnLogin').addEventListener('click', doLogin);
document.getElementById('btnLogout').addEventListener('click', doLogout);
document.getElementById('btnOpenPw').addEventListener('click', openPw);
document.getElementById('btnClosePw').addEventListener('click', closePw);
document.getElementById('btnChangePw').addEventListener('click', changePw);
document.getElementById('search').addEventListener('input', render);
document.getElementById('pwModal').addEventListener('click', e => { if(e.target===e.currentTarget) closePw(); });

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

async function doLogin() {
  const u = document.getElementById('lUser').value;
  const p = document.getElementById('lPass').value;
  const errEl = document.getElementById('lErr');
  errEl.style.display = 'none';
  const r = await fetch('/api/login', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})});
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
  loadInvoices();
  connectSSE();
}

async function checkAuth() {
  const r = await fetch('/api/me');
  const d = await r.json();
  if (d.loggedIn) { document.getElementById('hUser').textContent = d.username; showDash(); }
}

async function loadInvoices() {
  const r = await fetch('/api/invoices');
  if (!r.ok) return;
  invoices = await r.json();
  renderStats();
  render();
}

function renderStats() {
  const counts = {'Összes': invoices.length};
  ST.forEach(s => counts[s] = 0);
  invoices.forEach(i => { if(counts[i.status]!==undefined) counts[i.status]++; });
  const all = ['Összes', ...ST];
  document.getElementById('statsRow').innerHTML = all.map(s =>
    `<div class="stat ${s===activeFilter?'active':''}" data-filter="${esc(s)}" title="${s}">
       <div class="lbl">${s}</div>
       <div class="val">${counts[s]}</div>
     </div>`).join('');
}

function setFilter(s) { activeFilter = s; renderStats(); render(); }

function render() {
  const q = document.getElementById('search').value.toLowerCase().trim();
  const tbody = document.getElementById('tBody');
  const list = invoices.filter(i => {
    const mf = activeFilter==='Összes' || i.status===activeFilter;
    const ms = !q || i.invoice_number.toLowerCase().includes(q);
    return mf && ms;
  });
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty"><p>Nincs találat</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML = list.map(i => {
    const si = ST.indexOf(i.status);
    const cls = si>=0 ? SC[si] : 's0';
    const opts = ST.map(s=>`<option value="${esc(s)}"${s===i.status?' selected':''}>${s}</option>`).join('');
    return `<tr>
      <td data-label="Számlaszám"><span class="inum">${esc(i.invoice_number)}</span></td>
      <td data-label="Státusz"><span class="badge ${cls}">${esc(i.status)}</span></td>
      <td data-label="Rögzítve" class="dcell">${fmtDate(i.created_at)}</td>
      <td data-label="Módosítva" class="dcell">${fmtDate(i.updated_at)}</td>
      <td data-label="Műveletek"><div class="acts">
        <select class="sel" data-id="${i.id}">${opts}</select>
        <button class="btn btn-danger btn-sm" data-id="${i.id}" data-num="${esc(i.invoice_number)}">Töröl</button>
      </div></td>
    </tr>`;
  }).join('');
}

async function changeStatus(id, status) {
  const r = await fetch(`/api/invoices/${id}/status`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({status})});
  if (r.ok) { const i=invoices.find(x=>x.id===id); if(i){i.status=status; i.updated_at=new Date().toISOString();} renderStats(); render(); }
}

async function delInv(id, num) {
  if (!confirm(`Biztosan törli?\n${num}`)) return;
  const r = await fetch(`/api/invoices/${id}`,{method:'DELETE'});
  if (r.ok) { invoices=invoices.filter(i=>i.id!==id); renderStats(); render(); }
}

function openPw() {
  ['pwCur','pwNew','pwNew2'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('pwErr').style.display='none';
  document.getElementById('pwModal').classList.add('open');
}
function closePw() { document.getElementById('pwModal').classList.remove('open'); }

async function changePw() {
  const cur = document.getElementById('pwCur').value;
  const n1 = document.getElementById('pwNew').value;
  const n2 = document.getElementById('pwNew2').value;
  const errEl = document.getElementById('pwErr');
  errEl.style.display='none';
  if (!cur||!n1) { errEl.textContent='Töltsd ki az összes mezőt!'; errEl.style.display='block'; return; }
  if (n1!==n2) { errEl.textContent='A két új jelszó nem egyezik!'; errEl.style.display='block'; return; }
  if (n1.length<4) { errEl.textContent='A jelszó legalább 4 karakter legyen!'; errEl.style.display='block'; return; }
  const r = await fetch('/api/change-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({current:cur,newPass:n1})});
  const d = await r.json();
  if (r.ok) { closePw(); alert('Jelszó sikeresen megváltoztatva!'); }
  else { errEl.textContent=d.error||'Hiba'; errEl.style.display='block'; }
}

function fmtDate(s) {
  if(!s) return '-';
  try {
    const d = new Date(s.replace(' ','T'));
    return d.toLocaleDateString('hu-HU')+' '+d.toLocaleTimeString('hu-HU',{hour:'2-digit',minute:'2-digit'});
  } catch { return s; }
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

let sseConn = null;
function connectSSE() {
  if (sseConn) sseConn.close();
  sseConn = new EventSource('/api/events');
  sseConn.onmessage = e => { if (e.data !== 'connected') loadInvoices(); };
}
function disconnectSSE() {
  if (sseConn) { sseConn.close(); sseConn = null; }
}

setInterval(() => { if(document.getElementById('dashboard').style.display!=='none') loadInvoices(); }, 120000);

checkAuth();
