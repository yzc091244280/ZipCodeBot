/**
 * 邮编查询核心逻辑
 * 数据查找、API 调用、UI 渲染
 */
var ZipApp = (function() {
  var DEFAULT_DATA = null;
  var data = null;
  var locCache = {};

  var STATES_CN = {
    'AL':'阿拉巴马','AK':'阿拉斯加','AZ':'亚利桑那','AR':'阿肯色','CA':'加利福尼亚','CO':'科罗拉多','CT':'康涅狄格','DE':'特拉华','FL':'佛罗里达','GA':'佐治亚','HI':'夏威夷','ID':'爱达荷','IL':'伊利诺伊','IN':'印第安纳','IA':'爱荷华','KS':'堪萨斯','KY':'肯塔基','LA':'路易斯安那','ME':'缅因','MD':'马里兰','MA':'马萨诸塞','MI':'密歇根','MN':'明尼苏达','MS':'密西西比','MO':'密苏里','MT':'蒙大拿','NE':'内布拉斯加','NV':'内华达','NH':'新罕布什尔','NJ':'新泽西','NM':'新墨西哥','NY':'纽约','NC':'北卡罗来纳','ND':'北达科他','OH':'俄亥俄','OK':'俄克拉荷马','OR':'俄勒冈','PA':'宾夕法尼亚','RI':'罗德岛','SC':'南卡罗来纳','SD':'南达科他','TN':'田纳西','TX':'得克萨斯','UT':'犹他','VT':'佛蒙特','VA':'弗吉尼亚','WA':'华盛顿','WV':'西弗吉尼亚','WI':'威斯康星','WY':'怀俄明','DC':'华盛顿特区','PR':'波多黎各'
  };

  // ── Data ──
  function init() {
    DEFAULT_DATA = JSON.parse(JSON.stringify(ZIP_DATA));
    var saved = localStorage.getItem('zipbot_data');
    if (saved) {
      try {
        var obj = JSON.parse(saved);
        if (obj && obj.pz && obj.dz3) {
          data = obj;
          updateBar(localStorage.getItem('zipbot_name') || '上传的文件', true);
          showRestore(true);
          return;
        }
      } catch(e) {}
    }
    data = DEFAULT_DATA;
    updateBar('内置数据', false);
  }

  function get() { return data; }
  function getDefault() { return DEFAULT_DATA; }

  function setCustom(compact, filename) {
    data = compact;
    try {
      localStorage.setItem('zipbot_data', JSON.stringify(compact));
      localStorage.setItem('zipbot_name', filename);
    } catch(e) {}
    updateBar(filename, true);
    showRestore(true);
  }

  function restore() {
    data = JSON.parse(JSON.stringify(DEFAULT_DATA));
    localStorage.removeItem('zipbot_data');
    localStorage.removeItem('zipbot_name');
    updateBar('内置数据', false);
    showRestore(false);
  }

  function showRestore(show) {
    var btn = document.getElementById('restore-btn');
    if (btn) btn.style.display = show ? '' : 'none';
  }

  function updateBar(name, isCustom) {
    var bar = document.getElementById('data-bar');
    var fname = document.getElementById('data-fname');
    var tag = document.getElementById('data-tag');
    if (!bar) return;
    bar.style.display = 'flex';
    fname.textContent = name;
    tag.className = 'tag ' + (isCustom ? 'tag-custom' : 'tag-default');
    tag.textContent = isCustom ? '自定义' : '默认';
  }

  // ── Lookup ──
  function parseZips(text) {
    return text.replace(/[,\n\r;，、]/g, ' ').split(/\s+/).filter(function(z) { return z && /^\d{3,5}$/.test(z); });
  }

  function findGate(zip) {
    var pz = data.pz;
    for (var gate in pz) { if (pz[gate].indexOf(zip) !== -1) return gate; }
    return null;
  }

  function findDestZones(zip) {
    if (data.dx && data.dx[zip]) return data.dx[zip];
    var p3 = zip.substring(0, 3);
    return data.dz3[p3] || null;
  }

  function parseZoneList(zones) {
    if (!zones) return [];
    var result = [];
    for (var port in zones) {
      var z = zones[port];
      if (z && z !== '-') result.push({ port: port, zone: z, num: parseInt(z.replace('Zone ', '')) || 99 });
    }
    result.sort(function(a, b) { return a.num - b.num; });
    return result;
  }

  async function lookupLocation(zip) {
    if (locCache[zip]) return locCache[zip];
    try {
      var resp = await fetch('https://api.zippopotam.us/us/' + zip);
      if (!resp.ok) return null;
      var d = await resp.json();
      var p = d.places && d.places[0];
      if (!p) return null;
      var state = p['state abbreviation'];
      var loc = { city: p['place name'], state: state, stateFull: p.state, stateCn: STATES_CN[state] || '' };
      locCache[zip] = loc;
      return loc;
    } catch(e) { return null; }
  }

  function locText(loc) {
    return loc ? (loc.city + ', ' + loc.state + (loc.stateCn ? ' (' + loc.stateCn + ')' : '')) : '-';
  }

  function badge(text, cls) { return '<span class="zone-badge ' + cls + '">' + text + '</span>'; }

  // ── Renderers ──
  async function query(originText, destText) {
    var origins = parseZips(originText);
    var dests = parseZips(destText);
    if (!origins.length && !dests.length) return '';

    if (origins.length && dests.length) return await renderRoutes(origins, dests);
    if (origins.length) return await renderOrigins(origins);
    return await renderDests(dests);
  }

  async function renderOrigins(zips) {
    var locs = await Promise.all(zips.map(function(z) { return lookupLocation(z); }));
    var h = '<div class="card"><div class="result-title">发货邮编查询</div>';
    if (zips.length === 1) {
      var zip = zips[0], loc = locs[0], gate = findGate(zip);
      h += infoRow('邮编', zip);
      h += infoRow('位置', locText(loc));
      h += infoRow('注入口岸', gate ? badge(gate, 'zone-port') : '<span style="color:var(--warn)">未匹配</span>');
      h += infoRow('揽收范围', gate ? badge('在揽收范围内', 'zone-ok') : badge('需确认', 'zone-warn'));
      if (!gate) {
        var parsed = parseZoneList(findDestZones(zip));
        if (parsed.length) h += '<div style="margin-top:10px;padding:10px;background:#fefce8;border-radius:8px;font-size:13px"><div style="font-weight:700;color:#92400e">按邮编前3位估算</div><div style="margin-top:4px;color:#78350f">该区域距 <b>' + parsed[0].port + '</b> 口岸最近（' + parsed[0].zone + '）</div></div>';
      }
    } else {
      h += '<table class="port-table"><thead><tr><th>邮编</th><th>位置</th><th>口岸</th><th>状态</th></tr></thead><tbody>';
      for (var i = 0; i < zips.length; i++) {
        var g = findGate(zips[i]);
        h += '<tr><td style="font-weight:800">' + zips[i] + '</td><td style="font-size:12px">' + (locs[i] ? locs[i].city + ', ' + locs[i].state : '-') + '</td><td>' + (g ? badge(g, 'zone-port') : '-') + '</td><td>' + (g ? badge('OK', 'zone-ok') : badge('?', 'zone-warn')) + '</td></tr>';
      }
      h += '</tbody></table>';
    }
    return h + '</div>';
  }

  async function renderDests(zips) {
    var locs = await Promise.all(zips.map(function(z) { return lookupLocation(z); }));
    var h = '<div class="card"><div class="result-title">收货邮编查询</div>';
    for (var i = 0; i < zips.length; i++) {
      var zip = zips[i], parsed = parseZoneList(findDestZones(zip)), best = parsed.length ? parsed[0] : null, uid = 'bd-' + i;
      h += '<div class="batch-row" onclick="ZipApp.toggle(\'' + uid + '\')"><span class="batch-zip">' + zip + '</span><div class="batch-info"><div class="batch-city">' + locText(locs[i]) + '</div>';
      h += best ? '<div class="batch-best">' + badge(best.port, 'zone-port') + ' <span class="batch-zone" style="color:var(--ok)">' + best.zone + '</span></div>' : '<div class="batch-best" style="color:var(--muted)">未找到分区数据</div>';
      h += '</div>' + (parsed.length > 1 ? '<span style="color:#cbd5e1;font-size:12px">&#9662;</span>' : '') + '</div>';
      h += '<div class="batch-detail" id="' + uid + '">';
      if (best) h += '<div class="best-card" style="margin:0 0 8px"><div class="best-label">推荐发货口岸</div><div class="best-value">' + best.port + '</div><div class="best-note">从 ' + best.port + ' 发货是 ' + best.zone + '，Zone 最低</div></div>';
      if (parsed.length > 1) h += portTable(parsed, function(p, j) { return j === 0 ? badge('推荐', 'zone-ok') : ''; });
      h += '</div>';
    }
    return h + '</div>';
  }

  async function renderRoutes(origins, dests) {
    var oLocs = await Promise.all(origins.map(function(z) { return lookupLocation(z); }));
    var oGates = origins.map(function(z) { return findGate(z); });

    if (origins.length === 1 && dests.length === 1) return renderSingleRoute(origins[0], dests[0], oGates[0], oLocs[0]);

    var h = '<div class="card"><div class="result-title">线路查询</div>';
    for (var i = 0; i < origins.length; i++) h += infoRow('发货 ' + origins[i], (oLocs[i] ? oLocs[i].city + ', ' + oLocs[i].state : '-') + ' ' + (oGates[i] ? badge(oGates[i], 'zone-port') : '<span style="color:var(--warn)">未匹配</span>'));

    var dLocs = await Promise.all(dests.map(function(z) { return lookupLocation(z); }));
    h += '<div style="margin-top:8px">';
    for (var di = 0; di < dests.length; di++) {
      var dz = dests[di], dzMap = findDestZones(dz), parsed = parseZoneList(dzMap), uid = 'br-' + di;
      var mg = oGates.find(function(g) { return g && dzMap && dzMap[g] && dzMap[g] !== '-'; });
      h += '<div class="batch-row" onclick="ZipApp.toggle(\'' + uid + '\')"><span class="batch-zip">' + dz + '</span><div class="batch-info"><div class="batch-city">' + locText(dLocs[di]) + '</div>';
      h += parsed.length ? (mg ? '<div class="batch-best">' + badge(mg, 'zone-port') + ' <span class="batch-zone">' + dzMap[mg] + '</span></div>' : '<div class="batch-best">' + badge(parsed[0].port, 'zone-port') + ' <span class="batch-zone" style="color:var(--ok)">' + parsed[0].zone + '</span></div>') : '<div class="batch-best" style="color:var(--muted)">未找到分区</div>';
      h += '</div>' + (parsed.length > 1 ? '<span style="color:#cbd5e1;font-size:12px">&#9662;</span>' : '') + '</div>';
      h += '<div class="batch-detail" id="' + uid + '">';
      if (parsed.length) h += portTable(parsed, function(p, j) {
        var isO = oGates.indexOf(p.port) !== -1;
        return isO ? badge('当前', 'zone-port') : (j === 0 ? badge('最低', 'zone-ok') : '');
      }, function(p, j) {
        return oGates.indexOf(p.port) !== -1 ? 'is-best' : '';
      });
      h += '</div>';
    }
    return h + '</div></div>';
  }

  function renderSingleRoute(oz, dz, gate, oLoc) {
    var h = '<div class="card"><div class="result-title">线路查询</div>';
    h += '<div class="route-box"><div class="route-side"><div class="route-label">发货地</div><div class="route-zip">' + oz + '</div><div class="route-city">' + (oLoc ? oLoc.city : '-') + (gate ? ' (' + gate + ')' : '') + '</div></div><div class="route-arrow">→</div><div class="route-side"><div class="route-label">收货地</div><div class="route-zip">' + dz + '</div><div class="route-city">-</div></div></div>';

    // Async: caller should await lookupLocation for dest, but we keep sync here for simplicity
    // Actually let's just return the card start and let the caller handle it
    return h;
  }

  async function fullSingleRoute(oz, dz) {
    var gate = findGate(oz), oLoc = await lookupLocation(oz), dLoc = await lookupLocation(dz);
    var dzMap = findDestZones(dz), parsed = parseZoneList(dzMap);

    var h = '<div class="card"><div class="result-title">线路查询</div>';
    h += '<div class="route-box"><div class="route-side"><div class="route-label">发货地</div><div class="route-zip">' + oz + '</div><div class="route-city">' + (oLoc ? oLoc.city : '-') + (gate ? ' (' + gate + ')' : '') + '</div></div><div class="route-arrow">→</div><div class="route-side"><div class="route-label">收货地</div><div class="route-zip">' + dz + '</div><div class="route-city">' + (dLoc ? dLoc.city : '-') + '</div></div></div>';

    if (!gate) {
      h += '<div style="padding:12px;background:#fef2f2;border-radius:10px;color:#991b1b;font-size:13px;text-align:center">发货邮编未匹配到口岸，无法查分区</div>';
    } else if (dzMap && dzMap[gate] && dzMap[gate] !== '-') {
      h += '<div class="zone-result"><div class="zone-route">' + gate + ' → ' + dz + '</div><div class="zone-num">' + dzMap[gate] + '</div><div class="zone-note">从 ' + gate + ' 发货的分区</div></div>';
      if (parsed.length > 1) {
        h += '<div style="margin-top:12px"><div class="section-label">各口岸分区对比</div>';
        h += portTable(parsed, function(p, i) { return p.port === gate ? badge('当前', 'zone-port') : (i === 0 ? badge('最低', 'zone-ok') : ''); }, function(p) { return p.port === gate ? 'is-best' : ''; });
        h += '<div style="font-size:11px;color:var(--muted);margin-top:6px">分区由发货口岸决定，需从对应口岸附近发货才能享受对应分区价格</div></div>';
      }
    } else if (gate) {
      h += '<div style="padding:12px;background:#fef2f2;border:1px solid #fecaca;border-radius:10px;font-size:13px;color:#991b1b">邮编 <b>' + dz + '</b> 未找到从 ' + gate + ' 出发的分区数据</div>';
    }
    return h + '</div>';
  }

  // ── Helpers ──
  function infoRow(label, value) {
    return '<div class="info-row"><span class="info-label">' + label + '</span><span class="info-value">' + value + '</span></div>';
  }

  function portTable(parsed, badgeFn, rowClassFn) {
    var h = '<table class="port-table"><thead><tr><th>口岸</th><th>分区</th><th></th></tr></thead><tbody>';
    for (var j = 0; j < parsed.length; j++) {
      var p = parsed[j], isB = j === 0;
      var rc = rowClassFn ? rowClassFn(p, j) : (isB ? 'is-best' : '');
      h += '<tr' + (rc ? ' class="' + rc + '"' : '') + '><td><b>' + p.port + '</b> ' + (badgeFn ? badgeFn(p, j) : (isB ? badge('推荐', 'zone-ok') : '')) + '</td><td>' + p.zone + '</td><td style="font-size:12px;color:var(--muted)">' + (isB ? '推荐' : '可发') + '</td></tr>';
    }
    return h + '</tbody></table>';
  }

  // Override renderRoutes to use fullSingleRoute for single
  var _renderRoutes = renderRoutes;
  renderRoutes = async function(origins, dests) {
    if (origins.length === 1 && dests.length === 1) return await fullSingleRoute(origins[0], dests[0]);
    return await _renderRoutes(origins, dests);
  };

  // ── Public API ──
  return {
    init: init,
    get: get,
    setCustom: setCustom,
    restore: restore,
    query: query,
    toggle: function(id) { var el = document.getElementById(id); if (el) el.classList.toggle('open'); }
  };
})();
