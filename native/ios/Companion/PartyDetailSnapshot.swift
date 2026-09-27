import Foundation
import SuiteCore

/// Optional individual facts from the current save. Never treats a saved level,
/// HP, or PP reading as newer than the separate live spectator telemetry.
struct PartyDetailSnapshot {
    struct Move:Identifiable {
        let slot:Int;var id:Int{slot}
        let name:String
        let type:String?
        let pp:Int?
        let maxPP:Int?
        let power:Int?
        let accuracy:Int?
    }
    struct Stat:Identifiable {
        let key:String;var id:String{key}
        let name:String
        let value:Int?
        let iv:Int?
        let ev:Int?
    }
    let id:String
    let savedAt:Date?
    let savedLevel:Int?
    let ability:String?
    let nature:String?
    let sex:String?
    let friendship:Int?
    let types:[String]
    let moves:[Move]
    let stats:[Stat]

    static func ownerID(in session:JSONValue)->String? {
        // A hunt can retain the completed campaign's history while owning a new vault.
        word(session["mission"]["id"]) ?? word(session["campaign"]["id"])
    }

    init?(inventory:JSONValue,party:[JSONValue],index:Int,game:String,sessionID:String,ownerID:String?,expectedID:String?=nil,catalog:JSONValue) {
        guard game=="firered",inventory["game"].string==game,!sessionID.isEmpty,
              inventory["sessionId"].string==sessionID,inventory["sourceId"].string=="current",
              inventory["isActiveSave"].bool,inventory["validity"].string=="valid",
              party.indices.contains(index) else{return nil}
        if let ownerID,!ownerID.isEmpty,inventory["save"]["ownerId"].string != ownerID{return nil}
        let live=PartyMemberPresentation(member:party[index],index:index)
        guard let species=live.speciesID,case .bool(let shiny)=party[index]["shiny"] else{return nil}
        let sameLive=party.filter {
            let p=PartyMemberPresentation(member:$0,index:0)
            return p.speciesID==species && p.shiny==shiny
        }
        guard sameLive.count==1 else{return nil}
        let matches=inventory["pokemon"].array.filter {
            $0["location"]["kind"].string=="party" && Self.number($0["nationalSpeciesId"],min:1)==species && $0["shiny"] == .bool(shiny)
        }
        guard matches.count==1,let record=matches.first,record["validity"].string=="valid",
              !record["identityConflict"].bool,let identifier=Self.word(record["id"]) else{return nil}
        if let expectedID,identifier != expectedID{return nil}
        id=identifier
        let formatter=ISO8601DateFormatter();formatter.formatOptions=[.withInternetDateTime,.withFractionalSeconds]
        savedAt=formatter.date(from:inventory["save"]["updatedAt"].string) ?? ISO8601DateFormatter().date(from:inventory["save"]["updatedAt"].string)
        savedLevel=Self.number(record["level"],min:1,max:100)
        ability=Self.word(record["ability"]["name"]) ?? Self.word(record["ability"])
        nature=Self.word(record["nature"]["name"]) ?? Self.word(record["natureName"]) ?? Self.word(record["nature"])
        let entry=catalog["species"].array.first{$0["id"].int==species} ?? .null
        sex=Self.sex(personality:record["personality"],rate:entry["genderRate"])
        friendship=Self.number(record["friendship"],max:255)
        types=entry["types"].array.compactMap{Self.word($0)?.capitalized}
        let bonus=Self.number(record["ppBonuses"],max:255)
        moves=record["moves"].array.prefix(4).enumerated().compactMap { slot,value in
            guard let moveID=Self.number(value,min:1) else{return nil}
            let data=catalog["moves"].array.first{$0["id"].int==moveID} ?? .null
            let described=record["moveDetails"].array.first{$0["id"].int==moveID} ?? .null
            let base=Self.number(data["pp"],min:1,max:99)
            // FireRed CalculatePPWithBonus: each move keeps its original 2-bit slot.
            let maxPP=base.flatMap{base in bonus.map{base+base*20*(($0>>(slot*2))&3)/100}}
            let ppValues=record["pp"].array
            let pp=slot<ppValues.count ? Self.number(ppValues[slot],max:maxPP ?? 255):nil
            return Move(slot:slot,name:Self.word(data["name"]) ?? Self.word(described["name"]) ?? "Move \(moveID)",type:Self.word(data["type"])?.capitalized,
                        pp:pp,maxPP:maxPP,power:Self.number(data["power"],min:1,max:999),accuracy:Self.number(data["accuracy"],min:1,max:100))
        }
        stats=[("hp","HP"),("attack","Attack"),("defense","Defense"),("spAttack","Sp. Atk"),("spDefense","Sp. Def"),("speed","Speed")].map {key,name in
            Stat(key:key,name:name,value:Self.number(key=="hp" ? record["maxHp"]:record["stats"][key],min:1,max:9999),
                 iv:Self.number(record["ivs"][key],max:31),ev:Self.number(record["evs"][key],max:255))
        }
    }
    // GetGenderFromSpeciesAndPersonality + PERCENT_FEMALE in pret/pokefirered.
    // Pokédex genderRate is eighths female; Gen 3 compares the PID's low byte.
    static func sex(personality:JSONValue,rate:JSONValue)->String? {
        guard let rate=number(rate,min:-1,max:8) else{return nil}
        switch rate {case -1:return "Genderless";case 0:return "Male";case 8:return "Female";default:break}
        guard let pid=number(personality,max:0xffffffff) else{return nil}
        return (pid&255)<rate*255/8 ? "Female":"Male"
    }
    private static func number(_ value:JSONValue,min:Int=0,max:Int=999999)->Int? {
        guard case .number(let n)=value,n.isFinite,n.rounded()==n,n>=Double(min),n<=Double(max) else{return nil}
        return Int(n)
    }
    private static func word(_ value:JSONValue)->String? {
        let text=value.string.trimmingCharacters(in:.whitespacesAndNewlines)
        return text.isEmpty ? nil:text
    }
}
