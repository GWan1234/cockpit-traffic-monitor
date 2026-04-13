/* ========================================
   Cockpit Traffic Monitor - vnstat Module
   Extracted from app.js
   ======================================== */
(function () {
  'use strict';

  var _state = null;
  var _ensureHistory = null;
  var _renderChart = null;

  var vnstatAvailable = false;

  // vnstat JSON mode → JSON traffic key mapping
  // vnstat 2.x uses: fiveminute, hour, day, month, year
  // Our internal tier names: fiveminutes, hourly, daily, monthly, yearly
  var MODE_TO_TRAFFIC_KEY = {
    'fiveminutes': 'fiveminute',
    'hourly': 'hour',
    'daily': 'day',
    'monthly': 'month',
    'yearly': 'year'
  };

  // vnstat CLI mode letter for --json
  var TIER_TO_CLI_MODE = {
    'fiveminutes': 'f',
    'hourly': 'h',
    'daily': 'd',
    'monthly': 'm',
    'yearly': 'y'
  };

  // Duration in seconds for each tier (used for avg rate calc)
  var TIER_DURATION = {
    'fiveminutes': 300,
    'hourly': 3600,
    'daily': 86400,
    'monthly': 2592000,
    'yearly': 31536000
  };

  function init(deps) {
    _state = deps.state;
    _ensureHistory = deps.ensureHistory;
    _renderChart = deps.renderChart;
  }

  function loadVnstatData() {
    if (typeof cockpit === 'undefined') return;
    cockpit.spawn(['which', 'vnstat'], { err: 'ignore' })
      .then(function () {
        vnstatAvailable = true;
        var tiers = ['fiveminutes', 'hourly', 'daily', 'monthly', 'yearly'];
        for (var i = 0; i < tiers.length; i++) {
          (function (tier) {
            var mode = TIER_TO_CLI_MODE[tier];
            cockpit.spawn(['vnstat', '--json', mode], { err: 'ignore' })
              .then(function (out) {
                try { ingestVnstatJson(JSON.parse(out), tier); } catch(e) { console.error('vnstat parse error (' + tier + '):', e); }
              })
              .catch(function () {});
          })(tiers[i]);
        }
      })
      .catch(function () { vnstatAvailable = false; });
  }

  function ingestVnstatJson(data, tierName) {
    if (!data || !data.interfaces) return;
    var trafficKey = MODE_TO_TRAFFIC_KEY[tierName];
    if (!trafficKey) return;
    var durationSec = TIER_DURATION[tierName] || 3600;
    var now = Date.now();

    for (var ii = 0; ii < data.interfaces.length; ii++) {
      var iface = data.interfaces[ii];
      var name = iface.name || iface.interface || '';
      if (!name) continue;
      var traffic = iface.traffic && iface.traffic[trafficKey];
      if (!traffic || traffic.length === 0) continue;

      var h = _ensureHistory(name);

      // Store raw vnstat records for table display
      if (!h.vnstat) h.vnstat = {};
      h.vnstat[tierName] = [];

      var tier = h[tierName];
      if (!tier) continue;
      tier.ts.length = 0;
      tier.txSpeed.length = 0;
      tier.rxSpeed.length = 0;
      tier.txBytes.length = 0;
      tier.rxBytes.length = 0;

      for (var ri = 0; ri < traffic.length; ri++) {
        var rec = traffic[ri];
        var ts = parseVnstatTimestamp(rec, tierName);
        if (ts === null) continue;

        var rxB = rec.rx || 0;
        var txB = rec.tx || 0;

        // Store for table
        h.vnstat[tierName].push({
          ts: ts,
          tx: txB,
          rx: rxB,
          txp: rec.txp || 0,
          rxp: rec.rxp || 0
        });

        // Store for chart
        tier.ts.push(ts);
        tier.txBytes.push(txB);
        tier.rxBytes.push(rxB);
        tier.txSpeed.push(txB / durationSec);
        tier.rxSpeed.push(rxB / durationSec);
      }
    }

    if (_state && _state.chartDatasets) _renderChart();
  }

  function parseVnstatTimestamp(rec, tierName) {
    if (!rec.date) return null;
    var d = rec.date;
    var t = rec.time || {};

    if (tierName === 'fiveminutes') {
      return new Date(d.year, d.month - 1, d.day, t.hour || 0, t.minutes || t.minute || 0).getTime();
    }
    if (tierName === 'hourly') {
      return new Date(d.year, d.month - 1, d.day, t.hour || 0).getTime();
    }
    if (tierName === 'daily') {
      return new Date(d.year, d.month - 1, d.day).getTime();
    }
    if (tierName === 'monthly') {
      return new Date(d.year, d.month - 1, 1).getTime();
    }
    if (tierName === 'yearly') {
      return new Date(d.year, 0, 1).getTime();
    }
    return null;
  }

  window.Vnstat = {
    init: init,
    loadVnstatData: loadVnstatData,
    ingestVnstatJson: ingestVnstatJson,
    isAvailable: function () { return vnstatAvailable; },
    MODE_TO_TRAFFIC_KEY: MODE_TO_TRAFFIC_KEY,
    TIER_DURATION: TIER_DURATION
  };
})();
