/* ============================================================
   DoToR Admin Dashboard - Main Application
   ============================================================ */

// ════════════════════════════════════════════════════════════
// FIREBASE CONFIG (same as the DoToR app)
// ════════════════════════════════════════════════════════════

const firebaseConfig = {
  apiKey: 'AIzaSyDGzlU-qp5Q_ht8xxIrpyeGNPLgbbKexKs',
  authDomain: 'dotor-2e4d8.firebaseapp.com',
  databaseURL: 'https://dotor-2e4d8-default-rtdb.firebaseio.com',
  projectId: 'dotor-2e4d8',
  storageBucket: 'dotor-2e4d8.firebasestorage.app',
  messagingSenderId: '984437487718',
  appId: '1:984437487718:android:c323dd93e33ea0889915a7',
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// ════════════════════════════════════════════════════════════
// ADMIN CREDENTIALS (Change these!)
// ════════════════════════════════════════════════════════════

const ADMIN_PASSWORD = 'admin123';
const ADMIN_USER = 'DoToR Admin';

// ════════════════════════════════════════════════════════════
// STATE
// ════════════════════════════════════════════════════════════

let allOrders = [];
let filteredOrders = [];
let areaData = {};
let statusChartInstance = null;
let trendChartInstance = null;
let ordersUnsubscribe = null;
let refreshInterval = null;

const STORE_KEY = 'dotor_admin_auth';

// ════════════════════════════════════════════════════════════
// DOM HELPERS
// ════════════════════════════════════════════════════════════

function $(id) { return document.getElementById(id); }

function qs(sel, ctx) { return (ctx || document).querySelector(sel); }

function qsa(sel, ctx) { return Array.from((ctx || document).querySelectorAll(sel)); }

// ════════════════════════════════════════════════════════════
// AUTHENTICATION
// ════════════════════════════════════════════════════════════

function adminLogin() {
  const password = $('adminPassword').value.trim();
  const errorEl = $('loginError');

  if (!password) {
    errorEl.textContent = '⚠️ Please enter the admin password';
    return;
  }

  if (password !== ADMIN_PASSWORD) {
    errorEl.textContent = '❌ Incorrect password. Please try again.';
    $('adminPassword').value = '';
    $('adminPassword').focus();
    return;
  }

  // Success
  errorEl.textContent = '';
  localStorage.setItem(STORE_KEY, JSON.stringify({ authenticated: true, time: Date.now() }));
  showDashboard();
}

function adminLogout() {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
  if (ordersUnsubscribe) {
    ordersUnsubscribe();
    ordersUnsubscribe = null;
  }
  localStorage.removeItem(STORE_KEY);
  $('dashboardScreen').style.display = 'none';
  $('loginScreen').style.display = 'flex';
  $('adminPassword').value = '';
  $('loginError').textContent = '🔓 Logged out successfully';
}

function checkAuth() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORE_KEY));
    if (stored && stored.authenticated) {
      // Session expires after 24 hours
      if (Date.now() - stored.time < 24 * 60 * 60 * 1000) {
        showDashboard();
        return;
      }
    }
  } catch (e) {}
  $('loginScreen').style.display = 'flex';
  $('dashboardScreen').style.display = 'none';
}

function showDashboard() {
  $('loginScreen').style.display = 'none';
  $('dashboardScreen').style.display = 'flex';
  initDashboard();
}

// ════════════════════════════════════════════════════════════
// DATE HELPERS
// ════════════════════════════════════════════════════════════

function getTodayStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function getDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function formatTime(ts) {
  if (!ts) return '--';
  const d = new Date(ts);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const dDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  let prefix = '';
  if (dDate.getTime() === today.getTime()) prefix = 'Today ';
  else if (dDate.getTime() === yesterday.getTime()) prefix = 'Yesterday ';
  else prefix = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + ' ';

  return prefix + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function parseOrderTime(order) {
  // 1. Prefer numeric timestamps (completedTime, autoAssignTime, or a server timestamp)
  if (order.completedTime) return order.completedTime;
  if (order.autoAssignTime) return order.autoAssignTime;
  if (order.timestamp) return order.timestamp;

  // 2. Try to parse the string "time" field (e.g. "2:30:00 PM")
  if (order.time) {
    const d = new Date();
    // Try 12-hour format: "2:30:00 PM"
    const parts12 = order.time.match(/^(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i);
    if (parts12) {
      let h = parseInt(parts12[1]);
      const m = parseInt(parts12[2]);
      const s = parseInt(parts12[3]);
      const ampm = parts12[4].toUpperCase();
      if (ampm === 'PM' && h < 12) h += 12;
      if (ampm === 'AM' && h === 12) h = 0;
      d.setHours(h, m, s, 0);
      return d.getTime();
    }
    // Try 24-hour format: "14:30:00"
    const parts24 = order.time.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
    if (parts24) {
      d.setHours(parseInt(parts24[1]), parseInt(parts24[2]), parseInt(parts24[3]), 0);
      return d.getTime();
    }
  }

  // 3. Fallback — return 0 so old orders sort to the bottom instead of appearing as "just now"
  if (order.status === 'pending' || order.status === 'accepted') {
    // For recent orders, try to use the current date with their time
    return Date.now();
  }
  return 0;
}

function getDateStr(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function getDateLabel(ts) {
  const d = new Date(ts);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return days[d.getDay()] + ' ' + d.getDate();
}

// ════════════════════════════════════════════════════════════
// DASHBOARD INIT
// ════════════════════════════════════════════════════════════

function initDashboard() {
  // Set default date filters
  const today = new Date();
  $('filterTo').value = getDateStr(today.getTime());
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 30);
  $('filterFrom').value = getDateStr(weekAgo.getTime());

  // Listen for orders in real-time
  listenOrders();

  // Auto-refresh every 30 seconds
  if (refreshInterval) clearInterval(refreshInterval);
  refreshInterval = setInterval(() => {
    updateLastRefresh();
  }, 30000);
}

function listenOrders() {
  if (ordersUnsubscribe) ordersUnsubscribe();

  $('loadingOverlay').style.display = 'flex';

  const ordersRef = db.ref('orders');
  ordersUnsubscribe = ordersRef.on('value', (snapshot) => {
    $('loadingOverlay').style.display = 'none';

    if (!snapshot.exists()) {
      allOrders = [];
      filteredOrders = [];
      areaData = {};
      renderDashboard();
      return;
    }

    allOrders = [];
    snapshot.forEach((child) => {
      allOrders.push({
        id: child.key,
        ...child.val(),
        _parsedTime: parseOrderTime(child.val()),
      });
    });

    processData();
  });
}

// ════════════════════════════════════════════════════════════
// DATA PROCESSING
// ════════════════════════════════════════════════════════════

function processData() {
  // Sort orders by time (newest first)
  allOrders.sort((a, b) => (b._parsedTime || 0) - (a._parsedTime || 0));

  // Build area data
  areaData = {};
  allOrders.forEach((order) => {
    // Use location or pincode as area key
    let area = (order.location || '').trim();
    let pincode = (order.pincode || '').trim();

    if (!area && !pincode) {
      area = 'Unknown';
    }
    if (!area && pincode) {
      area = 'Pincode: ' + pincode;
    }

    if (!areaData[area]) {
      areaData[area] = {
        name: area,
        pincode: pincode,
        total: 0,
        completed: 0,
        pending: 0,
        accepted: 0,
        rejected: 0,
        orders: [],
      };
    }

    areaData[area].total++;
    areaData[area].orders.push(order);
    if (order.status === 'completed') areaData[area].completed++;
    else if (order.status === 'pending') areaData[area].pending++;
    else if (order.status === 'accepted') areaData[area].accepted++;
    else if (order.status === 'rejected') areaData[area].rejected++;

    // Track all pincodes for an area
    if (pincode && !areaData[area].pincode) {
      areaData[area].pincode = pincode;
    }
  });

  // Populate area filter
  populateAreaFilter();
  applyFilters();
}

function populateAreaFilter() {
  const select = $('filterArea');
  const currentValue = select.value;
  select.innerHTML = '<option value="all">All Areas</option>';

  const areas = Object.keys(areaData).sort();
  areas.forEach((area) => {
    const opt = document.createElement('option');
    opt.value = area;
    opt.textContent = `${area} (${areaData[area].total} orders)`;
    select.appendChild(opt);
  });

  // Restore selection if possible
  if (currentValue !== 'all' && areas.includes(currentValue)) {
    select.value = currentValue;
  }
}

// ════════════════════════════════════════════════════════════
// FILTERING
// ════════════════════════════════════════════════════════════

function applyFilters() {
  const fromDate = $('filterFrom').value;
  const toDate = $('filterTo').value;
  const area = $('filterArea').value;
  const status = $('filterStatus').value;

  filteredOrders = allOrders.filter((order) => {
    const orderTime = order._parsedTime || 0;

    // Date filter
    if (fromDate) {
      const from = new Date(fromDate + 'T00:00:00').getTime();
      if (orderTime < from) return false;
    }
    if (toDate) {
      const to = new Date(toDate + 'T23:59:59').getTime();
      if (orderTime > to) return false;
    }

    // Area filter
    if (area !== 'all') {
      const orderArea = (order.location || '').trim();
      const orderPincode = (order.pincode || '').trim();
      if (!orderArea && !orderPincode) return false;
      const matchArea = orderArea === area || orderPincode === area;
      if (!matchArea) return false;
    }

    // Status filter
    if (status !== 'all' && order.status !== status) return false;

    return true;
  });

  renderDashboard();
}

function resetFilters() {
  const today = new Date();
  $('filterTo').value = getDateStr(today.getTime());
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 30);
  $('filterFrom').value = getDateStr(weekAgo.getTime());
  $('filterArea').value = 'all';
  $('filterStatus').value = 'all';
  applyFilters();
}

// ════════════════════════════════════════════════════════════
// RENDER DASHBOARD
// ════════════════════════════════════════════════════════════

function renderDashboard() {
  renderStats();
  renderAreaTable();
  renderOrdersTable();
  renderStatusChart();
  renderTrendChart();
  updateFooterStats();
  updateLastRefresh();
}

function renderStats() {
  const total = filteredOrders.length;
  const pending = filteredOrders.filter((o) => o.status === 'pending').length;
  const accepted = filteredOrders.filter((o) => o.status === 'accepted').length;
  const completed = filteredOrders.filter((o) => o.status === 'completed').length;
  const rejected = filteredOrders.filter((o) => o.status === 'rejected').length;
  const today = filteredOrders.filter((o) => (o._parsedTime || 0) >= getTodayStart()).length;

  animateNumber('statTotal', total);
  animateNumber('statPending', pending);
  animateNumber('statAccepted', accepted);
  animateNumber('statCompleted', completed);
  animateNumber('statRejected', rejected);
  animateNumber('statToday', today);
}

function animateNumber(elementId, target) {
  const el = $(elementId);
  if (!el) return;
  const current = parseInt(el.textContent) || 0;
  if (current === target) return;
  el.textContent = target;
  el.style.transition = 'none';
  el.style.transform = 'scale(1.3)';
  setTimeout(() => {
    el.style.transition = 'transform 0.3s ease';
    el.style.transform = 'scale(1)';
  }, 50);
}

function renderAreaTable() {
  const tbody = $('areaTableBody');
  if (!tbody) return;

  // Build area stats based on filtered orders
  const areaStats = {};
  filteredOrders.forEach((order) => {
    let area = (order.location || '').trim();
    const pincode = (order.pincode || '').trim();
    if (!area && !pincode) area = 'Unknown';
    if (!area && pincode) area = 'Pincode: ' + pincode;

    if (!areaStats[area]) {
      areaStats[area] = { name: area, pincode, total: 0, completed: 0, pending: 0, accepted: 0 };
    }
    areaStats[area].total++;
    if (order.status === 'completed') areaStats[area].completed++;
    else if (order.status === 'pending') areaStats[area].pending++;
    else if (order.status === 'accepted') areaStats[area].accepted++;
    if (pincode && !areaStats[area].pincode) areaStats[area].pincode = pincode;
  });

  const entries = Object.entries(areaStats).sort((a, b) => b[1].total - a[1].total);
  const maxTotal = entries.length > 0 ? entries[0][1].total : 1;

  $('areaCount').textContent = entries.length + ' areas';

  if (entries.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="table-empty">📭 No orders match the current filters</td></tr>';
    return;
  }

  tbody.innerHTML = entries
    .map(([area, data], i) => {
      const completionRate = data.total > 0 ? ((data.completed / data.total) * 100).toFixed(1) : 0;
      const rateClass = completionRate >= 70 ? 'rate-high' : completionRate >= 40 ? 'rate-mid' : 'rate-low';
      const barWidth = (data.total / maxTotal) * 100;

      return `
        <tr>
          <td><span class="row-num">${i + 1}</span></td>
          <td>
            <div class="area-highlight">
              <span class="area-name">📍 ${data.name}</span>
            </div>
          </td>
          <td>${data.pincode || '—'}</td>
          <td><strong>${data.total}</strong></td>
          <td>${data.completed}</td>
          <td>${data.pending}</td>
          <td>${data.accepted}</td>
          <td>
            <span class="completion-rate ${rateClass}">${completionRate}%</span>
            <div class="area-bar-container">
              <div class="area-bar completed" style="width:${completionRate}%"></div>
            </div>
          </td>
        </tr>
      `;
    })
    .join('');
}

function filterOrdersTable() {
  renderOrdersTable();
}

function renderOrdersTable() {
  const tbody = $('ordersTableBody');
  const searchQuery = ($('orderSearch')?.value || '').toLowerCase().trim();

  $('orderCount').textContent = filteredOrders.length + ' orders';

  if (!tbody) return;

  let displayOrders = filteredOrders;
  if (searchQuery) {
    displayOrders = filteredOrders.filter(
      (o) =>
        (o.customerName || '').toLowerCase().includes(searchQuery) ||
        (o.brand || '').toLowerCase().includes(searchQuery) ||
        (o.repair || '').toLowerCase().includes(searchQuery) ||
        (o.location || '').toLowerCase().includes(searchQuery) ||
        (o.pincode || '').includes(searchQuery) ||
        (o.status || '').includes(searchQuery)
    );
  }

  // Show latest 100 orders in table
  const tableOrders = displayOrders.slice(0, 100);

  if (tableOrders.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="table-empty">📭 No orders match the current filters</td></tr>';
    return;
  }

  const statusMap = {
    pending: { label: '⏳ Pending', class: 'status-pending' },
    accepted: { label: '🔧 In Progress', class: 'status-accepted' },
    completed: { label: '✅ Completed', class: 'status-completed' },
    rejected: { label: '❌ Rejected', class: 'status-rejected' },
  };

  tbody.innerHTML = tableOrders
    .map((order) => {
      const s = statusMap[order.status] || { label: order.status || 'Unknown', class: '' };
      return `
        <tr>
          <td style="white-space:nowrap">${formatTime(order._parsedTime)}</td>
          <td><strong>${order.customerName || 'Unknown'}</strong></td>
          <td>${order.brand || '—'}</td>
          <td>${order.repair || '—'}</td>
          <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
            ${order.location || ''}${order.pincode ? ' 📮' + order.pincode : ''}
          </td>
          <td><span class="status-badge ${s.class}">${s.label}</span></td>
        </tr>
      `;
    })
    .join('');
}

// ════════════════════════════════════════════════════════════
// CHARTS
// ════════════════════════════════════════════════════════════

function renderStatusChart() {
  const ctx = $('statusChart');
  if (!ctx) return;

  if (statusChartInstance) {
    statusChartInstance.destroy();
  }

  const pending = filteredOrders.filter((o) => o.status === 'pending').length;
  const accepted = filteredOrders.filter((o) => o.status === 'accepted').length;
  const completed = filteredOrders.filter((o) => o.status === 'completed').length;
  const rejected = filteredOrders.filter((o) => o.status === 'rejected').length;

  statusChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['⏳ Pending', '🔧 In Progress', '✅ Completed', '❌ Rejected'],
      datasets: [
        {
          data: [pending, accepted, completed, rejected],
          backgroundColor: ['#f57c00', '#FF6B00', '#2e7d32', '#c62828'],
          borderWidth: 3,
          borderColor: '#fff',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            padding: 16,
            usePointStyle: true,
            font: { size: 12, weight: '700' },
            color: '#555',
          },
        },
        tooltip: {
          callbacks: {
            label: function (context) {
              const total = context.dataset.data.reduce((a, b) => a + b, 0);
              const pct = total > 0 ? ((context.parsed / total) * 100).toFixed(1) : 0;
              return context.label + ': ' + context.parsed + ' (' + pct + '%)';
            },
          },
        },
      },
      cutout: '65%',
    },
  });
}

