// CHP-MAINT-IMMERSIVE-2026-10 — inventario READ-ONLY. Corre en contenedor efímero con mounts :ro.
import fs from 'fs'; import path from 'path'; import crypto from 'crypto';
const DATA = '/d', UP = '/u';
const src = fs.readFileSync('/app/server/ttsService.js', 'utf8').replace(/\r\n/g, '\n');
const m1 = src.match(/const chunkText = \(text[\s\S]*?\n\};\n/); const m2 = src.match(/const splitSentencesFromChunk = [\s\S]*?\n\};\n/);
const chunkText = eval('(' + m1[0].replace(/^const chunkText = /, '').replace(/;\n$/, '') + ')');
const splitS = eval('(' + m2[0].replace(/^const splitSentencesFromChunk = /, '').replace(/;\n$/, '') + ')');
const gh = (text, l, v, p, mo) => crypto.createHash('md5').update(`${text.replace(/\r\n/g,' ').replace(/\n/g,' ').replace(/\s+/g,' ').trim()}|${l}|${v}|${p}|${mo}`).digest('hex');
const norm = t => String(t).replace(/^﻿/,'').replace(/\r\n?/g,'\n').replace(/[ \t]+$/gm,'').replace(/\n+$/,'');
const fp = t => 'sha256:' + crypto.createHash('sha256').update(norm(t),'utf8').digest('hex');
const rd = u => { if (typeof u!=='string'||!u.startsWith('/uploads/')) return null; const p=path.join(UP,u.slice(9)); try { return fs.statSync(p).isFile()? fs.readFileSync(p,'utf8'):null } catch { return null } };
const content = JSON.parse(fs.readFileSync(path.join(DATA,'content.json'),'utf8'));
const out = [];
for (const c of content) {
  const r = { id:c.id, titulo:c.titulo, tipo:c.tipo, standalone:c.standalone, isCollection:c.isCollection, parentId:c.parentId||null, ttsStatus:c.ttsStatus??null, processingStatus: c.processingStatus? (typeof c.processingStatus==='object'? c.processingStatus.status : c.processingStatus):null, ttsLastError:c.ttsLastError? String(c.ttsLastError).slice(0,80):null, txtUrl:!!c.texto_plano_url, canonical:!!c.canonicalBookUrl, epub:!!c.epub_url };
  const txt = rd(c.texto_plano_url);
  r.txtExists = txt!=null; r.txtBytes = txt? Buffer.byteLength(txt):0; r.txtFp = txt? fp(txt).slice(0,19):null;
  if (c.contentFingerprint) r.fpField = c.contentFingerprint===(txt?fp(txt):null) ? 'MATCH_TXT':'DIFF_TXT', r.contentVersion=c.contentVersion;
  if (c.canonicalBookUrl) { const cb = rd(c.canonicalBookUrl); r.canonicalExists = cb!=null; if (cb){ r.canonicalBytes=Buffer.byteLength(cb); r.canonicalFieldFp = c.canonicalFingerprint; } }
  const exp = txt? chunkText(txt):[]; r.expChunks = exp.length; r.expCapped = Math.min(exp.length,500);
  const dir = path.join(UP,'audio',c.id); r.audioDir = fs.existsSync(dir);
  if (r.audioDir) {
    const files = fs.readdirSync(dir); r.mp3 = files.filter(f=>f.endsWith('.mp3')).length; r.anchors = files.includes('anchors.json');
    r.tmpFiles = files.filter(f=>/\.tmp-/.test(f)).length;
    let man=null; try { man = JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8')) } catch(e) { r.manifestErr = fs.existsSync(path.join(dir,'manifest.json'))?'PARSE':'ABSENT' }
    if (man) {
      const meta = man._meta||null; r.mVer = meta?.version??1; r.mTotalChunks = meta?.totalChunks??null; r.mTotalSentences = meta?.totalSentences??null;
      const ents = Object.entries(man).filter(([k])=>k!=='_meta').map(([k,v])=>({k,v}));
      r.mEntries = ents.length; let textMatch=0,textDiff=0,hashOk=0,hashBad=0,fileOk=0,fileMissing=0,fileEmpty=0,idxBad=0,sentOk=0,sentBad=0, firstDiff=null; const ref=new Set();
      const idxs = ents.map(e=>e.v?.index).sort((a,b)=>a-b); r.mIdxMin = idxs[0]??null; r.mIdxMax=idxs.at(-1)??null;
      r.mContiguous = idxs.every((v,i)=>v===i);
      let gs=0;
      for (const {k,v} of ents.sort((a,b)=>a.v.index-b.v.index)) {
        if (String(v.index)!==k) idxBad++;
        const e = exp[v.index]; if (e!=null && e===v.text) textMatch++; else { textDiff++; if(firstDiff==null) firstDiff=v.index; }
        if (v.hash && v.provider && gh(v.text,'es','alloy',v.provider,v.model)===v.hash && v.file?.includes(v.hash)) hashOk++; else hashBad++;
        const fn = v.file? path.basename(v.file):''; ref.add(fn);
        const okPath = v.file===`audio/${c.id}/${fn}`;
        try { const s=fs.statSync(path.join(dir,fn)); if(!okPath) fileMissing++; else if (s.size>0) fileOk++; else fileEmpty++; } catch { fileMissing++; }
        const ss = splitS(v.text); if (JSON.stringify(ss)===JSON.stringify(v.sentences) && (r.mVer<2 || v.sentenceStart===gs)) sentOk++; else sentBad++;
        gs += Array.isArray(v.sentences)? v.sentences.length:0;
      }
      Object.assign(r,{textMatch,textDiff,firstDiff,hashOk,hashBad,fileOk,fileMissing,fileEmpty,idxBad,sentOk,sentBad, sumSentences:gs});
      r.orphanMp3 = files.filter(f=>f.endsWith('.mp3')&&!ref.has(f)).length;
      r.providers = [...new Set(ents.map(e=>e.v.provider))].join(',');
    }
  }
  out.push(r);
}
console.log(JSON.stringify(out));
