import Foundation

public enum BotRunStatus: Equatable {
    case offline, reconnecting, ready, running, waiting, paused, blocked
    public init(session: JSONValue) {
        if session["state"].string == "reconnecting" { self = .reconnecting }
        else if session["sessionId"].string.isEmpty || ["offline", "closed"].contains(session["state"].string) { self = .offline }
        else if ["blocked", "failed"].contains(session["state"].string) || ["blocked", "failed"].contains(session["bot"]["status"].string) { self = .blocked }
        else if session["bot"]["awaitingCommand"].bool { self = .ready }
        // Enabled but with nothing it can do yet (PC space, a partner game, another save): not "running".
        else if session["bot"]["enabled"].bool && session["bot"]["status"].string == "waiting" { self = .waiting }
        else if session["bot"]["enabled"].bool { self = .running }
        else { self = .paused }
    }
    public var label: String {
        switch self { case .offline: "Game stopped"; case .reconnecting: "Reconnecting…"; case .ready: "Ready for a command"; case .running: "Bot running"; case .waiting: "Bot waiting"; case .paused: "Bot paused"; case .blocked: "Needs attention" }
    }
}

public enum HuntWorkflow {
    public enum StartStage { case hunt, acquisition, evolution, complete }
    public static let activeStates: Set<String> = ["running", "queued", "preparing-evolution", "preparing"]
    public static func canStart(plan: JSONValue, record: JSONValue = .null) -> Bool {
        let state = record["state"].string
        return (plan["canStart"].bool || plan["canStartSource"].bool || plan["canContinue"].bool)
            && !activeStates.contains(state) && state != "complete"
            && (state != "waiting-for-evolution" || plan["canContinue"].bool)
    }
    public static func startStage(_ response: JSONValue) -> StartStage {
        if response["stage"].string == "source" { return .acquisition }
        if response["stage"].string == "evolution-preparation" { return .evolution }
        if response["session"]["mission"]["state"].string == "complete" { return .complete }
        return .hunt
    }
    public static func startMessage(_ response: JSONValue) -> String {
        switch startStage(response) {
        case .acquisition: "Acquisition started. Evolution and required trades follow after the source Pokémon is saved."
        case .evolution: "Preparing the evolution and its game requirements."
        case .complete: "This hunt is already complete."
        case .hunt: "Hunt started."
        }
    }
    public static func startLabel(plan: JSONValue, record: JSONValue = .null) -> String {
        if plan["canContinue"].bool { return "Prepare Evolution" }
        if plan["canStartSource"].bool { return "Start Acquisition" }
        return record["execution"].isNull ? "Start Hunt" : "Resume Hunt"
    }
}

public struct HuntProgress {
    public let mission: JSONValue
    public let active: Bool
    public let stale: Bool
    public let elapsedMilliseconds: Double?
    public let phaseMilliseconds: Double?
    public let inputProgress: Double?
    public let protected: Bool
    public let stage: Int
    public let stageMilliseconds: [Double?]
    public static let stageNames = ["Prepare", "Calculate", "Encounter", "Capture", "Save"]

    public init?(session: JSONValue, nowMilliseconds: Double) {
        let mission = session["mission"]
        guard !mission.isNull else { return nil }
        self.mission = mission
        let timing = mission["timing"], rng = mission["rng"]
        active = mission["state"].string == "running" && mission["phase"].string != "complete"
            && (session["bot"]["enabled"].isNull || session["bot"]["enabled"].bool)
        let age = timing["asOf"].finiteNumber.map { max(0, nowMilliseconds - $0) } ?? 0
        stale = active && !timing["asOf"].isNull && age > 10_000
        let extra = active && timing["active"].bool ? min(10_000, age) : 0
        elapsedMilliseconds = (timing["elapsedMs"].finiteNumber ?? mission["elapsedMs"].finiteNumber).map { $0 + extra }
        phaseMilliseconds = timing["phaseElapsedMs"].finiteNumber.map { $0 + extra }
        if mission["phase"].string == "timing-shiny", let total = rng["total"].finiteNumber, total > 0, let complete = rng["completed"].finiteNumber {
            inputProgress = max(0, min(1, complete / total))
        } else { inputProgress = nil }
        protected = mission["protected"].bool
        let stage = Self.stage(for: mission["phase"].string)
        self.stage = stage
        stageMilliseconds = (0..<5).map { index in
            guard !timing["stages"].isNull else { return nil }
            return timing["stages"].object.filter { Self.stage(for: $0.key) == index }.values.compactMap(\.finiteNumber).reduce(0, +) + (stage == index ? extra : 0)
        }
    }
    private static func stage(for phase: String) -> Int {
        if phase.contains("planning-rng") { return 1 }
        if ["timing-shiny", "hunting", "resetting", "interacting", "encounter"].contains(where: phase.contains) { return 2 }
        if ["capture", "catch", "battle", "shiny"].contains(where: phase.contains) { return 3 }
        if ["sav", "complete"].contains(where: phase.contains) { return 4 }
        return 0
    }
    public static func methodName(_ method: String) -> String {
        ["current-state":"Current game timing", "teachy-tv":"Teachy TV timing", "title-timing":"Title-screen timing", "title-seed":"Title-seed timing", "seed-search":"Seed search", "calibrated-static":"Static encounter timing", "static-reset":"Static resets", "wild-land":"Wild encounters", "safari-land":"Safari encounters", "random-encounters":"Random encounters", "automatic":"Comparing methods"][method] ?? readableGameText(method)
    }
}

public func readableGameText(_ text: String) -> String {
    if text.contains(" ") { return text }
    let words = text.replacingOccurrences(of: "MAP_", with: "").replacingOccurrences(of: "_", with: " ").replacingOccurrences(of: "-", with: " ").capitalized
    return words.split(separator: " ").map { ["Hm", "Tm", "Pp", "Pc", "Rng"].contains(String($0)) ? $0.uppercased() : String($0) }.joined(separator: " ")
}

public extension JSONValue {
    var finiteNumber: Double? { if case .number(let value) = self, value.isFinite { return value }; return nil }
}
