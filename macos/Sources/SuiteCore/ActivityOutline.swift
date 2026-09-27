import Foundation

public struct ActivityMeter: Equatable {
    public let value: Double
    public let total: Double
    public let label: String
}

public struct ActivityGoal: Equatable {
    public let title: String
    public let detail: String?
    public let meter: ActivityMeter?
    public let notes: [String]
    /// National species shown as artwork, e.g. an evolution's source and target.
    public let species: [Int]
}

public enum ActivityStepState: Equatable { case done, current, upcoming }

public struct ActivityStep: Identifiable, Equatable {
    public let id: String
    public let title: String
    public let detail: String?
    public let state: ActivityStepState
}

public struct ActivityRoute: Equatable {
    public let destination: String
    public let next: String?
    public let steps: Int?
    public let mode: String?
    /// Maps already crossed toward this destination, oldest first.
    public let trail: [String]
}

public enum ActivityChecklistState: Equatable { case done, active, pending, waiting, unavailable }

public struct ActivityChecklistItem: Identifiable, Equatable {
    public let id: String
    public let label: String
    public let state: ActivityChecklistState
    public let note: String?
}

public struct ActivityAgenda: Equatable {
    public let items: [ActivityChecklistItem]
    public var completed: Int { items.filter { $0.state == .done }.count }
    public var total: Int { items.count }
    /// Runnable goals after the active one, in the agenda's priority order.
    public var upNext: [ActivityChecklistItem] {
        let start = items.firstIndex { $0.state == .active }.map { $0 + 1 } ?? 0
        return Array(items[start...].filter { $0.state == .pending }.prefix(3))
    }
    /// Unfinished goals the agenda cannot run now, with the published reason.
    public var notNow: [ActivityChecklistItem] { items.filter { [.waiting, .unavailable].contains($0.state) && $0.note != nil } }
}

/// The goal hierarchy behind the current action: the long-running goal, the
/// task serving it, the task's steps and the route being travelled. Built only
/// from published telemetry. A step counts as done only when the party or the
/// task's own position proves it; nothing is estimated.
public struct ActivityOutline: Equatable {
    public var goalKind = "Goal"
    public var goal: ActivityGoal?
    public var task: ActivityGoal?
    public var plan: [ActivityStep] = []
    public var route: ActivityRoute?
    /// How the current step is being carried out, from the latest decisions.
    public var method: String?
    public var agenda: ActivityAgenda?
    /// The owner's request (a goal from "Ask the bot") the goal supervisor is working on.
    public var request: ActivityGoal?

    public init() {}

    init(session s: JSONValue, catalog: JSONValue, now date: Date) {
        let bot = s["bot"], postgame = s["postgame"], party = s["spectator"]["party"].array
        if bot["runScope"].string == "postgame" {
            if !postgame["entries"].array.isEmpty { agenda = Self.agenda(postgame, now: date) }
            if let entry = postgame["entries"].array.first(where: { $0["id"] == postgame["active"] }), let label = entry["label"].string.nonempty {
                goalKind = "Postgame goal"
                goal = Self.postgameGoal(label, id: entry["id"].string, postgame: postgame)
            }
            dexEvolution(s, catalog: catalog, party: party)
        } else if let label = s["campaign"]["storyProgress"]["current"]["label"].string.nonempty {
            let story = s["campaign"]["storyProgress"]
            goalKind = "Story goal"
            var notes: [String] = []
            if story["badges"]["known"].int > 0, let earned = story["badges"]["earned"].finiteNumber, let total = story["badges"]["total"].finiteNumber {
                notes.append("\(Self.count(earned)) of \(Self.count(total)) badges verified")
            }
            goal = ActivityGoal(title: label, detail: story["current"]["detail"].string.nonempty,
                                meter: Self.meter(story["completed"], story["total"]) { "\($0) of \($1) story checkpoints" }, notes: notes, species: [])
        }
        route = Self.route(s)
        method = Self.method(s)
        request = Self.request(s["goals"])
    }

