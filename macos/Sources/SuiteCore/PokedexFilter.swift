import Foundation

public struct PokedexFilter: Equatable {
    public var scope: String
    public var query = ""
    public var type = "any"
    public var availability = "all"
    public init(scope: String = "national") { self.scope = scope }
    public func number(_ pokemon: JSONValue) -> Int { scope == "regional" ? pokemon["regionalNumber"].int : pokemon["id"].int }
    public func apply(to species: [JSONValue]) -> [JSONValue] {
        let query = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let numeric = Int(query.trimmingCharacters(in: CharacterSet(charactersIn: "#")))
        return species.filter { pokemon in
            let encounters = pokemon["encounters"].array
            guard scope != "regional" || pokemon["regionalNumber"].int > 0,
                  type == "any" || pokemon["types"].array.contains(.string(type)),
                  availability == "all" || (availability == "encounter" ? !encounters.isEmpty : encounters.isEmpty) else { return false }
            return query.isEmpty || pokemon["name"].string.localizedCaseInsensitiveContains(query)
                || numeric == number(pokemon) || numeric == pokemon["id"].int
                || pokemon["types"].array.contains { $0.string.contains(query) }
                || encounters.contains { $0["location"].string.localizedCaseInsensitiveContains(query) }
        }.sorted { number($0) < number($1) }
    }
}
