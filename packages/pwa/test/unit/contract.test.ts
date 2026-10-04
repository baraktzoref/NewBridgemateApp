import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidContractText, isValidDeclarerAndTricks, normalizeContractText } from "../../public/js/contract.js";

test("isValidContractText accepts well-formed contracts", () => {
  for (const c of ["1C", "4S", "3NT", "3NTX", "7NTXX", "1d", "2hx", "7ntxx"]) {
    assert.equal(isValidContractText(c), true, c);
  }
});

test("isValidContractText rejects malformed contracts", () => {
  for (const c of ["", "8S", "0C", "4W", "4SXXX", "NT", "4", "4XYZ", "4S X"]) {
    assert.equal(isValidContractText(c), false, c);
  }
});

test("isValidContractText tolerates surrounding whitespace", () => {
  assert.equal(isValidContractText("  4S  "), true);
});

test("normalizeContractText upcases and trims", () => {
  assert.equal(normalizeContractText(" 3nt "), "3NT");
  assert.equal(normalizeContractText("4sx"), "4SX");
});

test("isValidDeclarerAndTricks validates seat and trick range", () => {
  assert.equal(isValidDeclarerAndTricks("N", 7), true);
  assert.equal(isValidDeclarerAndTricks("N", 0), true);
  assert.equal(isValidDeclarerAndTricks("N", 13), true);
  assert.equal(isValidDeclarerAndTricks("Q", 7), false);
  assert.equal(isValidDeclarerAndTricks("N", -1), false);
  assert.equal(isValidDeclarerAndTricks("N", 14), false);
  assert.equal(isValidDeclarerAndTricks("N", 7.5), false);
});
