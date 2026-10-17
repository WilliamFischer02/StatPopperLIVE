/* Setup page: builds the bookmark and console code for this site's address; copies the Tampermonkey script. */
(function () {
  'use strict';
  const O = location.origin;
  const $ = (id) => document.getElementById(id);
  const bookmarklet = `javascript:(function(){if(window.SPB&&window.SPB.show){window.SPB.show();return}window.__spbOrigin='${O}';var s=document.createElement('script');s.src='${O}/spb.js?v='+Date.now();s.onerror=function(){alert('Stat Pop Board: this page blocked the reader. Use the console method on the setup page.')};document.documentElement.appendChild(s)})();`;
  $('bm').href = bookmarklet;
  $('bmcode').value = bookmarklet;

  let readerCode = null;
  fetch('/spb.js', { cache: 'no-store' }).then((r) => r.text()).then((t) => { readerCode = `window.__spbOrigin=${JSON.stringify(O)};\n` + t; }).catch(() => {});

  function copy(text, note) {
    const done = (msg) => { $(note).textContent = msg; setTimeout(() => { $(note).textContent = ''; }, 4000); };
    if (!text) { done('Still loading, try again in a second'); return; }
    navigator.clipboard.writeText(text).then(() => done('Copied'), () => done('Copy blocked: select the text and press Ctrl+C'));
  }
  $('copybm').addEventListener('click', () => copy(bookmarklet, 'bmnote'));
  $('copyreader').addEventListener('click', () => copy(readerCode, 'readernote'));
  // The Tampermonkey script is built into the page (and served as /stat-pop-board.user.js for one-click install).
  $('copytm').addEventListener('click', () => copy($('tmcode').value, 'tmnote'));
  $('bm').addEventListener('click', (e) => { e.preventDefault(); $('bmnote').textContent = 'Drag this button to your bookmarks bar instead of clicking it.'; });
})();
