// Outfit Manager · 二改版 | 复用正式导入路径，逐轮确认保存与刷新读回
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { readImportFile } from './import-file.js';
import { reviewImport } from './import-review.js';
import { createImportProgress } from './import-progress.js';
import { diagnosticStoreGet } from './diagnostic-store.js';
import { diagnosticPause } from './diagnostic-data.js';

export async function runDiagnosticImport(wizard, signal, update) {
    var source = await diagnosticStoreGet(wizard.id, 'source');
    if (!(source instanceof Blob)) throw new Error('SOURCE_MISSING');
    var job = createImportProgress(); if (!job) throw new Error('DIAGNOSTIC_IMPORT_BUSY');
    function abort() { job.cancel(); }
    if (signal.aborted) { abort(); throw new Error('DIAGNOSTIC_CANCELLED'); }
    signal.addEventListener('abort', abort, { once: true });
    var note = job.note, progress = job.update, fail = job.fail;
    job.note = function(stage, fields) { note(stage, fields); update(stage); };
    job.update = function(value) { progress(value); update(value.phase === '读取备份' ? 'reading' : /图片/.test(value.phase || '') ? 'images' : 'planning'); };
    job.fail = function(error) { fail(error); };
    try {
        update('reading');
        var data = await readImportFile(source, { local: true, signal: job.signal, onProgress: job.update });
        if (signal.aborted) throw new Error('DIAGNOSTIC_CANCELLED');
        return await new Promise(function(resolve, reject) {
            function stopped() { reject(new Error('DIAGNOSTIC_CANCELLED')); }
            job.signal.addEventListener('abort', stopped, { once: true });
            reviewImport(data, 'merge', { job: job, targetUserKey: wizard.targetUserKey, diagnostic: true,
                onResult: function(result) { job.signal.removeEventListener('abort', stopped); resolve(result); },
                onPreview: async function(sheet) {
                    update('preview');
                    // Use the same button handler as a normal import. If another
                    // layer or handler blocks it, do not bypass that interference.
                    await diagnosticPause(120);
                    if (signal.aborted || !sheet.isConnected) return;
                    var button = sheet.querySelector('#om-import-confirm'); button.scrollIntoView({ block: 'nearest' });
                    var rect = button.getBoundingClientRect(), style = getComputedStyle(button), top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
                    if (!rect.width || !rect.height || style.visibility === 'hidden' || style.display === 'none' || style.pointerEvents === 'none' || !(top === button || button.contains(top))) { resolve({ ok: false, blocked: true }); return; }
                    button.click();
                    // Let native clicks finish the same preview if a host only
                    // accepts trusted events. Never infer a conflict from that.
                    await diagnosticPause(1200);
                    if (sheet.isConnected && !button.disabled && !signal.aborted) resolve({ ok: false, blocked: true });
                }
            }).catch(reject);
        });
    } catch(error) { if(job.signal.aborted)throw new Error('DIAGNOSTIC_CANCELLED'); throw error; }
    finally { signal.removeEventListener('abort', abort); job.release(); }
}
