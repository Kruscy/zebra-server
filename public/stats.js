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

function invoiceSubTable(recs, showDate) {
  if (!recs.length) return '<tr><td colspan="7" style="text-align:center;color:#CCC;padding:12px;font-size:13px">Nincs rekord</td></tr>';
  return recs.map(r => `<tr class="detail-row">
    <td></td>
    ${showDate ? `<td style="font-size:12px;color:#888;white-space:nowrap">${r.date}<br><span style="color:#BBB">${r.started_at.substring(0,5)}</span></td>` : `<td style="font-size:12px;color:#888">${r.started_at.substring(0,5)}</td>`}
    <td><strong style="font-size:13px">${r.invoice_number}</strong></td>
    <td style="font-size:13px">${r.supplier||'–'}</td>
    <td style="font-size:13px">${r.worker_name||'–'}</td>
    <td style="text-align:right;font-size:13px">${r.item_count}</td>
    <td style="text-align:right;font-weight:700;color:#4361EE;font-size:13px">${fmtSec(r.active_seconds)}</td>
    <td style="text-align:right;color:#888;font-size:13px">${fmtSec(r.avg_per_item)}</td>
  </tr>`).join('');
}

function attachExpand() {
  document.querySelectorAll('#tableArea tr.main-row').forEach(tr => {
    tr.addEventListener('click', () => {
      const idx = tr.dataset.idx;
      const detail = document.getElementById('detail-' + idx);
      if (!detail) return;
      const icon = tr.querySelector('.tog');
      const open = detail.style.display !== 'none';
      detail.style.display = open ? 'none' : '';
      icon.textContent = open ? '▶' : '▼';
      tr.classList.toggle('row-open', !open);
    });
  });
}

document.querySelectorAll('.period-btn').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.period-btn').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  period = b.dataset.p;
  const isCustom = period === 'custom';
  document.getElementById('navStandard').style.display = isCustom ? 'none' : '';
  document.getElementById('navCustom').style.display = isCustom ? '' : 'none';
  if (!isCustom) { updateRefInput(); load(); }
}));

document.getElementById('btnCustomLoad').addEventListener('click', () => {
  const from = document.getElementById('fromInput').value;
  const to = document.getElementById('toInput').value;
  if (from && to && from <= to) load();
});

document.querySelectorAll('.view-tab').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.view-tab').forEach(x => x.classList.remove('active'));
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
  else if (period === 'week') d.setDate(d.getDate() + dir * 7);
  else if (period === 'year') d.setFullYear(d.getFullYear() + dir);
  else d.setMonth(d.getMonth() + dir);
  refDate = fmt(d);
  updateRefInput();
  load();
}

