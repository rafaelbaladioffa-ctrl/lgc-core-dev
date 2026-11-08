import JSZip from 'jszip';
import { DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS, parseThresholds, parseWeights, readBidTargets } from './bid-template-reader.js';

/** Planilha mínima no formato do Bid Template (valores fictícios; nada do modelo real do cliente). */
async function fixture({ cluster = 'TST', currency = 'BRL', withFormulas = true } = {}): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    'xl/workbook.xml',
    `<workbook xmlns:r="r"><sheets><sheet name="Summary" sheetId="1" r:id="rId1"/><sheet name="Bid KPIs" sheetId="2" r:id="rId2"/></sheets>
     <definedNames><definedName name="rngSummaryCluster">Summary!$B$35</definedName><definedName name="rngSummaryCurrency">Summary!$B$19</definedName><definedName name="rngSummaryVersion">Summary!$B$6</definedName></definedNames></workbook>`,
  );
  zip.file(
    'xl/_rels/workbook.xml.rels',
    `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>`,
  );
  zip.file('xl/sharedStrings.xml', `<sst><si><t>${cluster}</t></si><si><t>${currency}</t></si><si><t>OUT</t></si><si><t>USD</t></si></sst>`);
  zip.file(
    'xl/worksheets/sheet1.xml',
    `<worksheet><sheetData><row r="6"><c r="B6"><f>MAX(log[version])</f><v>9.1</v></c></row><row r="19"><c r="B19" t="s"><v>1</v></c></row><row r="35"><c r="B35" t="s"><v>0</v></c></row></sheetData></worksheet>`,
  );
  const formulas = withFormulas
    ? `<row r="15"><c r="E15"><f>IF(AND(D15&lt;-0.2,D15&lt;&gt;""),"Efficiency for this bid is &lt;80%","")</f></c></row>
       <row r="16"><c r="E16"><f>IF(AND(D16&gt;0.12),"CPP for this bid is &gt;12%","")</f></c></row>
       <row r="17"><c r="E17"><f>IF(AND(D17&gt;0.2),"LCPP for this bid is &gt;20%","")</f></c></row>
       <row r="18"><c r="E18"><f>IF(AND(D18&gt;0.3),"HPP for this bid is &gt;30%","")</f></c></row>
       <row r="19"><c r="E19"><f>IF(AND(D19&gt;0.3),"HPM for this bid is &gt;30%","")</f></c></row>
       <row r="27"><c r="L27"><f>IFERROR(0.5*(B8*C19)+0.5*(B6*C18)+2*(B10*C20),"")</f><v>0</v></c></row>`
    : '';
  zip.file(
    'xl/worksheets/sheet2.xml',
    `<worksheet><sheetData>
      <row r="1"><c r="M1" t="inlineStr"><is><t>Cluster_List</t></is></c><c r="W1" t="inlineStr"><is><t>Currency</t></is></c></row>
      <row r="2"><c r="M2" t="s"><v>2</v></c><c r="N2"><v>99</v></c><c r="O2"><v>9</v></c><c r="P2"><v>9</v></c><c r="Q2"><v>9</v></c><c r="R2"><v>9</v></c><c r="W2" t="s"><v>3</v></c><c r="X2"><v>1</v></c></row>
      <row r="3"><c r="M3" t="inlineStr"><is><t>TST</t></is></c><c r="N3"><v>40</v></c><c r="O3"><v>0.3</v></c><c r="P3"><v>0.03</v></c><c r="Q3"><v>10</v></c><c r="R3"><v>0.5</v></c><c r="W3" t="inlineStr"><is><t>BRL</t></is></c><c r="X3"><v>5</v></c></row>
      ${formulas}
    </sheetData></worksheet>`,
  );
  zip.file('xl/worksheets/_rels/sheet2.xml.rels', `<Relationships><Relationship Id="t1" Target="../tables/table2.xml"/><Relationship Id="t2" Target="../tables/table3.xml"/></Relationships>`);
  zip.file(
    'xl/tables/table2.xml',
    `<table name="Table8" displayName="Table8" ref="M1:R3"><tableColumns count="6"><tableColumn name="Cluster_List"/><tableColumn name="CPP_Target"/><tableColumn name="HPP_Target"/><tableColumn name="HPM_Target"/><tableColumn name="LCPP_Target"/><tableColumn name="HPD_Target"/></tableColumns></table>`,
  );
  zip.file('xl/tables/table3.xml', `<table name="Table12" displayName="Table12" ref="W1:X3"><tableColumns count="2"><tableColumn name="Currency"/><tableColumn name="FX"/></tableColumns></table>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('readBidTargets', () => {
  it('lê cluster, moeda, metas do cluster, câmbio, pesos e tolerâncias do próprio modelo', async () => {
    const r = await readBidTargets(await fixture());
    expect(r).toEqual({
      templateVersion: '9.1',
      cluster: 'TST',
      currency: 'BRL',
      fx: 5,
      targets: { costPerPortUsd: 40, hoursPerPort: 0.3, hoursPerMeter: 0.03, laborCostPerPortUsd: 10, hoursPerDevice: 0.5 },
      converted: { costPerPort: 200, laborCostPerPort: 50 },
      weights: { meters: 0.5, ports: 0.5, devices: 2 },
      thresholds: { efficiency: -0.2, costPerPort: 0.12, laborCostPerPort: 0.2, hoursPerPort: 0.3, hoursPerMeter: 0.3 },
      warnings: [],
    });
  });

  it('sem as fórmulas usa o padrão do modelo 3.26 e avisa', async () => {
    const r = await readBidTargets(await fixture({ withFormulas: false }));
    expect(r.weights).toEqual(DEFAULT_WEIGHTS);
    expect(r.thresholds).toEqual(DEFAULT_THRESHOLDS);
    expect(r.warnings).toHaveLength(2);
  });

  it('cluster sem metas e moeda sem câmbio viram avisos', async () => {
    const r = await readBidTargets(await fixture({ cluster: 'XYZ', currency: 'EUR' }));
    expect(r.targets.hoursPerPort).toBeNull();
    expect(r.converted.costPerPort).toBeNull();
    expect(r.warnings).toEqual(expect.arrayContaining(['O Bid Template não tem metas para o cluster XYZ.', 'Câmbio de EUR não encontrado no Bid Template; metas de custo ficam sem conversão.']));
  });

  it('arquivo que não é planilha → 400', async () => {
    await expect(readBidTargets(Buffer.from('%PDF-1.4'))).rejects.toThrow('não é uma planilha válida');
  });

  it('pesos e tolerâncias pelas fórmulas', () => {
    expect(parseWeights(['SUM(A1)', 'IFERROR(0.4*(B8*C19)+0.6*(B6*C18)+1*(B10*C20),"")'])).toEqual({ meters: 0.4, ports: 0.6, devices: 1 });
    expect(parseWeights(['SUM(A1)'])).toBeNull();
    expect(parseThresholds(['IF(AND(D16>0.1),"CPP for this bid is >10%","")', 'IF(AND(D17>0.15),"LCPP for this bid is >15%","")'])).toEqual({ costPerPort: 0.1, laborCostPerPort: 0.15 });
  });
});
