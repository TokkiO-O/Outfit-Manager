'use strict';

// 结构性冲突扫描 / 修复。
// conflicts.js 是纯函数模块（不 import 任何东西），所以用 vm 直接加载即可。

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function loadConflicts() {
    const file = path.resolve(__dirname, '..', 'src', 'conflicts.js');
    const context = vm.createContext({ Object, Array, String, Number, Boolean, Date, Math });
    const mod = new vm.SourceTextModule(fs.readFileSync(file, 'utf8'), { context, identifier: file });
    await mod.link(() => { throw new Error('conflicts.js must not import other modules'); });
    await mod.evaluate();
    return mod.namespace;
}

function clone(v) { return JSON.parse(JSON.stringify(v)); }
// vm 里生成的数组/对象原型不同，deepStrictEqual 会误判，比较前统一过一遍 JSON
function plain(v) { return JSON.parse(JSON.stringify(v)); }

function typesOf(report) {
    // vm 里创建的对象原型和宿主不同，deepStrictEqual 会因此失败，先过一遍 JSON 归一化
    return JSON.parse(JSON.stringify(report.issues.map((i) => i.type).sort()));
}

async function run() {
    const C = await loadConflicts();

    // ── 1. 干净数据不报任何问题 ──────────────────────────
    {
        const part = {
            outfits: [{ id: 'o1', name: 'A', category: '日常' }],
            accessories: [{ id: 'a1', name: '帽子', category: '头部' }],
            categories: ['日常'],
            accCategories: ['头部'],
            activeIds: ['o1']
        };
        const r = C.scanConflicts(part);
        assert.equal(r.total, 0, '干净数据不该报问题，实际: ' + JSON.stringify(typesOf(r)));
        assert.equal(r.fixable, 0);
    }

    // ── 2. activeIds 断链 ────────────────────────────────
    {
        const part = {
            outfits: [{ id: 'o1', name: 'A' }],
            accessories: [],
            categories: [],
            activeIds: ['o1', 'gone1', 'gone2']
        };
        const r = C.scanConflicts(part);
        assert.deepEqual(typesOf(r), ['DEAD_ACTIVE']);
        assert.equal(r.counts.deadActive, 2);
        assert.equal(r.bySeverity.mid, 1);

        const fixed = C.repairConflicts(part);
        assert.equal(fixed.changed, 2);
        assert.deepEqual(plain(part.activeIds), ['o1'], '只保留有效 id');
        assert.equal(part.outfits.length, 1, '不能碰穿搭本身');
        assert.equal(C.scanConflicts(part).total, 0, '修完应该干净');
    }

    // ── 3. 套装引用已删除的单品 ──────────────────────────
    {
        const part = {
            outfits: [{
                id: 'o1', name: '校服',
                kits: [{ id: 'k1', name: '日常', accIds: ['a1', 'dead1', 'dead2'], disabledAccIds: [] }]
            }],
            accessories: [{ id: 'a1', name: '领结' }],
            categories: [], accCategories: [], activeIds: []
        };
        const r = C.scanConflicts(part);
        assert.deepEqual(typesOf(r), ['DEAD_KIT_ACC']);
        assert.equal(r.counts.deadKitAcc, 2);
        assert.ok(r.issues[0].samples.length > 0, '应该给出样例，方便用户定位');

        C.repairConflicts(part);
        assert.deepEqual(plain(part.outfits[0].kits[0].accIds), ['a1']);
        assert.equal(part.accessories.length, 1, '不能删单品');
    }

    // ── 4. 套装内同一单品重复 ────────────────────────────
    {
        const part = {
            outfits: [{ id: 'o1', name: 'A', kits: [{ id: 'k1', accIds: ['a1', 'a1', 'a2', 'a1'], disabledAccIds: [] }] }],
            accessories: [{ id: 'a1' }, { id: 'a2' }],
            categories: [], accCategories: [], activeIds: []
        };
        const r = C.scanConflicts(part);
        assert.ok(typesOf(r).indexOf('DUP_KIT_ACC') !== -1);
        assert.equal(r.counts.dupKitAcc, 2);

        C.repairConflicts(part);
        assert.deepEqual(plain(part.outfits[0].kits[0].accIds), ['a1', 'a2']);
    }

    // ── 5. 「已停用」里的无关键 ──────────────────────────
    {
        const part = {
            outfits: [{ id: 'o1', name: 'A', kits: [{ id: 'k1', accIds: ['a1'], disabledAccIds: ['a1', 'ghost'] }] }],
            accessories: [{ id: 'a1' }],
            categories: [], accCategories: [], activeIds: []
        };
        const r = C.scanConflicts(part);
        assert.equal(r.counts.deadKitDisabled, 1);

        C.repairConflicts(part);
        assert.deepEqual(plain(part.outfits[0].kits[0].disabledAccIds), ['a1'], '只留仍在套装里的');
    }

    // ── 6. 空套装：多个套装时才删 ────────────────────────
    {
        const multi = {
            outfits: [{ id: 'o1', name: 'A', kits: [
                { id: 'k1', accIds: ['a1'] },
                { id: 'k2', accIds: [] },
                { id: 'k3', accIds: [] }
            ] }],
            accessories: [{ id: 'a1' }],
            categories: [], accCategories: [], activeIds: []
        };
        const r = C.scanConflicts(multi);
        assert.equal(r.counts.emptyKit, 2);
        C.repairConflicts(multi);
        assert.equal(multi.outfits[0].kits.length, 1, '删掉两个空套装');
        assert.equal(multi.outfits[0].kits[0].id, 'k1');

        const single = {
            outfits: [{ id: 'o2', name: 'B', kits: [{ id: 'k9', accIds: [] }] }],
            accessories: [], categories: [], accCategories: [], activeIds: []
        };
        const r2 = C.scanConflicts(single);
        assert.equal(r2.counts.emptyKit, 0, '只剩一个套装时不算空套装问题');
        C.repairConflicts(single);
        assert.equal(single.outfits[0].kits.length, 1, '唯一的空套装要保留当容器');
    }

    // ── 7. 孤儿分类：补登记而不是清空 ────────────────────
    {
        const part = {
            outfits: [
                { id: 'o1', name: 'A', category: '已删掉的分类' },
                { id: 'o2', name: 'B', category: '已删掉的分类' },
                { id: 'o3', name: 'C', category: '日常' }
            ],
            accessories: [{ id: 'a1', category: '旧单品分类' }],
            categories: ['日常'],
            accCategories: [],
            activeIds: []
        };
        const r = C.scanConflicts(part);
        assert.deepEqual(typesOf(r), ['DEAD_ACC_CAT', 'DEAD_OUTFIT_CAT']);
        assert.equal(r.counts.deadOutfitCat, 1);

        C.repairConflicts(part);
        assert.ok(part.categories.indexOf('已删掉的分类') !== -1, '孤儿分类要补登记');
        assert.ok(part.accCategories.indexOf('旧单品分类') !== -1);
        assert.equal(part.outfits[0].category, '已删掉的分类', '不能清空用户的分类名');
        assert.equal(C.scanConflicts(part).total, 0);
    }

    // ── 8. id 重复 / 缺 id 只报告，不自动修 ──────────────
    {
        const part = {
            outfits: [{ id: 'dup', name: 'A' }, { id: 'dup', name: 'B' }, { name: '没 id' }],
            accessories: [{ id: 'x' }, { id: 'x' }],
            categories: [], accCategories: [], activeIds: []
        };
        const r = C.scanConflicts(part);
        const t = typesOf(r);
        assert.ok(t.indexOf('DUP_OUTFIT_ID') !== -1);
        assert.ok(t.indexOf('NO_OUTFIT_ID') !== -1);
        assert.ok(t.indexOf('DUP_ACC_ID') !== -1);
        assert.equal(r.bySeverity.high, 3);
        // fixable 不包含需要人工判断的两类
        assert.equal(r.fixable, 0, 'id 重复/缺失都不能自动修，fixable 应为 0');

        const before = clone(part);
        C.repairConflicts(part);
        assert.deepEqual(plain(part.outfits), before.outfits, '不能自动删重复 id 的穿搭');
        assert.deepEqual(plain(part.accessories), before.accessories);
    }

    // ── 9. scanConflicts 绝不修改入参 ────────────────────
    {
        const part = {
            outfits: [{ id: 'o1', name: 'A', category: '孤儿', kits: [{ id: 'k', accIds: ['dead'] }] }],
            accessories: [],
            categories: [], accCategories: [], activeIds: ['gone']
        };
        const snapshot = clone(part);
        C.scanConflicts(part);
        assert.deepEqual(plain(part), snapshot, '扫描必须是只读的');
    }

    // ── 10. 空 / 残缺数据不炸 ────────────────────────────
    {
        for (const bad of [null, undefined, {}, { outfits: null }, { outfits: [null, undefined] }]) {
            const r = C.scanConflicts(bad);
            assert.equal(typeof r.total, 'number');
        }
        assert.equal(C.repairConflicts(null).changed, 0);
        assert.equal(C.repairConflicts({}).changed, 0);
    }

    // ── 11. 一次修完多种问题，报告总数正确 ───────────────
    {
        const part = {
            outfits: [{
                id: 'o1', name: '混合问题', category: '野分类',
                kits: [
                    { id: 'k1', accIds: ['a1', 'dead', 'a1'], disabledAccIds: ['dead'] },
                    { id: 'k2', accIds: [] }
                ]
            }],
            accessories: [{ id: 'a1' }],
            categories: [], accCategories: [],
            activeIds: ['o1', 'nope']
        };
        const r = C.scanConflicts(part);
        assert.ok(r.total >= 4, '应该报出多种问题，实际 ' + r.total);
        const fixed = C.repairConflicts(part);
        assert.ok(fixed.changed > 0);
        assert.equal(C.scanConflicts(part).total, 0, '一次修完应该全清，剩余: ' +
            JSON.stringify(typesOf(C.scanConflicts(part))));
        assert.ok(fixed.actions.length > 0, '要给出人能看懂的动作说明');
    }

    console.log('conflicts: pass (断链 / 重复 / 空套装 / 孤儿分类 / id 异常 / 只读保证)');
}

run().catch((e) => { console.error(e); process.exit(1); });
