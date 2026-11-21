/* Claude B02 text adapter using accepted 19 Oct controls and 20 Oct 07:05 parents.
 * Native turn/user-parent IDs are document-scoped witnesses, not permanent chat IDs.
 * Upload readiness uses the observed pending/Skeleton-to-CardLink transition.
 * Sent-file confirmation is scoped to one observed user article, not the composer.
 * No click, execution or signed authority is created here. */
(() => {
  "use strict";
  const ID = "claude", ORIGIN = "https://claude.ai";
  const EDITOR = "[data-testid=\"chat-input\"][contenteditable=\"true\"][role=\"textbox\"]", ROOT = "div.flex.w-full.min-w-0.flex-col", MESSAGE = "[data-testid=\"user-message\"],[data-testid=\"assistant-message\"]";
  const INPUT = "input[type=\"file\"][data-testid=\"file-upload\"]#chat-input-file-upload-bottom", CARD = "[data-testid=\"file-thumbnail\"]";
  const CHAT_ROOT = "[data-testid=\"chat-column\"]";
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
      const composer = editors[0], semantic = composer.closest('[data-cds="ChatComposer"]'), root = semantic || composer.closest(ROOT);
      if (!root || !rendered(root) || root.isContentEditable || root.closest(MESSAGE) ||
          (!semantic && root.parentElement?.closest(ROOT)) || root.querySelectorAll(EDITOR).length !== 1 ||
          root.querySelectorAll('[data-cds="ChatComposer"]').length ||
          root.querySelectorAll('input[type="file"]').length > 1 ||
          (!semantic && root.querySelectorAll(INPUT).length !== 1) ||
          (root.querySelectorAll('input[type="file"]').length && root.querySelectorAll(INPUT).length !== 1) ||
          root.querySelector(MESSAGE)) return null;

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
      if (node.matches('[data-testid="user-message"]') && p1?.matches("div.cds-user-message-body") &&
          p2?.matches("div[id]") && p3?.matches("div.relative.flex.min-w-0.flex-col.gap-xs")) return "user";
      if (node.matches('[data-testid="assistant-message"]') && p1?.classList.contains("group") &&
          p1?.classList.contains("group/message-row") && p2?.matches("div.mt-xs") && p3?.matches("div.contents")) return "assistant";
      return "";
    }
    function nativeWitness(node,role) {
      const value=role==="assistant" ? node.getAttribute("data-turn-key") : node.parentElement?.parentElement?.id;
      if (typeof value!=="string" || value.length>180 || /[\s|\u0000-\u001f]/u.test(value)) return "";
      if (role==="assistant" ? !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value) : !/^_r_[A-Za-z0-9_-]+_$/.test(value)) return "";
      return role+":"+value;
    }
    function bodyText(node,role) {
      if (role==="user") return node.innerText || "";
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
          (rows[i].native===old.native || (old.role==="assistant" && !old.native)) && rows[i].text===old.text);
      if (!retained) { observation={root,href:location.href,epoch:crypto.randomUUID(),rows:[],nodes:new WeakMap()}; sequence=0; }
      const ids=new Map();
      for (const row of rows) {
        if (!observation.nodes.has(row.node)) observation.nodes.set(row.node,++sequence);
        const local=row.native && rows.filter(other=>other.native===row.native).length===1 ? row.native : "";
        if (local) ids.set(row.node,"local:"+observation.epoch+":"+local);
      }
      observation.rows=rows;
      return {rows,ids};
    }
    function userMessages() { return observeMessages().rows.filter(r=>r.role==="user").map(r=>r.node); }
    function assistantMessages() {
      const eligible=new Set(reader.assistantMessages());
      return observeMessages().rows.filter(r=>r.role==="assistant" && eligible.has(r.node)).map(r=>r.node);
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
    function inputContext(c) {
      // The observed file input may be a sibling of the semantic ChatComposer.
      // Only the prior observed LCA shape with one editor/input and no messages qualifies.
      for (let root=c?.root; root instanceof HTMLElement && root!==document.body; root=root.parentElement) {
        if (root.matches(CHAT_ROOT) || root.closest(EXCLUDED) || root.closest(MESSAGE) || root.closest('[role="article"]')) return null;
        if (!root.matches(ROOT)) continue;
        if (root.querySelector(MESSAGE) || root.querySelectorAll(EDITOR).length!==1 ||
            root.querySelector(EDITOR)!==c.composer) return null;
        const inputs=root.querySelectorAll('input[type="file"]');
        if (inputs.length>1) return null;
        if (inputs.length===1) return inputs[0].matches(INPUT) ? {root,input:inputs[0]} : null;
      }
      return null;
    }
    function cardDetails(card) {
      if (!(card instanceof HTMLElement) || !rendered(card) ||
          card.matches('[data-state="pending"],[aria-busy="true"]') ||
          card.querySelector('[data-state="pending"],[aria-busy="true"],[data-cds="Skeleton"],[role="progressbar"],[role="alert"]')) return null;
      const names=card.querySelectorAll('[data-cds="CardLink"][title]'),badges=card.querySelectorAll('[data-cds="Badge"]');
      if (names.length!==1 || badges.length!==1 || !validName(names[0].getAttribute("title")) ||
          names[0].getAttribute("role")!=="button" || names[0].getAttribute("tabindex")!=="0" ||
          !rendered(badges[0]) || badges[0].closest(".invisible") || badges[0].textContent.trim()!=="TXT") return null;
      return {filename:names[0].getAttribute("title")};
    }
    function stagedReadyCard(c) {
      if (!c || c.root.querySelectorAll(CARD).length!==1) return null;
      const card=cards(c.root)[0],branch=card?.closest("[data-cds-composer-attachments]"),detail=cardDetails(card);
      if (!branch || !c.root.contains(branch) || branch.closest('[data-cds="ChatComposer"]')!==c.root ||
          !card.matches('[data-cds="MessageAttachmentsFile"]') || card.hasAttribute("data-state") ||
          !detail || card.querySelectorAll("button[data-cds-attachment-remove]").length!==1) return null;
      const remove=card.querySelector("button[data-cds-attachment-remove]");
      if (remove.getAttribute("aria-label")!=="Удалить: "+detail.filename) return null;
      const files=inputContext(c)?.input.files;
      if (files?.length && (files.length!==1 || files[0].name!==detail.filename)) return null;
      return card;
    }
    function attachmentReady(descriptors) {
      if (!Array.isArray(descriptors) || descriptors.length!==1 || !validDescriptor(descriptors[0])) return false;
      const c=composerContext(),card=stagedReadyCard(c),d=descriptors[0];
      if (!card || cardDetails(card).filename!==d.filename ||
          !["send_active","send_disabled"].includes(classify(c).kind)) return false;
      const files=inputContext(c)?.input.files;
      return !files?.length || (files.length===1 && files[0].name===d.filename && files[0].size===d.byte_length);
    }
    function sentAttachmentMessage(node,descriptors) {
      const root=conversationRoot();
      if (!root || roleOf(node,root)!=="user" || !messageId(node) ||
          !Array.isArray(descriptors) || descriptors.length!==1 || !validDescriptor(descriptors[0])) return null;
      const article=node.closest('[role="article"]');
      if (!article || !rendered(article) || article.closest(CHAT_ROOT)!==root ||
          article.querySelectorAll(MESSAGE).length!==1 || article.querySelector(MESSAGE)!==node ||
          article.querySelector('[role="article"],[contenteditable="true"],[data-cds="ChatComposer"]')) return null;
      const found=article.querySelectorAll(CARD);
      if (found.length!==1 || !rendered(found[0]) || node.contains(found[0]) ||
          found[0].closest('[role="article"]')!==article ||
          found[0].closest("[data-cds-composer-attachments]") ||
          found[0].matches('[data-state="pending"],[aria-busy="true"]') ||
          found[0].querySelector('[data-cds-attachment-remove],[aria-busy="true"],[data-cds="Skeleton"],[role="progressbar"],[role="alert"]')) return null;
      let name=cardDetails(found[0])?.filename;
      // Earlier accepted S08 completed card used a button/h3/TXT badge.
      if (!name && found[0].classList.contains("group/thumbnail")) {
        const buttons=found[0].querySelectorAll('button[type="button"]'),names=found[0].querySelectorAll("h3"),
          types=found[0].querySelectorAll("p.uppercase");
        if (buttons.length!==1 || names.length!==1 || types.length!==1 ||
            !buttons[0].contains(names[0]) || !buttons[0].contains(types[0]) ||
            !rendered(names[0]) || !rendered(types[0]) || types[0].textContent.trim().toUpperCase()!=="TXT") return null;
        name=names[0].textContent;
      }
      return name===descriptors[0].filename ? Object.freeze({text:bodyText(node,"user")}) : null;
    }
    function controls(context) {
      const c = currentContext(context);
      return c ? [...c.root.querySelectorAll("button")].filter(n => !n.closest(MESSAGE) && rendered(n)) : [];
    }
    function classify(context) {
      const c = currentContext(context);
      if (!c) return {kind:"unknown",button:null};
      const stops = [...document.querySelectorAll('button[data-testid="chat-input-stop"][aria-label="Остановить ответ"]')]
        .filter(n => !n.closest(MESSAGE) && rendered(n));
      if (stops.length) return {kind:stops.length === 1 ? "stop" : "unknown",
        button:stops.length === 1 && c.root.contains(stops[0]) ? stops[0] : null};
      // Busy was observed with a missing data-is-streaming attribute.
      // Only explicit false clears this signal; absence is not idle evidence.
      const assistantStates = [...document.querySelectorAll('[data-testid="assistant-message"]')].filter(rendered);
      if (assistantStates.some(n => n.getAttribute("data-is-streaming") === "true")) return {kind:"busy",button:null};
      if (assistantStates.some(n => n.getAttribute("data-is-streaming") !== "false")) return {kind:"unknown",button:null};
      if (c.root.matches('[role="progressbar"],[aria-busy="true"],[data-state="pending"],[data-cds="Skeleton"]') ||
          c.root.querySelector('[role="progressbar"],[aria-busy="true"],[data-state="pending"],[data-cds="Skeleton"]')) return {kind:"busy",button:null};
      const staged=c.root.querySelectorAll(CARD).length>0;
      if (staged ? !stagedReadyCard(c) : inputContext(c)?.input.files?.length) return {kind:"unknown",button:null};
      const sends = controls(c).filter(n => n.matches('button[data-testid="chat-input-send"][aria-label="Отправить сообщение"]'));
      // The observed empty composer exposes Voice while Send is hidden.
      // This admits input preparation only: it never supplies a Send candidate.
      if (sends.length === 0 && !staged && !readComposerText(c.composer).trim()) {
        const voice = controls(c).filter(n => n.matches('button[type="button"][data-cds="Button"][aria-label="Включить голосовой режим"]'));
        if (voice.length === 1) return {kind:"ready",button:null};
      }
      if (sends.length !== 1) return {kind:"unknown",button:null};
      const button = sends[0], disabled = button.disabled || button.matches(":disabled") ||
        button.getAttribute("aria-disabled") === "true" || button.hasAttribute("data-disabled");
      if (!staged && !readComposerText(c.composer).trim()) return {kind:"ready",button:null};
      return {kind:disabled ? "send_disabled" : "send_active",button};
    }
    function attachmentPreview(filename) {
      const c = composerContext();
      if (!c || !validName(filename)) return null;
      const list = cards(c.root);
      if (list.length !== 1) return null;
      const names = list[0].querySelectorAll('[data-cds="CardLink"][title]'),
        badges = list[0].querySelectorAll('[data-cds="Badge"]');
      return names.length === 1 && badges.length === 1 && names[0].getAttribute("title") === filename &&
        badges[0].textContent.trim() === "TXT" ? list[0] : null;
    }
    function attachmentSurface() {
      const c = composerContext();
      if (!c || !["ready","send_disabled"].includes(classify(c).kind) ||
          readComposerText(c.composer).trim() || cards(c.root).length) return null;
      const selected=inputContext(c), input=selected?.input;
      if (!(input instanceof HTMLInputElement) || !input.isConnected || !input.multiple ||
          input.disabled || input.matches(":disabled") || input.files?.length ||
          input.getAttribute("aria-disabled") === "true" || input.closest(EXCLUDED) ||
          !(input.getAttribute("accept") === "")) return null;
      return {kind:"file_input_v1",input,root:c.root,inputRoot:selected.root,locationHref:c.locationHref};
    }
    return Object.freeze({
      id:ID, label:"Claude", matchesLocation, composerContext,
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
          [button.tagName,button.getAttribute("data-testid") || "",button.getAttribute("aria-label") || "",button.type].join("|") : "";
      },
      isGenerating() { return ["stop","busy","unknown"].includes(classify(composerContext()).kind); },
      conversationRoot, userMessages, assistantMessages, messageId, messageText, messageObservationEpoch,
      findCodeBlocks:reader.findCodeBlocks, readCodeText:reader.readCodeText, geometryAnchor:reader.geometryAnchor,
      messageComplete(node) {
        return assistantMessages().includes(node) && Boolean(messageId(node)) &&
          node.getAttribute("data-is-streaming")==="false" &&
          ["ready","send_active","send_disabled"].includes(classify(composerContext()).kind) &&
          Boolean(messageText(node).trim());
      },
      deliveryCapabilities() { return globalThis.OzonAIDeliveryCapabilities?.profile?.("claude") || null; },
      attachmentSurface, attachmentPreview,
      attachFiles(surface,files) {
        const c = attachmentSurface();
        if (!c || c.input !== surface?.input || c.root !== surface?.root || c.inputRoot !== surface?.inputRoot ||
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
        return Object.freeze({status:"implemented",message_identity:"document_scoped_native_witness",
          upload_end:"observed_pending_skeleton_transition",registry_activated:true});
      }
    });
  }
  globalThis.SellerAgentsClaudeAdapter = Object.freeze({create});
})();
