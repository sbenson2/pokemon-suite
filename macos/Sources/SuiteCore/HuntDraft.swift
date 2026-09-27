import Foundation

/// Editable hunt requirements. Storage uses the same request format as the
/// service, so reopening a saved hunt and reopening a draft follow one path.
public struct HuntDraft: Equatable, Sendable {
    public var shiny = false
    public var quantity = 1
    public var natures: [String] = []
    public var nature: String {
        get { natures.first ?? "any" }
        set { natures = newValue == "any" ? [] : [newValue] }
    }
    public var gender = "any"
    public var ball = "any"
    public var strictBall = false
    public var location = "any"
    public var nickname = ""
    public var ability = 0
    public var heldItem = 0
    public var finalLevel = 0
    public var minimumLevel = 1
    public var maximumLevel = 100
    public var moveIDs = Set<Int>()
    public var ivs: [String: Int] = [:]
    public var maxIvs: [String: Int] = [:]
    public var dvs: [String: Int] = [:]
    public var minutes = 60
    public var encounters = 1000
    public var reserve = 10
    public var spend = 5000
    public var tradeAfter = false
    public var competitive: JSONValue = .null

    public init(defaults: JSONValue) {
        shiny = defaults["shiny"].string == "required"
        natures = defaults["natures"].array.compactMap { $0.string.nonempty }
        gender = defaults["gender"].string.nonempty ?? "any"
        ball = defaults["ball"]["id"].string.nonempty ?? "any"
        strictBall = defaults["ball"]["requirement"].string == "required"
        ivs = defaults["minIvs"].object.mapValues(\.int)
        maxIvs = defaults["maxIvs"].object.mapValues(\.int)
        dvs = defaults["minDvs"].object.mapValues(\.int)
        if !defaults["limits"]["maxMinutes"].isNull { minutes = defaults["limits"]["maxMinutes"].int }
        if !defaults["limits"]["maxEncounters"].isNull { encounters = defaults["limits"]["maxEncounters"].int }
        if !defaults["limits"]["minBalls"].isNull { reserve = defaults["limits"]["minBalls"].int }
        if !defaults["limits"]["maxSpend"].isNull { spend = defaults["limits"]["maxSpend"].int }
        tradeAfter = defaults["afterCompletion"].string == "prepare-trade"
    }

    public init(request: JSONValue) {
        self.init(defaults: request)
        quantity = request["quantity"].isNull ? 1 : request["quantity"].int
        location = request["locationId"].string.nonempty ?? "any"
        nickname = request["nickname"].string
        ability = request["abilityId"].int
        heldItem = request["heldItemId"].int
        finalLevel = request["finalLevel"].int
        minimumLevel = request["encounterLevel"]["min"].isNull ? 1 : request["encounterLevel"]["min"].int
        maximumLevel = request["encounterLevel"]["max"].isNull ? 100 : request["encounterLevel"]["max"].int
        moveIDs = Set(request["moves"].array.map(\.int))
        competitive = request["competitive"]
    }

    public func request(game: String, speciesID: Int, generation: Int) -> JSONValue {
        var result: JSONValue = .object([
            "schema": .string(competitive.isNull ? "pokemon-suite/farming-request/v1" : "pokemon-suite/farming-request/v2"),
            "game": .string(game), "speciesId": .number(Double(speciesID)), "quantity": .number(Double(quantity)),
            "locationId": .string(location), "shiny": .string(shiny ? "required" : "any"),
            "natures": .array(generation < 3 ? [] : natures.map(JSONValue.string)), "gender": .string(gender),
            "nickname": nickname.isEmpty ? .null : .string(nickname), "abilityId": generation < 3 || ability == 0 ? .null : .number(Double(ability)),
            "ball": .object(["id": .string(ball), "requirement": .string(strictBall ? "required" : "preferred")]),
            "minIvs": .object(generation >= 3 ? ivs.mapValues { .number(Double($0)) } : [:]),
            "minDvs": .object(generation == 2 ? dvs.mapValues { .number(Double($0)) } : [:]),
            "encounterLevel": .object(["min": .number(Double(minimumLevel)), "max": .number(Double(maximumLevel))]),
            "finalLevel": finalLevel == 0 ? .null : .number(Double(finalLevel)),
            "moves": .array(moveIDs.sorted().map { .number(Double($0)) }), "heldItemId": heldItem == 0 ? .null : .number(Double(heldItem)),
            "limits": .object(["maxEncounters": .number(Double(encounters)), "maxMinutes": .number(Double(minutes)), "minBalls": .number(Double(reserve)), "maxSpend": .number(Double(spend))]),
            "afterCompletion": .string(tradeAfter ? "prepare-trade" : "stop-save")
        ])
        if !competitive.isNull { result["competitive"] = competitive }
        if generation >= 3 && !maxIvs.isEmpty { result["maxIvs"] = .object(maxIvs.mapValues { .number(Double($0)) }) }
        return result
    }
}

public final class HuntDraftStore {
    private let url: URL
    private var entries: [String: JSONValue] = [:]
    public init(url: URL) throws {
        self.url = url
        if FileManager.default.fileExists(atPath: url.path) {
            let file = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: url))
            guard file["schema"].string == "pokemon-suite/native-hunt-drafts/v1" else { throw SuiteError("The saved hunt drafts use an unsupported format.") }
            entries = file["drafts"].object
        }
    }
    public func load(game: String, speciesID: Int, defaults: JSONValue) -> HuntDraft {
        entries["\(game):\(speciesID)"].map(HuntDraft.init(request:)) ?? HuntDraft(defaults: defaults)
    }
    public func save(_ draft: HuntDraft, game: String, speciesID: Int, generation: Int) throws {
        var next = entries
        next["\(game):\(speciesID)"] = draft.request(game: game, speciesID: speciesID, generation: generation)
        let data = try JSONEncoder().encode(JSONValue.object(["schema": .string("pokemon-suite/native-hunt-drafts/v1"), "drafts": .object(next)]))
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try data.write(to: url, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
        entries = next
    }
}
