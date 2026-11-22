import { initChrome } from './chrome';
import { initEnquiry } from './enquiry';
import { initReveals } from './reveal';
import { initWorkbench } from './workbench';

initChrome();
initReveals();
initEnquiry();
(window as unknown as { __cpqReady: boolean }).__cpqReady = true;
const workbench = initWorkbench();

// The 3D stage is an enhancement: it loads after first paint, off the critical path,
// and only on devices that can draw it. Anything else gets static posters of the
// same scenes instead.
const showPosters = () => import('./fallback').then(({ initFallback }) => initFallback());

/**
 * True only where WebGL 2 runs on real graphics hardware. A software renderer would
 * draw the scene too slowly to scroll against. The question is asked here, before the
 * 3D code is requested, so a device that cannot draw it never downloads it.
 */
function canDraw3d(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2', { failIfMajorPerformanceCaveat: true });
    if (!gl) return false;
    // The probe's context is handed back at once; the stage creates its own.
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

const startStage = () => {
  if (!document.querySelector('[data-stage-slot]')) return;
  if (!canDraw3d()) {
    void showPosters();
    return;
  }
  import('./stage')
    .then(({ initStage }) => initStage(workbench, showPosters))
    .then((started) => {
      if (!started) return showPosters();
    })
    .catch((error) => {
      console.warn('3D stage unavailable, showing static posters instead.', error);
      return showPosters();
    });
};

if ('requestIdleCallback' in window) {
  window.requestIdleCallback(startStage, { timeout: 900 });
} else {
  setTimeout(startStage, 600);
}
