import { extractPdfText } from './pdf-text.js';

/** PDF mínimo montado no teste (texto fictício), com a tabela xref calculada. */
function tinyPdf(lines: Array<[number, number, string]>): Buffer {
  const stream = lines.map(([x, y, s]) => `BT /F1 12 Tf ${x} ${y} Td (${s}) Tj ET`).join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(body));
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

describe('extractPdfText', () => {
  it('monta as linhas de cima para baixo e da esquerda para a direita', async () => {
    const pdf = tinyPdf([
      [200, 700, '(34m) from A to B'],
      [50, 700, '--- 3x 36F LC-LC'],
      [50, 720, 'FBN: XX00TEST0001'],
    ]);
    const { text, pages } = await extractPdfText(pdf);
    expect(pages).toBe(1);
    expect(text.split('\n')).toEqual(['=== página 1 ===', 'FBN: XX00TEST0001', '--- 3x 36F LC-LC (34m) from A to B']);
  });

  it('recusa o que não é PDF', async () => {
    await expect(extractPdfText(Buffer.from('PK\u0003\u0004 planilha'))).rejects.toThrow('não é um PDF');
  });

  it('PDF corrompido pede para colar o texto', async () => {
    await expect(extractPdfText(Buffer.from('%PDF-1.4\nlixo'))).rejects.toThrow('cole o texto');
  });
});
