import SwiftUI

/// FireRed's badge tiles are monochrome. This presentation palette colors the
/// ROM image without replacing its pixels, alpha mask or cartridge palette.
/// Other games keep their own artwork colors.
struct BadgeColors: ViewModifier {
    let game: String
    let kind: String
    let key: String

    func body(content: Content) -> some View {
        if ["firered", "leafgreen"].contains(game), kind == "badges",
           let index = Int(key), (0..<8).contains(index) {
            content.overlay {
                GeometryReader { geometry in
                    palette(index, radius: min(geometry.size.width, geometry.size.height) / 2)
                }.compositingGroup().blendMode(.multiply).accessibilityHidden(true)
            }.mask(content).compositingGroup()
        } else {
            content
        }
    }

    @ViewBuilder private func palette(_ index: Int, radius: CGFloat) -> some View {
        switch index {
        case 0: Color.white // Boulder keeps its silver facets.
        case 1: color(0x64BFFF)
        case 2:
            // The Thunder Badge has an orange center and a gold outer star.
            RadialGradient(stops: [.init(color: color(0xFF803C), location: 0),
                                   .init(color: color(0xFF803C), location: 0.52),
                                   .init(color: color(0xFFE369), location: 0.53),
                                   .init(color: color(0xFFE369), location: 1)],
                           center: .center, startRadius: 0, endRadius: radius)
        case 3:
            // Eight distinct petals; the center stays pearl white.
            AngularGradient(stops: rainbowStops, center: .center,
                            startAngle: .degrees(-112.5), endAngle: .degrees(247.5))
                .overlay {
                    Circle().fill(.white).frame(width: radius * 0.55, height: radius * 0.55)
                }
        case 4: color(0xFF91BE)
        case 5: color(0xFFE071)
        case 6: color(0xFF9771)
        default: color(0x86E99D)
        }
    }

    private var rainbowStops: [Gradient.Stop] {
        let petals: [UInt32] = [0xFF83B2, 0xFFA65F, 0xFFE674, 0xC4EE78,
                                0x83DBBA, 0x77D6EF, 0x8AABFF, 0xC39CF4]
        return petals.enumerated().flatMap { index, rgb in
            [Gradient.Stop(color: color(rgb), location: Double(index) / 8),
             Gradient.Stop(color: color(rgb), location: Double(index + 1) / 8)]
        }
    }

    private func color(_ rgb: UInt32) -> Color {
        Color(red: Double(rgb >> 16 & 255) / 255,
              green: Double(rgb >> 8 & 255) / 255, blue: Double(rgb & 255) / 255)
    }
}
