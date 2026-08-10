const { writeFileSync } = require('node:fs')
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib')

async function main() {
  const output = process.argv[2]
  if (!output) throw new Error('usage: node tools/create-qa-pdf.cjs <output.pdf>')
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([612, 792])
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  page.drawText('Captivela Office Windows QA', {
    x: 72,
    y: 700,
    size: 24,
    font,
    color: rgb(0.1, 0.2, 0.45),
  })
  writeFileSync(output, await pdf.save())
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
