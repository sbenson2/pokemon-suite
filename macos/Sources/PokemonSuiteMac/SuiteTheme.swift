import AppKit
import SwiftUI

/// The iOS companion's game theme (native/ios/Companion/GameTheme.swift) for the
/// Mac's content layer. The window frame stays native: sidebar, toolbar, menus,
/// sheets and Settings use system styling, as the macOS HIG asks for branding
/// that lives in content. ThemeParityTests keeps these values equal to the iOS ones.
enum GameThemeValues {
    /// Appearance-dependent colors: (dark, light).
    static let pairs: [String: (dark: UInt32, light: UInt32)] = [
        "canvas": (0x080F17, 0xE4EBF0), "panel": (0x14212C, 0xF7F9FA), "inset": (0x0B131B, 0xEAF0F4),
        "edge": (0x777E85, 0x687D8F), "text": (0xF1F3EF, 0x172938), "secondary": (0xB4C1CD, 0x485F71),
        "focus": (0x53AEFF, 0x0064AD), "menuEdge": (0xB6C9C9, 0x526D76),
    ]
    /// The FireRed textbox's slate-blue and the ivory lettering on it.
    static let fixed: [String: UInt32] = ["dialogue": 0x29526B, "ivory": 0xE7DEE7]
    static let metal: [(UInt32, Double)] = [(0x353D46, 0), (0xB7B8B5, 0.08), (0x505860, 0.18), (0x9A9C9C, 0.48), (0x4E565D, 0.68), (0xA6AAA9, 0.94), (0x363E46, 1)]
    static let titleBar: [(UInt32, Double)] = [(0x4A5158, 0), (0x858783, 0.47), (0x63686B, 0.8), (0xA3A5A2, 1)]
}

struct GamePalette {
    let dark: Bool
    var increasedContrast = false
    private func pair(_ name: String) -> Color { let value = GameThemeValues.pairs[name]!; return Color(hex: dark ? value.dark : value.light) }
    var canvas: Color { pair("canvas") }
    var panel: Color { pair("panel") }
    var inset: Color { pair("inset") }
    var edge: Color { pair("edge").opacity(increasedContrast ? 1 : 0.7) }
    var text: Color { pair("text") }
    var secondary: Color { increasedContrast ? pair("text") : pair("secondary") }
    var focus: Color { pair("focus") }
    var menuEdge: Color { pair("menuEdge") }
    var dialogue: Color { Color(hex: GameThemeValues.fixed["dialogue"]!) }
    var ivory: Color { Color(hex: GameThemeValues.fixed["ivory"]!) }
    var metal: LinearGradient { LinearGradient(stops: GameThemeValues.metal.map { .init(color: Color(hex: $0.0), location: $0.1) }, startPoint: .topLeading, endPoint: .bottomTrailing) }
    var titleBar: LinearGradient { LinearGradient(stops: GameThemeValues.titleBar.map { .init(color: Color(hex: $0.0), location: $0.1) }, startPoint: .topLeading, endPoint: .bottomTrailing) }
}

extension Color {
    init(hex: UInt32) { self.init(.sRGB, red: Double(hex >> 16 & 255) / 255, green: Double(hex >> 8 & 255) / 255, blue: Double(hex & 255) / 255, opacity: 1) }
}

private struct GamePaletteReader<Content: View>: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.colorSchemeContrast) private var contrast
    @ViewBuilder var content: (GamePalette) -> Content
    var body: some View { content(GamePalette(dark: scheme == .dark, increasedContrast: contrast == .increased)) }
}

