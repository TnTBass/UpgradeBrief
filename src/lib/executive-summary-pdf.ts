import { jsPDF } from 'jspdf'

export interface ExecutiveSummaryPdfInput {
  productName: string
  installedRelease: string
  preparedOn: string
  recommendation: { heading: string; detail: string }
  lifecycle: { heading: string; detail: string }
  upgradeRoute: { heading: string; detail: string }
  securitySummary?: string
  highlights: Array<{ title: string; summary: string }>
  sources: Array<{ title: string; url: string }>
}

const pageWidth = 612
const pageHeight = 792
const margin = 54
const contentWidth = pageWidth - margin * 2

function addWrappedText(document: jsPDF, text: string, x: number, y: number, maxWidth: number, lineHeight: number): number {
  const lines = document.splitTextToSize(text, maxWidth) as string[]
  document.text(lines, x, y)
  return y + lines.length * lineHeight
}

function ensureSpace(document: jsPDF, y: number, requiredHeight: number): number {
  if (y + requiredHeight <= pageHeight - margin) return y
  document.addPage()
  return margin
}

function addSection(document: jsPDF, label: string, heading: string, detail: string, y: number): number {
  y = ensureSpace(document, y, 86)
  document.setDrawColor(219, 226, 229)
  document.line(margin, y, pageWidth - margin, y)
  y += 17
  document.setTextColor(0, 110, 109)
  document.setFont('helvetica', 'bold')
  document.setFontSize(8)
  document.text(label.toUpperCase(), margin, y)
  y += 18
  document.setTextColor(29, 42, 53)
  document.setFontSize(13)
  document.text(heading, margin, y)
  y += 17
  document.setFont('helvetica', 'normal')
  document.setFontSize(10)
  return addWrappedText(document, detail, margin, y, contentWidth, 14) + 12
}

function safeFileSegment(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/(^-|-$)/g, '')
}

export function downloadExecutiveSummaryPdf(input: ExecutiveSummaryPdfInput): void {
  const document = new jsPDF({ format: 'letter', orientation: 'portrait', unit: 'pt' })
  let y = margin

  document.setFillColor(0, 110, 109)
  document.rect(0, 0, pageWidth, 90, 'F')
  document.setTextColor(255, 255, 255)
  document.setFont('helvetica', 'bold')
  document.setFontSize(9)
  document.text('UPGRADE BRIEF', margin, 32)
  document.setFontSize(21)
  document.text('Executive summary', margin, 62)
  y = 117

  document.setTextColor(29, 42, 53)
  document.setFont('helvetica', 'bold')
  document.setFontSize(18)
  y = addWrappedText(document, `${input.productName} ${input.installedRelease}`, margin, y, contentWidth, 22) + 4
  document.setFont('helvetica', 'normal')
  document.setTextColor(102, 116, 125)
  document.setFontSize(9)
  document.text(`Prepared ${input.preparedOn}`, margin, y + 12)
  y += 34

  y = addSection(document, 'Recommendation', input.recommendation.heading, input.recommendation.detail, y)
  y = addSection(document, 'Lifecycle', input.lifecycle.heading, input.lifecycle.detail, y)
  y = addSection(document, 'Upgrade route', input.upgradeRoute.heading, input.upgradeRoute.detail, y)

  if (input.securitySummary) y = addSection(document, 'Security posture', 'Cataloged security advisory summary', input.securitySummary, y)

  if (input.highlights.length > 0) {
    y = ensureSpace(document, y, 86)
    document.setDrawColor(219, 226, 229)
    document.line(margin, y, pageWidth - margin, y)
    y += 17
    document.setTextColor(0, 110, 109)
    document.setFont('helvetica', 'bold')
    document.setFontSize(8)
    document.text('WHAT THE TARGET CAN ADD', margin, y)
    y += 17
    for (const highlight of input.highlights) {
      y = ensureSpace(document, y, 44)
      document.setTextColor(29, 42, 53)
      document.setFont('helvetica', 'bold')
      document.setFontSize(10)
      y = addWrappedText(document, highlight.title, margin, y, contentWidth, 13)
      document.setFont('helvetica', 'normal')
      document.setFontSize(9)
      y = addWrappedText(document, highlight.summary, margin, y + 2, contentWidth, 12) + 8
    }
  }

  y = ensureSpace(document, y, 72)
  document.setDrawColor(219, 226, 229)
  document.line(margin, y, pageWidth - margin, y)
  y += 17
  document.setTextColor(0, 110, 109)
  document.setFont('helvetica', 'bold')
  document.setFontSize(8)
  document.text('SOURCE SCOPE', margin, y)
  y += 17
  document.setTextColor(29, 42, 53)
  document.setFont('helvetica', 'normal')
  document.setFontSize(9)
  y = addWrappedText(document, 'This summary reflects linked, source-backed records. It does not assess the environment or certify upgrade safety. Review official Veeam sources before acting.', margin, y, contentWidth, 12) + 8

  document.setTextColor(0, 110, 109)
  for (const source of input.sources) {
    y = ensureSpace(document, y, 28)
    document.setFont('helvetica', 'bold')
    document.setFontSize(8)
    y = addWrappedText(document, source.title, margin, y, contentWidth, 11)
    document.setFont('helvetica', 'normal')
    document.setFontSize(7)
    y = addWrappedText(document, source.url, margin, y + 1, contentWidth, 9) + 5
  }

  document.save(`upgrade-brief-${safeFileSegment(input.productName)}-${safeFileSegment(input.installedRelease)}-executive-summary.pdf`)
}