function renderTrendChart() {
  const ctx = $('trendChart');
  if (!ctx) return;

  if (trendChartInstance) {
    trendChartInstance.destroy();
  }

  // Build last 7 days data
  const days = [];
  const totalData = [];
  const completedData = [];
  const pendingData = [];

  for (let i = 6; i >= 0; i--) {
    const dayStart = getDaysAgo(i);
    const dayEnd = getDaysAgo(i - 1); // up to start of next day

    days.push(getDateLabel(dayStart));

    const dayOrders = filteredOrders.filter(
      (o) => (o._parsedTime || 0) >= dayStart && (o._parsedTime || 0) < dayEnd
    );
    totalData.push(dayOrders.length);
    completedData.push(dayOrders.filter((o) => o.status === 'completed').length);
    pendingData.push(dayOrders.filter((o) => o.status === 'pending').length);
  }

  trendChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: days,
      datasets: [
        {
          label: '📦 Total Orders',
          data: totalData,
          backgroundColor: 'rgba(26,58,107,0.7)',
          borderColor: '#1A3A6B',
          borderWidth: 2,
          borderRadius: 4,
        },
        {
          label: '✅ Completed',
          data: completedData,
          backgroundColor: 'rgba(46,125,50,0.7)',
          borderColor: '#2e7d32',
          borderWidth: 2,
          borderRadius: 4,
        },
        {
          label: '⏳ Pending',
          data: pendingData,
          backgroundColor: 'rgba(245,124,0,0.7)',
          borderColor: '#f57c00',
          borderWidth: 2,
          borderRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            padding: 12,
            usePointStyle: true,
            font: { size: 11, weight: '700' },
            color: '#555',
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { size: 11, weight: '600' }, color: '#888' },
        },
        y: {
          beginAtZero: true,
          ticks: {
            stepSize: 1,
            font: { size: 11, weight: '600' },
            color: '#888',
          },
          grid: { color: '#f0f0f0' },
        },
      },
    },
  });
}

