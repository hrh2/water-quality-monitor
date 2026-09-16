// Thin Chart.js wrapper. Chart.js is loaded globally via the CDN <script>
// tag in admin.html (see https://cdn.jsdelivr.net/npm/chart.js) - these
// helpers just keep one Chart instance per <canvas> id and handle
// destroy/recreate so re-rendering a tab doesn't leak canvases.

const instances = new Map();

function themeColors() {
  const styles = getComputedStyle(document.documentElement);
  return {
    text: styles.getPropertyValue('--text-dim').trim() || '#6f9298',
    line: styles.getPropertyValue('--line').trim() || '#1c3339',
  };
}

export function destroyChart(canvasId) {
  const existing = instances.get(canvasId);
  if (existing) {
    existing.destroy();
    instances.delete(canvasId);
  }
}

function baseGridOptions() {
  const c = themeColors();
  return {
    ticks: { color: c.text, font: { family: "'IBM Plex Mono', monospace", size: 11 } },
    grid: { color: c.line },
  };
}

export function renderLineChart(canvasId, { labels, datasets, yLabel }) {
  destroyChart(canvasId);
  const el = document.getElementById(canvasId);
  if (!el || typeof Chart === 'undefined') return null;
  const c = themeColors();
  const chart = new Chart(el, {
    type: 'line',
    data: {
      labels,
      datasets: datasets.map((ds) => ({
        label: ds.label,
        data: ds.data,
        borderColor: ds.color,
        backgroundColor: ds.color,
        pointRadius: 2,
        pointHoverRadius: 4,
        tension: 0.25,
        borderWidth: 2,
        spanGaps: true,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'nearest', intersect: false },
      plugins: {
        legend: { labels: { color: c.text, font: { family: "'Space Grotesk'" } } },
        tooltip: { titleFont: { family: "'IBM Plex Mono', monospace" }, bodyFont: { family: "'IBM Plex Mono', monospace" } },
      },
      scales: {
        x: baseGridOptions(),
        y: { ...baseGridOptions(), title: yLabel ? { display: true, text: yLabel, color: c.text } : undefined },
      },
    },
  });
  instances.set(canvasId, chart);
  return chart;
}

export function renderDoughnutChart(canvasId, { labels, data, colors }) {
  destroyChart(canvasId);
  const el = document.getElementById(canvasId);
  if (!el || typeof Chart === 'undefined') return null;
  const c = themeColors();
  const chart = new Chart(el, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data, backgroundColor: colors, borderColor: 'transparent' }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: c.text, font: { family: "'Space Grotesk'" } } },
      },
    },
  });
  instances.set(canvasId, chart);
  return chart;
}

export function renderBarChart(canvasId, { labels, data, colors, indexAxis = 'x' }) {
  destroyChart(canvasId);
  const el = document.getElementById(canvasId);
  if (!el || typeof Chart === 'undefined') return null;
  const c = themeColors();
  const chart = new Chart(el, {
    type: 'bar',
    data: { labels, datasets: [{ data, backgroundColor: colors }] },
    options: {
      indexAxis,
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: baseGridOptions(), y: baseGridOptions() },
    },
  });
  instances.set(canvasId, chart);
  return chart;
}

/** Scatter-style "category over time" chart: y axis is the ordinal index
 * of the category label so severity trend is visible at a glance. */
export function renderCategoryTimeChart(canvasId, { points, categoryOrder, colorFor }) {
  destroyChart(canvasId);
  const el = document.getElementById(canvasId);
  if (!el || typeof Chart === 'undefined') return null;
  const c = themeColors();
  const chart = new Chart(el, {
    type: 'scatter',
    data: {
      datasets: [
        {
          label: 'Predicted category',
          data: points.map((p) => ({ x: p.x, y: categoryOrder.indexOf(p.category) })),
          backgroundColor: points.map((p) => colorFor(p.category)),
          pointRadius: 4,
          pointHoverRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => categoryOrder[ctx.parsed.y] || '',
            title: (items) => new Date(items[0].parsed.x).toLocaleString(),
          },
        },
      },
      scales: {
        x: {
          ...baseGridOptions(),
          type: 'linear',
          ticks: {
            ...baseGridOptions().ticks,
            callback: (val) => new Date(val).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          },
        },
        y: {
          ...baseGridOptions(),
          min: -0.5,
          max: categoryOrder.length - 0.5,
          ticks: {
            ...baseGridOptions().ticks,
            stepSize: 1,
            callback: (val) => categoryOrder[val] || '',
          },
        },
      },
    },
  });
  instances.set(canvasId, chart);
  return chart;
}
