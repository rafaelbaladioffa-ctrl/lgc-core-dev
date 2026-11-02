import { describe, expect, it } from 'vitest';
import { addBusinessMinutes, businessSecondsBetween } from './business-calendar.js';
describe('IANA calendar and exact business seconds',()=>{
 it('matches the documented Friday, weekend and holiday vectors',()=>{
  const holiday=['2026-11-09'];
  expect(addBusinessMinutes(new Date('2026-11-06T20:30:00Z'),120,holiday).toISOString()).toBe('2026-11-10T12:30:00.000Z');
  expect(addBusinessMinutes(new Date('2026-11-06T22:00:00Z'),60,holiday).toISOString()).toBe('2026-11-10T12:00:00.000Z');
  expect(businessSecondsBetween(new Date('2026-11-06T20:00:00Z'),new Date('2026-11-10T12:00:00Z'),holiday)).toBe(7200);
 });
 it('crosses a closing boundary and holiday preserving seconds',()=>{expect(addBusinessMinutes(new Date('2026-11-06T20:59:45Z'),1).toISOString()).toBe('2026-11-09T11:00:45.000Z');expect(addBusinessMinutes(new Date('2026-11-06T20:59:45Z'),1,['2026-11-09']).toISOString()).toBe('2026-11-10T11:00:45.000Z');});
 it('uses historical IANA offsets instead of a fixed UTC window',()=>{expect(addBusinessMinutes(new Date('2018-11-05T10:00:00Z'),60).toISOString()).toBe('2018-11-05T11:00:00.000Z');expect(businessSecondsBetween(new Date('2018-11-05T10:00:00Z'),new Date('2018-11-05T11:00:00Z'))).toBe(3600);});
 it('uses the selected timezone independently of host timezone',()=>{expect(addBusinessMinutes(new Date('2026-11-02T08:00:00Z'),60,[],'UTC').toISOString()).toBe('2026-11-02T09:00:00.000Z');expect(businessSecondsBetween(new Date('2026-11-06T20:59:45Z'),new Date('2026-11-09T11:00:45Z'))).toBe(60);});
});