function updateRefInput() {
  if (period === 'week') {
    const d = new Date(refDate + 'T00:00:00');
    const dow = d.getDay();
    d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
    refInput.value = fmt(d);
  } else if (period === 'month') {
    refInput.value = refDate.substring(0, 7) + '-01';
  } else if (period === 'year') {
    refInput.value = refDate.substring(0, 4) + '-01-01';
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
  const weekends = (showSat === '1' || showSun === '1') ? '1' : '0';
  document.getElementById('tableArea').innerHTML = '<div class="loading">Betöltés…</div>';
  try {
    let url;
    if (period === 'custom') {
      const from = document.getElementById('fromInput').value;
      const to = document.getElementById('toInput').value;
      if (!from || !to) { document.getElementById('tableArea').innerHTML = '<div class="loading">Add meg a dátumokat!</div>'; return; }
      url = `/api/stats?period=custom&from=${from}&to=${to}&worker=${encodeURIComponent(worker)}&supplier=${encodeURIComponent(supplier)}&weekends=${weekends}`;
    } else {
      url = `/api/stats?period=${period}&ref=${refDate}&worker=${encodeURIComponent(worker)}&supplier=${encodeURIComponent(supplier)}&weekends=${weekends}&sat=${showSat}&sun=${showSun}`;
    }
    const r = await fetch(url);
    if (r.status === 401) { location.href = '/'; return; }
    currentData = await r.json();
    renderData(currentData, showSat === '1', showSun === '1');
  } catch (e) {
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
  document.getElementById('cPacking').textContent = fmtSec(data.summary.packing_seconds);
  document.getElementById('cProblems').textContent = fmtSec(data.summary.problems_seconds);

  const wSel = document.getElementById('selWorker');
  const curW = wSel.value;
  wSel.innerHTML = '<option value="">Minden dolgozó</option>';
  (data.workers || []).forEach(w => {
    const o = document.createElement('option');
    o.value = w; o.textContent = w;
    if (w === curW) o.selected = true;
    wSel.appendChild(o);
  });

  const sSel = document.getElementById('selSupplier');
  const curS = sSel.value;
  sSel.innerHTML = '<option value="">Minden szállító</option>';
  (data.suppliers || []).forEach(s => {
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
  const allRecs = data.records || [];

  // Sub-table header (no date col for day view, with date for worker/supplier)
  function subHeader(showDate) {
    return `<tr class="detail-header">
      <th></th>
      <th>${showDate ? 'Dátum' : 'Időpont'}</th>
      <th>Számlaszám</th><th>Szállító</th><th>Dolgozó</th>
      <th style="text-align:right">Tételek</th>
      <th style="text-align:right">Aktív idő</th>
      <th style="text-align:right">Átlag/tétel</th>
    </tr>`;
  }

  const COLS = 8;

  if (view === 'day') {
    const rows = (data.by_day || []).filter(r => {
      const dow = new Date(r.date + 'T00:00:00').getDay();
      if (dow === 6 && !showSat) return false;
      if (dow === 0 && !showSun) return false;
      return true;
    });

    let html = `<table>
      <tr><th style="width:28px"></th><th>Dátum</th><th>Számlák</th><th>Tételek</th><th>Aktív idő</th><th style="color:#D97706">📦 Pakolás</th><th style="color:#EF4444">🔍 Hiányzóak</th><th>Átlag/tétel</th></tr>`;

    if (!rows.length) {
      html += `<tr><td colspan="${COLS}" style="text-align:center;color:#CCC;padding:30px">Nincs adat</td></tr>`;
    } else {
      rows.forEach((r, i) => {
        const dow = new Date(r.date + 'T00:00:00').getDay();
        const cls = r.invoices === 0 ? 'empty' : (dow === 6 ? 'saturday' : dow === 0 ? 'sunday' : '');
        const recs = allRecs.filter(x => x.date === r.date);
        const hasRecs = recs.length > 0;
        html += `<tr class="main-row ${cls}" data-idx="${i}" style="cursor:${hasRecs ? 'pointer' : 'default'}">
          <td><span class="tog" style="color:#4361EE;font-size:11px;font-weight:700">${hasRecs ? '▶' : ''}</span></td>
          <td>${fmtHu(r.date)}</td>
          <td>${r.invoices || '–'}</td>
          <td>${r.items || '–'}</td>
          <td>${fmtSec(r.active_seconds)}</td>
          <td style="color:${r.packing_seconds>0?'#D97706':'#CCC'}">${r.packing_seconds>0?fmtSec(r.packing_seconds):'–'}</td>
          <td style="color:${r.problems_seconds>0?'#EF4444':'#CCC'}">${r.problems_seconds>0?fmtSec(r.problems_seconds):'–'}</td>
          <td>${fmtSec(r.avg_per_item)}</td>
        </tr>`;
        if (hasRecs) {
          html += `<tr id="detail-${i}" style="display:none"><td colspan="${COLS}" style="padding:0">
            <table class="detail-table">${subHeader(false)}${invoiceSubTable(recs, false)}</table>
          </td></tr>`;
        }
      });
    }
    html += '</table>';
    document.getElementById('tableArea').innerHTML = html;
    attachExpand();

  } else if (view === 'worker') {
    const rows = data.by_worker || [];
    let html = `<table>
      <tr><th style="width:28px"></th><th>Dolgozó</th><th>Számlák</th><th>Tételek</th><th>Aktív idő</th><th style="color:#D97706">📦 Pakolás</th><th style="color:#EF4444">🔍 Hiányzóak</th><th>Átlag/tétel</th></tr>`;

    if (!rows.length) {
      html += `<tr><td colspan="${COLS}" style="text-align:center;color:#CCC;padding:30px">Nincs adat</td></tr>`;
    } else {
      rows.forEach((r, i) => {
        const workerName = r.worker || r.worker_name || '';
        const recs = allRecs.filter(x => x.worker_name === workerName);
        html += `<tr class="main-row" data-idx="${i}" style="cursor:pointer">
          <td><span class="tog" style="color:#4361EE;font-size:11px;font-weight:700">▶</span></td>
          <td>${workerName || '–'}</td>
          <td>${r.invoices}</td><td>${r.items}</td>
          <td>${fmtSec(r.active_seconds)}</td>
          <td style="color:${r.packing_seconds>0?'#D97706':'#CCC'}">${r.packing_seconds>0?fmtSec(r.packing_seconds):'–'}</td>
          <td style="color:${r.problems_seconds>0?'#EF4444':'#CCC'}">${r.problems_seconds>0?fmtSec(r.problems_seconds):'–'}</td>
          <td>${fmtSec(r.avg_per_item)}</td>
        </tr>
        <tr id="detail-${i}" style="display:none"><td colspan="${COLS}" style="padding:0">
          <table class="detail-table">${subHeader(true)}${invoiceSubTable(recs, true)}</table>
        </td></tr>`;
      });
    }
    html += '</table>';
    document.getElementById('tableArea').innerHTML = html;
    attachExpand();

  } else if (view === 'supplier') {
    const rows = data.by_supplier || [];
    let html = `<table>
      <tr><th style="width:28px"></th><th>Szállító</th><th>Számlák</th><th>Tételek</th><th>Aktív idő</th><th style="color:#D97706">📦 Pakolás</th><th style="color:#EF4444">🔍 Hiányzóak</th><th>Átlag/tétel</th></tr>`;

    if (!rows.length) {
      html += `<tr><td colspan="${COLS}" style="text-align:center;color:#CCC;padding:30px">Nincs adat</td></tr>`;
    } else {
      rows.forEach((r, i) => {
        const supplierName = r.supplier || '';
        const recs = allRecs.filter(x => x.supplier === supplierName);
        html += `<tr class="main-row" data-idx="${i}" style="cursor:pointer">
          <td><span class="tog" style="color:#4361EE;font-size:11px;font-weight:700">▶</span></td>
          <td>${supplierName || '(nincs szállító)'}</td>
          <td>${r.invoices}</td><td>${r.items}</td>
          <td>${fmtSec(r.active_seconds)}</td>
          <td style="color:${r.packing_seconds>0?'#D97706':'#CCC'}">${r.packing_seconds>0?fmtSec(r.packing_seconds):'–'}</td>
          <td style="color:${r.problems_seconds>0?'#EF4444':'#CCC'}">${r.problems_seconds>0?fmtSec(r.problems_seconds):'–'}</td>
          <td>${fmtSec(r.avg_per_item)}</td>
        </tr>
        <tr id="detail-${i}" style="display:none"><td colspan="${COLS}" style="padding:0">
          <table class="detail-table">${subHeader(true)}${invoiceSubTable(recs, true)}</table>
        </td></tr>`;
      });
    }
    html += '</table>';
    document.getElementById('tableArea').innerHTML = html;
    attachExpand();
  }
}

(async () => {
  const me = await fetch('/api/me').then(r => r.json()).catch(() => ({ loggedIn: false }));
  if (!me.loggedIn) { location.href = '/'; return; }
  updateRefInput();
  await load();
})();
