import { Workbook } from 'exceljs';

import { conferirZipDaPlanilha, lerXlsx, TETO_XLSX_ABERTO } from './tabela';

async function planilha(): Promise<Buffer> {
  const pasta = new Workbook();
  const aba = pasta.addWorksheet('Contatos');
  aba.addRow(['nome', 'telefone']);
  aba.addRow(['Ana', '21999998888']);
  return Buffer.from(await pasta.xlsx.writeBuffer());
}

describe('conferirZipDaPlanilha', () => {
  it('aceita uma planilha real e ela continua legível', async () => {
    const buf = await planilha();
    expect(() => conferirZipDaPlanilha(buf)).not.toThrow();
    const linhas = await lerXlsx(buf);
    expect(linhas[1]).toEqual(['Ana', '21999998888']);
  });

  it('recusa quando o tamanho aberto declarado passa do teto (bomba)', async () => {
    const buf = await planilha();
    // Troca o tamanho descompactado da primeira parte no diretório central.
    const i = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    buf.writeUInt32LE(TETO_XLSX_ABERTO + 1, i + 24);
    expect(() => conferirZipDaPlanilha(buf)).toThrow();
    await expect(lerXlsx(buf)).rejects.toThrow();
  });

  it('recusa arquivo que não é zip', () => {
    expect(() => conferirZipDaPlanilha(Buffer.from('nome,telefone\nAna,21999998888'))).toThrow();
  });
});
