const XLSX = require('xlsx');
const path = require('path');

// Criar workbook
const wb = XLSX.utils.book_new();
const ws = {};

// Linha 1: Headers + Application labels
ws['A1'] = { v: 'Item#', t: 's' };
ws['B1'] = { v: 'REF', t: 's' };
ws['C1'] = { v: 'DESCRIPTION', t: 's' };
ws['D1'] = { v: 'UNIT', t: 's' };
ws['S1'] = { v: 'App 1 - May 2026', t: 's' };
ws['W1'] = { v: 'App 2 - Jun 2026', t: 's' };

// Linha 2: Sub-headers
ws['S2'] = { v: '% Sub', t: 's' };
ws['T2'] = { v: '€ Sub', t: 's' };
ws['U2'] = { v: '% GMC', t: 's' };
ws['V2'] = { v: '€ GMC', t: 's' };
ws['W2'] = { v: '% Sub', t: 's' };
ws['X2'] = { v: '€ Sub', t: 's' };
ws['Y2'] = { v: '% GMC', t: 's' };
ws['Z2'] = { v: '€ GMC', t: 's' };

// Linha 3: Dates
ws['V3'] = { v: 46507, t: 'n' }; // 2026-05-05
ws['Z3'] = { v: 46535, t: 'n' }; // 2026-06-02

// Linhas 6+: Items
const items = [
  { ref: '1', desc: 'Preliminaries Fixed - Insurances' },
  { ref: '2', desc: 'Strip out of existing MCC' },
  { ref: '3', desc: 'ESB CT Metering' },
  { ref: '4', desc: 'Disconnect existing supply' },
  { ref: '5', desc: 'Public Liability Insurance' },
  { ref: '6', desc: 'Temporary protection barriers' },
];

items.forEach((item, idx) => {
  const row = 6 + idx;
  ws[`B${row}`] = { v: item.ref, t: 's' };
  ws[`C${row}`] = { v: item.desc, t: 's' };
  ws[`D${row}`] = { v: 'item', t: 's' };
});

ws['!ref'] = 'A1:Z20';
ws['!cols'] = [
  { width: 8 },   // A
  { width: 8 },   // B
  { width: 35 },  // C
  { width: 8 },   // D
  ...Array(15).fill({ width: 12 }),  // E-S
  ...Array(8).fill({ width: 12 })    // S-Z
];

XLSX.utils.book_append_sheet(wb, ws, 'Folan Civil');
const output = '/c/Users/wagne/Downloads/GMC_Sub_Assessment_Template.xlsx';
XLSX.writeFile(wb, output);

console.log('✅ Template criado!');
console.log(`📁 ${output}`);
