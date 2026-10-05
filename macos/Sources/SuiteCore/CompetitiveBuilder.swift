import Foundation

/// What the competitive builder opens with: a species, and optionally one owned
/// individual (an inventory record's `id`) from a save (`current` or a saved
/// collection's source id). The Bank presents the builder with one of these.
public struct CompetitiveBuilderRequest: Identifiable, Hashable, Sendable {
    public let speciesID: Int
    public let pokemonID: String?
    public let sourceID: String
    public var id: String { "\(speciesID):\(pokemonID ?? "-"):\(sourceID)" }

    public init(speciesID: Int, pokemonID: String? = nil, sourceID: String = "current") {
        self.speciesID = speciesID
        self.pokemonID = pokemonID?.isEmpty == false ? pokemonID : nil
        self.sourceID = sourceID.isEmpty ? "current" : sourceID
    }

    /// An inventory record from `/api/pokemon-suite/inventory` (its `nationalSpeciesId` and `id`).
    public init(pokemon: JSONValue, sourceID: String = "current") {
        self.init(speciesID: pokemon["nationalSpeciesId"].int, pokemonID: pokemon["id"].string, sourceID: sourceID)
    }
}

/// An editable target set. Stat keys follow the inventory (`spAttack`, `spDefense`).
public struct BuilderTarget: Equatable, Sendable {
    public static let stats = ["hp", "attack", "defense", "speed", "spAttack", "spDefense"]
    public var speciesID: Int
    public var nature: String?
    public var abilitySlot: Int?
    public var evs: [String: Int]
    public var moves: [Int]
    public var heldItem: Int?
    public var level = 100
    public var hiddenPowerType: String?
    public var minIvs: [String: Int] = [:]
    public var maxIvs: [String: Int] = [:]
    public var shinyRequired = false

    public init(speciesID: Int) {
        self.speciesID = speciesID
        evs = Dictionary(uniqueKeysWithValues: Self.stats.map { ($0, 0) })
        moves = []
    }

    /// A guidance set's `target` (from `/api/pokemon-suite/builder/guidance`).
    public init(target: JSONValue, speciesID: Int) {
        self.init(speciesID: speciesID)
        nature = target["nature"].string.isEmpty ? nil : target["nature"].string
        abilitySlot = target["abilitySlot"].isNull ? nil : target["abilitySlot"].int
        for stat in Self.stats { evs[stat] = target["evs"][stat].int }
        moves = target["moves"].array.map(\.int).filter { $0 > 0 }
        heldItem = target["heldItem"].isNull ? nil : target["heldItem"].int
        level = target["level"].isNull ? 100 : target["level"].int
        hiddenPowerType = target["hiddenPower"]["type"].string.isEmpty ? nil : target["hiddenPower"]["type"].string
        for (stat, range) in target["ivs"].object {
            if !range["min"].isNull { minIvs[stat] = range["min"].int }
            if !range["max"].isNull { maxIvs[stat] = range["max"].int }
        }
        shinyRequired = target["shiny"].string == "required"
    }

    public var evTotal: Int { evs.values.reduce(0, +) }

    public var validation: String? {
        if evTotal > 510 { return "EVs cannot exceed 510 in total." }
        if evs.values.contains(where: { !(0...255).contains($0) }) { return "Each EV must be between 0 and 255." }
        if moves.count > 4 || Set(moves).count != moves.count { return "Choose up to four different moves." }
        if !(1...100).contains(level) { return "Choose a level from 1 to 100." }
        for stat in Self.stats {
            let low = minIvs[stat] ?? 0, high = maxIvs[stat] ?? 31
            if low < 0 || high > 31 || low > high { return "Choose IV ranges between 0 and 31." }
        }
        return nil
    }

    /// The JSON the host's plan and request endpoints validate (`normalize_target`).
    public var json: JSONValue {
        var ranges: [String: JSONValue] = [:]
        for stat in Self.stats where minIvs[stat] != nil || maxIvs[stat] != nil {
            ranges[stat] = .object(["min": .number(Double(minIvs[stat] ?? 0)), "max": .number(Double(maxIvs[stat] ?? 31))])
        }
        return .object([
            "speciesId": .number(Double(speciesID)),
            "nature": nature.map(JSONValue.string) ?? .null,
            "abilitySlot": abilitySlot.map { .number(Double($0)) } ?? .null,
            "ivs": .object(ranges),
            "hiddenPower": hiddenPowerType.map { .object(["type": .string($0)]) } ?? .null,
            "evs": .object(evs.mapValues { .number(Double($0)) }),
            "moves": .array(moves.map { .number(Double($0)) }),
            "heldItem": heldItem.map { .number(Double($0)) } ?? .null,
            "level": .number(Double(level)),
            "shiny": .string(shinyRequired ? "required" : "any"),
        ])
    }
}

