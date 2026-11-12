'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..');
const names=fs.readdirSync(path.join(root,'tests')).filter(name=>name.endsWith('.test.cjs')).sort();let failed=0;
for(const name of names){const result=cp.spawnSync(process.execPath,['--preserve-symlinks','--experimental-vm-modules',path.join(root,'tests',name)],{cwd:root,encoding:'utf8'});console.log((result.status===0?'PASS ':'FAIL ')+name);if(result.status!==0){failed++;console.log(result.stdout+result.stderr);}}
console.log(names.length+' test files, '+failed+' failed');process.exitCode=failed?1:0;
