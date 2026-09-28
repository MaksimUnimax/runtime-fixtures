"""Installed Firefox signed-profile lifecycle helper; test-only."""
from __future__ import annotations

import json
import os
import time
from pathlib import Path

from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys

CONV2 = "55555555-5555-4555-8555-555555555555"
PROVIDER_HOSTS = {
    "api-seller.ozon.ru", "api-performance.ozon.ru",
    "content-api.wildberries.ru", "statistics-api.wildberries.ru",
    "marketplace-api.wildberries.ru", "common-api.wildberries.ru",
}

def wait_for(fn, label: str, timeout: float = 20):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = fn()
        if value:
            return value
        time.sleep(0.1)
    raise RuntimeError("PROFILE_LIFECYCLE_TIMEOUT_" + label.upper().replace(" ", "_"))

def write_control(path: Path, revision: int, mode: str):
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps({"revision": revision, "composerMode": mode}) + "\n")
    os.replace(temp, path)
def expected(driver):
    return driver.execute_async_script(
        """const done=arguments[arguments.length-1];
        browser.runtime.getBackgroundPage().then(async bg=>{
          const s=await bg.saSignedProfileSnapshot(),p=s?.authority?.payload?.ai?.profile;
          if(!p) throw new Error('PROFILE_NOT_READY');
          done({authority:{authGeneration:s.generation,bootstrapSnapshotSha256:s.snapshot.bootstrapSnapshotSha256},
          profile:{profileKey:p.profileKey,revision:p.revision,scopeVariant:p.scopeVariant,contentSha256:p.contentSha256}});
        }).catch(e=>done({error:String(e?.message||e)}));"""
    )

def bootstrap(driver):
    return driver.execute_async_script(
        """const done=arguments[arguments.length-1];
        browser.runtime.getBackgroundPage().then(async bg=>{
          try{
            const p=await bg.SellerAgentsControlClient.bootstrap({detectedAi:{family:'chatgpt',surface:'web',variant:null}});
            const s=await bg.SellerAgentsControlClient.status();
            done({ok:true,revision:Number(p?.ai?.profile?.revision||0),authenticated:s.authenticated===true,workAllowed:s.workAllowed===true});
          }catch(e){done({ok:false,code:String(e?.code||e?.message||e)});}
        });"""
    )

def message(driver, tab_id: int, value: dict):
    return driver.execute_async_script(
        """const tabId=arguments[0],msg=arguments[1],done=arguments[arguments.length-1];
        browser.tabs.sendMessage(tabId,msg).then(v=>done(v),e=>done({ok:false,code:String(e?.message||e)}));""",
        tab_id,
        value,
    )
def tab_id_for(driver, conversation: str):
    return driver.execute_async_script(
        """const needle=arguments[0],done=arguments[arguments.length-1];
        browser.tabs.query({url:'https://chatgpt.com/c/*'}).then(
          rows=>done(rows.find(row=>row.url?.includes(needle))?.id||null),()=>done(null));""",
        conversation,
    )

def background_status(driver):
    return driver.execute_async_script(
        """const done=arguments[arguments.length-1];
        browser.runtime.getBackgroundPage().then(bg=>bg.SellerAgentsControlClient.status())
          .then(s=>done({authenticated:s.authenticated===true,workAllowed:s.workAllowed===true}),
                ()=>done({authenticated:false,workAllowed:false}));"""
    )

def ensure(driver, tab_id: int, expected_value: dict):
    return message(driver, tab_id, {
        "type": "OZ_SIGNED_AI_PROFILE_ENSURE",
        "expected": expected_value,
    })

def picker(driver, popup_handle, chat_handle, tab_id: int):
    driver.switch_to.window(popup_handle)
    response = message(driver, tab_id, {"type": "OZ_START_SEND_BUTTON_PICKER"})
    driver.switch_to.window(chat_handle)
    composer = driver.find_element(By.ID, "prompt-textarea").text
    sent_count = driver.execute_script("return sent.length")
    if response.get("ok") is True:
        driver.find_element(By.TAG_NAME, "body").send_keys(Keys.ESCAPE)
        wait_for(lambda: driver.find_element(By.ID, "prompt-textarea").text == "", "picker restore")
    driver.switch_to.window(popup_handle)
    return {"response": response, "composer": composer, "sentCount": sent_count}
