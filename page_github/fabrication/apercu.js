'use strict';
// L'apercu de la page GitHub, sans rien envoyer : le Markdown converti en HTML (ce que ces deux pages utilisent :
// le HTML brut, les titres, les paragraphes, les listes, le gras, le code, les liens, les lignes ---), mis en page comme
// GitHub (largeur, police, titres soulignes, tableaux), puis photographie par Edge, en clair et en sombre.
// node page_github/fabrication/apercu.js   ->  page_github/apercus/readme_clair.png, readme_sombre.png, installateur_*.png
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const { lirePng } = require('../../design/outils/png_lire');
const { ecrirePng } = require('../../design/outils/png_simple');
const ICI = path.join(__dirname, '..');
const SORTIE = path.join(ICI, 'apercus');
fs.mkdirSync(SORTIE, { recursive: true });

const echapper = s => s.replace(/&(?!(?:[a-z]+|#\d+);)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function enLigne(t) {
  // le code d'abord (rien n'est interprete dedans), puis le gras, les liens
  const codes = [];
  t = t.replace(/`([^`]+)`/g, (m, c) => { codes.push('<code>' + echapper(c) + '</code>'); return '\u0000' + (codes.length - 1) + '\u0000'; });
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return t.replace(/\u0000(\d+)\u0000/g, (m, i) => codes[i]);
}
function versHtml(md) {
  const lignes = md.replace(/\r/g, '').split('\n');
  const out = [];
  let i = 0;
  const estHtml = l => /^\s*<\/?(p|table|tr|td|details|summary|br|sub|div|img|a)\b/i.test(l) || /^\s*<!--/.test(l);
  while (i < lignes.length) {
    const l = lignes[i];
    if (!l.trim()) { i++; continue; }
    if (estHtml(l)) {   // un bloc HTML : jusqu'a la ligne vide
      const b = [];
      while (i < lignes.length && lignes[i].trim()) b.push(lignes[i++]);
      out.push(b.join('\n'));
      continue;
    }
    let m;
    if ((m = /^(#{1,6}) (.*)$/.exec(l))) { out.push('<h' + m[1].length + '>' + enLigne(m[2]) + '</h' + m[1].length + '>'); i++; continue; }
    if (/^---+\s*$/.test(l)) { out.push('<hr>'); i++; continue; }
    if (/^(\d+\.|-) /.test(l)) {   // une liste, avec des sous-listes indentees
      const pile = [];
      while (i < lignes.length && (/^\s*(\d+\.|-) /.test(lignes[i]) || (/^\s{2,}\S/.test(lignes[i]) && pile.length))) {
        const x = lignes[i];
        const mm = /^(\s*)(\d+\.|-) (.*)$/.exec(x);
        if (!mm) { out[out.length - 1] += ' ' + enLigne(x.trim()); i++; continue; }
        const niveau = Math.floor(mm[1].length / 3), type = mm[2] === '-' ? 'ul' : 'ol';
        while (pile.length > niveau + 1) out.push('</li></' + pile.pop() + '>');
        if (pile.length === niveau) { pile.push(type); out.push('<' + type + '>'); } else out.push('</li>');
        out.push('<li>' + enLigne(mm[3]));
        i++;
      }
      while (pile.length) out.push('</li></' + pile.pop() + '>');
      continue;
    }
    const p = [];   // un paragraphe
    while (i < lignes.length && lignes[i].trim() && !estHtml(lignes[i]) && !/^(#{1,6} |---|\s*(\d+\.|-) )/.test(lignes[i])) p.push(lignes[i++].trim());
    out.push('<p>' + enLigne(p.join(' ')) + '</p>');
  }
  return out.join('\n');
}

const STYLE = `
body { margin: 0; font-family: -apple-system, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.5; }
body.clair { background: #ffffff; color: #1f2328; } body.sombre { background: #0d1117; color: #e6edf3; }
.page { width: 882px; margin: 0 auto; padding: 32px; }
.cadre { border: 1px solid; border-radius: 6px; padding: 32px; }
.clair .cadre { border-color: #d1d9e0; } .sombre .cadre { border-color: #3d444d; }
.titre-cadre { font-size: 14px; font-weight: 600; padding: 8px 0 16px; }
h2 { font-size: 1.5em; font-weight: 600; padding-bottom: .3em; border-bottom: 1px solid; margin: 24px 0 16px; }
.clair h2 { border-color: #d1d9e0b3; } .sombre h2 { border-color: #3d444db3; }
h3 { font-size: 1.25em; font-weight: 600; margin: 24px 0 16px; }
p, ul, ol, table, details { margin: 0 0 16px; } ul, ol { padding-left: 2em; } li + li { margin-top: .25em; }
a { text-decoration: none; } .clair a { color: #0969da; } .sombre a { color: #4493f8; }
code { font-family: ui-monospace, Consolas, monospace; font-size: 85%; padding: .2em .4em; border-radius: 6px; }
.clair code { background: #818b981f; } .sombre code { background: #656c7633; }
hr { height: .25em; border: 0; margin: 24px 0; } .clair hr { background: #d1d9e0; } .sombre hr { background: #3d444d; }
table { border-collapse: collapse; } td { padding: 6px 13px; border: 1px solid; }
.clair td { border-color: #d1d9e0; } .sombre td { border-color: #3d444d; }
.clair tr:nth-child(2n) { background: #f6f8fa; } .sombre tr:nth-child(2n) { background: #151b23; }
img { max-width: 100%; } sub { font-size: 75%; } summary { cursor: pointer; }
`;
function page(md, titre, theme) {
  const corps = versHtml(md).replace(/https:\/\/raw\.githubusercontent\.com\/guerrinflorian\/casteria-mc\/main\/images\//g, 'images/');
  return '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><style>' + STYLE + '</style></head><body class="' + theme + '">' +
    '<div class="page"><div class="cadre"><div class="titre-cadre">' + titre + '</div>' + corps + '</div></div></body></html>';
}
function photographier(nom, html) {
  const f = path.join(ICI, '_apercu_' + nom + '.html');
  fs.writeFileSync(f, html);
  const brut = path.join(os.tmpdir(), 'casteria_apercu_' + nom + '.png');
  try { fs.unlinkSync(brut); } catch (e) { /* rien */ }
  try {
    execFileSync('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--disable-gpu', '--hide-scrollbars',
      '--force-device-scale-factor=1', '--user-data-dir=' + path.join(os.tmpdir(), 'casteria_edge_ae'), '--window-size=946,6000',
      '--virtual-time-budget=4000', '--screenshot=' + brut, 'file:///' + f.split(path.sep).join('/')], { stdio: 'pipe', timeout: 60000 });
  } catch (e) { /* Edge ecrit sur stderr meme quand tout va bien */ }
  fs.unlinkSync(f);
  // couper le bas vide
  const im = lirePng(brut), fond = im.pixels[im.pixels.length - 1].join();
  let bas = im.h - 1;
  while (bas > 0 && im.pixels.slice(bas * im.w, (bas + 1) * im.w).every(p => p.join() === fond)) bas--;
  const H = Math.min(im.h, bas + 33);
  ecrirePng(path.join(SORTIE, nom + '.png'), im.w, H, im.pixels.slice(0, H * im.w));
  console.log(nom + '.png : ' + im.w + ' x ' + H);
}
const readme = fs.readFileSync(path.join(ICI, 'README.md'), 'utf8');
const installateur = fs.readFileSync(path.join(ICI, 'page_installateur.md'), 'utf8');
for (const t of ['clair', 'sombre']) {
  photographier('readme_' + t, page(readme, 'README.md', t));
  photographier('installateur_' + t, page(installateur, 'Installer le launcher de Casteria', t));
}
