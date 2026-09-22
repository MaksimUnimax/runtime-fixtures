/* global Blob, URL, console, document, fetch, location, window */
(() => {
  const ORIGIN = "https://dev.wildberries.ru";
  const BUNDLE_VERSION = "wb_openapi_bundle_v1";
  const DOCUMENTS = [
    ["WB_01_GENERAL", "01-general.yaml"],
    ["WB_02_ITEMS", "02-items.yaml"],
    ["WB_03_ORDERS_FBS", "03-orders-fbs.yaml"],
    ["WB_04_ORDERS_DBW", "04-orders-dbw.yaml"],
    ["WB_05_DBS", "05-dbs.yaml"],
    ["WB_06_IN_STORE_PICKUP", "06-in-store-pickup.yaml"],
    ["WB_07_ORDERS_FBW", "07-orders-fbw.yaml"],
    ["WB_08_PROMOTION", "08-promotion.yaml"],
    ["WB_09_COMMUNICATIONS", "09-communications.yaml"],
    ["WB_10_RATES", "10-rates.yaml"],
    ["WB_11_ANALYTICS", "11-analytics.yaml"],
    ["WB_12_REPORTS", "12-reports.yaml"],
    ["WB_13_FINANCES", "13-finances.yaml"],
  ];

  const failure = (documentKey, status, code) => ({
    documentKey,
    status,
    code,
  });
  const looksLikeOpenApiYaml = (text) =>
    /(?:^|\n)\s*(?:openapi|swagger)\s*:\s*[^\n]+/i.test(text) &&
    /(?:^|\n)\s*paths\s*:/i.test(text);

  window.__octoportRunWbBundle = async () => {
    if (location.origin !== ORIGIN) {
      console.error("WB_BUNDLE_ORIGIN_INVALID");
      return {
        ok: false,
        failure: failure(null, null, "WB_BUNDLE_ORIGIN_INVALID"),
      };
    }
    const documents = [];
    for (const [documentKey, filename] of DOCUMENTS) {
      const officialUrl = `${ORIGIN}/api/swagger/yaml/ru/${filename}?region=ru`;
      try {
        const response = await fetch(officialUrl, {
          method: "GET",
          credentials: "same-origin",
        });
        const content = await response.text();
        if (response.status !== 200)
          return {
            ok: false,
            failure: failure(
              documentKey,
              response.status,
              "HTTP_STATUS_NOT_200",
            ),
          };
        if (!content.trim())
          return {
            ok: false,
            failure: failure(documentKey, response.status, "EMPTY_BODY"),
          };
        if (!looksLikeOpenApiYaml(content))
          return {
            ok: false,
            failure: failure(
              documentKey,
              response.status,
              "OPENAPI_YAML_NOT_RECOGNIZED",
            ),
          };
        documents.push({
          documentKey,
          filename,
          officialUrl,
          httpStatus: 200,
          content,
        });
      } catch {
        return {
          ok: false,
          failure: failure(documentKey, null, "FETCH_FAILED"),
        };
      }
    }
    documents.sort((a, b) => a.documentKey.localeCompare(b.documentKey));
    const bundle = {
      bundleVersion: BUNDLE_VERSION,
      sourceFamily: "WILDBERRIES",
      capturedAt: new Date().toISOString(),
      origin: ORIGIN,
      documents,
    };
    const blobUrl = URL.createObjectURL(
      new Blob([JSON.stringify(bundle)], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = blobUrl;
    anchor.download = `wildberries-openapi-bundle-${bundle.capturedAt.replace(/[:.]/g, "-")}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(blobUrl);
    return { ok: true, documentCount: documents.length };
  };
  void window.__octoportRunWbBundle();
})();
