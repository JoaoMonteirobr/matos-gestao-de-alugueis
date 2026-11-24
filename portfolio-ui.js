(function () {
  'use strict';

  // Componentes visuais de leitura. Sem consultas REST, mutações ou dados persistidos.
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function normalize(value) {
    return String(value == null ? '' : value).normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim();
  }

  function statsHTML(items, title) {
    if (!Array.isArray(items) || !items.length) return '';
    return '<div class="portfolio-stats" role="group" aria-label="' + escapeHtml(title || 'Resumo da carteira') + '">' +
      items.map(function (item) {
        var number = Number(item.value);
        var value = Number.isFinite(number) ? Math.max(0, Math.trunc(number)).toLocaleString('pt-BR') : '—';
        return '<div class="portfolio-stat"><span>' + escapeHtml(item.label) + '</span>' +
          '<strong>' + escapeHtml(value) + '</strong>' +
          (item.hint ? '<small>' + escapeHtml(item.hint) + '</small>' : '') + '</div>';
      }).join('') + '</div>';
  }

  function filterHTML(id, placeholder, noun) {
    var identifier = String(id || '').replace(/[^a-zA-Z0-9_-]/g, '');
    return '<div class="portfolio-filterbar"><label class="portfolio-filterlabel" for="' + escapeHtml(identifier) + '">' +
      '<span class="portfolio-filtericon" aria-hidden="true">⌕</span>' +
      '<input type="search" class="inp portfolio-filterinput" id="' + escapeHtml(identifier) +
      '" autocomplete="off" placeholder="' + escapeHtml(placeholder || 'Filtrar registros') +
      '" aria-label="' + escapeHtml(placeholder || 'Filtrar registros') + '"></label>' +
      '<span class="portfolio-result-count" id="' + escapeHtml(identifier) + '_count" role="status" aria-live="polite"></span>' +
      '<span class="portfolio-filter-hint">Filtro nesta página · ' + escapeHtml(noun || 'registros') + '</span></div>' +
      '<p class="portfolio-filter-empty" id="' + escapeHtml(identifier) + '_empty" role="status" hidden>' +
      'Nenhum resultado para essa pesquisa. Limpe o campo para ver todos os registros.</p>';
  }

  function bindFilter(options) {
    if (!options || !options.root || !options.id || !options.rows) return false;
    var root = options.root;
    var input = root.querySelector('#' + options.id);
    var count = root.querySelector('#' + options.id + '_count');
    var empty = root.querySelector('#' + options.id + '_empty');
    if (!input || !count || !empty) return false;
    var rows = Array.prototype.slice.call(root.querySelectorAll(options.rows));
    function update() {
      var query = normalize(input.value);
      var visible = 0;
      rows.forEach(function (row) {
        var found = !query || normalize(row.textContent).includes(query);
        row.hidden = !found;
        if (found) visible++;
      });
      if (options.sections) {
        Array.prototype.forEach.call(root.querySelectorAll(options.sections), function (section) {
          section.hidden = !Array.prototype.some.call(section.querySelectorAll(options.rows), function (row) {
            return !row.hidden;
          });
        });
      }
      if (options.groups) {
        Array.prototype.forEach.call(root.querySelectorAll(options.groups), function (group) {
          group.hidden = !Array.prototype.some.call(group.querySelectorAll(options.rows), function (row) {
            return !row.hidden;
          });
        });
      }
      count.textContent = visible + ' de ' + rows.length + ' ' + (options.noun || 'registros');
      empty.hidden = !query || visible > 0;
    }
    input.addEventListener('input', update);
    update();
    return true;
  }

  window.MatosPortfolioUI = {
    statsHTML: statsHTML,
    filterHTML: filterHTML,
    bindFilter: bindFilter,
    normalize: normalize,
    escapeHtml: escapeHtml,
  };
})();
