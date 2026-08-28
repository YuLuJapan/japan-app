// The parts a .docx and a .xlsx are actually made of.
//
// Both formats are a ZIP of XML. What a *readable* export needs from them is
// small and fully specified — paragraphs, or rows of strings — so this writes
// the parts rather than pulling in a document library whose weight would be
// paid at install time by every device (research R3). `fflate` is the only
// dependency, and it unzips too, which is what spec 007 will need to read
// these files back.
//
// Nothing here knows what a trip is. It takes headings, paragraphs and rows.
import { zipSync, strToU8 } from 'fflate'

/** XML text escaping. The only encoding rule either format needs from us. */
export const xml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Control characters are not legal in XML 1.0 and would make the file
    // unopenable rather than merely ugly. Trip content is typed by people, so
    // this is a real possibility rather than a theoretical one — which is
    // exactly why the rule the lint would apply here is the wrong one.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')

const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

const zip = (files: Record<string, string>): Uint8Array =>
  zipSync(
    Object.fromEntries(Object.entries(files).map(([path, body]) => [path, strToU8(body)])),
    // Deflate everything: an export of a long trip is mostly repeated markup,
    // and the file is going through a share sheet.
    { level: 6 }
  )

// --- .docx -------------------------------------------------------------------

/** One paragraph of the document. `style` picks the built-in heading levels. */
export interface DocxParagraph {
  text: string
  style?: 'Title' | 'Heading1' | 'Heading2' | 'Heading3'
  bold?: boolean
  /** Rendered as a bulleted line. */
  bullet?: boolean
  muted?: boolean
}

const paragraph = (p: DocxParagraph): string => {
  const props: string[] = []
  if (p.style) props.push(`<w:pStyle w:val="${p.style}"/>`)
  if (p.bullet) props.push('<w:ind w:left="360" w:hanging="180"/>')
  const runProps: string[] = []
  if (p.bold) runProps.push('<w:b/>')
  if (p.muted) runProps.push('<w:color w:val="6B6B76"/>')
  const text = xml(p.bullet ? `• ${p.text}` : p.text)
  return (
    `<w:p>${props.length ? `<w:pPr>${props.join('')}</w:pPr>` : ''}` +
    `<w:r>${runProps.length ? `<w:rPr>${runProps.join('')}</w:rPr>` : ''}` +
    `<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`
  )
}

/** A whole word-processor document from a flat list of paragraphs. */
export function buildDocx(paragraphs: DocxParagraph[]): Uint8Array {
  const body = paragraphs.map(paragraph).join('')
  return zip({
    '[Content_Types].xml':
      `${DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '</Types>',
    '_rels/.rels':
      `${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>',
    'word/_rels/document.xml.rels':
      `${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>',
    'word/styles.xml': `${DECL}${DOCX_STYLES}`,
    'word/document.xml':
      `${DECL}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body>${body}</w:body></w:document>`,
  })
}

/** Just enough of a stylesheet for the four heading levels to mean something. */
const DOCX_STYLES =
  '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  [
    ['Title', 'Title', 48],
    ['Heading1', 'heading 1', 32],
    ['Heading2', 'heading 2', 26],
    ['Heading3', 'heading 3', 22],
  ]
    .map(
      ([id, name, halfPoints]) =>
        `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/>` +
        `<w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr>` +
        `<w:rPr><w:b/><w:sz w:val="${halfPoints}"/></w:rPr></w:style>`
    )
    .join('') +
  '</w:styles>'

// --- .xlsx -------------------------------------------------------------------

/** One sheet: a name, a header row, and the rows under it. */
export interface XlsxSheet {
  name: string
  header: string[]
  rows: string[][]
  /** Column widths in characters; falls back to something readable. */
  widths?: number[]
}

/** `0` → `A`, `26` → `AA`. */
const column = (index: number): string => {
  let n = index
  let out = ''
  do {
    out = String.fromCharCode(65 + (n % 26)) + out
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return out
}

// Inline strings rather than a shared-strings table: one part fewer, no index
// to keep consistent, and the size difference is irrelevant once the archive
// is deflated.
const cell = (row: number, col: number, value: string, bold: boolean): string =>
  `<c r="${column(col)}${row}" t="inlineStr"${bold ? ' s="1"' : ''}>` +
  `<is><t xml:space="preserve">${xml(value)}</t></is></c>`

const sheetXml = (sheet: XlsxSheet): string => {
  const cols = sheet.widths?.length
    ? `<cols>${sheet.widths
        .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
        .join('')}</cols>`
    : ''
  const header = `<row r="1">${sheet.header.map((v, i) => cell(1, i, v, true)).join('')}</row>`
  const body = sheet.rows
    .map(
      (row, r) => `<row r="${r + 2}">${row.map((v, i) => cell(r + 2, i, v, false)).join('')}</row>`
    )
    .join('')
  return (
    `${DECL}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `${cols}<sheetData>${header}${body}</sheetData></worksheet>`
  )
}

/** A workbook of one or more sheets. */
export function buildXlsx(sheets: XlsxSheet[]): Uint8Array {
  const files: Record<string, string> = {
    '[Content_Types].xml':
      `${DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      sheets
        .map(
          (_s, i) =>
            `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
        )
        .join('') +
      '</Types>',
    '_rels/.rels':
      `${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>',
    'xl/workbook.xml':
      `${DECL}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      sheets
        .map(
          (s, i) =>
            `<sheet name="${xml(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`
        )
        .join('') +
      '</sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      `${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      sheets
        .map(
          (_s, i) =>
            `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
        )
        .join('') +
      `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      '</Relationships>',
    // Two cell formats: plain, and the bold one the header row uses (s="1").
    'xl/styles.xml':
      `${DECL}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
      '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>' +
      '<borders count="1"><border/></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
      '</styleSheet>',
  }
  sheets.forEach((sheet, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(sheet)
  })
  return zip(files)
}
