import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
const source = fs.readFileSync(fileURLToPath(new URL("../../../apps/extension/src/imported/ozon-v0.1.22/content_script.js", import.meta.url)), "utf8");
const start = source.indexOf("  function positionOwnButton(record) {");
const end = source.indexOf("  function scheduleOwnButtonPositioning()", start);
assert.ok(start >= 0 && end > start);
class Element {
  constructor(rect, parent = null) { this.rect = rect; this.parent = parent; this.isConnected = true; this.style = {}; }
  getBoundingClientRect() { const r=this.rect;return {...r, right:r.left+r.width, bottom:r.top+r.height}; }
  contains(other) { for(let e=other;e;e=e.parent)if(e===this)return true;return false; }
}
let passed=0;
function run(name, { covered=false, ownOverlay=false, child=false, reveal=false, nativeControl=null, rect, expected="none" }={}) {
  const anchor=new Element(rect||{left:997.609375,top:684,width:125.390625,height:36});
  const root=new Element({left:386,top:680,width:788,height:240}); anchor.parent=root;
  const button=new Element({left:1133,top:688,width:87.625,height:32});
  const host=new Element({left:0,top:0,width:0,height:0});
  const banner=new Element({left:386,top:670,width:788,height:80});
  let top=covered?banner:(child?new Element({left:1000,top:690,width:10,height:10},anchor):anchor);
  const context={Element,window:{innerWidth:1280,innerHeight:900},document:{elementsFromPoint:()=>ownOverlay?[host,top]:[top],querySelectorAll:()=>nativeControl?[new Element(nativeControl)]:[]},visible:e=>e.isConnected&&e.rect.width>0&&e.rect.height>0,ownButtonHost:host,OzonAIAdapters:{ADAPTERS:{alice:{geometryAnchor:()=>anchor}}},currentAIAdapter:()=>null};
  vm.createContext(context);vm.runInContext(source.slice(start,end)+"\nglobalThis.place=positionOwnButton;",context);
  assert.equal(context.place({button,binding:{root,adapter_id:"alice"}}),true);
  assert.equal(button.style.display,expected,name);
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
run("Native SVG child counts as visible anchor", {child:true,expected:"block"});
run("Own shadow host alone does not hide its anchor", {ownOverlay:true,expected:"block"});
run("Anchor below viewport", {rect:{left:990,top:950,width:125,height:36}});
run("Anchor above viewport", {rect:{left:990,top:-80,width:125,height:36}});
run("Anchor right of viewport", {rect:{left:1400,top:300,width:125,height:36}});
run("Zero-area anchor does not float a button", {rect:{left:990,top:684,width:0,height:0}});
console.log(JSON.stringify({status:"PASS",cases:passed,scope:"SOURCE geometry; no live/browser acceptance"}));
