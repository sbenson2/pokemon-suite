import Foundation

public struct PCInventoryFilter {
    public var query = ""
    public var appearance = "all"
    public var type = "all"
    public var location = "all"
    public init() {}
    public func includes(_ pokemon: JSONValue) -> Bool {
        if appearance == "shiny" && !pokemon["shiny"].bool { return false }
        if appearance == "normal" && pokemon["shiny"].bool { return false }
        if type != "all" && !pokemon["types"].array.contains(where: { $0.string == type }) { return false }
        if location == "party" && pokemon["location"]["kind"].string != "party" { return false }
        if let box = Int(location), pokemon["location"]["kind"].string != "box" || pokemon["location"]["box"].int != box { return false }
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return needle.isEmpty || [pokemon["name"].string, pokemon["nickname"].string, pokemon["nationalSpeciesId"].text]
            .contains { $0.localizedStandardContains(needle) }
    }
}
