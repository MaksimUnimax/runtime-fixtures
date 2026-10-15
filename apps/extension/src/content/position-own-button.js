  function positionOwnButton(record) {
    if (!record?.button || !record?.binding?.root?.isConnected) return false;
    const adapter = OzonAIAdapters.ADAPTERS[record.binding.adapter_id] || currentAIAdapter();
    const anchor = adapter?.geometryAnchor(record.binding.root) || record.binding.root;
    if (!(anchor instanceof Element) || !anchor.isConnected) return false;
    const rect = anchor.getBoundingClientRect();
    const button = record.button;
    const measuredWidth = button.getBoundingClientRect().width;
    const width = Math.max(68, measuredWidth || record.positionWidth || 68);
    if (measuredWidth > 0) record.positionWidth = width;
    const height = 32;
    const outsideLeft = rect.right + 10;
    const roomOutside = outsideLeft + width <= window.innerWidth - 8;
    // Full-width command text must remain readable. Place its action above
    // the block, never over its code. If that slot is covered or offscreen,
    // normal scrolling can reveal it again without starting a new Work.
    const positions = [roomOutside ? {
      left: Math.round(outsideLeft),
      top: Math.round(Math.max(8, Math.min(window.innerHeight - height - 8, rect.top + 4)))
    } : {
      left: Math.round(Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width))),
      top: Math.round(rect.top - height - 8)
    }];
    // An adapter may instead anchor to a native Copy/header control. Preserve
    // its established below-control slot; it is not the command-text root.
    if (!roomOutside && anchor !== record.binding.root) positions.unshift({
      left: Math.round(Math.max(8, Math.min(window.innerWidth - width - 8, rect.left + 8))),
      top: Math.round(Math.max(8, Math.min(window.innerHeight - height - 8, rect.top + 46)))
    });
    const onScreen = rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
    // A viewport intersection alone does not prove that the native anchor is
    // visible: chat footers, login banners and scroll containers can cover it.
    // Ignore our own shadow host in hit testing, but never native page overlays.
    let uncovered = false;
    if (onScreen) {
      const x = (Math.max(0, rect.left) + Math.min(window.innerWidth, rect.right)) / 2;
      const y = (Math.max(0, rect.top) + Math.min(window.innerHeight, rect.bottom)) / 2;
      const nativeTop = document.elementsFromPoint(x, y).find((element) => element !== ownButtonHost);
      uncovered = Boolean(nativeTop && anchor.contains(nativeTop));
    }
    // Protect native controls across the whole action rectangle, including
    // edge overlaps that an anchor-center test cannot detect. Shadow buttons
    // are not in this document query. Normal scroll/DOM updates re-evaluate it.
    let placement = null;
    if (uncovered) {
      const controls = Array.from(document.querySelectorAll('button, input, textarea, select, a[href], [role="button"], [role="dialog"], [aria-modal="true"]'))
        .filter(visible).map(control => control.getBoundingClientRect());
      placement = positions.find(({ left: actionLeft, top: actionTop }) =>
        actionLeft >= 8 && actionTop >= 8 && actionLeft + width <= window.innerWidth - 8 &&
        actionTop + height <= window.innerHeight - 8 && !controls.some(bounds =>
          actionLeft < bounds.right && actionLeft + width > bounds.left &&
          actionTop < bounds.bottom && actionTop + height > bounds.top));
    }
    const position = placement || positions[0];
    button.style.left = `${position.left}px`;
    button.style.top = `${position.top}px`;
    button.style.display = placement ? "block" : "none";
    return true;
  }
