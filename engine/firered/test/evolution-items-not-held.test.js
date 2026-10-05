import test from 'node:test';
import assert from 'node:assert/strict';
import rules from '../src/suite/fire-red-evolution-rules.json' with {type:'json'};
import {heldItemEquipPriority} from '../src/player/advisors.js';

// Owner, 2026-10-04: "if its an evolution items then it shouldnt be reserved
// for holding". Every item an evolution consumes (trade-held items and stones,
// pokefirered evolution data) stays free for that evolution.
test('no evolution item has a held-item equip priority', () => {
 const items=new Set(rules.rules.flatMap(r=>[r.heldItem?.nativeId,r.item?.nativeId]).filter(Number.isInteger));
 for(const id of [187,192,193,199,201,218,93,94,95,96,97,98])assert.ok(items.has(id),`evolution data lists item ${id}`);
 for(const id of items)assert.equal(heldItemEquipPriority(id),null,`item ${id} is never equipped`);
 assert.equal(heldItemEquipPriority(200),100); // Leftovers
 assert.equal(heldItemEquipPriority(209),80);  // Mystic Water, a type booster
});