/// Paths and bodies of the builder endpoints and the existing ones its steps use.
public enum BuilderAPI {
    public static let planPath = "/api/pokemon-suite/builder/plan"
    public static let requestPath = "/api/pokemon-suite/builder/request"
    public static let farmingPreviewPath = "/api/pokemon-farming/preview"
    public static let commitPath = "/api/pokemon-suite/requests/commit"

    public static func guidancePath(speciesID: Int) -> String { "/api/pokemon-suite/builder/guidance?species=\(speciesID)" }

    public static func individualPath(game: String, source: String, pokemonID: String) -> String {
        "/api/pokemon-suite/builder/individual?game=\(query(game))&source=\(query(source))&pokemon=\(query(pokemonID))"
    }

    public static func legalityPath(game: String, source: String, pokemonID: String? = nil) -> String {
        "/api/pokemon-suite/builder/legality?game=\(query(game))&source=\(query(source))" + (pokemonID.map { "&pokemon=\(query($0))" } ?? "")
    }

    public static func planBody(game: String, request: CompetitiveBuilderRequest, target: BuilderTarget) -> JSONValue {
        .object(["game": .string(game), "sourceId": .string(request.sourceID), "pokemonId": .string(request.pokemonID ?? ""), "target": target.json])
    }

    public static func requestBody(target: BuilderTarget) -> JSONValue { .object(["target": target.json]) }

    /// The shared request/goal path commits a Goal v1 document under a fresh key.
    public static func commitBody(goal: JSONValue, key: String = "builder-" + UUID().uuidString.lowercased()) -> JSONValue {
        .object(["goal": goal, "idempotencyKey": .string(key)])
    }

    /// A plan step the bot can start through `/api/pokemon-suite/player-tasks` (its `task`), or nil.
    public static func playerTask(step: JSONValue) -> JSONValue? {
        guard step["executable"].bool, step["action"]["path"].string == "/api/pokemon-suite/player-tasks",
              step["action"]["body"]["action"].string == "start", !step["action"]["body"]["task"].isNull else { return nil }
        return step["action"]["body"]["task"]
    }

    private static func query(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: .alphanumerics.union(CharacterSet(charactersIn: "-_"))) ?? value
    }
}

/// Words and symbols the builder shows next to verdicts and checks.
public enum BuilderPresentation {
    public static func statLabel(_ key: String) -> String {
        ["hp": "HP", "attack": "Attack", "defense": "Defense", "speed": "Speed", "spAttack": "Sp. Atk", "spDefense": "Sp. Def"][key] ?? key
    }

    public static func verdictSymbol(_ verdict: String) -> String {
        switch verdict {
        case "legal": return "checkmark.seal"
        case "suspicious": return "exclamationmark.triangle"
        case "illegal": return "xmark.octagon"
        default: return "questionmark.circle"
        }
    }

    public static func severitySymbol(_ severity: String) -> String {
        switch severity {
        case "valid": return "checkmark.circle"
        case "fishy": return "exclamationmark.triangle"
        case "invalid": return "xmark.circle"
        default: return "questionmark.circle"
        }
    }

    public static func severityLabel(_ severity: String) -> String {
        ["valid": "Passed", "fishy": "Suspicious", "invalid": "Failed"][severity] ?? "Not checked"
    }

    /// A readable value for a trait (numbers, objects of stats, lists of named entries).
    public static func traitValue(_ value: JSONValue) -> String {
        switch value {
        case .object(let fields):
            if Set(fields.keys) == Set(BuilderTarget.stats) {
                return BuilderTarget.stats.map { "\(statLabel($0)) \(fields[$0]?.int ?? 0)" }.joined(separator: " · ")
            }
            return ["location", "level", "game", "ball"].compactMap { key in
                guard let entry = fields[key], !entry.isNull else { return nil }
                return key == "level" ? "Lv. \(entry.text)" : entry.text
            }.joined(separator: " · ")
        case .array(let entries):
            let names = entries.map { $0["name"].string.isEmpty ? $0.text : $0["name"].string + ($0["how"].string.isEmpty ? "" : " (\($0["how"].string))") }
            return names.isEmpty ? "—" : names.joined(separator: ", ")
        default:
            return value.text
        }
    }
}
