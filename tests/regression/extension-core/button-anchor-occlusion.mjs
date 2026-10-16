import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
let source = fs.readFileSync(fileURLToPath(new URL("../../../apps/extension/src/imported/ozon-v0.1.22/content_script.js", import.meta.url)), "utf8");
const patches = JSON.parse(fs.readFileSync(fileURLToPath(new URL("../../../apps/extension/application-patches.json", import.meta.url)), "utf8"));
for (const patch of patches.filter(row => row.target === "content_script.js")) {
  assert.equal(source.split(patch.old).length - 1, 1, "exact reviewed composition patch anchor");
  let replacement = patch.new;
  if (patch.new_source !== undefined) {
    assert.equal(patch.new_source, "apps/extension/src/content/position-own-button.js");
    replacement = fs.readFileSync(
      fileURLToPath(new URL("../../../" + patch.new_source, import.meta.url)), "utf8"
    ) + "\n";
    assert.equal(createHash("sha256").update(replacement).digest("hex"), patch.new_sha256);
  }
  source = source.replace(patch.old, replacement);
}
const start = source.indexOf("  function positionOwnButton(record) {");
const end = source.indexOf("  function scheduleOwnButtonPositioning()", start);
assert.ok(start >= 0 && end > start);
class Element {
  constructor(rect, parent = null) { this.rect = rect; this.parent = parent; this.isConnected = true; this.style = {}; }
  getBoundingClientRect() { const r=this.rect;return {...r, right:r.left+r.width, bottom:r.top+r.height}; }
  contains(other) { for(let e=other;e;e=e.parent)if(e===this)return true;return false; }
}
let passed=0;
function run(name, { covered=false, ownOverlay=false, child=false, reveal=false, nativeControl=null, nativeControls=[], rect, expected="none", above=false, rootAnchor=false }={}) {
  const anchor=new Element(rect||{left:997.609375,top:684,width:125.390625,height:36});
  const root=rootAnchor?anchor:new Element({left:386,top:680,width:788,height:240}); if(!rootAnchor)anchor.parent=root;
  const button=new Element({left:1133,top:688,width:87.625,height:32});
  const host=new Element({left:0,top:0,width:0,height:0});
  const banner=new Element({left:386,top:670,width:788,height:80});
  let top=covered?banner:(child?new Element({left:1000,top:690,width:10,height:10},anchor):anchor);
  const controls=[...(nativeControl?[nativeControl]:[]),...nativeControls].map(bounds=>new Element(bounds));
  const context={Element,window:{innerWidth:1280,innerHeight:900},document:{elementsFromPoint:()=>ownOverlay?[host,top]:[top],querySelectorAll:()=>controls},visible:e=>e.isConnected&&e.rect.width>0&&e.rect.height>0,ownButtonHost:host,OzonAIAdapters:{ADAPTERS:{alice:{geometryAnchor:()=>anchor}}},currentAIAdapter:()=>null};
  vm.createContext(context);vm.runInContext(source.slice(start,end)+"\nglobalThis.place=positionOwnButton;",context);
  assert.equal(context.place({button,binding:{root,adapter_id:"alice"}}),true);
  assert.equal(button.style.display,expected,name);
  if(expected==="block") {
    const left=parseFloat(button.style.left), top=parseFloat(button.style.top), width=button.rect.width, height=button.rect.height;
    assert.ok(left>=8 && top>=8 && left+width<=1272 && top+height<=892,name+" stays in viewport");
    for(const control of controls) {
      const bounds=control.getBoundingClientRect();
      assert.ok(!(left<bounds.right && left+width>bounds.left && top<bounds.bottom && top+height>bounds.top),name+" preserves native controls");
    }
    if(above) assert.ok(top+height<=anchor.rect.top,name+" uses free space above the short code block");
  }
  if(reveal){top=anchor;context.place({button,binding:{root,adapter_id:"alice"}});assert.equal(button.style.display,"block",name+" restores after normal overlay removal");}
  passed++;console.log("PASS",name);
}
run("Alice native login banner covering copy anchor hides action", {covered:true});
run("Covered anchor remains hidden behind own shadow host", {covered:true,ownOverlay:true});
run("Banner removal restores the same action without a new Start", {covered:true,reveal:true});
run("Clear anchor must not place action over Alice Close", {nativeControl:{left:1113,top:689,width:44,height:44}});
run("Narrow native control crossing the action edge is protected", {nativeControl:{left:1219,top:690,width:2,height:10}});
run("Adjacent native control without overlap permits action", {nativeControl:{left:1221,top:688,width:44,height:44},expected:"block"});
run("Native anchor is clear", {expected:"block"});
run("Narrow native Copy near the top-right retains its below-control fallback", {
  rect:{left:1190,top:10,width:82,height:30},nativeControl:{left:1190,top:10,width:82,height:30},expected:"block"
});
run("Native SVG child counts as visible anchor", {child:true,expected:"block"});
run("Own shadow host alone does not hide its anchor", {ownOverlay:true,expected:"block"});
run("Anchor below viewport", {rect:{left:990,top:950,width:125,height:36}});
run("Anchor above viewport", {rect:{left:990,top:-80,width:125,height:36}});
run("Anchor right of viewport", {rect:{left:1400,top:300,width:125,height:36}});
run("Zero-area anchor does not float a button", {rect:{left:990,top:684,width:0,height:0}});
run("One-line ChatGPT command keeps an action clear of Copy and Share", {
  rootAnchor:true,rect:{left:324,top:410,width:892,height:22},
  nativeControls:[{left:328,top:456,width:24,height:24},{left:364,top:456,width:24,height:24}],expected:"block",above:true
});
run("Multiline ChatGPT command remains readable below its action", {
  rootAnchor:true,rect:{left:324,top:410,width:892,height:120},nativeControl:{left:328,top:554,width:24,height:24},expected:"block",above:true
});
run("One-line command stays hidden when both available positions are blocked", {
  rootAnchor:true,rect:{left:324,top:410,width:892,height:22},
  nativeControls:[{left:328,top:456,width:90,height:32},{left:1118,top:365,width:100,height:45}]
});
run("Short code block near viewport top cannot use an offscreen fallback", {
  rootAnchor:true,rect:{left:324,top:10,width:892,height:22},nativeControl:{left:328,top:56,width:90,height:32}
});
run("Multiline code remains readable when its above-block action is covered", {
  rootAnchor:true,rect:{left:324,top:410,width:892,height:270},nativeControl:{left:1118,top:365,width:100,height:45}
});
run("Multiline code at viewport top does not get an in-code fallback", {
  rootAnchor:true,rect:{left:324,top:10,width:892,height:270}
});
run("Covered one-line command does not gain a floating fallback", {
  rootAnchor:true,rect:{left:324,top:410,width:892,height:22},covered:true
});
// A provider portal outside main must restore actions without a user scroll.
// Geometry itself is exercised above; this checks the real observer/event wiring.
const observerStart=source.indexOf("  function startManualObserver() {");
const observerEnd=source.indexOf("  function applyManualMode(",observerStart);
assert.ok(observerStart>=0&&observerEnd>observerStart);
for(const trigger of ["childList","attributes","transitionend","animationend","messageChildList","mainAdded"]){
  const html=new Element({}),main=new Element({},html),portal=new Element({},html),events=new Map();
  let callback,observed,options,placements=0,rescans=0,covered=true,shown=false;
  const place=()=>{placements++;shown=!covered;};
  const context={
    current:()=>true,manualEnabled:true,observer:null,manualConversationKey:"current",
    conversationKeyFromLocation:()=>"current",syncAllState:()=>assert.fail("unchanged conversation"),
    decorateExistingBindings:place,scheduleManualRescan:()=>{rescans++;place();},scheduleOwnButtonPositioning:place,
    document:{documentElement:html,body:html,querySelector:()=>main},
    window:{addEventListener:(name,fn,capture)=>events.set(name,{fn,capture})},
    MutationObserver:class{
      constructor(fn){callback=fn;}
      observe(target,opts){observed=target;options=opts;}
    }
  };
  vm.createContext(context);
  vm.runInContext(source.slice(observerStart,observerEnd)+"\nstartManualObserver();",context);
  assert.equal(shown,false,"covered action stays hidden");
  assert.equal(placements,1);
  covered=false;
  if(trigger==="childList"){
    // The removed login portal is a sibling of main.
    if(observed===html&&options.childList&&options.subtree)callback([{type:trigger,target:portal,addedNodes:[]}]);
  }else if(trigger==="attributes"){
    // Some providers retain the portal and change only its visibility class.
    if(observed===html&&options.attributes&&options.attributeFilter.includes("class"))
      callback([{type:trigger,attributeName:"class",target:portal}]);
  }else if(trigger==="messageChildList"){
    callback([{type:"childList",target:main,addedNodes:[]}]);
  }else if(trigger==="mainAdded"){
    callback([{type:"childList",target:html,addedNodes:[main]}]);
  }else{
    assert.equal(events.get(trigger)?.capture,true,"capture CSS completion outside main");
    events.get(trigger)?.fn();
  }
  assert.equal(shown,true,trigger+" restores action without scroll or a new Start");
  assert.equal(placements,2,trigger+" schedules one placement for this event");
  assert.equal(rescans,["messageChildList","mainAdded"].includes(trigger)?1:0,
    "only message structure changes rescan the chat");
  passed++;console.log("PASS provider portal "+trigger+" restores the existing action");
}
console.log(JSON.stringify({status:"PASS",cases:passed,scope:"SOURCE geometry and portal events; no live/browser acceptance"}));
