// assets/jubilee-core.js - KOBA-I catalog, checkout, and audiobook bootstrap

(function () {
  "use strict";

  const immersiveCanvasNode = document.getElementById("jubilee-bloom-root");
  const catalogShelfNodes = typeof document.querySelectorAll === "function"
    ? Array.from(document.querySelectorAll(".jubilee-catalog-root, #jubilee-catalog-root"))
    : [document.getElementById("jubilee-catalog-root")].filter(Boolean);
  const config = typeof JubileeConfig !== "undefined" ? JubileeConfig : {};
  const baseDashboardUrl = String(config.dashboardUrl || "http://localhost:3000").replace(/\/$/, "");
  const READER_SESSION_STORAGE_KEY = "koba_reader_session";
  const READER_SESSION_VERSION = 2;
  const EXPIRATION_SKEW_MS = 30 * 1000;

  if (immersiveCanvasNode) {
    const assetKey = immersiveCanvasNode.getAttribute("data-asset") || "";
    const studioKey = immersiveCanvasNode.getAttribute("data-studio-key") || "";
    const paidPublication = immersiveCanvasNode.getAttribute("data-paid-publication") === "true";
    if (!assetKey) return;

    const handoffReady = window.KobaReaderHandoff ? window.KobaReaderHandoff.ready : Promise.resolve(null);
    handoffReady.then(() => {
      const canonicalSession = window.KobaReaderHandoff
        ? window.KobaReaderHandoff.sessionForAsset(assetKey, studioKey)
        : null;
      if (paidPublication && !canonicalSession) {
        window.location.replace(`${baseDashboardUrl}/reader/open?assetId=${encodeURIComponent(assetKey)}`);
        return;
      }
      return initializeImmersivePublication(assetKey, studioKey, paidPublication);
    }).catch((error) => {
      showImmersiveError(error instanceof Error ? error.message : "Unable to open this publication.");
    });
  } else if (catalogShelfNodes.length) {
    const render = () => catalogShelfNodes.forEach((catalogShelfNode) => {
      const studioKey =
        catalogShelfNode.getAttribute("data-studio-key") ||
        String(config.studioKey || "");
      const productType = catalogShelfNode.getAttribute("data-type") || "";
      const catalogScope = catalogShelfNode.getAttribute("data-scope") === "global" ? "global" : "tenant";
      const catalogSection = catalogShelfNode.getAttribute("data-section") || "all";
      renderAuthorLibrary(studioKey, productType, catalogScope, catalogSection, catalogShelfNode);
    });
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", render, { once: true });
    } else {
      render();
    }
  }

  function readSessionRegistry() {
    try {
      const parsed = JSON.parse(localStorage.getItem(READER_SESSION_STORAGE_KEY) || "null");
      if (!parsed || parsed.version !== READER_SESSION_VERSION || !parsed.tenants || typeof parsed.tenants !== "object") {
        return { version: READER_SESSION_VERSION, tenants: {} };
      }
      return parsed;
    } catch {
      return { version: READER_SESSION_VERSION, tenants: {} };
    }
  }

  function writeSessionRegistry(registry) {
    try {
      localStorage.setItem(READER_SESSION_STORAGE_KEY, JSON.stringify(registry));
    } catch {
      // Storage can be unavailable in hardened/private browser contexts. The
      // server remains authoritative and the current page can still continue.
    }
  }

  function readGlobalReaderSession(tenantId) {
    if (!tenantId) return null;
    const registry = readSessionRegistry();
    const session = registry.tenants[tenantId];
    if (
      !session ||
      typeof session.globalReaderToken !== "string" ||
      !session.globalReaderToken ||
      !Number.isFinite(Number(session.expiresAt)) ||
      Number(session.expiresAt) <= Date.now() + EXPIRATION_SKEW_MS
    ) {
      if (session) {
        delete registry.tenants[tenantId];
        writeSessionRegistry(registry);
      }
      return null;
    }
    return session;
  }

  function clearGlobalReaderSession(tenantId) {
    const registry = readSessionRegistry();
    if (!registry.tenants[tenantId]) return;
    delete registry.tenants[tenantId];
    writeSessionRegistry(registry);
  }

  function hasAnyGlobalReaderSession() {
    const registry = readSessionRegistry();
    return Object.keys(registry.tenants).some((tenantId) =>
      Boolean(readGlobalReaderSession(tenantId))
    );
  }

  function listGlobalReaderSessions() {
    const registry = readSessionRegistry();
    return Object.keys(registry.tenants)
      .map((tenantId) => readGlobalReaderSession(tenantId))
      .filter(Boolean);
  }

  function isAuthorizationFailure(error) {
    return Boolean(error && (error.status === 401 || error.status === 403));
  }

  async function initializeImmersivePublication(assetKey, studioKey, paidPublication) {
    const canonicalSession = window.KobaReaderHandoff
      ? window.KobaReaderHandoff.sessionForAsset(assetKey, studioKey)
      : null;
    if (canonicalSession) {
      try {
        bootBloomPlayerWithData(await fetchAuthorizedPublication(assetKey, canonicalSession.globalReaderToken));
        return;
      } catch (error) {
        window.KobaReaderHandoff.clearTenant(canonicalSession.tenantId, canonicalSession.assetId, canonicalSession.principalType);
        error.canonicalHandoff = true;
        throw error;
      }
    }
    const query = new URLSearchParams(window.location.search);
    const checkoutSessionId = query.get("session_id") || "";
    let storedSession = readGlobalReaderSession(studioKey);
    let readerToken = storedSession ? storedSession.globalReaderToken : "";

    if (checkoutSessionId) {
      window.location.replace(
        `${baseDashboardUrl}/reader/claim?session_id=${encodeURIComponent(checkoutSessionId)}`
      );
      return;
    }

    // Reuse only canonical bearer sessions previously established through the
    // reader handoff. Free access is established by the Turnstile launcher.
    const candidateSessions = storedSession
      ? [
          storedSession,
          ...listGlobalReaderSessions().filter(
            (session) => session.tenantId !== storedSession.tenantId
          )
        ]
      : listGlobalReaderSessions();
    let assetIsUnowned = false;

    for (const candidateSession of candidateSessions) {
      try {
        const publication = await fetchAuthorizedPublication(
          assetKey,
          candidateSession.globalReaderToken
        );
        bootBloomPlayerWithData(publication);
        return;
      } catch (error) {
        if (error && error.status === 401) {
          clearGlobalReaderSession(candidateSession.tenantId);
          continue;
        }
        if (error && error.status === 403) {
          if (error.payload && error.payload.code === "ASSET_NOT_OWNED") {
            assetIsUnowned = true;
          }
          continue;
        }
        throw error;
      }
    }

    if (assetIsUnowned) {
      showPurchaseRequired(assetKey);
      return;
    }
    const launcher = paidPublication ? "/reader/open" : "/reader/free";
    window.location.replace(
      `${baseDashboardUrl}${launcher}?assetId=${encodeURIComponent(assetKey)}`
    );
  }

  async function fetchAuthorizedPublication(assetKey, readerToken) {
    const target = new URL(`${baseDashboardUrl}/api/media/manifest`);
    target.searchParams.set("asset", assetKey);
    const headers = {};
    if (readerToken) headers.Authorization = `Bearer ${readerToken}`;
    const payload = await requestJson(target.toString(), {
      headers
    });
    const publication = Array.isArray(payload.products)
      ? payload.products.find((item) => item.assetKey === assetKey)
      : null;
    if (!publication) throw new Error("The authorized media manifest did not contain this publication.");
    return publication;
  }

  async function requestJson(url, options) {
    const response = await fetch(url, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success === false) {
      const error = new Error(payload.error || `Request failed with status ${response.status}.`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  function showImmersiveError(message) {
    const region = document.getElementById("koba-ui-error-region");
    if (region) region.textContent = message || "";
  }

  function showPurchaseRequired(assetKey) {
    const vaultDoor = document.getElementById("koba-vault-door");
    if (!vaultDoor) return;
    vaultDoor.style.display = "flex";
    vaultDoor.innerHTML = `
      <div class="koba-vault-card">
        <h2 style="color:#fff; margin-top:0;">This title is not in your library yet</h2>
        <p style="color:#94a3b8;">Your reader session is still active. Purchase this title to add it to your library.</p>
        <button id="koba-purchase-required-trigger" class="koba-primary-btn" type="button">Purchase Now</button>
        <p style="margin:14px 0 0; color:#94a3b8; font-size:12px;">Already purchased on another device? Use the sign-in link from the bookstore.</p>
      </div>
    `;
    const purchaseButton = document.getElementById("koba-purchase-required-trigger");
    if (purchaseButton) {
      purchaseButton.addEventListener("click", () => {
        startListenerPurchase(assetKey, purchaseButton);
      });
    }
  }

  function bootBloomPlayerWithData(serverPayload) {
    const vaultDoor = document.getElementById("koba-vault-door");
    if (vaultDoor) vaultDoor.style.display = "none";
    const pluginBaseUrl =
      typeof config.pluginUrl === "string" && config.pluginUrl.trim()
        ? config.pluginUrl.trim().replace(/\/$/, "")
        : "/wp-content/plugins/koba-i-audio";
    const localizedLogoUrl =
      typeof config.logoUrl === "string" && config.logoUrl.trim()
        ? config.logoUrl.trim()
        : `${pluginBaseUrl}/assets/koba-logo-text-transparent.png`;
    window.kobaData = {
      assetId: serverPayload.assetId || serverPayload.assetKey || "",
      assetKey: serverPayload.assetKey || serverPayload.assetId || "",
      title: serverPayload.title || "KOBA-I Audiobook",
      coverUrl: serverPayload.coverUrl || serverPayload.coverArtUrl || "",
      coverArtUrl: serverPayload.coverArtUrl || serverPayload.coverUrl || "",
      bgImage: serverPayload.bgImage || serverPayload.bgImageUrl || "",
      bgImageUrl: serverPayload.bgImageUrl || serverPayload.bgImage || "",
      logoUrl: localizedLogoUrl,
      mediaType: serverPayload.mediaType || serverPayload.type || "Audiobook",
      autoAdvance: serverPayload.autoAdvance !== false,
      chapters: Array.isArray(serverPayload.chapters) ? serverPayload.chapters : []
    };
    const playerRoot = document.getElementById("koba-bloom-root");
    const playerWrapper = document.getElementById("bloom-player-wrapper");
    if (playerWrapper) playerWrapper.style.setProperty("display", "block", "important");
    if (!playerRoot || typeof window.initKobaBloomPlayer !== "function") {
      throw new Error("KOBA audiobook player initializer is unavailable.");
    }
    window.initKobaBloomPlayer(playerRoot, window.kobaData, "full");
  }

  async function renderAuthorLibrary(_studioKey, productType, catalogScope, catalogSection, container) {
    if (!config.apiUrl) return renderCatalogError(container, "The catalog service is not configured.");
    try {
      const targetUrl = new URL(config.apiUrl);
      targetUrl.searchParams.set("scope", catalogScope === "global" ? "global" : "tenant");
      if (productType) targetUrl.searchParams.set("type", productType);
      const result = await requestJson(targetUrl.toString());
      if (!Array.isArray(result.products) || result.products.length === 0) {
        return renderCatalogError(container, "No publications are available yet.");
      }
      buildCatalogGridUI(container, result.products, catalogSection);
    } catch (error) {
      renderCatalogError(container, error instanceof Error ? error.message : "Unable to load the catalog.");
    }
  }

  function renderCatalogError(container, message) {
    container.innerHTML = `<div role="status" style="padding:32px;text-align:center;color:#64748b;">${escapeHtml(message)}</div>`;
  }

  async function startListenerPurchase(assetKey, button) {
    const originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = "Opening Secure Checkout...";
    try {
      const payload = await requestJson(`${baseDashboardUrl}/api/checkout/listener-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetKey })
      });
      if (!payload.checkoutUrl) throw new Error("Stripe did not return a checkout address.");
      window.location.assign(payload.checkoutUrl);
    } catch (error) {
      button.disabled = false;
      button.textContent = originalLabel;
      const errorCode = error && error.payload ? error.payload.code : "";
      if (
        errorCode === "PAYMENT_CONFIGURATION_REQUIRED" ||
        errorCode === "PAYMENT_ACCOUNT_ACTION_REQUIRED"
      ) {
        renderPurchaseUnavailable(button);
        return;
      }
      window.alert(error instanceof Error ? error.message : "Unable to open secure checkout.");
    }
  }

  function renderPurchaseUnavailable(button) {
    const card = button.closest("[data-koba-catalog-card]");
    if (!card) return;

    card.querySelectorAll("[data-koba-card-actions]").forEach((slot) => {
      slot.innerHTML = `
        <div class="jubilee-purchase-unavailable" role="status">
          This title is temporarily unavailable for purchase. Please check back soon.
        </div>`;
    });
  }

  function normalizeCatalogType(item) {
    const assetKey = String(item.assetKey || item.id || "").toLowerCase();
    const rawType = String(item.type || item.assetType || item.mediaType || "")
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, "");

    if (["ebook", "digitalbook"].includes(rawType) || assetKey.startsWith("ebk_")) {
      return "ebook";
    }
    if (["audiobook", "audio"].includes(rawType) || assetKey.startsWith("abk_") || assetKey.startsWith("aud_")) {
      return "audiobook";
    }
    return "publication";
  }

  function explicitCatalogPrice(item) {
    const hasPrice = Object.prototype.hasOwnProperty.call(item, "price");
    const hasUnitPrice = Object.prototype.hasOwnProperty.call(item, "unitPrice");
    if (!hasPrice && !hasUnitPrice) return null;
    const raw = hasPrice ? item.price : item.unitPrice;
    if (raw === null || raw === undefined || raw === "") return null;
    const numeric = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
  }

  function catalogFormats(item) {
    const declared = Array.isArray(item.formats)
      ? item.formats.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim())
      : [];
    if (declared.length) return declared;
    const type = normalizeCatalogType(item);
    if (type === "ebook") return ["E-book"];
    if (type === "audiobook") return ["Audiobook"];
    return ["Publication"];
  }

  function supportsCatalogFormat(item, family) {
    const values = catalogFormats(item).map((value) => value.toLowerCase().replace(/[\s_-]+/g, ""));
    const written = values.some((value) => /ebook|written|text|illustrated/.test(value));
    const spoken = values.some((value) => /audio|audiobook|spoken|narrat/.test(value));
    return family === "written" ? written : spoken;
  }

  function filterCatalogProducts(productsList, catalogSection) {
    return productsList.filter((item) => {
      const price = explicitCatalogPrice(item);
      if (catalogSection === "paid") return price !== null && price > 0;
      if (catalogSection === "written-free") return price === 0 && supportsCatalogFormat(item, "written");
      if (catalogSection === "spoken-free") return price === 0 && supportsCatalogFormat(item, "spoken");
      return price !== null;
    });
  }

  function groupCatalogProducts(productsList) {
    const definitions = [
      { key: "audiobook", label: "Audiobooks" },
      { key: "ebook", label: "E-books" },
      { key: "publication", label: "Publications" }
    ];
    const grouped = new Map(definitions.map((definition) => [definition.key, []]));
    productsList.forEach((item) => grouped.get(normalizeCatalogType(item)).push(item));
    return definitions
      .map((definition) => ({ ...definition, products: grouped.get(definition.key) }))
      .filter((group) => group.products.length > 0);
  }

  function buildCatalogGridUI(container, productsList, catalogSection = "all") {
    container.innerHTML = "";
    const filteredProducts = filterCatalogProducts(productsList, catalogSection);
    if (!filteredProducts.length) {
      const emptyMessage = catalogSection === "written-free"
        ? "Free written works will appear here when they are available."
        : catalogSection === "spoken-free"
          ? "Free spoken-word works will appear here when they are available."
          : "No publications are available in this collection yet.";
      return renderCatalogError(container, emptyMessage);
    }
    const sectionBlock = document.createElement("div");
    sectionBlock.className = "jubilee-catalog-groups";
    sectionBlock.style.width = "100%";
    sectionBlock.innerHTML = groupCatalogProducts(filteredProducts).map((group) => {
      const headingId = `${container.id || "koba-catalog"}-${group.key}`;
      return `
      <section class="jubilee-catalog-group" data-koba-catalog-group="${group.key}" aria-labelledby="${escapeHtml(headingId)}">
        <h3 id="${escapeHtml(headingId)}" class="jubilee-catalog-group-title">${group.label}</h3>
        <div class="jubilee-bookshelf-track">
        ${group.products.map((item) => {
          const assetKey = String(item.assetKey || item.id || "");
          const numericPrice = explicitCatalogPrice(item);
          const isPaid = numericPrice !== null && numericPrice > 0;
          const openLabel = catalogSection === "written-free"
            ? "Read Free"
            : catalogSection === "spoken-free"
              ? "Listen Free"
              : normalizeCatalogType(item) === "ebook" ? "Open Book" : "Listen Now";
          const priceLabel = isPaid ? `$${numericPrice.toFixed(2)}` : "Free";
          const formatLabel = catalogFormats(item).join(" · ");
          const synopsis = String(
            item.synopsis || item.description || item.summary || item.excerpt ||
            "A synopsis has not been added for this publication yet."
          );
          const primaryAction = isPaid
            ? buildCatalogPurchaseAction(assetKey, numericPrice)
            : buildCatalogOpenAction(assetKey, openLabel, true);
          const recoveryLink = isPaid
            ? `<a href="${baseDashboardUrl}/reader/open?assetId=${encodeURIComponent(assetKey)}" class="already-purchased-link">Already purchased? Sign in</a>`
            : "";
          return `
            <article class="jubilee-bookshelf-card" data-koba-catalog-card="${escapeHtml(assetKey)}" tabindex="0" role="group" aria-label="${escapeHtml(item.title || "Publication")}. Activate the card to read its synopsis." aria-expanded="false">
              <div class="jubilee-card-inner">
                <section class="jubilee-card-face jubilee-card-front">
                  <img class="jubilee-card-cover" src="${escapeHtml(item.coverUrl || item.coverArtUrl || "")}" alt="${escapeHtml(item.title || "Publication cover")}" />
                  <h4 class="jubilee-card-title">${escapeHtml(item.title || "Untitled")}</h4>
                  <div class="jubilee-product-format">${escapeHtml(formatLabel)}</div>
                  <div class="jubilee-product-price" data-product-price="${numericPrice}">${priceLabel}</div>
                  <div class="jubilee-card-primary" data-koba-card-actions>${primaryAction}</div>
                  ${recoveryLink}
                </section>
                <section class="jubilee-card-face jubilee-card-back" aria-label="Synopsis for ${escapeHtml(item.title || "this publication")}">
                  <div class="jubilee-card-back-header">
                    <h4>Synopsis</h4>
                  </div>
                  <div class="jubilee-card-synopsis" tabindex="0">${escapeHtml(synopsis)}</div>
                  <div class="jubilee-card-primary jubilee-card-back-action" data-koba-card-actions>${primaryAction}</div>
                </section>
              </div>
            </article>`;
        }).join("")}
        </div>
      </section>`;
    }).join("");
    let pointerStart = null;
    let suppressCardFlip = false;
    sectionBlock.addEventListener("pointerdown", (event) => {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest("a, button, input, textarea, select")) return;
      const card = event.target.closest("[data-koba-catalog-card]");
      pointerStart = card
        ? { card, x: event.clientX, y: event.clientY }
        : null;
      suppressCardFlip = false;
    });
    sectionBlock.addEventListener("pointermove", (event) => {
      if (!pointerStart) return;
      if (
        Math.abs(event.clientX - pointerStart.x) > 10 ||
        Math.abs(event.clientY - pointerStart.y) > 10
      ) {
        suppressCardFlip = true;
      }
    });
    sectionBlock.addEventListener("pointercancel", () => {
      pointerStart = null;
      suppressCardFlip = true;
    });
    sectionBlock.addEventListener("click", (event) => {
      const target = event.target instanceof Element
        ? event.target.closest("[data-koba-purchase]")
        : null;
      if (target instanceof HTMLButtonElement) {
        event.preventDefault();
        const assetKey = target.dataset.kobaPurchase || "";
        if (assetKey) startListenerPurchase(assetKey, target);
        return;
      }

      if (!(event.target instanceof Element)) return;
      if (event.target.closest("a, button, input, textarea, select")) return;
      const card = event.target.closest("[data-koba-catalog-card]");
      if (!card || suppressCardFlip) {
        pointerStart = null;
        suppressCardFlip = false;
        return;
      }
      toggleCatalogCard(card);
      pointerStart = null;
      suppressCardFlip = false;
    });
    sectionBlock.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      if (!(event.target instanceof Element)) return;
      const card = event.target.closest("[data-koba-catalog-card]");
      if (!card || event.target !== card) return;
      event.preventDefault();
      toggleCatalogCard(card);
    });
    container.appendChild(sectionBlock);
    hydrateCatalogEntitlements(sectionBlock);
  }

  function toggleCatalogCard(card) {
    const inner = card.querySelector(".jubilee-card-inner");
    if (!inner) return;
    const isFlipped = inner.classList.toggle("is-flipped");
    card.setAttribute("aria-expanded", String(isFlipped));
  }

  function buildCatalogPurchaseAction(assetKey, numericPrice) {
    return `<button type="button" class="jubilee-catalog-action jubilee-catalog-action--buy" data-koba-primary-action data-koba-purchase="${escapeHtml(assetKey)}">Buy Now — $${numericPrice.toFixed(2)}</button>`;
  }

  function buildCatalogOpenAction(assetKey, openLabel, freeAccess) {
    const target = freeAccess
      ? `${baseDashboardUrl}/reader/free?assetId=${encodeURIComponent(assetKey)}`
      : `${baseDashboardUrl}/reader/open?assetId=${encodeURIComponent(assetKey)}`;
    return `<a href="${escapeHtml(target)}" class="jubilee-catalog-action jubilee-catalog-action--owned" data-koba-primary-action>${escapeHtml(openLabel)}</a>`;
  }

  async function hydrateCatalogEntitlements(sectionBlock) {
    const sessions = listGlobalReaderSessions();
    if (!sessions.length) return;

    const paidCards = sectionBlock.querySelectorAll("[data-koba-catalog-card]");
    await Promise.all(Array.from(paidCards).map(async (card) => {
      const assetKey = card.getAttribute("data-koba-catalog-card") || "";
      if (!assetKey || !card.querySelector("[data-koba-purchase]")) return;

      for (const session of sessions) {
        try {
          const publication = await fetchAuthorizedPublication(assetKey, session.globalReaderToken);
          const productType = String(publication.type || publication.mediaType || "").toLowerCase();
          const openLabel = productType === "ebook" ? "Open Book" : "Listen Now";
          card.querySelectorAll("[data-koba-card-actions]").forEach((slot) => {
            slot.innerHTML = buildCatalogOpenAction(assetKey, openLabel, false);
          });
          const recoveryLink = card.querySelector(".already-purchased-link");
          if (recoveryLink) recoveryLink.remove();
          return;
        } catch (error) {
          if (error && error.status === 401) {
            clearGlobalReaderSession(session.tenantId);
          } else if (!error || error.status !== 403) {
            console.warn("Unable to confirm catalog ownership.", error);
          }
        }
      }
    }));
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    })[character]);
  }
})();
