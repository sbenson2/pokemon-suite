import Foundation

public struct PokedexFilter: Equatable {
    public var scope: String
    public var query = ""
    public var type = "any"
    /// "all", "encounter", "other"; with the Bank overview also "obtainable" (FireRed can get it) or "external" (it needs another game).
    public var availability = "all"
    /// With the Bank overview: "all", "owned", "shiny" (a shiny is owned) or "missing".
    public var ownership = "all"
    public init(scope: String = "national") { self.scope = scope }
    public func number(_ pokemon: JSONValue) -> Int { scope == "regional" ? pokemon["regionalNumber"].int : pokemon["id"].int }
    /// `bank`: the Bank overview's entries by species number (BankIndex.species).
    public func apply(to species: [JSONValue], bank: [Int: JSONValue] = [:]) -> [JSONValue] {
        let query = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let numeric = Int(query.trimmingCharacters(in: CharacterSet(charactersIn: "#")))
        return species.filter { pokemon in
            let encounters = pokemon["encounters"].array
            let entry = bank[pokemon["id"].int] ?? .null
            guard scope != "regional" || pokemon["regionalNumber"].int > 0,
                  type == "any" || pokemon["types"].array.contains(.string(type)),
                  includes(availability: encounters, route: entry["route"]),
                  ownership == "all" || (ownership == "owned" ? entry["owned"].int > 0 : ownership == "shiny" ? entry["shiny"].int > 0 : entry["owned"].int == 0)
            else { return false }
            return query.isEmpty || pokemon["name"].string.localizedCaseInsensitiveContains(query)
                || numeric == number(pokemon) || numeric == pokemon["id"].int
                || pokemon["types"].array.contains { $0.string.contains(query) }
                || encounters.contains { $0["location"].string.localizedCaseInsensitiveContains(query) }
                || entry["route"]["label"].string.localizedCaseInsensitiveContains(query)
        }.sorted { number($0) < number($1) }
    }
    private func includes(availability encounters: [JSONValue], route: JSONValue) -> Bool {
        switch availability {
        case "encounter": !encounters.isEmpty
        case "other": encounters.isEmpty
        case "obtainable": route["obtainable"].bool
        case "external": route["obtainable"] == .bool(false)
        default: true
        }
    }
}
