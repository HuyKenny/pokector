/*
 * pokector.com as static files (Cloudflare Workers Free, since 23. 11. 2026): the nightly build freezes the
 * server-rendered pages without the React client, so everything that depended on the query string or on a
 * React handler is done here, in plain JS, over JSON written by scripts/static/static.py (static_data):
 *
 *   - /cards and /<locale>/cards: search (?q), set / rarity / card type filters, sort and ?page
 *     (/static-data/cards.json, ~250 kB compressed, fetched only when the URL asks for more than page 1),
 *   - /riftbound/cards: ?q and ?page (/static-data/riftbound-cards.json),
 *   - header search: suggestions while typing and Enter -> the catalog results page.
 *
 * Markup and class names mirror app/routes/public/cards.tsx, riftbound.cards.tsx and
 * app/components/header-search.tsx; the strings come from the page (#pk-cards-static). Filtered states get
 * <meta name="robots" content="noindex"> like the server-rendered app did. Included by app/root.tsx only in the
 * `static` build (root loader `staticSite`).
 */
(function () {
  "use strict";

  var PAGE_SIZE = 24;
  var MAX_PAGE = 400;
  var LOCALES = ["en", "de", "es", "ru", "zh", "cs", "fr", "pt", "ja", "vi", "ar"];
  var PTCG = "https://images.pokemontcg.io/";
  var SCRYDEX = "https://images.scrydex.com/pokemon/";

  var seg = location.pathname.split("/")[1] || "";
  var prefix = LOCALES.indexOf(seg) > 0 ? "/" + seg : "";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fill(tpl, vars) {
    return String(tpl).replace(/\{(\w+)\}/g, function (m, k) {
      return k in vars ? String(vars[k]) : m;
    });
  }
  function norm(s) {
    return String(s || "")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .trim();
  }
  function words(s) {
    return norm(s)
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean);
  }
  function noindex() {
    var m = document.querySelector('meta[name="robots"]');
    if (!m) {
      m = document.createElement("meta");
      m.name = "robots";
      document.head.appendChild(m);
    }
    m.content = "noindex, follow";
  }
  var cache = {};
  function load(path) {
    if (!cache[path])
      cache[path] = fetch(path).then(function (r) {
        if (!r.ok) throw new Error(path + " " + r.status);
        return r.json();
      });
    return cache[path];
  }

  // ---------- Pokémon catalog index ----------

  var catalog = null;
  function cards() {
    return load("/static-data/cards.json").then(function (d) {
      if (catalog) return catalog;
      var list = d.cards.map(function (c, i) {
        var set = d.sets[c[4]] || ["", "", "", null, null];
        var img = c[7];
        var url =
          img === ""
            ? PTCG + set[0] + "/" + c[2] + ".png"
            : img[0] === "p"
              ? PTCG + img.slice(1)
              : img[0] === "s"
                ? SCRYDEX + img.slice(1)
                : img.slice(1);
        return {
          i: i,
          slug: c[0][0] === "/" ? c[0].slice(1) : (set[0] + "-" + c[2] + "-").toLowerCase() + c[0],
          name: c[1],
          number: c[2],
          numberSort: c[3] == null ? Number(c[2]) : c[3],
          setId: set[0],
          setIdx: c[4],
          setName: set[1],
          series: set[2],
          printedTotal: set[3],
          year: set[4],
          rarity: c[5] >= 0 ? d.rarities[c[5]] : null,
          supertype: c[6] >= 0 ? d.supertypes[c[6]] : null,
          img: url,
          updated: c[8],
          extra: c[9],
          cols: null,
        };
      });
      catalog = list;
      return list;
    });
  }

  // FTS columns and bm25 weights of app/lib/catalog/search.server.ts (name 10, number 6, set 3, artist/dex 2,
  // supertype 1.5, series/rarity 1); a card matches when every token matches some word (text tokens as prefix,
  // numbers exactly), ranked by the sum of the best column weight per token.
  function columns(c) {
    if (!c.cols)
      c.cols = [
        [10, words(c.name)],
        [6, words(c.number + " " + (c.printedTotal == null ? "" : c.printedTotal))],
        [3, words(c.setName)],
        [2, words(c.extra)],
        [1.5, words(c.supertype || "")],
        [1, words(c.series + " " + (c.rarity || ""))],
      ];
    return c.cols;
  }
  function tokenScore(c, t) {
    var num = /^\d+$/.test(t);
    var cols = columns(c);
    for (var k = 0; k < cols.length; k++) {
      var ws = cols[k][1];
      for (var j = 0; j < ws.length; j++) {
        if (num ? ws[j] === t : ws[j].lastIndexOf(t, 0) === 0) return cols[k][0];
      }
    }
    return 0;
  }
  function score(c, tokens, any) {
    var total = 0;
    for (var k = 0; k < tokens.length; k++) {
      var s = tokenScore(c, tokens[k]);
      if (!s && !any) return 0;
      total += s;
    }
    return total;
  }
  function queryTokens(q) {
    return words(norm(q).slice(0, 80)).slice(0, 12);
  }
  function searchCards(list, p) {
    var tokens = p.q ? queryTokens(p.q) : [];
    var out = [];
    for (var k = 0; k < list.length; k++) {
      var c = list[k];
      if (p.set && c.setId !== p.set) continue;
      if (p.rarity && c.rarity !== p.rarity) continue;
      if (p.supertype && c.supertype !== p.supertype) continue;
      if (tokens.length) {
        c.score = score(c, tokens, false);
        if (!c.score) continue;
      }
      out.push(c);
    }
    if (p.sort === "number")
      out.sort(function (a, b) {
        return (
          a.setIdx - b.setIdx ||
          a.numberSort - b.numberSort ||
          (a.number < b.number ? -1 : a.number > b.number ? 1 : 0)
        );
      });
    else if (p.sort === "newest")
      out.sort(function (a, b) {
        return a.updated - b.updated || a.i - b.i;
      });
    else if (tokens.length)
      out.sort(function (a, b) {
        return b.score - a.score || a.numberSort - b.numberSort || a.i - b.i;
      });
    return out;
  }
  function didYouMean(list, q) {
    var tokens = queryTokens(q);
    if (!tokens.length) return [];
    var hits = [];
    for (var k = 0; k < list.length; k++) {
      var s = score(list[k], tokens, true);
      if (s) hits.push([s, list[k]]);
    }
    hits.sort(function (a, b) {
      return b[0] - a[0] || a[1].numberSort - b[1].numberSort || a[1].i - b[1].i;
    });
    return hits.slice(0, 12).map(function (h) {
      return h[1];
    });
  }

  function tile(c, href, noImage) {
    var meta =
      c.setName +
      (c.year ? " · " + c.year : "") +
      " · #" +
      c.number +
      (c.rarity ? " · " + c.rarity : "");
    var img = c.img
      ? '<img src="' +
        esc(c.img) +
        '" alt="' +
        esc(c.name + " — " + (c.setName || c.setId) + " " + c.number) +
        '" loading="lazy" class="aspect-[63/88] w-full rounded-lg border border-edge object-cover group-hover:border-accent"/>'
      : '<span class="flex aspect-[63/88] items-center justify-center rounded-lg border border-edge bg-surface-raised text-sm text-fg-faint">' +
        esc(noImage) +
        "</span>";
    return (
      '<li><a class="group flex h-full flex-col gap-2" href="' +
      esc(href) +
      '"><div class="relative">' +
      img +
      '</div><div><p class="truncate text-sm font-medium text-fg group-hover:text-accent">' +
      esc(c.name) +
      '</p><p class="truncate text-xs text-fg-faint">' +
      esc(meta) +
      "</p></div></a></li>"
    );
  }
  var GRID = "grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6";
  var PAGE_BTN = "rounded-lg border border-edge px-4 py-2 text-sm hover:bg-surface-raised";

  function catalogPage() {
    var cfgEl = document.getElementById("pk-cards-static");
    var box = document.querySelector("[data-cards-results]");
    if (!cfgEl || !box) return;
    var t = JSON.parse(cfgEl.textContent);
    var sp = new URLSearchParams(location.search);
    var p = {
      q: (sp.get("q") || "").trim(),
      set: sp.get("set") || "",
      rarity: sp.get("rarity") || "",
      supertype: sp.get("supertype") || "",
      sort: sp.get("sort") || "",
      page: Math.min(Math.max(parseInt(sp.get("page") || "1", 10) || 1, 1), MAX_PAGE),
    };
    var filtered = !!(p.q || p.set || p.rarity || p.supertype || p.sort);
    if (!filtered && p.page === 1) return; // the frozen page is page 1 of the default list
    if (filtered) noindex();
    var form = box.parentElement.querySelector('form[role="search"]');
    if (form)
      ["q", "set", "rarity", "supertype", "sort"].forEach(function (k) {
        var el = form.elements.namedItem(k);
        if (el && sp.has(k)) el.value = sp.get(k);
      });
    var status = box.querySelector('[role="status"]');
    if (status) status.setAttribute("aria-busy", "true");
    cards()
      .then(function (list) {
        var all = searchCards(list, p);
        var total = all.length;
        var pageCount = Math.max(1, Math.min(Math.ceil(total / PAGE_SIZE), MAX_PAGE));
        var page = Math.min(p.page, pageCount);
        var items = all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
        var vars = {
          count: total.toLocaleString(t.langTag),
          q: p.q,
          page: page,
          pageCount: pageCount,
        };
        var html =
          '<p class="text-sm text-fg-muted" role="status">' +
          esc(fill(p.q ? t.resultCountMatching : t.resultCountPlain, vars)) +
          "</p>";
        if (!items.length) {
          html +=
            '<div class="flex flex-col gap-6"><div class="rounded-(--radius-card) border border-edge bg-surface p-10 text-center">' +
            '<p class="mb-2 text-lg font-medium text-fg">' +
            esc(t.emptyTitle) +
            '</p><p class="text-sm text-fg-muted">' +
            esc(t.emptyBody) +
            "</p></div>";
          var sug = p.q ? didYouMean(list, p.q) : [];
          if (sug.length)
            html +=
              '<div class="flex flex-col gap-3"><h2 class="text-sm font-semibold text-fg-muted">' +
              esc(t.didYouMean) +
              '</h2><ul class="' +
              GRID +
              '">' +
              sug
                .map(function (c) {
                  return tile(c, t.cardBase + c.slug, t.noImage);
                })
                .join("") +
              "</ul></div>";
          html += "</div>";
        } else {
          html +=
            '<ul class="' +
            GRID +
            '">' +
            items
              .map(function (c) {
                return tile(c, t.cardBase + c.slug, t.noImage);
              })
              .join("") +
            "</ul>";
        }
        if (pageCount > 1 && items.length) {
          var link = function (n) {
            var next = new URLSearchParams(sp);
            if (n <= 1) next.delete("page");
            else next.set("page", String(n));
            var qs = next.toString();
            return qs ? t.base + "?" + qs : t.base;
          };
          html +=
            '<nav aria-label="' +
            esc(t.paginationAria) +
            '" class="flex items-center justify-center gap-2">' +
            (page > 1
              ? '<a class="' +
                PAGE_BTN +
                '" href="' +
                esc(link(page - 1)) +
                '">' +
                esc(t.previous) +
                "</a>"
              : "") +
            '<span class="px-2 text-sm text-fg-muted">' +
            esc(fill(t.pageShort, { page: page, pageCount: pageCount })) +
            "</span>" +
            (page < pageCount
              ? '<a class="' +
                PAGE_BTN +
                '" href="' +
                esc(link(page + 1)) +
                '">' +
                esc(t.next) +
                "</a>"
              : "") +
            "</nav>";
        }
        box.innerHTML = html;
        document.title = fill(t.metaTitle, {
          suffix: page > 1 ? fill(t.metaTitleSuffix, { page: page }) : "",
        });
      })
      .catch(function () {
        if (status) status.removeAttribute("aria-busy");
      });
  }

  // ---------- Riftbound catalog ----------

  function riftboundPage() {
    var box = document.querySelector("[data-rb-results]");
    if (!box) return;
    var sp = new URLSearchParams(location.search);
    var q = sp.get("q") || "";
    var pageArg = Math.max(1, parseInt(sp.get("page") || "1", 10) || 1);
    if (!q && pageArg === 1) return;
    if (q) noindex();
    var input = box.parentElement.querySelector('form input[name="q"]');
    if (input) input.value = q;
    var usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
    load("/static-data/riftbound-cards.json").then(function (d) {
      var needle = q.toLowerCase().slice(0, 80);
      var all = needle
        ? d.cards.filter(function (c) {
            return String(c[7]).toLowerCase().indexOf(needle) >= 0;
          })
        : d.cards;
      var pageCount = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
      var page = pageArg;
      var items = all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
      var html;
      if (!items.length) {
        html =
          '<p class="rounded-lg border border-edge bg-surface p-6 text-sm text-fg-muted">No Riftbound cards yet — the catalog is syncing. Check back shortly.</p>';
      } else {
        html =
          '<ul class="' +
          GRID +
          '">' +
          items
            .map(function (c) {
              var meta =
                c[3] +
                " · #" +
                c[2] +
                (c[4] ? " · " + c[4] : "") +
                (c[6] != null ? " · " + usd.format(c[6] / 100) : "");
              var img = c[5]
                ? '<img src="' +
                  esc(c[5]) +
                  '" alt="' +
                  esc(c[1] + " — " + c[3] + " #" + c[2]) +
                  '" loading="lazy" class="aspect-[63/88] w-full rounded-lg border border-edge object-cover group-hover:border-accent"/>'
                : '<span class="flex aspect-[63/88] items-center justify-center rounded-lg border border-edge bg-surface-raised text-xs text-fg-faint">No image</span>';
              return (
                '<li><a class="group flex h-full flex-col gap-2" href="' +
                prefix +
                "/riftbound/cards/" +
                esc(c[0]) +
                '">' +
                img +
                '<div><p class="truncate text-sm font-medium text-fg group-hover:text-accent">' +
                esc(c[1]) +
                '</p><p class="truncate text-xs text-fg-faint">' +
                esc(meta) +
                "</p></div></a></li>"
              );
            })
            .join("") +
          "</ul>";
      }
      if (pageCount > 1) {
        var link = function (n) {
          var o = {};
          if (q) o.q = q;
          o.page = String(n);
          return "?" + new URLSearchParams(o).toString();
        };
        html +=
          '<nav aria-label="Pagination" class="flex items-center justify-center gap-3 text-sm">' +
          (page > 1
            ? '<a class="rounded-lg border border-edge px-4 py-2" href="' +
              esc(link(page - 1)) +
              '">← Previous</a>'
            : "") +
          '<span class="text-fg-muted">Page ' +
          page +
          " / " +
          pageCount +
          "</span>" +
          (page < pageCount
            ? '<a class="rounded-lg border border-edge px-4 py-2" href="' +
              esc(link(page + 1)) +
              '">Next →</a>'
            : "") +
          "</nav>";
      }
      box.innerHTML = html;
    });
  }

  // ---------- header search (suggestions + Enter) ----------

  function headerSearch() {
    var inputs = document.querySelectorAll('input[aria-controls="header-search-list"]');
    Array.prototype.forEach.call(inputs, function (input) {
      var root = input.parentElement;
      var box = null;
      var items = [];
      var active = -1;
      var timer = 0;
      var close = function () {
        if (box) box.remove();
        box = null;
        active = -1;
        input.setAttribute("aria-expanded", "false");
      };
      var results = function () {
        var q = input.value.trim();
        if (q) location.href = prefix + "/cards?q=" + encodeURIComponent(q);
      };
      var render = function () {
        var q = input.value.trim();
        if (q.length < 2) return close();
        cards().then(function (list) {
          if (input.value.trim() !== q) return;
          items = searchCards(list, { q: q }).slice(0, 8);
          if (!box) {
            box = document.createElement("div");
            box.className =
              "absolute end-0 z-50 mt-1 w-80 max-w-[85vw] overflow-hidden rounded-lg border border-edge bg-surface shadow-(--shadow-card)";
            root.appendChild(box);
          }
          input.setAttribute("aria-expanded", "true");
          active = -1;
          box.innerHTML = items.length
            ? '<ul id="header-search-list" role="listbox" aria-label="' +
              esc(input.getAttribute("aria-label") || "") +
              '" class="max-h-96 overflow-auto py-1">' +
              items
                .map(function (c) {
                  return (
                    '<li role="option" aria-selected="false"><a class="flex items-center gap-3 px-3 py-2 hover:bg-surface-raised" href="' +
                    esc(prefix + "/cards/" + c.slug) +
                    '">' +
                    (c.img
                      ? '<img src="' +
                        esc(c.img) +
                        '" alt="" loading="lazy" class="h-12 w-9 shrink-0 rounded border border-edge object-cover"/>'
                      : '<span class="h-12 w-9 shrink-0 rounded border border-edge bg-surface-raised"></span>') +
                    '<span class="min-w-0"><span class="block truncate text-sm font-medium text-fg">' +
                    esc(c.name) +
                    '</span><span class="block truncate text-xs text-fg-faint">' +
                    esc(c.setName + " · #" + c.number) +
                    "</span></span></a></li>"
                  );
                })
                .join("") +
              '<li><button type="button" data-all class="w-full px-3 py-2 text-start text-xs font-medium text-accent hover:bg-surface-raised">→</button></li></ul>'
            : '<p class="p-3 text-sm text-fg-muted">' +
              esc(input.getAttribute("data-no-results") || "") +
              "</p>";
          var all = box.querySelector("[data-all]");
          if (all) {
            all.textContent = input.getAttribute("data-view-all") || "→";
            all.addEventListener("click", results);
          }
        });
      };
      input.addEventListener("input", function () {
        clearTimeout(timer);
        timer = setTimeout(render, 120);
      });
      input.addEventListener("keydown", function (e) {
        var opts = box ? box.querySelectorAll('li[role="option"]') : [];
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          if (!opts.length) return;
          e.preventDefault();
          active = (active + (e.key === "ArrowDown" ? 1 : -1) + opts.length) % opts.length;
          Array.prototype.forEach.call(opts, function (o, k) {
            o.setAttribute("aria-selected", String(k === active));
            o.firstChild.classList.toggle("bg-surface-raised", k === active);
          });
        } else if (e.key === "Enter") {
          e.preventDefault();
          if (active >= 0 && opts[active]) location.href = opts[active].firstChild.href;
          else results();
        } else if (e.key === "Escape") close();
      });
      document.addEventListener("click", function (e) {
        if (!root.contains(e.target)) close();
      });
    });
  }

  catalogPage();
  riftboundPage();
  headerSearch();
})();
