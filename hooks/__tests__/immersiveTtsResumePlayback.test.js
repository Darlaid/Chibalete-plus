/**
 * HF2 structural guard: classic immersive TTS first play must be anchored to
 * the restored visual sentence, not to chunk/cache 0.
 *
 * Run:
 *   node hooks/__tests__/immersiveTtsResumePlayback.test.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..', '..');

const visorSrc = fs.readFileSync(path.join(ROOT, 'pages', 'VisorInmersivo.tsx'), 'utf8');
const hookSrc = fs.readFileSync(path.join(ROOT, 'hooks', 'useImmersivePlayback.ts'), 'utf8');
const v2Src = fs.readFileSync(path.join(ROOT, 'pages', 'VisorInmersivoV2.tsx'), 'utf8');

let pass = 0;
let fail = 0;

function ok(label, condition, detail = '') {
    if (condition) {
        console.log(`  ok ${label}`);
        pass++;
    } else {
        console.error(`  fail ${label}${detail ? ` - ${detail}` : ''}`);
        fail++;
    }
}

console.log('immersiveTtsResumePlayback - HF2 guard');

console.log('\n[A] restored visual index N starts audio at N');
ok('Visor stores explicit resumePlaybackIndexRef',
   /resumePlaybackIndexRef\s*=\s*useRef\(0\)/.test(visorSrc));
ok('Visor stores first-play pending resume flag',
   /resumePlaybackPendingRef\s*=\s*useRef\(false\)/.test(visorSrc));
ok('Post-hydration copies targetIndex into resumePlaybackIndexRef',
   /resumePlaybackIndexRef\.current\s*=\s*targetIndex/.test(visorSrc));
ok('First play after resume uses visualIndex as audioStartIndex',
   /const\s+visualIndex\s*=\s*clampPlaybackIndex\(pb\.currentIndex\)/.test(visorSrc)
   && /const\s+audioStartIndex\s*=\s*isFirstPlayAfterResume/.test(visorSrc)
   && /\?\s*visualIndex\s*:/.test(visorSrc));
ok('First play after resume calls pb.load(audioStartIndex, true) instead of resume()',
   /if\s*\(isFirstPlayAfterResume\)/.test(visorSrc)
   && /pb\.load\(audioStartIndex,\s*true,\s*\{/.test(visorSrc)
   && /anchorFirstAudio:\s*true/.test(visorSrc));

console.log('\n[B] preexisting chunk/cache 0 cannot determine first audio');
ok('Hook exposes PlaybackLoadOptions.anchorFirstAudio',
   /interface\s+PlaybackLoadOptions[\s\S]{0,300}?anchorFirstAudio\?:\s*boolean/.test(hookSrc));
ok('Hook derives forceSentenceTts when anchorFirstAudio targets a chunked sentence',
   /options\.anchorFirstAudio\s*===\s*true\s*&&\s*chunkKey\s*!==\s*index/.test(hookSrc));
ok('Forced sentence TTS uses a separate negative cache key',
   /toSentenceTtsCacheKey\(index\)/.test(hookSrc)
   && /SENTENCE_TTS_CACHE_KEY_OFFSET/.test(hookSrc));
ok('Resume anchor invalidates existing chunk cache',
   /invalidateChunkAudioForResume[\s\S]{0,600}?audioCache\.current\.delete\(chunkKey\)/.test(hookSrc));
ok('Forced sentence TTS skips manifest chunk lookup',
   /if\s*\(!forceSentenceTts\s*&&\s*mf\?\.\[chunkKey\]\)/.test(hookSrc));

console.log('\n[C] late remote progress and pending early play use resolved N');
ok('Play before resumeReady sets pendingPlayAfterResumeRef',
   /pendingPlayAfterResumeRef\.current\s*=\s*true[\s\S]{0,350}?user_play_before_resume_ready/.test(visorSrc));
ok('Post-hydration pending autoplay passes anchorFirstAudio when targetIndex > 0',
   /pb\.load\(targetIndex,\s*shouldAutoPlay,\s*\{/.test(visorSrc)
   && /anchorFirstAudio:\s*shouldAnchorInitialPlayback\s*&&\s*shouldAutoPlay/.test(visorSrc));
ok('Pending first play is cleared only after the resolved target is known',
   /resumePlaybackPendingRef\.current\s*=\s*shouldAnchorInitialPlayback\s*&&\s*!shouldAutoPlay/.test(visorSrc));

console.log('\n[D] no-progress book remains normal index 0 playback');
ok('Resume playback pending only turns on for targetIndex > 0',
   /const\s+shouldAnchorInitialPlayback\s*=\s*!isAutoTransition\s*&&\s*targetIndex\s*>\s*0/.test(visorSrc));
ok('Normal toggle path still calls pb.resume for paused playback',
   /if\s*\(pb\.status\s*===\s*'paused'\)\s*pb\.resume\(\)/.test(visorSrc));
ok('Normal toggle path still calls pb.load(pb.currentIndex, true)',
   /pb\.load\(pb\.currentIndex,\s*true\)/.test(visorSrc));

console.log('\n[E] immersive V2 remains isolated');
ok('V2 does not import classic useImmersivePlayback',
   !/^import\s+.*useImmersivePlayback/m.test(v2Src)
   && !/from\s+['"][^'"]*useImmersivePlayback/.test(v2Src));
ok('V2 does not reference anchorFirstAudio',
   !/anchorFirstAudio|resumePlaybackIndexRef|immersive-tts-resume/.test(v2Src));

console.log('\n[logs] manual verification log is present');
ok('Hook logs visualIndex, audioStartIndex, firstSpokenIndex and cacheInvalidated',
   hookSrc.includes('[immersive-tts-resume] visualIndex=${index}')
   && hookSrc.includes('audioStartIndex=${index}')
   && hookSrc.includes('firstSpokenIndex=${activeAudioFirstSpokenIndexRef.current}')
   && hookSrc.includes('cacheInvalidated=${resumeCacheInvalidated}'));

console.log(`\nimmersiveTtsResumePlayback - pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