// ════════════════════════════════════════════════════════════
// FOOTER & REFRESH
// ════════════════════════════════════════════════════════════

function updateFooterStats() {
  const total = allOrders.length;
  const filtered = filteredOrders.length;
  const completed = allOrders.filter((o) => o.status === 'completed').length;
  const el = $('footerStats');
  if (el) {
    el.textContent = `📊 ${filtered} shown · ${total} total orders · ${completed} completed total`;
  }
}

function updateLastRefresh() {
  const now = new Date();
  const el = $('lastRefresh');
  if (el) {
    el.textContent = 'Updated ' + now.toLocaleTimeString();
  }
}

function refreshData() {
  $('loadingOverlay').style.display = 'flex';
  // Re-trigger Firebase listener
  if (ordersUnsubscribe) {
    ordersUnsubscribe();
  }
  listenOrders();
}

// ════════════════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════════════════

// Check authentication on load
document.addEventListener('DOMContentLoaded', () => {
  // Show login initially, check auth
  $('loginScreen').style.display = 'flex';
  $('dashboardScreen').style.display = 'none';

  // Small delay then check auth
  setTimeout(checkAuth, 300);
});

// Expose functions globally for onclick handlers
window.adminLogin = adminLogin;
window.adminLogout = adminLogout;
window.applyFilters = applyFilters;
window.resetFilters = resetFilters;
window.filterOrdersTable = filterOrdersTable;
window.refreshData = refreshData;
