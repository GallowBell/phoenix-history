import { describe, it, expect } from 'vitest';
import {
  parseProductName,
  collectFacets,
  matchesFacets,
  seriesKey,
  GOODS_SERIES,
  NONE,
} from './product-name.js';

// Every string below is copied verbatim from tests/fixtures or orders-details.json —
// the parse is positional, so invented examples would not prove much.

describe('parseProductName', () => {
  it('splits a fully decorated name into its parts', () => {
    const p = parseProductName('(PRE/MAY)(LN) Complete Set หนุ่มซิงกับสาวฮ็อต เดตนี้จะรอดมั้ยนะ เล่ม 10 (ฉบับจบ)');
    expect(p.preorder).toBe(true);
    expect(p.preorderMonth).toBe('MAY');
    expect(p.kind).toBe('LN');
    expect(p.set).toBe('Complete Set');
    expect(p.series).toBe('หนุ่มซิงกับสาวฮ็อต เดตนี้จะรอดมั้ยนะ');
    expect(p.volume).toBe(10);
    expect(p.note).toBe('(ฉบับจบ)');
  });

  it('reads a bare name with no decoration at all', () => {
    const p = parseProductName('(LN) หนุ่มซิงกับสาวฮ็อต เดตนี้จะรอดมั้ยนะ เล่ม 9');
    expect(p).toMatchObject({
      kind: 'LN', set: null, preorder: false, preorderMonth: null, volume: 9,
    });
    expect(p.series).toBe('หนุ่มซิงกับสาวฮ็อต เดตนี้จะรอดมั้ยนะ');
  });

  it('recognises manga and art book tags', () => {
    expect(parseProductName('(MG) ขอต้อนรับสู่ห้องเรียนนิยม (เฉพาะ) ยอดคน เล่ม 12').kind).toBe('MG');
    expect(parseProductName('(PRE/AUG)(AB) Complete Set คุณอาเรีย หนังสือรวมภาพ').kind).toBe('AB');
  });

  it('accepts every spelling of the pre-order tag', () => {
    for (const tag of ['(PRE)', '(Pre)', '(Pre-Order)']) {
      const p = parseProductName(`${tag} (LN) Complete Set แง้มหัวใจยัยน้องสาวจำเป็น เล่ม 2`);
      expect(p.preorder).toBe(true);
      expect(p.kind).toBe('LN');
      expect(p.series).toBe('แง้มหัวใจยัยน้องสาวจำเป็น');
    }
  });

  it('keeps a non-latin pre-order round as the month', () => {
    expect(parseProductName('(PRE/รอบพิเศษ)(LN) Complete Set ก เล่ม 1').preorderMonth).toBe('รอบพิเศษ');
  });

  it('parses decimal volumes', () => {
    expect(parseProductName('(PRE/FEB)(LN) Complete Set ขอต้อนรับ ปี 2 เล่ม 12.5').volume).toBe(12.5);
  });

  it('takes the last volume marker, so a per-volume subtitle is not the series', () => {
    const p = parseProductName('(LN) ใครว่าข้าไม่เหมาะเป็นจอมมาร เล่ม 1 จอมมารผู้ไม่ยอมให้เคลียร์เกม');
    expect(p.volume).toBe(1);
    expect(p.series).toBe('ใครว่าข้าไม่เหมาะเป็นจอมมาร');
    expect(p.note).toBe('จอมมารผู้ไม่ยอมให้เคลียร์เกม');
  });

  it('drops a bracketed freebie from the series', () => {
    const p = parseProductName('(PRE/JAN)(LN) ผมเนี่ยนะ...ชายแปด! เล่ม 21 [แถมฟรี! Postcard]');
    expect(p.series).toBe('ผมเนี่ยนะ...ชายแปด!');
    expect(p.note).toBe('[แถมฟรี! Postcard]');
  });

  it('strips the edition letter the site appends to a set name', () => {
    const p = parseProductName('(PRE/FEB)(LN) Special Set B สาบานรักราชันจอมเวท เล่ม 4');
    expect(p.set).toBe('Special Set');
    expect(p.series).toBe('สาบานรักราชันจอมเวท');
  });

  it('drops a type tag the site repeated as a bare word', () => {
    const p = parseProductName('(LN) Special Set ขอต้อนรับสู่ห้องเรียนนิยม (เฉพาะ) ยอดคน LN เล่ม 7.5');
    expect(p.series).toBe('ขอต้อนรับสู่ห้องเรียนนิยม (เฉพาะ) ยอดคน');
  });

  it('matches the longest set name, not a suffix of it', () => {
    expect(parseProductName('(PRE/MAY)(LN) Short Story Set ผมเนี่ยนะ...ชายแปด! เล่ม 22').set)
      .toBe('Short Story Set');
    expect(parseProductName('(PRE/NOV)(LN) Collection Box Set เกมรักศักดิ์ศรีบุตรีดยุก เล่ม 8').set)
      .toBe('Collection Box Set');
  });

  it('does not read a set out of merchandise that merely contains "Set"', () => {
    const p = parseProductName('ครบ 1,000 บาท - Mini Clear Bookmark Set 4 ลาย (BF0922)');
    expect(p.set).toBe(null);
  });

  it('buckets giveaways under one series instead of one per promo line', () => {
    for (const name of [
      'Free Gift - BokuYaba the Movie Free Postcard',
      'ครบ 1,800 บาท - PHOENIX Calendar 2024',
      '(จัดส่งปลายเดือนมีนาคม) ครบ 1,800 บาท - Isekai de Cheat (BF0322)',
    ]) {
      const p = parseProductName(name);
      expect(p.isFreebie).toBe(true);
      expect(p.kind).toBe('GOODS');
      expect(p.series).toBe(GOODS_SERIES);
    }
  });

  it('leaves an unrecognised leading tag in place rather than eating title text', () => {
    const p = parseProductName('(เฉพาะ) ยอดคน เล่ม 3');
    expect(p.series).toBe('(เฉพาะ) ยอดคน');
  });

  it('survives a missing or empty name', () => {
    for (const bad of [undefined, null, '']) {
      const p = parseProductName(bad);
      expect(p.series).toBe('');
      expect(p.volume).toBe(null);
    }
  });
});

