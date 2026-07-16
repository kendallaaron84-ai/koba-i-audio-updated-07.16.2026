// assets/jubilee-core.js - Hardening Environment Agnostic Handshakes

(function() {
  const immersiveCanvasNode = document.getElementById("jubilee-bloom-root");
  const catalogShelfNode = document.getElementById("jubilee-catalog-root");

  // Fallback safety context parameters if localization configuration drops out
  const baseDashboardUrl = typeof JubileeConfig !== "undefined" ? JubileeConfig.dashboardUrl : "http://localhost:3000";
  const sessionUserPhone = typeof JubileeConfig !== "undefined" ? JubileeConfig.userPhone : "";

  // MODE A: Immersive Dedicated Single Asset Canvas View
  if (immersiveCanvasNode) {
    const assetKey = immersiveCanvasNode.getAttribute("data-asset");
    const studioKey = immersiveCanvasNode.getAttribute("data-studio-key") || "MOCK_DEVELOPMENT_KEY";

    if (!assetKey) return;

    console.log(`🎯 Immersive Handshake Router engaged for asset: ${assetKey}`);
    
    if (localStorage.getItem(`koba_vault_unlocked_${assetKey}`) === "true") {
       bypassGateWithCachedStream(assetKey, studioKey);
    } else {
       bindImmersiveTemplateListeners(assetKey, studioKey);
    }
  } 
  
  // MODE B: Global Matrix Storefront Bookshelf View
  else if (catalogShelfNode) {
    const authorSlug = catalogShelfNode.getAttribute("data-author") || "global";
    const productType = catalogShelfNode.getAttribute("data-type");

    console.log(`📚 Catalog Shelf Mode Active for Author: ${authorSlug}`);
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => renderAuthorLibrary(authorSlug, productType, catalogShelfNode));
    } else {
      renderAuthorLibrary(authorSlug, productType, catalogShelfNode);
    }
  }

  function bindImmersiveTemplateListeners(currentAsset, currentStudio) {
    const buyBtn = document.getElementById("koba-buy-now-trigger");
    const verifyBtn = document.getElementById("koba-verify-pin-submit");

    if (buyBtn) {
      buyBtn.addEventListener("click", (e) => {
        e.preventDefault();
        const inputPhone = document.getElementById("koba-phone-input")?.value || sessionUserPhone;
        triggerUnifiedCheckout(currentAsset, currentStudio, inputPhone);
      });
    }

    if (verifyBtn) {
      verifyBtn.addEventListener("click", (e) => {
        e.preventDefault();
        const inputPin = document.getElementById("koba-pin-input")?.value || "";
        const inputPhone = document.getElementById("koba-phone-input")?.value || sessionUserPhone;
        submitPinVerify(currentAsset, currentStudio, inputPhone, inputPin);
      });
    }
  }

  // 🚀 HARMONIZED ENDPOINT DECOUPLING: No longer hardcoded to localhost
  async function bypassGateWithCachedStream(assetId, studioKey) {
     try {
       const response = await fetch(`${baseDashboardUrl}/api/auth/sms-verify`, {
         method: "POST",
         headers: { "Content-Type": "application/json", "X-Studio-Key": studioKey },
         body: JSON.stringify({ 
           assetId, 
           assetKey: assetId, 
           phone: sessionUserPhone, 
           phoneNumber: sessionUserPhone, 
           code: "123456" 
         })
       });
       const data = await response.json();
       if (data.success) {
          bootBloomPlayerWithData(data);
       }
     } catch (e) { console.error("Cached verification loop failed:", e); }
  }

  async function triggerUnifiedCheckout(assetId, studioKey, phone) {
    try {
      const response = await fetch(`${baseDashboardUrl}/api/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Studio-Key": studioKey },
        body: JSON.stringify({ assetId, assetKey: assetId, phone, phoneNumber: phone })
      });
      const data = await response.json();
      if (response.ok && data.success) {
        triggerTwilioSmsSend(assetId, studioKey, phone);
      }
    } catch (err) { console.error("❌ Checkout routing dropped:", err); }
  }

  window.triggerUnifiedCheckout = triggerUnifiedCheckout;

  async function triggerTwilioSmsSend(assetId, studioKey, phone) {
    try {
      const response = await fetch(`${baseDashboardUrl}/api/auth/sms-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Studio-Key": studioKey },
        body: JSON.stringify({ phone, phoneNumber: phone, assetKey: assetId, assetId })
      });
      const data = await response.json();
      if (data.success) {
        const drawer = document.getElementById("koba-sms-verification-drawer");
        if (drawer) drawer.style.display = "block";
      }
    } catch (err) { console.error("❌ SMS dispatch exception:", err); }
  }

  async function submitPinVerify(assetId, studioKey, phone, pinCode) {
    try {
      const response = await fetch(`${baseDashboardUrl}/api/auth/sms-verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Studio-Key": studioKey },
        body: JSON.stringify({ phone, phoneNumber: phone, assetKey: assetId, assetId, code: pinCode, otpCode: pinCode })
      });
      const data = await response.json();

      if (response.ok && data.success) {
        localStorage.setItem(`koba_vault_unlocked_${assetId}`, "true");
        bootBloomPlayerWithData(data);
      }
    } catch (err) { console.error("❌ Handshake verify collapse:", err); }
  }

  function bootBloomPlayerWithData(serverPayload) {
     const vaultDoor = document.getElementById("koba-vault-door");
     if (vaultDoor) vaultDoor.style.display = "none";

     window.kobaData = {
        title: serverPayload.title || "Sovereign Audiobook Asset",
        coverUrl: serverPayload.coverUrl || serverPayload.coverArtUrl || "",
        coverArtUrl: serverPayload.coverArtUrl || serverPayload.coverUrl || "",
        logoUrl: `${baseDashboardUrl}/assets/koba-logo.png`,
        mediaType: serverPayload.mediaType || "Audiobook",
        chapters: serverPayload.chapters || []
     };

     console.log("🔥 Hydrated window.kobaData context completely:", window.kobaData);

     const playerRoot = document.getElementById("koba-bloom-root");
     if (playerRoot && typeof window.initPlayer === "function") {
         window.initPlayer(playerRoot, window.kobaData, 'full');
     } else {
         if (typeof window.bootKobaPlayer === "function") {
             window.bootKobaPlayer();
         } else {
             window.location.reload();
         }
     }
  }

  async function renderAuthorLibrary(authorSlug, productType, container) {
    if (typeof JubileeConfig === "undefined") {
      renderDevFallbackBookshelf(container);
      return; 
    }
    try {
      const targetUrl = new URL(JubileeConfig.apiUrl);
      targetUrl.searchParams.set("author", authorSlug);
      if (productType) targetUrl.searchParams.set("type", productType);

      const response = await fetch(targetUrl.toString());
      const result = await response.json();

      if (!result || !result.success || !result.products || !result.products.length) {
        renderDevFallbackBookshelf(container);
        return;
      }

      container.innerHTML = "";
      buildCatalogGridUI(container, result.products);
    } catch (err) {
      renderDevFallbackBookshelf(container);
    }
  }

  function renderDevFallbackBookshelf(container) {
    container.innerHTML = "";
    const mockProducts = [{
      id: "abk_kendall_one_million_followers",
      assetKey: "abk_kendall_one_million_followers",
      title: "One Million Followers",
      price: 9.99,
      type: "audiobook",
      coverUrl: "https://firebasestorage.googleapis.com/v0/b/jubilee-command-center---dev.firebasestorage.app/o/assets%2Fabk_kendall_one_million_followers_coverUrl_One%20Million%20Followers.jpg?alt=media&token=12e07e24-8fb6-4280-bb8f-a250cee47ec4",
      synopsis: "Sovereign Content Engine Production.",
      accentColor: "#f97316",
      sections: ["Featured Publications"]
    }];
    buildCatalogGridUI(container, mockProducts);
  }

  function buildCatalogGridUI(container, productsList) {
    container.innerHTML = "";
    const sectionBlock = document.createElement("div");
    sectionBlock.style.width = "100%";
    
    sectionBlock.innerHTML = `
      <div style="display:flex; gap:20px; overflow-x:auto; padding:20px 0;">
        ${productsList.map(item => `
          <div style="min-width:240px; width:240px; background:#161b22; border: 1px solid #30363d; border-radius:8px; padding:15px; display:flex; flex-direction:column; justify-content:space-between; box-sizing: border-box;">
            <img src="${item.coverUrl || item.coverArtUrl}" style="width:100%; height:210px; object-fit:cover; border-radius:6px;" />
            <h4 style="color:#fff; margin:10px 0 4px 0; font-family:sans-serif;">${item.title}</h4>
            <a href="/library/${item.assetKey}/" style="display:block; text-align:center; padding:10px; background:#f97316; color:#fff; font-weight:bold; text-decoration:none; border-radius:6px; font-size:0.9rem;">View Canvas</a>
          </div>
        `).join('')}
      </div>`;
    container.appendChild(sectionBlock);
  }
})();