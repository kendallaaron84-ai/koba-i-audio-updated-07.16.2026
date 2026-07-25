// assets/jubilee-core.js - KOBA-I catalog, checkout, and audiobook bootstrap

(function () {
  "use strict";

  const immersiveCanvasNode = document.getElementById("jubilee-bloom-root");
  const catalogShelfNode = document.getElementById("jubilee-catalog-root");
  const config = typeof JubileeConfig !== "undefined" ? JubileeConfig : {};
  const baseDashboardUrl = String(config.dashboardUrl || "http://localhost:3000").replace(/\/$/, "");
  const sessionUserPhone = String(config.userPhone || "");
  const READER_SESSION_STORAGE_KEY = "koba_reader_session";
  const READER_SESSION_VERSION = 2;
  const EXPIRATION_SKEW_MS = 30 * 1000;

  if (immersiveCanvasNode) {
    const assetKey = immersiveCanvasNode.getAttribute("data-asset") || "";
    const studioKey = immersiveCanvasNode.getAttribute("data-studio-key") || "";
    if (!assetKey) return;

    initializeImmersivePublication(assetKey, studioKey).catch((error) => {
      showImmersiveError(error instanceof Error ? error.message : "Unable to open this publication.");
      if (!hasAnyGlobalReaderSession() || isAuthorizationFailure(error)) {
        bindImmersiveTemplateListeners(assetKey, studioKey);
      }
    });
  } else if (catalogShelfNode) {
    const studioKey =
      catalogShelfNode.getAttribute("data-studio-key") ||
      String(config.studioKey || "");
    const productType = catalogShelfNode.getAttribute("data-type") || "";
    const render = () => renderAuthorLibrary(studioKey, productType, catalogShelfNode);
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

  function persistGlobalReaderSession(tenantId, readerToken, normalizedPhone, expiresAt) {
    const expiration = Number(expiresAt) || readerTokenExpiresAt(readerToken);
    if (!tenantId || !readerToken || !Number.isFinite(expiration) || expiration <= Date.now() + EXPIRATION_SKEW_MS) {
      throw new Error("The reader access token did not contain a valid expiration time.");
    }
    const registry = readSessionRegistry();
    registry.tenants[tenantId] = {
      tenantId,
      globalReaderToken: readerToken,
      normalizedPhone: String(normalizedPhone || "").replace(/\D/g, ""),
      expiresAt: expiration,
      savedAt: Date.now()
    };
    writeSessionRegistry(registry);
    return registry.tenants[tenantId];
  }

  function readerTokenExpiresAt(readerToken) {
    try {
      const encodedPayload = String(readerToken).split(".")[1] || "";
      const base64 = encodedPayload.replace(/-/g, "+").replace(/_/g, "/");
      const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
      const payload = JSON.parse(window.atob(padded));
      return Number(payload.exp) * 1000 || 0;
    } catch {
      return 0;
    }
  }

  function readerTokenTenantId(readerToken) {
    try {
      const encodedPayload = String(readerToken).split(".")[1] || "";
      const base64 = encodedPayload.replace(/-/g, "+").replace(/_/g, "/");
      const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
      const payload = JSON.parse(window.atob(padded));
      return typeof payload.tenantId === "string" ? payload.tenantId : "";
    } catch {
      return "";
    }
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

  function cleanCheckoutQuery() {
    const url = new URL(window.location.href);
    url.searchParams.delete("session_id");
    url.searchParams.delete("status");
    window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
  }

  async function initializeImmersivePublication(assetKey, studioKey) {
    const query = new URLSearchParams(window.location.search);
    const checkoutSessionId = query.get("session_id") || "";
    let storedSession = readGlobalReaderSession(studioKey);
    let readerToken = storedSession ? storedSession.globalReaderToken : "";

    // One-time migration for readers who completed checkout before the
    // tenant-scoped registry was introduced.
    if (!readerToken) {
      const legacyTokenKey = `koba_reader_token_${assetKey}`;
      const legacyToken = sessionStorage.getItem(legacyTokenKey) || "";
      if (legacyToken && readerTokenExpiresAt(legacyToken) > Date.now() + EXPIRATION_SKEW_MS) {
        storedSession = persistGlobalReaderSession(
          readerTokenTenantId(legacyToken) || studioKey,
          legacyToken,
          sessionUserPhone,
          readerTokenExpiresAt(legacyToken)
        );
        readerToken = storedSession.globalReaderToken;
        sessionStorage.removeItem(legacyTokenKey);
      }
    }

    if (checkoutSessionId) {
      const completion = await completeListenerCheckout(assetKey, checkoutSessionId);
      readerToken = String(completion.readerToken || "");
      if (!readerToken) throw new Error("Stripe completed the payment but no reader access token was returned.");
      const completionTenantId = String(completion.tenantId || studioKey);
      if (!completionTenantId) throw new Error("The completed purchase did not return an author-library identity.");
      storedSession = persistGlobalReaderSession(
        completionTenantId,
        readerToken,
        completion.normalizedPhone,
        completion.expiresAt
      );
      cleanCheckoutQuery();
    }

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
    bindImmersiveTemplateListeners(assetKey, studioKey);
  }

  async function completeListenerCheckout(assetKey, checkoutSessionId) {
    return requestJson(`${baseDashboardUrl}/api/checkout/listener-session/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetKey, checkoutSessionId })
    });
  }

  async function fetchAuthorizedPublication(assetKey, readerToken) {
    const target = new URL(`${baseDashboardUrl}/api/media/manifest`);
    target.searchParams.set("asset", assetKey);
    const payload = await requestJson(target.toString(), {
      headers: { Authorization: `Bearer ${readerToken}` }
    });
    const renewedSession = payload.readerSession;
    if (renewedSession && renewedSession.readerToken) {
      const renewedTenantId = String(
        renewedSession.tenantId || readerTokenTenantId(renewedSession.readerToken)
      );
      const existingSession = readGlobalReaderSession(renewedTenantId);
      persistGlobalReaderSession(
        renewedTenantId,
        String(renewedSession.readerToken),
        existingSession ? existingSession.normalizedPhone : "",
        renewedSession.expiresAt
      );
    }
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

  function bindImmersiveTemplateListeners(currentAsset, currentStudio) {
    const phoneInput = document.getElementById("koba-auth-phone-input");
    const sendBtn = document.getElementById("koba-auth-submit-trigger");
    const otpInput = document.getElementById("koba-auth-otp-input");
    const verifyBtn = document.getElementById("koba-otp-submit-trigger");
    const phoneDrawer = document.getElementById("koba-sms-input-drawer");
    const verifyDrawer = document.getElementById("koba-sms-verification-drawer");
    const errorRegion = document.getElementById("koba-ui-error-region");

    if (!phoneInput || !sendBtn || !otpInput || !verifyBtn) return;
    if (sendBtn.dataset.kobaBound === "true") return;
    sendBtn.dataset.kobaBound = "true";
    verifyBtn.dataset.kobaBound = "true";
    if (!phoneInput.value && sessionUserPhone) phoneInput.value = sessionUserPhone;

    const showError = (message) => {
      if (errorRegion) errorRegion.textContent = message || "";
    };
    const resolvePhone = () => {
      let digits = phoneInput.value.replace(/\D/g, "");
      if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
      return digits.length === 10 ? digits : "";
    };

    sendBtn.addEventListener("click", async (event) => {
      event.preventDefault();
      showError("");
      const phone = resolvePhone();
      if (!phone) return showError("Please enter a valid 10-digit phone number.");
      sendBtn.disabled = true;
      sendBtn.textContent = "Sending Access Code...";
      try {
        await triggerUnifiedCheckout(currentAsset, currentStudio, phone);
        if (phoneDrawer) phoneDrawer.style.display = "none";
        if (verifyDrawer) verifyDrawer.style.display = "block";
        otpInput.focus();
      } catch (error) {
        showError(error instanceof Error ? error.message : "Unable to send the access code.");
      } finally {
        sendBtn.disabled = false;
        sendBtn.textContent = "Send Access Code";
      }
    });

    verifyBtn.addEventListener("click", async (event) => {
      event.preventDefault();
      showError("");
      const phone = resolvePhone();
      const pinCode = otpInput.value.replace(/\D/g, "");
      if (!phone) return showError("Your phone number is missing or invalid.");
      if (pinCode.length !== 6) return showError("Enter the six-digit verification code.");
      verifyBtn.disabled = true;
      verifyBtn.textContent = "Verifying...";
      try {
        const payload = await submitPinVerify(currentAsset, currentStudio, phone, pinCode);
        if (payload.readerToken) {
          persistGlobalReaderSession(
            String(payload.tenantId || currentStudio),
            String(payload.readerToken),
            payload.normalizedPhone || phone,
            payload.expiresAt
          );
        }
        bootBloomPlayerWithData(payload);
      } catch (error) {
        showError(error instanceof Error ? error.message : "Verification was refused.");
        verifyBtn.disabled = false;
        verifyBtn.textContent = "Verify Passcode";
      }
    });
  }

  async function triggerUnifiedCheckout(assetId, studioKey, phone) {
    await requestJson(`${baseDashboardUrl}/api/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Studio-Key": studioKey },
      body: JSON.stringify({ assetId, assetKey: assetId, phone, phoneNumber: phone })
    });
    return triggerTwilioSmsSend(assetId, studioKey, phone);
  }

  window.triggerUnifiedCheckout = triggerUnifiedCheckout;

  function triggerTwilioSmsSend(assetId, studioKey, phone) {
    return requestJson(`${baseDashboardUrl}/api/auth/sms-send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Studio-Key": studioKey },
      body: JSON.stringify({ phone, phoneNumber: phone, assetKey: assetId, assetId })
    });
  }

  function submitPinVerify(assetId, studioKey, phone, pinCode) {
    return requestJson(`${baseDashboardUrl}/api/auth/sms-verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Studio-Key": studioKey },
      body: JSON.stringify({ phone, phoneNumber: phone, assetKey: assetId, assetId, code: pinCode, otpCode: pinCode })
    });
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

  async function renderAuthorLibrary(studioKey, productType, container) {
    if (!config.apiUrl) return renderCatalogError(container, "The catalog service is not configured.");
    if (!studioKey) return renderCatalogError(container, "KOBA-I Audio must be activated before the bookstore can load.");
    try {
      const targetUrl = new URL(config.apiUrl);
      targetUrl.searchParams.set("author", "tenant");
      if (productType) targetUrl.searchParams.set("type", productType);
      const result = await requestJson(targetUrl.toString(), {
        headers: {
          "X-Studio-Key": studioKey,
        },
      });
      if (!Array.isArray(result.products) || result.products.length === 0) {
        return renderCatalogError(container, "No publications are available yet.");
      }
      buildCatalogGridUI(container, result.products);
    } catch (error) {
      renderCatalogError(container, error instanceof Error ? error.message : "Unable to load the catalog.");
    }
  }

  function renderCatalogError(container, message) {
    container.innerHTML = `<div role="status" style="padding:32px;text-align:center;color:#64748b;">${escapeHtml(message)}</div>`;
  }

  function publicationPath(assetKey, recovery) {
    const suffix = recovery ? "/?recover=1" : "/";
    return `/koba_publication/${encodeURIComponent(assetKey)}${suffix}`;
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

  function buildCatalogGridUI(container, productsList) {
    container.innerHTML = "";
    const sectionBlock = document.createElement("div");
    sectionBlock.style.width = "100%";
    sectionBlock.innerHTML = `
      <div class="jubilee-bookshelf-track">
        ${productsList.map((item) => {
          const assetKey = String(item.assetKey || item.id || "");
          const numericPrice = Number(item.price ?? item.unitPrice ?? 0);
          const isPaid = Number.isFinite(numericPrice) && numericPrice > 0;
          const productType = String(item.type || "").toLowerCase();
          const openLabel = productType === "ebook" ? "Open Book" : "Listen Now";
          const priceLabel = isPaid ? `$${numericPrice.toFixed(2)}` : "Free";
          const synopsis = String(
            item.synopsis || item.description || item.summary || item.excerpt ||
            "A synopsis has not been added for this publication yet."
          );
          const primaryAction = isPaid
            ? buildCatalogPurchaseAction(assetKey, numericPrice)
            : buildCatalogOpenAction(assetKey, openLabel);
          const recoveryLink = isPaid
            ? `<a href="${publicationPath(assetKey, true)}" class="already-purchased-link">Already purchased? Sign in</a>`
            : "";
          return `
            <article class="jubilee-bookshelf-card" data-koba-catalog-card="${escapeHtml(assetKey)}" tabindex="0" role="group" aria-label="${escapeHtml(item.title || "Publication")}. Activate the card to read its synopsis." aria-expanded="false">
              <div class="jubilee-card-inner">
                <section class="jubilee-card-face jubilee-card-front">
                  <img class="jubilee-card-cover" src="${escapeHtml(item.coverUrl || item.coverArtUrl || "")}" alt="${escapeHtml(item.title || "Publication cover")}" />
                  <h4 class="jubilee-card-title">${escapeHtml(item.title || "Untitled")}</h4>
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
      </div>`;
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

  function buildCatalogOpenAction(assetKey, openLabel) {
    return `<a href="${publicationPath(assetKey, false)}" class="jubilee-catalog-action jubilee-catalog-action--owned" data-koba-primary-action>${escapeHtml(openLabel)}</a>`;
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
            slot.innerHTML = buildCatalogOpenAction(assetKey, openLabel);
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
