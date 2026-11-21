import { initChrome } from './chrome';
import { initReveals } from './reveal';
import { initWorkbench } from './workbench';

initChrome();
initReveals();
(window as unknown as { __cpqReady: boolean }).__cpqReady = true;
const workbench = initWorkbench();

// The 3D stage is an enhancement: it loads after first paint, off the critical path,
// and only on devices that can draw it. Anything else gets static posters of the
// same scenes instead.
const showPosters = () => import('./fallback').then(({ initFallback }) => initFallback());

const startStage = () => {
  import('./stage')
    .then(({ initStage }) => initStage(workbench))
    .then((started) => {
      if (!started) return showPosters();
    })
    .catch((error) => {
      console.warn('3D stage unavailable, showing static posters instead.', error);
      return showPosters();
    });
};

if ('requestIdleCallback' in window) {
  window.requestIdleCallback(startStage, { timeout: 1800 });
} else {
  setTimeout(startStage, 600);
}
