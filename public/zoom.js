/**
 * Image zoom controller — pinch / wheel / drag-pan / double-click.
 *
 * Ported from ContactSheet's src/lib/zoom.ts on 2026-04-27. Framework-
 * agnostic: plain DOM + transforms, no dependencies. Attach with
 * `makeZoomer(imgEl)` and call `.destroy()` when done.
 *
 * Inputs:
 *   - ctrlKey + wheel → zoom toward cursor (macOS trackpad pinch + ctrl+wheel)
 *   - plain wheel     → pan when zoomed; bubbles when not (host can wheel-page)
 *   - pointer (1)     → drag-to-pan when zoomed; bubbles when not
 *   - pointer (2)     → pinch-to-zoom (anchored at gesture midpoint)
 *   - double-click    → toggle 1× ↔ doubleTapScale anchored at cursor
 *
 * Host should check `.isZoomed()` before reacting to swipe / tap-zone gestures
 * so a pan/pinch doesn't accidentally trigger paging or close-on-swipe-up.
 *
 * Exposes `window.makeZoomer` for classic-script use in Darkroom's app.js.
 */
(function () {
  function makeZoomer(img, opts) {
    opts = opts || {};
    var minScale = opts.minScale != null ? opts.minScale : 1;
    var maxScale = opts.maxScale != null ? opts.maxScale : 8;
    var doubleTapScale = opts.doubleTapScale != null ? opts.doubleTapScale : 2.5;

    var scale = minScale;
    var tx = 0;
    var ty = 0;

    var pointers = new Map();
    var pinchStartDist = 0;
    var pinchStartCenter = { x: 0, y: 0 };
    var pinchStartScale = minScale;
    var pinchStartTx = 0;
    var pinchStartTy = 0;

    // Manual double-tap detection for touch — iOS Safari doesn't reliably fire
    // dblclick when pointer-capture is active, so we measure time + distance
    // between two touch pointerdowns ourselves. Mouse uses native dblclick.
    var lastTapTime = 0;
    var lastTapX = 0;
    var lastTapY = 0;

    var orig = {
      transform: img.style.transform,
      transformOrigin: img.style.transformOrigin,
      transition: img.style.transition,
      touchAction: img.style.touchAction,
      cursor: img.style.cursor,
      userSelect: img.style.userSelect,
      willChange: img.style.willChange
    };

    img.style.transformOrigin = '0 0';
    img.style.touchAction = 'none';
    img.style.userSelect = 'none';

    // `will-change: transform` on Safari permanently composites the <img> at
    // its layout size and never re-rasterizes from the source bitmap during
    // static zoom — so the high-res original looks no sharper than the display
    // size. Toggle the hint only during active gestures and clear it after a
    // settle window so Safari re-rasterizes from the high-res source at rest.
    var WILL_CHANGE_RELEASE_MS = 220;
    var willChangeTimer = null;
    function flagGestureActive() {
      if (img.style.willChange !== 'transform') img.style.willChange = 'transform';
      if (willChangeTimer) clearTimeout(willChangeTimer);
      willChangeTimer = setTimeout(function () {
        img.style.willChange = '';
        willChangeTimer = null;
      }, WILL_CHANGE_RELEASE_MS);
    }

    function apply(animate) {
      img.style.transition = animate ? 'transform 0.18s ease-out' : 'none';
      img.style.transform = 'translate(' + tx + 'px, ' + ty + 'px) scale(' + scale + ')';
      img.style.cursor = scale > minScale + 0.001 ? 'grab' : 'zoom-in';
      flagGestureActive();
    }

    // Keep an image larger than its container always covering it; if smaller
    // (portrait in landscape viewport at 1×), center it.
    function clamp() {
      if (scale <= minScale + 0.001) {
        scale = minScale;
        tx = 0;
        ty = 0;
        return;
      }
      var parent = img.parentElement;
      if (!parent) return;
      var baseW = img.clientWidth;
      var baseH = img.clientHeight;
      var dispW = baseW * scale;
      var dispH = baseH * scale;
      var baseLeft = img.offsetLeft;
      var baseTop = img.offsetTop;
      var pW = parent.clientWidth;
      var pH = parent.clientHeight;

      if (dispW <= pW) {
        tx = (pW - dispW) / 2 - baseLeft;
      } else {
        var minTx = pW - dispW - baseLeft;
        var maxTx = -baseLeft;
        tx = Math.min(maxTx, Math.max(minTx, tx));
      }
      if (dispH <= pH) {
        ty = (pH - dispH) / 2 - baseTop;
      } else {
        var minTy = pH - dispH - baseTop;
        var maxTy = -baseTop;
        ty = Math.min(maxTy, Math.max(minTy, ty));
      }
    }

    // Set scale anchored at a viewport point — the image-pixel under (cx, cy)
    // stays under (cx, cy) after the change. This is the geometry that makes
    // pinch and ctrl+wheel feel right.
    function zoomAt(cx, cy, newScale, animate) {
      newScale = Math.max(minScale, Math.min(maxScale, newScale));
      if (Math.abs(newScale - scale) < 0.0001) return;
      var baseLeft = img.offsetLeft;
      var baseTop = img.offsetTop;
      var ix = (cx - baseLeft - tx) / scale;
      var iy = (cy - baseTop - ty) / scale;
      scale = newScale;
      tx = cx - baseLeft - ix * newScale;
      ty = cy - baseTop - iy * newScale;
      clamp();
      apply(animate);
    }

    // Normalize deltaY/deltaX to pixels regardless of WheelEvent.deltaMode
    // (Firefox line-mode sends deltaMode=1 with ~3px equivalents, some old
    // browsers send deltaMode=2 for page-mode). Without this, zoom crawls and
    // pan barely moves on those configs.
    function pxDelta(e) {
      var k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
      return { dx: e.deltaX * k, dy: e.deltaY * k };
    }

    function onWheel(e) {
      var d = pxDelta(e);
      // macOS trackpad pinch arrives as ctrlKey + wheel; same for ctrl+wheel
      // on a desktop mouse. Both should zoom.
      if (e.ctrlKey) {
        e.preventDefault();
        e.stopPropagation();
        var factor = Math.exp(-d.dy * 0.01);
        zoomAt(e.clientX, e.clientY, scale * factor);
        return;
      }
      // Plain wheel pans if zoomed; otherwise let the host page see it (used
      // for prev/next paging at 1×).
      if (scale > minScale + 0.001) {
        e.preventDefault();
        e.stopPropagation();
        tx -= d.dx;
        ty -= d.dy;
        clamp();
        apply();
      }
    }

    function toggleAt(cx, cy) {
      // Notify host before applying — host typically uses this to cancel a
      // deferred single-click action so the overlay's tap-zone nav doesn't
      // race with the double-tap-to-zoom intent. Fires for both native
      // dblclick (mouse) and the manual touch double-tap path below.
      if (typeof opts.onDoubleTap === 'function') {
        try { opts.onDoubleTap(cx, cy); } catch (_) { /* swallow */ }
      }
      if (scale > minScale + 0.001) {
        scale = minScale;
        tx = 0;
        ty = 0;
        apply(true);
      } else {
        zoomAt(cx, cy, doubleTapScale, true);
      }
    }

    function onDblClick(e) {
      e.preventDefault();
      e.stopPropagation();
      toggleAt(e.clientX, e.clientY);
    }

    function onPointerDown(e) {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try {
        img.setPointerCapture(e.pointerId);
      } catch (_) {
        /* some browsers throw if the pointer is already captured */
      }
      if (pointers.size === 2) {
        var vals = Array.from(pointers.values());
        var a = vals[0], b = vals[1];
        pinchStartDist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        pinchStartCenter = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        pinchStartScale = scale;
        pinchStartTx = tx;
        pinchStartTy = ty;
        // Two fingers down — definitely not a double-tap.
        lastTapTime = 0;
        return;
      }
      // Manual double-tap detection for touch pointers (iOS doesn't fire
      // dblclick when we've captured the pointer).
      if (e.pointerType === 'touch' && pointers.size === 1) {
        var now = Date.now();
        var dx = e.clientX - lastTapX;
        var dy = e.clientY - lastTapY;
        if (now - lastTapTime < 300 && Math.hypot(dx, dy) < 30) {
          lastTapTime = 0;
          toggleAt(e.clientX, e.clientY);
        } else {
          lastTapTime = now;
          lastTapX = e.clientX;
          lastTapY = e.clientY;
        }
      }
    }

    function onPointerMove(e) {
      if (!pointers.has(e.pointerId)) return;
      var prev = pointers.get(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.size >= 2) {
        e.preventDefault();
        e.stopPropagation();
        var vals = Array.from(pointers.values());
        var a = vals[0], b = vals[1];
        var dist = Math.hypot(a.x - b.x, a.y - b.y);
        var center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        var newScale = Math.max(
          minScale,
          Math.min(maxScale, pinchStartScale * (dist / pinchStartDist))
        );
        var baseLeft = img.offsetLeft;
        var baseTop = img.offsetTop;
        // Image-coord of pinch midpoint at gesture start
        var ix = (pinchStartCenter.x - baseLeft - pinchStartTx) / pinchStartScale;
        var iy = (pinchStartCenter.y - baseTop - pinchStartTy) / pinchStartScale;
        scale = newScale;
        tx = center.x - baseLeft - ix * newScale;
        ty = center.y - baseTop - iy * newScale;
        clamp();
        apply();
      } else if (pointers.size === 1 && scale > minScale + 0.001) {
        e.preventDefault();
        e.stopPropagation();
        tx += e.clientX - prev.x;
        ty += e.clientY - prev.y;
        clamp();
        apply();
        img.style.cursor = 'grabbing';
      }
    }

    function onPointerUp(e) {
      pointers.delete(e.pointerId);
      try {
        if (img.hasPointerCapture(e.pointerId)) img.releasePointerCapture(e.pointerId);
      } catch (_) {
        /* noop */
      }
      if (pointers.size === 0) {
        img.style.cursor = scale > minScale + 0.001 ? 'grab' : 'zoom-in';
      }
    }

    apply();

    // Re-clamp on container resize: viewport rotation, devtools toggle,
    // browser-window resize while zoomed all change parent dimensions, and
    // without re-clamping the image can slide off-screen with no recovery.
    var resizeObs = null;
    if (typeof ResizeObserver !== 'undefined' && img.parentElement) {
      resizeObs = new ResizeObserver(function () {
        if (scale > minScale + 0.001) {
          clamp();
          apply();
        }
      });
      resizeObs.observe(img.parentElement);
    }

    img.addEventListener('wheel', onWheel, { passive: false });
    img.addEventListener('dblclick', onDblClick);
    img.addEventListener('pointerdown', onPointerDown);
    img.addEventListener('pointermove', onPointerMove);
    img.addEventListener('pointerup', onPointerUp);
    img.addEventListener('pointercancel', onPointerUp);

    return {
      isZoomed: function () { return scale > minScale + 0.001; },
      reset: function () {
        scale = minScale;
        tx = 0;
        ty = 0;
        apply(true);
      },
      destroy: function () {
        if (resizeObs) resizeObs.disconnect();
        if (willChangeTimer) {
          clearTimeout(willChangeTimer);
          willChangeTimer = null;
        }
        img.removeEventListener('wheel', onWheel);
        img.removeEventListener('dblclick', onDblClick);
        img.removeEventListener('pointerdown', onPointerDown);
        img.removeEventListener('pointermove', onPointerMove);
        img.removeEventListener('pointerup', onPointerUp);
        img.removeEventListener('pointercancel', onPointerUp);
        img.style.transform = orig.transform;
        img.style.transformOrigin = orig.transformOrigin;
        img.style.transition = orig.transition;
        img.style.touchAction = orig.touchAction;
        img.style.cursor = orig.cursor;
        img.style.userSelect = orig.userSelect;
        img.style.willChange = orig.willChange;
      }
    };
  }

  window.makeZoomer = makeZoomer;
})();