    /// `session.goals`: the active goal, else one waiting for the owner's decision.
    private static func request(_ value: JSONValue) -> ActivityGoal? {
        guard let goals = SuiteGoals(summary: value), let goal = goals.current else { return nil }
        var notes = [goal.progressLine]
        if goals.queued > 0 { notes.append(goals.queued == 1 ? "1 more request queued" : "\(goals.queued) more requests queued") }
        let waiting = goals.decisions.count - (goals.active == nil ? 1 : 0)
        if waiting > 0 { notes.append(waiting == 1 ? "1 more request needs your decision" : "\(waiting) more requests need your decision") }
        return ActivityGoal(title: goal.text.nonempty.map { "“\($0)”" } ?? "Your request", detail: goal.question ?? goal.detail,
                            meter: nil, notes: notes, species: [])
    }

    private static func postgameGoal(_ label: String, id: String, postgame: JSONValue) -> ActivityGoal {
        let dex = postgame["progress"]["dex"]
        guard id == "national-collection", dex["known"] != .bool(false) else {
            return ActivityGoal(title: label, detail: nil, meter: nil, notes: [], species: [])
        }
        var notes: [String] = []
        if let caught = dex["kanto"]["caught"].finiteNumber, let total = dex["kanto"]["total"].finiteNumber { notes.append("Kanto Pokédex \(count(caught)) of \(count(total))") }
        if let caught = dex["diploma"]["caught"].finiteNumber, let total = dex["diploma"]["total"].finiteNumber { notes.append("Oak’s diploma \(count(caught)) of \(count(total))") }
        return ActivityGoal(title: label, detail: nil, meter: meter(dex["caught"], dex["total"]) { "\($0) of \($1) species registered" }, notes: notes, species: [])
    }

