/* DeepSeek B02 components using accepted 19 Oct controls and 20 Oct 07:04 root.
 * Messages use conservative document-only node witnesses; replacement retires them.
 * Completion/upload-end remain unobserved; registry activation stays pending.
 * No click, execution or signed authority is created here. */
(() => {
  "use strict";
  const ID = "deepseek", ORIGIN = "https://chat.deepseek.com";
  const EDITOR = "textarea[placeholder=\"Сообщение для DeepSeek\"]", ROOT = "div._77cefa5._3d616d3", MESSAGE = ".ds-message";
  const INPUT = "input[type=\"file\"][multiple]", CARD = ".cd314545";
  const CHAT_ROOT = "div.ds-virtual-list.ds-virtual-list--printable._2bd7b35";
  const EXCLUDED = '[hidden],[aria-hidden="true"],[inert],[role="dialog"]';
  const fail = code => { throw Object.assign(new Error(code), {code}); };
  const matchesLocation = () => location.origin === ORIGIN;
  function rendered(node) {
    if (!(node instanceof HTMLElement) || !node.isConnected || node.closest(EXCLUDED)) return false;
    const rect = node.getBoundingClientRect();
    if (!node.getClientRects().length || rect.width <= 0 || rect.height <= 0) return false;
    for (let p = node; p instanceof Element; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.display === "none" || s.visibility === "hidden" || s.visibility === "collapse" ||
          s.contentVisibility === "hidden" || Number(s.opacity) === 0) return false;
    }
    return true;
  }
  const validName = name => typeof name === "string" && name.length > 4 && name.length <= 255 &&
    !/[\\/\u0000-\u001f]/u.test(name) && /\.txt$/i.test(name);
  function create({readComposerText, setComposerText}) {
    const reader = globalThis.SellerAgentsObservedAICodeReaders.readers[ID];
    function composerContext() {
      if (!matchesLocation()) return null;
      const editors = [...document.querySelectorAll(EDITOR)].filter(n => rendered(n) &&
        !n.closest(MESSAGE) && !n.closest('[aria-disabled="true"]') &&
        (n instanceof HTMLTextAreaElement ? !n.disabled && !n.readOnly : n.isContentEditable));
      if (editors.length !== 1) return null;
      const composer = editors[0], root = composer.closest(ROOT);
      if (!root || !rendered(root) || root.isContentEditable || root.closest(MESSAGE) ||
          root.parentElement?.closest(ROOT) || root.querySelectorAll(EDITOR).length !== 1 ||
          root.querySelectorAll('input[type="file"]').length !== 1 ||
          root.querySelectorAll(INPUT).length !== 1 || root.querySelector(MESSAGE)) return null;
      if (!composer.closest("div._020ab5b") || composer.closest("div._020ab5b").parentElement !== root) return null;
      return {root, composer, form:composer.closest("form"), locationHref:location.href};
    }
    function conversationRoot() {
      const c=composerContext();
      if (!c) return null;
      const roots=[...document.querySelectorAll(CHAT_ROOT)].filter(rendered);
      return roots.length===1 && roots[0].contains(c.root) && c.composer.closest(CHAT_ROOT)===roots[0] ? roots[0] : null;
    }
    function roleOf(node,root) {
      if (!(node instanceof HTMLElement) || !rendered(node) || node.closest(CHAT_ROOT) !== root ||
          node.parentElement?.closest(MESSAGE) || node.querySelector(MESSAGE) ||
          [...node.querySelectorAll("[contenteditable]")].some(n=>n.isContentEditable)) return "";
      const p1=node.parentElement,p2=p1?.parentElement,p3=p2?.parentElement;
      if (!p2?.matches("div.ds-virtual-list-visible-items") || !p3?.matches("div.ds-virtual-list-items._6f2c522")) return "";
      if (node.matches("div.ds-message.d29f3d7d") && p1?.matches("div._9663006")) return "user";
      if (node.matches("div.ds-message:not(.d29f3d7d)") && p1?.matches("div._4f9bf79._43c05b5") &&
          node.querySelector(".ds-markdown.ds-assistant-message-main-content")) return "assistant";
      return "";
    }
    function nativeWitness() { return ""; }
    function bodyText(node,role) {
      if (role==="user") {
        const body=[...node.querySelectorAll(".ds-collapsible-text")].filter(n=>n.closest(MESSAGE)===node && rendered(n));
        return body.length===1 ? body[0].innerText || "" : "";
      }
      return role==="assistant" ? node.innerText || "" : "";
    }
    // These witnesses belong only to this document/root epoch. They are not
    // provider conversation IDs and are never written back into the page.
    // Retiring any previously observed node (including virtualization/remount)
    // retires ALL witnesses, so partial history replacement cannot look like Send.
    let observation=null, sequence=0;
    function observeMessages() {
      const root=conversationRoot();
      if (!root) { observation=null; return {rows:[],ids:new Map()}; }
      const rows=[...root.querySelectorAll(MESSAGE)].map(node=>{
        const role=roleOf(node,root);
        return {node,role,native:nativeWitness(node,role),text:role==="user"?bodyText(node,role):null};
      }).filter(row=>row.role);
      const retained=observation && observation.root===root && observation.href===location.href &&
        observation.rows.every((old,i)=>rows[i]?.node===old.node && rows[i].role===old.role &&
          rows[i].native===old.native && rows[i].text===old.text);
      if (!retained) { observation={root,href:location.href,epoch:crypto.randomUUID(),rows:[],nodes:new WeakMap()}; sequence=0; }
      const ids=new Map();
      for (const row of rows) {
        if (!observation.nodes.has(row.node)) observation.nodes.set(row.node,++sequence);
        const local=row.role+":node-"+observation.nodes.get(row.node);
        if (local) ids.set(row.node,"local:"+observation.epoch+":"+local);
      }
      observation.rows=rows;
      return {rows,ids};
    }
    function userMessages() { return observeMessages().rows.filter(r=>r.role==="user").map(r=>r.node); }
    function assistantMessages() {
      const eligible=new Set(reader.assistantMessages());
      return observeMessages().rows.filter(r=>r.role==="assistant" && eligible.has(r.node.querySelector(".ds-markdown.ds-assistant-message-main-content"))).map(r=>r.node);
    }
    function messageId(node) { return observeMessages().ids.get(node) || ""; }
    function messageText(node) {
      const root=conversationRoot(),role=root ? roleOf(node,root) : "";
      return role ? bodyText(node,role) : "";
    }
    function currentContext(context) {
      if (!context || context.locationHref !== location.href) return null;
      const fresh = composerContext();
      return fresh && fresh.root === context.root && fresh.composer === context.composer ? fresh : null;
    }
    function cards(root) {
      return [...root.querySelectorAll(CARD)].filter(n => !n.closest(MESSAGE) && rendered(n));
    }
    function controls(context) {
      const c = currentContext(context);
      return c ? [...c.root.querySelectorAll("div[role=\"button\"].ds-button")].filter(n => !n.closest(MESSAGE) && rendered(n)) : [];
    }
    function classify(context) {
      const c = currentContext(context);
      if (!c) return {kind:"unknown",button:null};
      if (c.root.querySelector('[data-icon="spin"],[role="progressbar"],[aria-busy="true"]')) return {kind:"busy",button:null};
      const all = controls(c), sends = all.filter(n => n.matches(".ds-button--primary._52c986b"));
      if (sends.length !== 1) return {kind:"unknown",button:null};
      const button = sends[0], paths = button.querySelectorAll("svg path");
      if (paths.length !== 1 || paths[0].getAttribute("d") !== "M8.3125 0.980206C8.66767 1.05312 8.97902 1.2042 9.2627 1.43235C9.48724 1.613 9.73029 1.85795 9.97949 2.10716L14.707 6.8347L13.293 8.24876L9 3.95579V15.0417H7V3.95579L2.70703 8.24876L1.29297 6.8347L6.02051 2.10716C6.26971 1.85795 6.51277 1.613 6.7373 1.43235C6.97662 1.23988 7.28445 1.04404 7.6875 0.980206C7.8973 0.947029 8.1031 0.955183 8.3125 0.980206Z") return {kind:"unknown",button:null};
      const disabled = button.classList.contains("ds-button--disabled") || button.getAttribute("aria-disabled") === "true";
      // Captured spinner is busy, never asserted to be the unknown Stop.
      return {kind:disabled ? "send_disabled" : "send_active",button};
    }
    function attachmentPreview(filename) {
      const c = composerContext();
      if (!c || !validName(filename)) return null;
      const list = cards(c.root);
      if (list.length !== 1) return null;
      const name = list[0].querySelectorAll(".e70accd6"), type = list[0].querySelectorAll("._7103a25");
      return name.length === 1 && type.length === 1 && name[0].textContent === filename &&
        /^TXT(?:\s|$)/.test(type[0].textContent.trim()) ? list[0] : null;
    }
    function attachmentSurface() {
      const c = composerContext();
      if (!c || !["ready","send_disabled"].includes(classify(c).kind) ||
          readComposerText(c.composer).trim() || cards(c.root).length) return null;
      const input = c.root.querySelector(INPUT);
      if (!(input instanceof HTMLInputElement) || !input.isConnected || !input.multiple ||
          input.disabled || input.matches(":disabled") || input.files?.length ||
          input.getAttribute("aria-disabled") === "true" || input.closest(EXCLUDED) ||
          !((input.getAttribute("accept") || "").toLowerCase().split(",").map(s=>s.trim()).includes(".txt"))) return null;
      return {kind:"file_input_v1",input,root:c.root,locationHref:c.locationHref};
    }
    return Object.freeze({
      id:ID, label:"DeepSeek", matchesLocation, composerContext,
      classifyComposerControl:classify, allComposerControls:controls,
      readComposerText(composer) { return composerContext()?.composer === composer ? readComposerText(composer) : ""; },
      setComposerText(composer,value) {
        const c = composerContext();
        if (!c || c.composer !== composer || !["ready","send_active","send_disabled"].includes(classify(c).kind))
          fail("COMPOSER_NOT_AVAILABLE");
        setComposerText(composer,value);
        if (!currentContext(c) || readComposerText(composer) !== String(value || "")) fail("COMPOSER_CONTEXT_CHANGED");
      },
      sendButtonCandidates(context) {
        const s = classify(context);
        return s.kind === "send_active" ? [{button:s.button,score:2000}] : [];
      },
      sendButton(context) { return this.sendButtonCandidates(context)[0]?.button || null; },
      sendButtonFingerprint(button) {
        const s = classify(composerContext());
        return s.button === button && button instanceof HTMLElement ?
          [button.tagName,button.getAttribute("data-testid") || "",button.getAttribute("aria-label") || "","observed_arrow"].join("|") : "";
      },
      isGenerating() { return ["stop","busy","unknown"].includes(classify(composerContext()).kind); },
      conversationRoot, userMessages, assistantMessages, messageId, messageText,
      findCodeBlocks(node) {
        if (!assistantMessages().includes(node)) return [];
        return reader.findCodeBlocks(node.querySelector(".ds-markdown.ds-assistant-message-main-content"));
      },
      readCodeText:reader.readCodeText, geometryAnchor:reader.geometryAnchor,
      // Spinner/disabled Send alone do not prove assistant completion.
      messageComplete() { return false; },
      attachmentSurface, attachmentPreview,
      attachFiles(surface,files) {
        const c = attachmentSurface();
        if (!c || c.input !== surface?.input || c.root !== surface?.root ||
            c.locationHref !== surface?.locationHref || c.kind !== surface?.kind)
          fail("TARGET_AI_ATTACHMENT_SURFACE_UNAVAILABLE");
        if (!Array.isArray(files) || files.length !== 1 || !(files[0] instanceof File) ||
            !validName(files[0].name) || files[0].size > 1024 * 1024 || !["","text/plain"].includes(files[0].type))
          fail("TARGET_AI_FILE_TYPE_UNSUPPORTED");
        return globalThis.OzonWebFileAttachment.setInputFiles(c.input,files);
      },
      // A filename/card plus enabled Send is not evidence of upload completion.
      attachmentReady() { return false; },
      sentAttachmentMessage() { return null; },
      integrationStatus() {
        return Object.freeze({status:"pending",message_identity:"document_scoped_nodes",
          upload_end:"not_observed",registry_activated:false});
      }
    });
  }
  globalThis.SellerAgentsDeepSeekAdapter = Object.freeze({create});
})();
