/**
 * chartHelpers.js — Chart.js rendering and empty-state helpers for Kalyan Covering admin panel.
 */

let chartsInit = {};
let revenueChartInstance = null;
let categoryChartInstance = null;
let salesTrendChartInstance = null;
let trafficChartInstance = null;

const categoryPalette = ['#FFD700', '#B8980A', '#FFA500', '#FF8C00', '#E6C200', '#D4AF37', '#CD7F32', '#666'];

export function renderChartEmptyState(canvasId, message, subMessage = '', icon = '📊') {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  canvas.style.display = 'none';

  const card = canvas.closest('.chart-card') || canvas.parentElement;
  if (!card) return;

  let emptyState = card.querySelector(`.chart-empty-state[data-for="${canvasId}"]`);
  if (!emptyState) {
    emptyState = document.createElement('div');
    emptyState.className = 'chart-empty-state';
    emptyState.setAttribute('data-for', canvasId);
    card.appendChild(emptyState);
  }

  emptyState.style.display = 'flex';
  const cleanTitle = typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(message || 'No data available') : (message || 'No data available');
  const cleanSub = typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(subMessage || 'Data will appear here automatically') : (subMessage || 'Data will appear here automatically');

  emptyState.innerHTML = `
    <div class="chart-empty-icon">${icon}</div>
    <div class="chart-empty-title">${cleanTitle}</div>
    <div class="chart-empty-sub">${cleanSub}</div>
  `;
}

export function renderChartCanvas(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  canvas.style.display = 'block';

  const card = canvas.closest('.chart-card') || canvas.parentElement;
  if (!card) return;

  const emptyState = card.querySelector(`.chart-empty-state[data-for="${canvasId}"]`);
  if (emptyState) {
    emptyState.style.display = 'none';
  }
}

export function initDashCharts(getRevenueLast7DaysFn, getCategoryDataFn) {
  const revCanvas = document.getElementById('revenueChart');
  const catCanvas = document.getElementById('categoryChart');
  if (!revCanvas || !catCanvas || typeof Chart === 'undefined') return;

  const getRev = getRevenueLast7DaysFn || window.getRevenueLast7Days;
  const getCat = getCategoryDataFn || window.getCategoryData;
  if (typeof getRev !== 'function' || typeof getCat !== 'function') return;

  const revData = getRev();
  const catData = getCat();
  const gold = '#FFD700';

  // 1. Revenue Chart
  const isRevEmpty = !revData.data || revData.data.length === 0 || revData.data.every(v => Number(v) === 0);
  if (isRevEmpty) {
    renderChartEmptyState('revenueChart', 'No revenue recorded this week', 'Charts will populate automatically as new orders come in.', '📈');
  } else {
    renderChartCanvas('revenueChart');
    if (!revenueChartInstance && typeof Chart.getChart === 'function') {
      revenueChartInstance = Chart.getChart(revCanvas);
    }
    if (!revenueChartInstance) {
      revenueChartInstance = new Chart(revCanvas, {
        type: 'line',
        data: {
          labels: revData.labels,
          datasets: [{
            label: 'Revenue (₹)',
            data: revData.data,
            borderColor: gold,
            backgroundColor: 'rgba(255,215,0,.08)',
            tension: .4,
            fill: true,
            pointBackgroundColor: gold,
            pointRadius: 4
          }]
        },
        options: {
          responsive: true,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: ctx => '₹' + ctx.parsed.y.toLocaleString() } }
          },
          scales: {
            x: { grid: { color: '#111' }, ticks: { color: '#666' } },
            y: { grid: { color: '#111' }, ticks: { color: '#666', callback: v => '₹' + v.toLocaleString() } }
          }
        }
      });
    } else {
      revenueChartInstance.data.labels = revData.labels;
      revenueChartInstance.data.datasets[0].data = revData.data;
      revenueChartInstance.update();
    }
  }

  // 2. Category Chart
  const isCatEmpty = !catData.data || catData.data.length === 0 || catData.data.every(v => Number(v) === 0);
  if (isCatEmpty) {
    renderChartEmptyState('categoryChart', 'No category sales yet', 'Product category breakdown will appear here once orders are placed.', '📊');
  } else {
    renderChartCanvas('categoryChart');
    if (!categoryChartInstance && typeof Chart.getChart === 'function') {
      categoryChartInstance = Chart.getChart(catCanvas);
    }
    if (!categoryChartInstance) {
      categoryChartInstance = new Chart(catCanvas, {
        type: 'doughnut',
        data: {
          labels: catData.labels,
          datasets: [{
            data: catData.data,
            backgroundColor: catData.labels.map((_, i) => categoryPalette[i % categoryPalette.length]),
            borderWidth: 0
          }]
        },
        options: {
          responsive: true,
          plugins: {
            legend: { position: 'bottom', labels: { color: '#aaa', padding: 12, font: { size: 11 } } }
          },
          cutout: '65%'
        }
      });
    } else {
      categoryChartInstance.data.labels = catData.labels;
      categoryChartInstance.data.datasets[0].data = catData.data;
      categoryChartInstance.data.datasets[0].backgroundColor = catData.labels.map((_, i) => categoryPalette[i % categoryPalette.length]);
      categoryChartInstance.update();
    }
  }

  chartsInit.dash = true;
}

