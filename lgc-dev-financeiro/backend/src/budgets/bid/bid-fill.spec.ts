import JSZip from 'jszip';
import { bidFilename, fillBid } from './bid-fill.js';
import { excelDate, XlsxEditor } from './xlsx-editor.js';
import type { BidPlan } from './bid-plan.js';

/** Planilha mínima no formato do Bid Template (fictícia): Summary com nomes, Item Selection e Bid KPIs. */
async function template(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types><Override PartName="/xl/calcChain.xml" ContentType="x"/></Types>');
  zip.file(
    'xl/workbook.xml',
    `<workbook xmlns:r="r"><sheets><sheet name="Summary" sheetId="1" r:id="rId1"/><sheet name="Item Selection" sheetId="2" r:id="rId2"/><sheet name="Bid KPIs" sheetId="3" r:id="rId3"/></sheets>
     <definedNames>
       <definedName name="rngSummaryVendorName">Summary!$B$12</definedName><definedName name="rngSummaryBidPOC">Summary!$B$13</definedName>
       <definedName name="rngSummaryBidEmail">Summary!$B$14</definedName><definedName name="rngSummaryVendorProposalName">Summary!$B$15</definedName>
       <definedName name="rngSummaryProjectCompletionDate">Summary!$B$16</definedName><definedName name="rngSummaryProjectStartDate">Summary!$E$16</definedName>
       <definedName name="rngSummarySubmissionDate">Summary!$B$17</definedName><definedName name="rngMfgQuotedLeadTime">Summary!$E$20</definedName>
       <definedName name="rngSummaryFBN">Summary!$B$28</definedName><definedName name="rngSummarySite">Summary!$B$34</definedName>
     </definedNames><calcPr calcId="1"/></workbook>`,
  );
  zip.file(
    'xl/_rels/workbook.xml.rels',
    `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Target="worksheets/sheet3.xml"/><Relationship Id="rId9" Type="calc" Target="calcChain.xml"/></Relationships>`,
  );
  zip.file('xl/calcChain.xml', '<calcChain/>');
  zip.file('xl/vbaProject.bin', Buffer.from([1, 2, 3, 4]));
  zip.file(
    'xl/worksheets/sheet1.xml',
    `<worksheet><sheetData>
      <row r="12"><c r="B12" s="5"/></row><row r="13"><c r="B13" s="5"/></row><row r="14"><c r="B14" s="5"/></row><row r="15"><c r="B15" s="5"/></row>
      <row r="16"><c r="B16" s="6"/><c r="E16" s="6"/></row><row r="17"><c r="B17" s="6"/></row><row r="20"><c r="E20"/></row>
      <row r="28"><c r="B28" t="inlineStr"><is><t>XX00TEST</t></is></c></row><row r="34"><c r="B34" t="inlineStr"><is><t>TST1</t></is></c></row>
    </sheetData></worksheet>`,
  );
  const row = (r: number, code: string, d: string, extra = '') =>
    `<row r="${r}"><c r="A${r}" t="inlineStr"><is><t>Item ${r}</t></is></c><c r="C${r}" t="inlineStr"><is><t>${code}</t></is></c>${d}<c r="G${r}" s="9"/><c r="S${r}" s="92" t="str"><f>O${r}</f><v/></c><c r="T${r}"/>${extra}<c r="Z${r}" t="inlineStr"><is><t>Fiber</t></is></c></row>`;
  zip.file(
    'xl/worksheets/sheet2.xml',
    `<worksheet><sheetData>
      ${row(10, 'CAB-1', '<c r="D10" t="inlineStr"><is><t>Select</t></is></c>')}
      ${row(11, 'CAB-1', '<c r="D11" t="inlineStr"><is><t>AFL</t></is></c>')}
      ${row(12, 'CAB-2', '<c r="D12" t="inlineStr"><is><t>Select</t></is></c>')}
      <row r="20"><c r="C20" t="inlineStr"><is><t>T-H-S</t></is></c><c r="D20" t="str"><f>IF(rngSummaryVendorName="","",rngSummaryVendorName)</f><v></v></c><c r="J20"/><c r="M20"/><c r="Z20" t="inlineStr"><is><t>Labor</t></is></c></row>
      <row r="21"><c r="C21" t="inlineStr"><is><t>FORMULA-ROW</t></is></c><c r="J21"><f>1+1</f><v>2</v></c></row>
    </sheetData></worksheet>`,
  );
  zip.file(
    'xl/worksheets/sheet3.xml',
    `<worksheet><sheetData><row r="17"><c r="A17" t="inlineStr"><is><t>Labor Cost per Port</t></is></c><c r="F17" t="inlineStr"><is><t>Select</t></is></c></row></sheetData></worksheet>`,
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

const plan = (lines: BidPlan['lines']): BidPlan => ({
  header: { vendorName: 'LGC', pocName: 'Contato', pocEmail: 'c@lgc.test', proposalName: 'PROP-1', start: '2030-02-01', end: '2030-02-08', submissionDate: '2030-01-15', leadTimeDays: 0 },
  lines,
  kpiYes: ['Labor Cost per Port'],
});

describe('fillBid', () => {
  it('preenche cabeçalho, linhas e Bid KPIs; escolhe a linha com fornecedor; preserva VBA; recalcula ao abrir', async () => {
    const out = await fillBid(
      await template(),
      plan([
        { code: 'CAB-1', label: 'Cabos', cells: { G: 33, S: 44, T: 67, U: 'comment' } },
        { code: 'T-H-S', label: 'Técnico', cells: { J: 80, M: 144 } },
      ]),
      2,
    );
    expect(out.filename).toBe('2030-01-15_BID_XX00TEST_TST1_v2.xlsm');
    const back = await XlsxEditor.load(out.content);
    expect(await back.value('Summary', 'B12')).toBe('LGC');
    expect(await back.value('Summary', 'B15')).toBe('PROP-1');
    expect(await back.value('Summary', 'B16')).toBe(String(excelDate('2030-02-08')));
    expect(await back.value('Item Selection', 'S11')).toBe('44'); // linha com AFL, não a "Select"
    expect(await back.cell('Item Selection', 'S11')).toEqual({ v: '44', f: null });
    expect(await back.value('Item Selection', 'S10')).not.toBe('44');
    expect(await back.value('Item Selection', 'U11')).toBe('comment'); // célula criada na ordem
    expect(await back.value('Item Selection', 'M20')).toBe('144');
    expect(await back.value('Bid KPIs', 'F17')).toBe('Yes');

    const zip = await JSZip.loadAsync(out.content);
    expect(await zip.file('xl/vbaProject.bin')!.async('nodebuffer')).toEqual(Buffer.from([1, 2, 3, 4]));
    expect(zip.file('xl/calcChain.xml')).toBeNull();
    expect(await zip.file('xl/_rels/workbook.xml.rels')!.async('string')).not.toContain('calcChain');
    expect(await zip.file('xl/workbook.xml')!.async('string')).toContain('fullCalcOnLoad="1"');
    expect(await zip.file('xl/worksheets/sheet1.xml')!.async('string')).toContain('<c r="B12" s="5" t="inlineStr">');
    expect(out.writes).toContainEqual({ sheet: 'Item Selection', ref: 'S11', value: 44 });
  });

  it('linha em "Select" recebe o fornecedor do perfil; sem ele, pede para informar', async () => {
    const ok = await fillBid(await template(), plan([{ code: 'CAB-2', label: 'Cabos', cells: { S: 1 }, supplier: 'AFL' }]), 1);
    expect(await (await XlsxEditor.load(ok.content)).value('Item Selection', 'D12')).toBe('AFL');
    await expect(fillBid(await template(), plan([{ code: 'CAB-2', label: 'Cabos', cells: { S: 1 } }]), 1)).rejects.toThrow('pede o fornecedor');
  });

  it('não escreve em fórmula fora da coluna S nem em linha inexistente', async () => {
    await expect(fillBid(await template(), plan([{ code: 'FORMULA-ROW', label: 'x', cells: { J: 5 } }]), 1)).rejects.toThrow('tem fórmula');
    await expect(fillBid(await template(), plan([{ code: 'NAO-EXISTE', label: 'x', cells: { J: 5 } }]), 1)).rejects.toThrow('não existe neste Bid Template');
  });

  it('nome do arquivo e datas do Excel', () => {
    expect(bidFilename('2030-01-15', null, null, 3, 'PROP-1')).toBe('2030-01-15_BID_PROP-1_v3.xlsm');
    expect(excelDate('1900-03-01')).toBe(61);
    expect(excelDate('2026-12-11')).toBe(46367);
  });
});
