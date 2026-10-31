'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const os = require('node:os');
const path = require('node:path');
const {validateScene,main} = require('./native-rebuild.cjs');
function scene() {
  return {version:1,document:'reference.ai',layer:'Rebuild_Test',canvas:{width:800,height:600},origin:[10,20],scale:2,
    outputAi:path.resolve(os.tmpdir(),'native-test-result.ai'),outputPng:path.resolve(os.tmpdir(),'native-test-result.png'),
    gradients:[{id:'green',type:'linear',stops:[{offset:0,color:'#FFFFFF'},{offset:100,color:'#008000'}]}],
    objects:[{type:'group',name:'leaf-01',children:[
      {type:'path',name:'outline',closed:true,points:[{anchor:[0,0],right:[20,0]},{anchor:[50,50],left:[40,40]}],
        fill:{gradient:'green',origin:[0,0],length:50,angle:45}},
      {type:'text',name:'label',text:'Leaf',font:'ArialMT',size:12,position:[10,20],fill:'#000000'}
    ]},{type:'compound',name:'ring',evenodd:true,fill:'#000000',paths:[
      {type:'path',name:'outer',closed:true,points:[{anchor:[100,100]},{anchor:[150,100]},{anchor:[150,150]}]},
      {type:'path',name:'inner',closed:true,points:[{anchor:[110,110]},{anchor:[130,110]},{anchor:[130,130]}]}
    ]}]};
}
function simulate(s, {operation='draw', missingFont=false, existingLayer=false, existingOutput=false}={}) {
  const files = new Set(existingOutput?[s.outputAi]:[]);
  let mutations=0;
  const ordering=[];
  function collection(factory) {const a=[];a.add=(...args)=>{const item=factory(...args);a.push(item);return item;};return a;}
  function container(kind,parent) {
    const c={typename:kind,parent,pageItems:[]};
    const addItem=(kind)=>{const n=container(kind,c);c.pageItems.push(n);return n;};
    c.groupItems=collection(()=>addItem('GroupItem'));
    c.compoundPathItems=collection(()=>addItem('CompoundPathItem'));
    c.textFrames=collection(()=>{const n=addItem('TextFrame');n.textRange={characterAttributes:{},paragraphAttributes:{}};n.rotate=(angle)=>{n.rotation=angle;};return n;});
    c.pathItems=collection(()=>{const n=addItem('PathItem');n.pathPoints=collection(()=>({}));return n;});
    c.pathItems.ellipse=c.pathItems.rectangle=(...args)=>{const n=c.pathItems.add();n.box=args;return n;};
    c.zOrder=()=>ordering.push(c.name);
    return c;
  }
  const d=container('Document',null);d.name='reference.ai';d.fullName={fsName:path.resolve(os.tmpdir(),'reference.ai')};
  d.layers=collection(()=>{mutations++;return container('Layer',d);});
  if(existingLayer)d.layers.push({name:s.layer});
  d.artboards=[{artboardRect:[100,1000,900,400]}];d.artboards.getActiveArtboardIndex=()=>0;
  d.gradients=collection(()=>{const g={};g.gradientStops=collection(()=>({}));g.gradientStops.add();g.gradientStops.add();return g;});
  d.save=()=>files.add(s.outputAi);d.saveAs=(f)=>{files.add(f.fsName);};d.exportFile=(f)=>files.add(f.fsName);
  function File(p){this.fsName=p;this.parent={exists:true};this.open=()=>true;this.close=()=>{};this.read=()=>JSON.stringify(s);}
  Object.defineProperty(File.prototype,'exists',{get(){return files.has(this.fsName);}});
  const context={NATIVE_REBUILD_CONFIG:{operation,scenePath:'prepared-scene.json'},File,
    app:{documents:[d],activeDocument:d,textFonts:{getByName(font){if(missingFont)throw new Error('Missing font');return {name:font};}},
      getRotationMatrix(angle){return {angle};},redraw(){}},
    RGBColor:function(){},CMYKColor:function(){},GradientColor:function(){},IllustratorSaveOptions:function(){},ExportOptionsPNG24:function(){},
    GradientType:{LINEAR:'linear',RADIAL:'radial'},PointType:{SMOOTH:'smooth',CORNER:'corner'},
    Justification:{LEFT:'left',RIGHT:'right',CENTER:'center'},ZOrderMethod:{BRINGTOFRONT:'front'},ExportType:{PNG24:'png'}};
  const report=JSON.parse(vm.runInNewContext(fs.readFileSync(path.join(__dirname,'native-runtime.jsx'),'utf8'),context));
  return {report,mutations,doc:d,ordering,files};
}
test('valid scene preserves separate native object types',()=>{
  assert.deepEqual(validateScene(scene()),{group:1,path:3,compound:1,ellipse:0,rect:0,text:1});
});
test('reject raster nodes, URLs, duplicate names and invalid gradients before execution',()=>{
  let s=scene();s.objects.push({type:'image',name:'raster',url:'https://example.com/image.png'});
  assert.throws(()=>validateScene(s),/Unsupported object/);
  s=scene();s.outputAi='https://example.com/file.ai';assert.throws(()=>validateScene(s),/local absolute/);
  s=scene();s.objects[1].name='leaf-01';assert.throws(()=>validateScene(s),/Duplicate/);
  s=scene();s.gradients[0].stops[1].offset=0;assert.throws(()=>validateScene(s),/increase/);
  s=scene();s.objects[0].children[0].fill.gradient='not-found';assert.throws(()=>validateScene(s),/Unknown gradient/);
});
test('reject injected commands and malformed geometry',()=>{
  let s=scene();s.script='execute something';assert.throws(()=>validateScene(s),/unsupported field/);
  s=scene();s.objects[0].children[0].points[0].anchor=[NaN,0];assert.throws(()=>validateScene(s),/invalid number/);
  s=scene();s.objects[1].paths[0].closed=false;assert.throws(()=>validateScene(s),/closed paths/);
  s=scene();s.objects[0].children[1].fill={gradient:'green'};assert.throws(()=>validateScene(s));
});
test('prepare-only produces local payload without contacting Illustrator',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'native-rebuild-test-'));
  const source=path.join(dir,'scene.json');fs.writeFileSync(source,JSON.stringify(scene()));
  const out=path.join(dir,'work');main(['--scene',source,'--output-dir',out]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out,'prepared-scene.json'),'utf8')),scene());
  assert(!fs.existsSync(path.join(out,'native-report.json')));
  assert.throws(()=>main(['--input-image','x.png','--output-dir',out]),/Unsupported argument/);
  assert.throws(()=>main(['--inspect','--apply','--output-dir',out]),/read-only/);
});
test('native writer retains curves, point text, gradient matrix, holes and semantic group ordering',()=>{
  const s=scene();validateScene(s);const result=simulate(s);assert.equal(result.report.ok,true);
  assert.equal(result.report.visualChecked,false);
  const layer=result.doc.layers[0],group=layer.groupItems[0],curve=group.pathItems[0],label=group.textFrames[0];
  assert.deepEqual(Array.from(curve.pathPoints[0].anchor),[110,980]);
  assert.deepEqual(Array.from(curve.pathPoints[0].rightDirection),[150,980]);
  assert.equal(label.contents,'Leaf');assert.equal(label.textRange.characterAttributes.size,24);
  assert.deepEqual(Array.from(label.anchor),[130,940]);
  assert.equal(curve.fillColor.gradient.name,'Rebuild_Test__green');
  assert.equal(curve.fillColor.matrix.angle,45);assert.equal(curve.fillColor.length,100);
  assert.equal(layer.compoundPathItems[0].pathItems.length,2);
  assert.equal(layer.compoundPathItems[0].pathItems[1].evenodd,true);
  assert.deepEqual(result.ordering,['outline','label','leaf-01','ring']);
  assert.equal(result.report.counts.raster,0);assert.equal(result.report.counts.placed,0);
  assert(result.files.has(s.outputAi)&&result.files.has(s.outputPng));
});
test('inspection is read-only; document, font, layer and output mismatches stop before mutation',()=>{
  let s=scene();let result=simulate(s,{operation:'inspect'});assert.equal(result.report.ok,true);assert.equal(result.mutations,0);
  for(const opts of [{missingFont:true},{existingLayer:true},{existingOutput:true}]) {
    result=simulate(scene(),opts);assert.equal(result.report.ok,false);assert.equal(result.mutations,0);
  }
  s=scene();s.document='wrong.ai';result=simulate(s);assert.equal(result.report.ok,false);assert.equal(result.mutations,0);
});
