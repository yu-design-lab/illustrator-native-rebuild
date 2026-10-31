#!/usr/bin/env node
'use strict';
// Local scene preparation and a fixed Illustrator bridge. No network or API client.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

function assert(ok, message) { if (!ok) throw new Error(message); }
function num(n, label, min = -Infinity, max = Infinity) {
  assert(typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max, `${label}: invalid number`);
}
function point(p, label, length = 2) {
  assert(Array.isArray(p) && p.length === length, `${label}: expected ${length} numbers`);
  p.forEach(n => num(n, label));
}
function keys(o, allowed, label) {
  assert(o && typeof o === 'object' && !Array.isArray(o), `${label}: expected object`);
  for (const key of Object.keys(o)) assert(allowed.includes(key), `${label}: unsupported field ${key}`);
}
function text(s, label) { assert(typeof s === 'string' && s.trim().length > 0, `${label}: required string`); }
function color(c, label) {
  if (typeof c === 'string') return assert(/^#[0-9A-Fa-f]{6}$/.test(c), `${label}: use #RRGGBB`);
  keys(c, ['cmyk'], label);
  point(c.cmyk, label, 4); c.cmyk.forEach(n => num(n, label, 0, 100));
}
function localOutput(p, extension) {
  text(p, extension);
  assert(!/^[a-z]+:\/\//i.test(p) && !/^[\\/]{2}/.test(p), 'Output must be a local absolute path');
  assert(path.isAbsolute(p), 'Output must be an absolute path');
  assert(path.extname(p).toLowerCase() === extension, `Expected ${extension} output`);
}
function validateScene(scene) {
  keys(scene, ['version','document','layer','canvas','origin','scale','outputAi','outputPng','gradients','objects'], 'scene');
  assert(scene.version === 1, 'Unsupported scene version');
  text(scene.document, 'document'); text(scene.layer, 'layer');
  keys(scene.canvas, ['width','height'], 'canvas');
  num(scene.canvas.width, 'canvas.width', Number.EPSILON); num(scene.canvas.height, 'canvas.height', Number.EPSILON);
  point(scene.origin, 'origin'); num(scene.scale, 'scale', Number.EPSILON);
  localOutput(scene.outputAi, '.ai'); localOutput(scene.outputPng, '.png');
  const gradients = new Set();
  assert(Array.isArray(scene.gradients), 'gradients must be an array');
  for (const g of scene.gradients) {
    keys(g, ['id','type','stops'], 'gradient'); text(g.id, 'gradient id');
    assert(!gradients.has(g.id), `Duplicate gradient ${g.id}`); gradients.add(g.id);
    assert(['linear','radial'].includes(g.type), 'Unsupported gradient type');
    assert(Array.isArray(g.stops) && g.stops.length >= 2 && g.stops.length <= 32, 'Expected 2–32 stops');
    let previous = -1;
    for (const s of g.stops) {
      keys(s, ['offset','color','opacity'], 'gradient stop');
      num(s.offset, 'offset', 0, 100); assert(s.offset > previous, 'Gradient offsets must increase'); previous = s.offset;
      color(s.color, 'stop.color'); if (s.opacity !== undefined) num(s.opacity, 'stop.opacity', 0, 100);
    }
    assert(g.stops[0].offset === 0 && previous === 100, 'Gradient stops must include 0 and 100');
  }
  const names = new Set();
  const counts = {group:0,path:0,compound:0,ellipse:0,rect:0,text:0};
  function style(o) {
    if (o.fill !== undefined && o.fill !== null) {
      if (typeof o.fill === 'object' && Object.hasOwn(o.fill, 'gradient')) {
        keys(o.fill, ['gradient','origin','length','angle'], 'gradient fill');
        assert(gradients.has(o.fill.gradient), `Unknown gradient ${o.fill.gradient}`);
        point(o.fill.origin, 'gradient origin'); num(o.fill.length, 'gradient length', Number.EPSILON);
        num(o.fill.angle, 'gradient angle');
      } else color(o.fill, 'fill');
    }
    if (o.stroke !== undefined && o.stroke !== null) color(o.stroke, 'stroke');
    if (o.strokeWidth !== undefined) num(o.strokeWidth, 'strokeWidth', 0);
    if (o.opacity !== undefined) num(o.opacity, 'opacity', 0, 100);
  }
  function visit(o, depth = 0) {
    assert(depth < 64, 'Too deeply nested');
    assert(o && Object.hasOwn(counts, o.type), 'Unsupported object type (images, SVG and executable code are rejected)');
    const common = ['type','name','fill','stroke','strokeWidth','opacity'];
    const specific = {
      group:['children'], path:['points','closed','evenodd'], compound:['paths','evenodd'],
      ellipse:['box'], rect:['box'], text:['text','position','font','size','align','rotation']
    };
    keys(o, common.concat(specific[o.type]), o.type);
    text(o.name, 'object name'); assert(!names.has(o.name), `Duplicate object name ${o.name}`); names.add(o.name);
    counts[o.type]++; style(o);
    if (o.type === 'group') {
      assert(Array.isArray(o.children) && o.children.length, 'Empty group');
      for (const k of ['fill','stroke','strokeWidth']) assert(o[k] === undefined, 'Group styles must be set on child objects');
      o.children.forEach(c => visit(c, depth + 1));
    } else if (o.type === 'path') {
      assert(Array.isArray(o.points) && o.points.length >= 2, 'Path needs at least 2 points');
      if (o.closed !== undefined) assert(typeof o.closed === 'boolean', 'closed must be boolean');
      if (o.evenodd !== undefined) assert(typeof o.evenodd === 'boolean', 'evenodd must be boolean');
      for (const p of o.points) {
        keys(p, ['anchor','left','right','smooth'], 'path point'); point(p.anchor, 'anchor');
        if (p.left !== undefined) point(p.left, 'left'); if (p.right !== undefined) point(p.right, 'right');
        if (p.smooth !== undefined) assert(typeof p.smooth === 'boolean', 'smooth must be boolean');
      }
    } else if (o.type === 'compound') {
      assert(Array.isArray(o.paths) && o.paths.length, 'Compound needs closed paths');
      if (o.evenodd !== undefined) assert(typeof o.evenodd === 'boolean', 'evenodd must be boolean');
      o.paths.forEach(p => { assert(p.type === 'path' && p.closed === true, 'Compound children must be closed paths');
        for (const k of ['fill','stroke','strokeWidth','opacity']) assert(p[k] === undefined, 'Compound appearance belongs on compound');
        visit(p, depth + 1);
      });
    } else if (['ellipse','rect'].includes(o.type)) {
      point(o.box, 'box', 4); num(o.box[2], 'width', Number.EPSILON); num(o.box[3], 'height', Number.EPSILON);
    } else if (o.type === 'text') {
      text(o.text, 'text'); text(o.font, 'PostScript font name'); point(o.position, 'text baseline');
      num(o.size, 'font size', Number.EPSILON);
      if (o.align !== undefined) assert(['left','center','right'].includes(o.align), 'Invalid text alignment');
      if (o.rotation !== undefined) num(o.rotation, 'rotation');
      color(o.fill, 'text fill'); assert(o.stroke === undefined || o.stroke === null, 'Text stroke is not supported');
    }
  }
  assert(Array.isArray(scene.objects) && scene.objects.length, 'objects must not be empty');
  scene.objects.forEach(o => visit(o));
  return counts;
}
function main(argv = process.argv.slice(2)) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (['--inspect','--apply'].includes(a)) options[a.slice(2)] = true;
    else if (['--scene','--output-dir'].includes(a)) { assert(argv[i+1] && !argv[i+1].startsWith('--'), `${a}: missing value`); options[a.slice(2)] = argv[++i]; }
    else throw new Error(`Unsupported argument ${a}`);
  }
  assert(options['output-dir'], '--output-dir is required');
  assert(!(options.inspect && (options.scene || options.apply)), '--inspect is read-only and cannot be combined with --scene/--apply');
  assert(options.inspect || options.scene, 'Use --scene or --inspect');
  const out = path.resolve(options['output-dir']);
  let sceneFile;
  let counts;
  if (options.scene) {
    const scene = JSON.parse(fs.readFileSync(path.resolve(options.scene), 'utf8').replace(/^\uFEFF/, ''));
    counts = validateScene(scene);
    sceneFile = path.join(out, 'prepared-scene.json');
    fs.mkdirSync(out, {recursive:true});
    fs.writeFileSync(sceneFile, JSON.stringify(scene, null, 2).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029'), 'utf8');
    if (!options.apply) {
      console.log(JSON.stringify({ok:true, mode:'prepare-only', counts, scene:sceneFile, illustratorTouched:false}));
      return;
    }
  }
  assert(process.platform === 'win32', 'Desktop bridge currently supports Windows only; local scene preparation is available on this OS');
  fs.mkdirSync(out, {recursive:true});
  const report = path.join(out, options.inspect ? 'inspect-report.json' : 'native-report.json');
  const args = ['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'bridge.ps1'),'-ReportPath',report];
  if (options.inspect) args.push('-Inspect'); else args.push('-SceneJson',sceneFile);
  const result = cp.spawnSync('powershell.exe', args, {encoding:'utf8', windowsHide:true, timeout:600000});
  if (result.error) throw result.error;
  assert(result.status === 0, (result.stderr || result.stdout || 'Illustrator bridge failed').trim());
  console.log(result.stdout.trim());
}
module.exports = {validateScene, main};
if (require.main === module) { try { main(); } catch (e) { console.error(e.message); process.exitCode = 1; } }
