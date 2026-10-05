import Foundation

/// The Bank's "Get it" configurator for one species. `selection` is exactly the
/// JSON sent to `POST /api/pokemon-suite/requests/select`; the host builds the
/// same goal Ask builds from the equivalent phrase ("get me a shiny timid abra"),
/// so the plan preview, confirmation, queue and cancel are Ask's own
/// (tests/data/bank-parity.json). Only settings the request system accepts appear here.
public struct BankDraft: Equatable, Sendable {
    public static let stats = ["hp", "attack", "defense", "specialAttack", "specialDefense", "speed"]
    /// Gen III Hidden Power types (no Normal), as the host's farming requests name them.
    public static let hiddenPowerTypes = ["fighting", "flying", "poison", "ground", "rock", "bug", "ghost", "steel", "fire", "water", "grass",
                                          "electric", "psychic", "ice", "dragon", "dark"]
    public static let maxQuantity = 99
    /// A goal holds up to 10 steps: the catch plus one trade per Pokémon sent to the Switch.
    public static let maxSwitchQuantity = 9

    public var speciesId: Int
    public var shiny = false
    /// Nature ids in the catalog's order.
    public var natures: [String] = []
    /// nil: any gender.
    public var gender: String?
    /// nil: any of the species' abilities.
    public var abilityId: Int?
    public var hiddenPower: String?
    public var quantity = 1
    /// "save" keeps it in the save; "switch" trades each one to the Switch, one at a time, once caught and saved.
    public var destination = "save"
    private var minimum: [String: Int] = [:]
    private var maximum: [String: Int] = [:]

    public init(speciesId: Int) { self.speciesId = speciesId }

    public func minimumIV(_ stat: String) -> Int { minimum[stat] ?? 0 }
    public func maximumIV(_ stat: String) -> Int { maximum[stat] ?? 31 }
    /// A range is kept valid: raising the minimum above the maximum raises the maximum, and the reverse.
    public mutating func setMinimumIV(_ stat: String, _ value: Int) {
        let value = min(max(value, 0), 31)
        minimum[stat] = value == 0 ? nil : value
        if maximumIV(stat) < value { maximum[stat] = value == 31 ? nil : value }
    }
    public mutating func setMaximumIV(_ stat: String, _ value: Int) {
        let value = min(max(value, 0), 31)
        maximum[stat] = value == 31 ? nil : value
        if minimumIV(stat) > value { minimum[stat] = value == 0 ? nil : value }
    }
    /// Adds or removes a nature, keeping `order` (the catalog's nature ids).
    public mutating func toggleNature(_ id: String, order: [String]) {
        if natures.contains(id) { natures.removeAll { $0 == id } }
        else { natures = order.filter { natures.contains($0) || $0 == id } }
    }
    /// Each Pokémon sent to the Switch is its own trade step in the goal.
    public var canSendToSwitch: Bool { quantity <= Self.maxSwitchQuantity }
    /// Back to keeping it in the save once the Switch is no longer possible (the configurator shows the change).
    public mutating func keepDestinationValid() { if !canSendToSwitch { destination = "save" } }

    /// The genders a species can have (the catalog's gender rate: -1 genderless, 0 male only, 8 female only).
    public static func genders(rate: Int) -> [String] {
        switch rate { case -1: ["genderless"]; case 0: ["male"]; case 8: ["female"]; default: ["male", "female"] }
    }

    public var selection: JSONValue {
        func ivs(_ values: [String: Int]) -> JSONValue { .object(values.mapValues { .number(Double($0)) }) }
        return .object(["speciesId": .number(Double(speciesId)), "shiny": .bool(shiny), "natures": .array(natures.map(JSONValue.string)),
                        "gender": gender.map(JSONValue.string) ?? .null, "abilityId": abilityId.map { .number(Double($0)) } ?? .null,
                        "minIvs": ivs(minimum), "maxIvs": ivs(maximum), "hiddenPower": hiddenPower.map(JSONValue.string) ?? .null,
                        "quantity": .number(Double(quantity)), "destination": .string(destination)])
    }

    /// The plan's search limits (a hunt stops starting new searches at either), from a draft goal's first catch.
    public static func budget(goal: JSONValue) -> String? {
        guard let request = goal["steps"].array.first(where: { $0["kind"].string == "farming" })?["request"] else { return nil }
        let limits = request["limits"]
        guard let minutes = limits["maxMinutes"].finiteNumber, let encounters = limits["maxEncounters"].finiteNumber else { return nil }
        let time = minutes >= 120 && minutes.truncatingRemainder(dividingBy: 60) == 0 ? "\(Int(minutes / 60)) hours" : "\(Int(minutes)) minutes"
        let count = Int(encounters).formatted(.number.grouping(.automatic))
        let each = request["quantity"].int > 1 ? " for each Pokémon" : ""
        return "Search limit: \(time) or \(count) encounters\(each), whichever comes first."
    }
}

/// The Bank overview (`GET /api/pokemon-suite/bank?game=firered`) by species number.
public enum BankIndex {
    public static func species(_ overview: JSONValue) -> [Int: JSONValue] {
        Dictionary(overview["species"].array.map { ($0["id"].int, $0) }, uniquingKeysWith: { first, _ in first })
    }
    /// "Box 3, slot 5" or "Party 2", as Trading names a location.
    public static func location(_ mon: JSONValue) -> String {
        let p = mon["location"]
        return p["kind"].string == "party" ? "Party \(p["slot"].int + 1)" : "Box \(p["box"].int + 1), slot \(p["slot"].int + 1)"
    }
    /// One row per individual in a species' Bank response (backups copy the same Pokémon into several
    /// saves): the active save's copy when it has one, with every other save holding it in "alsoIn".
    public static func individuals(_ owned: JSONValue) -> [JSONValue] {
        var order: [String] = [], copies: [String: [JSONValue]] = [:]
        for mon in owned["pokemon"].array {
            let key = mon["fingerprint"].string.nonempty ?? mon["sourceId"].string + ":" + mon["slotId"].string
            if copies[key] == nil { order.append(key) }
            copies[key, default: []].append(mon)
        }
        return order.map { key in
            let group = copies[key] ?? []
            let index = group.firstIndex { $0["isActiveSave"].bool } ?? 0
            var shown = group[index]
            shown["alsoIn"] = .array(group.enumerated().filter { $0.offset != index }.map { .string("\($0.element["saveLabel"].string) · \(location($0.element))") })
            return shown
        }
    }
    /// "Current game · Box 3, slot 5 · also in 2 other saves"
    public static func whereHeld(_ mon: JSONValue) -> String {
        let others = mon["alsoIn"].array.count
        return "\(mon["saveLabel"].string) · \(location(mon))" + (others == 0 ? "" : others == 1 ? " · also in 1 other save" : " · also in \(others) other saves")
    }
    /// "31/30/29/28/27/26" in HP, Atk, Def, SpA, SpD, Spe order.
    public static func ivs(_ mon: JSONValue) -> String {
        ["hp", "attack", "defense", "spAttack", "spDefense", "speed"].map { mon["ivs"][$0].text }.joined(separator: "/")
    }
    /// "3 owned · 1 shiny · in 2 saves" (nil when none is owned).
    public static func ownership(_ entry: JSONValue) -> String? {
        let owned = entry["owned"].int
        guard owned > 0 else { return nil }
        var parts = ["\(owned) owned"]
        if entry["shiny"].int > 0 { parts.append("\(entry["shiny"].int) shiny") }
        let saves = entry["saves"].int
        if saves > 1 { parts.append("in \(saves) saves") }
        return parts.joined(separator: " · ")
    }
}
