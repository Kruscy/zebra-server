let period = 'day';
let refDate = today();
let view = 'day';

function today() {
  const d = new Date();
  return fmt(d);
}
function fmt(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function fmtSec(s) {
  if (!s) return '–';
  const m = Math.floor(s/60), sec = s%60;
  if (m >= 60) { const h=Math.floor(m/60); return `${h}ó ${m%60}p`; }
  return `${m}p ${sec}s`;
}
function fmtHu(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  const days = ['vas','hét','kedd','szer','csüt','pén','szo'];
  const months = ['jan','feb','már','ápr','máj','jún','júl','aug','szep','okt','nov','dec'];
  return `${d.getFullYear()}. ${months[d.getMonth()]}. ${String(d.getDate()).padStart(2,'0')}. (${days[d.getDay()]})`;
}

document.querySelectorAll('.period-btn').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.period-btn').forEach(x=>x.classList.remove('active'));
  b.classList.add('active');
  period = b.dataset.p;
  updateRefInput();
  load();
}));

document.querySelectorAll('.view-tab').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.view-tab').forEach(x=>x.classList.remove('active'));
  b.classList.add('active');
  view = b.dataset.v;
  renderCurrentData();
}));

const refInput = document.getElementById('refInput');
refInput.value = refDate;
refInput.addEventListener('change', () => { refDate = refInput.value || today(); load(); });

document.getElementById('btnPrev').addEventListener('click', () => navigate(-1));
document.getElementById('btnNext').addEventListener('click', () => navigate(1));
document.getElementById('btnToday').addEventListener('click', () => { refDate = today(); updateRefInput(); load(); });

function navigate(dir) {
  const d = new Date(refDate + 'T00:00:00');
  if (period === 'day') d.setDate(d.getDate() + dir);
  else if (period === 'week') d.setDate(d.getDate() + dir*7);
  else d.setMonth(d.getMonth() + dir);
  refDate = fmt(d);
  updateRefInput();
  load();
}
function updateRefInput() {
  if (period === 'week') {
    const d = new Date(refDate + 'T00:00:00');
    const dow = d.getDay();
    d.setDate(d.getDate() + (dow===0?-6:1-dow));
    refInput.value = fmt(d);
  } else if (period === 'month') {
    refInput.value = refDate.substring(0,7) + '-01';
  } else {
    refInput.value = refDate;
  }
}

document.getElementById('selWorker').addEventListener('change', load);
document.getElementById('selSupplier').addEventListener('change', load);
document.getElementById('chkSat').addEventListener('change', load);
document.getElementById('chkSun').addEventListener('change', load);

let currentData = null;

async function load() {
  const worker = document.getElementById('selWorker').value;
  const supplier = document.getElementById('selSupplier').value;
  const showSat = document.getElementById('chkSat').checked ? '1' : '0';
  const showSun = document.getElementById('chkSun').checked ? '1' : '0';
  const weekends = (showSat==='1'||showSun==='1') ? '1' : '0';

  document.getElementById('tableArea').innerHTML = '<div class="loading">Betöltés…</div>';

  try {
    const r = await fetch(`/api/stats?period=${period}&ref=${refDate}&worker=${encodeURIComponent(worker)}&supplier=${encodeURIComponent(supplier)}&weekends=${weekends}&sat=${showSat}&sun=${showSun}`);
    if (r.status === 401) { location.href = '/'; return; }
    currentData = await r.json();
    renderData(currentData, showSat==='1', showSun==='1');
  } catch(e) {
    document.getElementById('tableArea').innerHTML = `<div class="loading">Hiba: ${e.message}</div>`;
  }
}

