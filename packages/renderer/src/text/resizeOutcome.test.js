import { expect,it,vi } from 'vitest';
import { measureResizeFits,resizeFallback } from './measureResizeFits.js';
it('returns a content-free failure if candidate traversal itself throws',()=>{
 const broken={get slides(){throw Error('SECRET');}};
 const result=measureResizeFits(broken);expect(result.status).toBe('failed');expect(result.resize.size).toBe(0);expect(JSON.stringify(result)).not.toContain('SECRET');
});
it('counts fallbacks without adapting text or inspecting fonts',()=>{
 const text=vi.fn(()=>{throw Error('must not adapt');});const object={bodyLayout:{autofit:'resize'},get text(){return text();}};
 expect(resizeFallback({slides:[{objects:[object]}]},'skipped','fonts-timeout').stats.skipped).toBe(1);expect(text).not.toHaveBeenCalled();
});
