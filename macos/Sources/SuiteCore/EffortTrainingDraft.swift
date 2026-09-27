import Foundation

public struct EffortTrainingDraft {
    public static let stats = ["hp", "attack", "defense", "speed", "spAttack", "spDefense"]
    public var pokemon: JSONValue
    public var evs: [String: Int]
    public var minIvs: [String: Int] = [:]
    public var maxIvs: [String: Int] = [:]
    public init(pokemon: JSONValue = .null) {
        self.pokemon = pokemon
        evs = Dictionary(uniqueKeysWithValues: Self.stats.map { ($0, pokemon["evs"][$0].int) })
    }
    public var validation: String? {
        if pokemon["fingerprint"].string.isEmpty { return "Choose a Pokémon from the current game." }
        if evs.values.reduce(0, +) > 510 { return "EV targets cannot exceed 510 in total." }
        for stat in Self.stats {
            let target = evs[stat] ?? 0
            if !(0...255).contains(target) { return "Each EV target must be between 0 and 255." }
            if pokemon["evs"][stat].isNull { return "The current EVs could not be verified." }
            if target < pokemon["evs"][stat].int { return "FireRed cannot remove EVs. Choose a fresh individual or reset its EVs in Emerald first." }
            let low = minIvs[stat] ?? 0, high = maxIvs[stat] ?? 31
            if low < 0 || high > 31 || low > high { return "Choose IV ranges between 0 and 31." }
            if pokemon["ivs"][stat].isNull || !(low...high).contains(pokemon["ivs"][stat].int) { return "This Pokémon does not meet the IV range. IVs cannot be trained in FireRed." }
            if pokemon["level"].int >= 100 && target > pokemon["evs"][stat].int { return "Level 100 Pokémon cannot gain battle EVs in FireRed." }
        }
        return nil
    }
    public var request: JSONValue {
        let ranges = Dictionary(uniqueKeysWithValues: Self.stats.filter { minIvs[$0] != nil || maxIvs[$0] != nil }.map { stat in
            (stat, JSONValue.object(["min": .number(Double(minIvs[stat] ?? 0)), "max": .number(Double(maxIvs[stat] ?? 31))]))
        })
        return .object(["kind": .string("ev-training"), "fingerprint": pokemon["fingerprint"],
                        "evs": .object(evs.mapValues { .number(Double($0)) }), "ivRanges": .object(ranges)])
    }
}
