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
      // A private upload can temporarily mask the editor. Observation may retain
      // a fully revalidated conversation; this never returns a Send composer.
      if (!c) return attachmentConversationObservation()?.root || null;
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
    const UPLOAD_MENU = '[role="menu"][data-perf-overlay="composer_add_menu"]';
    const UPLOAD_DIALOG = '[role="dialog"][data-cds="Dialog"][data-perf-overlay="composer_radiant_pine_dialog"]';
    let uploadPreparation = null, preparedUpload = null;
    function panelVisible(node, dialog = null) {
      if (!(node instanceof HTMLElement) || !node.isConnected ||
          node.closest('[hidden],[aria-hidden="true"],[inert]') ||
          (dialog ? node.closest('[role="dialog"]') !== dialog : node.closest('[role="dialog"]'))) return false;
      const rect = node.getBoundingClientRect();
      if (!node.getClientRects().length || rect.width <= 0 || rect.height <= 0) return false;
      for (let p = node; p instanceof Element; p = p.parentElement) {
        const style = getComputedStyle(p);
        if (style.display === "none" || ["hidden","collapse"].includes(style.visibility) ||
            style.contentVisibility === "hidden" || Number(style.opacity) === 0) return false;
      }
      return true;
    }
    // A native upload dialog marks ONLY the previously observed editor
    // aria-hidden. This private attachment guard never makes that editor a
    // general composer/Send target and never accepts a pre-existing modal.
    function uploadButtonOwned(owner) {
      const button = owner?.button, actions = owner?.actions;
      if (rendered(button)) return true;
      if (!owner?.modalRequested || !(actions instanceof HTMLElement) ||
          !actions.isConnected || !owner.context.root.contains(actions) ||
          button?.closest('[data-cds="ChatComposerActions"]') !== actions ||
          actions.getAttribute('aria-hidden') !== 'true' ||
          !(button instanceof HTMLElement) || !button.isConnected) return false;
      const rect=button.getBoundingClientRect();
      if (rect.width<=0 || rect.height<=0) return false;
      for (let node=button; node instanceof Element; node=node.parentElement) {
        if (node.matches('[hidden],[inert],[role="dialog"]') ||
            (node.getAttribute('aria-hidden')==='true' && node!==actions)) return false;
        const css=getComputedStyle(node);
        if (css.display==='none' || ['hidden','collapse'].includes(css.visibility) ||
            css.contentVisibility==='hidden' || Number(css.opacity)===0) return false;
      }
      return true;
    }
    function uploadOwnerNodesCurrent(owner) {
      const c = owner?.context, button = owner?.button;
      // Structural observation is deliberately separate from isCurrent: that
      // callback invokes the real conversation tracker and must not recurse.
      if (!owner?.modalRequested || owner.retired ||
          !matchesLocation() || location.href !== c?.locationHref ||
          !(c.composer instanceof HTMLElement) || !c.composer.isConnected ||
          !c.composer.matches(EDITOR) || !c.composer.isContentEditable ||
          !(c.root instanceof HTMLElement) || !c.root.isConnected || !rendered(c.root) ||
          c.composer.parentElement !== owner.editorParent || c.root.parentElement !== owner.rootParent ||
          !c.root.contains(c.composer) || c.root.querySelectorAll(EDITOR).length !== 1 ||
          c.root.querySelector(EDITOR) !== c.composer ||
          document.querySelectorAll(EDITOR).length !== 1 ||
          c.composer.matches('[hidden],[inert],[aria-disabled="true"]') ||
          c.composer.parentElement?.closest(EXCLUDED+',fieldset:disabled,[aria-disabled="true"]') ||
          readComposerText(c.composer).trim() || c.root.querySelector(CARD) ||
          c.root.querySelectorAll('button[data-testid="chat-input-attach"]').length !== 1 ||
          c.root.querySelector('button[data-testid="chat-input-attach"]') !== button ||
          !uploadButtonOwned(owner) || button.disabled || button.matches(':disabled') ||
          button.getAttribute('aria-disabled') === 'true') return false;
      const rect = c.composer.getBoundingClientRect(), style = getComputedStyle(c.composer);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
        !['hidden','collapse'].includes(style.visibility) && style.contentVisibility !== 'hidden' &&
        Number(style.opacity) !== 0;
    }
    function uploadOwnerCurrent(owner) {
      if (!uploadOwnerNodesCurrent(owner) || typeof owner?.isCurrent !== "function") return false;
      const accepted = owner.isCurrent();
      if (!accepted) owner.retired = true;
      return accepted && uploadOwnerNodesCurrent(owner);
    }
    function conversationWitness(root) {
      if (!(root instanceof HTMLElement) || !rendered(root)) return null;
      return {
        root, parent:root.parentElement,
        explicit:["data-conversation-id","data-chat-id","data-thread-id"].map(k=>root.getAttribute(k)),
        rows:[...root.querySelectorAll(MESSAGE)].map(node=>{
          const role=roleOf(node,root);
          return {node,role,native:nativeWitness(node,role),text:role==="user"?bodyText(node,role):null};
        }).filter(row=>row.role)
      };
    }
    function attachmentConversationObservation() {
      const owner=preparedUpload || (uploadPreparation?.pending ? uploadPreparation : null);
      if (!owner || !uploadOwnerNodesCurrent(owner)) return null;
      const saved=owner.conversation, roots=[...document.querySelectorAll(CHAT_ROOT)].filter(rendered);
      const root=saved?.root, now=conversationWitness(root);
      // A URL or a previously captured ID is not proof. Re-read the same live
      // root, native messages, user text, ancestor and explicit identity fields.
      if (!now || roots.length!==1 || roots[0]!==root || now.parent!==saved.parent ||
          !root.contains(owner.context.root) || owner.context.composer.closest(CHAT_ROOT)!==root ||
          now.explicit.some((id,i)=>id!==saved.explicit[i]) || now.rows.length!==saved.rows.length ||
          now.rows.some((row,i)=>row.node!==saved.rows[i].node || row.role!==saved.rows[i].role ||
            row.native!==saved.rows[i].native || row.text!==saved.rows[i].text)) {
        owner.retired=true;
        return null;
      }
      const dialogs=[...document.querySelectorAll('[role="dialog"]')].filter(n=>panelVisible(n,n));
      if (dialogs.length!==1 || !dialogs[0].matches(UPLOAD_DIALOG) ||
          dialogs[0].querySelector('[role="dialog"],[contenteditable="true"],textarea')) return null;
      const dialog=dialogs[0];
      if (owner.observedDialog && owner.observedDialog!==dialog) { owner.retired=true; return null; }
      owner.observedDialog=dialog;
      // The known modal shell may precede the native file widget. The observer
      // authorizes no upload; exact widget/input validation remains mandatory
      // in prepareAttachmentSurface/attachFiles before physical dispatch.
      if (preparedUpload===owner && (owner.dialog!==dialog || ownedDialogInput(dialog)!==owner.input)) return null;
      return Object.freeze({root,locationHref:owner.context.locationHref});
    }
    function ownedUploadContext() {
      const owner = preparedUpload;
      if (!uploadOwnerCurrent(owner)) return null;
      const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter(n => panelVisible(n,n));
      return dialogs.length === 1 && dialogs[0] === owner.dialog &&
        ownedDialogInput(owner.dialog) === owner.input ? owner.context : null;
    }
    function emptyUploadContext(context) {
      return Boolean(currentContext(context) && !readComposerText(context.composer).trim() &&
        !context.root.querySelector(CARD) && ["ready","send_disabled"].includes(classify(context).kind));
    }
    function attachMenuButton(context) {
      const buttons = controls(context).filter(n => n.matches('button[data-testid="chat-input-attach"]'));
      const button = buttons.length === 1 ? buttons[0] : null;
      return button && button.id && !button.disabled && !button.matches(":disabled") &&
        button.getAttribute("aria-disabled") !== "true" ? button : null;
    }
    function ownedDialogInput(dialog) {
      if (!dialog?.matches(UPLOAD_DIALOG) || !panelVisible(dialog, dialog) ||
          dialog.querySelector('[role="dialog"],[contenteditable="true"],textarea')) return null;
      const groups = [...dialog.querySelectorAll('[role="group"][data-cds="FileUpload"]')];
      if (groups.length !== 1 || !panelVisible(groups[0], dialog)) return null;
      const group = groups[0], inputs = [...group.querySelectorAll('input[type="file"]')];
      const buttons = [...group.querySelectorAll('button[type="button"][data-cds="Button"]')]
        .filter(n => panelVisible(n, dialog));
      if (inputs.length !== 1 || buttons.length !== 1 ||
          !["Выбрать файлы","Choose files"].includes(buttons[0].textContent.trim())) return null;
      const input = inputs[0], choose = buttons[0];
      // The native chooser input is intentionally visually hidden. Only its
      // exact observed owner-bound widget is allowed, not arbitrary hidden inputs.
      if (!(input instanceof HTMLInputElement) || input.parentElement !== group ||
          !input.isConnected || !input.multiple || input.disabled || input.matches(":disabled") ||
          input.files?.length || input.getAttribute("aria-disabled") === "true" ||
          input.getAttribute("aria-hidden") !== "true" ||
          input.parentElement.closest('[hidden],[aria-hidden="true"],[inert]') ||
          ![null,""].includes(input.getAttribute("accept")) ||
          choose.disabled || choose.matches(":disabled") || choose.getAttribute("aria-disabled") === "true") return null;
      return input;
    }
    function preparedUploadSurface(context) {
      const bound = preparedUpload;
      if (!bound || !uploadOwnerCurrent(bound) ||
          context.root !== bound.context.root || context.composer !== bound.context.composer) return null;
      const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter(n => panelVisible(n, n));
      if (dialogs.length !== 1 || dialogs[0] !== bound.dialog || ownedDialogInput(bound.dialog) !== bound.input) return null;
      return {kind:"file_input_v1",input:bound.input,root:context.root,inputRoot:bound.dialog,
        composer:context.composer,locationHref:context.locationHref};
    }
    async function prepareAttachmentSurface(context, options = {}) {
      const {deliveryId, isCurrent} = options;
      if (typeof deliveryId !== "string" || !deliveryId || typeof isCurrent !== "function") return null;
      if (uploadPreparation?.deliveryId === deliveryId) {
        await uploadPreparation.promise;
        return isCurrent() ? attachmentSurface() : null;
      }
      if (uploadPreparation?.pending || !isCurrent() || !emptyUploadContext(context)) return null;
      // A modal opened for one delivery never authorizes a different delivery,
      // even if it still looks usable and the old owner's callback remains true.
      if (preparedUpload && preparedUpload.deliveryId !== deliveryId &&
          panelVisible(preparedUpload.dialog, preparedUpload.dialog)) return null;
      const existing = attachmentSurface();
      if (existing) return existing;
      const button = attachMenuButton(context);
      // Never attribute an already open menu/dialog to a new delivery intent.
      if (!button || [...document.querySelectorAll('[role="dialog"],'+UPLOAD_MENU)]
          .some(n => panelVisible(n, n.matches('[role="dialog"]') ? n : null))) return null;
      const attempt = {deliveryId,pending:true,promise:null,context,button,isCurrent,
        editorParent:context.composer.parentElement,rootParent:context.root.parentElement,
        actions:button.closest('[data-cds="ChatComposerActions"]'),modalRequested:false,
        conversation:conversationWitness(conversationRoot()),observedDialog:null,retired:false};
      uploadPreparation = attempt; preparedUpload = null;
      const valid = () => attempt.modalRequested ? uploadOwnerCurrent(attempt) :
        isCurrent() && emptyUploadContext(context) && attachMenuButton(context) === button;
      attempt.promise = (async () => {
        if (!valid()) return null;
        button.click(); // Native menu; no file data, file chooser or Send.
        const deadline = Date.now()+1500;
        let menu = null, uploadItem = null;
        do {
          if (!valid()) return null;
          const menus = [...document.querySelectorAll(UPLOAD_MENU)].filter(n => panelVisible(n));
          if (menus.length > 1) return null;
          if (menus.length === 1) {
            menu = menus[0];
            if (menu.getAttribute("aria-labelledby") !== button.id) return null;
            const items = [...menu.querySelectorAll('[role="menuitem"][data-testid="add-menu-upload-file"]')]
              .filter(n => panelVisible(n));
            if (items.length > 1) return null;
            if (items.length === 1) {
              const item = items[0];
              if (item.getAttribute("aria-disabled") === "true" || item.hasAttribute("data-disabled")) return null;
              uploadItem = item;
              break;
            }
          }
          // The menu shell mounts before its upload item. Observe the same
          // owned menu without clicking the trigger again or guessing a target.
          await new Promise(resolve => setTimeout(resolve,50));
        } while (Date.now()<deadline);
        if (!menu || !uploadItem || !valid() || !panelVisible(menu) ||
            menu.getAttribute("aria-labelledby") !== button.id || !menu.contains(uploadItem) ||
            !panelVisible(uploadItem)) return null;
        attempt.modalRequested = true;
        uploadItem.click(); // Native panel only; never Choose files or Send.
        const panelDeadline = Date.now()+1500;
        do {
          if (!valid()) return null;
          const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter(n => panelVisible(n,n));
          if (dialogs.length > 1) return null;
          if (dialogs.length === 1) {
            const dialog = dialogs[0], input = ownedDialogInput(dialog);
            if (!dialog.matches(UPLOAD_DIALOG)) return null;
            // The panel and its file widget can mount on different frames.
            // Accept nothing until every ownership and exclusion check holds.
            if (input) {
              preparedUpload = {...attempt,dialog,input};
              return attachmentSurface();
            }
          }
          await new Promise(resolve => setTimeout(resolve,50));
        } while (Date.now()<panelDeadline);
        return null;
      })();
      try { return await attempt.promise; }
      finally {
        attempt.pending=false;
        if (preparedUpload?.deliveryId!==attempt.deliveryId) attempt.retired=true;
      }
    }
    function attachmentSurface() {
      const c = composerContext() || ownedUploadContext();
      if (!c) return null;
      const prepared = preparedUploadSurface(c);
      if (prepared) return prepared;
      if (!["ready","send_disabled"].includes(classify(c).kind) ||
          readComposerText(c.composer).trim() || cards(c.root).length) return null;
      // Do not fall back to an old input behind another native dialog. The
      // only dialog path is the exact modal bound by prepareAttachmentSurface.
      if ([...document.querySelectorAll('[role="dialog"]')].some(n => panelVisible(n,n))) return null;
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
      conversationRoot, attachmentConversationObservation, userMessages, assistantMessages, messageId, messageText, messageObservationEpoch,
      findCodeBlocks:reader.findCodeBlocks, readCodeText:reader.readCodeText, geometryAnchor:reader.geometryAnchor,
      messageComplete(node) {
        return assistantMessages().includes(node) && Boolean(messageId(node)) &&
          node.getAttribute("data-is-streaming")==="false" &&
          ["ready","send_active","send_disabled"].includes(classify(composerContext()).kind) &&
          Boolean(messageText(node).trim());
      },
      deliveryCapabilities() { return globalThis.OzonAIDeliveryCapabilities?.profile?.("claude") || null; },
      attachmentSurface, prepareAttachmentSurface, attachmentPreview,
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
