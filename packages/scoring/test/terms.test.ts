import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {extractTerms, stripPhoneNumbers} from '../src/index.js';

describe('stripPhoneNumbers', () => {
  it('redacts a parenthesized area code format', () => {
    assert.equal(stripPhoneNumbers('Call me at (555) 123-4567 anytime'), 'Call me at   anytime');
  });

  it('redacts a dash-separated format', () => {
    assert.equal(stripPhoneNumbers('Phone: 555-123-4567'), 'Phone:  ');
  });

  it('redacts a dot-separated format with a country code', () => {
    assert.equal(stripPhoneNumbers('+1 555.123.4567'), ' ');
  });

  it('redacts a plain 10-digit run', () => {
    assert.equal(stripPhoneNumbers('5551234567'), ' ');
  });

  it('redacts a space-separated format', () => {
    assert.equal(stripPhoneNumbers('555 123 4567'), ' ');
  });

  it('leaves unrelated text and shorter digit runs untouched', () => {
    assert.equal(stripPhoneNumbers('5 years of experience, since 2019'), '5 years of experience, since 2019');
  });

  it('leaves non-phone-shaped longer numbers untouched', () => {
    // 9-digit SSN-like run: doesn't match the 3-3-4 phone shape.
    assert.equal(stripPhoneNumbers('SSN 123456789'), 'SSN 123456789');
  });

  it('is a no-op on text with no phone number', () => {
    const text = 'Senior Engineer with 10 years of TypeScript experience';
    assert.equal(stripPhoneNumbers(text), text);
  });

  it('keeps extractTerms from ever seeing a phone number, redacted or not', () => {
    const text = 'Contact John Doe at (555) 123-4567 for references';
    const terms = extractTerms(stripPhoneNumbers(text));
    assert.ok(!terms.some(t => /\d/.test(t)), `expected no digit-containing terms, got: ${terms.join(', ')}`);
  });

  it('demonstrates extractTerms alone would leak a dashed phone number', () => {
    // Regression guard: extractTerms only drops pure-digit tokens, so a
    // dash-separated phone number survives unless stripped beforehand.
    const terms = extractTerms('555-123-4567');
    assert.ok(terms.includes('555-123-4567'));
  });
});
