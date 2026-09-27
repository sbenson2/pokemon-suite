import SwiftUI
import SuiteCore

enum TrainerCharacter: Equatable {
    case male, female, unknown
    init(gender: JSONValue) {
        switch gender {
        case .number(0): self = .male
        case .number(1): self = .female
        case .string(let text):
            switch text.trimmingCharacters(in: .whitespacesAndNewlines).uppercased() {
            case "BOY", "MALE", "0": self = .male
            case "GIRL", "FEMALE", "1": self = .female
            default: self = .unknown
            }
        default: self = .unknown
        }
    }
    var key: String? { switch self { case .male: "male"; case .female: "female"; case .unknown: nil } }
    var label: String { switch self { case .male: "Male trainer"; case .female: "Female trainer"; case .unknown: "Trainer character unavailable" } }
}

struct TrainerPortrait: View {
    let character: TrainerCharacter
    let size: CGFloat
    var body: some View {
        Group {
            if let key = character.key { ROMAsset(kind: "trainer", key: key, size: size, fallback: "person.crop.square", label: character.label) }
            else { Image(systemName: "person.crop.square").font(.system(size: size * 0.4)).foregroundStyle(.secondary).frame(width: size, height: size) }
        }.id(character.key ?? "unknown")
    }
}