def reload_extension(driver, popup_handle, popup_url, fallback_handle):
    if popup_handle in driver.window_handles:
        driver.switch_to.window(popup_handle)
        try:
            driver.execute_script("browser.runtime.reload();")
        except Exception:
            pass
    time.sleep(1)
    handles = driver.window_handles
    if popup_handle not in handles:
        if fallback_handle not in handles:
            raise RuntimeError("EXTENSION_RELOAD_NO_SURVIVING_TAB")
        driver.switch_to.window(fallback_handle)
        driver.switch_to.new_window("tab")
        popup_handle = driver.current_window_handle
    else:
        driver.switch_to.window(popup_handle)
    driver.get(popup_url)
    wait_for(lambda: driver.find_elements(By.ID, "auth-start"), "extension reload")
    return popup_handle, background_status(driver)

def run(driver, popup_handle, chat_handle, chat_tab_id, popup_url: str, control: Path, state):
    result = {
        "status": "RUNNING",
        "acceptanceClass": "INSTALLED_SYNTHETIC_FIREFOX_SIGNED_PROFILE_LIFECYCLE",
        "installedAcceptance": False,
        "liveProviderCalls": 0,
    }
    driver.switch_to.window(popup_handle)
    initial = bootstrap(driver)
    if not initial.get("ok") or initial.get("revision") != 1 or initial.get("authenticated") is not True or initial.get("workAllowed") is not True:
        raise RuntimeError("PROFILE_REV1_BOOTSTRAP_FAILED")
    expected1 = expected(driver)
    if expected1.get("profile", {}).get("revision") != 1:
        raise RuntimeError("PROFILE_REV1_NOT_READY")
    applied1 = ensure(driver, chat_tab_id, expected1)
    if applied1.get("applied") is not True:
        raise RuntimeError("PROFILE_REV1_NOT_APPLIED")
    baseline = picker(driver, popup_handle, chat_handle, chat_tab_id)
    if baseline["response"].get("ok") is not True or baseline["sentCount"] != 0:
        raise RuntimeError("PROFILE_REV1_BEHAVIOR_FAILED")

    write_control(control, 2, "status_role")
    driver.switch_to.window(popup_handle)
    update2 = bootstrap(driver)
    if not update2.get("ok") or update2.get("revision") != 2:
        raise RuntimeError("PROFILE_REV2_BOOTSTRAP_FAILED")
    expected2 = expected(driver)
    applied2 = ensure(driver, chat_tab_id, expected2)
    if applied2.get("applied") is not True:
        raise RuntimeError("PROFILE_REV2_NOT_APPLIED")
    changed = picker(driver, popup_handle, chat_handle, chat_tab_id)
    if changed["response"].get("code") != "CONTENT_ADAPTER_ERROR":
        raise RuntimeError("PROFILE_REV2_BEHAVIOR_NOT_CHANGED")

    stale1 = ensure(driver, chat_tab_id, expected1)
    if stale1.get("code") != "PROFILE_FENCE_MISMATCH":
        raise RuntimeError("STALE_PROFILE_FENCE_NOT_REJECTED")
    if ensure(driver, chat_tab_id, expected2).get("applied") is not True:
        raise RuntimeError("PROFILE_REV2_REAPPLY_FAILED")

    page_context = message(driver, chat_tab_id, {"type": "OZ_PAGE_CONTEXT"})
    active = message(driver, chat_tab_id, {
        "type": "OZ_WORK_APPLY_VISIBILITY",
        "conversation_key": page_context["conversation_key"],
        "visible": False,
        "work_active": True,
    })
    if active.get("applied") is not True:
        raise RuntimeError("WORK_ACTIVE_FIXTURE_NOT_APPLIED")

    write_control(control, 3, "packaged")
    update3 = bootstrap(driver)
    if not update3.get("ok") or update3.get("revision") != 3:
        raise RuntimeError("PROFILE_REV3_BOOTSTRAP_FAILED")
    expected3 = expected(driver)
    deferred = ensure(driver, chat_tab_id, expected3)
    if deferred.get("code") != "DEFERRED":
        raise RuntimeError("ACTIVE_WORK_PROFILE_NOT_DEFERRED")
    still_old = picker(driver, popup_handle, chat_handle, chat_tab_id)
    if still_old["response"].get("code") != "CONTENT_ADAPTER_ERROR":
        raise RuntimeError("DEFERRED_PROFILE_HOT_SWITCHED")

    finished = message(driver, chat_tab_id, {
        "type": "OZ_WORK_APPLY_VISIBILITY",
        "conversation_key": page_context["conversation_key"],
        "visible": False,
        "work_active": False,
    })
    if finished.get("applied") is not True:
        raise RuntimeError("WORK_FINISH_FIXTURE_NOT_APPLIED")

    def rev3_applied():
        value = ensure(driver, chat_tab_id, expected3)
        return value if value.get("applied") is True else None
    wait_for(rev3_applied, "rev3 after finish")
    after_finish = picker(driver, popup_handle, chat_handle, chat_tab_id)
    if after_finish["response"].get("ok") is not True or after_finish["sentCount"] != 0:
        raise RuntimeError("PROFILE_REV3_AFTER_FINISH_FAILED")

    write_control(control, 1, "packaged")
    rollback = bootstrap(driver)
    if not rollback.get("ok") or rollback.get("revision") != 1:
        raise RuntimeError("SIGNED_ROLLBACK_BOOTSTRAP_FAILED")
    expected1b = expected(driver)
    if ensure(driver, chat_tab_id, expected1b).get("applied") is not True:
        raise RuntimeError("SIGNED_ROLLBACK_NOT_APPLIED")

    driver.switch_to.window(chat_handle)
    driver.get(f"https://chatgpt.com/c/{CONV2}")
    wait_for(lambda: driver.execute_script("return typeof fixtureCurrentChatGPTBlock==='function'"), "navigation fixture")
    driver.switch_to.window(popup_handle)
    tab2 = tab_id_for(driver, CONV2)
    if not isinstance(tab2, int):
        raise RuntimeError("NAVIGATION_TAB_UNAVAILABLE")
    stale3 = ensure(driver, tab2, expected3)
    if stale3.get("code") != "PROFILE_FENCE_MISMATCH":
        raise RuntimeError("NAVIGATION_STALE_PROFILE_NOT_REJECTED")
    if ensure(driver, tab2, expected1b).get("applied") is not True:
        raise RuntimeError("NAVIGATION_CURRENT_PROFILE_NOT_APPLIED")

    popup_handle, restored = reload_extension(driver, popup_handle, popup_url, chat_handle)
    if restored.get("authenticated") is not True or restored.get("workAllowed") is not True:
        raise RuntimeError("WORKER_RESTART_AUTH_NOT_RESTORED")
    driver.switch_to.window(chat_handle)
    driver.refresh()
    wait_for(lambda: driver.execute_script("return typeof fixtureCurrentChatGPTBlock==='function'"), "restart content")
    driver.switch_to.window(popup_handle)
    tab2 = tab_id_for(driver, CONV2)
    expected_restart = expected(driver)
    if expected_restart.get("profile", {}).get("revision") != 1:
        raise RuntimeError("WORKER_RESTART_PROFILE_DRIFT")
    if ensure(driver, tab2, expected_restart).get("applied") is not True:
        raise RuntimeError("WORKER_RESTART_PROFILE_NOT_APPLIED")

    reset = driver.execute_async_script(
        """const done=arguments[arguments.length-1];
        browser.runtime.getBackgroundPage().then(bg=>bg.SellerAgentsControlClient.localReset())
          .then(()=>done({ok:true}),e=>done({ok:false,code:String(e?.code||e?.message||e)}));"""
    )
    if reset.get("ok") is not True:
        raise RuntimeError("LOCAL_RESET_FAILED")
    wait_for(lambda: background_status(driver).get("authenticated") is False, "revocation")
    revoked = ensure(driver, tab2, expected_restart)
    if revoked.get("applied") is True:
        raise RuntimeError("REVOKED_PROFILE_STILL_APPLIED")

    popup_handle, signed_out = reload_extension(driver, popup_handle, popup_url, chat_handle)
    if signed_out.get("authenticated") is not False or signed_out.get("workAllowed") is not False:
        raise RuntimeError("REVOKED_WORKER_RESTART_RESURRECTED_AUTH")
    driver.switch_to.window(chat_handle)
    driver.refresh()
    wait_for(lambda: driver.execute_script("return typeof fixtureCurrentChatGPTBlock==='function'"), "revoked content")
    driver.switch_to.window(popup_handle)
    tab2 = tab_id_for(driver, CONV2)
    after_restart = ensure(driver, tab2, expected_restart)
    if after_restart.get("applied") is True:
        raise RuntimeError("REVOKED_PROFILE_RESURRECTED_AFTER_RESTART")

    provider_requests = sum(row.get("host") in PROVIDER_HOSTS for row in state.rows)
    if provider_requests != 0:
        raise RuntimeError("PROFILE_LIFECYCLE_PROVIDER_REQUEST")
    result.update(
        status="PASS",
        installedAcceptance=True,
        baselineProfileRevision=1,
        changedProfileRevision=2,
        activeWorkDeferredRevision=3,
        rollbackRevision=1,
        staleFenceRejected=True,
        navigationNoResurrection=True,
        workerRestartRestoredCurrent=True,
        revocationNoResurrection=True,
        providerRequestCount=0,
    )
    return result
