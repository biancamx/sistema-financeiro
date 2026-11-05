import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Card, normalizeCardBrand } from '../src/models/Card.js';
import { cardBrandSchema } from '../src/modules/cards/cards.routes.js';

test('normaliza bandeiras de cartão independentemente de caixa e alias', () => {
  const cases = [
    ['visa', 'Visa'],
    ['MASTERCard', 'Mastercard'],
    ['elo', 'Elo'],
    ['american express', 'American Express'],
    ['AMEX', 'American Express'],
    ['outro', 'Outro'],
    ['bandeira desconhecida', 'Outro'],
    ['', 'Outro'],
    [null, 'Outro'],
  ];

  for (const [input, expected] of cases) {
    assert.equal(normalizeCardBrand(input), expected);
    assert.equal(new Card({ brand: input }).brand, expected);
    assert.equal(cardBrandSchema.parse(input), expected);
  }
});

test('cartão criado sem bandeira usa Outro', () => {
  assert.equal(new Card().brand, 'Outro');
});