function renderData(data, showSat, showSun) {
  if (data.startDate === data.endDate) {
    document.getElementById('rangeLabel').textContent = fmtHu(data.startDate);
  } else {
    document.getElementById('rangeLabel').textContent = `${fmtHu(data.startDate)} – ${fmtHu(data.endDate)}`;
  }

  document.getElementById('cInvoices').textContent = data.summary.invoices || '0';
  document.getElementById('cItems').textContent = data.summary.items || '0';
  document.getElementById('cAvg').textContent = fmtSec(data.summary.avg_per_item);
  document.getElementById('cTotal').textContent = fmtSec(data.summary.active_seconds);

  const wSel = document.getElementById('selWorker');
  const curW = wSel.value;
  wSel.innerHTML = '<option value="">Minden dolgozó</option>';
  (data.workers||[]).forEach(w => {
    const o = document.createElement('option');
    o.value = w; o.textContent = w;
    if (w === curW) o.selected = true;
    wSel.appendChild(o);
  });

  const sSel = document.getElementById('selSupplier');
  const curS = sSel.value;
  sSel.innerHTML = '<option value="">Minden szállító</option>';
  (data.suppliers||[]).forEach(s => {
    const o = document.createElement('option');
    o.value = s; o.textContent = s;
    if (s === curS) o.selected = true;
    sSel.appendChild(o);
  });

  currentData = data;
  currentData._showSat = showSat;
  currentData._showSun = showSun;
  renderCurrentData();
}

function renderCurrentData() {
  if (!currentData) return;
  const data = currentData;
  const showSat = data._showSat !== false;
  const showSun = data._showSun !== false;

  if (view === 'day') {
    const rows = (data.by_day||[]).filter(r => {
      const dow = new Date(r.date+'T00:00:00').getDay();
      if (dow===6 && !showSat) return false;
      if (dow===0 && !showSun) return false;
      return true;
    });
    const html = `<table>
      <tr><th>Dátum</th><th>Számlák</th><th>Tételek</th><th>Aktív idő</th><th>Átlag/tétel</th></tr>
      ${rows.length ? rows.map(r => {
        const dow = new Date(r.date+'T00:00:00').getDay();
        const cls = r.invoices===0 ? 'empty' : (dow===6?'saturday':dow===0?'sunday':'');
        return `<tr class="${cls}">
          <td>${fmtHu(r.date)}</td>
          <td>${r.invoices||'–'}</td>
          <td>${r.items||'–'}</td>
          <td>${fmtSec(r.active_seconds)}</td>
          <td>${fmtSec(r.avg_per_item)}</td>
        </tr>`;
      }).join('') : '<tr><td colspan="5" style="text-align:center;color:#CCC;padding:30px">Nincs adat</td></tr>'}
    </table>`;
    document.getElementById('tableArea').innerHTML = html;

  } else if (view === 'worker') {
    const rows = data.by_worker||[];
    const html = `<table>
      <tr><th>Dolgozó</th><th>Számlák</th><th>Tételek</th><th>Aktív idő</th><th>Átlag/tétel</th></tr>
      ${rows.length ? rows.map(r => `<tr>
        <td>${r.worker||r.worker_name||'–'}</td>
        <td>${r.invoices}</td><td>${r.items}</td>
        <td>${fmtSec(r.active_seconds)}</td><td>${fmtSec(r.avg_per_item)}</td>
      </tr>`).join('') : '<tr><td colspan="5" style="text-align:center;color:#CCC;padding:30px">Nincs adat</td></tr>'}
    </table>`;
    document.getElementById('tableArea').innerHTML = html;

  } else if (view === 'supplier') {
    const rows = data.by_supplier||[];
    const html = `<table>
      <tr><th>Szállító</th><th>Számlák</th><th>Tételek</th><th>Aktív idő</th><th>Átlag/tétel</th></tr>
      ${rows.length ? rows.map(r => `<tr>
        <td>${r.supplier||'(nincs szállító)'}</td>
        <td>${r.invoices}</td><td>${r.items}</td>
        <td>${fmtSec(r.active_seconds)}</td><td>${fmtSec(r.avg_per_item)}</td>
      </tr>`).join('') : '<tr><td colspan="5" style="text-align:center;color:#CCC;padding:30px">Nincs adat</td></tr>'}
    </table>`;
    document.getElementById('tableArea').innerHTML = html;
  }
}

(async () => {
  const me = await fetch('/api/me').then(r=>r.json()).catch(()=>({loggedIn:false}));
  if (!me.loggedIn) { location.href = '/'; return; }
  updateRefInput();
  await load();
})();