describe('seriesKey', () => {
  it('folds the spellings the site uses for one series', () => {
    const same = (a, b) => expect(seriesKey(a)).toBe(seriesKey(b));
    same('แมจิคัล★เอกซ์พลอเรอร์', 'แมจิคัล☆เอกซ์พลอเรอร์');
    same('86 ―เอทตี้ซิกซ์―', '86 -เอทตี้ซิกซ์-');
    same('คุณอาเรียโต๊ะข้างๆพูดรัสเซีย', 'คุณอาเรียโต๊ะข้างๆ พูดรัสเซีย');
    same('ผมเนี่ยนะ...ชายแปด!', 'ผมเนี่ยนะ...ชายแปด');
    same('ขอต้อนรับ ยอดคน ปีสอง', 'ขอต้อนรับ ยอดคน ปี 2');
  });

  it('keeps genuinely different series apart', () => {
    expect(seriesKey('ขอต้อนรับ ยอดคน ปี 2')).not.toBe(seriesKey('ขอต้อนรับ ยอดคน ปี 3'));
  });
});

const details = [
  { items: [
    { name: '(PRE/MAY)(LN) Complete Set แง้มหัวใจยัยน้องสาวจำเป็น เล่ม 10' },
    { name: '(LN) แง้มหัวใจยัยน้องสาวจำเป็น เล่ม 9' },
  ] },
  { items: [
    { name: '(MG) ขอต้อนรับสู่ห้องเรียนนิยม (เฉพาะ) ยอดคน เล่ม 12' },
    { name: 'Free Gift - BokuYaba the Movie Free Postcard' },
  ] },
];

describe('collectFacets', () => {
  it('counts each facet across every item', () => {
    const f = collectFacets(details);
    expect(f.series.map((s) => s.label)).toEqual([
      'แง้มหัวใจยัยน้องสาวจำเป็น',
      'ขอต้อนรับสู่ห้องเรียนนิยม (เฉพาะ) ยอดคน',
      GOODS_SERIES,
    ]);
    expect(f.series[0].count).toBe(2);
    expect(f.kinds).toEqual([
      { value: 'LN', label: 'Light Novel', count: 2 },
      { value: 'MG', label: 'Manga', count: 1 },
      { value: 'GOODS', label: 'Free gift / goods', count: 1 },
    ]);
    expect(f.sets.map((s) => s.value)).toEqual(['Complete Set', NONE]);
  });

  it('pins giveaways last however common they are', () => {
    const f = collectFacets([{ items: Array(9).fill({ name: 'Free Gift - x' }) }, ...details]);
    expect(f.series.at(-1).label).toBe(GOODS_SERIES);
  });

  it('labels a merged group with its most common spelling', () => {
    const f = collectFacets([{ items: [
      { name: '(LN) แมจิคัล★เอกซ์พลอเรอร์ เล่ม 1' },
      { name: '(LN) แมจิคัล★เอกซ์พลอเรอร์ เล่ม 2' },
      { name: '(LN) แมจิคัล☆เอกซ์พลอเรอร์ เล่ม 3' },
    ] }]);
    expect(f.series).toHaveLength(1);
    expect(f.series[0]).toMatchObject({ label: 'แมจิคัล★เอกซ์พลอเรอร์', count: 3 });
  });

  it('handles records with no items and a missing list', () => {
    expect(collectFacets([{ items: [] }, {}, null]).series).toEqual([]);
    expect(collectFacets(undefined).kinds).toEqual([]);
  });
});

describe('matchesFacets', () => {
  const p = parseProductName('(PRE/MAY)(LN) Complete Set แง้มหัวใจยัยน้องสาวจำเป็น เล่ม 10');

  it('passes everything when no facet is selected', () => {
    expect(matchesFacets(p, {})).toBe(true);
    expect(matchesFacets(p, { series: '', kind: '', set: '' })).toBe(true);
  });

  it('requires every selected facet to match', () => {
    expect(matchesFacets(p, { kind: 'LN', set: 'Complete Set' })).toBe(true);
    expect(matchesFacets(p, { kind: 'LN', set: 'Special Set' })).toBe(false);
    expect(matchesFacets(p, { series: p.key })).toBe(true);
    expect(matchesFacets(p, { series: 'other' })).toBe(false);
  });

  it('matches an absent facet through the NONE sentinel', () => {
    const plain = parseProductName('(LN) แง้มหัวใจยัยน้องสาวจำเป็น เล่ม 9');
    expect(matchesFacets(plain, { set: NONE })).toBe(true);
    expect(matchesFacets(p, { set: NONE })).toBe(false);
    expect(matchesFacets(parseProductName('(PRE) ผมเนี่ยนะ เล่ม 16'), { kind: NONE })).toBe(true);
  });
});
