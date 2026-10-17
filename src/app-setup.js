/* Setup page: builds the bookmark, console code and Tampermonkey script for this site's address. */
(function () {
  'use strict';
  const O = location.origin;
  const $ = (id) => document.getElementById(id);
  const bookmarklet = `javascript:(function(){if(window.SPB&&window.SPB.show){window.SPB.show();return}window.__spbOrigin='${O}';var s=document.createElement('script');s.src='${O}/spb.js?v='+Date.now();s.onerror=function(){alert('Stat Pop Board: this page blocked the reader. Use the console method on the setup page.')};document.documentElement.appendChild(s)})();`;
  const tm = `// ==UserScript==
// @name         Stat Pop Board reader
// @namespace    goob-entertainment.stat-pop-board
// @version      0.2.0
// @description  Starts the Stat Pop Board reader on StatBroadcast pages. It reads only the page you have open.
// @match        https://stats.statbroadcast.com/broadcast/*
// @match        https://*.statbroadcast.com/broadcast/*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==
(function () {
  if (window.SPB) return;
  window.__spbOrigin = '${O}';
  var s = document.createElement('script');
  s.src = '${O}/spb.js?v=' + Math.floor(Date.now() / 60000);
  document.documentElement.appendChild(s);
})();
`;
  $('bm').href = bookmarklet;
  $('bmcode').value = bookmarklet;
  $('tmcode').value = tm;

  let readerCode = null;
  fetch('/spb.js', { cache: 'no-store' }).then((r) => r.text()).then((t) => { readerCode = `window.__spbOrigin=${JSON.stringify(O)};\n` + t; }).catch(() => {});

  function copy(text, note) {
    const done = (msg) => { $(note).textContent = msg; setTimeout(() => { $(note).textContent = ''; }, 4000); };
    if (!text) { done('Still loading, try again in a second'); return; }
    navigator.clipboard.writeText(text).then(() => done('Copied'), () => done('Copy blocked: select the text and press Ctrl+C'));
  }
  $('copybm').addEventListener('click', () => copy(bookmarklet, 'bmnote'));
  $('copyreader').addEventListener('click', () => copy(readerCode, 'readernote'));
  $('copytm').addEventListener('click', () => copy(tm, 'tmnote'));
  $('bm').addEventListener('click', (e) => { e.preventDefault(); $('bmnote').textContent = 'Drag this button to your bookmarks bar instead of clicking it.'; });
})();
