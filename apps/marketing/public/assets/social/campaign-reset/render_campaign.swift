import AppKit

let root = URL(fileURLWithPath: #file).deletingLastPathComponent()
let input = NSImage(contentsOf: root.appendingPathComponent("kyrox-campaign-art.png"))!
let output = root.appendingPathComponent("kyrox-price-is-the-beginning.png")
let size = NSSize(width: 1600, height: 900)
let canvas = NSImage(size: size)
canvas.lockFocus()
NSColor.black.setFill()
NSRect(origin: .zero, size: size).fill()
let sourceSize = input.size
let scale = max(size.width / sourceSize.width, size.height / sourceSize.height)
let drawSize = NSSize(width: sourceSize.width * scale, height: sourceSize.height * scale)
input.draw(in: NSRect(x: (size.width - drawSize.width) / 2, y: 0, width: drawSize.width, height: drawSize.height))

func color(_ hex: Int) -> NSColor {
    NSColor(calibratedRed: CGFloat((hex >> 16) & 255) / 255, green: CGFloat((hex >> 8) & 255) / 255, blue: CGFloat(hex & 255) / 255, alpha: 1)
}
func text(_ value: String, x: CGFloat, y: CGFloat, font: NSFont, hex: Int, kern: CGFloat = 0) {
    let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color(hex), .kern: kern]
    (value as NSString).draw(at: NSPoint(x: x, y: y), withAttributes: attrs)
}
func line(_ x1: CGFloat, _ y1: CGFloat, _ x2: CGFloat, _ y2: CGFloat, hex: Int) {
    let path = NSBezierPath(); path.move(to: NSPoint(x: x1, y: y1)); path.line(to: NSPoint(x: x2, y: y2)); color(hex).setStroke(); path.lineWidth = 1; path.stroke()
}
let mint = 0x7CF0C1
let mono = NSFont(name: "SFMono-Regular", size: 12) ?? NSFont.monospacedSystemFont(ofSize: 12, weight: .regular)
let display = NSFont.systemFont(ofSize: 64, weight: .semibold)
let regular = NSFont.systemFont(ofSize: 20, weight: .regular)
let markRect = NSRect(x: 92, y: 790, width: 38, height: 38)
let mark = NSBezierPath(roundedRect: markRect, xRadius: 10, yRadius: 10)
color(0x10171A).setFill(); mark.fill(); color(0x30433D).setStroke(); mark.lineWidth = 1; mark.stroke()
let glyph = NSBezierPath(); glyph.move(to: NSPoint(x: 104, y: 798)); glyph.line(to: NSPoint(x: 104, y: 820)); glyph.move(to: NSPoint(x: 104, y: 809)); glyph.line(to: NSPoint(x: 118, y: 820)); glyph.move(to: NSPoint(x: 104, y: 809)); glyph.line(to: NSPoint(x: 118, y: 798)); color(mint).setStroke(); glyph.lineWidth = 3; glyph.lineCapStyle = .round; glyph.stroke()
text("KYROX", x: 145, y: 798, font: NSFont.systemFont(ofSize: 21, weight: .bold), hex: 0xEDF2F2, kern: 4)
text("MARKET DATA  /  PRICE CONTEXT  /  TRADE PREPARATION", x: 96, y: 655, font: mono, hex: 0x91D9BD, kern: 1)
text("The price is", x: 92, y: 573, font: display, hex: 0xF0F2EF)
text("only the", x: 92, y: 501, font: display, hex: 0xF0F2EF)
text("beginning.", x: 92, y: 429, font: display, hex: mint)
line(96, 352, 410, 352, hex: 0x61736D)
text("A price becomes a decision", x: 96, y: 323, font: regular, hex: 0xD0D7D4)
text("when its context is in view.", x: 96, y: 293, font: regular, hex: 0xD0D7D4)
text("OBSERVE   →   QUOTE   →   CHECK   →   PREPARE", x: 96, y: 178, font: mono, hex: 0xAAB8B3, kern: 0.5)
line(96, 142, 1504, 142, hex: 0x45504E)
text("LOCAL PROTOTYPE  ·  SIMULATED PREVIEW", x: 96, y: 108, font: NSFont.monospacedSystemFont(ofSize: 11, weight: .regular), hex: 0x9CA8A4, kern: 0.8)
text("KYROX.IO", x: 1392, y: 108, font: NSFont.monospacedSystemFont(ofSize: 11, weight: .regular), hex: 0xDCE6E2, kern: 0.8)
canvas.unlockFocus()
let tiff = canvas.tiffRepresentation!
let bitmap = NSBitmapImageRep(data: tiff)!
try bitmap.representation(using: .png, properties: [:])!.write(to: output)
print("\(output.path) (1600 × 900)")
