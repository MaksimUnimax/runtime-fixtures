/* Local projection of a verified local_client_authority_v1 bootstrap bundle. */
(() => {
  "use strict";

  async function materialize(payload, environment) {
    const local = payload?.localClientAuthority;
    const browserFamily = environment?.browserFamily;
    const browserVersion = environment?.browserVersion;
    const extensionVersion = environment?.extensionVersion;
    const contractVersion = payload?.contractVersion;
    if (!local || local.schemaVersion !== "local_client_authority_v1" || local.contractVersion !== "control_plane_v2" || contractVersion !== "control_plane_v2" || !browserFamily || !browserVersion || !extensionVersion) return null;
    const release = local.compatibility.releases.find(row => row.extensionVersion === extensionVersion && row.contractVersions.includes(contractVersion));
    const applicable = local.compatibility.policies.filter(row => row.contractVersion === contractVersion && (row.browserFamily === null || row.browserFamily === browserFamily));
    const globals = applicable.filter(row => row.browserFamily === null), exact = applicable.filter(row => row.browserFamily === browserFamily);
    if (globals.length > 1 || exact.length > 1 || globals.some(row => row.minimumBrowserVersion !== null)) return null;
    const policies = [...globals, ...exact];
    if (policies.some(row => row.maintenanceMode !== (row.maintenanceCode !== null))) return null;
    const max = values => values.filter(Boolean).reduce((picked, value) => !picked || environment.compareSemver(value, picked) > 0 ? value : picked, null);
    const minimum = max(policies.map(row => row.minimumExtensionVersion));
    const recommended = max(policies.map(row => row.recommendedExtensionVersion));
    if (minimum && recommended && environment.compareSemver(recommended, minimum) < 0) return null;
    const blocked = policies.some(row => row.blockedVersions.includes(extensionVersion));
    let extensionStatus = "SUPPORTED";
    if (!release || blocked || minimum && !environment.versionAtLeast(extensionVersion, minimum)) extensionStatus = "UPDATE_REQUIRED";
    else if (recommended && !environment.versionAtLeast(extensionVersion, recommended)) extensionStatus = "UPDATE_RECOMMENDED";
    let browserStatus = "SUPPORTED";
    const exactPolicy = exact[0];
    if (policies.some(row => row.maintenanceMode)) browserStatus = "MAINTENANCE";
    else if (!release || !release.browserFamilies.includes(browserFamily)) browserStatus = "UNSUPPORTED_BROWSER";
    else if (exactPolicy?.minimumBrowserVersion && (environment.compareBrowser(browserVersion, exactPolicy.minimumBrowserVersion) ?? -1) < 0) browserStatus = "UNSUPPORTED_BROWSER";
    const features = {};
    for (const rule of local.featureRules) {
      features[rule.featureKey] = rule.enabled && (rule.browserFamily === null || rule.browserFamily === browserFamily) && (rule.minimumExtensionVersion === null || environment.versionAtLeast(extensionVersion, rule.minimumExtensionVersion));
    }
    let ai;
    if (local.ai.status === "UNCONFIGURED") ai = { status: "UNCONFIGURED" };
    else {
      const detected = local.ai.detected;
      const candidate = local.ai.candidates.find(row => row.browserFamily === browserFamily);
      const profile = candidate?.resolution?.status === "RESOLVED" ? candidate.resolution.profile : null;
      if (!profile || environment.requestedAi && detected.family !== environment.requestedAi || !environment.localAi[detected.family] || detected.surface !== environment.localAi[detected.family].surface || detected.variant !== null || !environment.profileValid(profile, browserFamily, browserVersion, extensionVersion)) {
        ai = { status: "UNAVAILABLE", detected, reason: candidate?.resolution?.status === "UNAVAILABLE" ? candidate.resolution.reason : profile ? "PROFILE_INCOMPATIBLE" : "NO_PROFILE" };
      } else if (await environment.profileFingerprint(profile) !== profile.contentSha256) {
        ai = { status: "UNAVAILABLE", detected, reason: "PROFILE_INCOMPATIBLE" };
      } else ai = { status: "RESOLVED", detected, profile };
    }
    return { ...payload, compatibility: { extension: { status: extensionStatus, minimumVersion: minimum }, browser: { status: browserStatus } }, features, ai };
  }

  globalThis.SellerAgentsLocalClientAuthority = Object.freeze({ materialize });
})();
