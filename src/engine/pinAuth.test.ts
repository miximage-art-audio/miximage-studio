import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sha256Hex, verifyPin } from './pinAuth';

test('sha256Hex produces standard NIST SHA-256 vectors', () => {
  assert.equal(
    sha256Hex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  );
  assert.equal(
    sha256Hex(''),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  );
});

test('verifyPin accepts valid 6-digit PIN and rejects invalid or partial inputs', () => {
  assert.equal(verifyPin('144990'), true);
  assert.equal(verifyPin('000000'), false);
  assert.equal(verifyPin('123456'), false);
  assert.equal(verifyPin('144991'), false);
  assert.equal(verifyPin('14499'), false);
  assert.equal(verifyPin('1449901'), false);
  assert.equal(verifyPin('14499a'), false);
  assert.equal(verifyPin(''), false);
});

test('PinLoginGate component does not expose the PIN or include auto-fill buttons', () => {
  const gateSrc = fs.readFileSync(
    path.resolve(import.meta.dirname, '../components/PinLoginGate.tsx'),
    'utf8'
  );
  assert.doesNotMatch(gateSrc, /144990/);
  assert.doesNotMatch(gateSrc, /autoFill|demoPin|กรอกอัตโนมัติ/i);
});