    /// A National Pokédex evolution task: the missing species, the owned
    /// Pokémon that evolves into it, and the steps the evolution controller runs.
    private mutating func dexEvolution(_ s: JSONValue, catalog: JSONValue, party: [JSONValue]) {
        let bot = s["bot"], postgame = s["postgame"], objective = bot["objective"], prep = bot["preparation"]
        let target = postgame["workflows"]["dex"]["target"]
        guard target["method"].string == "evolution", objective["identityEvolution"].bool, let targetID = Self.integer(target["speciesId"]) else { return }
        let entry = postgame["progress"]["species"].array.first { $0["speciesId"].int == targetID }
            ?? postgame["collection"].array.first { $0["speciesId"].int == targetID }
        let rule = entry?["requirements"] ?? .null
        guard let sourceID = Self.integer(entry?["fromSpecies"] ?? .null) ?? Self.integer(rule["fromSpecies"]) else { return }
        let source = Self.species(sourceID, catalog: catalog), result = Self.species(targetID, catalog: catalog)
        let member = party.first { $0["speciesId"].int == sourceID }
        let level = prep["progress"]["level"].finiteNumber ?? member?["level"].finiteNumber
        let required = prep["progress"]["required"].finiteNumber ?? rule["level"].finiteNumber
        let item = rule["item"]["name"].string.nonempty, held = rule["heldItem"]["name"].string.nonempty
        let friendship = !rule["friendship"].isNull && rule["friendship"] != .bool(false)
        var how: String
        if let item { how = "evolves with a \(item)" }
        else if let held { how = "evolves when traded holding a \(held)" }
        else if rule["trigger"].string == "trade" { how = "evolves when traded" }
        else if friendship { how = "evolves when it levels up with high friendship" }
        else if let required { how = "evolves at level \(Self.count(required))" }
        else { how = "can evolve" }
        var notes: [String] = []
        if let remaining = member?["experience"]["remaining"].finiteNumber, remaining > 0, let current = level {
            notes.append("\(Self.count(remaining)) XP to level \(Self.count(current + 1))")
        }
        var meter: ActivityMeter?
        if objective["target"]["kind"].string == "friendship-walk", let value = prep["progress"]["friendship"].finiteNumber {
            // Generation III friendship evolutions happen at 220 or more.
            let threshold = rule["friendship"].finiteNumber ?? 220
            meter = ActivityMeter(value: min(value, threshold), total: threshold, label: "Friendship \(Self.count(value)) of \(Self.count(threshold))")
        } else if let level, let required, required > 0 {
            meter = ActivityMeter(value: min(level, required), total: required, label: "Level \(Self.count(level)) of \(Self.count(required))")
        }
        task = ActivityGoal(title: "Evolve \(source) into \(result)", detail: "\(result) isn’t registered yet. \(source) \(how).",
                            meter: meter, notes: notes, species: [sourceID, targetID])

        // Steps follow the evolution controller's order; which ones apply comes
        // from the species rule. The objective suffix names the running step.
        var steps: [(id: String, title: String)] = [("party", "Have \(source) in the party")]
        if friendship { steps.append(("friendship", "Raise \(source)’s friendship")) }
        if let required, rule["trigger"].string != "trade", item == nil { steps.append(("level", "Train \(source) to level \(Self.count(required))")) }
        if let item { steps.append(("item", "Use a \(item) on \(source)")) }
        steps.append(("evolve", "Evolve into \(result)"))
        steps.append(("save", "Save the game to register \(result)"))
        let id = objective["id"].string, request = prep["requestId"].string
        let suffix = !request.isEmpty && id.hasPrefix("evolution-\(request)-") ? String(id.dropFirst("evolution-\(request)-".count)) : ""
        var running: String? = switch suffix {
        case "withdraw": "party"
        case "remove-trade-everstone", "remove-item", "give-item": "party"
        case "friendship": "friendship"
        case "train", "prepare-stats", "final-level-candy", "final-level-training": "level"
        case "use-item": "item"
        case "save", "save-final-setup": "save"
        default: nil
        }
        let evolved = party.contains { $0["speciesId"].int == targetID }
        if s["mode"].string == "evolution" { running = "evolve" }
        if evolved { running = "save" }
        if running == nil { running = member == nil ? "party" : steps.contains { $0.id == "level" } && (level ?? 0) < (required ?? 0) ? "level" : "evolve" }
        let index = steps.firstIndex { $0.id == running } ?? 0
        plan = steps.enumerated().map { offset, step in
            let state: ActivityStepState = offset < index ? .done : offset == index ? .current : .upcoming
            var detail: String?
            if state == .current, step.id == "party", suffix == "withdraw" { detail = "Withdrawing it from the PC" }
            if state == .current, step.id == "party", suffix.contains("item") || suffix.contains("everstone") { detail = "Adjusting its held item first" }
            return ActivityStep(id: step.id, title: step.title, detail: detail, state: state)
        }
    }

    private static func agenda(_ postgame: JSONValue, now: Date) -> ActivityAgenda {
        let active = postgame["active"].string
        return ActivityAgenda(items: postgame["entries"].array.map { entry in
            let id = entry["id"].string, label = entry["label"].string.nonempty ?? readableGameText(id)
            let retryAt = entry["retry"]["retryAt"].finiteNumber.map { Date(timeIntervalSince1970: $0 / 1000) }
            let reason = entry["reason"].string.nonempty
            if entry["status"].string == "complete" { return .init(id: id, label: label, state: .done, note: nil) }
            if id == active { return .init(id: id, label: label, state: .active, note: nil) }
            if entry["status"].string != "pending" || entry["executable"] == .bool(false) {
                return .init(id: id, label: label, state: .unavailable, note: entry["conditional"].bool ? nil : reason)
            }
            if let retryAt, retryAt > now {
                let why = entry["retry"]["reason"].string.nonempty.map { $0.hasSuffix(".") ? $0 : $0 + "." }
                return .init(id: id, label: label, state: .waiting, note: [why, "Retrying at \(retryAt.formatted(date: .omitted, time: .shortened))."].compactMap { $0 }.joined(separator: " "))
            }
            return .init(id: id, label: label, state: .pending, note: nil)
        })
    }

