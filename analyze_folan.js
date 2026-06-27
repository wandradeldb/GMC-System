const XLSX = require('./server/node_modules/xlsx');

const filePath = 'C:\\Users\\wagne\\Downloads\\GMC\\Ap 2 Folan.xlsx';
console.log('Analisando:', filePath);

try {
  const wb = XLSX.readFile(filePath);
  const sheetNames = Object.keys(wb.Sheets);
  console.log('Sheets encontradas:', sheetNames);

  const sh = wb.Sheets['Folan Civil'] || wb.Sheets[sheetNames[0]];
  const activeSheet = Object.keys(wb.Sheets).find(n => n.includes('Folan')) || sheetNames[0];

  console.log('\n📊 Analisando:', activeSheet);
  console.log('\nPrimeiras 10 linhas (colunas A-P):\n');

  for (let r = 1; r <= 10; r++) {
    let row = [];
    for (let c = 1; c <= 16; c++) {
      const addr = XLSX.utils.encode_cell({r: r-1, c: c-1});
      const cell = wb.Sheets[activeSheet][addr];
      const val = cell ? cell.v : '';
      const str = typeof val === 'number' ? val.toFixed(1) : String(val || '').substring(0, 12);
      row.push(str);
    }
    console.log(`L${r.toString().padStart(2)}:`, row.join(' | '));
  }

  console.log('\n✅ Arquivo lido com sucesso!');
} catch (e) {
  console.error('❌ Erro:', e.message);
}
