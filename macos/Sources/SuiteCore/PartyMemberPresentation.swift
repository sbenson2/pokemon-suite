import Foundation

/// A display-only projection. A party lead is not proof of the active battler.
public struct PartyMemberPresentation: Identifiable {
    public let slot: Int
    public var id: Int { slot }
    public let speciesID: Int?
    public let name: String
    public let speciesName: String
    public let level: Int?
    public let hp: Int?
    public let maxHP: Int?
    public let status: String?
    public let gender: String?
    public let shiny: Bool
    public let active: Bool
    public let heldItem: Int?
    public let experienceRatio: Double?
    public let experienceRemaining: Int?
    public var hpRatio: Double? {
        guard let hp,let maxHP,maxHP > 0,hp >= 0,hp <= maxHP else{return nil}
        return Double(hp)/Double(maxHP)
    }
    public init(member m: JSONValue,index: Int,battler b: JSONValue = .null) {
        func number(_ v:JSONValue,min:Int=0,max:Int=Int.max-1)->Int? {
            guard case .number(let n)=v,n.isFinite,n >= Double(min),n < Double(Int.max),n <= Double(max),n.rounded()==n else{return nil}
            return Int(n)
        }
        func word(_ values:JSONValue...)->String? { values.map(\.string).first{!$0.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty} }
        slot=number(m["slot"],max:5) ?? index
        speciesID=number(m["speciesId"],min:1) ?? number(m["nationalSpecies"],min:1)
        speciesName=word(m["speciesName"],m["name"]) ?? "Pokémon"
        name=word(m["nickname"]) ?? speciesName
        level=number(m["level"],min:1,max:100)
        active=speciesID != nil && number(b["slot"],max:5)==slot && number(b["speciesId"],min:1)==speciesID
        let health=active && !b["hp"].isNull && !b["maxHp"].isNull ? b:m
        hp=number(health["hp"].object.isEmpty ? health["hp"]:health["hp"]["current"])
        maxHP=number(health["maxHp"].isNull ? health["hp"]["max"]:health["maxHp"],min:1)
        let condition=active && !b["status"].isNull ? b["status"].string:m["status"].string
        status=hp==0 && maxHP != nil ? "Fainted":["FNT":"Fainted","SLP":"Asleep","PSN":"Poisoned","BRN":"Burned","FRZ":"Frozen","PAR":"Paralyzed"][condition.uppercased()]
        gender=["male":"♂","female":"♀","♂":"♂","♀":"♀"][m["gender"].string.lowercased()]
        shiny=m["shiny"].bool
        heldItem=number(m["heldItem"],min:1)
        if case .number(let n)=m["experience"]["ratio"],n.isFinite,(0...1).contains(n) {experienceRatio=n} else {experienceRatio=nil}
        experienceRemaining=number(m["experience"]["remaining"])
    }
}
