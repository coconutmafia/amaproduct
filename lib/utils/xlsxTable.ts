// Build a real .xlsx from a 2-D array and download it. Real spreadsheet columns
// (not CSV) → opens correctly in Excel / Numbers / Google Sheets on any locale.
// (Comma-CSV showed as a single column in RU Excel / iOS — the "каша" problem.)
export async function downloadXlsx(filename: string, sheetName: string, aoa: (string | number)[][]): Promise<void> {
  const XLSX = await import('xlsx')
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  // Column widths from content so the table is readable on open.
  const ncols = aoa.reduce((m, r) => Math.max(m, r.length), 0)
  ws['!cols'] = Array.from({ length: ncols }, (_, c) => {
    let max = 8
    for (const row of aoa) {
      const len = row[c] == null ? 0 : String(row[c]).length
      if (len > max) max = len
    }
    return { wch: Math.min(70, max + 2) }
  })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, (sheetName || 'Лист1').slice(0, 31))
  const safe = (filename || 'table').replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().slice(0, 80) || 'table'
  XLSX.writeFile(wb, `${safe}.xlsx`)
}
