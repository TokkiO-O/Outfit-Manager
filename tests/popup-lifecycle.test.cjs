'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
async function load(name,context,imports){
    const module=new vm.SourceTextModule(fs.readFileSync(path.join(__dirname,'../src',name),'utf8'),{context});
    await module.link(specifier=>{const values=imports[specifier];assert.ok(values,'unexpected dependency '+specifier);return new vm.SyntheticModule(Object.keys(values),function(){for(const [key,value]of Object.entries(values))this.setExport(key,value);},{context});});
    await module.evaluate();return module.namespace;
}
(async()=>{
    let overlay=null;
    const context=vm.createContext({WeakMap,document:{querySelector:()=>overlay}});
    const utils=await load('utils.js',context,{'./db/local-images.js':{hydrateLocalImages(){}}});
    assert.equal(utils.getPopupSessionId(),null);
    overlay={isConnected:true};const first=utils.getPopupSessionId();assert.equal(utils.getPopupSessionId(),first);
    overlay._omClosing=true;assert.equal(utils.getPopupSessionId(),null,'closing becomes invisible before teardown callbacks run');
    overlay={isConnected:true};assert.notEqual(utils.getPopupSessionId(),first,'a reopened UI cannot receive an old task popup');
    overlay.isConnected=false;assert.equal(utils.getPopupSessionId(),null);
    const sheets=await load('ui-sheets/sheet-base.js',context,{'../styles/index.js':{ensureFullStyles(){}},'../utils.js':{getPopupLayer(){},mountPopup(){}}});
    function sheet(onClose){const node={parentNode:{removeChild(value){assert.equal(value,node);node.parentNode=null;}},_omOnClose:onClose};return node;}
    let calls=0;const reentrant=sheet(()=>{calls++;sheets.closeSheet(reentrant);});
    sheets.closeSheet(reentrant);sheets.closeSheet(reentrant);assert.equal(calls,1);assert.equal(reentrant.parentNode,null);
    const throwing=sheet(()=>{throw new Error('synthetic teardown failure');});
    assert.throws(()=>sheets.closeSheet(throwing),/synthetic teardown failure/);assert.equal(throwing.parentNode,null,'failed cleanup cannot leave a blocking sheet');
    console.log('popup lifecycle: pass (closed-session isolation, reentrant cleanup, exception-safe removal)');
})().catch(error=>{console.error(error);process.exitCode=1;});
