const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
(async()=>{
 const m=new vm.SourceTextModule(fs.readFileSync(path.join(__dirname,'../src/description-format.js'),'utf8'));await m.link(()=>{throw Error('formatting must stay local');});await m.evaluate();const normal=m.namespace.normalizeGarmentParagraph;
 for(const [before,after]of [
  ['（灰蓝针织上衣。\n白色半裙。）','灰蓝针织上衣。 白色半裙。'],
  ['（上装：灰蓝针织上衣。）（下装：白色半裙。）','灰蓝针织上衣。白色半裙。'],
  ['【上装】灰蓝针织上衣。\n【下装】白色半裙。','灰蓝针织上衣。 白色半裙。'],
  ['灰蓝上衣（袖口包边）。\n白色半裙。','灰蓝上衣（袖口包边）。 白色半裙。'],
  ['（灰蓝上衣（袖口包边）。）','灰蓝上衣（袖口包边）。'],
  ['（灰蓝上衣）（白色半裙）','灰蓝上衣；白色半裙'],
  ['（上装）灰蓝针织衫。','（上装）灰蓝针织衫。'],
  ['  ','']
 ])assert.equal(normal(before),after,before);
 console.log('description format 2.4.4: pass (single paragraph; whole/nested/multiple wrappers; section labels; meaningful inline notes retained; no API)');
})().catch(error=>{console.error(error);process.exitCode=1;});