/// The notched window shape of the game's menus, drawn in code.
struct GameWindow: Shape {
    var corner: CGFloat = 7
    func path(in r: CGRect) -> Path {
        let c = min(corner, min(r.width, r.height) / 3)
        return Path { p in
            let s = max(0.5, c / 2)
            p.move(to: CGPoint(x: r.minX + c, y: r.minY)); p.addLine(to: CGPoint(x: r.maxX - c, y: r.minY))
            p.addLine(to: CGPoint(x: r.maxX - c, y: r.minY + s)); p.addLine(to: CGPoint(x: r.maxX - s, y: r.minY + s)); p.addLine(to: CGPoint(x: r.maxX - s, y: r.minY + c))
            p.addLine(to: CGPoint(x: r.maxX, y: r.minY + c)); p.addLine(to: CGPoint(x: r.maxX, y: r.maxY - c))
            p.addLine(to: CGPoint(x: r.maxX - s, y: r.maxY - c)); p.addLine(to: CGPoint(x: r.maxX - s, y: r.maxY - s)); p.addLine(to: CGPoint(x: r.maxX - c, y: r.maxY - s))
            p.addLine(to: CGPoint(x: r.maxX - c, y: r.maxY)); p.addLine(to: CGPoint(x: r.minX + c, y: r.maxY))
            p.addLine(to: CGPoint(x: r.minX + c, y: r.maxY - s)); p.addLine(to: CGPoint(x: r.minX + s, y: r.maxY - s)); p.addLine(to: CGPoint(x: r.minX + s, y: r.maxY - c))
            p.addLine(to: CGPoint(x: r.minX, y: r.maxY - c)); p.addLine(to: CGPoint(x: r.minX, y: r.minY + c))
            p.addLine(to: CGPoint(x: r.minX + s, y: r.minY + c)); p.addLine(to: CGPoint(x: r.minX + s, y: r.minY + s)); p.addLine(to: CGPoint(x: r.minX + c, y: r.minY + s)); p.closeSubpath()
        }
    }
}

/// A themed panel: the FireRed dialogue tab carries the title above an inset body in a metal rim.
struct GamePanel<Content: View>: View {
    let title: String
    var symbol: String? = nil
    var accessory: String? = nil
    var contentPadding: CGFloat = 12
    @ViewBuilder var content: Content
    var body: some View {
        GamePaletteReader { palette in
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 4) {
                    HStack(spacing: 5) {
                        if let symbol { Image(systemName: symbol).accessibilityHidden(true) }
                        Text(title.uppercased()).tracking(0.8).lineLimit(1).layoutPriority(1)
                    }.font(.system(size: 11, weight: .semibold))
                        .padding(.horizontal, 10).padding(.vertical, 4)
                        .background(LinearGradient(colors: [Color(hex: 0x203746), palette.dialogue], startPoint: .top, endPoint: .bottom), in: UnevenRoundedRectangle(bottomLeadingRadius: 7, bottomTrailingRadius: 7))
                        .overlay { UnevenRoundedRectangle(bottomLeadingRadius: 7, bottomTrailingRadius: 7).stroke(.white.opacity(0.28), lineWidth: 0.5) }
                        .foregroundStyle(palette.ivory).accessibilityAddTraits(.isHeader)
                    Spacer(minLength: 0)
                    if let accessory { Text(accessory).font(.caption).foregroundStyle(.white).lineLimit(1).padding(.trailing, 6) }
                }.padding(.horizontal, 3).padding(.top, 2).background(palette.titleBar)
                VStack(alignment: .leading, spacing: 10) { content }.padding(contentPadding).frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(LinearGradient(colors: [palette.panel, palette.inset], startPoint: .topLeading, endPoint: .bottomTrailing), in: RoundedRectangle(cornerRadius: 8))
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay { RoundedRectangle(cornerRadius: 8).strokeBorder(palette.metal, lineWidth: 2.5).allowsHitTesting(false) }
            .overlay { RoundedRectangle(cornerRadius: 8).strokeBorder(.white.opacity(0.35), lineWidth: 0.5).padding(0.5).allowsHitTesting(false) }
            .overlay { RoundedRectangle(cornerRadius: 5.5).strokeBorder(Color.black.opacity(0.7), lineWidth: 0.7).padding(3).allowsHitTesting(false) }
            .overlay { GameWindow(corner: 3).stroke(palette.menuEdge.opacity(0.52), lineWidth: 0.5).padding(4).allowsHitTesting(false) }
            .foregroundStyle(palette.text)
        }.accessibilityElement(children: .contain)
    }
}

/// A thin game-style meter (HP, EXP). The number beside it carries the same reading, so color is never the only cue.
struct GameMeter: View {
    let value: Double?
    var color: Color = .green
    let label: String
    let reading: String
    var height: CGFloat = 5
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        GeometryReader { g in
            ZStack(alignment: .leading) {
                Rectangle().fill(Color.black.opacity(scheme == .dark ? 0.6 : 0.2))
                if let value {
                    Rectangle().fill(LinearGradient(stops: [.init(color: color.opacity(0.55), location: 0), .init(color: color, location: 0.35), .init(color: color, location: 1)], startPoint: .top, endPoint: .bottom))
                        .frame(width: g.size.width * max(0, min(1, value)))
                }
            }
            .clipShape(GameWindow(corner: height >= 4 ? 1 : 0.5))
            .overlay { if height >= 4 { GameWindow(corner: 1).stroke(Color(hex: 0xC5CEC2).opacity(0.6), lineWidth: 0.5) } }
        }.frame(height: height).accessibilityElement(children: .ignore).accessibilityLabel(label).accessibilityValue(reading)
    }
    /// The games' HP bar colors: green above half, yellow above a fifth, red below.
    static func hpColor(_ fraction: Double) -> Color { fraction > 0.5 ? Color(hex: 0x37C25A) : fraction > 0.2 ? Color(hex: 0xE8B931) : Color(hex: 0xE5483B) }
    static let experienceColor = Color(hex: 0x3D9BE0)
}

