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
    let left;
    let top;
    if (roomOutside) {
      left = outsideLeft;
      top = Math.max(8, Math.min(window.innerHeight - height - 8, rect.top + 4));
    } else {
      left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.left + 8));
      top = Math.max(8, Math.min(window.innerHeight - height - 8, rect.top + 46));
    }
    button.style.left = `${Math.round(left)}px`;
    button.style.top = `${Math.round(top)}px`;
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
    if (uncovered) {
      const actionLeft = Math.round(left);
      const actionTop = Math.round(top);
      const controls = document.querySelectorAll('button, input, textarea, select, a[href], [role="button"], [role="dialog"], [aria-modal="true"]');
      for (const control of controls) {
        if (!visible(control)) continue;
        const bounds = control.getBoundingClientRect();
        if (actionLeft < bounds.right && actionLeft + width > bounds.left &&
            actionTop < bounds.bottom && actionTop + height > bounds.top) {
          uncovered = false;
          break;
        }
      }
    }
    button.style.display = uncovered ? "block" : "none";
    return true;
  }
