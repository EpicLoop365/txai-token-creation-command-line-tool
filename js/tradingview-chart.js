/* ===== TradingView Full Chart Integration ===== */
/* Replaces lightweight-charts with the full TradingView charting_library */

let tvWidget = null;
let tvDataFeed = null;
let tvBarsData = [];   // { time, open, high, low, close, volume }
let tvRealtimeCallback = null;
let tvRealtimeSymbol = null;

const TV_LIBRARY_PATH = '/charting_library/';

/* --- DataFeed Implementation --- */
class TxaiDataFeed {
  constructor() {
    this.subscribers = {};
  }

  onReady(callback) {
    setTimeout(() => {
      callback({
        supported_resolutions: ['1', '5', '15', '30', '60', '1D', '3D', '1W'],
        supports_marks: false,
        supports_timescale_marks: false,
        supports_time: true,
      });
    }, 0);
  }

  searchSymbols(userInput, exchange, symbolType, onResult) {
    onResult([]);
  }

  resolveSymbol(symbolName, onResolve, onError) {
    setTimeout(() => {
      const parts = symbolName.split('/');
      onResolve({
        name: symbolName,
        description: symbolName,
        type: 'crypto',
        session: '24x7',
        timezone: 'Etc/UTC',
        exchange: 'TX DEX',
        listed_exchange: 'TX DEX',
        format: 'price',
        minmov: 1,
        pricescale: 1000000,  // 6 decimal places
        has_intraday: true,
        has_daily: true,
        has_weekly_and_monthly: true,
        supported_resolutions: ['1', '5', '15', '30', '60', '1D', '3D', '1W'],
        volume_precision: 2,
        data_status: 'streaming',
      });
    }, 0);
  }

  getBars(symbolInfo, resolution, periodParams, onResult, onError) {
    // Return whatever bars we have
    const bars = tvBarsData.map(b => ({
      time: b.time * 1000, // TV expects milliseconds
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume || 0,
    }));

    if (bars.length === 0) {
      onResult([], { noData: true });
    } else {
      onResult(bars, { noData: false });
    }
  }

  subscribeBars(symbolInfo, resolution, onRealtimeCallback, subscriberUID) {
    this.subscribers[subscriberUID] = onRealtimeCallback;
    tvRealtimeCallback = onRealtimeCallback;
    tvRealtimeSymbol = subscriberUID;
  }

  unsubscribeBars(subscriberUID) {
    delete this.subscribers[subscriberUID];
    if (tvRealtimeSymbol === subscriberUID) {
      tvRealtimeCallback = null;
      tvRealtimeSymbol = null;
    }
  }

  // Push a new bar or update the current bar
  pushBar(bar) {
    const tvBar = {
      time: bar.time * 1000,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume || 0,
    };
    Object.values(this.subscribers).forEach(cb => {
      try { cb(tvBar); } catch(e) { console.warn('TV callback error:', e); }
    });
  }
}

/* --- Initialize TradingView Widget --- */
function tvInitChart(containerId, symbol) {
  if (tvWidget) {
    try { tvWidget.remove(); } catch(e) {}
    tvWidget = null;
  }

  const container = document.getElementById(containerId);
  if (!container) return;

  // Check if library is loaded
  if (typeof TradingView === 'undefined' || !TradingView.widget) {
    console.warn('[tv] TradingView charting_library not loaded, falling back to lightweight-charts');
    return false;
  }

  tvDataFeed = new TxaiDataFeed();

  tvWidget = new TradingView.widget({
    // Basic setup
    symbol: symbol || 'TOKEN/TX',
    interval: '1',
    container: containerId,
    datafeed: tvDataFeed,
    library_path: TV_LIBRARY_PATH,

    // Appearance
    theme: 'dark',
    locale: 'en',
    width: '100%',
    height: '100%',
    autosize: true,
    toolbar_bg: '#101216',

    // Features
    disabled_features: [
      'header_symbol_search',
      'header_interval_dialog_button',
      'header_settings',
      'header_compare',
      'header_undo_redo',
      'header_indicators',
      'header_screenshot',
      'header_widget',
      'compare_symbol',
      'context_menus',
      'volume_force_overlay',
      'use_localstorage_for_settings',
      'study_templates',
      'display_market_status',
      'header_saveload',
    ],
    enabled_features: [],

    // Styling overrides
    overrides: {
      'paneProperties.backgroundType': 'solid',
      'paneProperties.background': '#101216',
      'paneProperties.vertGridProperties.color': '#1a1a1a',
      'paneProperties.horzGridProperties.color': '#1a1a1a',
      'scalesProperties.textColor': '#5e6773',
      'mainSeriesProperties.candleStyle.upColor': '#25d695',
      'mainSeriesProperties.candleStyle.downColor': '#d81d3c',
      'mainSeriesProperties.candleStyle.borderUpColor': '#25d695',
      'mainSeriesProperties.candleStyle.borderDownColor': '#d81d3c',
      'mainSeriesProperties.candleStyle.wickUpColor': '#25d695',
      'mainSeriesProperties.candleStyle.wickDownColor': '#d81d3c',
    },
    studies_overrides: {
      'volume.volume.color.0': 'rgba(216, 29, 60, 0.25)',
      'volume.volume.color.1': 'rgba(37, 214, 149, 0.25)',
    },

    // Layout
    drawings_access: {
      type: 'black',
      tools: [{ name: 'Regression Trend' }],
    },
    time_frames: [
      { text: '1y', resolution: '1W' },
      { text: '1m', resolution: '1D' },
      { text: '1d', resolution: '30' },
      { text: '12h', resolution: '15' },
      { text: '1h', resolution: '1' },
    ],
    allow_symbol_change: false,
    load_last_chart: false,
    layout: { attributionLogo: false },
  });

  tvWidget.onChartReady(() => {
    console.log('[tv] TradingView chart ready');
    // Add volume study
    tvWidget.activeChart().createStudy('Volume', false, false, {}, {
      'volume.color.0': 'rgba(216, 29, 60, 0.25)',
      'volume.color.1': 'rgba(37, 214, 149, 0.25)',
    });
  });

  return true;
}

/* --- Add a candle/bar from trade data --- */
function tvAddBar(bar) {
  tvBarsData.push(bar);
  if (tvDataFeed) {
    tvDataFeed.pushBar(bar);
  }
}

/* --- Update the last bar (for price updates within same candle) --- */
function tvUpdateLastBar(price, volume) {
  if (!tvBarsData.length) return;
  const last = tvBarsData[tvBarsData.length - 1];
  last.close = price;
  if (price > last.high) last.high = price;
  if (price < last.low) last.low = price;
  last.volume = (last.volume || 0) + (volume || 0);
  if (tvDataFeed) tvDataFeed.pushBar(last);
}

/* --- Clear all chart data --- */
function tvClearData() {
  tvBarsData = [];
}

/* --- Check if TV library is available --- */
function tvIsAvailable() {
  return typeof TradingView !== 'undefined' && TradingView.widget;
}
