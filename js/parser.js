/**
 * Excel 报价表解析模块
 * 从 ReconBot recon_core.py 翻译而来，支持 US-Parcel (英文/中文) 和 SwiftX 格式
 */
var ZipParser = (function() {
  var KNOWN_PORTS = ['LAX','DFW','IAH','ORD','ATL','SAV','CLT','MIA','JFK','SFO','CVG','SEA','EWR'];
  var KNOWN_SET = {};
  KNOWN_PORTS.forEach(function(p) { KNOWN_SET[p] = true; });

  function safeText(v) {
    if (v === null || v === undefined) return '';
    var s = String(v).trim();
    return (s === 'undefined' || s === 'null') ? '' : s;
  }

  function normalizeZip(v) {
    var text = safeText(v);
    if (!text) return '';
    if (/^\d+(\.(0+))?$/.test(text)) text = text.split('.')[0];
    var m = text.match(/\d{5}/);
    if (m) return m[0];
    if (/^\d{1,4}$/.test(text)) return text.padStart(5, '0');
    return '';
  }

  function isZipSheet(name) {
    var t = safeText(name).toLowerCase();
    return ['邮编','zipcode','zip code','揽收','pickup'].some(function(k) { return t.indexOf(k) !== -1; });
  }

  function detectProduct(name) {
    var t = safeText(name).toLowerCase();
    if (t.indexOf('swiftx') !== -1 || t.indexOf('swift') !== -1) return 'swiftx';
    if (['us','parcel','商派','小包'].some(function(k) { return t.indexOf(k) !== -1; })) return 'us_parcel';
    return '';
  }

  // ── US-Parcel (English format) ──
  function parseUsParcel(rows) {
    var upperRows = rows.slice(0, 5).map(function(row) {
      return row.map(function(v) { return safeText(v).toUpperCase(); });
    });
    var flat = [];
    upperRows.forEach(function(r) { r.forEach(function(v) { if (v) flat.push(v); }); });
    if (flat.some(function(v) { return v.indexOf('目的地邮编') !== -1; })) {
      return parseUsParcelCn(rows);
    }

    var headerIdx = null, portIdx = null;
    for (var idx = 0; idx < Math.min(6, rows.length); idx++) {
      var vals = rows[idx].map(function(v) { return safeText(v).toUpperCase(); });
      if (vals.filter(function(v) { return KNOWN_SET[v]; }).length >= 3 && portIdx === null) portIdx = idx;
      var joined = vals.join(' ');
      if (['GATE','REGION','区域','注入口岸'].some(function(k) { return joined.indexOf(k) !== -1; }) && headerIdx === null) headerIdx = idx;
    }

    var gateCol = 1, zipCol = 2, destCol = 7, start = 3;

    if (headerIdx !== null) {
      var hv = rows[headerIdx].map(function(v) { return safeText(v).toUpperCase(); });
      for (var i = 0; i < hv.length; i++) {
        if (['GATE','REGION','区域','注入口岸','PORT'].indexOf(hv[i]) !== -1) { gateCol = i; break; }
      }
      for (var i = gateCol + 1; i < hv.length; i++) {
        if (hv[i].indexOf('ZIP') !== -1 || safeText(rows[headerIdx][i]).indexOf('邮编') !== -1) { zipCol = i; break; }
      }
      for (var i = 0; i < hv.length; i++) {
        if (i === zipCol) continue;
        var raw = safeText(rows[headerIdx][i]);
        var hasDest = ['DEST','DESTINATION','收件','目的地'].some(function(k) { return hv[i].indexOf(k) !== -1; });
        var hasZip = hv[i].indexOf('ZIP') !== -1 || raw.indexOf('邮编') !== -1;
        if ((hasDest && hasZip) || hasDest || raw.indexOf('收件邮编') !== -1) { destCol = i; break; }
      }
    }

    var portMap = [], ports = [];
    if (portIdx !== null) {
      var pv = rows[portIdx].map(function(v) { return safeText(v).toUpperCase(); });
      for (var i = 0; i < pv.length; i++) {
        if (KNOWN_SET[pv[i]]) portMap.push([i, pv[i]]);
      }
      ports = portMap.map(function(x) { return x[1]; });
      start = Math.max(portIdx, headerIdx || 0) + 1;
    } else if (rows.length > 2) {
      for (var i = 8; i < rows[2].length; i++) {
        var val = safeText(rows[2][i]).toUpperCase();
        if (val && val.length === 3 && /^[A-Z]+$/.test(val)) { ports.push(val); portMap.push([i, val]); }
      }
    }

    var pickup = {}, dest = {};
    for (var r = start; r < rows.length; r++) {
      var v = rows[r]; if (!v) continue;
      if (zipCol < v.length && v[zipCol] != null && v[zipCol] !== '') {
        var z = normalizeZip(v[zipCol]), g = gateCol < v.length ? safeText(v[gateCol]).toUpperCase() : '';
        if (z && g) pickup[z] = g;
      }
      if (destCol < v.length && v[destCol] != null && v[destCol] !== '') {
        var dz = normalizeZip(v[destCol]);
        if (dz && portMap.length) {
          var zones = {};
          for (var pi = 0; pi < portMap.length; pi++) {
            var ci = portMap[pi][0], pn = portMap[pi][1];
            if (ci < v.length && v[ci] != null && v[ci] !== '') {
              var zv = safeText(v[ci]);
              if (zv) zones[pn] = zv;
            }
          }
          if (Object.keys(zones).length) dest[dz] = zones;
        }
      }
    }
    return { pickup: pickup, dest: dest, ports: ports };
  }

  // ── US-Parcel (Chinese format) ──
  function parseUsParcelCn(rows) {
    var hIdx = null, sIdx = null;
    for (var idx = 0; idx < Math.min(10, rows.length); idx++) {
      var vals = rows[idx].map(function(v) { return safeText(v); });
      if (vals.some(function(v) { return v.indexOf('目的地邮编') !== -1; }) &&
          vals.some(function(v) { return v.indexOf('区域') !== -1; }) &&
          vals.some(function(v) { return v.indexOf('邮编') !== -1; })) {
        hIdx = idx; if (idx + 1 < rows.length) sIdx = idx + 1; break;
      }
    }
    if (hIdx === null || sIdx === null) return { pickup: {}, dest: {}, ports: [] };

    var header = rows[hIdx].map(function(v) { return safeText(v); });
    var sub = rows[sIdx].map(function(v) { return safeText(v).toUpperCase(); });

    var destCol = header.indexOf('目的地邮编');
    var gateCol = header.indexOf('区域');
    var zipCol = null;
    if (gateCol !== -1) {
      for (var i = gateCol + 1; i < header.length; i++) {
        if (header[i] === '邮编') { zipCol = i; break; }
      }
    }

    var portMap = [];
    for (var i = 0; i < sub.length; i++) {
      if (sub[i].length === 3 && /^[A-Z]+$/.test(sub[i])) portMap.push([i, sub[i]]);
    }

    var pickup = {}, dest = {};
    for (var r = sIdx + 1; r < rows.length; r++) {
      var v = rows[r]; if (!v) continue;
      if (destCol !== -1 && destCol < v.length) {
        var dz = normalizeZip(v[destCol]);
        if (dz && portMap.length) {
          var zones = {};
          for (var pi = 0; pi < portMap.length; pi++) {
            var ci = portMap[pi][0], pn = portMap[pi][1];
            if (ci < v.length && v[ci] != null && v[ci] !== '') {
              var zv = safeText(v[ci]);
              if (zv) zones[pn] = /^\d+$/.test(zv) ? 'Zone ' + zv : zv;
            }
          }
          if (Object.keys(zones).length) dest[dz] = zones;
        }
      }
      if (gateCol !== -1 && zipCol !== null && zipCol < v.length) {
        var pz = normalizeZip(v[zipCol]), pg = safeText(v[gateCol]).toUpperCase();
        if (pz && pg) pickup[pz] = pg;
      }
    }
    return { pickup: pickup, dest: dest, ports: portMap.map(function(x) { return x[1]; }) };
  }

  // ── SwiftX format ──
  function parseSwiftx(rows) {
    if (rows.length < 3) return { pickup: {}, dest: {}, ports: [] };

    var headerIdx = null, destCol = 1, zipCol = 13, gateCol = 14, start = 2;
    for (var idx = 0; idx < Math.min(5, rows.length); idx++) {
      var vals = rows[idx].map(function(v) { return safeText(v).toUpperCase(); });
      if (vals.filter(function(v) { return v; }).length >= 4 && vals.some(function(v) { return v.indexOf('ZIP') !== -1; })) {
        headerIdx = idx; break;
      }
    }

    if (headerIdx !== null) {
      var hRaw = rows[headerIdx].map(function(v) { return safeText(v); });
      var hUp = hRaw.map(function(v) { return v.toUpperCase().trim(); });

      for (var i = 0; i < hUp.length; i++) {
        var raw = hRaw[i];
        var isPickup = ['揽收','pickup','Pickup'].some(function(k) { return raw.indexOf(k) !== -1; });
        if (!isPickup && (hUp[i].indexOf('ZIP CODE') !== -1 || hUp[i].indexOf('ZIPCODE') !== -1 || hUp[i] === 'ZIP' || raw.indexOf('邮编') !== -1)) {
          destCol = i;
          if (['收件','dest','Dest','DEST'].some(function(k) { return raw.indexOf(k) !== -1; })) break;
        }
      }
      for (var i = 0; i < hUp.length; i++) {
        var raw = hRaw[i];
        if (['揽收','PICKUP','Pickup'].some(function(k) { return raw.indexOf(k) !== -1; }) && (hUp[i].indexOf('ZIP') !== -1 || raw.indexOf('邮编') !== -1)) { zipCol = i; break; }
      }
      var gCols = [];
      for (var i = 0; i < hUp.length; i++) {
        if (['GATE','REGION','区域','注入口岸','口岸'].indexOf(hUp[i]) !== -1) gCols.push(i);
      }
      if (gCols.length) gateCol = gCols.reduce(function(a, b) { return Math.abs(a - zipCol) <= Math.abs(b - zipCol) ? a : b; });
      start = headerIdx + 1;
    }

    var scan = headerIdx !== null
      ? rows[headerIdx].map(function(v) { return safeText(v).toUpperCase().trim(); })
      : (rows.length > 1 ? rows[1].map(function(v) { return safeText(v).toUpperCase().trim(); }) : []);

    var portMap = [];
    for (var i = 0; i < scan.length; i++) {
      var h = scan[i];
      if (KNOWN_SET[h] && i !== destCol) portMap.push([i, h]);
      else if (h.length === 3 && /^[A-Z]+$/.test(h) && ['THE','ZIP','SEQ','NUM'].indexOf(h) === -1 && i > destCol) portMap.push([i, h]);
    }
    portMap.sort(function(a, b) { return a[0] - b[0]; });

    var pickup = {}, dest = {};
    for (var r = start; r < rows.length; r++) {
      var v = rows[r]; if (!v) continue;
      if (destCol < v.length && v[destCol] != null && v[destCol] !== '') {
        var dz = normalizeZip(v[destCol]);
        if (dz && portMap.length) {
          var zones = {};
          for (var pi = 0; pi < portMap.length; pi++) {
            var ci = portMap[pi][0], pn = portMap[pi][1];
            if (ci < v.length && v[ci] != null && v[ci] !== '') { var zv = safeText(v[ci]); if (zv) zones[pn] = zv; }
          }
          if (Object.keys(zones).length) dest[dz] = zones;
        }
      }
      if (gateCol < v.length && zipCol < v.length && v[zipCol] != null && v[zipCol] !== '') {
        var pz = normalizeZip(v[zipCol]), pg = safeText(v[gateCol]).toUpperCase();
        if (pz && pg) pickup[pz] = pg;
      }
    }
    return { pickup: pickup, dest: dest, ports: portMap.map(function(x) { return x[1]; }) };
  }

  // ── Compact data builder ──
  function buildCompact(raw) {
    var gateZips = {};
    for (var z in raw.pickup) {
      var g = raw.pickup[z];
      if (!gateZips[g]) gateZips[g] = [];
      gateZips[g].push(z);
    }

    var prefixZones = {};
    for (var z in raw.dest) {
      var p3 = z.substring(0, 3);
      if (!prefixZones[p3]) prefixZones[p3] = raw.dest[z];
    }

    var exceptions = {};
    for (var z in raw.dest) {
      if (JSON.stringify(prefixZones[z.substring(0, 3)]) !== JSON.stringify(raw.dest[z])) {
        exceptions[z] = raw.dest[z];
      }
    }

    return { p: raw.ports, pz: gateZips, dz3: prefixZones, dx: exceptions };
  }

  // ── Public API ──
  return {
    parse: function(wb) {
      var result = {};
      wb.SheetNames.forEach(function(name) {
        if (!isZipSheet(name)) return;
        var ws = wb.Sheets[name];
        var rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        if (rows.length < 4) return;

        var product = detectProduct(name);
        var parsed;
        if (product === 'us_parcel') parsed = parseUsParcel(rows);
        else if (product === 'swiftx') parsed = parseSwiftx(rows);
        else {
          parsed = parseUsParcel(rows);
          if (!Object.keys(parsed.pickup).length && !Object.keys(parsed.dest).length) parsed = parseSwiftx(rows);
        }

        if (Object.keys(parsed.pickup).length || Object.keys(parsed.dest).length) {
          var key = product || 'us_parcel';
          result[key] = buildCompact(parsed);
        }
      });
      return result;
    },

    normalizeZip: normalizeZip,
    buildCompact: buildCompact
  };
})();