private struct GameTileStyle: ViewModifier {
    var selected = false
    func body(content: Content) -> some View {
        GamePaletteReader { p in
            content.background(LinearGradient(colors: [p.panel, p.inset], startPoint: .topLeading, endPoint: .bottomTrailing), in: GameWindow(corner: 5))
                .overlay { GameWindow(corner: 5).stroke(selected ? p.focus : p.edge, lineWidth: selected ? 2 : 1).allowsHitTesting(false) }
                .overlay { GameWindow(corner: 3).stroke(p.menuEdge.opacity(0.25), lineWidth: 0.5).padding(2).allowsHitTesting(false) }
        }
    }
}

/// The page canvas behind a page's panels (content layer only; bars keep their own material).
private struct GameCanvas: ViewModifier {
    func body(content: Content) -> some View { GamePaletteReader { p in content.background(p.canvas) } }
}

/// An inset well for scrolling page content: the panel body color inside a thin rim.
private struct GameWell: ViewModifier {
    func body(content: Content) -> some View {
        GamePaletteReader { p in
            content.background(p.inset).clipShape(GameWindow(corner: 4))
                .overlay { GameWindow(corner: 4).stroke(p.menuEdge.opacity(0.5), lineWidth: 0.7).allowsHitTesting(false) }
        }
    }
}

extension View {
    func gameTile(selected: Bool = false) -> some View { modifier(GameTileStyle(selected: selected)) }
    func gameCanvas() -> some View { modifier(GameCanvas()) }
    func gameWell() -> some View { modifier(GameWell()) }
    /// A grouped Form shown on a themed page: native rows on the inset well instead of the window's grouped background.
    func gameForm() -> some View { self.formStyle(.grouped).scrollContentBackground(.hidden).gameWell() }
}

/// A GamePanel whose body scrolls: the page's main content under a FireRed title tab.
struct TitledScroll<Content: View>: View {
    let title: String
    var symbol: String? = nil
    @ViewBuilder var content: Content
    var body: some View {
        GamePanel(title: title, symbol: symbol, contentPadding: 0) {
            ScrollView { content.padding(14).frame(maxWidth: .infinity, alignment: .leading) }
                .scrollIndicators(.visible).scrollBounceBehavior(.basedOnSize).frame(maxHeight: .infinity)
        }
    }
}

/// The game screen in a metal bezel. The bezel follows the frame's own aspect ratio, so the
/// screen's edge stays visible against the page however tall or wide the pane is.
struct GameScreenFrame<Screen: View>: View {
    let ratio: CGFloat
    @ViewBuilder var screen: Screen
    var body: some View {
        GamePaletteReader { p in
            screen.aspectRatio(ratio, contentMode: .fit)
                .padding(5)
                .background(p.inset, in: GameWindow(corner: 4))
                .overlay { GameWindow(corner: 4).stroke(p.metal, lineWidth: 2).allowsHitTesting(false) }
                .overlay { GameWindow(corner: 3).stroke(p.edge.opacity(0.5), lineWidth: 0.6).padding(2.5).allowsHitTesting(false) }
                .frame(maxWidth: .infinity)
        }
    }
}

enum GameScreenGeometry {
    /// The screen's aspect ratio: the live frame's own size, else the platform's native screen.
    static func ratio(image: CGImage?, platform: String) -> CGFloat {
        if let image, image.width > 0, image.height > 0 { return CGFloat(image.width) / CGFloat(image.height) }
        switch platform {
        case "gb", "gbc": return 160.0 / 144.0
        case "nds": return 256.0 / 384.0
        case "3ds": return 400.0 / 480.0
        case "switch": return 16.0 / 9.0
        default: return 240.0 / 160.0
        }
    }
}
