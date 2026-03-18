(function () {
  if (window.__mouseCookiesInjected) {
    return;
  }
  window.__mouseCookiesInjected = true;

  const ROOT_ID = "mouse-cookies-root";
  const COOKIE_SIZE = 52;
  const MAX_COOKIES = 6;
  const SCAN_INTERVAL_MS = 1200;
  const COOKIE_ACCEPT_PATTERN =
    /\b(accept|accept all|allow|agree|consent|got it|ok|okay|continue|enable)\b/i;
  const COOKIE_DECISION_PATTERN =
    /\b(accept|reject|customize|preferences|privacy policy|manage|allow|agree)\b/i;
  const COOKIE_CONTEXT_PATTERN =
    /\b(cookie|cookies|consent|privacy|tracking|gdpr|ccpa)\b/i;

  const state = {
    cookies: new Set(),
    heartTimeout: null,
    retreatTimeout: null,
    hideTimeout: null,
    activeBanner: null,
    side: "right"
  };

  const root = document.createElement("div");
  root.id = ROOT_ID;
  root.setAttribute("aria-hidden", "true");
  root.innerHTML = `
    <div class="mouse-cookies-stage">
      <div class="mouse-cookies-hole">
        <div class="mouse-cookies-hole-shadow"></div>
        <div class="mouse-cookies-mouse">
          <div class="mouse-cookies-ear mouse-cookies-ear-left"></div>
          <div class="mouse-cookies-ear mouse-cookies-ear-right"></div>
          <div class="mouse-cookies-eye mouse-cookies-eye-left"></div>
          <div class="mouse-cookies-eye mouse-cookies-eye-right"></div>
          <div class="mouse-cookies-nose"></div>
        </div>
      </div>
      <div class="mouse-cookies-hearts"></div>
    </div>
  `;
  document.documentElement.appendChild(root);

  const stage = root.querySelector(".mouse-cookies-stage");
  const hole = root.querySelector(".mouse-cookies-hole");
  const mouse = root.querySelector(".mouse-cookies-mouse");
  const hearts = root.querySelector(".mouse-cookies-hearts");

  function normalizeText(value) {
    return (value || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function getPageSide() {
    const seed = `${window.location.hostname}${window.location.pathname}`;
    let hash = 0;

    for (let index = 0; index < seed.length; index += 1) {
      hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
    }

    return hash % 2 === 0 ? "left" : "right";
  }

  function applyMouseSide() {
    root.classList.remove("side-left", "side-right");
    root.classList.add(`side-${state.side}`);
  }

  function setCookiePosition(cookie, x, y) {
    cookie.style.left = `${x}px`;
    cookie.style.top = `${y}px`;
  }

  function isVisibleElement(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();

    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      parseFloat(style.opacity || "1") > 0 &&
      rect.width >= 220 &&
      rect.height >= 70 &&
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.left < window.innerWidth &&
      rect.top < window.innerHeight
    );
  }

  function getElementHintText(element) {
    return normalizeText(
      [
        element.id,
        element.className,
        element.getAttribute("aria-label"),
        element.getAttribute("role"),
        element.getAttribute("data-testid"),
        element.getAttribute("data-test")
      ]
        .filter(Boolean)
        .join(" ")
    );
  }

  function hasCookieHint(element) {
    return /\b(cookie|consent|onetrust|cookiebot|termly|privacy|truste|gdpr|ccpa)\b/i.test(
      getElementHintText(element)
    );
  }

  function isEdgeAnchored(rect) {
    return (
      rect.bottom >= window.innerHeight - 16 ||
      rect.top <= 16 ||
      rect.left <= 16 ||
      rect.right >= window.innerWidth - 16
    );
  }

  function getBannerScore(element) {
    if (!isVisibleElement(element)) {
      return 0;
    }

    const text = normalizeText(element.textContent).slice(0, 1200);
    const hintText = getElementHintText(element);
    const hasTextContext = COOKIE_CONTEXT_PATTERN.test(text);
    const hasHintContext = hasCookieHint(element);
    if (!hasTextContext && !hasHintContext) {
      return 0;
    }

    const rect = element.getBoundingClientRect();
    let score = 0;
    const style = window.getComputedStyle(element);
    const role = normalizeText(element.getAttribute("role"));
    const buttonCount = element.querySelectorAll("button, [role='button'], a, input[type='button'], input[type='submit']").length;
    const isFixedLike = style.position === "fixed" || style.position === "sticky";
    const edgeAnchored = isEdgeAnchored(rect);
    const isDialogLike =
      role === "dialog" ||
      role === "alertdialog" ||
      element.getAttribute("aria-modal") === "true";

    if (hasHintContext) {
      score += 4;
    }

    if (hasTextContext) {
      score += 2;
    }

    if (COOKIE_DECISION_PATTERN.test(text) && buttonCount >= 1) {
      score += 2;
    }

    if (isFixedLike) {
      score += 2;
    }

    if (edgeAnchored) {
      score += 2;
    }

    if (isDialogLike) {
      score += 2;
    }

    if (rect.width >= window.innerWidth * 0.35) {
      score += 1;
    }

    if (buttonCount >= 2) {
      score += 1;
    }

    if (!(isFixedLike || edgeAnchored || isDialogLike || hasHintContext)) {
      return 0;
    }

    return score;
  }

  function findActiveBanner() {
    const candidates = Array.from(document.querySelectorAll("body *"));
    let winner = null;
    let winnerScore = 0;

    for (const element of candidates) {
      const score = getBannerScore(element);
      if (score > winnerScore) {
        winnerScore = score;
        winner = element;
      }
    }

    return winnerScore >= 7 ? winner : null;
  }

  function updateStageVisibility() {
    const hasBanner = Boolean(state.activeBanner && state.activeBanner.isConnected);
    const hasCookies = state.cookies.size > 0;
    const shouldShow = hasBanner || hasCookies;

    root.classList.toggle("is-active", shouldShow);

    if (!shouldShow) {
      stage.style.bottom = "0px";
      return;
    }

    let bottomOffset = 0;
    if (hasBanner) {
      const rect = state.activeBanner.getBoundingClientRect();
      if (rect.top >= window.innerHeight * 0.45) {
        bottomOffset = clamp(window.innerHeight - rect.top + 10, 0, 280);
      }
    }

    stage.style.bottom = `${bottomOffset}px`;
  }

  function scheduleHideCheck() {
    clearTimeout(state.hideTimeout);
    state.hideTimeout = window.setTimeout(() => {
      state.activeBanner = findActiveBanner();
      updateStageVisibility();
    }, 650);
  }

  function refreshBannerState() {
    state.activeBanner = findActiveBanner();
    updateStageVisibility();
  }

  function removeCookie(cookie) {
    state.cookies.delete(cookie);
    cookie.classList.add("is-removing");
    window.setTimeout(() => {
      cookie.remove();
      updateStageVisibility();
    }, 220);
  }

  function triggerHeartBurst() {
    clearTimeout(state.heartTimeout);
    clearTimeout(state.retreatTimeout);

    mouse.classList.add("is-fed");
    hearts.innerHTML = "";

    for (let index = 0; index < 3; index += 1) {
      const heart = document.createElement("div");
      heart.className = "mouse-cookies-heart";
      heart.textContent = "❤";
      heart.style.left = `${38 + index * 22}%`;
      heart.style.animationDelay = `${index * 80}ms`;
      hearts.appendChild(heart);
    }

    state.heartTimeout = window.setTimeout(() => {
      hearts.innerHTML = "";
      mouse.classList.remove("is-fed");
    }, 1300);

    state.retreatTimeout = window.setTimeout(() => {
      mouse.classList.add("is-hidden");
      window.setTimeout(() => {
        mouse.classList.remove("is-hidden");
        scheduleHideCheck();
      }, 1200);
    }, 300);
  }

  function intersectsHole(cookie) {
    const cookieRect = cookie.getBoundingClientRect();
    const holeRect = hole.getBoundingClientRect();

    return !(
      cookieRect.right < holeRect.left ||
      cookieRect.left > holeRect.right ||
      cookieRect.bottom < holeRect.top ||
      cookieRect.top > holeRect.bottom
    );
  }

  function attachDrag(cookie) {
    let pointerId = null;
    let offsetX = 0;
    let offsetY = 0;

    function onPointerMove(event) {
      if (event.pointerId !== pointerId) {
        return;
      }

      const x = clamp(event.clientX - offsetX, 8, window.innerWidth - COOKIE_SIZE - 8);
      const y = clamp(event.clientY - offsetY, 8, window.innerHeight - COOKIE_SIZE - 8);
      setCookiePosition(cookie, x, y);
    }

    function onPointerUp(event) {
      if (event.pointerId !== pointerId) {
        return;
      }

      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onPointerUp, true);
      cookie.classList.remove("is-dragging");
      pointerId = null;

      if (intersectsHole(cookie)) {
        triggerHeartBurst();
        removeCookie(cookie);
      }
    }

    cookie.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();

      pointerId = event.pointerId;
      const rect = cookie.getBoundingClientRect();
      offsetX = event.clientX - rect.left;
      offsetY = event.clientY - rect.top;

      cookie.classList.add("is-dragging");
      cookie.setPointerCapture(pointerId);

      window.addEventListener("pointermove", onPointerMove, true);
      window.addEventListener("pointerup", onPointerUp, true);
      window.addEventListener("pointercancel", onPointerUp, true);
    });
  }

  function spawnCookieTreat(originX, originY) {
    if (state.cookies.size >= MAX_COOKIES) {
      const oldest = state.cookies.values().next().value;
      if (oldest) {
        removeCookie(oldest);
      }
    }

    const cookie = document.createElement("div");
    cookie.className = "mouse-cookies-cookie";
    cookie.innerHTML = `
      <div class="mouse-cookies-chip chip-1"></div>
      <div class="mouse-cookies-chip chip-2"></div>
      <div class="mouse-cookies-chip chip-3"></div>
      <div class="mouse-cookies-chip chip-4"></div>
      <div class="mouse-cookies-chip chip-5"></div>
    `;

    const startX = clamp(originX - COOKIE_SIZE / 2, 12, window.innerWidth - COOKIE_SIZE - 12);
    const startY = clamp(originY - COOKIE_SIZE / 2, 12, window.innerHeight - COOKIE_SIZE - 120);
    setCookiePosition(cookie, startX, startY);
    stage.appendChild(cookie);
    state.cookies.add(cookie);
    updateStageVisibility();

    requestAnimationFrame(() => {
      cookie.classList.add("is-visible");
    });

    attachDrag(cookie);
  }

  function getClickableTarget(target) {
    if (!(target instanceof Element)) {
      return null;
    }

    return target.closest("button, a, [role='button'], input[type='button'], input[type='submit']");
  }

  function isLikelyCookieAcceptTarget(target) {
    const clickable = getClickableTarget(target);
    if (!clickable) {
      return false;
    }

    const text = normalizeText(
      clickable.getAttribute("aria-label") ||
        clickable.getAttribute("value") ||
        clickable.textContent
    );

    if (!COOKIE_ACCEPT_PATTERN.test(text)) {
      return false;
    }

    const banner = state.activeBanner || findActiveBanner();
    if (banner && banner.contains(clickable)) {
      return true;
    }

    let node = clickable;
    for (let depth = 0; node && depth < 4; depth += 1) {
      if (COOKIE_CONTEXT_PATTERN.test(normalizeText(node.textContent).slice(0, 500))) {
        return true;
      }
      node = node.parentElement;
    }

    return false;
  }

  document.addEventListener(
    "click",
    (event) => {
      if (!isLikelyCookieAcceptTarget(event.target)) {
        return;
      }

      const clickable = getClickableTarget(event.target);
      const origin = clickable.getBoundingClientRect();
      const spawnCount = Math.random() > 0.55 ? 2 : 1;

      for (let index = 0; index < spawnCount; index += 1) {
        const offsetX = (Math.random() - 0.5) * 70;
        const offsetY = -10 - index * 16;
        spawnCookieTreat(origin.left + origin.width / 2 + offsetX, origin.top + offsetY);
      }

      scheduleHideCheck();
    },
    true
  );

  const observer = new MutationObserver(() => {
    refreshBannerState();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["style", "class", "hidden", "aria-hidden"]
  });

  window.addEventListener("resize", updateStageVisibility);
  state.side = getPageSide();
  applyMouseSide();
  window.setInterval(refreshBannerState, SCAN_INTERVAL_MS);
  refreshBannerState();
})();
