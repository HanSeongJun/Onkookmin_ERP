/**
 * 자료일괄등록: what read-excel-file does not tell about an .xlsx file,
 * read straight from the file's XML:
 * - hidden sheets (시트 숨기기): never imported;
 * - cells whose formula failed (#N/A, #REF! …): read-excel-file reads them
 *   as empty, which would silently register a 거래처 without its 영업담당
 *   when a VLOOKUP failed;
 * - merged cells (셀 병합): only the top cell holds the value, so rows
 *   below a merged 대분류 would read as 미분류;
 * - number cells shown with leading zeros by a "000000"-style format:
 *   Excel shows 000124, the cell holds 124.
 *
 * An .xlsx file is a zip archive of XML files. This reads the archive's
 * table of contents and unpacks the few files it needs with the browser's
 * own DecompressionStream (no extra library). Anything unexpected (zip64,
 * an unknown layout) returns null: the file is then read without these
 * extras, exactly as before.
 *
 * No server imports: the browser and the Node test scripts use it.
 */

/** A cell position, 0-based (row 0 = Excel row 1, column 0 = A). */
export type XlsxCellPosition = { row: number; column: number }

/** A merged range, 0-based and inclusive. */
export type XlsxMergedRange = {
  top: number
  left: number
  bottom: number
  right: number
}

/** What the scan found in one sheet. */
export type XlsxSheetFacts = {
  /** The sheet's name, as Excel shows it on its tab. */
  name: string
  /** The sheet is hidden (state "hidden" or "veryHidden"). */
  hidden: boolean
  /** Cells with a formula error, with its code (e.g. "#N/A"). */
  errorCells: (XlsxCellPosition & { code: string })[]
  merges: XlsxMergedRange[]
  /**
   * Number cells whose format is only zeros ("000000"), with the text
   * Excel shows for them (124 → "000124").
   */
  zeroPadded: (XlsxCellPosition & { text: string })[]
}

// ---------------------------------------------------------------------------
// Zip archive
// ---------------------------------------------------------------------------

type ZipEntry = {
  name: string
  method: number
  compressedSize: number
  localHeaderOffset: number
}

/** The files listed in a zip archive's central directory, or null. */
function readZipEntries(bytes: Uint8Array): Map<string, ZipEntry> | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // End of central directory record: at least 22 bytes, at most a 64KB
  // comment after it.
  let end = -1
  const stop = Math.max(0, bytes.length - 22 - 0xffff)
  for (let index = bytes.length - 22; index >= stop; index--) {
    if (view.getUint32(index, true) === 0x06054b50) {
      end = index
      break
    }
  }
  if (end < 0) return null
  const count = view.getUint16(end + 10, true)
  const directoryOffset = view.getUint32(end + 16, true)
  if (count === 0xffff || directoryOffset === 0xffffffff) return null // zip64

  const decoder = new TextDecoder()
  const entries = new Map<string, ZipEntry>()
  let offset = directoryOffset
  for (let index = 0; index < count; index++) {
    if (offset + 46 > bytes.length) return null
    if (view.getUint32(offset, true) !== 0x02014b50) return null
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const name = decoder.decode(
      bytes.subarray(offset + 46, offset + 46 + nameLength)
    )
    entries.set(name, {
      name,
      method: view.getUint16(offset + 10, true),
      compressedSize: view.getUint32(offset + 20, true),
      localHeaderOffset: view.getUint32(offset + 42, true),
    })
    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

/** The text of one file of the archive (stored or deflated), or null. */
async function readZipText(
  bytes: Uint8Array,
  entry: ZipEntry
): Promise<string | null> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const header = entry.localHeaderOffset
  if (header + 30 > bytes.length) return null
  if (view.getUint32(header, true) !== 0x04034b50) return null
  const start =
    header +
    30 +
    view.getUint16(header + 26, true) +
    view.getUint16(header + 28, true)
  const data = bytes.slice(start, start + entry.compressedSize)
  if (entry.method === 0) return new TextDecoder().decode(data)
  if (entry.method !== 8) return null
  const stream = new Blob([data])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"))
  return await new Response(stream).text()
}

// ---------------------------------------------------------------------------
// XML (only the few tags needed, with regular expressions)
// ---------------------------------------------------------------------------

/** The attributes of one start tag: { name: value } (values unescaped). */
function attributesOf(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  for (const match of tag.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) {
    attributes[match[1]] = unescapeXml(match[2])
  }
  return attributes
}