export function initAnalyticsCharts(getMonthlySalesTrendDataFn) {
  const trendCanvas = document.getElementById('salesTrendChart');
  const trafficCanvas = document.getElementById('trafficChart');
  if (!trendCanvas || !trafficCanvas || typeof Chart === 'undefined') return;

  const getTrend = getMonthlySalesTrendDataFn || window.getMonthlySalesTrendData;
  if (typeof getTrend !== 'function') return;

  const trendData = getTrend();
  const isTrendEmpty = !trendData.revenueK || trendData.revenueK.length === 0 || (trendData.revenueK.every(v => Number(v) === 0) && trendData.ordersCount.every(v => Number(v) === 0));

  if (isTrendEmpty) {
    renderChartEmptyState('salesTrendChart', 'No sales trend data available', 'Monthly revenue and order volume will display here.', '📊');
  } else {
    renderChartCanvas('salesTrendChart');
    if (!salesTrendChartInstance && typeof Chart.getChart === 'function') {
      salesTrendChartInstance = Chart.getChart(trendCanvas);
    }
    if (!salesTrendChartInstance) {
      salesTrendChartInstance = new Chart(trendCanvas, {
        type: 'bar',
        data: {
          labels: trendData.labels,
          datasets: [
            { label: 'Revenue(₹K)', data: trendData.revenueK, backgroundColor: 'rgba(255,215,0,.7)', borderRadius: 6 },
            { label: 'Orders', data: trendData.ordersCount, backgroundColor: 'rgba(255,165,0,.4)', borderRadius: 6 }
          ]
        },
        options: {
          responsive: true,
          plugins: { legend: { labels: { color: '#aaa' } } },
          scales: { x: { grid: { color: '#111' }, ticks: { color: '#666' } }, y: { grid: { color: '#111' }, ticks: { color: '#666' } } }
        }
      });
    } else {
      salesTrendChartInstance.data.labels = trendData.labels;
      salesTrendChartInstance.data.datasets[0].data = trendData.revenueK;
      salesTrendChartInstance.data.datasets[1].data = trendData.ordersCount;
      salesTrendChartInstance.update();
    }
  }

  if (!trafficChartInstance && typeof Chart.getChart === 'function') {
    trafficChartInstance = Chart.getChart(trafficCanvas);
  }
  if (!trafficChartInstance) {
    trafficChartInstance = new Chart(trafficCanvas, {
      type: 'pie',
      data: {
        labels: ['Organic', 'Direct', 'Social', 'Referral'],
        datasets: [{ data: [42, 28, 20, 10], backgroundColor: ['#FFD700', '#FFA500', '#B8980A', '#665500'], borderWidth: 0 }]
      },
      options: { responsive: true, plugins: { legend: { position: 'bottom', labels: { color: '#aaa', font: { size: 11 } } } } }
    });
  }

  chartsInit.analytics = true;
}

if (typeof window !== 'undefined') {
  window.renderChartEmptyState = renderChartEmptyState;
  window.renderChartCanvas = renderChartCanvas;
  window.initDashCharts = initDashCharts;
  window.initAnalyticsCharts = initAnalyticsCharts;
}
