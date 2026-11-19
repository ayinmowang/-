
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const COMMERCE_TS_PATH = path.join(ROOT_DIR, 'lib', 'commerce.ts');

function loadPureCommerceFunctions() {
  const source = fs.readFileSync(COMMERCE_TS_PATH, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: COMMERCE_TS_PATH,
  });

  const moduleObj = { exports: {} };
  const sandbox = {
    module: moduleObj,
    exports: moduleObj.exports,
    require(specifier) {
      if (
        specifier === './store' ||
        specifier.endsWith('/store') ||
        specifier === './server' ||
        specifier.endsWith('/server')
      ) {
        return {
          getStore() {
            throw new Error('Isolated migration test must not call getStore() or touch .data');
          },
          flushPersistentStore() {
            throw new Error('Isolated migration test must not call flushPersistentStore() or touch .data');
          },
        };
      }
      if (specifier === './types' || specifier.endsWith('/types')) {
        return {};
      }
      throw new Error(`Unexpected import in pure migration test: ${specifier}`);
    },    console,
    Date,
    Math,
    JSON,
    Array,
    Object,
    String,
    Number,
    Boolean,
  };

  vm.runInNewContext(transpiled.outputText, sandbox, { filename: 'commerce.isolated.cjs' });
  return moduleObj.exports;
}

const { applyCommerceMigration } = loadPureCommerceFunctions();
assert.equal(typeof applyCommerceMigration, 'function', 'applyCommerceMigration must be exported');

// Case 1: Legacy store missing plans, subscriptions, and orders
{
  const legacyStore = {
    accounts: [
      { id: 'acc_admin', role: 'admin', budgetCapUsd: 500 },
      { id: 'acc_creator_1', role: 'creator', budgetCapUsd: 25.5 },
    ],
    budgetCapUsd: 525.5,
    systemConfig: {
      defaultCreatorBudgetUsd: 20,
      allowPublicSignup: false,
    },
  };

  const fixedIso = '2026-05-01T00:00:00.000Z';
  const changed = applyCommerceMigration(legacyStore, fixedIso);

  assert.equal(changed, true, 'Missing commerce arrays should report changed=true');
  assert.equal(Array.isArray(legacyStore.plans), true, 'plans must be initialized as array');
  assert.equal(legacyStore.plans.length > 0, true, 'missing plans must seed default plans');
  assert.ok(Array.isArray(legacyStore.subscriptions) && legacyStore.subscriptions.length === 0, 'missing subscriptions must initialize to empty array');
  assert.ok(Array.isArray(legacyStore.orders) && legacyStore.orders.length === 0, 'missing orders must initialize to empty array');

  // Preserve existing account budgets and systemConfig
  assert.equal(legacyStore.budgetCapUsd, 525.5);
  assert.equal(legacyStore.accounts.length, 2);
  assert.equal(legacyStore.accounts[0].budgetCapUsd, 500);
  assert.equal(legacyStore.accounts[1].budgetCapUsd, 25.5);
  assert.deepEqual(legacyStore.systemConfig, {
    defaultCreatorBudgetUsd: 20,
    allowPublicSignup: false,
  });

  // Second run on migrated store must be idempotent
  const changedAgain = applyCommerceMigration(legacyStore, fixedIso);
  assert.equal(changedAgain, false, 'Re-running migration on complete store must return false');
}

// Case 2: Empty plans array [] seeds defaults while keeping existing subscriptions/orders
{
  const emptyPlansStore = {
    accounts: [{ id: 'acc_creator_2', role: 'creator', budgetCapUsd: 40 }],
    budgetCapUsd: 40,
    systemConfig: { mode: 'strict' },
    plans: [],
    subscriptions: [{ id: 'sub_existing', accountId: 'acc_creator_2', renewEnabled: true }],
    orders: [{ id: 'ord_existing', accountId: 'acc_creator_2', status: 'paid' }],
  };

  const changed = applyCommerceMigration(emptyPlansStore, '2026-05-01T00:00:00.000Z');
  assert.equal(changed, true, 'Empty plans array should trigger seed and return true');
  assert.equal(emptyPlansStore.plans.length > 0, true, 'Empty plans array must be seeded');
  assert.equal(emptyPlansStore.subscriptions.length, 1, 'Existing subscriptions must be preserved');
  assert.equal(emptyPlansStore.orders.length, 1, 'Existing orders must be preserved');
  assert.equal(emptyPlansStore.accounts[0].budgetCapUsd, 40, 'Account budgetCapUsd must remain intact');
}

// Case 3: Non-empty custom plans must NOT be overwritten
{
  const customPlan = {
    id: 'plan_custom_vip',
    name: '定制墨香年卡',
    priceUsd: 99,
    creditUsd: 120,
    enabled: true,
  };
  const customStore = {
    accounts: [{ id: 'acc_creator_3', role: 'creator', budgetCapUsd: 120 }],
    budgetCapUsd: 120,
    systemConfig: { region: 'cn' },
    plans: [customPlan],
  };

  const changed = applyCommerceMigration(customStore, '2026-05-01T00:00:00.000Z');
  assert.equal(changed, true, 'Missing subscriptions/orders should return true');
  assert.equal(customStore.plans.length, 1, 'Existing non-empty plans must not be overwritten');
  assert.deepEqual(customStore.plans[0], customPlan, 'Existing custom plan content must stay identical');
  assert.equal(Array.isArray(customStore.subscriptions), true);
  assert.equal(customStore.subscriptions.length, 0);
  assert.equal(Array.isArray(customStore.orders), true);
  assert.equal(customStore.orders.length, 0);

  assert.equal(customStore.accounts[0].budgetCapUsd, 120);
  assert.equal(customStore.budgetCapUsd, 120);
  assert.deepEqual(customStore.systemConfig, { region: 'cn' });
}

console.log('commerce-migration tests passed');

