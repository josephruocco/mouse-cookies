(function () {
  if (window.__mouseCookiesInjected) {
    return;
  }
  window.__mouseCookiesInjected = true;

  const ROOT_ID = "mouse-cookies-root";
  const SCAN_INTERVAL_MS = 1200;
  const ENTER_DELAY_MS = 60;
  const EXIT_DURATION_MS = 420;
  const COOKIE_ACCEPT_PATTERN =
    /\b(accept|accept all|allow|agree|consent|got it|ok|okay|continue|enable)\b/i;
  const COOKIE_DECISION_PATTERN =
    /\b(accept|reject|customize|preferences|privacy policy|manage|allow|agree)\b/i;
  const COOKIE_CONTEXT_PATTERN =
    /\b(cookie|cookies|consent|privacy|tracking|gdpr|ccpa)\b/i;

  const state = {
    activeBanner: null,
    isPresent: false,
    isSnatching: false,
    side: "right",
    restPoint: null,
    enterTimeout: null,
    hideTimeout: null,
    exitTimeout: null,
    cleanupTimeout: null
  };

  const root = document.createElement("div");
  root.id = ROOT_ID;
  root.setAttribute("aria-hidden", "true");
  root.innerHTML = `
    <div class="mouse-cookies-stage">
      <div class="mouse-cookies-actor">
        <div class="mouse-cookies-cookie"></div>
        <div class="mouse-cookies-body">
          <div class="mouse-cookies-ear mouse-cookies-ear-left"></div>
          <div class="mouse-cookies-ear mouse-cookies-ear-right"></div>
          <div class="mouse-cookies-eye mouse-cookies-eye-left"></div>
          <div class="mouse-cookies-eye mouse-cookies-eye-right"></div>
          <div class="mouse-cookies-nose"></div>
          <div class="mouse-cookies-tail"></div>
        </div>
      </div>
      <div class="mouse-cookies-burst"></div>
    </div>
  `;
  document.documentElement.appendChild(root);

  const actor = root.querySelector(".mouse-cookies-actor");
  const burst = root.querySelector(".mouse-cookies-burst");

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
    const style = window.getComputedStyle(element);
    const role = normalizeText(element.getAttribute("role"));
    const buttonCount = element.querySelectorAll(
      "button, [role='button'], a, input[type='button'], input[type='submit']"
    ).length;
    const isFixedLike = style.position === "fixed" || style.position === "sticky";
    const edgeAnchored = isEdgeAnchored(rect);
    const isDialogLike =
      role === "dialog" ||
      role === "alertdialog" ||
      element.getAttribute("aria-modal") === "true";

    let score = 0;

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
        winner = element;
        winnerScore = score;
      }
    }

    return winnerScore >= 7 ? winner : null;
  }

  function getRestPoint(banner) {
    const rect = banner.getBoundingClientRect();
    const y = clamp(rect.bottom - 34, 14, window.innerHeight - 46);

    if (state.side === "left") {
      return { x: 18, y };
    }

    return { x: window.innerWidth - 90, y };
  }

  function getOffscreenPoint(y = 24) {
    const safeY = clamp(y, 8, window.innerHeight - 46);
    if (state.side === "left") {
      return { x: -110, y: safeY };
    }

    return { x: window.innerWidth + 32, y: safeY };
  }

  function setActorPosition(point) {
    actor.style.setProperty("--mouse-x", `${Math.round(point.x)}px`);
    actor.style.setProperty("--mouse-y", `${Math.round(point.y)}px`);
  }

  function clearTravelTimers() {
    clearTimeout(state.enterTimeout);
    clearTimeout(state.exitTimeout);
  }

  function clearAllTimers() {
    clearTravelTimers();
    clearTimeout(state.cleanupTimeout);
  }

  function enterMouse(point) {
    clearTravelTimers();
    state.restPoint = point;
    state.isPresent = true;

    root.classList.add("has-mouse");
    root.classList.remove("is-leaving");
    actor.classList.remove("is-snacking", "has-cookie");
    setActorPosition(getOffscreenPoint(point.y));

    state.enterTimeout = window.setTimeout(() => {
      setActorPosition(point);
    }, ENTER_DELAY_MS);
  }

  function leaveMouse() {
    if (!state.isPresent) {
      root.classList.remove("has-mouse", "is-leaving");
      return;
    }

    clearTravelTimers();
    root.classList.add("is-leaving");
    actor.classList.remove("is-snacking", "has-cookie");
    setActorPosition(getOffscreenPoint((state.restPoint || { y: 24 }).y));

    state.exitTimeout = window.setTimeout(() => {
      state.isPresent = false;
      state.restPoint = null;
      root.classList.remove("has-mouse", "is-leaving");
    }, EXIT_DURATION_MS);
  }

  function syncMouseToBanner() {
    if (!state.activeBanner || !state.activeBanner.isConnected) {
      if (!state.isSnatching) {
        leaveMouse();
      }
      return;
    }

    const nextPoint = getRestPoint(state.activeBanner);
    state.restPoint = nextPoint;

    if (!state.isPresent && !state.isSnatching) {
      enterMouse(nextPoint);
      return;
    }

    if (!state.isSnatching) {
      setActorPosition(nextPoint);
    }
  }

  function scheduleHideCheck() {
    clearTimeout(state.hideTimeout);
    state.hideTimeout = window.setTimeout(() => {
      state.activeBanner = findActiveBanner();
      syncMouseToBanner();
    }, 650);
  }

  function refreshBannerState() {
    state.activeBanner = findActiveBanner();
    syncMouseToBanner();
  }

  function spawnCrumbs(targetRect) {
    burst.innerHTML = "";
    const baseX = targetRect.left + targetRect.width / 2;
    const baseY = targetRect.top + targetRect.height / 2;

    for (let index = 0; index < 4; index += 1) {
      const crumb = document.createElement("div");
      crumb.className = "mouse-cookies-crumb";
      crumb.style.left = `${baseX + (index - 1.5) * 8}px`;
      crumb.style.top = `${baseY - 4 + (index % 2) * 5}px`;
      crumb.style.animationDelay = `${index * 45}ms`;
      burst.appendChild(crumb);
    }

    window.setTimeout(() => {
      burst.innerHTML = "";
    }, 700);
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

  function runAcceptSequence(targetRect) {
    const banner = state.activeBanner || findActiveBanner();
    if (banner && !state.isPresent) {
      enterMouse(getRestPoint(banner));
    }

    clearAllTimers();
    state.isSnatching = true;

    const chasePoint = {
      x:
        state.side === "left"
          ? clamp(targetRect.left - 12, 8, window.innerWidth - 72)
          : clamp(targetRect.right - 58, 8, window.innerWidth - 72),
      y: clamp(targetRect.top + targetRect.height / 2 - 14, 8, window.innerHeight - 44)
    };

    root.classList.add("has-mouse");
    state.isPresent = true;
    state.restPoint = chasePoint;
    actor.classList.add("has-cookie");
    actor.classList.remove("is-snacking");
    setActorPosition(chasePoint);

    state.enterTimeout = window.setTimeout(() => {
      actor.classList.add("is-snacking");
      spawnCrumbs(targetRect);
    }, 240);

    state.exitTimeout = window.setTimeout(() => {
      actor.classList.remove("is-snacking");
      leaveMouse();
    }, 760);

    state.cleanupTimeout = window.setTimeout(() => {
      state.isSnatching = false;
      actor.classList.remove("has-cookie", "is-snacking");
      state.activeBanner = findActiveBanner();
      syncMouseToBanner();
    }, 1260);
  }

  document.addEventListener(
    "click",
    (event) => {
      if (!isLikelyCookieAcceptTarget(event.target)) {
        return;
      }

      const clickable = getClickableTarget(event.target);
      if (!clickable) {
        return;
      }

      runAcceptSequence(clickable.getBoundingClientRect());
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

  window.addEventListener("resize", refreshBannerState);

  state.side = getPageSide();
  applyMouseSide();
  window.setInterval(refreshBannerState, SCAN_INTERVAL_MS);
  refreshBannerState();
})();