function unescapeXml(text: string): string {
  return text.replace(
    /&(?:#x([0-9a-f]+)|#(\d+)|(amp|lt|gt|quot|apos));/gi,
    (all, hex: string, decimal: string, name: string) => {
      if (hex) return String.fromCodePoint(parseInt(hex, 16))
      if (decimal) return String.fromCodePoint(parseInt(decimal, 10))
      return (
        { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[
          name.toLowerCase()
        ] ?? all
      )
    }
  )
}

/** "AB12" → { row: 11, column: 27 }, or null. */
function parseCellRef(ref: string): XlsxCellPosition | null {
  const match = /^\$?([A-Z]{1,3})\$?(\d{1,7})$/i.exec(ref)
  if (!match) return null
  let column = 0
  for (const letter of match[1].toUpperCase()) {
    column = column * 26 + (letter.charCodeAt(0) - 64)
  }
  return { row: Number(match[2]) - 1, column: column - 1 }
}

/** The archive path of a relationship target of xl/workbook.xml. */
function workbookTarget(target: string): string {
  if (target.startsWith("/")) return target.slice(1)
  const parts = ["xl"]
  for (const part of target.split("/")) {
    if (part === "..") parts.pop()
    else if (part !== "." && part !== "") parts.push(part)
  }
  return parts.join("/")
}

/**
 * Style numbers (the "s" of a cell) whose number format is only zeros,
 * with the number of digits it shows: { 3: 6 } for "000000".
 */
function zeroPaddedStyles(stylesXml: string): Map<number, number> {
  const zeroFormats = new Map<number, number>()
  for (const match of stylesXml.matchAll(/<numFmt\b[^>]*>/g)) {
    const attributes = attributesOf(match[0])
    const code = attributes.formatCode ?? ""
    if (/^0{2,}$/.test(code)) {
      zeroFormats.set(Number(attributes.numFmtId), code.length)
    }
  }
  const styles = new Map<number, number>()
  if (zeroFormats.size === 0) return styles
  const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)
  if (!cellXfs) return styles
  let index = 0
  for (const match of cellXfs[1].matchAll(/<xf\b[^>]*>/g)) {
    const digits = zeroFormats.get(Number(attributesOf(match[0]).numFmtId))
    if (digits !== undefined) styles.set(index, digits)
    index++
  }
  return styles
}

/** Formula errors, merged ranges and zero-padded numbers of one sheet. */
function scanSheet(
  xml: string,
  zeroStyles: Map<number, number>
): Pick<XlsxSheetFacts, "errorCells" | "merges" | "zeroPadded"> {
  const errorCells: XlsxSheetFacts["errorCells"] = []
  const zeroPadded: XlsxSheetFacts["zeroPadded"] = []
  // Only cells that can matter: an error type, or a zero-padded style.
  if (xml.includes('t="e"') || zeroStyles.size > 0) {
    for (const match of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributes = attributesOf(match[1])
      const type = attributes.t ?? "n"
      if (type !== "e" && type !== "n") continue
      const position = attributes.r ? parseCellRef(attributes.r) : null
      if (!position) continue
      const value = /<v>([\s\S]*?)<\/v>/.exec(match[2] ?? "")?.[1]
      if (type === "e") {
        errorCells.push({ ...position, code: unescapeXml(value ?? "#N/A") })
        continue
      }
      const digits = zeroStyles.get(Number(attributes.s ?? "0"))
      if (digits !== undefined && value !== undefined && /^\d+$/.test(value)) {
        zeroPadded.push({ ...position, text: value.padStart(digits, "0") })
      }
    }
  }
  const merges: XlsxMergedRange[] = []
  for (const match of xml.matchAll(/<mergeCell\b[^>]*>/g)) {
    const [from, to] = (attributesOf(match[0]).ref ?? "").split(":")
    const start = from ? parseCellRef(from) : null
    const end = to ? parseCellRef(to) : start
    if (!start || !end) continue
    merges.push({
      top: Math.min(start.row, end.row),
      left: Math.min(start.column, end.column),
      bottom: Math.max(start.row, end.row),
      right: Math.max(start.column, end.column),
    })
  }
  return { errorCells, merges, zeroPadded }
}

/**
 * Scans an .xlsx file (its bytes) and returns what it found per sheet, in
 * the workbook's order, or null when the file could not be scanned (it is
 * then read without these extras).
 */
export async function scanXlsx(
  bytes: Uint8Array
): Promise<XlsxSheetFacts[] | null> {
  try {
    const entries = readZipEntries(bytes)
    if (!entries) return null
    const text = async (name: string) => {
      const entry = entries.get(name)
      return entry ? await readZipText(bytes, entry) : null
    }
    const workbook = await text("xl/workbook.xml")
    const relations = await text("xl/_rels/workbook.xml.rels")
    if (!workbook || !relations) return null
    const zeroStyles = zeroPaddedStyles((await text("xl/styles.xml")) ?? "")

    const targets = new Map<string, string>()
    for (const match of relations.matchAll(/<Relationship\b[^>]*>/g)) {
      const attributes = attributesOf(match[0])
      if (attributes.Id && attributes.Target) {
        targets.set(attributes.Id, workbookTarget(attributes.Target))
      }
    }

    const sheets: XlsxSheetFacts[] = []
    for (const match of workbook.matchAll(/<sheet\b[^>]*>/g)) {
      const attributes = attributesOf(match[0])
      // The relationship id attribute is "r:id" (any namespace prefix).
      const idKey = Object.keys(attributes).find((key) => key.endsWith(":id"))
      const path = idKey ? targets.get(attributes[idKey]) : undefined
      const xml = path ? await text(path) : null
      sheets.push({
        name: attributes.name ?? "",
        hidden:
          attributes.state === "hidden" || attributes.state === "veryHidden",
        ...(xml
          ? scanSheet(xml, zeroStyles)
          : { errorCells: [], merges: [], zeroPadded: [] }),
      })
    }
    return sheets
  } catch (error) {
    console.warn("Could not scan the Excel file:", error)
    return null
  }
}