    /// The trip in progress: the current recommendation when it is travel,
    /// otherwise the newest published travel decision for the same objective.
    private static func route(_ s: JSONValue) -> ActivityRoute? {
        let feed = s["decisionFeed"]["entries"].array, objective = s["bot"]["objective"]["id"].string
        var travel = s["decision"]["recommendation"]
        if travel["targetMap"].string.isEmpty && !travel["objective"].string.hasPrefix("fly-to-") {
            travel = feed.reversed().first { e in
                e["decision"]["kind"].string == "act" && e["campaignId"].string == objective
                    && (!e["decision"]["recommendation"]["targetMap"].string.isEmpty || e["decision"]["recommendation"]["objective"].string.hasPrefix("fly-to-"))
            }?["decision"]["recommendation"] ?? .null
        }
        if travel["objective"].string.hasPrefix("fly-to-") {
            let section = String(travel["objective"].string.dropFirst("fly-to-".count)).replacingOccurrences(of: "MAPSEC_", with: "")
            return ActivityRoute(destination: place(section) ?? "the selected town", next: nil, steps: nil, mode: "Flying", trail: [])
        }
        guard let targetMap = travel["targetMap"].string.nonempty, let destination = place(targetMap) else { return nil }
        // Walking to a spot on the current map is part of the task, not a trip.
        if targetMap == s["map"].string && travel["transit"].isNull { return nil }
        let transit = travel["transit"], via = place(transit["destinationMap"])
        let next: String? = switch transit["kind"].string {
        case "connection": via.map { name in transit["direction"].string.nonempty.map { "\($0.capitalized) exit to \(name)" } ?? "Exit to \(name)" }
        case "warp": via.map { "Enter \($0)" }
        case "ledge": "Jump down the ledge"
        default: nil
        }
        let mode: String? = switch travel["travelMode"].string {
        case "run": "Running"
        case "walk": "Walking"
        case "bike", "cycle", "cycling": "Cycling"
        case "surf": "Surfing"
        default: nil
        }
        var trail: [String] = []
        for entry in feed where entry["decision"]["recommendation"]["targetMap"].string == targetMap {
            if let map = place(entry["map"]), trail.last != map { trail.append(map) }
        }
        return ActivityRoute(destination: destination, next: next, steps: travel["remainingSteps"].int > 0 ? travel["remainingSteps"].int : nil,
                             mode: mode, trail: Array(trail.suffix(5)))
    }

    private static func method(_ s: JSONValue) -> String? {
        for entry in s["decisionFeed"]["entries"].array.reversed() {
            switch entry["decision"]["recommendation"]["objective"].string {
            case "train-battle-member-with-vs-seeker": return "Rebattling trainers with the VS Seeker for experience"
            case "train-team-anchor-with-trainer": return "Battling trainers for experience"
            case "lead-with-training-member": return "Leading with the Pokémon in training"
            case "restore-postgame-party-with-items": return "Restoring the party with medicine from the Bag"
            default: continue
            }
        }
        return nil
    }

    private static func meter(_ value: JSONValue, _ total: JSONValue, label: (String, String) -> String) -> ActivityMeter? {
        guard let value = value.finiteNumber, let total = total.finiteNumber, total > 0, value >= 0 else { return nil }
        return ActivityMeter(value: min(value, total), total: total, label: label(count(value), count(total)))
    }
    private static func integer(_ v: JSONValue) -> Int? { v.finiteNumber.map { Int($0) } }
    static func species(_ id: Int, catalog: JSONValue) -> String {
        catalog["species"].array.first { $0["id"].int == id }?["name"].string.nonempty ?? "Pokémon \(id)"
    }
    static func place(_ v: JSONValue) -> String? { place(v.string) }
    static func place(_ raw: String) -> String? {
        guard !raw.isEmpty else { return nil }
        return readableGameText(raw).replacingOccurrences(of: "Route([0-9])", with: "Route $1", options: .regularExpression)
            .replacingOccurrences(of: "Pokemon", with: "Pokémon").replacingOccurrences(of: "Pokémon Center 1F", with: "Pokémon Center", options: .caseInsensitive)
    }
    private static func count(_ value: Double) -> String { value.formatted(.number.precision(.fractionLength(0))) }
}
