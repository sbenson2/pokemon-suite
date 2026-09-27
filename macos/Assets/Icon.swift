// Original cartridge artwork; no game or console assets.
import AppKit
let destination = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)
for size in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let pixels = size * scale
        let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
        NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
        let context = NSGraphicsContext.current!.cgContext
        context.scaleBy(x: CGFloat(pixels) / 1024, y: CGFloat(pixels) / 1024)
        if CommandLine.arguments.contains("--ios") { NSColor(calibratedWhite: 0.9, alpha: 1).setFill(); NSRect(x: 0, y: 0, width: 1024, height: 1024).fill() }
        func box(_ rect: NSRect, _ radius: CGFloat, _ color: NSColor) { color.setFill(); NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius).fill() }
        box(NSRect(x: 38, y: 38, width: 948, height: 948), 205, NSColor(calibratedWhite: 0.9, alpha: 1))
        box(NSRect(x: 172, y: 125, width: 680, height: 774), 64, NSColor(calibratedRed: 0.65, green: 0.13, blue: 0.18, alpha: 1))
        box(NSRect(x: 224, y: 371, width: 576, height: 453), 32, NSColor(calibratedWhite: 0.16, alpha: 1))
        box(NSRect(x: 260, y: 407, width: 504, height: 381), 12, NSColor(calibratedWhite: 0.94, alpha: 1))
        let ink = NSColor(calibratedRed: 0.65, green: 0.13, blue: 0.18, alpha: 1)
        for (x, y, w, h) in [(352,526,64,164),(304,576,164,64),(572,576,64,64),(654,644,64,64)] { box(NSRect(x: x, y: y, width: w, height: h), 6, ink) }
        for x in stride(from: 260, through: 720, by: 92) { box(NSRect(x: x, y: 164, width: 48, height: 122), 8, NSColor(calibratedWhite: 0.84, alpha: 1)) }
        NSGraphicsContext.restoreGraphicsState()
        let name = "icon_\(size)x\(size)\(scale == 2 ? "@2x" : "").png"
        try bitmap.representation(using: .png, properties: [:])!.write(to: destination.appendingPathComponent(name))
    }
}
