'use strict';
// Scoring is the product — these lock its core behaviour so a tweak can't silently break tiering.
// Run with: npm test   (uses Node's built-in test runner, no extra deps)
const { test } = require('node:test');
const assert = require('node:assert');
const { score } = require('../src/score');
const { salaryCheck, classify } = require('../src/soc');
const { norm } = require('../src/register');
const { db } = require('../src/db');

// An employer string crafted not to hit the register, so register-independent logic is deterministic.
const NOEMP = 'Zxqv Nonexistent Qwerty Co';

test('negative phrase => excluded, confidence 0', () => {
  const j = score({ title: 'Data Analyst', employer: NOEMP, description: 'No sponsorship available for this role.' });
  assert.equal(j.tier, 'excluded');
  assert.equal(j.confidence, 0);
});

test('positive phrase + unmatched employer => B- and salary passes', () => {
  const j = score({ title: 'Data Analyst', employer: NOEMP, description: 'Visa sponsorship available.', salaryMin: 60000, salaryMax: 60000 });
  assert.equal(j.tier, 'B-');
  assert.equal(j.salary_status, 'pass');
  assert.ok(j.confidence >= 60, `confidence ${j.confidence} should be >= 60`);
});

test('salary below the floor downgrades confidence and flags fail', () => {
  const j = score({ title: 'Data Analyst', employer: NOEMP, description: 'Visa sponsorship available.', salaryMin: 25000, salaryMax: 26000 });
  assert.equal(j.salary_status, 'fail');
  assert.ok(j.confidence <= 20, `confidence ${j.confidence} should be capped at 20 on a salary fail`);
});

test('no signal + no register match => unknown', () => {
  const j = score({ title: 'Warehouse Operative', employer: NOEMP, description: 'Join our friendly team.' });
  assert.equal(j.tier, 'unknown');
});

test('SOC classification maps a data title', () => {
  assert.equal(classify('Senior Data Analyst').soc, '2433');
});

test('salary gate: pass / fail / borderline / unknown', () => {
  assert.equal(salaryCheck({ title: 'Data Analyst', salaryMin: 50000, salaryMax: 55000 }).status, 'pass');
  assert.equal(salaryCheck({ title: 'Data Analyst', salaryMin: 20000, salaryMax: 22000 }).status, 'fail');
  assert.equal(salaryCheck({ title: 'Data Analyst', salaryMin: 30000, salaryMax: 40000 }).status, 'borderline');
  assert.equal(salaryCheck({ title: 'Data Analyst' }).status, 'unknown');
});

test('register name normalisation collapses suffixes/case', () => {
  assert.equal(norm('Monzo Bank Ltd.'), norm('MONZO BANK LIMITED'));
  assert.ok(norm('A & B Co').includes('and'));
});

// Register-dependent check — only runs if the register has been loaded (npm run register:update).
const registerLoaded = db.prepare('SELECT COUNT(*) n FROM register').get().n > 0;
test('exact register match resolves a known sponsor', { skip: !registerLoaded }, () => {
  const j = score({ title: 'Analyst', employer: 'Cancer Research UK', description: '' });
  assert.equal(j.register_match, 'exact');
});
