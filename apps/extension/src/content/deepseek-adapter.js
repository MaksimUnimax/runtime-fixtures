/* DeepSeek B02 text transport using accepted roots and 09:05 transition.
 * Messages use conservative document-only node witnesses; replacement retires them.
 * Natural completion uses the current assistant's own terminal toolbar and no Stop.
 * Upload readiness follows the observed same-card loading-to-TXT transition.
 * Forced Stop/retry variants remain unobserved; provider bytes are not inferred.
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
      if (node.matches("div.ds-message:not(.d29f3d7d)") && p1?.matches("div._4f9bf79") &&
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
    function messageObservationEpoch() { observeMessages(); return observation?.epoch || ""; }
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
    const validDescriptor = d => validName(d?.filename) && Number.isSafeInteger(d.byte_length) &&
      d.byte_length >= 0 && d.byte_length <= 1024 * 1024;
    function cardDetails(card) {
      if (!(card instanceof HTMLElement) || !rendered(card) ||
          card.querySelector('[data-icon="spin"],.ds-loading,svg[role="img"][aria-label],[role="progressbar"],[aria-busy="true"],[role="alert"]')) return null;
      const names=card.querySelectorAll(".e70accd6"), types=card.querySelectorAll("._7103a25");
      if (names.length!==1 || types.length!==1 || !rendered(names[0]) || !rendered(types[0]) ||
          !validName(names[0].textContent) || !/^TXT\s+\d+(?:\.\d+)?(?:B|KB|MB)$/.test(types[0].textContent.trim())) return null;
      return {filename:names[0].textContent};
    }
    function stagedReadyCard(c) {
      if (!c || c.root.querySelectorAll(CARD).length!==1) return null;
      const card=cards(c.root)[0], branch=card?.closest("div.b40079d7._2113217");
      if (!branch || branch.parentElement!==c.root || !cardDetails(card) ||
          card.querySelectorAll('div._8402d8c[tabindex="0"]').length!==1) return null;
      const files=c.root.querySelector(INPUT)?.files;
      if (files?.length && (files.length!==1 || files[0].name!==cardDetails(card).filename)) return null;
      return card;
    }
    function attachmentReady(descriptors) {
      if (!Array.isArray(descriptors) || descriptors.length!==1 || !validDescriptor(descriptors[0])) return false;
      const c=composerContext(),card=stagedReadyCard(c),d=descriptors[0];
      if (!card || cardDetails(card).filename!==d.filename ||
          !["send_active","send_disabled"].includes(classify(c).kind)) return false;
      const files=c.root.querySelector(INPUT)?.files;
      return !files?.length || (files.length===1 && files[0].name===d.filename && files[0].size===d.byte_length);
    }
    function sentAttachmentMessage(node,descriptors) {
      const root=conversationRoot();
      if (!root || roleOf(node,root)!=="user" || !messageId(node) ||
          !Array.isArray(descriptors) || descriptors.length!==1 || !validDescriptor(descriptors[0])) return null;
      const found=[...node.querySelectorAll(CARD)];
      if (found.length!==1 || found[0].closest(MESSAGE)!==node ||
          found[0].closest(".eafda4ae")?.parentElement!==node ||
          found[0].querySelector("._8402d8c") || cardDetails(found[0])?.filename!==descriptors[0].filename) return null;
      const bodies=[...node.querySelectorAll(".ds-collapsible-text")].filter(n=>n.closest(MESSAGE)===node && rendered(n));
      if (bodies.length!==1 || bodies[0].contains(found[0])) return null;
      return Object.freeze({text:bodyText(node,"user")});
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
      if (paths.length === 1 && paths[0].getAttribute("d") === "M2 4.88C2 3.68009 2 3.08013 2.30557 2.65954C2.40426 2.52371 2.52371 2.40426 2.65954 2.30557C3.08013 2 3.68009 2 4.88 2H11.12C12.3199 2 12.9199 2 13.3405 2.30557C13.4763 2.40426 13.5957 2.52371 13.6944 2.65954C14 3.08013 14 3.68009 14 4.88V11.12C14 12.3199 14 12.9199 13.6944 13.3405C13.5957 13.4763 13.4763 13.5957 13.3405 13.6944C12.9199 14 12.3199 14 11.12 14H4.88C3.68009 14 3.08013 14 2.65954 13.6944C2.52371 13.5957 2.40426 13.4763 2.30557 13.3405C2 12.9199 2 12.3199 2 11.12V4.88Z")
        return {kind:"stop",button};
      if (paths.length !== 1 || paths[0].getAttribute("d") !== "M8.3125 0.980206C8.66767 1.05312 8.97902 1.2042 9.2627 1.43235C9.48724 1.613 9.73029 1.85795 9.97949 2.10716L14.707 6.8347L13.293 8.24876L9 3.95579V15.0417H7V3.95579L2.70703 8.24876L1.29297 6.8347L6.02051 2.10716C6.26971 1.85795 6.51277 1.613 6.7373 1.43235C6.97662 1.23988 7.28445 1.04404 7.6875 0.980206C7.8973 0.947029 8.1031 0.955183 8.3125 0.980206Z") return {kind:"unknown",button:null};
      const disabled = button.classList.contains("ds-button--disabled") || button.getAttribute("aria-disabled") === "true";
      const staged=c.root.querySelectorAll(CARD).length>0;
      if (staged ? !stagedReadyCard(c) : c.root.querySelector(INPUT)?.files?.length)
        return {kind:"unknown",button:null};
      if (staged && !disabled && button.getAttribute("tabindex")!=="0") return {kind:"unknown",button:null};
      if (!staged && !readComposerText(c.composer).trim()) return {kind:"ready",button:null};
      // Only the observed arrow permits text Send; spinner and square Stop do not.
      return {kind:disabled ? "send_disabled" : "send_active",button};
    }
    function completionObservation(node) {
      const unknown = (reason, actionsObserved=false) => Object.freeze({
        status:"unknown", reason, actionsObserved
      });
      const assistants=assistantMessages();
      if (!assistants.includes(node) || assistants.at(-1)!==node || !messageId(node) ||
          !messageText(node).trim()) return unknown("current_assistant_not_owned");
      const rows=observeMessages().rows;
      const lastUser=rows.findLastIndex(row=>row.role==="user");
      // An older completed answer is not the response to a newer submitted turn.
      if (lastUser<0 || rows.findIndex(row=>row.node===node)<=lastUser)
        return unknown("current_user_response_not_observed");
      const state=classify(composerContext());
      if (!["ready","send_active","send_disabled"].includes(state.kind))
        return unknown("composer_busy_or_unknown");
      const parent=node.parentElement, toolbar=node.nextElementSibling;
      if (!parent.matches("div._4f9bf79._43c05b5") || parent.children.length!==2 || parent.firstElementChild!==node ||
          !toolbar?.matches("div.ds-flex._0a3d93b") || !rendered(toolbar) ||
          toolbar.querySelector(MESSAGE)) return unknown("terminal_actions_not_observed");
      const group=toolbar.firstElementChild;
      if (!group?.matches("div.ds-flex._965abe9._54866f7") || !rendered(group))
        return unknown("terminal_actions_not_observed");
      const buttons=[...group.children];
      if (buttons.length!==6 || toolbar.querySelectorAll('[role="button"]').length!==6 ||
          buttons.some(n=>!n.matches('div.ds-button.db183363[role="button"][tabindex="0"]') ||
            !rendered(n) || n.getAttribute("aria-disabled")==="true" || n.matches(":disabled") ||
            n.classList.contains("ds-button--disabled") || getComputedStyle(n).pointerEvents==="none") ||
          buttons[1].getAttribute("aria-disabled")!=="false" ||
          buttons[4].getAttribute("aria-label")!=="Читать вслух" ||
          buttons.filter(n=>n.getAttribute("aria-label")==="Читать вслух").length!==1)
        return unknown("terminal_actions_not_observed");
      // Same-assistant 09:05 snapshots show no own toolbar with square Stop,
      // then this terminal structure and the Send arrow after natural completion.
      // No dependency on snapshot key14, capture text or inferred icon functions.
      return Object.freeze({status:"complete",reason:"observed_natural_terminal_toolbar",actionsObserved:true});
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
      conversationRoot, userMessages, assistantMessages, messageId, messageText, messageObservationEpoch,
      findCodeBlocks(node) {
        if (!assistantMessages().includes(node)) return [];
        return reader.findCodeBlocks(node.querySelector(".ds-markdown.ds-assistant-message-main-content"));
      },
      readCodeText:reader.readCodeText, geometryAnchor:reader.geometryAnchor,
      completionObservation,
      messageComplete(node) { return completionObservation(node).status==="complete"; },
      deliveryCapabilities() { return globalThis.OzonAIDeliveryCapabilities?.profile?.("deepseek") || null; },
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
      // Readiness and a new owned sent-card witness are separate checks.
      attachmentReady, sentAttachmentMessage,
      integrationStatus() {
        return Object.freeze({status:"implemented",message_identity:"document_scoped_nodes",
          assistant_completion:"observed_natural_terminal_toolbar",
          upload_end:"observed_same_card_status_transition",registry_activated:true});
      }
    });
  }
  globalThis.SellerAgentsDeepSeekAdapter = Object.freeze({create});
})();
