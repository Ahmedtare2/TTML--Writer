/* Core logic shared by the timing editor: TTML export + project checks.
 * Mirrors ttmlgen/ttml.py exactly (tests/test_js_parity.py compares the two byte for byte). */
(function (root) {
  "use strict";

  var BOTH_NAMES = ["both", "all", "together", "group", "duet", "الجميع", "معا", "معاً", "كلاهما"];
  var BOTH_AGENT_ID = "v1000";
  var TT_NS = "http://www.w3.org/ns/ttml";
  var TTM_NS = "http://www.w3.org/ns/ttml#metadata";
  var ITUNES_NS = "http://music.apple.com/lyric-ttml-internal";

  function isBoth(name) {
    return !!name && BOTH_NAMES.indexOf(String(name).trim().toLowerCase()) >= 0;
  }

  function fmtTime(t) {
    var ms = Math.floor(Math.max(0, t) * 1000 + 0.5);
    var h = Math.floor(ms / 3600000); ms -= h * 3600000;
    var m = Math.floor(ms / 60000); ms -= m * 60000;
    var s = Math.floor(ms / 1000); ms -= s * 1000;
    var p2 = function (n) { return (n < 10 ? "0" : "") + n; };
    var p3 = function (n) { return (n < 10 ? "00" : n < 100 ? "0" : "") + n; };
    if (h) return h + ":" + p2(m) + ":" + p2(s) + "." + p3(ms);
    if (m) return m + ":" + p2(s) + "." + p3(ms);
    return s + "." + p3(ms);
  }

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function attr(s) { return esc(s).replace(/"/g, "&quot;"); }

  function songPart(section) {
    if (!section) return null;
    var s = String(section).replace(/[\s_-]*\d+\s*$/, "").trim();
    s = s.split(/\s+/).filter(Boolean).map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(" ");
    return s || null;
  }

  function aligned(w) { return w.e > w.s; }

  function bounds(line) {
    var a = line.words.filter(aligned);
    if (!a.length) return { start: 0, end: 0 };
    return {
      start: Math.min.apply(null, a.map(function (w) { return w.s; })),
      end: Math.max.apply(null, a.map(function (w) { return w.e; }))
    };
  }

  function agentsOf(project) {
    var names = [], hasBoth = false;
    project.lines.forEach(function (ln) {
      if (ln.singer && isBoth(ln.singer)) hasBoth = true;
      else if (ln.singer && names.indexOf(ln.singer) < 0) names.push(ln.singer);
    });
    var out = names.map(function (n, i) { return ["v" + (i + 1), n]; });
    if (!out.length) out = [["v1", "Singer"]];
    if (hasBoth) out.push([BOTH_AGENT_ID, "Both"]);
    return out;
  }

  function agentId(project, line) {
    if (line.singer && isBoth(line.singer)) return BOTH_AGENT_ID;
    var ag = agentsOf(project);
    for (var i = 0; i < ag.length; i++) if (line.singer === ag[i][1]) return ag[i][0];
    return ag[0][0];
  }

  function bgText(texts) {
    return texts.map(function (t, i) {
      if (i === 0) t = "(" + t;
      if (i === texts.length - 1) t = t + ")";
      return t;
    });
  }

  function groupStart(ws) { return Math.min.apply(null, ws.map(function (w) { return w.s; })); }
  function groupEnd(ws) { return Math.max.apply(null, ws.map(function (w) { return w.e; })); }

  /* The line's words in output order: lead words, each backing group placed before the first lead word that
   * starts at or after the group's start.  Items are {w: word} or {g: [words]}. */
  function ordered(line) {
    var lead = line.words.filter(function (w) { return !w.bg; });
    var groups = {};
    line.words.forEach(function (w) { if (w.bg) { (groups[w.g] = groups[w.g] || []).push(w); } });
    var pending = Object.keys(groups).map(function (k) { return { g: Number(k), ws: groups[k] }; })
      .sort(function (a, c) { return (groupStart(a.ws) - groupStart(c.ws)) || (a.g - c.g); });
    var items = [];
    lead.forEach(function (w) {
      while (pending.length && groupStart(pending[0].ws) <= w.s) items.push({ g: pending.shift().ws });
      items.push({ w: w });
    });
    pending.forEach(function (p) { items.push({ g: p.ws }); });
    return items;
  }

  function span(w, text, ns) {
    return "<span" + (ns ? ' xmlns="' + TT_NS + '"' : "") + ' begin="' + fmtTime(w.s) + '" end="' + fmtTime(w.e) + '">' + esc(text) + "</span>";
  }

  function emitLine(project, line, timing) {
    var b = bounds(line);
    var attrs = 'begin="' + fmtTime(b.start) + '" end="' + fmtTime(b.end) + '" ttm:agent="' +
      agentId(project, line) + '" itunes:key="L' + line.id + '"';
    var items = [];
    ordered(line).forEach(function (it) {
      if (it.w) { items.push(timing === "Line" ? esc(it.w.t) : span(it.w, it.w.t, false)); return; }
      var texts = bgText(it.g.map(function (w) { return w.t; }));
      if (timing === "Line") { items.push('<span ttm:role="x-bg">' + esc(texts.join(" ")) + "</span>"); return; }
      var inner = it.g.map(function (w, i) { return span(w, texts[i], false); }).join(" ");
      items.push('<span ttm:role="x-bg" begin="' + fmtTime(groupStart(it.g)) + '" end="' + fmtTime(groupEnd(it.g)) + '">' + inner + "</span>");
    });
    return "<p " + attrs + ">" + items.join(" ") + "</p>";
  }

  function pronLang(meta) {
    meta = meta || {};
    if (meta.pron_lang) return String(meta.pron_lang);
    var base = String(meta.language || "und").split("-")[0] || "und";
    return base + "-Latn";
  }

  function trEntry(ln, lang) {
    var e = ln.tr && ln.tr[lang];
    if (!e) return null;
    if (typeof e === "string") e = { t: e };
    return (e.t || e.b) ? e : null;
  }

  function translationText(e) {
    var out = esc(e.t || "");
    if (e.b) out += '<span xmlns="' + TT_NS + '" ttm:role="x-bg">' + esc("(" + e.b + ")") + "</span>";
    return out;
  }

  function pronText(line, timing) {
    var parts = [];
    ordered(line).forEach(function (it) {
      if (it.w) { var t = it.w.p || it.w.t; parts.push(timing === "Line" ? esc(t) : span(it.w, t, true)); return; }
      var texts = bgText(it.g.map(function (w) { return w.p || w.t; }));
      if (timing === "Line") { parts.push('<span xmlns="' + TT_NS + '" ttm:role="x-bg">' + esc(texts.join(" ")) + "</span>"); return; }
      var inner = it.g.map(function (w, i) { return span(w, texts[i], false); }).join(" ");
      parts.push('<span xmlns="' + TT_NS + '" ttm:role="x-bg" begin="' + fmtTime(groupStart(it.g)) + '" end="' + fmtTime(groupEnd(it.g)) + '">' + inner + "</span>");
    });
    return parts.join(" ");
  }

  function itunesMetadata(project, lines, timing) {
    var meta = project.meta || {};
    var writers = meta.songwriters || [];
    var langs = [];
    lines.forEach(function (ln) {
      Object.keys(ln.tr || {}).forEach(function (lang) { if (trEntry(ln, lang) && langs.indexOf(lang) < 0) langs.push(lang); });
    });
    var pronLines = lines.filter(function (ln) { return ln.words.some(function (w) { return w.p; }); });
    if (!(writers.length || langs.length || pronLines.length)) return [];
    var open = '      <iTunesMetadata xmlns="' + ITUNES_NS + '">';
    var songs = writers.length ? "<songwriters>" + writers.map(function (w) { return "<songwriter>" + esc(String(w)) + "</songwriter>"; }).join("") + "</songwriters>" : "";
    if (!(langs.length || pronLines.length)) return [open + songs + "</iTunesMetadata>"];
    var out = [open];
    if (songs) out.push("        " + songs);
    if (langs.length) {
      out.push("        <translations>");
      langs.forEach(function (lang) {
        out.push('          <translation xml:lang="' + attr(lang) + '">');
        lines.forEach(function (ln) {
          var e = trEntry(ln, lang);
          if (e) out.push('            <text for="L' + ln.id + '">' + translationText(e) + "</text>");
        });
        out.push("          </translation>");
      });
      out.push("        </translations>");
    }
    if (pronLines.length) {
      out.push("        <transliterations>");
      out.push('          <transliteration xml:lang="' + attr(pronLang(meta)) + '">');
      pronLines.forEach(function (ln) { out.push('            <text for="L' + ln.id + '">' + pronText(ln, timing) + "</text>"); });
      out.push("          </transliteration>");
      out.push("        </transliterations>");
    }
    out.push("      </iTunesMetadata>");
    return out;
  }

  function buildTTML(project, timing, strict) {
    timing = timing || "Word";
    if (strict === undefined) strict = true;
    if (timing !== "Word" && timing !== "Line") throw new Error("timing must be 'Word' or 'Line'");
    var lines = project.lines.filter(function (ln) { return ln.words.length; });
    var bad = lines.filter(function (ln) { return ln.words.some(function (w) { return !aligned(w); }); })
      .map(function (ln) { return ln.id; });
    if (bad.length && strict) {
      var e = new Error("lines with unaligned words: " + bad.slice(0, 10).join(", ") + (bad.length > 10 ? "..." : ""));
      e.lines = bad;
      throw e;
    }
    lines = lines.filter(function (ln) { var b = bounds(ln); return b.start < b.end; });

    var meta = project.meta || {};
    var lang = meta.language || "en";
    var out = ['<?xml version="1.0" encoding="UTF-8"?>'];
    out.push('<tt xmlns="' + TT_NS + '" xmlns:itunes="' + ITUNES_NS + '" xmlns:ttm="' + TTM_NS + '" ' +
      'itunes:timing="' + timing + '" xml:lang="' + attr(lang) + '">');
    out.push("  <head>");
    out.push("    <metadata>");
    agentsOf(project).forEach(function (a) {
      var typ = a[0] === BOTH_AGENT_ID ? "other" : "person";
      out.push('      <ttm:agent type="' + typ + '" xml:id="' + a[0] + '"/>');
    });
    itunesMetadata(project, lines, timing).forEach(function (l) { out.push(l); });
    out.push("    </metadata>");
    out.push("  </head>");
    var total = lines.reduce(function (m, ln) { return Math.max(m, bounds(ln).end); }, 0);
    out.push('  <body dur="' + fmtTime(total) + '">');

    var i = 0;
    while (i < lines.length) {
      var sect = lines[i].section;
      var j = i;
      while (j < lines.length && lines[j].section === sect) j++;
      var chunk = lines.slice(i, j);
      var part = songPart(sect);
      var partAttr = part ? ' itunes:song-part="' + attr(part) + '"' : "";
      var cs = Math.min.apply(null, chunk.map(function (c) { return bounds(c).start; }));
      var ce = Math.max.apply(null, chunk.map(function (c) { return bounds(c).end; }));
      out.push('    <div begin="' + fmtTime(cs) + '" end="' + fmtTime(ce) + '"' + partAttr + ">");
      chunk.forEach(function (ln) { out.push("      " + emitLine(project, ln, timing)); });
      out.push("    </div>");
      i = j;
    }
    out.push("  </body>");
    out.push("</tt>");
    return out.join("\n") + "\n";
  }

  /* ------------------------------------------------------------------ line text with (backing) markup */
  /* "Hello (oh yeah) world" -> tokens [{t, bg, g}].  Words inside ( ) are backing vocals; each pair is a group. */
  function parseMarkup(text) {
    var tokens = [], inBg = false, g = 0;
    String(text || "").split(/\s+/).filter(Boolean).forEach(function (raw) {
      var t = raw;
      while (t.charAt(0) === "(") { t = t.slice(1); if (!inBg) { inBg = true; g++; } }
      var bg = inBg, close = false;
      while (inBg && t.length && t.charAt(t.length - 1) === ")") { t = t.slice(0, -1); close = true; }
      if (close || (inBg && !t)) { if (close) inBg = false; }
      if (t) tokens.push({ t: t, bg: bg, g: bg ? g : 0 });
    });
    return tokens;
  }

  function lineMarkup(line) {
    var out = [];
    line.words.forEach(function (w, i) {
      var prev = line.words[i - 1], next = line.words[i + 1];
      var open = w.bg && !(prev && prev.bg && prev.g === w.g), close = w.bg && !(next && next.bg && next.g === w.g);
      out.push((open ? "(" : "") + w.t + (close ? ")" : ""));
    });
    return out.join(" ");
  }

  /* New word list for edited line text.  Words whose text is unchanged keep their timing; a replaced word keeps the
   * timing of the word it replaces; new words are placed between their neighbours (or at `fallback`). */
  function retextWords(oldWords, tokens, fallback) {
    var n = oldWords.length, m = tokens.length, i, j;
    var L = [];
    for (i = 0; i <= n; i++) { L.push(new Array(m + 1).fill(0)); }
    for (i = n - 1; i >= 0; i--) for (j = m - 1; j >= 0; j--)
      L[i][j] = oldWords[i].t === tokens[j].t ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    var pairs = []; i = 0; j = 0;
    while (i < n && j < m) {
      if (oldWords[i].t === tokens[j].t) { pairs.push([i, j]); i++; j++; }
      else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++;
    }
    pairs.push([n, m]);
    var out = [], oi = 0, nj = 0;
    function mk(tok, s, e, base) {
      var w = { t: tok.t, s: s, e: e, c: base ? base.c : 1, bg: tok.bg, g: tok.g, src: base ? base.src : "manual" };
      if (base && base.p && base.t === tok.t) w.p = base.p;
      return w;
    }
    function aligned(w) { return w.e > w.s; }
    pairs.forEach(function (pr) {
      var oldSeg = oldWords.slice(oi, pr[0]), newSeg = tokens.slice(nj, pr[1]);
      if (newSeg.length) {
        if (oldSeg.length === newSeg.length) {
          newSeg.forEach(function (tok, k) { out.push(mk(tok, oldSeg[k].s, oldSeg[k].e, oldSeg[k])); });
        } else {
          var al = oldSeg.filter(aligned), a, b;
          if (al.length) {
            a = Math.min.apply(null, al.map(function (w) { return w.s; })); b = Math.max.apply(null, al.map(function (w) { return w.e; }));
          } else {                                              // pure insertion: look at the neighbours
            var prevW = out.length ? out[out.length - 1] : null;
            var nextW = pr[0] < n ? oldWords[pr[0]] : null;
            var pe = prevW && aligned(prevW) ? prevW.e : null, ns = nextW && aligned(nextW) ? nextW.s : null;
            var need = newSeg.length * 0.25;
            if (pe !== null && ns !== null) { a = pe; b = ns - pe >= newSeg.length * 0.1 ? ns : pe + need; }
            else if (pe !== null) { a = pe; b = pe + need; }
            else if (ns !== null) { a = Math.max(0, ns - need); b = a + need; }
            else { a = fallback || 0; b = a + need; }
          }
          var step = (b - a) / newSeg.length;
          newSeg.forEach(function (tok, k) { out.push(mk(tok, a + step * k, a + step * (k + 1), null)); });
        }
      }
      if (pr[0] < n) {
        var ow = oldWords[pr[0]], tk = tokens[pr[1]];
        out.push({ t: tk.t, s: ow.s, e: ow.e, c: ow.c, bg: tk.bg, g: tk.g, src: ow.src, p: ow.p });
        if (!out[out.length - 1].p) delete out[out.length - 1].p;
      }
      oi = pr[0] + 1; nj = pr[1] + 1;
    });
    return out;
  }

  /* ------------------------------------------------------------------ Google Translate (public web endpoint) */
  var GTX = "https://translate.googleapis.com/translate_a/single";
  function googleCode(lang) { return lang === "zh-Hans" ? "zh-CN" : lang === "zh-Hant" ? "zh-TW" : lang; }
  function gtxTranslateUrl(sl, tl, text) {
    return GTX + "?client=gtx&dt=t&sl=" + encodeURIComponent(googleCode(sl || "auto")) + "&tl=" + encodeURIComponent(googleCode(tl)) +
      "&q=" + encodeURIComponent(text);
  }
  function gtxRomanizeUrl(sl, text) {
    sl = googleCode(sl || "auto");
    return GTX + "?client=gtx&sl=" + encodeURIComponent(sl) + "&tl=" + encodeURIComponent(sl + "-Latn") + "&q=" + encodeURIComponent(text) + "&dt=t&dt=rm";
  }
  function gtxParts(data) {
    if (!Array.isArray(data) || !Array.isArray(data[0]) || !data[0].length) throw new Error("Unexpected answer from the translation service");
    return data[0].filter(Array.isArray);
  }
  function gtxTranslation(data) {
    return gtxParts(data).map(function (p) { return typeof p[0] === "string" ? p[0] : ""; }).join("").replace(/\s+/g, " ").trim();
  }
  /* The romanisation is not at a fixed index, so take the Latin-script string out of each row. */
  function gtxRomanization(data) {
    var parts = gtxParts(data), out = [];
    parts.forEach(function (p) {
      var cand = [p[3], p[2]].filter(function (x) { return typeof x === "string" && x.trim(); });
      var pick = cand.filter(function (x) { return !scriptOf(x); })[0];
      if (pick !== undefined) out.push(pick);
    });
    if (!out.length) parts.forEach(function (p) { if (typeof p[0] === "string" && p[0].trim() && !scriptOf(p[0]) && p[0] !== p[1]) out.push(p[0]); });
    return out.join(" ").replace(/\s+/g, " ").trim();
  }

  var SCRIPTS = [
    ["ar", /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/],
    ["cyrillic", /[Ѐ-ӿ]/], ["he", /[֐-׿]/], ["el", /[Ͱ-Ͽ]/],
    ["hi", /[ऀ-ॿ]/], ["th", /[฀-๿]/], ["ko", /[가-힯ᄀ-ᇿ]/],
    ["ja", /[぀-ヿ]/], ["han", /[一-鿿]/]
  ];
  var SCRIPT_LANGS = { ar: ["ar", "fa", "ur"], cyrillic: ["ru", "uk", "bg"], he: ["he"], el: ["el"], hi: ["hi"], th: ["th"], ko: ["ko"], ja: ["ja"], han: ["zh-CN", "ja"] };
  function scriptOf(text) {
    for (var i = 0; i < SCRIPTS.length; i++) if (SCRIPTS[i][1].test(text)) return SCRIPTS[i][0];
    return null;
  }
  /* Language to romanise `text` from: the chosen language when it uses the text's script, else the script's default. */
  function pickLang(text, chosen) {
    var sc = scriptOf(text); if (!sc) return null;
    return SCRIPT_LANGS[sc].indexOf(chosen) >= 0 ? chosen : SCRIPT_LANGS[sc][0];
  }

  /* Quick structural checks on the project (the editor shows these live).
   * Returns [{level: "error"|"warning", li, wi, msg}] where li/wi index project.lines / line.words. */
  function checkProject(project, opts) {
    opts = opts || {};
    var minWord = opts.minWord || 0.04, maxWord = opts.maxWord || 10, tol = 0.006;
    var out = [];
    var lastEndByAgent = {};
    project.lines.forEach(function (ln, li) {
      var tag = "Line " + ln.id;
      if (!ln.words.length) { out.push({ level: "error", li: li, wi: -1, msg: tag + " has no words" }); return; }
      ln.words.forEach(function (w, wi) {
        if (!w.t || !String(w.t).trim()) out.push({ level: "error", li: li, wi: wi, msg: tag + ": empty word" });
        if (!aligned(w)) out.push({ level: "error", li: li, wi: wi, msg: tag + ': "' + w.t + '" has no timing' });
        else if (w.e - w.s < minWord) out.push({ level: "warning", li: li, wi: wi, msg: tag + ': "' + w.t + '" is only ' + Math.round((w.e - w.s) * 1000) + " ms long" });
        else if (w.e - w.s > maxWord) out.push({ level: "warning", li: li, wi: wi, msg: tag + ': "' + w.t + '" lasts ' + (w.e - w.s).toFixed(1) + " s" });
      });
      var groups = [ln.words.filter(function (w) { return !w.bg; })];
      var gset = {};
      ln.words.forEach(function (w) { if (w.bg) (gset[w.g] = gset[w.g] || []).push(w); });
      Object.keys(gset).forEach(function (k) { groups.push(gset[k]); });
      groups.forEach(function (g) {
        for (var i = 1; i < g.length; i++) {
          if (aligned(g[i]) && aligned(g[i - 1]) && g[i].s < g[i - 1].e - tol) {
            out.push({ level: "error", li: li, wi: ln.words.indexOf(g[i]), msg: tag + ': "' + g[i].t + '" starts before "' + g[i - 1].t + '" ends' });
          }
        }
      });
      var b = bounds(ln);
      if (b.end > b.start) {
        var ag = agentId(project, ln);
        if (ag !== BOTH_AGENT_ID) {
          // A line may start while the previous line's LAST word is still being held; only more than that is suspicious.
          var prev = lastEndByAgent[ag];
          if (prev !== undefined && b.start < prev - 0.25) {
            out.push({ level: "warning", li: li, wi: -1, msg: tag + " overlaps the previous line of the same singer by " + (prev - b.start).toFixed(2) + " s" });
          }
          var leadEnds = ln.words.filter(function (w) { return !w.bg && aligned(w); }).map(function (w) { return w.e; });
          var core = leadEnds.length >= 2 ? leadEnds[leadEnds.length - 2] : b.start;
          lastEndByAgent[ag] = Math.max(prev || 0, core);
        }
        if (b.end - b.start > 20) out.push({ level: "warning", li: li, wi: -1, msg: tag + " lasts " + (b.end - b.start).toFixed(1) + " s" });
      }
    });
    return out;
  }

  var api = {
    fmtTime: fmtTime, esc: esc, songPart: songPart, bounds: bounds, agentsOf: agentsOf, agentId: agentId,
    buildTTML: buildTTML, pronLang: pronLang, parseMarkup: parseMarkup, lineMarkup: lineMarkup, retextWords: retextWords,
    gtxTranslateUrl: gtxTranslateUrl, gtxRomanizeUrl: gtxRomanizeUrl, gtxTranslation: gtxTranslation, gtxRomanization: gtxRomanization,
    scriptOf: scriptOf, pickLang: pickLang, checkProject: checkProject, isBoth: isBoth, BOTH_AGENT_ID: BOTH_AGENT_ID
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.TTMLCore = api;
})(typeof window !== "undefined" ? window : globalThis);
