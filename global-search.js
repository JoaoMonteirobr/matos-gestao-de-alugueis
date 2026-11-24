(function () {
  'use strict';

  // Busca somente em tabelas com RLS usando o JWT da sessão atual.
  // Nenhum dado é persistido no navegador, enviado à telemetria ou exposto sem login.
  var SOURCES = [
    { table: 'imoveis', fields: 'id,nome,tipo,endereco,numero,complemento,bairro,cidade,status,inquilino_id,created_at' },
    { table: 'inquilinos', fields: 'id,nome,cpf_cnpj,telefone,email,status,created_at' },
    { table: 'cobrancas', fields: 'id,contrato_id,imovel_id,inquilino_id,competencia,vencimento,aluguel,outros_encargos,valor_pago,data_pagamento,status,created_at' },
    { table: 'contratos', fields: 'id,imovel_id,inquilino_id,data_inicio,data_fim,aluguel_atual,status,created_at' },
    { table: 'manutencoes', fields: 'id,imovel_id,inquilino_id,categoria,descricao,prioridade,status,data_abertura,created_at' },
  ];
  var TYPES = [
    { kind: 'todos', label: 'Todos' },
    { kind: 'imoveis', label: 'Imóveis' },
    { kind: 'inquilinos', label: 'Inquilinos' },
    { kind: 'cobrancas', label: 'Pagamentos' },
    { kind: 'contratos', label: 'Contratos' },
    { kind: 'manutencoes', label: 'Chamados' },
  ];
  var TTL_MS = 120000;
  var records = [];
  var indexedFor = '';
  var indexedAt = 0;
  var loadingFor = '';
  var pending = null;
  var overlay = null;
  var filtered = [];
  var detailItem = null;
  var currentQuery = '';
  var selectedType = 'todos';
  var searchTimer = null;
  var searchGeneration = 0;
  var keyboardBound = false;

  function safe(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function normalize(value) {
    return window.MatosSearchCore.normalize(value);
  }
  function shortText(value, max) {
    var str = String(value || '').trim();
    return str.length > max ? str.slice(0, max - 1) + '…' : str;
  }
  function brDate(value) {
    var text = String(value || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '—';
    return text.slice(8, 10) + '/' + text.slice(5, 7) + '/' + text.slice(0, 4);
  }
  function brMoney(value) {
    return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }
  function monthLabel(date) {
    var parts = String(date || '').slice(0, 7).split('-');
    var months = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    var month = Number(parts[1]);
    return /^\d{4}$/.test(parts[0]) && month >= 1 && month <= 12
      ? months[month - 1] + '/' + parts[0] : 'Sem competência';
  }
  function propertyLabel(row) {
    if (!row) return 'Imóvel não identificado';
    return row.nome || [row.endereco, row.numero, row.complemento].filter(Boolean).join(', ') || 'Imóvel';
  }
  function textFor(kind, pieces) {
    return normalize([kind].concat(pieces).filter(Boolean).join(' '));
  }
  function entry(kind, row, title, subtitle, status, fields, terms) {
    return {
      key: kind + ':' + row.id,
      kind: kind,
      id: row.id,
      title: title,
      subtitle: subtitle,
      status: status || '',
      details: fields,
      searchText: textFor(kind, [title, subtitle, status, row.id].concat(terms || [])),
      period: String(row.competencia || row.vencimento || '').slice(0, 7),
    };
  }
  function buildIndex(data) {
    var properties = data.imoveis || [];
    var tenants = data.inquilinos || [];
    var contracts = data.contratos || [];
    // Índices tipados e associações em tempo linear; sem consultas extras ao banco.
    var linkedRecords = window.MatosSearchCore.linkCatalog(data);
    var cById = linkedRecords.contractsById;
    var byProperty = function (id) { return linkedRecords.propertiesById.get(id); };
    var byTenant = function (id) { return linkedRecords.tenantsById.get(id); };
    var result = [];

    properties.forEach(function (p) {
      var label = propertyLabel(p);
      var address = [p.endereco, p.numero, p.complemento, p.bairro].filter(Boolean).join(', ');
      var resident = byTenant(p.inquilino_id);
      result.push(entry('imoveis', p, label, address || p.tipo || 'Imóvel', p.status, [
        ['Endereço', address || 'Não informado'], ['Tipo', p.tipo || '—'],
        ['Inquilino', resident && resident.nome || '—'], ['Situação', p.status || '—'],
      ], [p.tipo, p.cidade, resident && resident.nome]));
    });
    tenants.forEach(function (t) {
      var home = linkedRecords.homeForTenant(t.id);
      var property = home && propertyLabel(home) || 'Sem imóvel vinculado';
      result.push(entry('inquilinos', t, t.nome || 'Inquilino', property, t.status, [
        ['Nome', t.nome || '—'], ['Imóvel', property], ['Situação', t.status || '—'],
      ], [t.telefone, t.email, t.cpf_cnpj, property, home && [home.endereco, home.numero, home.bairro].join(' ')]));
    });
    contracts.forEach(function (c) {
      var p = byProperty(c.imovel_id), t = byTenant(c.inquilino_id);
      var place = propertyLabel(p);
      var person = t && t.nome || 'Inquilino não identificado';
      var period = brDate(c.data_inicio) + ' a ' + brDate(c.data_fim);
      result.push(entry('contratos', c, 'Contrato · ' + place, person + ' · ' + period, c.status, [
        ['Imóvel', place], ['Inquilino', person], ['Início', brDate(c.data_inicio)],
        ['Término', brDate(c.data_fim)], ['Aluguel atual', brMoney(c.aluguel_atual)],
        ['Situação', c.status || '—'],
      ], [place, person, c.data_inicio, c.data_fim, brMoney(c.aluguel_atual), 'locação', p && [p.endereco, p.numero, p.bairro].join(' ')]));
    });
    (data.cobrancas || []).forEach(function (pay) {
      var ct = cById.get(pay.contrato_id);
      var p = byProperty(pay.imovel_id || ct && ct.imovel_id);
      var t = byTenant(pay.inquilino_id || ct && ct.inquilino_id);
      var place = propertyLabel(p);
      var person = t && t.nome || 'Inquilino não identificado';
      var period = monthLabel(pay.competencia || pay.vencimento);
      var paid = Number(pay.valor_pago || 0);
      var total = Number(pay.aluguel || 0) + Number(pay.outros_encargos || 0);
      var situation = pay.status || (paid >= total && total > 0 ? 'pago' : 'pendente');
      var title = 'Pagamento · ' + period;
      result.push(entry('cobrancas', pay, title, person + ' · ' + place, situation, [
        ['Competência', period], ['Inquilino', person], ['Imóvel', place],
        ['Vencimento', brDate(pay.vencimento)], ['Previsto', brMoney(total)],
        ['Recebido', brMoney(paid)], ['Situação', situation],
      ], [person, place, pay.competencia, pay.vencimento, brDate(pay.vencimento), pay.data_pagamento,
        brMoney(total), brMoney(paid), String(total), String(paid), 'aluguel', 'recebimento', p && [p.endereco, p.numero, p.bairro].join(' ')]));
    });
    (data.manutencoes || []).forEach(function (call) {
      var p = byProperty(call.imovel_id), t = byTenant(call.inquilino_id);
      var place = propertyLabel(p);
      var person = t && t.nome || '—';
      var category = call.categoria || 'Manutenção';
      result.push(entry('manutencoes', call, 'Chamado · ' + category,
        shortText(call.descricao, 110) + ' · ' + place, call.status, [
          ['Categoria', category], ['Descrição', call.descricao || '—'],
          ['Imóvel', place], ['Inquilino', person], ['Abertura', brDate(call.data_abertura)],
          ['Prioridade', call.prioridade || '—'], ['Situação', call.status || '—'],
        ], [call.descricao, call.prioridade, call.data_abertura, place, person, 'solicitação', 'reparo', p && [p.endereco, p.numero, p.bairro].join(' ')]));
    });
    return result;
  }
  // A regra de ordenação e filtros é compilada do TypeScript.
  function searchIndex(items, query, kind, limit) {
    return window.MatosSearchCore.searchIndex(items, query, kind, limit);
  }
  function canSearch() {
    return !!(session && session.user && session.access_token &&
      ['admin', 'proprietario', 'proprietario_consulta'].includes(currentRole));
  }
  function identity() {
    return canSearch() ? {
      id: session.user.id,
      token: session.access_token,
      key: session.user.id + '|' + session.access_token,
    } : null;
  }
  function clearIndex() {
    records = [];
    indexedFor = '';
    indexedAt = 0;
    loadingFor = '';
    pending = null;
    searchGeneration++;
    close();
  }
  async function fetchCategory(source, token) {
    var rows = [];
    for (var offset = 0; offset < 5000; offset += 500) {
      var url = '/rest/v1/' + source.table + '?select=' + source.fields +
        '&order=created_at.desc,id.desc&limit=500&offset=' + offset;
      var batch = await request(url, { headers: authHeaders(token) });
      if (!Array.isArray(batch)) throw new Error('Resposta inesperada ao consultar ' + source.table);
      rows.push.apply(rows, batch);
      if (batch.length < 500) break;
    }
    return rows;
  }
  function ensureIndex(who) {
    if (indexedFor === who.key && Date.now() - indexedAt < TTL_MS) return Promise.resolve(records);
    if (pending && loadingFor === who.key) return pending;
    loadingFor = who.key;
    pending = Promise.all(SOURCES.map(function (s) { return fetchCategory(s, who.token); }))
      .then(function (lists) {
        var current = identity();
        if (!current || current.key !== who.key) throw new Error('Sessão alterada durante a pesquisa.');
        var data = {};
        SOURCES.forEach(function (source, i) { data[source.table] = lists[i]; });
        var index = buildIndex(data);
        if (loadingFor === who.key) {
          records = index;
          indexedFor = who.key;
          indexedAt = Date.now();
        }
        return index;
      }).finally(function () {
        if (loadingFor === who.key) {
          pending = null;
          loadingFor = '';
        }
      });
    return pending;
  }
  function label(kind) {
    var choice = TYPES.find(function (x) { return x.kind === kind; });
    return choice ? choice.label : 'Registro';
  }
  function permittedSection(item) {
    var candidates = {
      imoveis: ['Cadastros', 'Imóveis'],
      inquilinos: ['Inquilinos'],
      cobrancas: ['Pagamentos', 'Cobranças'],
      contratos: ['Contratos'],
      manutencoes: ['Chamados', 'Manutenção'],
    }[item.kind] || [];
    var visible = Array.prototype.map.call(document.querySelectorAll('.side [data-page]'), function (button) {
      return button.getAttribute('data-page');
    });
    return candidates.concat(['Relatórios', 'Dashboard']).find(function (x) { return visible.includes(x); }) || null;
  }
  function root() { return document.getElementById('matos_global_search'); }
  function close() {
    clearTimeout(searchTimer);
    searchGeneration++;
    var existing = root();
    if (existing) existing.remove();
    overlay = null;
    filtered = [];
    detailItem = null;
    var header = document.getElementById('matos_global_header');
    if (header) header.value = '';
    document.body.classList.remove('matos-search-open');
  }
  function showHint(message) {
    var panel = document.getElementById('matos_search_content');
    if (panel) panel.innerHTML = '<div class="matos-search-state" role="status">' + safe(message) + '</div>';
  }
  function renderResults() {
    var panel = document.getElementById('matos_search_content');
    var filterBar = document.getElementById('matos_search_filters');
    if (!panel || !filterBar) return;
    filterBar.innerHTML = TYPES.map(function (x) {
      return '<button type="button" class="matos-search-filter' + (x.kind === selectedType ? ' active' : '') +
        '" data-search-type="' + x.kind + '" aria-pressed="' + (x.kind === selectedType) + '">' + safe(x.label) + '</button>';
    }).join('');
    detailItem = null;
    filtered = searchIndex(records, currentQuery, selectedType, 30);
    if (!filtered.length) {
      showHint('Nenhum registro encontrado. Confira o nome, endereço, competência ou situação.');
      return;
    }
    panel.innerHTML = '<p class="matos-search-count" role="status">' + filtered.length +
      (filtered.length === 30 ? ' primeiros resultados' : ' resultado(s)') +
      ' · selecione um registro para ver os detalhes</p><div class="matos-search-results">' +
      filtered.map(function (item, i) {
        return '<button type="button" class="matos-search-result" data-search-position="' + i +
          '"><span class="matos-search-kind">' + safe(label(item.kind)) +
          '</span><strong>' + safe(item.title) + '</strong><small>' + safe(item.subtitle) +
          '</small>' + (item.status ? '<span class="matos-search-status">' + safe(item.status) + '</span>' : '') +
          '</button>';
      }).join('') + '</div>';
  }
  function renderDetail(item) {
    detailItem = item;
    var panel = document.getElementById('matos_search_content');
    if (!panel) return;
    var target = permittedSection(item);
    panel.innerHTML = '<div class="matos-search-detail"><button class="matos-search-back" type="button" data-search-back="1">← Resultados</button>' +
      '<span class="matos-search-kind">' + safe(label(item.kind)) + '</span><h3>' + safe(item.title) + '</h3>' +
      '<p>' + safe(item.subtitle) + '</p><dl>' + item.details.map(function (pair) {
        return '<div><dt>' + safe(pair[0]) + '</dt><dd>' + safe(pair[1]) + '</dd></div>';
      }).join('') + '</dl>' + (target ? '<button type="button" class="matos-search-go" data-search-go="' +
      safe(target) + '">Abrir ' + safe(target) + '</button>' : '') + '</div>';
    var back = panel.querySelector('[data-search-back]');
    if (back) back.focus();
  }
  function navigate(section) {
    if (!canSearch()) return close();
    var available = Array.prototype.some.call(document.querySelectorAll('.side [data-page]'), function (btn) {
      return btn.getAttribute('data-page') === section;
    });
    if (!available) return;
    var item = detailItem;
    if (!item || permittedSection(item) !== section) return;
    if (item && item.period && /^\d{4}-\d{2}$/.test(item.period)) {
      if (section === 'Pagamentos') window._simpleMonth = item.period;
      if (section === 'Relatórios') window._reportMonth = item.period;
    }
    close();
    goQuick(section);
  }
  function executeSearch() {
    var modal = root();
    if (!modal) return;
    var input = document.getElementById('matos_search_input');
    currentQuery = input ? input.value.trim().slice(0, 100) : '';
    var generation = ++searchGeneration;
    if (normalize(currentQuery).length < 2) {
      showHint('Digite pelo menos 2 caracteres. Pesquise por nome, endereço, contrato, mês ou valor.');
      return;
    }
    showHint('Buscando registros do seu acesso…');
    var who = identity();
    if (!who) return close();
    ensureIndex(who).then(function () {
      if (generation !== searchGeneration || !root() || !identity() || identity().key !== who.key) return;
      renderResults();
    }).catch(function () {
      if (generation !== searchGeneration || !root()) return;
      showHint('Não foi possível consultar os registros. Verifique sua conexão e tente novamente.');
    });
  }
  function scheduleSearch() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(executeSearch, 180);
  }
  function open(value) {
    if (!canSearch()) return;
    if (root()) {
      var existingInput = document.getElementById('matos_search_input');
      if (existingInput && typeof value === 'string') {
        existingInput.value = value;
        executeSearch();
      }
      if (existingInput) existingInput.focus();
      return;
    }
    overlay = document.createElement('div');
    overlay.id = 'matos_global_search';
    overlay.className = 'matos-search-overlay';
    overlay.innerHTML = '<div class="matos-search-dialog" role="dialog" aria-modal="true" aria-labelledby="matos_search_title">' +
      '<div class="matos-search-head"><div><h2 id="matos_search_title">Busca global</h2><p>Imóveis, inquilinos, pagamentos, contratos e chamados</p></div>' +
      '<button type="button" class="matos-search-close" data-search-close="1" aria-label="Fechar busca">×</button></div>' +
      '<div class="matos-search-input-wrap"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></svg>' +
      '<input id="matos_search_input" type="search" aria-label="Pesquisar registros" autocomplete="off" maxlength="100" ' +
      'placeholder="Ex.: Coronel Brandão, Maria, 11/2026, hidráulica">' +
      '<kbd>ESC</kbd></div><div id="matos_search_filters" class="matos-search-filters" aria-label="Tipos de registro"></div>' +
      '<div id="matos_search_content" class="matos-search-content" aria-live="polite"></div>' +
      '<div class="matos-search-foot"><span>Use ↑ ↓ para navegar e Enter para selecionar</span><span>Somente registros autorizados</span></div>' +
      '</div>';
    document.body.appendChild(overlay);
    document.body.classList.add('matos-search-open');
    var input = document.getElementById('matos_search_input');
    selectedType = 'todos';
    currentQuery = '';
    input.value = String(value || '').slice(0, 100);
    input.addEventListener('input', scheduleSearch);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') {
        var first = overlay.querySelector('.matos-search-result');
        if (first) { e.preventDefault(); first.focus(); }
      }
    });
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay || e.target.closest('[data-search-close]')) return close();
      var filter = e.target.closest('[data-search-type]');
      if (filter) { selectedType = filter.getAttribute('data-search-type'); return executeSearch(); }
      var result = e.target.closest('[data-search-position]');
      if (result) {
        var found = filtered[Number(result.getAttribute('data-search-position'))];
        if (found) renderDetail(found);
        return;
      }
      if (e.target.closest('[data-search-back]')) return renderResults();
      var go = e.target.closest('[data-search-go]');
      if (go) return navigate(go.getAttribute('data-search-go'));
    });
    overlay.addEventListener('keydown', function (e) {
      var buttons = Array.prototype.slice.call(overlay.querySelectorAll('.matos-search-result'));
      var index = buttons.indexOf(document.activeElement);
      if (index >= 0 && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        buttons[(index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus();
      }
      if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    var filters = document.getElementById('matos_search_filters');
    filters.innerHTML = TYPES.map(function (x) {
      return '<button type="button" class="matos-search-filter' + (x.kind === selectedType ? ' active' : '') +
        '" data-search-type="' + x.kind + '" aria-pressed="' + (x.kind === selectedType) + '">' + safe(x.label) + '</button>';
    }).join('');
    input.focus();
    if (input.value.trim()) executeSearch();
    else showHint('Digite pelo menos 2 caracteres. Pesquise por nome, endereço, contrato, mês ou valor.');
  }
  function bindHeader() {
    if (!canSearch()) return;
    var bar = document.querySelector('.appbar');
    if (!bar) return;
    var desktop = bar.querySelector('.app-search input');
    if (desktop) {
      desktop.id = 'matos_global_header';
      desktop.type = 'search';
      desktop.setAttribute('aria-label', 'Abrir busca global');
      desktop.setAttribute('autocomplete', 'off');
      desktop.placeholder = 'Buscar imóvel, inquilino, pagamento, contrato ou chamado…';
      desktop.addEventListener('focus', function () { open(desktop.value); });
      desktop.addEventListener('input', function () { open(desktop.value); });
      desktop.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); open(desktop.value); }
      });
    }
    if (!document.getElementById('matos_global_mobile')) {
      var button = document.createElement('button');
      button.id = 'matos_global_mobile';
      button.className = 'matos-search-mobile';
      button.type = 'button';
      button.setAttribute('aria-label', 'Abrir busca global');
      button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></svg>';
      button.addEventListener('click', function () { open(''); });
      var tools = bar.querySelector('.appbar-tools') || bar.querySelector('.user');
      bar.insertBefore(button, tools || null);
    }
    if (!keyboardBound) {
      document.addEventListener('keydown', function (e) {
        if (e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey) && !e.altKey && canSearch()) {
          e.preventDefault();
          open('');
        } else if (e.key === 'Escape' && root()) {
          e.preventDefault();
          close();
        }
      });
      keyboardBound = true;
    }
  }
  var previousShell = window.shell || shell;
  shell = function () {
    close();
    var outcome = previousShell.apply(this, arguments);
    bindHeader();
    return outcome;
  };
  window.shell = shell;
  var previousSave = window.saveSession || saveSession;
  saveSession = function (nextSession) {
    var oldIdentity = identity();
    var result = previousSave.apply(this, arguments);
    var newIdentity = identity();
    if (!nextSession || !oldIdentity || !newIdentity || oldIdentity.key !== newIdentity.key) clearIndex();
    return result;
  };
  window.saveSession = saveSession;
  window.MatosGlobalSearch = {
    normalize: normalize,
    buildIndex: buildIndex,
    searchIndex: searchIndex,
    clearIndex: clearIndex,
    open: open,
    close: close,
  };
  setTimeout(bindHeader, 0);
})();