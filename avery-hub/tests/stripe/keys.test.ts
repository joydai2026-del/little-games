import { describe, expect, it } from 'vitest';
import { cancelKey, checkoutKey, customerKey, refundKey } from '../../src/stripe/keys';

describe('outgoing idempotency keys', () => {
  it('match the plan formats', () => {
    expect(customerKey('t_123')).toBe('customer:t_123');
    expect(checkoutKey('t_123', 4)).toBe('checkout:t_123:4');
    expect(refundKey('ch_9', 'op_1')).toBe('refund:ch_9:op_1');
    expect(cancelKey('sub_7', 'refund', 'op_1')).toBe('cancel:sub_7:refund:op_1');
  });

  it('are stable: same input, same key (so a retry reuses it)', () => {
    expect(checkoutKey('t_1', 2)).toBe(checkoutKey('t_1', 2));
    expect(refundKey('ch_1', 'op_a')).toBe(refundKey('ch_1', 'op_a'));
  });

  it('are unique across inputs and across kinds', () => {
    const keys = [
      customerKey('t_1'), customerKey('t_2'),
      checkoutKey('t_1', 0), checkoutKey('t_1', 1), checkoutKey('t_2', 0),
      refundKey('ch_1', 'op_1'), refundKey('ch_1', 'op_2'), refundKey('ch_2', 'op_1'),
      cancelKey('sub_1', 'refund', 'op_1'), cancelKey('sub_1', 'dispute_lost', 'op_1'), cancelKey('sub_1', 'refund', 'op_2'),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('refuse parts that could collide or are empty', () => {
    expect(() => customerKey('')).toThrow();
    expect(() => customerKey('a:b')).toThrow();
    expect(() => refundKey('ch_1', 'op 1')).toThrow();
    expect(() => checkoutKey('t_1', -1)).toThrow();
    expect(() => checkoutKey('t_1', 1.5)).toThrow();
    expect(() => customerKey('x'.repeat(300))).toThrow(/255/);
  });
});
