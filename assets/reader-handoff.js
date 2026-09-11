// KOBA-I canonical Reader Bookshelf handoff. The player continues to consume
// the existing bearer-token manifest contract; this script only establishes it.
(function () {
  "use strict";

  const STORAGE_KEY = "koba_reader_session";
  const SESSION_VERSION = 2;
  const FREE_STORAGE_KEY = "koba_anonymous_free_passes";
  const config = typeof JubileeConfig !== "undefined" ? JubileeConfig : {};
  const dashboardUrl = String(config.dashboardUrl || "").replace(/\/$/, "");
  let canonicalSession = null;

  function rootContext() {
    const root = document.getElementById("jubilee-bloom-root") || document.getElementById("koba-ebook-canvas-root");
    return root ? { assetId: root.getAttribute("data-asset") || "", tenantId: root.getAttribute("data-studio-key") || String(config.studioKey || "") } : { assetId: "", tenantId: "" };
  }

  function fragmentHandoff() {
    const hash = String(window.location.hash || "");
    const match = /^#koba_reader_handoff=([^&]+)$/.exec(hash);
    if (!match) return "";
    window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
    try { return decodeURIComponent(match[1]); } catch { return ""; }
  }

  function tokenClaims(token) {
    try {
      const part = String(token).split(".")[1] || "";
      const base64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
      return JSON.parse(window.atob(base64));
    } catch { return {}; }
  }

  function persist(session) {
    const claims = tokenClaims(session.readerToken);
    if (claims.tenantId !== session.tenantId || Number(claims.exp) * 1000 !== Number(session.expiresAt)) throw new Error("The canonical reader token claims were invalid.");
    if (claims.principalType === "anonymous_free") {
      if (claims.assetId !== session.assetId || claims.origin !== window.location.origin) throw new Error("The free visitor pass scope was invalid.");
      sessionStorage.setItem(FREE_STORAGE_KEY, JSON.stringify({ tenantId: session.tenantId, globalReaderToken: session.readerToken, principalType: "anonymous_free", assetId: session.assetId, expiresAt: session.expiresAt }));
      canonicalSession = JSON.parse(sessionStorage.getItem(FREE_STORAGE_KEY));
      return canonicalSession;
    }
    if (claims.principalType !== "firebase_uid") throw new Error("The canonical reader token claims were invalid.");
    const registry = (() => { try { const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); return value && value.version === SESSION_VERSION && value.tenants ? value : { version: SESSION_VERSION, tenants: {} }; } catch { return { version: SESSION_VERSION, tenants: {} }; } })();
    registry.tenants[session.tenantId] = { tenantId: session.tenantId, globalReaderToken: session.readerToken, normalizedPhone: "", principalType: "firebase_uid", assetId: session.assetId, expiresAt: session.expiresAt, savedAt: Date.now() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(registry));
    canonicalSession = registry.tenants[session.tenantId];
    return canonicalSession;
  }

  function storedFreeSession(assetId, tenantId) {
    try {
      const session = JSON.parse(sessionStorage.getItem(FREE_STORAGE_KEY) || "null");
      if (!session || session.assetId !== assetId || session.tenantId !== tenantId || Number(session.expiresAt) <= Date.now() + 30000) return null;
      const claims = tokenClaims(session.globalReaderToken);
      return claims.principalType === "anonymous_free" && claims.assetId === assetId && claims.tenantId === tenantId && claims.origin === window.location.origin ? session : null;
    } catch { return null; }
  }

  function storedFirebaseSession(assetId, tenantId) {
    try {
      const registry = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      const session = registry && registry.version === SESSION_VERSION && registry.tenants
        ? registry.tenants[tenantId]
        : null;
      if (
        !session ||
        session.principalType !== "firebase_uid" ||
        session.assetId !== assetId ||
        session.tenantId !== tenantId ||
        Number(session.expiresAt) <= Date.now() + 30000
      ) return null;
      const claims = tokenClaims(session.globalReaderToken);
      if (
        claims.principalType !== "firebase_uid" ||
        claims.tenantId !== tenantId ||
        Number(claims.exp) * 1000 !== Number(session.expiresAt)
      ) return null;
      return session;
    } catch { return null; }
  }

  function clearTenant(tenantId, assetId, principalType) {
    if (principalType === "anonymous_free") {
      sessionStorage.removeItem(FREE_STORAGE_KEY);
    } else {
      try { const registry = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); if (registry && registry.tenants && registry.tenants[tenantId]?.principalType === "firebase_uid") { delete registry.tenants[tenantId]; localStorage.setItem(STORAGE_KEY, JSON.stringify(registry)); } } catch {}
    }
    if (canonicalSession?.tenantId === tenantId && (!assetId || canonicalSession.assetId === assetId)) canonicalSession = null;
  }

  async function exchange() {
    const handoff = fragmentHandoff();
    if (!handoff) return null;
    const context = rootContext();
    if (!dashboardUrl || !context.assetId) throw new Error("The canonical reader handoff could not identify this publication.");
    const response = await fetch(`${dashboardUrl}/api/reader/media/handoff/exchange`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ handoff, assetId: context.assetId }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success !== true || !["firebase_uid", "anonymous_free"].includes(payload.principalType)) { const error = new Error(payload.error || "The canonical reader handoff was rejected."); error.status = response.status; error.canonicalHandoff = true; throw error; }
    return persist(payload);
  }

  const ready = exchange();
  window.KobaReaderHandoff = {
    ready,
    sessionForAsset(assetId, tenantId) {
      if (canonicalSession && canonicalSession.assetId === assetId && (!tenantId || canonicalSession.tenantId === tenantId)) return canonicalSession;
      return tenantId
        ? storedFirebaseSession(assetId, tenantId) || storedFreeSession(assetId, tenantId)
        : null;
    },
    clearTenant
  };
})();
