(() => {
  "use strict";
  function create(getCapabilities) {
    if (typeof getCapabilities !== "function")
      throw new TypeError("Delivery capability getter is required");
    function directInlineFileRefFromReportText(entry) {
      const text = String(entry?.report_text || "");
      const newline = text.indexOf("\n");
      if (newline <= 0 || text.slice(0, newline).trim() !== "OZON_RESULT_V1")
        return null;
      let envelope;
      try {
        envelope = JSON.parse(text.slice(newline + 1));
      } catch (_) {
        return null;
      }
      const operation = String(
        entry?.command?.operation || entry?.operation || "",
      );
      if (!operation || String(envelope?.operation || "") !== operation)
        return null;
      const httpStatus = Number(envelope?.http_status || 0);
      if (!(httpStatus >= 200 && httpStatus < 300)) return null;
      const result =
        envelope?.result &&
        typeof envelope.result === "object" &&
        !Array.isArray(envelope.result)
          ? envelope.result
          : null;
      if (result?.generated_file_inline !== true) return null;
      const ref = String(result.generated_file_ref || "").trim();
      return /^rpf_[sp]_[A-Za-z0-9_-]+$/.test(ref) ? ref : null;
    }

    function successfulProviderFileRef(entry, marketplace) {
      if (!entry || entry.status !== "complete") return null;
      const status = Number(entry.http_status || 0);
      if (!(status >= 200 && status < 300)) return null;
      if (marketplace === "wildberries")
        return /^sa_file_[a-f0-9]{64}$/.test(entry.provider_file_ref || "")
          ? entry.provider_file_ref : null;
      const operation = String(entry?.command?.operation || entry?.operation || "");
      const ref = operation === "report_file_get"
        ? String(entry?.command?.params?.file_ref || "").trim()
        : directInlineFileRefFromReportText(entry);
      return /^rpf_[sp]_[A-Za-z0-9_-]+$/.test(ref || "") ? ref : null;
    }

    function reportFileRefsFromBatch(run) {
      const refs = [];
      const seen = new Set();
      for (const entry of Array.isArray(run?.batch?.entries)
        ? run.batch.entries
        : []) {
        const ref = successfulProviderFileRef(entry, run?.execution_context?.marketplace);
        if (!ref || seen.has(ref)) continue;
        seen.add(ref);
        refs.push(ref);
      }
      return refs;
    }
    function buildAttachmentMarker({
      deliveryId,
      generatedDocument,
      providerFileRefs,
    }) {
      const payload = {
        delivery_representation: generatedDocument
          ? "ATTACHED_COMPLETE_TEXT_DOCUMENT"
          : "ATTACHED_ORIGINAL_PROVIDER_FILE",
        delivery_id: String(deliveryId || ""),
        complete: true,
        generated_text_document: generatedDocument
          ? {
              filename: generatedDocument.filename,
              unicode_char_length: generatedDocument.unicode_char_length,
              byte_length: generatedDocument.byte_length,
            }
          : null,
        original_provider_file_count: providerFileRefs.length,
      };
      return `OZON_BATCH_RESULT_V1\n${JSON.stringify(payload)}`;
    }
    function derivedFileRefs(run, payload) {
      const refs=payload.derived_file_refs;
      if(refs===undefined)return [];
      if(!Array.isArray(refs) || refs.length>1)throw new Error("DERIVED_FILE_REFS_INVALID");
      return refs.map(ref=>{
        if(run?.execution_context?.marketplace!=="wildberries" || !ref || ref.source_kind!=="derived_business_report" ||
           !/^derived:cap19:[a-f0-9]{64}$/.test(ref.artifact_key||"") ||
           ref.serialization!=="json" || ref.serialization_version!==1 || ref.identity_version!==1 ||
           ref.extension!=="txt" || ref.mime_type!=="text/plain;charset=utf-8" || ref.complete!==true ||
           ref.owner_operation_id!==run.operation_id || ref.scope_sha256!==run.cap19_collection?.scope_sha256 ||
           ref.artifact_key!==run.cap19_artifact_intent?.artifact_key || ref.sha256!==run.cap19_artifact_intent?.sha256 ||
           !Number.isSafeInteger(ref.byte_length) || ref.byte_length<1 || ref.byte_length>8000000 ||
           !Number.isSafeInteger(ref.expires_at_ms) || ref.expires_at_ms<=Date.now())
          throw new Error("DERIVED_FILE_DESCRIPTOR_INVALID");
        return Object.freeze({...ref});
      });
    }
    function attachmentDeliveryPlan(run, payload) {
      const requestedMode = String(payload.mode || "legacy");
      if (requestedMode !== "batch_watch_v1") return null;
      const outgoingText = String(payload.outgoingText || "");
      const capabilities = getCapabilities();
      const adapterId = capabilities?.adapterIdForOrigin?.(run?.origin) || null;
      const textDecision = capabilities?.generatedTextDecision?.(
        adapterId,
        outgoingText,
      ) || {
        representation: "plain_text",
        unicode_chars: String(outgoingText).length,
        threshold: null,
      };
      const providerFileRefs = reportFileRefsFromBatch(run);
      const derivedRefs = derivedFileRefs(run, payload);
      const needsGeneratedDocument =
        textDecision.representation === "text_document";
      if (!needsGeneratedDocument && providerFileRefs.length === 0 && derivedRefs.length === 0) return null;
      const deliveryId = String(payload.deliveryId || "");
      const generatedDocument = needsGeneratedDocument
        ? {
            artifact_id: `generated-${deliveryId}`,
            filename: `${run?.execution_context?.marketplace === "wildberries" ? "wb" : "ozon"}-bridge-result-${deliveryId}.txt`,
            mime_type: "text/plain;charset=utf-8",
            extension: "txt",
            unicode_char_length: Number(textDecision.unicode_chars || 0),
            byte_length:
              capabilities?.utf8ByteLength?.(outgoingText) ??
              new TextEncoder().encode(outgoingText).byteLength,
            complete: true,
          }
        : null;
      const markerText = needsGeneratedDocument
        ? buildAttachmentMarker({
            deliveryId,
            generatedDocument,
            providerFileRefs,
          })
        : derivedRefs.length ? "WB_BATCH_RESULT_V1\n"+JSON.stringify({delivery_representation:"ATTACHED_DOCUMENT_BUNDLE",derived_business_report_count:derivedRefs.length,delivery_id:deliveryId,complete:true}) : outgoingText;
      return Object.freeze({
        adapter_id: adapterId,
        original_outgoing_text: outgoingText,
        outgoing_text: markerText,
        generated_text_document: generatedDocument,
        provider_file_refs: providerFileRefs,
        derived_file_refs: Object.freeze(derivedRefs),
        text_decision: textDecision,
      });
    }
    return Object.freeze({
      directInlineFileRefFromReportText,
      successfulProviderFileRef,
      reportFileRefsFromBatch,
      attachmentDeliveryPlan,
    });
  }
  globalThis.SellerAgentsOzonDeliveryPlan = Object.freeze({ create });
})();
