// Реальный .xlsx, читаемый «из коробки»: перенос строк (wrap), жирная шапка,
// закреплённая первая строка, ширины по содержимому, много листов в книге.
//
// История формата (не откатывать):
// 1) comma-CSV в русском Excel / iOS открывался ОДНОЙ колонкой («каша»);
// 2) SheetJS дал настоящие колонки, но НЕ пишет стили (wrap — платная версия):
//    длинные ячейки уезжали простынёй в одну строку — на телефоне нечитаемо
//    (жалоба Августы 31 июля: «нельзя растянуть колонки и нормально почитать»);
// 3) теперь exceljs: стили пишутся, движок грузится динамически по клику —
//    в бандл страницы не попадает.

export type XlsxSheet = {
  name: string
  aoa: (string | number)[][]
  /** Явные ширины колонок (символы); без них — по содержимому с потолком. */
  widths?: number[]
  /**
   * Колонки (0-based), где подряд идущие ОДИНАКОВЫЕ значения сливаются в одну
   * ячейку — как в эталоне урока «Карта смыслов» (категория и общая
   * формулировка объединены по группе строк).
   */
  mergeRepeats?: number[]
}

const MIN_W = 8
const MAX_W = 60

// Собрать книгу (без DOM) — вынесено отдельно, чтобы смоук-скрипт мог записать
// файл на диск и проверить wrap/freeze/ширины реальным чтением (openpyxl).
export async function buildXlsxWorkbook(sheets: XlsxSheet[]) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  const used = new Set<string>()
  for (const s of sheets) {
    if (!s.aoa.length) continue
    // Имя листа: Excel запрещает \ / * ? : [ ] и длину >31; имена уникальны.
    const base = (s.name || 'Лист').replace(/[\\/*?:[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Лист'
    let name = base
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base.slice(0, 28)} ${i}`
    used.add(name.toLowerCase())

    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] })
    ws.addRows(s.aoa)
    const ncols = s.aoa.reduce((m, r) => Math.max(m, r.length), 0)
    for (let c = 1; c <= ncols; c++) {
      let max = MIN_W
      for (const row of s.aoa) {
        const len = row[c - 1] == null ? 0 : String(row[c - 1]).length
        if (len > max) max = len
      }
      ws.getColumn(c).width = s.widths?.[c - 1] ?? Math.min(MAX_W, max + 2)
    }
    ws.eachRow((row, n) => {
      row.alignment = { vertical: 'top', wrapText: true }
      if (n === 1) row.font = { bold: true }
    })

    // Слить подряд идущие одинаковые значения в указанных колонках (шапку не
    // трогаем). Merge выполняется ПОСЛЕ добавления строк: exceljs оставит
    // значение верхней ячейки диапазона.
    for (const c0 of s.mergeRepeats ?? []) {
      const col = c0 + 1
      let runStart = 2 // первая строка данных (1 — шапка)
      for (let r = 3; r <= s.aoa.length + 1; r++) {
        const prev = s.aoa[r - 2]?.[c0]
        const cur  = s.aoa[r - 1]?.[c0]
        const same = r <= s.aoa.length && String(cur ?? '') === String(prev ?? '') && String(cur ?? '') !== ''
        if (!same) {
          if (r - 1 > runStart) {
            try { ws.mergeCells(runStart, col, r - 1, col) } catch { /* пересечение — пропускаем */ }
          }
          runStart = r
        }
      }
    }
  }
  return wb
}

/** Скачать книгу из нескольких листов (браузер). Пустые листы отбрасываются. */
export async function downloadXlsxBook(filename: string, sheets: XlsxSheet[]): Promise<void> {
  const wb = await buildXlsxWorkbook(sheets)
  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const safe = (filename || 'table').replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().slice(0, 80) || 'table'
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${safe}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}

/** Скачать один лист (совместимость со старыми вызовами). */
export async function downloadXlsx(filename: string, sheetName: string, aoa: (string | number)[][]): Promise<void> {
  await downloadXlsxBook(filename, [{ name: sheetName, aoa }])
}
