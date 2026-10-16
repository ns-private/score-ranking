/**
 * 動作確認用モック (?mock を付けて開いたときだけ読み込まれる)
 *
 * Google Apps Script のサービスをブラウザ内で再現し、apps-script/Code.js を
 * そのまま動かす。データはこのブラウザの localStorage にだけ保存される。
 * 管理者パスワードは "admin"。
 */
(() => {
  'use strict';

  const KEY = 'scoreboard-mock-db';
  let db = null;
  try { db = JSON.parse(localStorage.getItem(KEY)); } catch (_) {}
  if (!db) db = { sheets: {}, props: { ADMIN_PASSWORD: 'admin' } };
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (_) {} };

  function sheet(name) {
    return {
      getDataRange: () => ({ getValues: () => db.sheets[name].map((r) => r.slice()) }),
      clearContents() { db.sheets[name] = []; },
      getMaxRows: () => Infinity,
      insertRowsAfter() {},
      setFrozenRows() {},
      getRange(row, col) {
        return {
          setNumberFormat() { return this; },
          setValues(values) {
            const rows = db.sheets[name];
            values.forEach((v, i) => {
              rows[row - 1 + i] = rows[row - 1 + i] || [];
              v.forEach((cell, j) => { rows[row - 1 + i][col - 1 + j] = cell; });
            });
            persist();
            return this;
          },
        };
      },
    };
  }

  window.SpreadsheetApp = {
    getActiveSpreadsheet: () => ({
      getSheetByName: (n) => (n in db.sheets ? sheet(n) : null),
      insertSheet: (n) => { db.sheets[n] = []; return sheet(n); },
    }),
  };

  window.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k) => db.props[k] || null,
      setProperty: (k, v) => { db.props[k] = v; persist(); },
    }),
  };

  const cache = new Map();
  window.CacheService = {
    getScriptCache: () => ({
      get: (k) => {
        const e = cache.get(k);
        return e && e.exp > Date.now() ? e.v : null;
      },
      put: (k, v, sec) => cache.set(k, { v, exp: Date.now() + sec * 1000 }),
    }),
  };

  window.LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) };
  window.Utilities = { getUuid: () => crypto.randomUUID() };
  window.ContentService = {
    MimeType: { JSON: 'application/json' },
    createTextOutput: (s) => ({ setMimeType() { return this; }, getContent: () => s }),
  };

  // 通信の遅延も再現する
  window.mockApi = async (payload) => {
    await new Promise((r) => setTimeout(r, 250));
    const out = window.doPost({ postData: { contents: JSON.stringify(payload) } });
    return JSON.parse(out.getContent());
  };
})();
